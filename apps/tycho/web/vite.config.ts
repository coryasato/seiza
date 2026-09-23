import { defineConfig } from 'vite';
import { seizaViteConfig } from '@seiza/web/vite';

export default defineConfig(
  seizaViteConfig({
    // What first paint waits on. DuckDB's bundles load after it and must not be listed here.
    preload: ['tycho_bg.wasm', 'IBMPlexSans-Regular.ttf'],
  }),
);
