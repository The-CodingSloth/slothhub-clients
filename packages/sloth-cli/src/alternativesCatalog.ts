import {SLOTHHUB_PUBLIC_HOSTNAMES} from '@slothhub/domain/public-hostnames';

import type {
  AgentAlternativesDetailFeed,
  AgentAlternativesFeed,
  AgentIndexFeed,
} from './types.js';
import {
  FeedCapabilityUnavailableError,
  FeedClientError,
} from './feedClientError.js';

interface FeedExpectation {
  contentHash?: string;
  catalogRevision?: string;
}

interface AlternativesCatalogDependencies {
  baseUrl: string;
  loadIndex: () => Promise<AgentIndexFeed>;
  loadList: (expected: FeedExpectation) => Promise<AgentAlternativesFeed>;
  loadDetail: (
    path: string,
    expected: FeedExpectation,
  ) => Promise<AgentAlternativesDetailFeed>;
}

interface AlternativesCatalog {
  list: () => Promise<AgentAlternativesFeed>;
  detail: (slug: string) => Promise<AgentAlternativesDetailFeed>;
}

const ALTERNATIVES_PATH = '/api/alternatives.json';
const CANONICAL_CATALOG_ORIGINS = new Set(
  SLOTHHUB_PUBLIC_HOSTNAMES
    .filter((hostname) => !hostname.startsWith('preview.'))
    .map((hostname) => `https://${hostname}`),
);
const FIRST_PARTY_PREVIEW_ORIGINS = new Set(
  SLOTHHUB_PUBLIC_HOSTNAMES
    .filter((hostname) => hostname.startsWith('preview.'))
    .map((hostname) => `https://${hostname}`),
);

const normalizedBasePath = (url: URL): string =>
  url.pathname === '/' ? '' : url.pathname.replace(/\/+$/u, '');

const parseCitationBase = (value: string, path: string): URL => {
  try {
    return new URL(value);
  } catch {
    throw new FeedClientError(
      'schema_invalid',
      path,
      'The public index does not advertise a trusted alternatives citation base.',
    );
  }
};

const assertTrustedIndexBase = (
  siteUrl: string,
  transportBaseUrl: string,
  path: string,
): void => {
  const site = parseCitationBase(siteUrl, path);
  const transport = new URL(transportBaseUrl);
  const cleanSiteBase =
    site.username.length === 0 &&
    site.password.length === 0 &&
    site.search.length === 0 &&
    site.hash.length === 0;
  const matchesTransport =
    site.origin === transport.origin &&
    normalizedBasePath(site) === normalizedBasePath(transport);
  const transportIsCanonicalProduction = CANONICAL_CATALOG_ORIGINS.has(
    transport.origin,
  );
  const canonicalProductionBase =
    (transportIsCanonicalProduction ||
      FIRST_PARTY_PREVIEW_ORIGINS.has(transport.origin)) &&
    CANONICAL_CATALOG_ORIGINS.has(site.origin) &&
    normalizedBasePath(transport).length === 0 &&
    normalizedBasePath(site).length === 0;
  if (!cleanSiteBase || (!matchesTransport && !canonicalProductionBase)) {
    throw new FeedClientError(
      'schema_invalid',
      path,
      'The public index does not advertise a trusted alternatives citation base.',
    );
  }
};

const assertFeedOrigin = (
  siteUrl: string,
  indexSiteUrl: string,
  path: string,
): void => {
  const site = parseCitationBase(siteUrl, path);
  const advertised = parseCitationBase(indexSiteUrl, path);
  if (
    site.origin !== advertised.origin ||
    normalizedBasePath(site) !== normalizedBasePath(advertised)
  ) {
    throw new FeedClientError(
      'schema_invalid',
      path,
      'Alternatives citations do not match the trusted catalog origin.',
    );
  }
};

const normalizeProducerSummaryText = (value: string): string =>
  value.replace(/\s+/gu, ' ').trim();

const assertDetailIdentity = (
  feed: AgentAlternativesDetailFeed,
  requestedSlug: string,
  indexSiteUrl: string,
  path: string,
): void => {
  assertFeedOrigin(feed.siteUrl, indexSiteUrl, path);
  const {data} = feed;
  if (
    data.slug !== requestedSlug ||
    data.sourceTool.slug !== data.slug ||
    data.sourceTool.name !== data.name ||
    data.sourceTool.detailUrl !== data.detailUrl ||
    (data.description !== undefined &&
      data.sourceTool.description !== normalizeProducerSummaryText(data.description))
  ) {
    throw new FeedClientError(
      'schema_invalid',
      path,
      `Alternatives detail identity does not match the requested slug ${requestedSlug}.`,
    );
  }
};

export const createAlternativesCatalog = (
  dependencies: AlternativesCatalogDependencies,
): AlternativesCatalog => {
  const requireIndex = async (): Promise<AgentIndexFeed> => {
    const index = await dependencies.loadIndex();
    if (!index.feeds.alternatives) {
      throw new FeedCapabilityUnavailableError('alternatives');
    }
    return index;
  };

  const loadList = async (index: AgentIndexFeed): Promise<AgentAlternativesFeed> => {
    assertTrustedIndexBase(index.siteUrl, dependencies.baseUrl, ALTERNATIVES_PATH);
    const expectedHash = index.contentHashes?.[ALTERNATIVES_PATH];
    if (index.contentHashes && !expectedHash) {
      throw new FeedClientError(
        'schema_invalid',
        ALTERNATIVES_PATH,
        'The public index does not authenticate the advertised alternatives feed.',
      );
    }
    const feed = await dependencies.loadList({
      contentHash: expectedHash,
      catalogRevision: index.catalogRevision,
    });
    assertFeedOrigin(feed.siteUrl, index.siteUrl, ALTERNATIVES_PATH);
    return feed;
  };

  return {
    list: async () => loadList(await requireIndex()),
    detail: async (slug) => {
      const index = await requireIndex();
      const path = `/api/alternatives/${encodeURIComponent(slug)}.json`;
      assertTrustedIndexBase(index.siteUrl, dependencies.baseUrl, path);
      const expectedHash = index.contentHashes?.[path];
      if (!expectedHash) {
        if (index.contentHashes?.[ALTERNATIVES_PATH]) {
          const alternatives = await loadList(index);
          if (!alternatives.data.sets.some((set) => set.slug === slug)) {
            throw new FeedClientError(
              'not_found',
              path,
              `The public index does not advertise the selected alternatives detail ${path}.`,
            );
          }
        }
        throw new FeedClientError(
          'schema_invalid',
          path,
          `The public index does not authenticate the selected alternatives detail ${path}. ` +
            'Use a current SlothHub catalog or run `slothhub doctor --json` to inspect available feeds.',
        );
      }
      const feed = await dependencies.loadDetail(path, {
        contentHash: expectedHash,
        catalogRevision: index.catalogRevision,
      });
      assertDetailIdentity(feed, slug, index.siteUrl, path);
      return feed;
    },
  };
};
