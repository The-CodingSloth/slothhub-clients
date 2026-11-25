// Release identity of the public client repository. The release library,
// preparation script and workflow are shared with the upstream monorepo,
// which keeps its own copy of this file with publication of these two
// packages disabled.

export const releaseRepository = 'The-CodingSloth/slothhub-clients';
export const releaseRunbook = 'RELEASING.md';

// The domain package is private here: both clients bundle it.
export const workspacePackages = {
  domain: {packageName: '@slothhub/domain', directory: 'packages/domain'},
};

export const releaseTargetConfigurations = {
  cli: {
    key: 'cli',
    packageName: '@slothhub/cli',
    directory: 'packages/sloth-cli',
    environment: 'npm-cli-release',
    tagPrefix: 'npm-cli-v',
    taggedPublicationEnabled: true,
    maxTarballBytes: 5 * 1024 * 1024,
    workspacePrerequisite: 'domain',
    bundledWorkspacePrerequisite: true,
    manifestFiles: ['dist/**/*.js', 'dist/index.d.ts', 'README.md', 'CHANGELOG.md', 'LICENSE'],
    allowedPackedDirectories: ['dist'],
    allowedPackedRootFiles: ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE'],
    requiredPackedFiles: [
      'package.json',
      'README.md',
      'CHANGELOG.md',
      'LICENSE',
      'dist/index.js',
      'dist/index.d.ts',
      'dist/bin/slothhub.js',
    ],
  },
  mcp: {
    key: 'mcp',
    packageName: 'slothhub-mcp-server',
    directory: 'packages/slothhub-mcp-server',
    environment: 'npm-mcp-release',
    tagPrefix: 'npm-mcp-v',
    taggedPublicationEnabled: true,
    maxTarballBytes: 8 * 1024 * 1024,
    workspacePrerequisite: 'domain',
    bundledWorkspacePrerequisite: true,
    // The published server: its bundled entry and bundled declarations. The
    // admin entry and the evaluation fixtures stay in the repository.
    manifestFiles: [
      'dist/index.js',
      'dist/index.d.ts',
      'README.md',
      'CHANGELOG.md',
      'server.json',
      'LICENSE',
    ],
    allowedPackedDirectories: ['dist'],
    allowedPackedRootFiles: ['package.json', 'README.md', 'CHANGELOG.md', 'server.json', 'LICENSE'],
    requiredPackedFiles: [
      'package.json',
      'README.md',
      'CHANGELOG.md',
      'server.json',
      'LICENSE',
      'dist/index.js',
      'dist/index.d.ts',
    ],
  },
};
