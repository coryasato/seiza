import { defineConfig } from 'vite';
import { seizaViteConfig } from '@seiza/web/vite';

// The bare host is never deployed: no placeholder shell (its first paint
// isn't what it measures), no base path.
export default defineConfig(
  seizaViteConfig({
    // What first paint waits on: the host's wasm and the UI font.
    preload: ['tall_table_host_bg.wasm', 'IBMPlexSans-Regular.ttf'],
  }),
);
