/**
 * The observatory's page, one per route, below the site's bar: the
 * overview at `/observatory/`, and a component's comparison at
 * `/observatory/<component>/`, each in the same dashboard (`docs/
 * DECISIONS.md`, "Page"): the sidebar flush with the window's left edge,
 * and the content in an inset card whose header holds the sidebar's toggle
 * and the page's title. Prerendered per route at build time
 * (`prerender.ts`) and hydrated by `main.ts`, so it paints before its JS
 * runs. Nothing here touches the browser at import or in a first render:
 * Node renders it. The route is in the HTML (`ROUTE_ATTRIBUTE`), so the
 * client hydrates what the server rendered, whatever URL served it.
 */

import { PanelLeft } from 'lucide-react';
import { createElement as h, lazy, Suspense, useEffect, useState } from 'react';
import { buttonVariants } from '@seiza/site-ui/components/button';
import { SOURCE } from '@seiza/site-ui/components/footer';
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuLink } from '@seiza/site-ui/components/sidebar';
import { SiteShell } from '@seiza/site-ui/shell';
import { OBSERVATORY } from '../../contenders/paths.ts';
import { COMPONENTS, type Component } from './components.ts';
import { bindSidebar, SIDEBAR_SCRIM, SIDEBAR_TOGGLE } from './sidebar.ts';
import { afterFirstPaint } from './paint.ts';
import { ContenderSlot, seriesDot } from './slot.ts';

/** The attribute holding the route the HTML was rendered for. */
export const ROUTE_ATTRIBUTE = 'data-route';

const SIDEBAR_ID = 'observatory-sidebar';

export function Page({ path }: { path: string }) {
  const component = COMPONENTS.find((component) => component.path === path);
  useEffect(() => bindSidebar(), []);
  return h(
    'div',
    { [ROUTE_ATTRIBUTE]: path, className: 'contents' },
    h(
      SiteShell,
      // `/` once the landing page ships (root docs/DECISIONS.md, "Repo structure").
      { home: OBSERVATORY, links: [{ label: 'Observatory', href: OBSERVATORY, current: true }], footer: false },
      h(
        'div',
        { className: 'relative flex flex-1 bg-sidebar' },
        h('button', { type: 'button', [SIDEBAR_SCRIM]: '', 'aria-label': 'Close the sidebar', tabIndex: -1, className: 'observatory-scrim' }),
        h(Sidebar, { path }),
        h(
          'div',
          { className: 'observatory-inset flex min-w-0 flex-1 flex-col bg-background' },
          component ? h(Comparison, { component }) : h(Overview),
        ),
      ),
    ),
  );
}

function Sidebar({ path }: { path: string }) {
  const link = (href: string, label: string) =>
    h(SidebarMenuItem, { key: href }, h(SidebarMenuLink, { href, isActive: path === href }, label));
  return h(
    'aside',
    { id: SIDEBAR_ID, className: 'observatory-sidebar flex-col overflow-y-auto bg-sidebar p-1 text-sidebar-foreground', 'aria-label': 'Observatory' },
    h(SidebarGroup, null, h(SidebarGroupLabel, null, 'Observatory'), h('nav', { 'aria-label': 'Observatory' }, h(SidebarMenu, null, link(OBSERVATORY, 'Overview')))),
    h(
      SidebarGroup,
      null,
      h(SidebarGroupLabel, null, 'Components'),
      h('nav', { 'aria-label': 'Components' }, h(SidebarMenu, null, ...COMPONENTS.map((component) => link(component.path, component.label)))),
    ),
    h(
      SidebarGroup,
      { className: 'mt-auto' },
      h(SidebarMenu, null, h(SidebarMenuItem, null, h(SidebarMenuLink, { href: SOURCE, className: 'text-muted-foreground' }, 'Source on GitHub'))),
    ),
  );
}

/** The inset's header: the sidebar's toggle, a divider, the page's title. */
function InsetHeader({ title }: { title: string }) {
  return h(
    'header',
    { className: 'flex h-12 shrink-0 items-center gap-2 border-b px-3' },
    h(
      'button',
      // `aria-expanded` and the label follow the state from `bindSidebar`:
      // the HTML can't know it.
      { type: 'button', [SIDEBAR_TOGGLE]: '', 'aria-controls': SIDEBAR_ID, 'aria-label': 'Toggle the sidebar', className: buttonVariants({ variant: 'ghost', size: 'icon' }) },
      h(PanelLeft, { 'aria-hidden': true }),
    ),
    h('span', { className: 'h-4 w-px bg-border', 'aria-hidden': true }),
    h('h1', { className: 'text-sm' }, title),
  );
}

function Overview() {
  return h(
    'div',
    { className: 'flex flex-1 flex-col' },
    h(InsetHeader, { title: 'Overview' }),
    h(
      'main',
      { className: 'flex flex-col gap-4 px-4 pt-5 pb-6 md:px-6' },
      h(
        'p',
        { className: 'max-w-[80ch] text-muted-foreground' },
        'Each component here, drawn by the GPU from WebAssembly, runs against a DOM equivalent on the same engine and data, one at a time, measured over a session of use: opening data, scrolling, flinging, jumping.',
      ),
      h(
        'ul',
        { className: 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' },
        ...COMPONENTS.map((component) =>
          h(
            'li',
            { key: component.id },
            h(
              'a',
              { href: component.path, className: 'flex h-full flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-xs transition-colors hover:bg-muted' },
              h('span', { className: 'text-base' }, component.label),
              h('span', { className: 'text-sm text-muted-foreground' }, component.summary),
              h(
                'span',
                { className: 'mt-auto flex items-center gap-3 pt-2 text-sm' },
                ...component.contenders.map((contender) => h('span', { key: contender.side, className: 'inline-flex items-center gap-1.5' }, seriesDot(contender.side), contender.label)),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

/** The description below the window (`numbers.ts`, with the numbers it
 *  draws its words from): rendered after the page's first paint, as the
 *  frame is: below the fold, it would only delay it (root CLAUDE.md, rule 1). */
const Description = lazy(() => import('./numbers.ts').then(({ Description }) => ({ default: Description })));

function DescriptionSlot({ contenders }: { contenders: Component['contenders'] }) {
  const [painted, setPainted] = useState(false);
  useEffect(() => afterFirstPaint(() => setPainted(true)), []);
  return h('div', { 'data-numbers': '' }, painted ? h(Suspense, { fallback: null }, h(Description, { contenders })) : null);
}

function Comparison({ component }: { component: Component }) {
  const [first, second] = component.contenders;
  return h(
    'div',
    { className: 'flex flex-col' },
    h(InsetHeader, { title: `${component.label}: ${first.label} | ${second.label}` }),
    h(
      'main',
      { className: 'flex flex-col' },
      // The contender's window fills the first screen down to the window's
      // bottom edge, its frame at least 480 px (`page.css`).
      h('div', { className: 'observatory-first-screen flex flex-col pb-4 md:px-3 md:pt-3' }, h(ContenderSlot, { component })),
      h(DescriptionSlot, { contenders: component.contenders }),
    ),
  );
}
