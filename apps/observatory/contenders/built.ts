// The levels a side builds (`scenarios.ts`'s `BUILT`), one a line, the base
// first: what the justfile's `builds`, `check`, and `deploy` loop over. With
// `--cargo <level>`, the GPUI contender's Cargo features at that level
// (`level.ts`'s `gpuiCargoFeatures`), comma-separated, for its build.
//
// Usage: node apps/observatory/contenders/built.ts gpui|tanstack
//        node apps/observatory/contenders/built.ts --cargo <level>

import { gpuiCargoFeatures } from './level.ts';
import { BUILT, type Level } from './scenarios.ts';

if (process.argv[2] === '--cargo') {
  const level = process.argv[3] as Level;
  if (!BUILT.gpui.includes(level)) throw new Error(`built.ts --cargo: the GPUI contender doesn't build ${level}`);
  console.log(gpuiCargoFeatures(level).join(','));
  process.exit(0);
}
const side = process.argv[2];
if (side !== 'gpui' && side !== 'tanstack') throw new Error(`usage: built.ts gpui|tanstack, not ${side}`);
console.log(BUILT[side].join('\n'));
