/**
 * The meter (`docs/DECISIONS.md`, "Page", the meter): graphs over the
 * frame's corner, dark in both themes, the status bar's numbers apart.
 * Frame time over 10 s (each bar the slowest frame in its slice, in display
 * frames, a dashed line at 1.5; late bars amber on both sides), with FPS
 * and the late count in its corner; memory over a minute, one bar a
 * measurement. Open, a pill, or hidden; in one corner, bottom right by
 * default; both kept per visitor, and a phone starts with the pill.
 *
 * It ignores the pointer but for its buttons and its header, so a click, a
 * wheel, or a hover under it reaches the contender. The header is a drag
 * handle (pointer capture, so a drag that crosses into the frame isn't lost
 * to it) that snaps to the nearest corner on release; the corner picker and
 * the arrow keys on the header or the picker move it too.
 *
 * The readout's cost ("Page"): a box of fixed size with `contain: strict`,
 * its picker and the drag's outlines outside it; each graph one canvas,
 * drawn once per refresh that changed it (`live.ts`'s `subscribeMeter`),
 * its text written by reference, never by a React render; nothing at all
 * while it's hidden or behind the panel (it isn't mounted).
 */

import { Info, Maximize2, Minus, X } from 'lucide-react';
import { createElement as h, Fragment, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { Side } from '../../contenders/contract.ts';
import { closeExplainer, Explainer } from './explainer.ts';
import { meterSnapshot, subscribeMeter, type MeterSide } from './live.ts';
import { LABELS, withUnit } from './readouts.ts';

export type MeterMode = 'open' | 'pill' | 'off';
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];
const NAMES: Record<Corner, string> = { tl: 'top left', tr: 'top right', bl: 'bottom left', br: 'bottom right' };

/** The one key: `{"mode", "corner"}`. */
export const METER_KEY = 'seiza-observatory-meter';
/** Where a phone's layout ends: Tailwind's `md`, as `page.css`'s. */
const DESKTOP = '(min-width: 48rem)';

interface MeterState {
  mode: MeterMode;
  corner: Corner;
}

/** The stored state, read once: a phone starts with the pill unless the
 *  visitor hid the meter. Storage can throw (blocked site data). */
function stored(): MeterState {
  let saved: Partial<MeterState> = {};
  try {
    saved = JSON.parse(localStorage.getItem(METER_KEY) ?? '{}') as Partial<MeterState>;
  } catch {}
  const mode: MeterMode = saved.mode === 'off' || saved.mode === 'pill' || saved.mode === 'open' ? saved.mode : 'open';
  const corner: Corner = CORNERS.includes(saved.corner as Corner) ? (saved.corner as Corner) : 'br';
  return { mode: mode === 'open' && !desktop() ? 'pill' : mode, corner };
}

const desktop = () => matchMedia(DESKTOP).matches;

let state: MeterState | null = null;
const listeners = new Set<() => void>();
const current = () => (state ??= stored());

function setMeter(next: Partial<MeterState>): void {
  state = { ...current(), ...next };
  try {
    localStorage.setItem(METER_KEY, JSON.stringify(state));
  } catch {}
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The meter's mode and corner, for the status bar's Meter and the meter. */
export const useMeter = (): MeterState => useSyncExternalStore(subscribe, current, () => ({ mode: 'off', corner: 'br' }));

/** The status bar's Meter: hidden ↔ shown (open on a desktop, the pill on a phone). */
export const toggleMeter = (): void => setMeter({ mode: current().mode === 'off' ? (desktop() ? 'open' : 'pill') : 'off' });

/** The corner an arrow key moves to from `corner`. */
function step(corner: Corner, key: string): Corner {
  const [v, x] = corner as unknown as [string, string];
  if (key === 'ArrowUp') return `t${x}` as Corner;
  if (key === 'ArrowDown') return `b${x}` as Corner;
  if (key === 'ArrowLeft') return `${v}l` as Corner;
  if (key === 'ArrowRight') return `${v}r` as Corner;
  return corner;
}

// ---------------------------------------------------------------- drawing

/** In display frames: a bar at 3 frames is full height, so the dashed line
 *  (late, 1.5 frames) sits halfway at any refresh rate. */
const FULL_FRAMES = 3;
const BAR = 'oklch(0.8 0 0 / 42%)';
const LATE = 'oklch(0.85 0.16 90)';

/** Sizes `canvas`'s backing store to its box at the device's pixel ratio. */
function fit(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ratio = devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d')!;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  return context;
}

/** Bars from the bottom, `gap` CSS px apart; null draws nothing, and no values clear it. */
function bars(canvas: HTMLCanvasElement, values: (number | null)[], top: number, gap: number, late: boolean[] = []): void {
  const context = fit(canvas);
  const { clientWidth: width, clientHeight: height } = canvas;
  const each = (width - gap * (values.length - 1)) / values.length;
  values.forEach((value, index) => {
    if (value === null || value <= 0) return;
    const tall = Math.max(1, Math.round((Math.min(value, top) / top) * height));
    context.fillStyle = late[index] ? LATE : BAR;
    context.fillRect(index * (each + gap), height - tall, each, tall);
  });
}

/** The slowest of each `n` neighbours: the pill's fewer, wider bars. */
const coarser = (values: (number | null)[], n: number) =>
  Array.from({ length: Math.ceil(values.length / n) }, (_, index) => values.slice(index * n, index * n + n).reduce<number | null>((max, value) => (value === null ? max : Math.max(max ?? 0, value)), null));
/** Late where any of each `n` neighbours is. */
const coarserLate = (late: boolean[], n: number) => Array.from({ length: Math.ceil(late.length / n) }, (_, index) => late.slice(index * n, index * n + n).some(Boolean));

/** A memory graph's top: the readings' largest, rounded up to a round number. */
function memoryTop(values: (number | null)[]): number {
  const max = Math.max(1, ...values.filter((value) => value !== null));
  const unit = 10 ** Math.floor(Math.log10(max));
  return Math.ceil((max * 1.1) / unit) * unit;
}

const fpsText = (side: MeterSide | null) => (side?.readings.fps == null ? 'idle' : `${side.readings.fps} fps`);
const memText = (side: MeterSide | null) => {
  const latest = side?.readings.memoryMiB.at(-1);
  return latest == null ? '—' : withUnit(latest, 'MiB');
};
const plotLabel = (side: MeterSide | null, label: string) => `Frame times for ${label}, the last 10 seconds: ${side?.readings.late ?? 0} late`;

/** Writes `text` into `element` only if it differs. */
const write = (element: Element | null, text: string) => {
  if (element && element.textContent !== text) element.textContent = text;
};

// ---------------------------------------------------------------- the meter

const BUTTON = 'observatory-meter-button';

const PickerIcon = ({ corner }: { corner: Corner }) =>
  h(
    'svg',
    { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true },
    h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 3 }),
    h('circle', { cx: corner[1] === 'l' ? 8 : 16, cy: corner[0] === 't' ? 8 : 16, r: 2.5, fill: 'currentColor', stroke: 'none' }),
  );

interface Props {
  side: Side;
  /** The panel is open: the meter hides under it. */
  panel: boolean;
}

export function Meter({ side, panel }: Props) {
  const { mode, corner } = useMeter();
  const [picker, setPicker] = useState(false);
  /** While dragged: the corner it would snap to. */
  const [nearest, setNearest] = useState<Corner | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const meter = useRef<HTMLElement>(null);
  const pickerButton = useRef<HTMLButtonElement>(null);
  /** The pointer's offset in the meter, and the meter's box in the stage at the press. */
  const grab = useRef<{ dx: number; dy: number; left: number; top: number; width: number; height: number; near: Corner } | null>(null);
  const label = LABELS[side];
  const shown = mode !== 'off' && !panel;

  // Draws on each refresh that changed the readings, and once at mount.
  useEffect(() => {
    if (!shown) return;
    const draw = () => {
      const root = meter.current;
      if (!root) return;
      const now = meterSnapshot();
      const readings = now?.side === side ? now : null;
      const frames = readings?.readings.bars ?? [];
      const lateBars = readings?.readings.lateBars ?? [];
      const late = readings?.readings.late ?? 0;
      write(root.querySelector('[data-meter-tag]'), !readings?.filled ? 'loading' : readings.warm ? 'warm' : 'cold load');
      write(root.querySelector('[data-meter-late]'), `${late} late`);
      root.querySelector('[data-meter-late]')?.classList.toggle('observatory-meter-warn', late > 0);
      write(root.querySelector('[data-meter-memory]'), memText(readings));
      const plot = root.querySelector<HTMLCanvasElement>('[data-meter-frames]');
      if (plot) {
        plot.setAttribute('aria-label', plotLabel(readings, label));
        bars(plot, mode === 'pill' ? coarser(frames, 2) : frames, FULL_FRAMES, mode === 'pill' ? 0 : 1, mode === 'pill' ? coarserLate(lateBars, 2) : lateBars);
      }
      write(root.querySelector('[data-meter-fps]'), fpsText(readings));
      const memory = root.querySelector<HTMLCanvasElement>('[data-meter-memory-plot]');
      if (memory) {
        const values = readings?.readings.memoryMiB ?? [];
        memory.setAttribute('aria-label', `Memory for ${label} over the last minute, now ${memText(readings)}`);
        // A minute's slots, the newest at the right.
        bars(memory, values, memoryTop(values), 2);
      }
    };
    draw();
    // A new box (a phone's rotation, a resize) needs the bitmap redrawn at its size.
    const resized = new ResizeObserver(draw);
    if (meter.current) resized.observe(meter.current);
    const unsubscribe = subscribeMeter(draw);
    return () => {
      resized.disconnect();
      unsubscribe();
    };
  }, [shown, mode, side]);

  if (!shown) return null;

  const move = (to: Corner) => setMeter({ corner: to });
  const onKey = (event: KeyboardEvent) => {
    if (!event.key.startsWith('Arrow')) return;
    event.preventDefault();
    move(step(corner, event.key));
  };

  // The drag: the layer follows the pointer by a transform (no layout, and
  // no render per move); the outlines show the corner it snaps to.
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('button') || event.button !== 0) return;
    const box = layer.current!.getBoundingClientRect();
    const stage = layer.current!.parentElement!.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    grab.current = { dx: event.clientX - box.left, dy: event.clientY - box.top, left: box.left - stage.left, top: box.top - stage.top, width: box.width, height: box.height, near: corner };
    closeExplainer();
    setPicker(false);
    setNearest(corner);
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const held = grab.current;
    const element = layer.current;
    if (!held || !element) return;
    const stage = element.parentElement!.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - stage.left - held.dx, stage.width - held.width));
    const y = Math.max(0, Math.min(event.clientY - stage.top - held.dy, stage.height - held.height));
    element.style.transform = `translate(${x - held.left}px, ${y - held.top}px)`;
    const near = `${y + held.height / 2 < stage.height / 2 ? 't' : 'b'}${x + held.width / 2 < stage.width / 2 ? 'l' : 'r'}` as Corner;
    held.near = near;
    setNearest((was) => (was === near ? was : near));
  };
  const drop = () => {
    const held = grab.current;
    if (!held) return;
    grab.current = null;
    layer.current?.removeAttribute('style');
    move(held.near);
    setNearest(null);
  };

  const pick = (to: Corner) => {
    move(to);
    setPicker(false);
    pickerButton.current?.focus();
  };
  const pickerKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setPicker(false);
      pickerButton.current?.focus();
    } else onKey(event);
  };

  const dot = h('span', { className: `size-2 shrink-0 rounded-full ${side === 'gpui' ? 'bg-series-gpui' : 'bg-series-tanstack'}`, 'aria-hidden': true });
  const iconButton = (props: Record<string, unknown>, icon: ReactNode) => h('button', { type: 'button', className: BUTTON, ...props }, icon);
  const dragging = nearest !== null;

  const open =
    mode === 'open'
      ? h(
          'section',
          { ref: meter, className: 'observatory-meter dark', 'aria-label': 'Meter: what the table is doing now' },
          h(
            'div',
            { 'data-meter-handle': '', className: 'observatory-meter-handle', onPointerDown: down, onPointerMove: drag, onPointerUp: drop, onPointerCancel: drop, onLostPointerCapture: drop, onKeyDown: onKey },
            dot,
            h('span', null, label),
            h('span', { 'data-meter-tag': '', className: 'observatory-meter-tag' }, 'loading'),
            h('span', { className: 'flex-1' }),
            iconButton({ ref: pickerButton, 'data-meter-picker': '', 'aria-label': `Meter position: ${NAMES[corner]}`, 'aria-expanded': picker, onClick: () => setPicker(!picker) }, h(PickerIcon, { corner })),
            iconButton({ 'aria-label': 'Shrink the meter to a pill', onClick: () => setMeter({ mode: 'pill' }) }, h(Minus, { 'aria-hidden': true })),
            iconButton({ 'aria-label': 'Hide the meter', onClick: () => setMeter({ mode: 'off' }) }, h(X, { 'aria-hidden': true })),
          ),
          h(
            'div',
            { className: 'observatory-meter-box' },
            h(
              Explainer,
              {
                className: 'observatory-meter-title',
                placement: corner[0] === 'b' ? 'above-start' : 'below-start',
                width: 300,
                popoverClass: 'dark',
                trigger: h(Fragment, null, 'frame time', h(Info, { 'aria-hidden': true })),
                triggerProps: { 'aria-label': 'About frame time', className: 'observatory-meter-info' },
              },
              'FPS counts frames drawn while something moves, and reads “idle” when nothing has drawn for a moment. ',
              h(
                'span',
                { className: 'mt-1 block text-muted-foreground' },
                'It isn’t the comparison: an idle GPUI table draws nothing, it stops at your display’s refresh rate, and a DOM table can scroll at full rate on the browser’s thread while its own frames run late. Smooth, in the status bar, is the comparison; the amber bars are its late frames.',
              ),
            ),
            h('span', { className: 'observatory-meter-value' }, h('span', { 'data-meter-fps': '' }, 'idle'), ' · ', h('span', { 'data-meter-late': '' }, '0 late')),
            h('div', { className: 'observatory-meter-plot' }, h('canvas', { 'data-meter-frames': '', role: 'img', 'aria-label': plotLabel(null, label) }), h('span', { className: 'observatory-meter-threshold', 'aria-hidden': true })),
            h('div', { className: 'observatory-meter-axis' }, h('span', null, '10 s'), h('span', null, 'dashed: late, 1.5 frames'), h('span', null, 'now')),
          ),
          h(
            'div',
            { className: 'observatory-meter-box' },
            h('span', { className: 'observatory-meter-title' }, 'memory'),
            h('span', { 'data-meter-memory': '', className: 'observatory-meter-value' }, '—'),
            h('div', { className: 'observatory-meter-plot observatory-meter-plot-memory' }, h('canvas', { 'data-meter-memory-plot': '', role: 'img', 'aria-label': `Memory for ${label} over the last minute` })),
            h('div', { className: 'observatory-meter-axis' }, h('span', null, '1 min'), h('span', null, 'every 5 s'), h('span', null, 'now')),
          ),
        )
      : h(
          'section',
          { ref: meter, className: 'observatory-meter observatory-meter-pill dark', 'aria-label': 'Meter, shrunk' },
          dot,
          h('span', { 'data-meter-late': '', className: 'tabular-nums' }, '0 late'),
          h('canvas', { 'data-meter-frames': '', className: 'observatory-meter-spark', role: 'img', 'aria-label': plotLabel(null, label) }),
          h('span', { 'data-meter-memory': '', className: 'tabular-nums' }, '—'),
          iconButton({ 'aria-label': 'Open the meter', onClick: () => setMeter({ mode: 'open' }) }, h(Maximize2, { 'aria-hidden': true })),
        );

  return h(
    Fragment,
    null,
    dragging ? CORNERS.map((at) => h('div', { key: at, 'data-meter-slot': at, 'data-corner': at, 'data-mode': mode, 'data-near': at === nearest ? '' : undefined, className: 'observatory-meter-slot', 'aria-hidden': true })) : null,
    h(
      'div',
      { ref: layer, 'data-meter': mode, 'data-corner': corner, 'data-dragging': dragging ? '' : undefined, className: 'observatory-meter-layer' },
      open,
      picker && mode === 'open'
        ? h(
            'div',
            { role: 'group', 'aria-label': 'Move the meter', className: 'observatory-meter-picker dark' },
            ...CORNERS.map((at) =>
              iconButton(
                { key: at, 'data-meter-corner': at, 'aria-label': `Move the meter to the ${NAMES[at]}`, 'aria-pressed': at === corner, autoFocus: at === corner, onClick: () => pick(at), onKeyDown: pickerKey },
                h(PickerIcon, { corner: at }),
              ),
            ),
          )
        : null,
    ),
  );
}
