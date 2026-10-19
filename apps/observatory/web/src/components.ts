/**
 * The components the observatory compares, each with its contenders: the
 * page's list (its nav, its routes, its frames). A contender is only a
 * name, a label, and a URL here: its page is a bare build of its own,
 * fetched when its frame is created (root `CLAUDE.md`, "Comparison
 * protocol"), never part of this bundle.
 */

import type { Side } from '../../contenders/contract.ts';
import { contenderBase, OBSERVATORY } from '../../contenders/paths.ts';

export interface Contender {
  side: Side;
  /** What the comparison calls it: GPUI | TanStack. */
  label: string;
  /** Its stack, in a few words. */
  stack: string;
  /** Its bare page. */
  url: string;
}

export interface Component {
  id: string;
  label: string;
  /** The component's page: `/observatory/<id>/`. */
  path: string;
  /** One line: what the comparison runs. */
  summary: string;
  contenders: [Contender, Contender];
}

export const COMPONENTS: Component[] = [
  {
    id: 'tall-table',
    label: 'Tall table',
    path: `${OBSERVATORY}tall-table/`,
    summary: 'Every one of the 1.57 M known asteroids in one table, read a page at a time through DuckDB-Wasm.',
    contenders: [
      { side: 'gpui', label: 'GPUI', stack: 'the tall table, drawn by GPUI on a canvas from WebAssembly', url: contenderBase('tall-table', 'gpui') },
      { side: 'tanstack', label: 'TanStack', stack: 'React and TanStack Virtual in the DOM', url: contenderBase('tall-table', 'tanstack') },
    ],
  },
];

/** Every route the build prerenders: its path, and its HTML file from the
 *  web root (Vite's multi-page input). */
export const ROUTES: { path: string; html: string }[] = [
  { path: OBSERVATORY, html: '/index.html' },
  ...COMPONENTS.map((component) => ({ path: component.path, html: `/${component.id}/index.html` })),
];

/** The URL parameter naming the side that loads first (`?side=tanstack`);
 *  GPUI without it. */
export const SIDE_PARAM = 'side';
