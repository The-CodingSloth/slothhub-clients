import {builtinModules} from 'node:module';

import {
  releaseRepository,
  releaseRunbook,
  releaseTargetConfigurations,
  workspacePackages,
} from './release-config.mjs';

export {releaseRepository, releaseRunbook, workspacePackages};
const REPOSITORY_URL = `https://github.com/${releaseRepository}.git`;
const NPM_REGISTRY = 'https://registry.npmjs.org/';

const target = (configuration) =>
  Object.freeze({
    ...configuration,
    manifestFiles: Object.freeze(configuration.manifestFiles),
    allowedPackedDirectories: Object.freeze(configuration.allowedPackedDirectories),
    allowedPackedRootFiles: Object.freeze(configuration.allowedPackedRootFiles),
    requiredPackedFiles: Object.freeze(configuration.requiredPackedFiles),
  });

export const releaseTargets = Object.freeze(Object.fromEntries(
  Object.entries(releaseTargetConfigurations).map(([key, configuration]) => [key, target(configuration)]),
));

const VERSION_PATTERN = '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)';

export const parseReleaseTag = (tag) => {
  for (const target of Object.values(releaseTargets)) {
    const match = new RegExp(`^${target.tagPrefix}${VERSION_PATTERN}$`, 'u').exec(tag);
    if (match) {
      return {key: target.key, version: `${match[1]}.${match[2]}.${match[3]}`};
    }
  }

  const expected = Object.values(releaseTargets).map(({tagPrefix}) => `${tagPrefix}X.Y.Z`);
  throw new Error(`Invalid release tag "${tag}". Expected ${expected.join(', ')}.`);
};

export const parseNpmPublishDryRun = (value, packageName) => {
  const candidate = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : undefined
    : value?.files
      ? value
      : value?.[packageName];
  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.files)) {
    throw new Error(`npm publish dry-run output did not contain ${packageName}.`);
  }
  return candidate;
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const assertPublishConfig = (publishConfig) => {
  const expected = {access: 'public', provenance: true, registry: NPM_REGISTRY};
  if (
    !publishConfig ||
    JSON.stringify(Object.keys(publishConfig).sort()) !==
      JSON.stringify(Object.keys(expected).sort()) ||
    Object.entries(expected).some(([key, value]) => publishConfig[key] !== value)
  ) {
    throw new Error(
      `publishConfig must contain exactly access=public, provenance=true, and registry=${NPM_REGISTRY}.`,
    );
  }
};

const assertManifestFiles = (targetConfiguration, files) => {
  if (JSON.stringify(files) !== JSON.stringify(targetConfiguration.manifestFiles)) {
    throw new Error(
      `${targetConfiguration.packageName} files allowlist must exactly match its release target.`,
    );
  }
};

export const assertToolVersion = (actual, minimum, label) => {
  const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
  const actualMatch = versionPattern.exec(actual);
  const minimumMatch = versionPattern.exec(minimum);
  if (!actualMatch || !minimumMatch) {
    throw new Error(`${label} versions must be numeric triplets such as 11.15.0.`);
  }

  const actualParts = actualMatch.slice(1).map(Number);
  const minimumParts = minimumMatch.slice(1).map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (actualParts[index] > minimumParts[index]) return;
    if (actualParts[index] < minimumParts[index]) {
      throw new Error(`${label} ${actual} is too old; release preparation requires ${minimum} or newer.`);
    }
  }
};

export const assertMcpParity = (manifest, serverManifest) => {
  if (!Array.isArray(serverManifest.packages) || serverManifest.packages.length !== 1) {
    throw new Error('MCP server.json must contain exactly one packages entry.');
  }
  const packageEntry = serverManifest.packages[0];
  if (
    manifest.mcpName !== serverManifest.name ||
    manifest.version !== serverManifest.version ||
    manifest.name !== packageEntry.identifier ||
    manifest.version !== packageEntry.version ||
    packageEntry.registryType !== 'npm' ||
    packageEntry.transport?.type !== 'stdio'
  ) {
    throw new Error('MCP package.json and server.json package/server metadata are out of sync.');
  }
  const remotes = serverManifest.remotes;
  if (!Array.isArray(remotes) || remotes.length !== 1 ||
    remotes[0]?.type !== 'streamable-http' || remotes[0]?.url !== 'https://slothhub.dev/mcp' ||
    Object.keys(remotes[0]).some((key) => !['type', 'url'].includes(key))) {
    throw new Error('MCP hosted Registry transport must be exactly the public streamable-http endpoint https://slothhub.dev/mcp, without headers or credentials.');
  }
};

const SENSITIVE_FILE_NAME =
  /(?:^\.env(?:rc|[._-]|$)|^\.npmrc$|(?:^|[._-])credentials?(?:[._-]|$)|(?:^|[._-])secrets?(?:[._-]|$)|(?:^|[._-])(?:access[._-]?)?tokens?(?:[._-]|$)|(?:^|[._-])private[._-]?key(?:[._-]|$)|(?:^|[._-])cert(?:ificate)?(?:[._-]|$)|^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|\.(?:pem|key|p12|pfx|crt|cer)$)/iu;

const isRuntimeSource = (path) =>
  /\.(?:[cm]?ts|tsx)$/iu.test(path) && !/\.d\.[cm]?ts$/iu.test(path);

export const assertPackedFiles = ({target: targetConfiguration, files}) => {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Package file list must be a non-empty array.');
  }

  const paths = files.map((file) => file?.path);
  if (paths.some((path) => path !== String(path))) {
    throw new Error('Package file entries must contain string paths.');
  }
  if (new Set(paths).size !== paths.length) {
    throw new Error('Package file list contains duplicate paths.');
  }

  for (const path of paths) {
    const segments = path.split('/');
    if (
      path.startsWith('/') ||
      path.includes('\\') ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new Error(`Unsafe package file path: ${path}.`);
    }
    if (segments.some((segment) => SENSITIVE_FILE_NAME.test(segment))) {
      throw new Error(`Sensitive package file is not allowed: ${path}.`);
    }
    if (isRuntimeSource(path)) {
      throw new Error(`Runtime TypeScript source is not allowed in the package: ${path}.`);
    }

    const allowed =
      targetConfiguration.allowedPackedRootFiles.includes(path) ||
      targetConfiguration.allowedPackedDirectories.some((directory) =>
        path.startsWith(`${directory}/`),
      );
    if (!allowed) {
      throw new Error(`Package file is outside the ${targetConfiguration.packageName} allowlist: ${path}.`);
    }
  }

  for (const required of targetConfiguration.requiredPackedFiles) {
    if (!paths.includes(required)) {
      throw new Error(`Package file list is missing required file ${required}.`);
    }
  }
};

export const assertReleaseMetadata = ({
  target,
  version,
  manifest,
  lockfileText,
  changelogText,
}) => {
  if (manifest.name !== target.packageName) {
    throw new Error(`Package name must be ${target.packageName}; received ${manifest.name ?? 'missing'}.`);
  }
  if (manifest.version !== version) {
    throw new Error(`Package version ${manifest.version ?? 'missing'} does not match tag version ${version}.`);
  }
  if (
    manifest.repository?.type !== 'git' ||
    manifest.repository?.url !== REPOSITORY_URL ||
    manifest.repository?.directory !== target.directory
  ) {
    throw new Error(
      `Package repository metadata must exactly match ${REPOSITORY_URL} and ${target.directory}.`,
    );
  }
  assertPublishConfig(manifest.publishConfig);
  assertManifestFiles(target, manifest.files);

  const importer = new RegExp(`^  ${escapeRegExp(target.directory)}:$`, 'mu');
  if (!importer.test(lockfileText)) {
    throw new Error(`Lockfile importer is missing for ${target.directory}.`);
  }

  const changelogVersion = new RegExp(`^## \\[?${escapeRegExp(version)}\\]?(?:\\s|$)`, 'mu');
  if (!changelogVersion.test(changelogText)) {
    throw new Error(`Changelog does not contain a release entry for ${version}.`);
  }

  if (target.workspacePrerequisite) {
    const prerequisite = workspacePackages[target.workspacePrerequisite];
    const dependency = manifest.dependencies?.[prerequisite.packageName]
      ?? (target.bundledWorkspacePrerequisite ? manifest.devDependencies?.[prerequisite.packageName] : undefined);
    if (dependency !== 'workspace:*') {
      throw new Error(
        `${target.packageName} must keep ${prerequisite.packageName} as an explicit workspace release prerequisite.`,
      );
    }
  }
};

export const assertPackedManifest = ({target, version, manifest}) => {
  if (manifest.name !== target.packageName || manifest.version !== version) {
    throw new Error('Packed package name or version differs from the verified source manifest.');
  }
  assertPublishConfig(manifest.publishConfig);
  assertManifestFiles(target, manifest.files);
  const dependencies = Object.values(manifest.dependencies ?? {});
  if (dependencies.some((value) => value === String(value) && value.startsWith('workspace:'))) {
    throw new Error('Packed package still contains a workspace: dependency.');
  }
  if (target.workspacePrerequisite && !target.bundledWorkspacePrerequisite) {
    const prerequisite = releaseTargets[target.workspacePrerequisite];
    if (!manifest.dependencies?.[prerequisite.packageName]) {
      throw new Error(`Packed package is missing ${prerequisite.packageName}.`);
    }
  }
};

// Module-level import and re-export statements, plus dynamic import() calls.
// Bundlers emit static imports one per line, so anchoring them to a line start
// keeps code samples inside string literals from matching.
const PACKED_IMPORT_PATTERNS = [
  /^\s*(?:import|export)\b[^'"\n;]*?\bfrom\s*['"]([^'"]+)['"]/gm,
  /^\s*import\s*['"]([^'"]+)['"]/gm,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const NODE_BUILTINS = new Set(builtinModules);

const packageNameOf = (specifier) => {
  const [first, second] = specifier.split('/');
  return first.startsWith('@') ? `${first}/${second}` : first;
};

/**
 * A packed JavaScript or declaration file that imports a package the packed
 * manifest does not declare breaks for every installer: workspace-only
 * packages such as @slothhub/domain are not on npm. Returns one problem per
 * file and undeclared package.
 */
export const findUndeclaredPackedImports = ({manifest, files}) => {
  const declared = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  const problems = [];
  for (const {path, text} of files) {
    const undeclared = new Set();
    for (const pattern of PACKED_IMPORT_PATTERNS) {
      for (const [, specifier] of text.matchAll(pattern)) {
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue;
        const name = packageNameOf(specifier);
        if (!NODE_BUILTINS.has(name) && !declared.has(name)) undeclared.add(name);
      }
    }
    for (const name of [...undeclared].sort()) problems.push({path, packageName: name});
  }
  return problems;
};

export const assertPackedImportsDeclared = ({manifest, files}) => {
  const problems = findUndeclaredPackedImports({manifest, files});
  if (problems.length > 0) {
    throw new Error(
      `packed_import_undeclared: ${problems.map(({path, packageName}) => `${path} imports ${packageName}`).join('; ')}. ` +
        'Bundle the package into the build output or declare it as a dependency.',
    );
  }
};

export const repositoryUrl = REPOSITORY_URL;
export const npmRegistry = NPM_REGISTRY;
