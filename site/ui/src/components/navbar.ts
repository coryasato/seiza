/**
 * The site's top bar: the site's name, the sections, and the theme toggle.
 * Rendered to HTML at build time; its one behavior, the toggle, is plain JS
 * (`theme.ts`), which `ThemeToggle` binds in an effect, and `bindShell` on a
 * page without React.
 */

import { Moon, Sun } from 'lucide-react';
import { createElement as h, useEffect, useRef } from 'react';
import { cn } from '../cn.ts';
import { bindThemeToggle } from '../theme.ts';
import { buttonVariants } from './button.ts';

/** The attribute `bindShell` finds the toggle by. */
export const THEME_TOGGLE = 'data-site-theme-toggle';

export interface NavLink {
  label: string;
  href: string;
  /** The section the page is in. */
  current?: boolean;
}

/** Shows the icon of the theme a press switches to; both are in the HTML,
 *  so the markup is the same in either theme and the CSS picks. */
export function ThemeToggle() {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => bindThemeToggle(ref.current!), []);
  return h(
    'button',
    { ref, type: 'button', [THEME_TOGGLE]: '', 'aria-label': 'Toggle the theme', className: cn(buttonVariants({ variant: 'ghost', size: 'icon-lg' }), '[&_svg]:size-[18px]') },
    h(Moon, { className: 'dark:hidden', 'aria-hidden': true }),
    h(Sun, { className: 'hidden dark:block', 'aria-hidden': true }),
  );
}

/** The bar spans the window, its contents too (no max-width), and holds
 *  nothing a page adds, so nothing in it moves between pages (root
 *  `docs/DECISIONS.md`, "Repo structure": the apex site's layout). */
export function Navbar({ home, links }: { home: string; links: NavLink[] }) {
  return h(
    'header',
    { className: 'sticky top-0 z-40 h-(--site-bar) border-b bg-background' },
    h(
      'div',
      { className: 'flex h-full items-center gap-2 px-4' },
      h('a', { href: home, className: 'flex items-baseline gap-2 px-1 text-base tracking-tight' }, 'seiza', h('span', { className: 'text-muted-foreground', lang: 'ja' }, '星座')),
      h(
        'nav',
        { className: 'flex items-center gap-1 text-sm', 'aria-label': 'Site' },
        ...links.map(({ label, href, current }) =>
          h(
            'a',
            {
              key: href,
              href,
              'aria-current': current ? 'page' : undefined,
              className: cn('rounded-md px-2 py-1 transition-colors hover:text-foreground', current ? 'text-foreground' : 'text-muted-foreground'),
            },
            label,
          ),
        ),
      ),
      h('div', { className: 'ml-auto flex items-center gap-1' }, h(ThemeToggle)),
    ),
  );
}
