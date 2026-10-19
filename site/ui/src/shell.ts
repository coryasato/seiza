/**
 * The site's shell: the navbar above a page's content, the footer below.
 * React, rendered to HTML at build time (a page's prerender), so the shell
 * never waits on JS; its behaviors are plain JS. A page with React gets
 * them from the components' effects as it hydrates; a page without React
 * (the landing page) calls `bindShell` once its HTML is in.
 */

import { createElement as h, type ReactNode } from 'react';
import { Footer } from './components/footer.ts';
import { Navbar, THEME_TOGGLE, type NavLink } from './components/navbar.ts';
import { bindThemeToggle } from './theme.ts';

export type { NavLink };

export interface SiteShellProps {
  /** Where the site's name links: `/` once the landing page ships. */
  home: string;
  links: NavLink[];
  children?: ReactNode;
}

export function SiteShell({ home, links, children }: SiteShellProps) {
  return h('div', { className: 'flex min-h-svh flex-col' }, h(Navbar, { home, links }), h('main', { className: 'flex flex-1 flex-col' }, children), h(Footer));
}

/** Binds the shell's behaviors in `root`'s markup, for a page without React. */
export function bindShell(root: ParentNode = document): void {
  for (const toggle of root.querySelectorAll<HTMLElement>(`[${THEME_TOGGLE}]`)) bindThemeToggle(toggle);
}
