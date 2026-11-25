import {defineConfig} from 'vite-plus';

// Package tasks (build:library, test:all) live in each package's vite.config.ts.
export default defineConfig({
  run: {cache: {scripts: false, tasks: true}},
});
