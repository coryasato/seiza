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
    { ref, type: 'button', [THEME_TOGGLE]: '', 'aria-label': 'Toggle the theme', className: buttonVariants({ variant: 'ghost', size: 'icon-sm' }) },
    h(Moon, { className: 'dark:hidden', 'aria-hidden': true }),
    h(Sun, { className: 'hidden dark:block', 'aria-hidden': true }),
  );
}

export function Navbar({ home, links }: { home: string; links: NavLink[] }) {
  return h(
    'header',
    { className: 'sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80' },
    h(
      'div',
      { className: 'mx-auto flex h-14 max-w-screen-2xl items-center gap-6 px-4 sm:px-6' },
      h('a', { href: home, className: 'flex items-baseline gap-2 text-base tracking-tight' }, 'seiza', h('span', { className: 'text-muted-foreground', lang: 'ja' }, '星座')),
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
