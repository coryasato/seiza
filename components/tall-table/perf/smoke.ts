// The bare host on its release build, in each browser: in both shapes, it
// draws its first frame, fills, scrolls down by wheel (and sideways in the
// wide shape), fills again there, and reports no page errors. Headless, so
// it stands in for the scripted half of a manual check; how it looks is
// still a manual check. WebKit and Firefox at DPR 1, Chromium at DPR 2
// (shared-web/perf/'s `open`).
//
// Usage: node components/tall-table/perf/smoke.ts [--browsers chromium,firefox,webkit]
// Run `just tall-table build` first.

import { chromium, firefox, webkit, type BrowserType } from 'playwright';
import { firstDrawProbe, open, waitMark, wheel, type FirstDrawProbe } from '../../../shared-web/perf/harness.ts';
import { option } from '../../../shared-web/perf/protocol.ts';
import { serveApp } from '../../../shared-web/perf/serve.ts';
import { FILLED_MARK, FIRST_FRAME_MARK, PORT, SHAPES, filledWhere, hostWebDir, shown, visibleColumns } from './harness.ts';

const engines: Record<string, BrowserType> = { chromium, firefox, webkit };
const browsers = (option('browsers') ?? 'chromium,firefox,webkit').split(',');
const server = await serveApp(undefined, { webDir: hostWebDir, port: PORT });
const failures: string[] = [];
try {
  for (const name of browsers) {
    const engine = engines[name];
    if (!engine) {
      failures.push(`unknown browser ${name}`);
      continue;
    }
    for (const shape of SHAPES) {
      const label = `${name} ${shape}`;
      let session: Awaited<ReturnType<typeof open>> | null = null;
      try {
        // Inside the try: a browser that fails to launch is a failure, and the rest still run.
        session = await open(engine, server.url, { params: { shape }, init: [firstDrawProbe] });
        const { page } = session;
        const first = await waitMark(page, FIRST_FRAME_MARK);
        const filled = await waitMark(page, FILLED_MARK);
        const { shown: start, layout } = await shown(page);
        const api = await page.evaluate(() => (globalThis as { __seizaProbe?: FirstDrawProbe }).__seizaProbe?.api ?? 'none');
        await page.mouse.move(layout.left + 200, layout.top + 200);
        await wheel(page, 40 * layout.rowHeight);
        const down = await filledWhere(page, `s.first >= ${start.first + 30}`);
        let sideways = '';
        if (shape === 'wide') {
          await wheel(page, 0, 3_000);
          const right = await filledWhere(page, 's.scrollX >= 2000');
          sideways = `, sideways to ${right.scrollX.toFixed(0)} px (${visibleColumns(layout, right.scrollX)} columns visible)`;
        }
        if (session.problems.length) failures.push(`${label}: ${session.problems.join('; ')}`);
        console.log(`${label}: first frame ${first.toFixed(0)} ms, filled ${filled.toFixed(0)} ms (${api}), ${start.rows} rows, ${layout.columns.length} columns, rows ${start.first}–${start.end} → ${down.first}–${down.end}${sideways}`);
      } catch (error) {
        failures.push(`${label}: ${(error as Error).message.split('\n')[0]}`);
      } finally {
        await session?.close();
      }
    }
  }
} finally {
  await server.close();
}
if (failures.length) {
  console.error(`FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('ok');
