/**
 * Live tail's follow toggle between the observatory's page and a contender's
 * frame (`docs/contender-contract.md`, "The follow toggle"). A module of its
 * own, not `contract.ts`'s: the TanStack entry imports `contract.ts`, and
 * only the tail level's after-paint code calls this.
 */

import { readingOut } from './contract.ts';

/** The page's ask to live tail's frame: follow the newest (`true`, the
 *  table's `follow`) or let go with the view where it is (`false`, its
 *  `let_go`). */
export interface FollowMessage {
  seiza: 'follow';
  on: boolean;
}

/** Live tail's frame to the page: whether the view follows, and the rows
 *  the clock has set (the page counts those since following was let go). */
export interface FollowingMessage {
  seiza: 'following';
  on: boolean;
  rows: number;
}

/** While let go, the frame tells the page its rows at most this often. */
export const FOLLOWING_EVERY_MS = 250;

/**
 * With `?readout` in the page's frame only (a bare page, the cold runs',
 * neither heeds nor sends a message): hears the page's {@link FollowMessage}s,
 * calling `apply`, and returns the reporter the side calls at each change of
 * following and at each count while let go. It posts a
 * {@link FollowingMessage} at a change, and while let go at most every
 * {@link FOLLOWING_EVERY_MS}, the last count held back sent when that time
 * is up (the clock may have stopped): never a message a frame. The page
 * assumes a frame follows until told otherwise. Null without `?readout`.
 */
export function followToggle(apply: (on: boolean) => void): ((on: boolean, rows: number) => void) | null {
  if (!readingOut() || window.parent === window) return null;
  window.addEventListener('message', (event: MessageEvent<Partial<FollowMessage>>) => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.seiza !== 'follow') return;
    if (typeof event.data.on === 'boolean') apply(event.data.on);
  });
  let following = true;
  let sent = -Infinity;
  let latest = 0;
  let held: ReturnType<typeof setTimeout> | undefined;
  const post = (on: boolean, rows: number) => {
    following = on;
    sent = performance.now();
    clearTimeout(held);
    held = undefined;
    const message: FollowingMessage = { seiza: 'following', on, rows };
    window.parent.postMessage(message, location.origin);
  };
  return (on, rows) => {
    if (on !== following) return post(on, rows);
    if (on) return;
    latest = rows;
    const wait = sent + FOLLOWING_EVERY_MS - performance.now();
    if (wait <= 0) return post(false, rows);
    held ??= setTimeout(() => {
      held = undefined;
      if (!following) post(false, latest);
    }, wait);
  };
}
