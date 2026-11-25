import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verificationWorkers} from './verificationWorkers.mjs';

// Keep the native compiler within the same measured allowance as Astro's
// checker. Preserve explicit Go overrides and the compiler's own CLI/exit code.
process.env.GOMAXPROCS ??= String(Math.min(4, verificationWorkers));
const compiler = process.argv[2];
if (!compiler) throw new Error('Supply the workspace TypeScript compiler entry point.');
process.argv.splice(2, 1);
await import(pathToFileURL(resolve(compiler)).href);
