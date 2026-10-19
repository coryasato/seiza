/** The page's first screen per route, for the build's prerender
 *  (`vite.config.ts`): Node renders it, so the browser never loads this. */

import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { ROUTES } from './components.ts';
import { Page } from './page.ts';

/** The HTML inside a route's root, by its HTML file. */
export function render(html: string): string {
  const route = ROUTES.find((route) => route.html === html);
  if (!route) throw new Error(`no route renders ${html}`);
  return renderToString(h(Page, { path: route.path }));
}
