import { createServer, type Plugin } from 'vite';

export interface PrerenderOptions<M> {
  /** The module that renders the pages, from the app's root
   *  (`/src/view.ts`). It and what it imports must not touch browser
   *  globals at import: it runs in Node. */
  module: string;
  /**
   * The HTML that goes inside the page's root element: `render(module,
   * page)`, with the loaded module and the page's HTML file from the root
   * (`/index.html`, `/tall-table/index.html`), so one module can render
   * every page of a multi-page build.
   */
  render: (module: M, page: string) => string | Promise<string>;
  /** The root element's id; the page's HTML holds it empty
   *  (`<div id="root"></div>`). `root` by default. */
  root?: string;
}

/**
 * Renders each page's first screen into its HTML at build time, and in dev
 * on each request, the module loaded through Vite's own pipeline either way
 * (the dev server's, or a short-lived one per build), so it resolves and
 * transforms as the client's code does and a rebuild never sees a stale
 * copy. The page's entry hydrates it, or binds plain JS to it: the page
 * paints without waiting on JS. The renderer is the app's
 * (`renderToString` for React), so this knows no framework.
 */
export function prerender<M>(options: PrerenderOptions<M>): Plugin {
  const id = options.root ?? 'root';
  const empty = `<div id="${id}"></div>`;
  let root = process.cwd();
  /** This build's module, loaded once for all its pages. */
  let built: Promise<M> | null = null;
  const loadForBuild = async (): Promise<M> => {
    const server = await createServer({ root, configFile: false, logLevel: 'warn', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
    try {
      return (await server.ssrLoadModule(options.module)) as M;
    } finally {
      await server.close();
    }
  };
  return {
    name: 'seiza:prerender',
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      built = null;
    },
    async transformIndexHtml(html, context) {
      if (!html.includes(empty)) throw new Error(`${context.path} has no ${empty} to prerender into`);
      const module = context.server ? ((await context.server.ssrLoadModule(options.module)) as M) : await (built ??= loadForBuild());
      return html.replace(empty, `<div id="${id}">${await options.render(module, context.path)}</div>`);
    },
  };
}
