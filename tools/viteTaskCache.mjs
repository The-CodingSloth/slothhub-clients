// Task-cache inputs for the package builds and checks. A cached task reruns
// when any package source, shared tool, manifest or the lockfile changes.
const sourceInputs = [
  '**/*',
  '**/.*',
  '**/.*/**',
  '!**/node_modules/**',
  '!**/dist/**',
  '!**/.vitest/**',
  '!**/coverage/**',
  '!**/*.tsbuildinfo',
  '!.git',
  '!.git/**',
];

/** @type {'workspace'} */
const workspaceBase = 'workspace';
const sharedInputs = [
  'package.json',
  'packages/domain/package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.node-version',
  'vite.config.mts',
  'tools/viteTaskCache.mjs',
  'tools/verificationWorkers.mjs',
  'tools/check-types.mjs',
  'tools/domainAliases.mjs',
  'tools/publicDeclarations.mjs',
  'patches/**',
].map((pattern) => ({pattern, base: workspaceBase}));

export const packageCheckCache = {
  input: [
    ...sourceInputs,
    ...sharedInputs,
    {pattern: 'packages/domain/dist/**/*.d.ts', base: workspaceBase},
  ],
  output: [],
  env: ['NODE_OPTIONS', 'NODE_ENV', 'CI', 'GOMAXPROCS'],
};

export const libraryBuildCache = {
  input: [
    ...sourceInputs,
    ...sharedInputs,
    {pattern: 'packages/domain/src/**', base: workspaceBase},
  ],
  output: ['dist/**'],
  env: ['NODE_OPTIONS', 'NODE_ENV', 'CI', 'GOMAXPROCS'],
};
