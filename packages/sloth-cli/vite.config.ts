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
  pack: publicDeclarationPack({neverBundle: ['split2', 'yaml', 'zod']}),
  root: packageDirectory,
  run: {
    tasks: {
      'test:all': {
        command: 'vp test run --config vite.built.config.ts',
        dependsOn: ['build:library'],
        cache: false,
      },
      // Cache restoration does not remove obsolete hashed chunks.
      'build:clean': {command: 'node scripts/clean.mjs', cache: false},
      'build:library': {
        command: 'node scripts/build.mjs',
        dependsOn: ['@slothhub/domain#build:library', 'build:clean'],
        cache: libraryBuildCache,
      },
      'check:types': {
        command: `node ../../tools/check-types.mjs ./node_modules/vite-plus/bin/vp lint src --type-aware --type-check --threads=${verificationWorkers}`,
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
    name: 'cli',
    injectCjsGlobals: false,
    provide: {builtArtifactsReady: false},
    maxWorkers: verificationWorkers,
    // Vitest 5 reuses transforms across runs while retaining per-file isolation.
    fsModuleCache: true,
    fsModuleCachePath: path.join(packageDirectory, 'node_modules/.vitest-cache'),
    vmMemoryLimit: '1GiB',
    projects: [
      {extends: true, test: {
        name: 'cli-pure', pool: 'vmForks', isolate: true,
        include: configDefaults.include,
        exclude: [...configDefaults.exclude, ...nativeTests],
      }},
      {extends: true, test: {
        name: 'cli-native', pool: 'forks', isolate: true,
        include: nativeTests, exclude: configDefaults.exclude,
      }},
    ],
  },
  resolve: {
    alias: domainAliases('src'),
  },
});
