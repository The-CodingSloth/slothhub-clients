import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {buildProjectToolPinManifest, PROJECT_TOOL_PIN_MANIFEST_ARTIFACT, PROJECT_TOOL_PIN_MANIFEST_DEFAULT_FILENAME, PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES, PROJECT_TOOL_PIN_MANIFEST_MAX_TOOLS, PROJECT_TOOL_PIN_MANIFEST_VERSION, serializeProjectToolPinManifest, type ProjectManifestToolsArtifact, type ProjectToolPinManifest, type ProjectToolPinManifestTool} from '@slothhub/domain/project-tool-pin-manifest';
import {canonicalJson} from '@slothhub/domain/canonical-json';
import {getCachedToolLookupResolver, type ToolLookupArtifact} from '@slothhub/domain/tool-lookup';
import {hasRuntimeObjectType, isRuntimeString} from '@slothhub/domain/runtime-validation';
import {inventoryNpmManifest, type NpmManifestInventoryState} from '@slothhub/domain/npm-manifest-inventory';

import { failForOutput, jsonLine, ok, safeDiagnostic } from './cliOutput.js';
import { writeDecisionReceiptOutput } from './decisionReceiptFiles.js';
import {
  inventoryInputFailure,
  readWorkspaceDependencyManifest,
} from './inventoryCli.js';
import type { CliResult } from './types.js';
import {LEGACY_MANIFEST_OUTPUT_MESSAGE, LEGACY_MANIFEST_OUTPUT_RECOVERY, legacyManifestBlocksDefaultOutput} from './manifestFile.js';

export interface ManifestInitCliRequest {
  references: string[];
  fromInventory?: string;
  output?: string;
  force: boolean;
  json: boolean;
}

export interface ManifestInitCliDependencies {
  loadLookup: () => Promise<ToolLookupArtifact | null>;
  loadCatalogTools: () => Promise<ProjectManifestToolsArtifact | null>;
  readInventorySource?: (path: string) => Promise<string>;
  writeOutput?: (path: string, contents: string, force: boolean) => Promise<void>;
  workingDirectory?: string;
  producerVersion: string;
}

type UnresolvedReason = 'unknown' | 'retired' | 'invalid_slug' | 'ambiguous' | 'unavailable';

interface UnresolvedToolReference {
  requested: string;
  reason: UnresolvedReason;
}

interface UnmappedDependency {
  name: string;
  state: NpmManifestInventoryState | 'unavailable';
}

type ManifestOutputErrorCode = 'EINVAL' | 'ELOOP' | 'ENOTDIR' | 'ENOENT' | 'EISDIR' | 'EEXIST';

const OUTPUT_RECOVERY = `Choose a file name inside the working directory, such as ${PROJECT_TOOL_PIN_MANIFEST_DEFAULT_FILENAME}.`;

class ManifestOutputPathError extends Error {
  readonly code: ManifestOutputErrorCode;
  readonly recovery: string;

  constructor(code: ManifestOutputErrorCode, message: string, recovery = OUTPUT_RECOVERY) {
    super(message);
    this.name = 'ManifestOutputPathError';
    this.code = code;
    this.recovery = recovery;
  }
}

const fsErrorCode = <Value>(error: Value): string | undefined =>
  hasRuntimeObjectType(error) && error !== null && 'code' in error && isRuntimeString(error.code)
    ? error.code
    : undefined;

const isOutside = (inward: string): boolean =>
  inward === '..' || inward.startsWith(`..${sep}`) || isAbsolute(inward);

// The manifest is the human-agent handoff artifact: it must land on a regular
// file inside the working directory so an agent cannot redirect the write
// through an absolute path, a `..` escape, or a symlink.
const resolveManifestOutputPath = async (
  requested: string | undefined,
  cwd: string,
  force: boolean,
): Promise<{ path: string; display: string }> => {
  const display = requested ?? PROJECT_TOOL_PIN_MANIFEST_DEFAULT_FILENAME;

  if (isAbsolute(display) || /^[a-zA-Z]:/.test(display)) {
    throw new ManifestOutputPathError(
      'EINVAL',
      'The --output path must be relative to the working directory.',
    );
  }

  // Resolve the working directory first so containment checks hold even when a
  // caller hands us a relative root.
  const root = resolve(cwd);
  // Writing the current name beside an old-name manifest would leave two
  // manifests, and readers would silently switch to the new one.
  if (requested === undefined && await legacyManifestBlocksDefaultOutput(root)) {
    throw new ManifestOutputPathError('EEXIST', LEGACY_MANIFEST_OUTPUT_MESSAGE, LEGACY_MANIFEST_OUTPUT_RECOVERY);
  }
  const resolved = resolve(root, display);
  if (isOutside(relative(root, resolved))) {
    throw new ManifestOutputPathError(
      'EINVAL',
      'The --output path resolves outside the working directory.',
    );
  }

  let destinationStatus;
  try {
    destinationStatus = await lstat(resolved);
  } catch (error) {
    if (fsErrorCode(error) !== 'ENOENT') throw error;
  }
  if (destinationStatus?.isSymbolicLink()) {
    throw new ManifestOutputPathError(
      'ELOOP',
      'The --output path is a symbolic link.',
      'Choose a regular file name that is not a symbolic link.',
    );
  }
  if (destinationStatus?.isDirectory()) {
    throw new ManifestOutputPathError(
      'EISDIR',
      'The --output path is an existing directory.',
      'Pass a file path, not a directory.',
    );
  }
  if (destinationStatus && !destinationStatus.isFile()) {
    throw new ManifestOutputPathError(
      'EINVAL',
      'The --output path exists and is not a regular file.',
      'Choose a regular file name for the manifest destination.',
    );
  }
  if (destinationStatus && !force) {
    throw new ManifestOutputPathError(
      'EEXIST',
      `Refusing to overwrite existing file: ${display}.`,
      'Use --force to replace it or choose a different --output path.',
    );
  }

  const parent = dirname(resolved);
  let parentStatus;
  try {
    parentStatus = await lstat(parent);
  } catch (error) {
    if (fsErrorCode(error) === 'ENOENT' || fsErrorCode(error) === 'ENOTDIR') {
      throw new ManifestOutputPathError(
        'ENOENT',
        'The --output destination directory does not exist.',
        'Create the directory first or choose an existing one inside the working directory.',
      );
    }
    throw error;
  }
  if (parentStatus.isSymbolicLink()) {
    throw new ManifestOutputPathError(
      'ELOOP',
      'The --output destination directory is a symbolic link.',
      'Choose a destination inside the working directory that does not use symbolic links.',
    );
  }
  if (!parentStatus.isDirectory()) {
    throw new ManifestOutputPathError(
      'ENOTDIR',
      'A component of the --output path is not a directory.',
      'Choose a file path whose parent directories exist.',
    );
  }

  let realPaths: [string, string];
  try {
    realPaths = await Promise.all([realpath(root), realpath(parent)]);
  } catch (error) {
    throw new ManifestOutputPathError(
      fsErrorCode(error) === 'ENOTDIR' ? 'ENOTDIR' : 'ENOENT',
      'The --output destination directory does not exist.',
      'Create the directory first or choose an existing one inside the working directory.',
    );
  }
  if (isOutside(relative(realPaths[0], realPaths[1]))) {
    throw new ManifestOutputPathError(
      'EINVAL',
      'The --output destination resolves outside the working directory.',
    );
  }

  return { path: resolved, display };
};

const unresolvedFailure = (json: boolean, unresolved: UnresolvedToolReference[]): CliResult => {
  const listed = unresolved.map((entry) => `${entry.requested} (${entry.reason})`).join(', ');
  const recovery = 'Check `slothhub search` or `slothhub tool <slug>` for the current public slug, then retry.';
  return failForOutput(
    json,
    {
      code: 'unresolved_tools',
      message: `Unresolved Tool slugs: ${listed}`,
      unresolved,
      recovery,
    },
    `unresolved_tools: ${safeDiagnostic(listed)}. ${recovery}\n`,
  );
};

const capabilityFailure = (json: boolean, capability: string): CliResult =>
  failForOutput(
    json,
    {
      code: 'capability_unavailable',
      message: `${capability} is unavailable from this SlothHub feed version.`,
      recovery: 'Retry against a current SlothHub feed or upgrade the CLI.',
    },
    `capability_unavailable: ${capability} is unavailable from this SlothHub feed version. Retry against a current SlothHub feed or upgrade the CLI.\n`,
  );

export const runManifestInitCommand = async (
  request: ManifestInitCliRequest,
  dependencies: ManifestInitCliDependencies,
): Promise<CliResult> => {
  const requested = [
    ...new Set(
      request.references
        .map((reference) => reference.trim().toLowerCase())
        .filter((reference) => reference.length > 0),
    ),
  ];

  if (requested.length === 0 && !request.fromInventory) {
    return failForOutput(
      request.json,
      {
        code: 'invalid_input',
        message: 'Manifest init requires at least one public Tool slug or --from-inventory <package.json|->.',
        recovery: 'Pass public Tool slugs, for example: slothhub manifest init figma linear.',
      },
      'Manifest init requires at least one public Tool slug or --from-inventory <package.json|->.\n',
    );
  }

  // The output path is validated before any fetch so a refused destination
  // never costs a network request.
  let output: { path: string; display: string };
  try {
    output = await resolveManifestOutputPath(
      request.output,
      dependencies.workingDirectory ?? process.cwd(),
      request.force,
    );
  } catch (error) {
    if (error instanceof ManifestOutputPathError) {
      return failForOutput(
        request.json,
        { code: error.code, message: error.message, recovery: error.recovery },
        `${error.code}: ${safeDiagnostic(error.message)} Recovery: ${error.recovery}\n`,
      );
    }
    throw error;
  }

  let inventorySource: string | undefined;
  if (request.fromInventory) {
    try {
      inventorySource = await (dependencies.readInventorySource ?? readWorkspaceDependencyManifest)(
        request.fromInventory,
      );
    } catch (error) {
      return inventoryInputFailure(request.json, error);
    }
  }

  const [lookup, catalog] = await Promise.all([
    dependencies.loadLookup(),
    dependencies.loadCatalogTools(),
  ]);

  const requestedSlugs: string[] = [];
  if (requested.length > 0) {
    if (!lookup) {
      return capabilityFailure(request.json, 'Exact Tool lookup');
    }
    const resolver = getCachedToolLookupResolver(lookup);
    const unresolved: UnresolvedToolReference[] = [];
    for (const requestedReference of requested) {
      const outcome = resolver.resolve({ namespace: 'slug', value: requestedReference });
      if (outcome.kind === 'resolved' || outcome.kind === 'aliased') {
        requestedSlugs.push(outcome.tool.slug);
      } else if (outcome.kind === 'retired') {
        unresolved.push({ requested: requestedReference, reason: 'retired' });
      } else if (outcome.kind === 'invalid_input') {
        unresolved.push({ requested: requestedReference, reason: 'invalid_slug' });
      } else if (outcome.kind === 'ambiguous') {
        unresolved.push({ requested: requestedReference, reason: 'ambiguous' });
      } else {
        unresolved.push({ requested: requestedReference, reason: 'unknown' });
      }
    }
    if (unresolved.length > 0) return unresolvedFailure(request.json, unresolved);
  }

  if (!catalog) {
    return capabilityFailure(request.json, 'The project manifest Tools feed');
  }
  const catalogRows = new Map(catalog.data.tools.map((tool) => [tool.slug, tool]));

  const missingRequested = requestedSlugs
    .filter((slug) => !catalogRows.has(slug))
    .map((slug): UnresolvedToolReference => ({ requested: slug, reason: 'unavailable' }));
  if (missingRequested.length > 0) return unresolvedFailure(request.json, missingRequested);

  const selectedSlugs = new Set(requestedSlugs);
  const unmappedDependencies: UnmappedDependency[] = [];
  if (inventorySource !== undefined) {
    let report;
    try {
      report = inventoryNpmManifest(inventorySource, lookup);
    } catch (error) {
      return inventoryInputFailure(request.json, error);
    }
    for (const dependency of report.dependencies) {
      const slug = dependency.tool?.slug;
      if (slug && catalogRows.has(slug)) {
        selectedSlugs.add(slug);
      } else if (slug) {
        unmappedDependencies.push({ name: dependency.name, state: 'unavailable' });
      } else {
        unmappedDependencies.push({ name: dependency.name, state: dependency.state });
      }
    }
  }

  if (selectedSlugs.size > PROJECT_TOOL_PIN_MANIFEST_MAX_TOOLS) {
    return failForOutput(
      request.json,
      {
        code: 'tool_limit_exceeded',
        message: `Manifest init selected ${selectedSlugs.size} Tools, exceeding the configured limit of ${PROJECT_TOOL_PIN_MANIFEST_MAX_TOOLS}.`,
        configuredLimit: PROJECT_TOOL_PIN_MANIFEST_MAX_TOOLS,
        observedValue: selectedSlugs.size,
        recovery: 'Select at most 100 public Tools and retry.',
      },
      `tool_limit_exceeded: Manifest init selected ${selectedSlugs.size} Tools, exceeding the configured limit of ${PROJECT_TOOL_PIN_MANIFEST_MAX_TOOLS}. Select at most 100 public Tools.\n`,
    );
  }
  if (selectedSlugs.size === 0) {
    return failForOutput(
      request.json,
      {
        code: 'no_resolved_tools',
        message: 'Manifest init resolved no public Tools to pin.',
        ...(request.fromInventory ? { unmappedDependencies } : undefined),
        recovery: 'Pass public Tool slugs or a package.json whose dependencies map to public Tools.',
      },
      'no_resolved_tools: Manifest init resolved no public Tools to pin. Pass public Tool slugs or a package.json whose dependencies map to public Tools.\n',
    );
  }

  const tools: ProjectToolPinManifestTool[] = [...selectedSlugs].map((slug) => catalogRows.get(slug)!);

  let manifest: ProjectToolPinManifest;
  try {
    manifest = buildProjectToolPinManifest({
      producer: { name: '@slothhub/cli', version: dependencies.producerVersion },
      createdAt: new Date().toISOString(),
      provenance: {
        catalogFeedVersion: catalog.version,
        catalogGeneratedAt: catalog.generatedAt,
        catalogRevision: catalog.catalogRevision,
      },
      tools,
    });
  } catch {
    return failForOutput(
      request.json,
      {
        code: 'invalid_manifest',
        message: 'The resolved public Tools could not form a valid Project Tool pin manifest.',
        recovery: 'Retry with different Tools or report the feed gap.',
      },
      'invalid_manifest: The resolved public Tools could not form a valid Project Tool pin manifest.\n',
    );
  }

  let serialized: string;
  try {
    serialized = serializeProjectToolPinManifest(manifest);
  } catch (error) {
    if (error instanceof Error && error.message === 'oversized') {
      const observedBytes = new TextEncoder()
        .encode(`${canonicalJson(manifest, 2)}\n`)
        .byteLength;
      return failForOutput(
        request.json,
        {
          code: 'manifest_too_large',
          message: `The manifest exceeds the configured ${PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES}-byte limit (observed ${observedBytes} bytes).`,
          configuredLimitBytes: PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES,
          observedBytes,
          recovery: 'Select fewer Tools and retry.',
        },
        `manifest_too_large: exceeds the configured ${PROJECT_TOOL_PIN_MANIFEST_MAX_BYTES}-byte limit (observed ${observedBytes} bytes). Select fewer Tools.\n`,
      );
    }
    return failForOutput(
      request.json,
      {
        code: 'invalid_manifest',
        message: 'The resolved public Tools could not form a valid Project Tool pin manifest.',
        recovery: 'Retry with different Tools or report the feed gap.',
      },
      'invalid_manifest: The resolved public Tools could not form a valid Project Tool pin manifest.\n',
    );
  }

  const writeOutput = dependencies.writeOutput ?? writeDecisionReceiptOutput;
  try {
    await writeOutput(output.path, serialized, request.force);
  } catch (error) {
    if (fsErrorCode(error) === 'EEXIST') {
      return failForOutput(
        request.json,
        {
          code: 'EEXIST',
          message: `Refusing to overwrite existing file: ${output.display}.`,
          recovery: 'Use --force to replace it or choose a different --output path.',
        },
        `EEXIST: Refusing to overwrite existing file: ${safeDiagnostic(output.display)}. Use --force to replace it.\n`,
      );
    }
    const message = safeDiagnostic(error instanceof Error ? error.message : error);
    return failForOutput(
      request.json,
      {
        code: 'output_write_failed',
        message,
        recovery: 'Check the destination path and permissions, then retry.',
      },
      `output_write_failed: ${message}\n`,
    );
  }

  if (request.json) {
    return ok(jsonLine({
      artifact: PROJECT_TOOL_PIN_MANIFEST_ARTIFACT,
      version: PROJECT_TOOL_PIN_MANIFEST_VERSION,
      path: output.display,
      toolCount: tools.length,
      tools: tools.map((tool) => tool.slug),
      provenance: manifest.provenance,
      ...(request.fromInventory ? { unmappedDependencies } : undefined),
    }));
  }

  const lines = [
    `Wrote ${safeDiagnostic(output.display)} with ${tools.length} pinned Tool${tools.length === 1 ? '' : 's'}.`,
  ];
  if (unmappedDependencies.length > 0) {
    lines.push(
      `Unmapped dependencies not pinned: ${unmappedDependencies
        .map((dependency) => `${safeDiagnostic(dependency.name)} (${dependency.state})`)
        .join(', ')}.`,
    );
  }
  lines.push('The manifest is an unverified project declaration. Check it with `slothhub manifest validate`.');
  return { exitCode: 0, stdout: '', stderr: `${lines.join('\n')}\n` };
};
