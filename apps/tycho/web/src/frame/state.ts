/**
 * The frame's state, as the app publishes it (`crate/src/frame.rs`,
 * `FrameView`, spells the same fields), and the store React reads it from.
 * Plain TypeScript in the entry: the app publishes from its first render,
 * before React has loaded (`hydrate.tsx` loads after the first frame).
 */

export interface Line {
  text: string;
  error: boolean;
}

export interface FileState {
  name: string;
  /** The sample, not a file from this device. */
  sample: boolean;
  /** `Parquet · 71,431 rows · 46 columns · 1.7 MiB`. */
  facts: string;
  /** A CSV's load while it reads, or how it ended. */
  load: string | null;
  /** From the file's metadata: a sample's build writes it. */
  credit: string | null;
  /** A column shown as text, a load stopped. */
  notes: Line[];
}

export interface FrameState {
  engine: { state: 'loading' | 'ready' | 'failed' | 'stopped'; text: string };
  /** The file whose rows are shown; null on the first screen. */
  file: FileState | null;
  /** What's opening: a file from the device, or the sample. */
  busy: 'file' | 'sample' | null;
  /** What's loading, a file refused, or why an open failed. */
  message: Line | null;
  /** The perf panel is open (on the canvas, under the first screen). */
  panel: boolean;
}

/** What the page is before the app's first word: the prerendered page. */
export const INITIAL: FrameState = {
  engine: { state: 'loading', text: 'Loading DuckDB' },
  file: null,
  busy: null,
  message: null,
  panel: false,
};

let state = INITIAL;
const listeners = new Set<() => void>();

export const getState = (): FrameState => state;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** What the app calls (`crate/src/frame.rs`, `Frame`). */
export const frameSink = {
  update(next: FrameState): void {
    state = next;
    // What CSS alone shows: the table in place of the first screen.
    document.documentElement.toggleAttribute('data-file', next.file !== null);
    // The first screen's ghost of a table steps aside for the panel.
    document.documentElement.toggleAttribute('data-panel', next.panel);
    for (const listener of listeners) listener();
  },
};
