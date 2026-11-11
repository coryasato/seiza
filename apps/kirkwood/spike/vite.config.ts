// Throwaway: the two-canvas spike's page. Its wasm: `run.ts` builds it into pkg/.
import { defineConfig } from 'vite';
import { seizaViteConfig } from '@seiza/web/vite';

const root = import.meta.dirname;
export default defineConfig(
  seizaViteConfig(
    { preload: ['kirkwood_spike_bg.wasm', 'IBMPlexSans-Regular.ttf'] },
    {
      root,
      build: {
        outDir: 'dist',
        rolldownOptions: {
          output: {
            // Three.js in a chunk of its own, so its bytes are read off the
            // build (`run.ts`), apart from the scene's own code.
            manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : undefined),
          },
        },
      },
    },
  ),
);
