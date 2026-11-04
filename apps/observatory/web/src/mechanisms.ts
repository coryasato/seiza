/** The mechanisms, in the galleries' chunk (`gallery.ts`) and
 *  `perf/page.ts`'s check: no virtual module, so Node loads it. */

import type { Side } from '../../contenders/contract.ts';
import type { MechanismId } from './components.ts';

/**
 * Where the two stacks differ: every scenario works through some of these
 * (`docs/research/scenarios.md`, "Where the two stacks differ"; each
 * scenario's in `components.ts`), and a scenario's description links to
 * them. Cost per cell is the canvas's, garbage collection and decoding
 * WebAssembly's, and the split isn't measured yet.
 */
export interface Mechanism {
  id: MechanismId;
  name: string;
  favors: Side;
  definition: string;
}

export const MECHANISMS: readonly Mechanism[] = [
  { id: 'cells', name: 'Cost per cell', favors: 'gpui', definition: 'The DOM styles, lays out, and paints each cell as an element of its own; the GPU draws a rectangle and its glyphs. The canvas’s doing, not WebAssembly’s.' },
  { id: 'gc', name: 'Garbage collection', favors: 'gpui', definition: 'Churn makes garbage in JavaScript, and collecting it pauses frames; Rust frees memory as it goes. WebAssembly’s.' },
  { id: 'decoding', name: 'Decoding values', favors: 'gpui', definition: 'Turning the data into the text on screen, for every visible cell. WebAssembly’s, and likely a modest gain.' },
  { id: 'compositor', name: 'Scrolling off the main thread', favors: 'tanstack', definition: 'The browser moves a page’s scroll while its script is busy; a canvas moves only when its frame is drawn.' },
  { id: 'platform', name: 'The platform’s tools', favors: 'tanstack', definition: 'Every script and font, search, selection, screen readers, and fewer bytes before first paint.' },
];

/** A mechanism's anchor on its component's page. */
export const mechanismAnchor = (mechanism: Mechanism) => `mechanism-${mechanism.id}`;

