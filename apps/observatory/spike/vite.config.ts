import { defineConfig } from 'vite';
import { seizaViteConfig } from '@seiza/web/vite';

export default defineConfig(seizaViteConfig({ preload: [] }, { root: import.meta.dirname }));
