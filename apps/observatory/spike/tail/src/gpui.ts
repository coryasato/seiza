import { boot } from '@seiza/web/bootstrap';
import { createBridge } from '@seiza/duckdb/bridge';
import init, { rowsDue, start, tailDrawn, tailFollowing, tailMoved, tailView } from '../pkg/tail_spike.js';
import wasmUrl from '../pkg/tail_spike_bg.wasm?url';
import { ENGINE_DIR, OBSERVATORY, UI_FONT } from '../../../contenders/paths.ts';
import { afterMark, fetchFile, startClock, type TailLog } from './shared.ts';

const pairs = (flat: Float64Array | number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
};

const log: TailLog = {
  batches: [],
  drawn: () => pairs(tailDrawn()),
  following: () => pairs(tailFollowing()),
  moved: () => pairs(tailMoved()),
  view: () => [...tailView()] as [number, number],
  pause: () => {},
  open: 0,
};
(globalThis as { __tail?: TailLog }).__tail = log;

const bridge = createBridge({ extensionDir: ENGINE_DIR, extensionBase: OBSERVATORY });
const file = afterMark('gpui:first-frame').then(fetchFile);

void boot({
  init: () => init({ module_or_path: wasmUrl }),
  start: (font) => start(font, bridge, file),
  fontUrl: UI_FONT,
  wasmUrl,
});

// The clock once the table is open (the wasm sets `__tailOpen`).
const waitOpen = () => {
  const open = (globalThis as { __tailOpen?: number }).__tailOpen;
  if (!open) return void requestAnimationFrame(waitOpen);
  log.open = open;
  startClock(log, rowsDue);
};
waitOpen();
