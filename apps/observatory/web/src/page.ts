/**
 * The observatory's page, one per route, below the site's bar
 * (`components.ts`, `ROUTES`): the Overview at `/observatory/`, a
 * component's page at `/observatory/<component>/`, and a scenario's
 * comparison at `/observatory/<component>/<scenario>/`, each in the same
 * dashboard (`docs/DECISIONS.md`, "Page"): the sidebar flush with the
 * window's left edge, and the content in an inset card whose header holds
 * the sidebar's toggle and the crumb. Prerendered per route at build time
 * (`prerender.ts`) and hydrated by `main.ts`, so it paints before its JS
 * runs. Nothing here touches the browser at import or in a first render:
 * Node renders it. The route is in the HTML (`ROUTE_ATTRIBUTE`), so the
 * client hydrates what the server rendered, whatever URL served it.
 */

import { Check, ChevronDown, ChevronRight, PanelLeft } from 'lucide-react';
import { createElement as h, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { buttonVariants } from '@seiza/site-ui/components/button';
import { SOURCE } from '@seiza/site-ui/components/footer';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuItem,
  SidebarMenuLink,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubLink,
} from '@seiza/site-ui/components/sidebar';
import { SiteShell } from '@seiza/site-ui/shell';
import { OBSERVATORY } from '../../contenders/paths.ts';
import type { Scenario } from '../../contenders/scenarios.ts';
import { COMPONENTS, hasCold, routeAt, scenarioPath, SIDE_PARAM, type Component, type Route } from './components.ts';
import { Explainer } from './explainer.ts';
import { bindSidebar, SIDEBAR_SCRIM, SIDEBAR_TOGGLE } from './sidebar.ts';
import { afterFirstPaint } from './paint.ts';
import { ContenderSlot, seriesDot } from './slot.ts';

/** The attribute holding the route the HTML was rendered for. */
export const ROUTE_ATTRIBUTE = 'data-route';
/** A link to a scenario from a scenario's route, which carries `?side=` (`carrySide`). */
export const SCENARIO_LINK = 'data-scenario-link';

const SIDEBAR_ID = 'observatory-sidebar';

export function Page({ path }: { path: string }) {
  const route = routeAt(path);
  useEffect(() => bindSidebar(), []);
  useEffect(() => (route.kind === 'scenario' ? carrySide() : undefined), [route]);
  return h(
    'div',
    { [ROUTE_ATTRIBUTE]: route.path, className: 'contents' },
    h(
      SiteShell,
      // `/` once the landing page ships (root docs/DECISIONS.md, "Repo structure").
      { home: OBSERVATORY, links: [{ label: 'Observatory', href: OBSERVATORY, current: true }], footer: false },
      h(
        'div',
        { className: 'relative flex flex-1 bg-sidebar' },
        h('button', { type: 'button', [SIDEBAR_SCRIM]: '', 'aria-label': 'Close the sidebar', tabIndex: -1, className: 'observatory-scrim' }),
        h(Sidebar, { route }),
        h(
          'div',
          { className: 'observatory-inset flex min-w-0 flex-1 flex-col bg-background' },
          route.kind === 'scenario' ? h(Comparison, { component: route.component, scenario: route.scenario }) : route.kind === 'component' ? h(ComponentPage, { component: route.component }) : h(Overview),
        ),
      ),
    ),
  );
}

/**
 * A scenario's route passes its side on to the scenario a link opens (a
 * stop stays behind: each scenario has its own), read at the press, since
 * a flip changes it (`slot.ts`). The component's page takes no parameter
 * and passes none on.
 */
function carrySide(): () => void {
  const press = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.(`a[${SCENARIO_LINK}]`) as HTMLAnchorElement | null;
    if (!link) return;
    const side = new URLSearchParams(location.search).get(SIDE_PARAM);
    // Set or cleared each time: an earlier press may have left a side on it.
    const url = new URL(link.href);
    if (side) url.searchParams.set(SIDE_PARAM, side);
    else url.searchParams.delete(SIDE_PARAM);
    link.href = url.href;
  };
  // Capture, so the href is set before the browser follows it (a middle press too).
  document.addEventListener('click', press, true);
  document.addEventListener('auxclick', press, true);
  return () => {
    document.removeEventListener('click', press, true);
    document.removeEventListener('auxclick', press, true);
  };
}

/** The item filled in the sidebar: one at a time, every other one muted
 *  (`docs/DECISIONS.md`, "Page", 2026-11-02). */
const itemClass = (active: boolean) => (active ? '' : 'text-muted-foreground');

function Sidebar({ route }: { route: Route }) {
  const link = (href: string, label: string) =>
    h(SidebarMenuItem, { key: href }, h(SidebarMenuLink, { href, isActive: route.path === href, className: itemClass(route.path === href) }, label));
  return h(
    'aside',
    { id: SIDEBAR_ID, className: 'observatory-sidebar flex-col overflow-y-auto bg-sidebar p-1 text-sidebar-foreground', 'aria-label': 'Observatory' },
    h(SidebarGroup, null, h(SidebarGroupLabel, null, 'Observatory'), h('nav', { 'aria-label': 'Observatory' }, h(SidebarMenu, null, link(OBSERVATORY, 'Overview')))),
    h(
      SidebarGroup,
      null,
      h(SidebarGroupLabel, null, 'Components'),
      h('nav', { 'aria-label': 'Components' }, h(SidebarMenu, null, ...COMPONENTS.map((component) => h(ComponentItem, { key: component.id, component, route })))),
    ),
    h(
      SidebarGroup,
      { className: 'mt-auto' },
      h(SidebarMenu, null, h(SidebarMenuItem, null, h(SidebarMenuLink, { href: SOURCE, className: 'text-muted-foreground' }, 'Source on GitHub'))),
    ),
  );
}

/**
 * A component's row: its page's link, and a chevron opening its
 * scenarios' list, open on its own routes and closed elsewhere (shadcn's
 * sub-menu, collapsible). The list is in the HTML either way, `hidden`
 * when closed, so the chevron's state is one attribute: a disclosure of
 * its own rather than Base UI's Collapsible, whose code would be +2.6 KiB
 * brotli of first-paint JS (measured building the page with it).
 */
function ComponentItem({ component, route }: { component: Component; route: Route }) {
  const own = route.kind !== 'overview' && route.component === component;
  const [open, setOpen] = useState(own);
  const listId = `${SIDEBAR_ID}-${component.id}`;
  const onPage = route.path === component.path;
  return h(
    SidebarMenuItem,
    null,
    h(SidebarMenuLink, { href: component.path, isActive: onPage, className: itemClass(onPage) }, component.label),
    h(
      SidebarMenuAction,
      { 'aria-label': `${component.label}’s scenarios`, 'aria-controls': listId, 'aria-expanded': open, onClick: () => setOpen(!open), className: 'aria-expanded:[&>svg]:rotate-90 [&>svg]:transition-transform' },
      h(ChevronRight, { 'aria-hidden': true }),
    ),
    h(
      SidebarMenuSub,
      { id: listId, hidden: !open, 'aria-label': `${component.label}’s scenarios` },
      ...component.scenarios.map((scenario) => {
        const href = scenarioPath(component, scenario);
        const active = route.path === href;
        return h(SidebarMenuSubItem, { key: scenario.id }, h(SidebarMenuSubLink, { href, isActive: active, className: itemClass(active), ...{ [SCENARIO_LINK]: '' } }, scenario.label));
      }),
    ),
  );
}

/** The inset's header: the sidebar's toggle, a divider, the crumb. */
function InsetHeader({ children }: { children: ReactNode }) {
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
    children,
  );
}

const title = (text: string) => h('h1', { className: 'text-sm' }, text);

/**
 * A scenario's crumb, "TallTable / Wide sheet": the component's page
 * linked, then the scenario's name as a menu of every scenario's link, its
 * use under it (the names alone on a phone), the current one checked.
 */
function ScenarioCrumb({ component, scenario }: { component: Component; scenario: Scenario }) {
  return h(
    'nav',
    { 'aria-label': 'Breadcrumb', className: 'flex min-w-0 items-center gap-1.5 text-sm' },
    h('a', { href: component.path, className: 'text-muted-foreground hover:text-foreground' }, component.label),
    h('span', { className: 'text-muted-foreground', 'aria-hidden': true }, '/'),
    h(
      'h1',
      { className: 'min-w-0' },
      h(
        Explainer,
        {
          menu: true,
          width: 360,
          trigger: h('span', { className: 'flex min-w-0 items-center gap-1' }, h('span', { className: 'truncate' }, scenario.label), h(ChevronDown, { 'aria-hidden': true, className: 'size-3.5 shrink-0 text-muted-foreground' })),
          triggerProps: { 'aria-label': `${scenario.label}: pick a scenario`, 'data-crumb-menu': '', className: '-mx-1.5 flex h-7 min-w-0 items-center rounded-md px-1.5 hover:bg-accent aria-expanded:bg-accent' },
        },
        ...component.scenarios.map((other) => {
          const current = other === scenario;
          return h(
            'a',
            {
              key: other.id,
              role: 'menuitemradio',
              'aria-checked': current,
              href: scenarioPath(component, other),
              [SCENARIO_LINK]: '',
              className: 'flex min-h-9 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent max-md:min-h-11 max-md:items-center',
            },
            h('span', { className: `mt-0.5 flex size-4 shrink-0 items-center justify-center max-md:mt-0 ${current ? '' : 'invisible'}`, 'aria-hidden': true }, h(Check, { className: 'size-4' })),
            h('span', { className: 'flex min-w-0 flex-col' }, h('span', { className: 'text-sm' }, other.label), h('span', { className: 'text-xs text-muted-foreground max-md:hidden' }, other.use)),
          );
        }),
      ),
    ),
  );
}

function Overview() {
  return h(
    'div',
    { className: 'flex flex-1 flex-col' },
    h(InsetHeader, null, title('Overview')),
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
              { href: component.path, className: CARD },
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

const CARD = 'flex h-full flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-xs transition-colors hover:bg-muted';

/** The component's page: its name, its line, and its scenarios as cards. */
function ComponentPage({ component }: { component: Component }) {
  return h(
    'div',
    { className: 'flex flex-1 flex-col' },
    h(InsetHeader, null, title(component.label)),
    h(
      'main',
      { className: 'flex flex-col gap-4 px-4 pt-5 pb-6 md:px-6' },
      h('header', { className: 'flex flex-col gap-1' }, h('h2', { className: 'text-xl' }, component.label), h('p', { className: 'max-w-[80ch] text-muted-foreground' }, component.summary)),
      h(
        'ul',
        { 'aria-label': 'Scenarios', className: 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3' },
        ...component.scenarios.map((scenario) =>
          h(
            'li',
            { key: scenario.id },
            h('a', { href: scenarioPath(component, scenario), className: CARD }, h('span', { className: 'text-base' }, scenario.label), h('span', { className: 'text-sm text-muted-foreground' }, scenario.use)),
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

function DescriptionSlot({ component, scenario }: { component: Component; scenario: Scenario }) {
  const [painted, setPainted] = useState(false);
  useEffect(() => afterFirstPaint(() => setPainted(true)), []);
  const shown = painted && hasCold(scenario);
  return h('div', { 'data-numbers': '' }, shown ? h(Suspense, { fallback: null }, h(Description, { contenders: component.contenders })) : null);
}

function Comparison({ component, scenario }: { component: Component; scenario: Scenario }) {
  return h(
    'div',
    { className: 'flex flex-col' },
    h(InsetHeader, null, h(ScenarioCrumb, { component, scenario })),
    h(
      'main',
      { className: 'flex flex-col' },
      // The contender's window fills the first screen down to the window's
      // bottom edge, its frame at least 480 px (`page.css`).
      h('div', { className: 'observatory-first-screen flex flex-col pb-4 md:px-3 md:pt-3' }, h(ContenderSlot, { component, scenario })),
      h(DescriptionSlot, { component, scenario }),
    ),
  );
}
