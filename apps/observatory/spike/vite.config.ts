import { defineConfig } from 'vite';
import { seizaViteConfig } from '@seiza/web/vite';

export default defineConfig(
  seizaViteConfig(
    { preload: [] },
    {
      root: import.meta.dirname,
      // The scroll spike's page, the wide-grid spike's (wide.html), and the feed spike's (feed.html).
      build: { rolldownOptions: { input: { index: `${import.meta.dirname}/index.html`, wide: `${import.meta.dirname}/wide.html`, feed: `${import.meta.dirname}/feed.html` } } },
    },
  ),
);
