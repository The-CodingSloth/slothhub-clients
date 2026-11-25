import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite-plus';
import {libraryBuildCache} from '../../tools/viteTaskCache.mjs';

// The CLI and MCP server bundle these modules; this package is never published.
// Its own unit tests stay upstream; the client suites exercise it here.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  run: {
    tasks: {
      'build:library': {
        command: 'node ../../tools/check-types.mjs ./node_modules/typescript-7/bin/tsc -p tsconfig.build.json',
        cache: libraryBuildCache,
      },
    },
  },
});
