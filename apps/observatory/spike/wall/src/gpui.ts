import { boot } from '@seiza/web/bootstrap';
import init, { feed, start, wallBatches, wallFailures, wallRefreshed } from '../pkg/wall_spike.js';
import wasmUrl from '../pkg/wall_spike_bg.wasm?url';
import { UI_FONT } from '../../../contenders/paths.ts';
import { SHOWN, TABLES, records, startFeed, type WallLog } from './shared.ts';

const log: WallLog = {
  batches: () => records(wallBatches(), 4 + TABLES).map(([seq, ticks, sent, ...rest]) => [seq!, ticks!, sent! - performance.timeOrigin, ...rest]),
  refreshed: () => records(wallRefreshed(), 1 + TABLES),
  failures: () => wallFailures(),
  tables: TABLES,
};
(globalThis as { __wall?: WallLog }).__wall = log;

void boot({
  init: () => init({ module_or_path: wasmUrl }),
  start: (font) => start(font, SHOWN.map(([, symbol]) => symbol), new Float64Array(SHOWN.map(([, , price]) => price))),
  fontUrl: UI_FONT,
  wasmUrl,
});
startFeed((batch) => feed(new Uint8Array(batch)));
