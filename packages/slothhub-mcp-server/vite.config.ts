import {domainAliases} from '../../tools/domainAliases.mjs';
import {publicDeclarationPack} from '../../tools/publicDeclarations.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vite-plus';
import {libraryBuildCache, packageCheckCache} from '../../tools/viteTaskCache.mjs';
import {verificationWorkers} from '../../tools/verificationWorkers.mjs';

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const nativeTests = ['**/*.node.test.ts'];

export default defineConfig({
  pack: publicDeclarationPack({neverBundle: [/^@modelcontextprotocol\/server(\/|$)/, 'yaml', 'zod']}),
  root: packageDirectory,
  run: {
    tasks: {
      'test:all': {
        command: 'vp test run --config vite.built.config.ts',
        dependsOn: ['build:library'],
        cache: false,
      },
      'build:library': {
        command: 'node scripts/clean-dist.mjs && node ../../tools/check-types.mjs ./node_modules/typescript-7/bin/tsc -p tsconfig.build.json --emitDeclarationOnly && esbuild src/index.ts --bundle --platform=node --format=esm --external:yaml --outdir=dist --outbase=src --alias:@slothhub/domain/agent-interface=../domain/src/agentInterface.ts --alias:@slothhub/domain/resource-kind=../domain/src/resourceKind.ts --alias:@slothhub/domain/security-capability=../domain/src/securityCapability.ts --external:@modelcontextprotocol/server --external:@modelcontextprotocol/server/* --external:zod && vp pack',
        dependsOn: ['@slothhub/domain#build:library'],
        cache: libraryBuildCache,
      },
      'check:types': {
        command: [],
        dependsOn: ['check:compiler', 'check:lint'],
        cache: false,
      },
      'check:compiler': {
        // The native compiler owns invalidation, including new test files.
        command: 'node ../../tools/check-types.mjs ./node_modules/typescript-7/bin/tsc --noEmit --incremental --tsBuildInfoFile node_modules/.cache/slothhub-check/mcp.tsbuildinfo',
        dependsOn: ['@slothhub/domain#build:library'],
        cache: packageCheckCache,
      },
      'check:lint': {
        command: `node ../../tools/check-types.mjs ./node_modules/vite-plus/bin/vp lint src --type-aware --threads=${verificationWorkers}`,
        dependsOn: ['@slothhub/domain#build:library'],
        cache: packageCheckCache,
      },
      'check:combined': {command: 'vp run check:types', cache: false},
    },
  },
  test: {
    // Random file and test order flushes out leaked state; failures print the
    // seed to reproduce. Rules: AGENTS.md, "Leave no state behind".
    sequence: {shuffle: true},
    name: 'mcp',
    injectCjsGlobals: false,
    provide: {builtArtifactsReady: false},
    maxWorkers: verificationWorkers,
    fsModuleCache: true,
    fsModuleCachePath: path.join(packageDirectory, 'node_modules/.vitest-cache'),
    vmMemoryLimit: '1GiB',
    projects: [
      {extends: true, test: {
        name: 'mcp-pure', pool: 'vmForks', isolate: true,
        include: configDefaults.include,
        exclude: [...configDefaults.exclude, ...nativeTests],
      }},
      {extends: true, test: {
        name: 'mcp-native', pool: 'forks', isolate: true,
        include: nativeTests, exclude: configDefaults.exclude,
      }},
    ],
    // Real SDK protocol cases took up to 7.8 s on the shared host on
    // 2026-10-22. Match the existing built-CLI subprocess guard, leaving
    // production deadlines and each fault fixture's timer unchanged.
    testTimeout: 30_000,
  },
  resolve: {
    alias: domainAliases('src'),
  },
});
