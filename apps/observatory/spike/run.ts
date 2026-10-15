// Drives the spike page in Chromium, Firefox, and WebKit and writes what it
// found to ../perf/results/<date>-<label>-<scenario>.json.
//
//   node apps/observatory/spike/run.ts [--only caps,reach,continuity,bar,tanstack,latency,work] [--runs 10] [--label spike] [--out <dir>]
//     [--browsers chromium,firefox,webkit] [--anchors set,by] [--variant window|full] [--stale] [--no-build]
//     [--sessions 3] [--count 10]
//
// Builds the page first (vite build; --no-build serves the last dist/), then
// serves dist/ with `vite preview`. --anchors: the re-anchor methods `reach`
// compares; --variant: the TanStack layout every scenario but `tanstack`
// opens; --stale: the negative control (no forced render when the rows'
// bases move). `latency` and `work` (latency.ts) also drive Tycho's release
// build (`just tycho build` first), Chromium only: --sessions browsers per
// side, --count inputs of each kind per session; `work` takes --runs.

import { writeFileSync } from 'node:fs';
import { build } from 'vite';
import { chromium, firefox, webkit, type BrowserType, type Page } from '@playwright/test';
import { frameRecorder, open, recordedBetween, waitMark, type RecordedFrame } from '../../../shared-web/perf/harness.ts';
import { flag, machineInfo, option, percentiles } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { nativeFling, nativeWheel, openWithScrollbars, ROW_HEIGHT, steadyFling } from './input.ts';

const dir = import.meta.dirname;
const only = option('only')?.split(',') ?? ['caps', 'reach', 'continuity', 'bar', 'tanstack'];
const runs = Number(option('runs') ?? 10);
const label = option('label') ?? 'spike';
const outDir = option('out') ?? `${import.meta.dirname}/../perf/results`;
const date = new Date().toISOString().slice(0, 10);
const engines = ([
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
] as [string, BrowserType][]).filter(([name]) => (option('browsers') ?? 'chromium,firefox,webkit').split(',').includes(name));

if (!flag('no-build')) await build({ root: dir, configFile: `${dir}/vite.config.ts`, logLevel: 'warn' });
const server = await serveApp(undefined, { webDir: dir, port: 4192 });

function save(scenario: string, results: unknown): void {
  const path = `${outDir}/${date}-${label}-${scenario}.json`;
  writeFileSync(path, `${JSON.stringify({ date, ...machineInfo(), scenario, results }, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

type Frame = RecordedFrame<{ v: number; s: number; shown: number; anchors: number }>;

async function openSpike(engine: BrowserType, params: Record<string, string>, init: (() => void)[] = [], scrollbars = false) {
  params = { v: option('variant') ?? 'window', ...params };
  console.log(`${engine.name()} ${new URLSearchParams(params)}`);
  const browsing = scrollbars ? await openWithScrollbars(engine, server.url, { params, init }) : await open(engine, server.url, { params, init });
  await waitMark(browsing.page, 'spike:rows');
  await browsing.page.focus('.scroller');
  return browsing;
}

/** Waits until the model has had no scroll event for its idle time. */
async function idle(page: Page): Promise<void> {
  await page.waitForTimeout(100);
  await page.waitForFunction(() => {
    const model = (globalThis as { __spike?: { model?: { scrolling: boolean } } }).__spike?.model;
    return model ? !model.scrolling : true;
  }, undefined, { polling: 20, timeout: 30_000 });
  await page.waitForTimeout(50);
}

/** What the viewport shows: the first and last visible rows, the last's
 *  bottom against the viewport's, and the model's V and s. */
async function shown(page: Page) {
  return page.evaluate((rowHeight) => {
    const scroller = document.querySelector('.scroller')!;
    const box = scroller.getBoundingClientRect();
    const bottom = box.top + scroller.clientHeight;
    const rows = [...document.querySelectorAll('.row')].map((row) => ({ row: Number(row.getAttribute('data-row')), rect: row.getBoundingClientRect() }));
    const visible = rows.filter(({ rect }) => rect.bottom > box.top + 0.5 && rect.top < bottom - 0.5).sort((a, b) => a.row - b.row);
    const first = visible[0];
    const last = visible.at(-1);
    const model = (globalThis as { __spike?: { model?: { v: number; s: number; d: number; range: number; total: number; stretch: number; reanchors: unknown[] } } }).__spike?.model;
    return {
      first: first?.row ?? -1,
      firstOffset: first ? Number((box.top - first.rect.top).toFixed(2)) : null,
      last: last?.row ?? -1,
      lastBottomGap: last ? Number((bottom - last.rect.bottom).toFixed(2)) : null,
      shownV: first ? first.row * rowHeight + (box.top - first.rect.top) : -1,
      v: model?.v ?? scroller.scrollTop,
      s: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      barWidth: (scroller as HTMLElement).offsetWidth - scroller.clientWidth,
      stretch: model?.stretch ?? 1,
      reanchors: model?.reanchors.length ?? 0,
    };
  }, ROW_HEIGHT);
}

// The tallest element each browser lays out, and the furthest a scroller over
// it scrolls.
async function caps() {
  const out: Record<string, unknown> = {};
  for (const [name, engine] of engines) {
    const { page, close } = await openSpike(engine, {});
    out[name] = await page.evaluate(() =>
      [17_895_697, 17_895_700, 33_554_428, 33_554_432, 47_025_690, 1e9].map((height) => {
        const scroller = document.createElement('div');
        scroller.style.cssText = 'position:fixed;top:0;left:0;width:100px;height:100px;overflow:auto';
        const child = document.createElement('div');
        child.style.height = `${height}px`;
        scroller.append(child);
        document.body.append(scroller);
        scroller.scrollTop = 1e10;
        const result = { asked: height, laidOut: child.getBoundingClientRect().height, scrollHeight: scroller.scrollHeight, maxScrollTop: scroller.scrollTop + 100 };
        scroller.remove();
        return result;
      }),
    );
    await close();
  }
  return out;
}

/** The thumb's center, from the scroller's geometry (classic scrollbars). */
async function thumb(page: Page): Promise<{ x: number; y: number; top: number; bottom: number; bar: number }> {
  return page.evaluate(() => {
    const scroller = document.querySelector('.scroller') as HTMLElement;
    const box = scroller.getBoundingClientRect();
    const bar = scroller.offsetWidth - scroller.clientWidth || 8;
    const track = scroller.clientHeight;
    const thumbHeight = Math.max(20, (track * scroller.clientHeight) / scroller.scrollHeight);
    const fraction = scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight);
    const top = box.top + fraction * (track - thumbHeight);
    return { x: box.right - bar / 2, y: top + thumbHeight / 2, top: box.top, bottom: box.top + track, bar };
  });
}

async function reach() {
  const out: Record<string, unknown> = {};
  for (const [name, engine] of engines) {
    for (const anchor of (option('anchors') ?? 'set,by').split(',')) {
    const result: Record<string, unknown> = {};
    const extra: Record<string, string> = flag('stale') ? { stale: '' } : {};
    const { page, close, problems } = await openSpike(engine, { bar: 'classic', anchor, probe: '', ...extra }, [frameRecorder], true);
    result.start = await shown(page);
    await page.keyboard.press('End');
    await idle(page);
    result.end = await shown(page);
    await page.keyboard.press('Home');
    await idle(page);
    result.home = await shown(page);
    // The harness's fling: ~3 s of wheel events, top to bottom.
    result.flingInput = await nativeFling(page);
    await idle(page);
    result.fling = await shown(page);
    await page.keyboard.press('Home');
    await idle(page);
    const t0 = await page.evaluate(() => performance.now());
    result.steadyFlingInput = await steadyFling(page);
    await idle(page);
    const t1 = await page.evaluate(() => performance.now());
    result.steadyFling = await shown(page);
    result.steadyFlingFrames = probed(await recordedBetween<Frame>(page, t0, t1));
    // Through the top band, where the window can't move but the content's
    // base does (at 1,024 rows): 120 × 600 px of wheel from Home, each frame
    // probed.
    await page.keyboard.press('Home');
    await idle(page);
    const t2 = await page.evaluate(() => performance.now());
    for (let i = 0; i < 120; i++) {
      await nativeWheel(page, 600);
      await page.waitForTimeout(16);
    }
    await idle(page);
    const t3 = await page.evaluate(() => performance.now());
    result.topBand = await shown(page);
    result.topBandFrames = probed(await recordedBetween<Frame>(page, t2, t3));
    // Ctrl+End and Ctrl+Home (Windows and Linux): the content's ends.
    await page.keyboard.press('Control+End');
    await idle(page);
    result.ctrlEnd = await shown(page);
    await page.keyboard.press('Control+Home');
    await idle(page);
    result.ctrlHome = await shown(page);
    // A few more wheel notches at the end: does it reach the last row?
    for (let i = 0; i < 10; i++) {
      await nativeWheel(page, 2000);
      await page.waitForTimeout(30);
    }
    await idle(page);
    result.flingThenWheel = await shown(page);
    // From 40,000 px above the end, 50 wheel events of 1,000 px: past the
    // end, and under Firefox's one-page limit per event.
    await page.evaluate(() => {
      const model = (globalThis as { __spike?: { model?: { jumpTo(v: number): void; total: number } } }).__spike!.model!;
      model.jumpTo(model.total - 40_000);
    });
    await idle(page);
    for (let i = 0; i < 50; i++) {
      await nativeWheel(page, 1000);
      await page.waitForTimeout(16);
    }
    await idle(page);
    result.wheelToEnd = await shown(page);
    await page.keyboard.press('Home');
    await idle(page);
    // The thumb dragged to the bottom of its track.
    const start = await thumb(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 20; step++) {
      await page.mouse.move(start.x, start.y + ((start.bottom - start.y + 40) * step) / 20);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await idle(page);
    result.drag = await shown(page);
    // Wheel up from the end, then back down: the bottom zone is 1:1.
    const box = (await page.locator('.scroller').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 5; i++) await nativeWheel(page, -300);
    await idle(page);
    result.wheelUpFromEnd = await shown(page);
    for (let i = 0; i < 5; i++) await nativeWheel(page, 300);
    await idle(page);
    result.wheelBackDown = await shown(page);
    result.problems = problems;
    out[`${name} ${anchor}`] = result;
    await close();
    }
  }
  return out;
}

/** Each probed frame: a row under the probe, and the one the model says. */
function probed(frames: Frame[]) {
  const seen = frames.filter((frame) => frame.shown >= 0);
  return {
    frames: frames.length,
    blank: frames.length - seen.length,
    offModel: seen.filter((frame) => Math.abs(frame.shown - frame.v) > 0.5).length,
    worstOffModel: Math.max(0, ...seen.map((frame) => Math.abs(frame.shown - frame.v))),
  };
}

/** Per frame: how far the shown content moved, and how often it moved back. */
function motion(all: Frame[], direction: 1 | -1) {
  // A frame with no row under the probe says nothing about position.
  const frames = all.filter((frame) => frame.shown >= 0);
  const steps = frames.slice(1).map((frame, index) => frame.shown - frames[index]!.shown).filter((step) => Number.isFinite(step));
  const backward = steps.filter((step) => step * direction < -0.5);
  const mismatch = frames.map((frame) => Math.abs(frame.shown - frame.v)).filter((gap) => gap > 0.5);
  return {
    frames: frames.length,
    blankFrames: all.length - frames.length,
    stepsPerFrame: percentiles(steps.map(Math.abs)),
    backwardFrames: backward.length,
    worstBackward: backward.length ? Math.min(...backward.map((step) => step * direction)) : 0,
    framesShownOffModel: mismatch.length,
    worstShownOffModel: mismatch.length ? Math.max(...mismatch) : 0,
  };
}

// Scrolls 24,000 px from the middle with the wheel (200 × 120 px), then 30
// Page Downs, and compares what's shown with a control that never re-anchors.
async function continuity() {
  const out: Record<string, unknown> = {};
  for (const [name, engine] of engines) {
    const perMethod: Record<string, unknown> = {};
    for (const anchor of ['none', 'set', 'by']) {
      const { page, close, problems } = await openSpike(engine, { anchor, probe: '', keys: 'native' }, [frameRecorder]);
      await page.evaluate(() => {
        const model = (globalThis as { __spike?: { model?: { jumpTo(v: number): void; total: number } } }).__spike!.model!;
        model.jumpTo(Math.round(model.total / 2 / 30) * 30);
      });
      await idle(page);
      const before = await shown(page);
      const anchorsBefore = before.reanchors;
      const t0 = await page.evaluate(() => performance.now());
      const box = (await page.locator('.scroller').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 200; i++) {
        await nativeWheel(page, 120);
        await page.waitForTimeout(16);
      }
      await idle(page);
      const t1 = await page.evaluate(() => performance.now());
      const afterWheel = await shown(page);
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('PageDown');
        await page.waitForTimeout(60);
      }
      await idle(page);
      const t2 = await page.evaluate(() => performance.now());
      const afterKeys = await shown(page);
      perMethod[anchor] = {
        wheel: {
          shownMoved: afterWheel.shownV - before.shownV,
          modelMoved: afterWheel.v - before.v,
          restOffModel: afterWheel.shownV - afterWheel.v,
          reanchors: afterWheel.reanchors - anchorsBefore,
          ...motion(await recordedBetween<Frame>(page, t0, t1), 1),
        },
        pageDown: {
          shownMoved: afterKeys.shownV - afterWheel.shownV,
          modelMoved: afterKeys.v - afterWheel.v,
          restOffModel: afterKeys.shownV - afterKeys.v,
          reanchors: afterKeys.reanchors - afterWheel.reanchors,
          ...motion(await recordedBetween<Frame>(page, t1, t2), 1),
        },
        sources: await page.evaluate(() => (globalThis as { __spike?: { model?: { sources: object } } }).__spike?.model?.sources),
        problems,
      };
      await close();
    }
    out[name] = perMethod;
  }
  return out;
}

type Input = { t: number; type: string; inBar: boolean; target: string };

// Which events each input produces, and what the model put its scrolls down
// to: a thumb drag, a track press, the wheel, and a key.
async function bar() {
  const out: Record<string, unknown> = {};
  for (const [name, engine] of engines) {
    const result: Record<string, unknown> = {};
    const { page, close, problems } = await openSpike(engine, { bar: 'classic' }, [], true);
    const action = async (what: string, act: () => Promise<void>) => {
      await page.evaluate(() => {
        const model = (globalThis as { __spike?: { model?: { inputs: Input[]; sources: object } } }).__spike!.model!;
        model.inputs.length = 0;
        model.sources = {};
      });
      const before = await shown(page);
      await act();
      await idle(page);
      const after = await shown(page);
      const seen = await page.evaluate(() => {
        const model = (globalThis as { __spike?: { model?: { inputs: Input[]; sources: object } } }).__spike!.model!;
        const types: Record<string, number> = {};
        for (const input of model.inputs) {
          const key = `${input.type}${input.inBar ? ' (in bar)' : ''}`;
          types[key] = (types[key] ?? 0) + 1;
        }
        return { events: types, scrollSources: model.sources };
      });
      result[what] = { ...seen, rowsMoved: after.first - before.first };
    };
    const geometry = await thumb(page);
    result.barWidth = geometry.bar;
    await action('thumbDrag', async () => {
      const start = await thumb(page);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      for (let step = 1; step <= 10; step++) {
        await page.mouse.move(start.x, start.y + step * 20);
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
    });
    await action('trackPress', async () => {
      const start = await thumb(page);
      await page.mouse.click(start.x, start.bottom - 30);
    });
    await action('wheel', async () => {
      const box = (await page.locator('.scroller').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 5; i++) await nativeWheel(page, 120);
    });
    await action('pageDown', async () => {
      await page.keyboard.press('PageDown');
    });
    await action('arrowDown', async () => {
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
    });
    result.problems = problems;
    out[name] = result;
    await close();
  }
  return out;
}

try {
  if (only.includes('caps')) save('caps', await caps());
  if (only.includes('reach')) save('reach', await reach());
  if (only.includes('continuity')) save('continuity', await continuity());
  if (only.includes('bar')) save('bar', await bar());
  if (only.includes('tanstack')) save('tanstack', await (await import('./tanstack.ts')).tanstack(server.url, runs));
  if (only.includes('latency')) save('latency', await (await import('./latency.ts')).latency(server.url, { sessions: Number(option('sessions') ?? 3), count: Number(option('count') ?? 10) }));
  if (only.includes('work')) save('work', await (await import('./latency.ts')).work(server.url, runs));
} finally {
  await server.close();
}
