// Throwaway: live tail's spike pages (gpui.html, dom.html), with the
// contenders' engine path, font, and data (`contenderBuild`). The GPUI
// page's wasm: `tail-run.ts` builds it into pkg/.
import { defineConfig } from 'vite';
import { seizaViteConfig } from '@seiza/web/vite';
import { contenderBuild } from '../../contenders/engine.ts';

const root = import.meta.dirname;
export default defineConfig(
  seizaViteConfig(
    { preload: [] },
    {
      root,
      publicDir: `${root}/../../contenders/tall-table/gpui/web/public`,
      plugins: [contenderBuild('dist')],
      define: { __LEVEL__: JSON.stringify('base') },
      build: { outDir: 'dist', rolldownOptions: { input: { gpui: `${root}/gpui.html`, dom: `${root}/dom.html` } } },
    },
  ),
);
