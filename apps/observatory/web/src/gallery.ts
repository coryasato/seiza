/**
 * The galleries (`docs/DECISIONS.md`, "Page", 2026-11-02): the Overview's,
 * a card per component (a mosaic of its scenarios' frames drawn small, its
 * line, and its decision rule), and a component's page's, a card per
 * scenario (a drawing of its frame, its use, its verdict), then how far
 * each side keeps up and why each side wins where it does. Every word that
 * compares is from the cold numbers, resolved at build time
 * (`virtual:gallery`, `cold.ts`). A chunk of its own: the prerender renders
 * it into both pages' HTML (`prerender.ts`), and the client hydrates it
 * when the chunk arrives (`main.ts`), so none of it is first-paint JS.
 */

import { createElement as h, type ReactNode } from 'react';
import gallery from 'virtual:gallery';
import type { Side } from '../../contenders/contract.ts';
import type { Scenario, Stop } from '../../contenders/scenarios.ts';
import { COMPARE_HASH, scenarioCopy, scenarioPath, seriesClass, seriesDot, stopShort, WHY_ANCHOR, type Component } from './components.ts';
import { MECHANISMS, mechanismAnchor } from './mechanisms.ts';
import type { Lean, Reach } from './readouts.ts';

/** "Two real uses": a count in words, for the galleries' lines. */
const uses = (count: number) => `${['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][count] ?? count} real ${count === 1 ? 'use' : 'uses'}`;

// ---------------------------------------------------------------- drawings

/** A fixed noise in [0, 1), so a drawing is the same at every build. */
const noise = (a: number, b: number) => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** A day's high at a latitude, roughly: warm near the equator, a season
 *  that flips across it. A drawing's, not the file's. */
const high = (lat: number, day: number) => 30 - 0.55 * Math.abs(lat) + (3 + 0.22 * Math.abs(lat)) * Math.cos((2 * Math.PI * (day - 196)) / 365) * Math.sign(lat || 1);

const HEAT_ROWS = [70, 62, 52, 44, 36, 24, 10, -8, -24, -40];
const HEAT_DAYS = 20;

/** The wide sheet drawn small: the station pinned, then a day per cell as
 *  heat (the frame's ramp, the background to gpui-kit's `chart-1`). */
const heatDrawing = () =>
  h(
    'span',
    { className: 'observatory-drawing observatory-heat' },
    h('span', { className: 'observatory-head' }, h('i', { style: { width: '18%' } }), h('i', { style: { flex: 1 } })),
    ...HEAT_ROWS.map((lat) =>
      h(
        'span',
        { key: lat },
        h('i', { style: { width: '18%' } }),
        ...Array.from({ length: HEAT_DAYS }, (_, day) => {
          const at = Math.max(0, Math.min(1, (high(lat, (day * 365) / HEAT_DAYS) + 25) / 65));
          return h('i', { key: day, style: { '--heat': `${Math.round(at * 100)}%` } as Record<string, string> });
        }),
      ),
    ),
  );

/** A table of text drawn small: a header, then rows of values as bars. */
const rowsDrawing = () =>
  h(
    'span',
    { className: 'observatory-drawing' },
    ...Array.from({ length: 10 }, (_, row) =>
      h(
        'span',
        { key: row, className: row ? undefined : 'observatory-head' },
        ...[12, 26 + noise(row, 2) * 10, 10, 10, 12].map((width, at) => h('i', { key: at, style: { width: `${width.toFixed(1)}%` } })),
      ),
    ),
  );

/** A scenario's frame, drawn small: its level's shape. */
const drawing = (scenario: Scenario) => (scenario.level === 'wide' ? heatDrawing() : rowsDrawing());

// ---------------------------------------------------------------- shared

/** A side's name as its component's contenders give it. */
const labelOf = (component: Component, side: Side) => component.contenders.find((contender) => contender.side === side)!.label;

/** A lean's dot: a side's color, both halves for a split, muted for even. */
const leanDot = (lean: Lean) =>
  h('span', {
    className: `inline-block size-2.5 shrink-0 translate-y-px rounded-full ${lean === 'gpui' || lean === 'tanstack' ? seriesClass(lean, 'bg') : lean === 'split' ? 'observatory-split' : 'bg-muted-foreground'}`,
    'aria-hidden': true,
  });

const CARD = 'flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground transition-colors hover:border-ring';
const THUMB = 'block shrink-0 overflow-hidden border-b bg-sidebar p-3';

// ---------------------------------------------------------------- the Overview

/** A component's decision rule, each side's name in its color, each half
 *  only where its numbers back it, or that it waits for them. */
function Rule({ component }: { component: Component }) {
  const rule = gallery.rules[component.id];
  if (!rule || (!rule.dom && !rule.gpui.length)) return h('span', { 'data-rule': '', className: 'text-muted-foreground' }, 'Verdict after the scenarios run.');
  const [gpui, dom] = (['gpui', 'tanstack'] as const).map((side) => h('span', { className: seriesClass(side, 'text') }, side === 'gpui' ? labelOf(component, side) : 'the DOM'));
  return h(
    'span',
    { 'data-rule': '', className: 'flex flex-col gap-0.5' },
    rule.dom ? h('span', null, 'Use ', dom, ' for small tables.') : null,
    rule.gpui.length ? h('span', null, 'Use ', gpui, ` ${rule.gpui.join(' or ')}.`) : null,
  );
}

/** The Overview below its header: the thesis, the sides, a card per component. */
export function OverviewBody({ components }: { components: readonly Component[] }) {
  const side = (dot: Side, name: string, what: string) =>
    h('span', null, h('span', { className: 'mr-1.5 inline-flex -translate-y-px align-middle' }, seriesDot(dot)), h('span', { className: 'mr-1.5 whitespace-nowrap text-foreground' }, name), what);
  return h(
    'main',
    { className: 'flex flex-col gap-6 px-4 pt-5 pb-8 md:px-8 md:pt-7' },
    h(
      'header',
      { className: 'flex max-w-[84ch] flex-col gap-2.5' },
      h('h2', { className: 'text-[22px] leading-tight tracking-[-0.02em] md:text-[26px]' }, 'Is a UI drawn by the GPU worth it?'),
      h('p', { className: 'text-muted-foreground' }, 'Each component here runs against its DOM equivalent on the same engine and the same data, so only the UI differs.'),
      h(
        'p',
        { 'data-sides': '', className: 'flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted-foreground' },
        side('gpui', 'GPUI', 'Rust, drawn by the GPU from WebAssembly'),
        side('tanstack', 'The DOM', 'the browser’s own elements, through a JavaScript library'),
      ),
    ),
    h(
      'ul',
      { 'aria-label': 'Components', className: 'grid max-w-[1100px] grid-cols-[repeat(auto-fill,minmax(min(420px,100%),1fr))] gap-4' },
      ...components.map((component) =>
        h(
          'li',
          { key: component.id, className: 'flex' },
          h(
            'a',
            { href: component.path, 'data-component-card': component.id, className: `${CARD} flex-1` },
            h(
              'span',
              { className: `${THUMB} grid h-[150px] gap-2 md:h-[200px]`, style: { gridTemplateColumns: `repeat(${Math.min(component.scenarios.length, 3)}, minmax(0, 1fr))` }, 'aria-hidden': true },
              ...component.scenarios.map((scenario) => h('span', { key: scenario.id, 'data-tile': scenario.id, className: 'block min-h-0 overflow-hidden' }, drawing(scenario))),
            ),
            h(
              'span',
              { className: 'flex flex-1 flex-col gap-1.5 px-3.5 pt-3 pb-3.5' },
              h('span', { className: 'flex items-center justify-between gap-2 text-[15px]' }, h('span', null, component.label), h('span', { className: 'text-[13px] text-muted-foreground' }, component.contenders.map((contender) => contender.label).join(' | '))),
              h('span', { className: 'text-[13px] leading-snug text-muted-foreground' }, `${component.card} ${uses(component.scenarios.length)}.`),
              h('span', { className: 'mt-1 text-[15px] leading-snug max-md:text-sm' }, h(Rule, { component })),
            ),
          ),
        ),
      ),
      h(
        'li',
        { key: 'more', className: 'flex' },
        h(
          'div',
          { 'data-more': '', className: 'flex flex-1 flex-col overflow-hidden rounded-xl border border-dashed' },
          h(
            'span',
            { className: 'flex h-[150px] items-center justify-center md:h-[200px]', 'aria-hidden': true },
            h('span', { className: 'grid grid-cols-[repeat(2,56px)] gap-2' }, ...[0, 1, 2, 3].map((at) => h('i', { key: at, className: 'block h-10 rounded-md border border-dashed' }))),
          ),
          h(
            'span',
            { className: 'flex flex-col gap-1.5 px-3.5 pt-3 pb-3.5' },
            h('span', { className: 'text-[15px] text-muted-foreground' }, 'More components coming'),
            h('span', { className: 'text-[13px] leading-snug text-muted-foreground' }, 'Each compared the same way: a GPUI component against its DOM equivalent, in real uses.'),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------- a component's page

/** A section's heading and its line. */
const section = (label: string, line: string, id?: string, ...children: ReactNode[]) =>
  h(
    'section',
    { 'aria-label': label, id, className: 'flex scroll-mt-4 flex-col gap-3' },
    h('div', { className: 'flex flex-wrap items-baseline gap-x-3 gap-y-0.5' }, h('h3', { className: 'text-base' }, label), h('span', { className: 'text-[13px] text-muted-foreground' }, line)),
    ...children,
  );

/** One side's reach on one device: its dot, a bar the share of the stops it
 *  keeps up at, and the last of them. */
function ReachBar({ component, side, stops, index }: { component: Component; side: Side; stops: readonly Stop[]; index: number }) {
  const text = index < 0 ? 'none' : stops[index]!.label;
  return h(
    'span',
    { 'data-reach': side, className: 'grid grid-cols-[8px_minmax(0,1fr)_84px] items-center gap-2' },
    seriesDot(side),
    h('span', { className: 'h-2 overflow-hidden rounded-[3px] bg-muted' }, h('i', { className: `block h-full ${seriesClass(side, 'bg')}`, style: { width: `${((index + 1) / stops.length) * 100}%` } })),
    h('span', { className: 'text-right text-xs text-muted-foreground tabular-nums' }, h('span', { className: 'sr-only' }, `${labelOf(component, side)}: `), text),
  );
}

const DEVICE_NAMES = { reference: 'Fast device', throttled: 'Slow device' } as const;

/** How far each side keeps up: a row per scenario with a dial, each opening
 *  its Compare; no verdicts (its card has them), nothing at a single stop. */
function KeepsUp({ component }: { component: Component }) {
  const dialled = component.scenarios.filter((scenario) => gallery.reach[scenario.id]);
  const single = component.scenarios.filter((scenario) => scenario.stops.length < 2 && scenarioCopy(scenario).session);
  if (!dialled.length) return null;
  const columns = 'md:grid md:grid-cols-[minmax(200px,1fr)_minmax(220px,1fr)_minmax(220px,1fr)] md:gap-4';
  return section(
    'How far each side keeps up',
    `the highest stop where ${gallery.share} % of the display’s frames draw new cells · each row opens its scenario’s Compare`,
    undefined,
    h(
      'div',
      { className: 'overflow-hidden rounded-xl border bg-card' },
      h('div', { className: `${columns} border-b bg-sidebar px-4 py-2 text-xs text-muted-foreground max-md:hidden`, 'aria-hidden': true }, h('span', null, 'Scenario'), h('span', null, DEVICE_NAMES.reference), h('span', null, DEVICE_NAMES.throttled)),
      h(
        'ul',
        { 'aria-label': 'How far each side keeps up' },
        ...dialled.map((scenario) => {
          const reach: Reach = gallery.reach[scenario.id]!;
          const stops = scenario.stops as readonly Stop[];
          const dial = scenarioCopy(scenario).dial;
          return h(
            'li',
            { key: scenario.id, className: 'border-t first:border-t-0' },
            h(
              'a',
              { href: `${scenarioPath(component, scenario)}#${COMPARE_HASH}`, 'data-reach-row': scenario.id, className: `${columns} flex flex-col gap-2.5 px-4 py-3 text-[13px] hover:bg-accent` },
              h('span', { className: 'flex flex-col gap-0.5' }, h('span', null, scenario.label), h('span', { className: 'text-xs text-muted-foreground' }, `${dial?.label ?? 'Stops'}: ${stopShort(stops[0]!)} to ${stopShort(stops.at(-1)!)}`)),
              ...(['reference', 'throttled'] as const).map((profile) =>
                h(
                  'span',
                  { key: profile, 'data-device': profile, className: 'flex flex-col gap-1' },
                  h('span', { className: 'text-[11px] text-muted-foreground md:sr-only' }, DEVICE_NAMES[profile]),
                  h(ReachBar, { component, side: 'gpui', stops, index: reach[profile][0] }),
                  h(ReachBar, { component, side: 'tanstack', stops, index: reach[profile][1] }),
                ),
              ),
            ),
          );
        }),
      ),
    ),
    ...single.map((scenario) => h('p', { key: scenario.id, 'data-session': scenario.id, className: 'text-xs text-muted-foreground' }, `${scenario.label} has no dial: ${scenarioCopy(scenario).session}.`)),
  );
}

/** Why each side wins where it does: each scenario against the mechanisms,
 *  a dot in the favored side's color where it leans on one; their
 *  definitions, which the scenarios' descriptions link to. */
function Mechanisms({ component }: { component: Component }) {
  const cell = 'px-2 py-2.5 text-center font-normal';
  return section(
    'Why each side wins where it does',
    'what each use leans on, and which side that favors',
    WHY_ANCHOR,
    h(
      'div',
      // `relative`: the cells' screen-reader text is positioned in it, so the
      // scroller holds it rather than widening the page.
      { className: 'relative overflow-x-auto rounded-xl border bg-card' },
      h(
        'table',
        { 'data-mechanisms': '', className: 'w-full min-w-[720px] border-collapse text-[13px]' },
        h(
          'thead',
          { className: 'bg-sidebar text-xs' },
          h(
            'tr',
            { className: 'border-b' },
            h('th', { scope: 'col', className: 'w-40 px-4 py-2.5 text-left font-normal text-muted-foreground' }, 'Scenario'),
            ...MECHANISMS.map((mechanism) =>
              h(
                'th',
                { key: mechanism.id, scope: 'col', className: `${cell} align-bottom` },
                h('a', { href: `#${mechanismAnchor(mechanism)}`, className: 'flex flex-col items-center gap-0.5 hover:underline' }, h('span', null, mechanism.name), h('span', { className: 'inline-flex items-center gap-1 text-[11px] text-muted-foreground' }, seriesDot(mechanism.favors), labelOf(component, mechanism.favors))),
              ),
            ),
          ),
        ),
        h(
          'tbody',
          null,
          ...component.scenarios.map((scenario) => {
            const leans = scenarioCopy(scenario).leans;
            return h(
              'tr',
              { key: scenario.id, 'data-leans': scenario.id, className: 'border-t first:border-t-0' },
              h('th', { scope: 'row', className: 'px-4 py-2.5 text-left font-normal' }, h('a', { href: scenarioPath(component, scenario), className: 'hover:underline' }, scenario.label)),
              ...MECHANISMS.map((mechanism) => {
                const on = leans.includes(mechanism.id);
                return h(
                  'td',
                  { key: mechanism.id, 'data-lean': on ? mechanism.favors : '', className: cell },
                  h('span', {
                    className: `inline-block size-3.5 rounded-full border-[1.5px] align-middle ${on ? `${seriesClass(mechanism.favors, 'border')} ${seriesClass(mechanism.favors, 'bg')}` : 'border-border'}`,
                    'aria-hidden': true,
                  }),
                  h('span', { className: 'sr-only' }, on ? 'leans on it' : 'not much'),
                );
              }),
            );
          }),
        ),
      ),
    ),
    h(
      'dl',
      { className: 'grid gap-3 text-xs leading-relaxed md:grid-cols-5' },
      ...MECHANISMS.map((mechanism) => h('div', { key: mechanism.id, id: mechanismAnchor(mechanism), 'data-mechanism': mechanism.id, className: 'scroll-mt-4' }, h('dt', null, mechanism.name), h('dd', { className: 'mt-0.5 text-muted-foreground' }, mechanism.definition))),
    ),
    h('p', { className: 'text-xs text-muted-foreground' }, 'The canvas’s part and WebAssembly’s aren’t measured apart yet.'),
  );
}

/** A component's page below its header. */
export function ComponentBody({ component }: { component: Component }) {
  return h(
    'main',
    { className: 'flex flex-col gap-7 px-4 pt-5 pb-8 md:px-8 md:pt-7' },
    h(
      'header',
      { className: 'flex flex-col gap-1' },
      h('h2', { className: 'text-xl tracking-[-0.01em]' }, component.label),
      h('p', { className: 'max-w-[84ch] text-muted-foreground' }, `${component.line} ${uses(component.scenarios.length)}, each against ${component.against}.`),
    ),
    h(
      'ul',
      { 'aria-label': 'Scenarios', className: 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' },
      ...component.scenarios.map((scenario) => {
        const verdict = gallery.verdicts[scenario.id];
        return h(
          'li',
          { key: scenario.id, className: 'flex' },
          h(
            'a',
            { href: scenarioPath(component, scenario), 'data-scenario-card': scenario.id, className: `${CARD} flex-1` },
            h('span', { className: `${THUMB} h-[132px]`, 'aria-hidden': true }, drawing(scenario)),
            h(
              'span',
              { className: 'flex flex-1 flex-col gap-1.5 px-3.5 pt-3 pb-3.5' },
              h('span', { className: 'text-[15px]' }, scenario.label),
              h('span', { className: 'text-[13px] leading-snug text-muted-foreground' }, scenario.use),
              h(
                'span',
                { 'data-verdict': '', className: 'mt-auto flex items-baseline gap-2 pt-1.5 text-[13px] leading-snug' },
                verdict ? leanDot(verdict.lean) : null,
                verdict ? h('span', null, verdict.text) : h('span', { className: 'text-muted-foreground' }, 'Verdict after its runs.'),
              ),
            ),
          ),
        );
      }),
    ),
    h(KeepsUp, { component }),
    h(Mechanisms, { component }),
  );
}
