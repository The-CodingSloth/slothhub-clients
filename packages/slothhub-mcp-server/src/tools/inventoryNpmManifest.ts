import {BREWFILE_INVENTORY_MAX_BYTES, BrewfileInventoryError, inventoryBrewfile, type BrewfileInventoryReport} from '@slothhub/domain/brewfile-inventory';
import {ECOSYSTEM_MANIFEST_INVENTORY_MAX_BYTES, EcosystemManifestInventoryError, inventoryEcosystemManifest, resolveInventoryEcosystem, type EcosystemManifestInventoryReport, type ManifestEcosystem} from '@slothhub/domain/ecosystem-manifest-inventory';
import {GO_MOD_INVENTORY_MAX_BYTES, GoModInventoryError, inventoryGoMod, isGoModuleInventorySource, type GoModInventoryReport} from '@slothhub/domain/go-mod-inventory';
import {NPM_MANIFEST_INVENTORY_MAX_BYTES, NpmManifestInventoryError, inventoryNpmManifest, type NpmManifestInventoryReport} from '@slothhub/domain/npm-manifest-inventory';
import {ToolLookupArtifactLimitError, type ToolLookupArtifact} from '@slothhub/domain/tool-lookup';
import {UnsupportedFeedVersionError} from '@slothhub/domain/feed-compatibility';
import {safeDiagnostic} from '@slothhub/domain/safe-diagnostic';
import {z} from 'zod';

import {escapeMarkdownText} from './markdownText.js';
import {
  BoundedUtf8SourceError,
  readBoundedUtf8File,
} from '@slothhub/domain/bounded-utf8-source';
import type {FeedClient} from '../services/feeds.js';
import type {inventoryNpmManifestInputSchema} from '../schemas/inputs.js';
import {
  feedLoadError,
  formatToolResult,
  toolError,
  type ToolContentResult,
} from './format.js';

type InventoryNpmManifestInput = z.infer<typeof inventoryNpmManifestInputSchema>;
type InventoryKind = ManifestEcosystem | 'go' | 'brewfile';
type InventoryReport = NpmManifestInventoryReport | EcosystemManifestInventoryReport |
  GoModInventoryReport | BrewfileInventoryReport;

const MANIFEST_LABEL = 'Workspace dependency manifest';
const MANIFEST_RECOVERY =
  'Provide one explicit package.json, pyproject.toml, Cargo.toml, go.mod, or Brewfile path, or inline text with ecosystem or brewfile as needed.';
const MANIFEST_MAX_BYTES = {
  npm: NPM_MANIFEST_INVENTORY_MAX_BYTES,
  pypi: ECOSYSTEM_MANIFEST_INVENTORY_MAX_BYTES,
  crates: ECOSYSTEM_MANIFEST_INVENTORY_MAX_BYTES,
  go: GO_MOD_INVENTORY_MAX_BYTES,
  brewfile: BREWFILE_INVENTORY_MAX_BYTES,
} satisfies Record<InventoryKind, number>;

// Wildcards, path expansion, and embedded NULs mean the caller asked for
// discovery, not one explicit file — reject before touching the filesystem.
const NON_EXPLICIT_PATH = /[*?[\]{}\u0000]/;

const visibleTerminalText = (value: string): string =>
  escapeMarkdownText(value).replace(
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,
    (character) => `\\u{${character.codePointAt(0)!.toString(16)}}`,
  );

const formatReport = (report: InventoryReport): string => {
  if ('formulas' in report) {
    return [
      '# Brewfile formula inventory',
      '',
      `${report.summary.total} declared formula${report.summary.total === 1 ? '' : 's'}`,
      ...report.formulas.map((formula) => {
        const name = visibleTerminalText(formula.name);
        return formula.tool
          ? `- ${formula.state}: ${name} -> ${visibleTerminalText(formula.tool.name)} (${visibleTerminalText(formula.tool.detailUrl)})`
          : `- ${formula.state}: ${name}`;
      }),
      '',
      report.disclaimer,
    ].join('\n');
  }
  if ('requirements' in report) {
    return [
      '# Go module inventory',
      '',
      `module ${visibleTerminalText(report.modulePath)}`,
      `${report.summary.total} required module${report.summary.total === 1 ? '' : 's'}`,
      ...report.requirements.map((requirement) => {
        const name = visibleTerminalText(requirement.modulePath);
        const version = visibleTerminalText(requirement.version);
        return requirement.tool
          ? `- ${requirement.state}: ${name} -> ${visibleTerminalText(requirement.tool.name)} (${visibleTerminalText(requirement.tool.detailUrl)}) [${version}]`
          : `- ${requirement.state}: ${name} [${version}]`;
      }),
      ...report.skippedDirectives.map((skipped) =>
        `- skipped: ${skipped.count} ${skipped.directive} (${skipped.rule})`),
      '',
      report.disclaimer,
    ].join('\n');
  }
  const title = 'ecosystem' in report
    ? `${report.ecosystem === 'pypi' ? 'PyPI' : 'crates'} dependency inventory`
    : 'Workspace dependency inventory';
  const lines = [
    `# ${title}`,
    '',
    `${report.summary.total} declared dependenc${report.summary.total === 1 ? 'y' : 'ies'}`,
    '',
    ...report.dependencies.map((dependency) => {
      const name = visibleTerminalText(dependency.name);
      const maps = dependency.declaredIn.join(', ');
      if (dependency.tool) {
        const toolName = visibleTerminalText(dependency.tool.name);
        const detailUrl = visibleTerminalText(dependency.tool.detailUrl);
        return `- ${dependency.state}: ${name} -> ${toolName} (${detailUrl}) [${maps}]`;
      }
      return `- ${dependency.state}: ${name} [${maps}]`;
    }),
    '',
    report.disclaimer,
  ];
  return lines.join('\n');
};

const readInlineManifest = (
  manifest: string,
  maxBytes: number,
): string => {
  const observedBytes = Buffer.byteLength(manifest, 'utf8');
  if (observedBytes > maxBytes) {
    throw new BoundedUtf8SourceError('input_too_large', MANIFEST_LABEL, MANIFEST_RECOVERY, {
      configuredLimitBytes: maxBytes,
      observedBytes,
    });
  }
  // Encoding a lone surrogate silently becomes U+FFFD, so an unequal
  // round-trip means the argument was not well-formed UTF-8 text.
  const encoded = Buffer.from(manifest, 'utf8');
  if (encoded.toString('utf8') !== manifest) {
    throw new BoundedUtf8SourceError('invalid_utf8', MANIFEST_LABEL, MANIFEST_RECOVERY);
  }
  return manifest;
};

export const handleInventoryNpmManifest = async (
  client: FeedClient,
  params: InventoryNpmManifestInput,
  signal?: AbortSignal,
): Promise<ToolContentResult> => {
  try {
    const hasPath = params.path !== undefined;
    const hasManifest = params.manifest !== undefined;
    if (hasPath === hasManifest) {
      return toolError(
        'Inventory requires exactly one manifest source.',
        {
          code: 'invalid_input',
          responseFormat: params.response_format,
          suggestion: `Provide exactly one of path or manifest. ${MANIFEST_RECOVERY}`,
        },
      );
    }

    const sourcePath = params.path ?? '-';
    if (params.path?.split(/[\\/]/).pop() === 'go.work') {
      throw new GoModInventoryError('workspace_file', 'Go workspaces are not supported.', 'Provide one explicit go.mod file; workspace references are never followed.');
    }
    if (params.path !== undefined && (params.path === '-' || NON_EXPLICIT_PATH.test(params.path))) {
      return toolError('Manifest path must be one explicit file path; discovery and stdin paths are not supported.', {
        code: 'invalid_input',
        responseFormat: params.response_format,
        suggestion: 'Pass an exact manifest path, or supply its contents with manifest.',
      });
    }
    const ecosystem = resolveInventoryEcosystem(params.brewfile ? 'npm' : params.ecosystem, sourcePath);
    let kind: InventoryKind = params.brewfile
      ? 'brewfile'
      : isGoModuleInventorySource(sourcePath, '')
        ? 'go'
        : ecosystem;
    const maxBytes = MANIFEST_MAX_BYTES[kind];
    const source = params.manifest !== undefined
      ? readInlineManifest(params.manifest, maxBytes)
      : await readBoundedUtf8File(sourcePath, {
        maxBytes, label: MANIFEST_LABEL, recovery: MANIFEST_RECOVERY,
      });
    if (kind !== 'go' && !params.brewfile && isGoModuleInventorySource(sourcePath, source)) {
      kind = 'go';
      // The current domain budgets are equal. Keep inline Go bounded by its
      // own contract if those independent budgets ever change.
      readInlineManifest(source, MANIFEST_MAX_BYTES.go);
    }

    let lookup: ToolLookupArtifact | null = null;
    try {
      lookup = await client.toolLookup(signal);
    } catch (error) {
      if (
        error instanceof ToolLookupArtifactLimitError ||
        error instanceof UnsupportedFeedVersionError
      ) {
        throw error;
      }
      // A missing, malformed, stale, or unavailable public projection is factual
      // capability absence, never evidence that a dependency is unknown.
    }

    const report = kind === 'brewfile'
      ? inventoryBrewfile(source, lookup)
      : kind === 'go'
        ? inventoryGoMod(source, lookup)
        : kind === 'npm'
          ? inventoryNpmManifest(source, lookup)
          : inventoryEcosystemManifest(source, kind, lookup);
    return formatToolResult(
      params.response_format,
      formatReport(report),
      report,
    );
  } catch (error) {
    if (error instanceof BoundedUtf8SourceError) {
      return toolError(safeDiagnostic(error.message), {
        code: error.code,
        responseFormat: params.response_format,
        suggestion: error.recovery,
        details: {
          configuredLimitBytes: error.configuredLimitBytes,
          observedBytes: error.observedBytes,
          recovery: error.recovery,
        },
      });
    }
    if (
      error instanceof NpmManifestInventoryError ||
      error instanceof EcosystemManifestInventoryError ||
      error instanceof GoModInventoryError ||
      error instanceof BrewfileInventoryError
    ) {
      return toolError(safeDiagnostic(error.message), {
        code: error.code,
        responseFormat: params.response_format,
        suggestion: error.recovery,
        details: {
          configuredLimit: error.configuredLimit,
          observedValue: error.observedValue,
          recovery: error.recovery,
        },
      });
    }
    return feedLoadError(
      'inventorying dependency manifest',
      error,
      params.response_format,
    );
  }
};
