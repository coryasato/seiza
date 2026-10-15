// The spike page: fake rows in a scaled native scroller, laid out by TanStack
// Virtual over the full count (`?v=full`) or a moving window (`?v=window`),
// or plain TanStack on an unscaled scroller (`?v=plain`). Query options:
// rows, spacer, page, zone, anchor (set | by | none), keys (own | native), probe (record the visible
// row each frame), bar=classic (an always-visible scrollbar).

import { createElement as h, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { useVirtualizer, Virtualizer } from '@tanstack/react-virtual';
import { ScaledScroller, type AnchorMethod } from './scaled.ts';

const params = new URLSearchParams(location.search);
const variant = (params.get('v') ?? 'window') as 'full' | 'window' | 'plain';
const ROWS = Number(params.get('rows') ?? 1_567_523);
const ROW_HEIGHT = 30;
const WINDOW_ROWS = 4096;
const options = {
  rows: ROWS,
  rowHeight: ROW_HEIGHT,
  spacer: Number(params.get('spacer') ?? 2 ** 24),
  page: Number(params.get('page') ?? 1800),
  zone: Number(params.get('zone') ?? 2 ** 20),
  anchor: (params.get('anchor') ?? 'by') as AnchorMethod,
  keys: (params.get('keys') ?? 'own') as 'own' | 'native',
  rebaseRows: variant === 'window' ? WINDOW_ROWS / 4 : 2048,
};

const COLUMNS = [
  { name: 'spkid', width: 96 },
  { name: 'full_name', width: 220 },
  { name: 'class', width: 56 },
  { name: 'neo', width: 48 },
  { name: 'pha', width: 48 },
  { name: 'H', width: 72 },
  { name: 'diameter', width: 88 },
  { name: 'albedo', width: 72 },
  { name: 'a', width: 96 },
  { name: 'e', width: 96 },
  { name: 'first_obs', width: 104 },
];

function cell(row: number, column: number): string {
  const x = Math.imul(row + 1, 2654435761 + column * 97) >>> 0;
  switch (column) {
    case 0:
      return String(2000001 + row);
    case 1:
      return `${row + 1} Asteroid ${(x % 9000) + 1000}`;
    case 2:
      return ['MBA', 'APO', 'AMO', 'TJN', 'OMB'][x % 5]!;
    case 3:
    case 4:
      return x % 7 ? 'N' : 'Y';
    case 10:
      return `${1900 + (x % 120)}-${String((x % 12) + 1).padStart(2, '0')}-${String((x % 28) + 1).padStart(2, '0')}`;
    default:
      return x % 11 ? ((x % 1_000_000) / 1000).toFixed(3) : '';
  }
}

function Row({ row, top }: { row: number; top: number }): ReactNode {
  return h(
    'div',
    { className: 'row', 'data-row': row, style: { transform: `translateY(${top}px)` } },
    COLUMNS.map((column, index) => h('span', { key: column.name, style: { width: column.width } }, cell(row, index))),
  );
}

type Spike = {
  model?: ScaledScroller;
  virtualizer?: Virtualizer<HTMLDivElement, Element>;
  variant: string;
  options: typeof options;
  /** A detached virtualizer over `count` rows, kept in `held` so its memory
   *  can be read; returns how long its measurements took to build (ms). */
  build(count: number): number;
  held: unknown[];
};
const spike: Spike = {
  variant,
  options,
  held: [],
  build(count) {
    const virtualizer = new Virtualizer<HTMLDivElement, Element>({
      count,
      getScrollElement: () => null,
      estimateSize: () => ROW_HEIGHT,
      scrollToFn: () => {},
      observeElementRect: () => {},
      observeElementOffset: () => {},
    });
    const start = performance.now();
    virtualizer.getTotalSize(); // builds every row's measurements
    const ms = performance.now() - start;
    spike.held.push(virtualizer);
    return ms;
  },
};
(globalThis as { __spike?: Spike }).__spike = spike;

function publishTargets(scroller: HTMLElement): void {
  const rect = scroller.getBoundingClientRect();
  const bar = scroller.offsetWidth - scroller.clientWidth || 16;
  (globalThis as { __seizaTargets?: Record<string, number[]> }).__seizaTargets = {
    'table-scroll-track': [rect.right - bar, rect.top, bar, rect.height],
    table: [rect.left, rect.top, rect.width, rect.height],
  };
}

function Scaled(): ReactNode {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<ScaledScroller | null>(null);
  const [, setReady] = useState(false);

  // Before the virtualizer's own layout effects: it subscribes to the model.
  useLayoutEffect(() => {
    const model = new ScaledScroller(scrollerRef.current!, spacerRef.current!, contentRef.current!, options);
    modelRef.current = model;
    spike.model = model;
    publishTargets(scrollerRef.current!);
    setReady(true);
    return () => model.destroy();
  }, []);

  const [, rerender] = useReducer((count: number) => count + 1, 0);
  // The window's base and the content's, as last rendered.
  const rendered = useRef({ window: 0, content: 0 });
  const windowBase = () => {
    const model = modelRef.current;
    if (!model || variant !== 'window') return 0;
    return Math.max(0, Math.min(ROWS - WINDOW_ROWS, model.base - WINDOW_ROWS / 2));
  };

  const virtualizer = useVirtualizer({
    count: variant === 'window' ? Math.min(ROWS, WINDOW_ROWS) : ROWS,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
    observeElementOffset: (_instance, cb) =>
      modelRef.current?.subscribe((v, scrolling) => {
        const base = windowBase();
        cb(v - base * ROW_HEIGHT, scrolling);
        // Rows are placed against the content's base, and a moved window
        // shifts their indexes: either can change while TanStack's range
        // doesn't, and then it doesn't re-render; make it. `?stale` leaves
        // it out: the negative control for the frame probe.
        const moved = base !== rendered.current.window || modelRef.current!.base !== rendered.current.content;
        if (moved && !params.has('stale')) flushSync(rerender);
      }),
    scrollToFn: (offset) => modelRef.current?.jumpTo(offset + windowBase() * ROW_HEIGHT),
  });
  spike.virtualizer = virtualizer;
  useFirstRowsMark();

  const model = modelRef.current;
  const base = windowBase();
  rendered.current = { window: base, content: model?.base ?? 0 };
  const rows = model
    ? virtualizer.getVirtualItems().map((item) => {
        const row = base + item.index;
        return h(Row, { key: row, row, top: (row - model.base) * ROW_HEIGHT });
      })
    : [];

  return h(
    'div',
    { ref: scrollerRef, className: 'scroller', tabIndex: 0 },
    h('div', { ref: spacerRef, className: 'spacer' }, h('div', { ref: contentRef, className: 'content' }, rows)),
  );
}

function Plain(): ReactNode {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: ROWS,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });
  spike.virtualizer = virtualizer;
  useFirstRowsMark();
  useLayoutEffect(() => publishTargets(scrollerRef.current!), []);
  return h(
    'div',
    { ref: scrollerRef, className: 'scroller', tabIndex: 0 },
    h(
      'div',
      { className: 'spacer', style: { height: virtualizer.getTotalSize() } },
      virtualizer.getVirtualItems().map((item) => h(Row, { key: item.index, row: item.index, top: item.start })),
    ),
  );
}

/** Marks `spike:rows` in the commit that first puts rows in the DOM. */
let marked = false;
function useFirstRowsMark(): void {
  useLayoutEffect(() => {
    if (marked || !document.querySelector('.row')) return;
    marked = true;
    performance.mark('spike:rows');
  });
}

// The row at the top of the viewport and how far it's scrolled past, read
// from the DOM each frame: what's on screen, whatever the model believes.
if (params.has('probe')) {
  (globalThis as { __seizaFrameSample?: () => object }).__seizaFrameSample = () => {
    const model = spike.model;
    const scroller = document.querySelector('.scroller');
    if (!scroller) return {};
    const rect = scroller.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + 40, rect.top + 1)?.closest('.row');
    const row = hit ? Number(hit.getAttribute('data-row')) : -1;
    const shown = hit ? row * ROW_HEIGHT + (rect.top - hit.getBoundingClientRect().top) : -1;
    return { v: model?.v ?? scroller.scrollTop, s: scroller.scrollTop, shown, anchors: model?.reanchors.length ?? 0 };
  };
}

if (params.get('bar') === 'classic') document.documentElement.classList.add('classic');
performance.mark('spike:mount');
createRoot(document.getElementById('root')!).render(h(variant === 'plain' ? Plain : Scaled));
