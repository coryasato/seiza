import { defineConfig } from 'vite';
import { seizaViteConfig } from '@seiza/web/vite';

export default defineConfig(
  seizaViteConfig(
    { preload: [] },
    {
      root: import.meta.dirname,
      // The scroll spike's page, and the wide-grid spike's (wide.html).
      build: { rolldownOptions: { input: { index: `${import.meta.dirname}/index.html`, wide: `${import.meta.dirname}/wide.html` } } },
    },
  ),
);
