// The levels a side builds (`scenarios.ts`'s `BUILT`), one a line, the base
// first: what the justfile's `builds`, `check`, and `deploy` loop over.
//
// Usage: node apps/observatory/contenders/built.ts gpui|tanstack

import { BUILT } from './scenarios.ts';

const side = process.argv[2];
if (side !== 'gpui' && side !== 'tanstack') throw new Error(`usage: built.ts gpui|tanstack, not ${side}`);
console.log(BUILT[side].join('\n'));
