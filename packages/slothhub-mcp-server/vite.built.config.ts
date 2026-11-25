import {defineConfig, mergeConfig} from 'vite-plus';
import config from './vite.config';

// The task graph completes build:library before selecting this configuration.
export default defineConfig(mergeConfig(config, {
  test: {provide: {builtArtifactsReady: true}},
}));
