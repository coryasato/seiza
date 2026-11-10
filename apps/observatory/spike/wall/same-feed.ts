// The spike's feed against the contender's: the same seed's first 20,000
// ticks over market watch's 50, byte for byte (the spike keeps a copy that
// takes other instruments; this keeps the copy from drifting). The control:
// another seed differs.
// Usage: node apps/observatory/spike/wall/same-feed.ts
import { Feed as Contender } from '../../contenders/market/feed.ts';
import { Feed as Spike, HEADER, TICK } from '../src/feed-worker.ts';

const TICKS = 20_000;
function bytesOf(write: (view: DataView, offset: number) => void): Uint8Array {
  const buffer = new ArrayBuffer(HEADER + TICKS * TICK);
  const view = new DataView(buffer);
  for (let i = 0; i < TICKS; i++) write(view, HEADER + i * TICK);
  return new Uint8Array(buffer);
}
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const contender = new Contender(0x5eed);
const spike = new Spike(0x5eed);
const same = equal(bytesOf((v, o) => contender.write(v, o)), bytesOf((v, o) => spike.write(v, o)));
const control = new Spike(0x5eee);
const controlSame = equal(bytesOf((v, o) => new Contender(0x5eed).write(v, o)), bytesOf((v, o) => control.write(v, o)));
console.log(`spike against contender, ${TICKS} ticks: ${same ? 'the same' : 'DIFFERENT'}; control (another seed): ${controlSame ? 'the same (FAILED)' : 'different'}`);
if (!same || controlSame) process.exitCode = 1;
