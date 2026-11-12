/**
 * The wide sheet's tools between the observatory's page and a contender's
 * frame (`docs/contender-contract.md`, "The copy line"): the selection and
 * the copy said by the page's status bar, and its Copy button calling into
 * the frame. A module of its own, not `contract.ts`'s: the TanStack entry
 * imports `contract.ts`, and only the wide level's code calls this, so no
 * other level's bundle carries it.
 */

import { readingOut } from './contract.ts';

/** The copy's marks, with `?measure` on the wide level: each timed from the
 *  key's event (`docs/contender-contract.md`, "Marks"). */
export const COPY_MARKS = {
  /** The copy started: its clipboard write opened, in the key's task. */
  started: 'contender:copy-started',
  /** Its text all in. */
  copied: 'contender:copied',
  /** The browser's write resolved. */
  written: 'contender:copy-written',
  /** A key past the key's limit: nothing read. */
  declined: 'contender:copy-declined',
} as const;

/** What became of the last copy, as the table's bridge spells it
 *  (`clipboard::Outcome`), or null before any. */
export type CopyState = 'declined' | 'copying' | 'writing' | 'written' | 'refused' | 'failed' | 'unavailable';

/** The frame to the page, at each selection change and copy event. */
export interface ToolsMessage {
  seiza: 'tools';
  /** The cells selected, 0 for none. */
  cells: number;
  /** The last copy's state since the selection last changed, or null. */
  copy: CopyState | null;
  /** While copying, the share of its rows in, 0–1. */
  done: number;
  /** Writing or written: the text's bytes; declined: 0. */
  bytes: number;
  /** Written: the key (or the page's call) → the browser's write resolved, ms; else 0. */
  ms: number;
  /** Failed: why (`too-large`, `read`, `cancelled`, `closed`). */
  reason?: string;
}

/** What the page calls inside its click (a press in the parent is the
 *  clipboard's gesture): the host's copy, which the key's limit doesn't
 *  hold, and cancelling the copy running. The frame takes the focus first:
 *  Chromium refuses a clipboard write from a document without it, and the
 *  press gave it to the page. */
export interface ContenderTools {
  copy(): void;
  cancel(): void;
}

/** A copy's progress is told at most this often; a change of state, and
 *  the last progress held back, go at once or when the time is up. */
export const TOOLS_EVERY_MS = 100;

/**
 * With `?readout` in the page's frame only (a bare page, the cold runs',
 * neither exports the tools nor tells anything): publishes
 * `globalThis.__contenderTools` and returns the reporter the side calls at
 * each selection change and copy event. A change of `copy`'s state is
 * posted at once; anything else (a drag's selection, a copy's progress) at
 * most every {@link TOOLS_EVERY_MS}, the last held back sent when the time
 * is up: never a message a frame. Null without `?readout`.
 */
export function toolsReporter(tools: ContenderTools): ((message: Omit<ToolsMessage, 'seiza'>) => void) | null {
  if (!readingOut() || window.parent === window) return null;
  (globalThis as { __contenderTools?: ContenderTools }).__contenderTools = {
    copy: () => {
      window.focus();
      tools.copy();
    },
    cancel: () => tools.cancel(),
  };
  let state: CopyState | null | undefined;
  let sent = -Infinity;
  let latest: ToolsMessage | undefined;
  let held: ReturnType<typeof setTimeout> | undefined;
  const post = (message: ToolsMessage) => {
    state = message.copy;
    sent = performance.now();
    clearTimeout(held);
    held = undefined;
    latest = undefined;
    window.parent.postMessage(message, location.origin);
  };
  return (fields) => {
    const message: ToolsMessage = { seiza: 'tools', ...fields };
    if (message.copy !== state) return post(message);
    latest = message;
    const wait = sent + TOOLS_EVERY_MS - performance.now();
    if (wait <= 0) return post(message);
    held ??= setTimeout(() => {
      held = undefined;
      if (latest) post(latest);
    }, wait);
  };
}
