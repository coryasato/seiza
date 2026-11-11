// Throwaway: the two-canvas spike's page. Its wasm: `run.ts` builds it into pkg/.
import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { seizaViteConfig } from '@seiza/web/vite';

const root = import.meta.dirname;

/** The elements file where data/prep.ts wrote it, at /data/elements.bin, as
 *  it is: the one file of data/ the page reads (never data/raw/). */
function serveElements(): Plugin {
  const file = join(root, '../data/elements.bin');
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url?.split('?')[0] !== '/data/elements.bin') return next();
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('no data/elements.bin: run data/prep.ts');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  };
  return { name: 'kirkwood-spike:elements', enforce: 'pre', configureServer: (server) => void server.middlewares.use(serve), configurePreviewServer: (server) => void server.middlewares.use(serve) };
}
export default defineConfig(
  seizaViteConfig(
    { preload: ['kirkwood_spike_bg.wasm', 'IBMPlexSans-Regular.ttf'] },
    {
      root,
      plugins: [serveElements()],
      build: {
        outDir: 'dist',
        rolldownOptions: {
          output: {
            // Three.js in a chunk of its own, so its bytes are read off the
            // build (`run.ts`), apart from the scene's own code.
            // Its add-ons (the look's bloom) in another, for the same reason.
            manualChunks: (id: string) => (id.includes('node_modules/three/examples') ? 'three-addons' : id.includes('node_modules/three') ? 'three' : undefined),
          },
        },
      },
    },
  ),
);
