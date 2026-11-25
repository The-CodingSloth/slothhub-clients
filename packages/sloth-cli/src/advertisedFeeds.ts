import {listAdvertisedCatalogFeeds, type AdvertisedCatalogFeedUrl} from '@slothhub/domain/advertised-catalog-feeds';
import {validateAbsoluteHttpUrl, validatePublicHttpUrl} from '@slothhub/domain/url-safety';
import {safeDiagnostic} from './cliOutput.js';
import {
  FEED_REQUEST_TIMEOUT_MS,
  FeedRequestTimeoutError,
  resolveBaseUrl,
} from './feedClient.js';
import type {AgentIndexFeed} from './types.js';

type FeedProbeStatus = 'ok' | 'unavailable' | 'error';

interface FeedProbeResult {
  status: FeedProbeStatus;
  detail?: string;
}

export interface AdvertisedFeedReport extends AdvertisedCatalogFeedUrl {
  status: FeedProbeStatus;
  detail?: string;
}

export interface DoctorDocument extends AgentIndexFeed {
  statuses: AdvertisedFeedReport[];
}

export type AdvertisedFeedFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

const CLI_USER_AGENT = '@slothhub/cli';
// Receipt (2026-08-29): the current registry advertises 14 feeds plus 2 snapshots.
// Four workers process that fixture in four batches while matching the existing MCP
// detail-hydration network concurrency and bounding simultaneous doctor sockets.
const FEED_PROBE_CONCURRENCY = 4;
const HTTP_STATUS_PATTERN = /\bHTTP\s+(\d{3})\b/;
const GROUP_HEADINGS = {
  feeds: 'Feeds:',
  snapshots: 'Snapshots:',
} as const;

const httpStatusFromMessage = (message: string): number | undefined => {
  const match = HTTP_STATUS_PATTERN.exec(message);
  if (!match?.[1]) return undefined;
  return Number(match[1]);
};

const isSafeAdvertisedFeedUrl = (value: string, catalogOrigins: ReadonlySet<string>): boolean => {
  const safety = validateAbsoluteHttpUrl(value);
  return (
    safety.success &&
    catalogOrigins.has(new URL(value).origin)
  );
};

const classifyFeedProbeError = <ErrorValue>(error: ErrorValue): FeedProbeResult => {
  if (error instanceof FeedRequestTimeoutError) {
    return {
      status: 'error',
      detail: `timed out after ${error.observedMs}ms (configured deadline: ${error.configuredMs}ms)`,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const status = httpStatusFromMessage(message);
  if (status === 404) return {status: 'unavailable'};
  return {status: 'error', detail: safeDiagnostic(message)};
};

const cancelResponseBody = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // Status reporting must not be replaced by a stream cleanup failure.
  }
};

const classifyHttpResponse = async (response: Response): Promise<FeedProbeResult> => {
  const result: FeedProbeResult = response.status === 404
    ? {status: 'unavailable'}
    : response.ok
      ? {status: 'ok'}
      : {status: 'error', detail: `HTTP ${response.status} ${response.statusText}`.trim()};
  await cancelResponseBody(response);
  return result;
};

const defaultProbeFeed = async (
  url: string,
  signal: AbortSignal,
  fetchResponse: AdvertisedFeedFetch,
): Promise<FeedProbeResult> => {
  const headResponse = await fetchResponse(url, {
    method: 'HEAD',
    signal,
    redirect: 'error',
    headers: {
      accept: '*/*',
      'user-agent': CLI_USER_AGENT,
    },
  });

  if (headResponse.status === 405 || headResponse.status === 501) {
    await cancelResponseBody(headResponse);
    const getResponse = await fetchResponse(url, {
      method: 'GET',
      signal,
      redirect: 'error',
      headers: {
        accept: '*/*',
        'user-agent': CLI_USER_AGENT,
      },
    });
    return classifyHttpResponse(getResponse);
  }

  return classifyHttpResponse(headResponse);
};

const probeAdvertisedFeed = async (
  url: string,
  options: {catalogOrigins: ReadonlySet<string>; fetchResponse: AdvertisedFeedFetch},
): Promise<FeedProbeResult> => {
  if (!isSafeAdvertisedFeedUrl(url, options.catalogOrigins)) {
    return {status: 'error', detail: 'advertised URL is not a public catalog feed'};
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const request = (async (): Promise<FeedProbeResult> => {
      try {
        return await defaultProbeFeed(url, controller.signal, options.fetchResponse);
      } catch (error) {
        return classifyFeedProbeError(error);
      }
    })();
    const deadline = new Promise<FeedProbeResult>((resolve) => {
      timeout = setTimeout(() => {
        resolve(classifyFeedProbeError(new FeedRequestTimeoutError(FEED_REQUEST_TIMEOUT_MS)));
        controller.abort();
      }, FEED_REQUEST_TIMEOUT_MS);
    });
    return await Promise.race([request, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

const collectAdvertisedFeedReports = async (
  index: Pick<AgentIndexFeed, 'feeds' | 'snapshots'>,
  probe: (url: string) => Promise<FeedProbeResult>,
): Promise<AdvertisedFeedReport[]> => {
  const advertised = listAdvertisedCatalogFeeds(index);
  const reports = new Array<AdvertisedFeedReport>(advertised.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < advertised.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = advertised[index]!;
      const result = await probe(item.url);
      reports[index] = result.detail
        ? {...item, status: result.status, detail: result.detail}
        : {...item, status: result.status};
    }
  };
  await Promise.all(
    Array.from(
      {length: Math.min(FEED_PROBE_CONCURRENCY, advertised.length)},
      () => worker(),
    ),
  );
  return reports;
};

const formatReportLine = (report: AdvertisedFeedReport): string => {
  const detail = report.status === 'error' && report.detail
    ? ` (${safeDiagnostic(report.detail)})`
    : '';
  return `- ${safeDiagnostic(report.key)}: ${report.status}${detail} ${safeDiagnostic(report.url)}`;
};

const formatDoctorHuman = (input: {
  version: string;
  siteUrl: string;
  generatedAt: string;
  manifestUrl: string;
  schemaUrl: string;
  reports: AdvertisedFeedReport[];
}): string => {
  const lines = [
    `Feed version: ${safeDiagnostic(input.version)}`,
    `Site URL: ${safeDiagnostic(input.siteUrl)}`,
    `Generated: ${safeDiagnostic(input.generatedAt)}`,
    `Manifest: ${safeDiagnostic(input.manifestUrl)}`,
    `Schema: ${safeDiagnostic(input.schemaUrl)}`,
  ];

  for (const group of ['feeds', 'snapshots'] as const) {
    const reports = input.reports.filter((report) => report.group === group);
    if (reports.length === 0) continue;
    lines.push(GROUP_HEADINGS[group]);
    for (const report of reports) lines.push(formatReportLine(report));
  }

  return `${lines.join('\n')}\n`;
};

export interface CatalogDiagnostics {
  document: DoctorDocument;
  human: string;
}

export const inspectCatalogDiagnostics = async (
  index: AgentIndexFeed,
  options: {baseUrl?: string; fetchResponse?: AdvertisedFeedFetch} = {},
): Promise<CatalogDiagnostics> => {
  const catalogBaseUrl = resolveBaseUrl(options.baseUrl);
  const catalogOrigin = new URL(catalogBaseUrl).origin;
  const catalogOrigins = new Set([catalogOrigin]);
  try {
    const advertisedBaseUrl = resolveBaseUrl(index.siteUrl);
    const advertisedOrigin = new URL(advertisedBaseUrl).origin;
    if (
      validatePublicHttpUrl(advertisedBaseUrl).success ||
      advertisedOrigin === catalogOrigin
    ) {
      catalogOrigins.add(advertisedOrigin);
    }
  } catch {
    // An unsupported advertised site URL never becomes an allowed probe origin.
  }

  const reports = await collectAdvertisedFeedReports(index, (url) =>
    probeAdvertisedFeed(url, {
      catalogOrigins,
      fetchResponse: options.fetchResponse ?? fetch,
    }),
  );

  return {
    document: {...index, statuses: reports},
    human: formatDoctorHuman({
      version: index.version,
      siteUrl: index.siteUrl,
      generatedAt: index.generatedAt,
      manifestUrl: `${catalogBaseUrl}/api/index.json`,
      schemaUrl: index.schemaUrl,
      reports,
    }),
  };
};
