/**
 * The observatory's own navigation, inside the site's shell: the components
 * it compares, in a collapsible list. The active entry follows the
 * contrast rules (`site/ui`'s tokens): `--primary` behind
 * `--primary-foreground` in light, `--sidebar-primary` text in dark.
 */

import { ChevronDown } from 'lucide-react';
import { createElement as h } from 'react';
import { cn } from '@seiza/site-ui/cn';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@seiza/site-ui/components/collapsible';
import { OBSERVATORY } from '../../contenders/paths.ts';
import { COMPONENTS } from './components.ts';

const item = (current: boolean) =>
  cn(
    'block rounded-md px-2 py-1.5 text-sm transition-colors',
    current
      ? 'bg-primary text-primary-foreground dark:bg-sidebar-accent dark:text-sidebar-primary'
      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
  );

export function ComponentNav({ path }: { path: string }) {
  return h(
    'nav',
    { className: 'flex flex-col gap-1', 'aria-label': 'Observatory' },
    h('a', { href: OBSERVATORY, className: item(path === OBSERVATORY), 'aria-current': path === OBSERVATORY ? 'page' : undefined }, 'Overview'),
    h(
      Collapsible,
      { defaultOpen: true },
      h(
        CollapsibleTrigger,
        { className: 'group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50' },
        'Components',
        h(ChevronDown, { className: 'size-4 transition-transform group-data-[panel-open]:rotate-180', 'aria-hidden': true }),
      ),
      h(
        CollapsibleContent,
        { className: 'flex flex-col gap-1 pt-1' },
        ...COMPONENTS.map((component) =>
          h('a', { key: component.id, href: component.path, className: item(path === component.path), 'aria-current': path === component.path ? 'page' : undefined }, component.label),
        ),
      ),
    ),
  );
}
