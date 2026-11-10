// Throwaway: the monitoring wall's spike pages (gpui.html, dom.html), with
// the contenders' font. The GPUI page's wasm: `wall-run.ts` builds it into pkg/.
import { defineConfig } from 'vite';
import { seizaViteConfig, serveFonts } from '@seiza/web/vite';

const root = import.meta.dirname;
export default defineConfig(
  seizaViteConfig(
    { preload: [] },
    {
      root,
      plugins: [serveFonts()],
      build: { outDir: 'dist', rolldownOptions: { input: { gpui: `${root}/gpui.html`, dom: `${root}/dom.html` } } },
    },
  ),
);
