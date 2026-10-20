/**
 * The comparison's numbers, below the description (`docs/DECISIONS.md`,
 * "Page"): a Reference | Throttled switch, the headline cards (the cold
 * medians large, this tab's live readings shaded below), and the input-to-
 * response chart, cold. A chunk of its own, rendered after the page's first
 * paint (`page.ts`); the cold numbers are resolved at build time
 * (`virtual:cold-numbers`), and the live row fills as the frame runs
 * (`live.ts`). On a phone each card and the chart collapse, the first card
 * open.
 */

import { ChevronDown } from 'lucide-react';
import { createElement as h, useEffect, useId, useState, type ReactNode } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@seiza/site-ui/components/toggle-group';
import cold from 'virtual:cold-numbers';
import type { Side } from '../../contenders/contract.ts';
import type { Contender } from './components.ts';
import { useLive, type Live } from './live.ts';
import { BARS, CARDS, PROFILES, type Card, type Profile } from './readouts.ts';
import { seriesDot } from './slot.ts';

const PROFILE_LABELS: Record<Profile, string> = { reference: 'Reference', throttled: 'Throttled' };
const PROFILE_NAMES: Record<Profile, string> = { reference: 'reference', throttled: 'throttled (CPU 4×, Fast 4G)' };

/** Two cold medians this close (relative) read as even: inside the runs'
 *  own spread, which the protocol holds under 6%. */
const EVEN = 0.05;

/** A phone's layout (Tailwind's `md` and below). */
function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = matchMedia('(max-width: 47.999rem)');
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}

const format = (value: number) => String(Number(value.toFixed(1)));

function verdict([gpui, tanstack]: [number, number]): string {
  if (Math.abs(gpui - tanstack) <= EVEN * Math.max(gpui, tanstack)) return 'Even';
  return gpui < tanstack ? 'GPUI lower' : 'TanStack lower';
}

export function Numbers({ contenders }: { contenders: [Contender, Contender] }) {
  const [profile, setProfile] = useState<Profile>('reference');
  const phone = usePhone();
  const live = useLive();
  // "2026-10-18 and 19" when the runs share a month.
  const sameMonth = new Set(cold.dates.map((date) => date.slice(0, 8))).size === 1;
  const dates = cold.dates.map((date, index) => (index && sameMonth ? date.slice(8) : date)).join(' and ');
  return h(
    'section',
    { className: '@container flex flex-col gap-4 pt-2', 'aria-label': 'The numbers' },
    h(
      'div',
      { className: 'flex flex-wrap items-end justify-between gap-x-6 gap-y-2' },
      h(
        'div',
        null,
        h('h2', { className: 'text-base' }, 'The numbers'),
        h(
          'p',
          { className: 'mt-0.5 max-w-[80ch] text-[13px] text-muted-foreground' },
          `Large: cold Playwright runs of the bare pages, median of ${cold.runs.join(' and ')}, local release builds (${dates}, ${cold.cpus.join(', ')}). Shaded: this tab, live, as you use the table above; a side loaded second, or from the browser’s cache, is warm.`,
        ),
      ),
      h(
        ToggleGroup,
        { variant: 'segmented', value: [profile], onValueChange: (value: string[]) => value[0] && setProfile(value[0] as Profile), 'aria-label': 'Profile' },
        ...PROFILES.map((name) => h(ToggleGroupItem, { key: name, value: name, className: 'px-3' }, PROFILE_LABELS[name])),
      ),
    ),
    h(
      'div',
      { className: 'grid gap-4 @xl:grid-cols-2 @5xl:grid-cols-4' },
      ...CARDS.map((card, index) => h(StatCard, { key: card.metric, card, profile, contenders, live, phone, startOpen: index === 0 })),
    ),
    h(Chart, { profile, contenders, phone }),
  );
}

/** A card's header: on a phone a button that opens it, showing the cold
 *  values while it's closed. */
function Disclosure({ phone, open, setOpen, controls, title, summary }: { phone: boolean; open: boolean; setOpen: (open: boolean) => void; controls: string; title: ReactNode; summary: string }) {
  if (!phone) return title;
  return h(
    'button',
    { type: 'button', 'aria-expanded': open, 'aria-controls': controls, onClick: () => setOpen(!open), className: 'flex w-full items-center gap-2 text-left' },
    h('span', { className: 'flex-1' }, title, open ? null : h('span', { className: 'block text-xs text-muted-foreground tabular-nums' }, summary)),
    h(ChevronDown, { 'aria-hidden': true, className: `size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}` }),
  );
}

function StatCard({ card, profile, contenders, live, phone, startOpen }: { card: Card; profile: Profile; contenders: [Contender, Contender]; live: Live; phone: boolean; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const id = useId();
  const values = cold.values[`${card.metric}-${profile}`]!;
  const shown = !phone || open;
  const summary = contenders.map((contender, index) => `${contender.label} ${format(values[index]!)} ${card.unit}`).join(' · ');
  return h(
    'div',
    { 'data-card': card.metric, className: 'flex flex-col gap-3 rounded-xl border bg-card px-5 py-4 text-card-foreground shadow-xs' },
    h(Disclosure, { phone, open, setOpen, controls: id, title: h('span', { className: 'text-[13px] text-muted-foreground' }, card.label), summary }),
    shown
      ? h(
          'div',
          { id, className: 'flex flex-col gap-3' },
          h(
            'div',
            { className: 'grid grid-cols-2 gap-3' },
            ...contenders.map((contender, index) =>
              h(
                'div',
                { key: contender.side, className: 'flex flex-col gap-0.5' },
                h('span', { className: 'flex items-center gap-1.5 text-xs text-muted-foreground' }, seriesDot(contender.side), contender.label),
                h('span', { 'data-cold': contender.side, className: 'text-2xl leading-tight tracking-tight tabular-nums' }, format(values[index]!), h('small', { className: 'ml-0.5 text-[13px] tracking-normal text-muted-foreground' }, card.unit)),
              ),
            ),
          ),
          h(
            'div',
            { className: 'grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-muted px-2.5 py-2 text-xs' },
            h('span', { className: 'col-span-2 text-muted-foreground' }, 'This tab, live'),
            ...contenders.map((contender) => h(LiveValue, { key: contender.side, side: contender.side, card, live })),
            h('span', { className: 'col-span-2 text-muted-foreground' }, card.liveNote),
          ),
          h('div', { className: 'flex justify-between gap-2 text-[13px]' }, h('span', null, verdict(values)), h('span', { className: 'text-muted-foreground' }, 'lower is better')),
        )
      : null,
  );
}

function LiveValue({ side, card, live }: { side: Side; card: Card; live: Live }) {
  const reading = live[side];
  const value = reading ? card.live(reading.readings) : null;
  const text = !reading ? 'not loaded' : value === null ? card.liveEmpty : `${format(value)} ${card.unit}`;
  return h(
    'span',
    { 'data-live': side, className: 'flex min-w-0 flex-wrap items-center gap-1.5 tabular-nums' },
    seriesDot(side),
    h('span', { className: `whitespace-nowrap ${value === null ? 'text-muted-foreground' : ''}` }, text),
    reading?.warm && value !== null ? h('span', { className: 'rounded-sm border px-1 text-[11px] text-muted-foreground' }, 'warm') : null,
  );
}

/** The axis's end: the largest value rounded up to the next ten. */
const axisEnd = (values: number[]) => Math.max(10, Math.ceil(Math.max(...values) / 10) * 10);

function Chart({ profile, contenders, phone }: { profile: Profile; contenders: [Contender, Contender]; phone: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rows = BARS.map((bar) => ({ ...bar, values: cold.values[`${bar.metric}-${profile}`]! }));
  const end = axisEnd(rows.flatMap((row) => row.values));
  const step = end <= 60 ? 10 : 20;
  const ticks = Array.from({ length: Math.floor(end / step) + 1 }, (_, index) => index * step);
  const shown = !phone || open;
  const legend = h(
    'div',
    { className: 'flex items-center gap-4 text-[13px] text-muted-foreground' },
    ...contenders.map((contender) => h('span', { key: contender.side, className: 'inline-flex items-center gap-1.5' }, seriesDot(contender.side), contender.label)),
  );
  return h(
    'section',
    { className: 'flex flex-col gap-4 rounded-xl border bg-card px-5 pt-4 pb-5 text-card-foreground shadow-xs', 'aria-label': 'Input to visible response' },
    h(Disclosure, {
      phone,
      open,
      setOpen,
      controls: id,
      title: h('span', { className: 'text-[15px]' }, 'Input to visible response'),
      summary: 'Key, track press, and wheel, cold',
    }),
    shown
      ? h(
          'div',
          { id, className: 'flex flex-col gap-4' },
          h(
            'div',
            { className: 'flex flex-wrap justify-between gap-x-6 gap-y-2' },
            h('p', { className: 'text-[13px] text-muted-foreground' }, `The input event’s timestamp to the first presented frame showing it, from Chromium’s trace: ${PROFILE_NAMES[profile]}, cold. Lower is better.`),
            legend,
          ),
          h(
            'div',
            { className: 'flex flex-col gap-3.5', role: 'list' },
            ...rows.map((row) =>
              h(
                'div',
                { key: row.metric, role: 'listitem', className: 'grid items-center gap-1 md:grid-cols-[220px_minmax(0,1fr)] md:gap-4' },
                h('div', { className: 'text-[13px]' }, row.label),
                h(
                  'div',
                  { className: 'flex flex-col gap-0.5' },
                  ...contenders.map((contender, index) => {
                    const value = row.values[index]!;
                    return h(
                      'div',
                      { key: contender.side, className: 'flex items-center gap-2', title: `${contender.label}: ${format(value)} ms` },
                      h('div', {
                        className: `h-3 rounded-r ${contender.side === 'gpui' ? 'bg-series-gpui' : 'bg-series-tanstack'}`,
                        style: { width: `calc((100% - 4rem) * ${(value / end).toFixed(4)})` },
                        'aria-hidden': true,
                      }),
                      h('span', { className: 'text-xs text-muted-foreground tabular-nums' }, h('span', { className: 'sr-only' }, `${contender.label}: `), `${format(value)} ms`),
                    );
                  }),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'grid gap-4 text-xs text-muted-foreground md:grid-cols-[220px_minmax(0,1fr)]', 'aria-hidden': true },
            h('span', { className: 'max-md:hidden' }),
            h(
              'div',
              { className: 'relative h-5 border-t', style: { marginRight: '4rem' } },
              ...ticks.map((tick, index) =>
                h(
                  'span',
                  {
                    key: tick,
                    className: 'absolute top-1 -translate-x-1/2 whitespace-nowrap tabular-nums first:translate-x-0 last:-translate-x-full',
                    style: { left: `${(tick / end) * 100}%` },
                  },
                  index === ticks.length - 1 ? `${tick} ms` : tick,
                ),
              ),
            ),
          ),
        )
      : null,
  );
}
