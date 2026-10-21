/**
 * The comparison's numbers (`docs/DECISIONS.md`, "Page", 2026-10-20), a
 * chunk of its own rendered after the page's first paint: the window's
 * status bar (this tab's readings, each segment opening its explainer and
 * its cold comparison; Meter (`meter.ts`'s), Run benchmark, Compare; on a
 * phone Smooth, Memory, and an overflow), the panel Compare opens over the frame (the
 * cards with both devices and their verdicts, the input-to-response chart),
 * and the description below the window. The cold numbers are resolved at
 * build time (`virtual:cold-numbers`); every comparing word is computed from
 * them (`readouts.ts`).
 *
 * The status bar's readings are written by reference (`textContent`, only
 * on a change), never by a React render: the page shares the contender's
 * main thread (the readout's cost, "Page").
 */

import { ChevronDown, ChevronUp, Ellipsis, Info, Play, X } from 'lucide-react';
import { createElement as h, Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { SOURCE } from '@seiza/site-ui/components/footer';
import cold from 'virtual:cold-numbers';
import type { Side } from '../../contenders/contract.ts';
import { millions, type Contender } from './components.ts';
import { closeExplainer, Explainer } from './explainer.ts';
import { liveSnapshot, subscribeLive, useLive, type Live, type LiveSide } from './live.ts';
import { toggleMeter, useMeter } from './meter.ts';

/** The meter, in this chunk: it shares the readouts' code. */
export { Meter } from './meter.ts';
import {
  BARS,
  CARDS,
  LABELS,
  cardOutcome,
  CHART_MS,
  DEVICES,
  PARTS,
  PROFILES,
  cardValues,
  downloadTotal,
  evenSentence,
  number,
  outcome,
  size,
  verdict,
  wheelNote,
  wins,
  winsSentence,
  withUnit,
  type Card,
  type Profile,
} from './readouts.ts';
import { ICON_BUTTON, PANEL_ID, seriesDot } from './slot.ts';

const other = (side: Side): Side => (side === 'gpui' ? 'tanstack' : 'gpui');
const sideIndex = (side: Side) => (side === 'gpui' ? 0 : 1);

/** A side's reading for `card` in this tab, or null. */
const reading = (side: LiveSide | null, card: Card) => (side ? card.live(side.readings) : null);

/** A reading as the status bar shows it: "—" until there is one. */
const liveText = (live: Live, side: Side, card: Card) => {
  const value = reading(live[side], card);
  return value === null ? '—' : withUnit(value, card.unit);
};

/** One text function per side and card for the module's life, so a
 *  `LiveText` subscribes once, however often its bar renders. */
const texts = new Map<string, (live: Live) => string>();
const textOf = (side: Side, card: Card) => {
  const key = `${side}:${card.key}`;
  if (!texts.has(key)) texts.set(key, (live: Live) => liveText(live, side, card));
  return texts.get(key)!;
};

/** Text that follows this tab's readings by reference: written only when it
 *  changes, with no React render. */
function LiveText({ text, className }: { text: (live: Live) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const write = () => {
      const next = text(liveSnapshot());
      if (ref.current && ref.current.textContent !== next) ref.current.textContent = next;
    };
    write();
    return subscribeLive(write);
  }, [text]);
  return h('span', { ref, className: `tabular-nums ${className ?? ''}` }, text(liveSnapshot()));
}

const better = (card: { better: 'lower' | 'higher' }) => `${card.better} is better`;

// ---------------------------------------------------------------- the status bar

const SEGMENT = 'inline-flex h-full items-center gap-1.5 whitespace-nowrap border-l px-2.5 text-xs hover:bg-accent aria-expanded:bg-accent aria-pressed:bg-accent disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent max-md:px-3 max-md:text-[13px] [&_svg]:size-3';

interface StatusProps {
  shown: Contender;
  panel: boolean;
  togglePanel: () => void;
  rows: number;
}

export function StatusBar({ shown, panel, togglePanel, rows }: StatusProps) {
  const side = shown.side;
  const meter = useMeter().mode !== 'off';
  const coldFast = (card: Card) => cardValues(card, cold.values, 'reference');
  const segment = (card: Card) => {
    const text = textOf(side, card);
    return h(
      Explainer,
      {
        key: card.key,
        className: `h-full ${card.key === 'usable' || card.key === 'data' ? 'max-md:hidden' : ''}`,
        placement: 'above-end',
        trigger: h(
          Fragment,
          null,
          h('span', { className: `text-muted-foreground ${card.key === 'memory' ? 'max-md:hidden' : ''}` }, card.segment),
          h(LiveText, { text }),
        ),
        triggerProps: { 'data-segment': card.key, className: SEGMENT },
      },
      h('span', { className: 'block' }, `${card.segment} · ${better(card)}`),
      h('span', { className: 'mt-1 block text-muted-foreground' }, card.explain),
      h(
        'span',
        { className: 'mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-muted-foreground' },
        h('span', null, `This tab, ${LABELS[side]}`),
        h(LiveText, { text, className: 'text-right text-foreground' }),
        h('span', null, `Cold, ${LABELS[side]}`),
        h('span', { className: 'text-right text-foreground tabular-nums' }, withUnit(coldFast(card)[sideIndex(side)], card.unit)),
        h('span', null, `Cold, ${LABELS[other(side)]}`),
        h('span', { className: 'text-right text-foreground tabular-nums' }, withUnit(coldFast(card)[sideIndex(other(side))], card.unit)),
      ),
    );
  };
  const later = (label: ReactNode, what: string) => h('button', { type: 'button', disabled: true, title: `${what}: coming soon`, className: `${SEGMENT} max-md:hidden` }, label);
  return h(
    'div',
    { 'data-status-ready': '', className: 'flex h-full items-stretch justify-between' },
    h(
      'div',
      { className: 'flex min-w-0 items-stretch' },
      h('span', { className: 'inline-flex items-center gap-1.5 px-2.5 text-xs max-md:px-2 max-md:text-[13px]' }, seriesDot(side), shown.label),
      h('span', { className: 'inline-flex items-center px-2.5 text-xs text-muted-foreground tabular-nums max-md:hidden' }, `${rows.toLocaleString('en-US')} rows`),
    ),
    h(
      'div',
      { className: 'flex min-w-0 items-stretch' },
      ...CARDS.map(segment),
      h('button', { type: 'button', 'data-meter-toggle': '', 'aria-pressed': meter, onClick: toggleMeter, className: `${SEGMENT} max-md:hidden` }, 'Meter'),
      later(h(Fragment, null, h(Play, { 'aria-hidden': true }), 'Run benchmark'), 'The benchmark'),
      h(
        'button',
        { type: 'button', 'data-compare': '', 'aria-expanded': panel, 'aria-controls': PANEL_ID, onClick: togglePanel, className: `${SEGMENT} max-md:hidden` },
        'Compare',
        h(panel ? ChevronDown : ChevronUp, { 'aria-hidden': true }),
      ),
      h(
        Explainer,
        {
          className: 'h-full md:hidden',
          placement: 'above-end',
          width: 240,
          menu: true,
          trigger: h(Ellipsis, { 'aria-hidden': true }),
          triggerProps: { 'aria-label': 'More numbers', className: `${SEGMENT} min-w-11 justify-center` },
        },
        ...CARDS.filter((card) => card.key === 'usable' || card.key === 'data').map((card) =>
          h(
            'div',
            { key: card.key, role: 'none', className: 'flex justify-between gap-3 p-2.5' },
            h('span', { className: 'text-muted-foreground' }, card.segment),
            h(LiveText, { text: textOf(side, card) }),
          ),
        ),
        h(MenuButton, { onClick: () => (closeExplainer(), panel || togglePanel()) }, 'Compare with cold runs'),
        h(MenuButton, { onClick: () => (closeExplainer(), toggleMeter()) }, meter ? 'Hide the meter' : 'Show the meter'),
        h(MenuButton, { disabled: true }, 'Run benchmark: coming soon'),
      ),
    ),
  );
}

const MenuButton = ({ onClick, disabled, children }: { onClick?: () => void; disabled?: boolean; children?: ReactNode }) =>
  h('button', { type: 'button', role: 'menuitem', onClick, disabled, className: 'flex min-h-11 w-full items-center rounded-md px-2.5 text-left text-sm hover:bg-accent disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent' }, children);

// ---------------------------------------------------------------- the panel

const runs = cold.runs.join(' and ');

/** An (i) and its explainer. */
const info = (label: string, children: ReactNode, width = 340) =>
  h(Explainer, { trigger: h(Info, { 'aria-hidden': true }), triggerProps: { 'aria-label': label, className: ICON_BUTTON }, width }, children);

interface PanelProps {
  id: string;
  contenders: [Contender, Contender];
  onClose: () => void;
}

export function Panel({ id, contenders, onClose }: PanelProps) {
  const live = useLive();
  const [edge, setEdge] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
    // An open explainer hears Esc first (it stops it); otherwise Esc closes the panel.
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const cpus = cold.cpus.join(', ');
  return h(
    'section',
    { ref, id, tabIndex: -1, 'aria-label': 'How they compare', className: 'absolute inset-0 z-10 flex flex-col overflow-hidden bg-background outline-none' },
    h(
      'div',
      { 'data-panel-header': '', 'data-edge': edge ? '' : undefined, className: 'relative z-[1] flex shrink-0 items-center gap-4 border-b border-transparent bg-background py-2.5 pr-3 pl-4 data-edge:border-border data-edge:shadow-[0_4px_12px_oklch(0_0_0/8%)] max-md:pr-2' },
      h(
        'div',
        { className: 'min-w-0 flex-1' },
        h('h2', { className: 'text-[15px]' }, 'How they compare'),
        h(
          'p',
          { className: 'flex items-center gap-1 text-[13px] text-muted-foreground' },
          `The middle of ${runs} cold loads per side, on two devices`,
          info(
            'About the devices',
            h(
              Fragment,
              null,
              `Fast device: ${cpus === 'Apple M1' ? 'an Apple M1' : cpus} at full speed. Slow device: the same machine with its processor slowed 4×, on a Fast 4G network.`,
              h('span', { className: 'mt-1 block text-muted-foreground' }, `Each side loads alone in a fresh browser, ${runs} times, by a test script; the number is the middle run.`),
            ),
          ),
        ),
      ),
      h('button', { type: 'button', 'aria-label': 'Close, back to the table', onClick: onClose, className: 'inline-flex size-9 shrink-0 items-center justify-center rounded-lg hover:bg-accent [&_svg]:size-[18px]' }, h(X, { 'aria-hidden': true })),
    ),
    h(
      'div',
      { 'data-panel-body': '', onScroll: (event: { currentTarget: HTMLElement }) => setEdge(event.currentTarget.scrollTop > 0), className: '@container flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 max-md:p-3' },
      h(
        'div',
        { className: 'grid gap-3 @3xl:grid-cols-3' },
        ...CARDS.map((card) => h(StatCard, { key: card.key, card, live, contenders })),
        h(DownloadCard, { key: 'download', contenders }),
      ),
      h(Chart, { contenders }),
    ),
  );
}

const CARD = 'flex min-w-0 flex-col gap-2 rounded-[10px] border px-3.5 py-3';
const CAPTION = 'col-span-2 mt-1.5 text-[11px] text-muted-foreground';

function CardHead({ label, explain, note }: { label: string; explain: string; note: string }) {
  return h(
    'div',
    { className: 'flex items-center justify-between gap-2 text-[13px]' },
    h('span', { className: 'inline-flex items-center gap-0.5' }, label, info(`About ${label}`, explain)),
    h('small', { className: 'text-[11px] whitespace-nowrap text-muted-foreground' }, note),
  );
}

const sideHeads = (contenders: [Contender, Contender]) =>
  contenders.map((contender) => h('span', { key: contender.side, className: 'flex items-center gap-1.5 text-xs text-muted-foreground' }, seriesDot(contender.side), contender.label));

/** A cold value, large, its unit small, "best" beside the winner's. */
const big = (text: string, unit: string, best: boolean, attributes: Record<string, string>) =>
  h(
    'span',
    { ...attributes, className: 'text-xl leading-tight tracking-tight tabular-nums' },
    text,
    unit ? h('small', { className: 'ml-0.5 text-xs tracking-normal text-muted-foreground' }, unit) : null,
    best ? h('span', { className: 'ml-1.5 align-[2px] text-[11px] tracking-normal text-muted-foreground' }, 'best') : null,
  );

function StatCard({ card, live, contenders }: { card: Card; live: Live; contenders: [Contender, Contender] }) {
  const outcomes = PROFILES.map((profile) => cardOutcome(card, cold.values, profile));
  const loaded = contenders.filter((contender) => live[contender.side]);
  return h(
    'div',
    { 'data-card': card.key, className: CARD },
    h(CardHead, { label: card.label, explain: card.explain, note: better(card) }),
    h('span', { 'data-verdict': '', className: 'text-sm leading-snug' }, verdict(outcomes[0]!, outcomes[1]!, card.word, card.ratio)),
    h(
      'div',
      { className: 'grid grid-cols-2 items-baseline gap-x-2.5' },
      ...sideHeads(contenders),
      ...PROFILES.flatMap((profile, index) => {
        const values = cardValues(card, cold.values, profile);
        return [
          h('span', { key: `${profile}-caption`, className: CAPTION }, index === 0 && card.caption ? `${DEVICES[profile]}, ${card.caption.toLowerCase()}` : DEVICES[profile]),
          ...contenders.map((contender) =>
            h(Fragment, { key: `${profile}-${contender.side}` }, big(number(values[sideIndex(contender.side)]!), card.unit, outcomes[index]!.winner === contender.side, { [`data-cold-${profile}`]: contender.side })),
          ),
        ];
      }),
    ),
    // This tab: only once a side has loaded.
    loaded.length
      ? h(
          'div',
          { className: 'grid grid-cols-2 gap-x-2.5 border-t pt-0.5' },
          h('span', { className: CAPTION }, 'This tab'),
          ...contenders.map((contender) => {
            const side = live[contender.side];
            const value = reading(side, card);
            return h(
              'span',
              { key: contender.side, 'data-live': contender.side, className: 'inline-flex items-center gap-1.5 text-xs tabular-nums' },
              h('span', { className: value === null ? 'text-muted-foreground' : '' }, !side ? '—' : value === null ? card.waiting : withUnit(value, card.unit)),
              side?.warm && value !== null ? h('span', { className: 'rounded-sm border px-1 text-[11px] leading-4 text-muted-foreground' }, 'warm') : null,
            );
          }),
        )
      : null,
  );
}

function DownloadCard({ contenders }: { contenders: [Contender, Contender] }) {
  const totals = contenders.map((contender) => downloadTotal(contender.side, cold.parts)) as [number, number];
  const fast = outcome(totals, 'lower');
  return h(
    'div',
    { 'data-card': 'download', className: `${CARD} @3xl:col-span-2` },
    h(CardHead, { label: 'Download', explain: 'What each side’s page fetches, compressed as sent. The database engine and the data are the same files on both sides, so they’re left out.', note: 'lower is better' }),
    h('span', { 'data-verdict': '', className: 'text-sm leading-snug' }, verdict(fast, null, 'smaller', true)),
    h(
      'div',
      { className: 'grid grid-cols-2 items-baseline gap-x-2.5' },
      ...sideHeads(contenders),
      h('span', { className: CAPTION }, 'Either device'),
      ...contenders.map((contender, index) => {
        const [value, unit] = size(totals[index]!).split(' ') as [string, string];
        return h(Fragment, { key: contender.side }, big(value, unit, fast.winner === contender.side, { 'data-cold-reference': contender.side }));
      }),
    ),
    h(
      'div',
      { className: 'grid grid-cols-2 gap-x-2.5 border-t pt-2' },
      ...contenders.map((contender) =>
        h(
          'dl',
          { key: contender.side, 'data-parts': contender.side, className: 'grid grid-cols-[1fr_auto] gap-x-3 text-[11px] leading-[1.6] text-muted-foreground' },
          ...PARTS[contender.side].flatMap((part) => [
            h('dt', { key: `${part.id}-label`, className: part.within ? 'pl-3' : 'text-foreground' }, part.label),
            h('dd', { key: `${part.id}-value`, className: `text-right tabular-nums ${part.within ? '' : 'text-foreground'}` }, `${number(cold.parts[part.id]!)} KiB`),
          ]),
        ),
      ),
    ),
    h('span', { className: 'text-[11px] leading-snug text-muted-foreground' }, 'Brotli, as fetched. Both sides load the same font, the same database engine, and the same data; the engine and the data are left out. The WebAssembly’s rest is Rust’s runtime, its static data, and the module’s tables.'),
  );
}

function Chart({ contenders }: { contenders: [Contender, Contender] }) {
  const end = Math.max(CHART_MS, Math.ceil(Math.max(...BARS.flatMap((bar) => PROFILES.flatMap((profile) => cold.values[`${bar.metric}-${profile}`]!))) / 10) * 10);
  const ticks = Array.from({ length: end / 10 + 1 }, (_, index) => index * 10);
  const pair = (bar: (typeof BARS)[number], profile: Profile) =>
    h(
      'div',
      { key: profile, className: 'flex flex-col gap-0.5' },
      h('span', { className: 'hidden text-[11px] text-muted-foreground max-md:block' }, DEVICES[profile]),
      ...contenders.map((contender, index) => {
        const value = cold.values[`${bar.metric}-${profile}`]![index]!;
        const mark = bar.native && profile === 'throttled' && contender.side === 'tanstack' ? ' †' : '';
        return h(
          'div',
          { key: contender.side, className: 'flex items-center gap-2' },
          h('div', {
            className: `h-2.5 rounded-r-[3px] ${contender.side === 'gpui' ? 'bg-series-gpui' : 'bg-series-tanstack'}`,
            style: { width: `calc((100% - 4rem) * ${(value / end).toFixed(4)})` },
            'aria-hidden': true,
          }),
          h('span', { className: 'text-xs text-muted-foreground tabular-nums' }, h('span', { className: 'sr-only' }, `${contender.label}, ${DEVICES[profile].toLowerCase()}: `), `${number(value)} ms${mark}`),
        );
      }),
    );
  const axis = (key: string) =>
    h(
      'div',
      { key, className: 'flex justify-between border-t pt-1 pr-16 text-xs text-muted-foreground tabular-nums max-md:hidden', 'aria-hidden': true },
      ...ticks.map((tick, index) => h('span', { key: tick }, index === ticks.length - 1 ? `${tick} ms` : tick)),
    );
  return h(
    'section',
    { 'aria-label': 'From your input to the table moving', className: 'flex flex-col gap-3 rounded-[10px] border px-4 pt-3 pb-3.5' },
    h(
      'div',
      { className: 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1' },
      h('h3', { className: 'text-[13px] text-muted-foreground' }, 'From your input to the table moving, cold. Lower is better.'),
      h('div', { className: 'flex items-center gap-3 text-xs text-muted-foreground' }, ...sideHeads(contenders)),
    ),
    h(
      'div',
      { role: 'list', className: 'grid items-center gap-x-6 gap-y-2.5 md:grid-cols-[190px_minmax(0,1fr)_minmax(0,1fr)] max-md:gap-y-1' },
      h('span', { className: 'max-md:hidden' }),
      ...PROFILES.map((profile) => h('span', { key: profile, className: 'text-xs text-muted-foreground max-md:hidden' }, DEVICES[profile])),
      ...BARS.flatMap((bar) => [
        h('span', { key: `${bar.metric}-label`, role: 'listitem', className: 'text-[13px] max-md:mt-2' }, bar.label),
        ...PROFILES.map((profile) => h(Fragment, { key: `${bar.metric}-${profile}` }, pair(bar, profile))),
      ]),
      h('span', { className: 'max-md:hidden' }),
      axis('fast'),
      axis('slow'),
    ),
    h('p', { className: 'text-xs text-muted-foreground' }, wheelNote(cold.values)),
    h('p', { className: 'text-xs text-muted-foreground' }, '† The slow device slows the processor for page code, not the browser’s own scrolling, so these rows flatter native scrolling. A real slow phone is slower here too.'),
  );
}

// ---------------------------------------------------------------- below the window

export function Description({ contenders }: { contenders: [Contender, Contender] }) {
  const won = wins(cold);
  const item = (dot: ReactNode, children: ReactNode) => h('li', { className: 'flex items-baseline gap-2.5' }, dot ? h('span', { className: 'inline-flex -translate-y-px' }, dot) : null, h('span', { className: 'text-muted-foreground' }, children));
  const name = (text: string) => h('span', { className: 'text-foreground' }, text);
  const block = (title: string, ...children: ReactNode[]) => h('div', null, h('h2', { className: 'mb-1.5 text-[15px]' }, title), ...children);
  const muted = h('span', { className: 'inline-block size-2 shrink-0 rounded-full bg-muted-foreground', 'aria-hidden': true });
  return h(
    'section',
    { 'data-description': '', 'aria-label': 'About this comparison', className: 'flex max-w-[76ch] flex-col gap-5 px-3 pt-1 pb-6 text-sm max-md:px-4' },
    block(
      'What you’re looking at',
      h('p', null, `Two tables scroll the same ${cold.rows.toLocaleString('en-US')} asteroids, read a page at a time from one file by the same database engine. Only the table differs.`),
      h(
        'ul',
        { className: 'mt-2 flex flex-col gap-1.5' },
        ...contenders.map((contender) => h(Fragment, { key: contender.side }, item(seriesDot(contender.side), h(Fragment, null, name(`${contender.label}:`), ` ${contender.stack}.`)))),
      ),
    ),
    block(
      `Why ${millions(cold.rows)} rows`,
      h(
        'p',
        null,
        'It’s the whole asteroid file that fits our hosting’s 25 MiB file limit, not the TallTable’s limit: it scrolls by row, not by pixel, so it handles tens of millions. A browser caps how tall a page element can be, so a plain DOM list stops near 560,000 rows of this height in Firefox and 1.1 million in Chrome. The TanStack side reaches the last row through a scaled scroller built for this comparison.',
      ),
    ),
    block(
      'Where each side wins',
      h(
        'ul',
        { 'data-wins': '', className: 'flex flex-col gap-1.5' },
        ...contenders.filter((contender) => won[contender.side].length).map((contender) => h(Fragment, { key: contender.side }, item(seriesDot(contender.side), winsSentence(contender.side, won[contender.side])))),
        won.even.length ? item(muted, evenSentence(won.even)) : null,
      ),
      h('p', { className: 'mt-2 text-muted-foreground' }, 'The inputs are read on the fast device. Every number is under Compare, in the window’s status bar.'),
    ),
    block(
      'Where the canvas falls short',
      h(
        'ul',
        { className: 'flex flex-col gap-1.5' },
        item(null, 'On touch, a swipe scrolls GPUI’s table one way at a time; TanStack’s pans diagonally.'),
        item(null, 'DevTools’ device mode draws GPUI’s table zoomed; a real phone draws it normally.'),
      ),
      h('p', { className: 'mt-2 text-muted-foreground' }, 'More, and how each number is measured: ', h('a', { href: `${SOURCE}/tree/master/apps/observatory#canvas-tradeoffs`, className: 'text-foreground underline underline-offset-4' }, 'the observatory’s README'), '.'),
    ),
  );
}
