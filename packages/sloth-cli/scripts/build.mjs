import {domainAliases} from '../../../tools/domainAliases.mjs';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import './clean.mjs';

execFileSync(process.execPath, [
  '../../tools/check-types.mjs', './node_modules/typescript-7/bin/tsc', '-p', 'tsconfig.build.json', '--emitDeclarationOnly',
], {stdio: 'inherit'});
// A separate graph keeps help's small vocabulary out of the shared chunk that
// also owns feed schemas and setup/manifest implementations. In the combined
// graph, --help loaded 1.36 MB of command runtime (2026-10-22 receipt).
await build({
  entryPoints: ['src/cliHelp.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['yaml'],
  outfile: 'dist/cliHelp.js',
  alias: domainAliases('src'),
});
await build({
  entryPoints: ['src/index.ts', 'src/bin/slothhub.ts'],
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  external: ['yaml', 'split2', './cliHelp.js'],
  outdir: 'dist',
  outbase: 'src',
  alias: domainAliases('src'),
});
// Replace tsc's per-module index.d.ts with one self-contained declaration file.
execFileSync(process.execPath, ['./node_modules/vite-plus/bin/vp', 'pack'], {stdio: 'inherit'});
