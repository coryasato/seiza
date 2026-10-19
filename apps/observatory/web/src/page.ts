/**
 * The observatory's page, one per route, inside the site's shell: the
 * overview at `/observatory/`, and a component's comparison at
 * `/observatory/<component>/`. Prerendered per route at build time
 * (`prerender.ts`) and hydrated by `main.ts`, so it paints before its JS
 * runs. Nothing here touches the browser at import or in a first render:
 * Node renders it. The route is in the HTML (`ROUTE_ATTRIBUTE`), so the
 * client hydrates what the server rendered, whatever URL served it.
 */

import { createElement as h, type ReactNode } from 'react';
import { SiteShell } from '@seiza/site-ui/shell';
import { OBSERVATORY } from '../../contenders/paths.ts';
import { COMPONENTS, type Component } from './components.ts';
import { ComponentNav } from './nav.ts';
import { ContenderSlot } from './slot.ts';

/** The attribute holding the route the HTML was rendered for. */
export const ROUTE_ATTRIBUTE = 'data-route';

export function Page({ path }: { path: string }) {
  const component = COMPONENTS.find((component) => component.path === path);
  return h(
    'div',
    { [ROUTE_ATTRIBUTE]: path, className: 'contents' },
    h(
      SiteShell,
      // `/` once the landing page ships (root docs/DECISIONS.md, "Repo structure").
      { home: OBSERVATORY, links: [{ label: 'Observatory', href: OBSERVATORY, current: true }] },
      h(
        'div',
        { className: 'mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 md:flex-row md:gap-8' },
        h('aside', { className: 'md:w-52 md:shrink-0' }, h(ComponentNav, { path })),
        h('div', { className: 'flex min-w-0 flex-1 flex-col gap-6' }, component ? h(Comparison, { component }) : h(Overview)),
      ),
    ),
  );
}

const heading = (title: string, lead: ReactNode) =>
  h('header', { className: 'flex max-w-3xl flex-col gap-2' }, h('h1', { className: 'text-2xl tracking-tight' }, title), h('p', { className: 'text-muted-foreground' }, lead));

function Overview() {
  return h(
    'div',
    { className: 'flex flex-col gap-6' },
    heading(
      'Observatory',
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
            { href: component.path, className: 'flex h-full flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground transition-colors hover:bg-accent' },
            h('span', { className: 'text-base' }, component.label),
            h('span', { className: 'text-sm text-muted-foreground' }, component.summary),
            h('span', { className: 'mt-auto pt-2 text-sm' }, component.contenders.map((contender) => contender.label).join(' | ')),
          ),
        ),
      ),
    ),
  );
}

function Comparison({ component }: { component: Component }) {
  const [first, second] = component.contenders;
  return h(
    'div',
    { className: 'flex min-h-[560px] flex-1 flex-col gap-6' },
    heading(`${component.label}: ${first.label} | ${second.label}`, `${component.summary} ${first.label} is ${first.stack}; ${second.label} is ${second.stack}. Only the UI differs: the same engine, file, and queries.`),
    h(ContenderSlot, { component }),
  );
}
