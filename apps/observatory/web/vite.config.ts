import { defineConfig } from 'vite';
import { seizaViteConfig } from '@seiza/web/vite';

// Served under /observatory/ everywhere (CLAUDE.md, rule 2). Nothing to
// preload yet: the page is static until its contenders exist.
export default defineConfig(seizaViteConfig({ preload: [] }, { base: '/observatory/' }));
