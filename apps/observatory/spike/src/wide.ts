// The wide-grid spike (throwaway): the wide sheet's grid on TanStack Virtual,
// a column virtualizer beside the rows', the key columns pinned by
// `position: sticky` inside translated content (as the contender's gutter
// is), heat cells by `color-mix(in oklab)`, over the wide sheet's own values
// held in memory (spike/wide-data.ts), so a run reads the grid, not the
// engine. Query: row, text (px), width (a day column's px), pin (key
// columns pinned, 0–2), cells (heat | text).

import { createElement as h, memo, useLayoutEffect, useReducer, useRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useVirtualizer } from '@tanstack/react-virtual';
import './wide.css';

const params = new URLSearchParams(location.search);
const ROW = Number(params.get('row') ?? 30);
const TEXT = Number(params.get('text') ?? 14);
const WIDTH = Number(params.get('width') ?? 120);
/** The key columns pinned: Station and Place, so 0–2. */
const PIN = Math.max(0, Math.min(2, Math.trunc(Number(params.get('pin') ?? 2)) || 0));
const HEAT = (params.get('cells') ?? 'heat') === 'heat';
/** The table's lengths scale with the text, as `density`'s `Sizes` do. */
const SCALE = TEXT / 14;
const PAD = Math.round(8 * SCALE);
const KEY_WIDTH = Math.round(160 * SCALE);
const NUMBER_PX = 8.4 * SCALE;
const BUDGET = Math.max(1, Math.floor((WIDTH - 2 * PAD - 1) / NUMBER_PX));

interface Data {
  days: string[];
  station: string[];
  place: string[];
  min: number;
  max: number;
  values: Float32Array;
}

/** What the last commit rendered, for the frame sample's coverage. */
const rendered = { r0: 0, r1: -1, c0: 0, c1: -1 };

function fit(value: number): string {
  if (Number.isNaN(value)) return 'NULL';
  const text = value.toFixed(1);
  return text.length <= BUDGET ? text : value.toFixed(0);
}

interface RowProps {
  data: Data;
  row: number;
  top: number;
  c0: number;
  c1: number;
  gap: number;
  gutter: number;
  width: number;
}

const Row = memo(function Row({ data, row, top, c0, c1, gap, gutter, width }: RowProps): ReactNode {
  const days = data.days.length;
  // A file of one value would divide by zero: every cell at the ramp's start.
  const range = data.max - data.min || 1;
  const cells: ReactNode[] = [];
  for (let c = c0; c <= c1; c++) {
    const v = data.values[row * days + c]!;
    const nan = Number.isNaN(v);
    const t = nan ? 0 : (v - data.min) / range;
    cells.push(
      h(
        'div',
        {
          key: c,
          className: `cell float${nan ? ' null' : ''}${HEAT && !nan ? (t > 0.55 ? ' heat deep' : ' heat') : ''}`,
          style: HEAT && !nan ? ({ width: WIDTH, '--t': `${(t * 100).toFixed(1)}%` } as React.CSSProperties) : { width: WIDTH },
        },
        fit(v),
      ),
    );
  }
  const keys = [data.station[row]!, data.place[row]!].slice(0, PIN);
  return h(
    'div',
    { className: row % 2 ? 'row odd' : 'row', style: { width, height: ROW, transform: `translateY(${top}px)` } },
    h('div', { className: 'num', style: { width: gutter } }, (row + 1).toLocaleString('en-US')),
    keys.map((key, i) => h('div', { key: i, className: `cell pin${i === keys.length - 1 ? ' last' : ''}`, style: { width: KEY_WIDTH, left: gutter + i * KEY_WIDTH } }, key)),
    h('div', { className: 'gap', style: { width: gap } }),
    cells,
  );
});

function Grid({ data }: { data: Data }): ReactNode {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const rows = data.station.length;
  const days = data.days.length;
  const gutter = Math.round((6 * 7.5 + 24) * SCALE);
  const pinned = gutter + PIN * KEY_WIDTH;
  const width = pinned + days * WIDTH;

  const rowV = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ROW,
    overscan: 4,
    scrollMargin: ROW,
  });
  const colV = useVirtualizer({
    horizontal: true,
    count: days,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => WIDTH,
    overscan: 2,
    paddingStart: pinned,
  });

  useLayoutEffect(() => {
    const scroller = scrollerRef.current!;
    scroller.focus({ preventScroll: true });
    const g = globalThis as Record<string, unknown>;
    const publish = (): void => {
      const rect = scroller.getBoundingClientRect();
      g.__seizaTargets = {
        'table-scroll-track': [rect.right - 12, rect.top, 12, rect.height],
        table: [rect.left, rect.top, rect.width, rect.height],
      };
    };
    publish();
    g.__wide = { rows, days, rowHeight: ROW, width: WIDTH, totalWidth: width, pinned };
    g.__seizaFrameSample = () => {
      const top = scroller.scrollTop;
      const left = scroller.scrollLeft;
      const bodyH = scroller.clientHeight - ROW;
      const r0 = Math.floor(top / ROW);
      const r1 = Math.min(rows - 1, Math.floor((top + bodyH - 1) / ROW));
      const x0 = left + pinned;
      const x1 = left + scroller.clientWidth;
      const c0 = Math.max(0, Math.floor((x0 - pinned) / WIDTH));
      const c1 = Math.min(days - 1, Math.floor((x1 - 1 - pinned) / WIDTH));
      const cells = (r1 - r0 + 1) * (c1 - c0 + 1 + PIN);
      const covered = rendered.r0 <= r0 && rendered.r1 >= r1 && rendered.c0 <= c0 && rendered.c1 >= c1;
      return { cells, top, left, covered };
    };
    rerender();
  }, []);

  const items = rowV.getVirtualItems();
  const cols = colV.getVirtualItems();
  const c0 = cols[0]?.index ?? 0;
  const c1 = cols.at(-1)?.index ?? -1;
  const gap = (cols[0]?.start ?? pinned) - pinned;
  useLayoutEffect(() => {
    rendered.r0 = items[0]?.index ?? 0;
    rendered.r1 = items.at(-1)?.index ?? -1;
    rendered.c0 = c0;
    rendered.c1 = c1;
  });

  const head = h(
    'div',
    { className: 'head', style: { width, height: ROW, lineHeight: `${ROW - 1}px` } },
    h('div', { className: 'num', style: { width: gutter, padding: `0 ${PAD}px` } }),
    ['Station', 'Place'].slice(0, PIN).map((key, i) =>
      h('div', { key, className: `cell pin${i === PIN - 1 ? ' last' : ''}`, style: { width: KEY_WIDTH, left: gutter + i * KEY_WIDTH, padding: `0 ${PAD}px` } }, key),
    ),
    h('div', { className: 'gap', style: { width: gap } }),
    cols.map((col) => h('div', { key: col.index, className: 'cell float', style: { width: WIDTH, padding: `0 ${PAD}px` } }, data.days[col.index])),
  );

  return h(
    'div',
    { className: 'frame' },
    h(
      'div',
      { ref: scrollerRef, className: 'scroller', tabIndex: 0, style: { fontSize: TEXT, lineHeight: `${ROW}px`, '--pad': `${PAD}px` } as React.CSSProperties },
      head,
      h(
        'div',
        { className: 'spacer', style: { width, height: rows * ROW } },
        h(
          'div',
          { className: 'content' },
          items.map((item) => h(Row, { key: item.index, data, row: item.index, top: item.start - ROW, c0, c1, gap, gutter, width })),
        ),
      ),
    ),
  );
}

async function main(): Promise<void> {
  const [keys, buffer] = await Promise.all([fetch('/wide/keys.json').then((r) => r.json()), fetch('/wide/values.f32').then((r) => r.arrayBuffer())]);
  const data: Data = { ...keys, values: new Float32Array(buffer) };
  // Scripts wait for `__wide`, set in the grid's first commit.
  createRoot(document.getElementById('root')!).render(h('div', { className: 'page' }, h(Grid, { data })));
}

void main();
