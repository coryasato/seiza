/**
 * The contender contract (`docs/contender-contract.md`) from the view: the
 * `contender:filled` mark (always), `__contender.state` and the targets
 * (with `?measure`), and the replay hooks, which drive the shown table
 * through its scroller's position. The page's marks (`first-pixels`,
 * `usable`, `open`) are `main.ts`'s; the `elementtiming` attributes on new
 * cells and the probe key's mark are the view's (`view.ts`).
 *
 * Nothing here runs at import: the build prerenders the view in Node.
 */

import { FLING_FRAMES, MARKS, nextFrame, nextMark, type Contender, type ContenderState, type Replay } from '../../../../contract.ts';
import type { TablePaging } from './data/paging.ts';
import type { ArrowPage } from './data/table.ts';
import { exactText, shownText } from './data/format.ts';
import { ROW_HEIGHT, type LaidOutColumn } from './layout.ts';
import type { ScaledScroller } from './scroll.ts';

/** The table on screen, for the replay hooks. */
let shown: TableContract | null = null;

/**
 * What one open's table publishes. `check` runs after each of the table's
 * commits, and at the end of each move no commit checked (rows already
 * drawn in the overscan: `moveStarted`, `moveEnded`); the state and the
 * targets are written in the next animation frame after a check, so an
 * idle page schedules no frames.
 */
export class TableContract {
  /** The open this table shows (`main.ts` numbers them). */
  readonly open: number;
  /** Whether every visible row held real data at the last check. */
  private filled = false;
  /** A check ran since the current move started. */
  private checkedThisMove = false;
  private readonly paging: TablePaging<ArrowPage>;
  private readonly model: ScaledScroller;
  private readonly scroller: HTMLElement;
  private readonly gutter: number;
  private readonly key: LaidOutColumn | undefined;
  private readonly measuring: boolean;
  private publishing = 0;
  private published = '';
  private targets = '';

  constructor(open: number, paging: TablePaging<ArrowPage>, model: ScaledScroller, scroller: HTMLElement, columns: LaidOutColumn[], gutter: number, measuring: boolean) {
    this.open = open;
    this.paging = paging;
    this.model = model;
    this.scroller = scroller;
    this.key = columns[0];
    this.gutter = gutter;
    this.measuring = measuring;
    shown = this;
  }

  destroy(): void {
    cancelAnimationFrame(this.publishing);
    if (shown === this) shown = null;
  }

  /** The visible rows, and how many of them hold real data. */
  private visible(): { first: number; end: number; loaded: number } {
    const [first, end] = this.paging.visible();
    let loaded = 0;
    for (let row = first; row < end; row++) if (this.paging.row(row).kind === 'loaded') loaded++;
    return { first, end, loaded };
  }

  /** Whether every visible row holds real data now. */
  filledNow(): boolean {
    if (this.paging.rows === 0) return true;
    const { first, end, loaded } = this.visible();
    return end > first && loaded === end - first;
  }

  /** Marks `contender:filled` when the visible rows become all real, as
   *  the tall table's `Filled` event: each change to filled, not each
   *  filled frame. */
  check(): void {
    this.checkedThisMove = true;
    const filled = this.filledNow();
    if (filled && !this.filled) performance.mark(MARKS.filled);
    this.filled = filled;
    if (this.measuring && !this.publishing) this.publishing = requestAnimationFrame(this.publish);
  }

  /** A move starts (the model's first subscriber, before the virtualizer's,
   *  which may commit a render that checks). */
  moveStarted(): void {
    this.checkedThisMove = false;
  }

  /** A move ends (the model's last subscriber): checked unless a commit
   *  already did, so a rendered move scans the visible rows once. */
  moveEnded(): void {
    if (!this.checkedThisMove) this.check();
  }

  /** The replay's fling: equal steps through the model, one per frame. */
  async fling(): Promise<void> {
    const step = (this.paging.rows * ROW_HEIGHT) / FLING_FRAMES;
    for (let sent = 1; sent < FLING_FRAMES; sent++) {
      await nextFrame();
      this.model.step(step);
    }
    await nextFrame();
    await this.untilFilled(() => this.model.step(step));
  }

  /** The replay's jump: `fraction` of the rows above the top, as the GPUI
   *  contender's (the row clamped to the last; the model clamps the top). */
  jump(fraction: number): Promise<void> {
    const rows = this.paging.rows;
    const row = Math.min(Math.floor(Math.min(Math.max(fraction, 0), 1) * rows), Math.max(rows - 1, 0));
    return this.untilFilled(() => this.model.jumpTo(row * ROW_HEIGHT));
  }

  /** Runs `move`, then resolves once the view it led to is filled: after
   *  its frame (a scroll reaches the model in the next frame's scroll
   *  event), at once if it landed filled (the mark is a change to filled,
   *  so none is set), else at a later `contender:filled` that leaves it
   *  filled (an earlier position's rows can land first). */
  private async untilFilled(move: () => void): Promise<void> {
    const since = performance.now();
    move();
    await nextFrame();
    await this.whenFilled(since);
  }

  /** Resolves once every visible row holds real data, waiting on the
   *  `contender:filled` marks after `since`. */
  async whenFilled(since: number): Promise<void> {
    let after = since;
    while (!this.filledNow()) after = (await nextMark(MARKS.filled, after)) + 0.001;
  }

  private publish = (): void => {
    this.publishing = 0;
    const { first, end, loaded } = this.visible();
    const state: ContenderState = {
      rows: this.paging.rows,
      top: this.model.v,
      first,
      end,
      loaded,
      pending: end - first - loaded,
      lastCell: end === this.paging.rows && end > first ? this.keyOf(end - 1) : null,
      cacheBytes: this.paging.cacheBytes(),
    };
    // Replaced, never mutated in place; only when it changed.
    const text = JSON.stringify(state);
    if (text !== this.published) {
      this.published = text;
      const contender = (globalThis as { __contender?: Contender }).__contender;
      if (contender) contender.state = state;
    }
    this.publishTargets();
  };

  /** The last row's key (the first column's exact text), when loaded. */
  private keyOf(row: number): string | null {
    const state = this.paging.row(row);
    if (state.kind !== 'loaded' || !this.key) return null;
    const value = state.page.value(state.index, 0);
    if (value === undefined) return null;
    return typeof value === 'number' && this.key.kind === 'float' ? exactText(value) : shownText(this.key.kind, value, Infinity);
  }

  /** `table` (the rows' area: right of the row numbers, under the header,
   *  to the scrollbar), and the scrollbar's track and thumb. */
  private publishTargets(): void {
    const rect = this.scroller.getBoundingClientRect();
    const { track, thumb } = this.model.scrollbar();
    const top = rect.top + this.scroller.clientTop + (this.scroller.clientHeight - this.model.viewport);
    const left = rect.left + this.scroller.clientLeft + this.gutter;
    const table = [left, top, Math.max(0, track[0]! - left), this.model.viewport];
    const targets = { table, 'table-scroll-track': track, 'table-scroll-thumb': thumb };
    const text = JSON.stringify(targets);
    if (text === this.targets) return;
    this.targets = text;
    const global = globalThis as { __seizaTargets?: Record<string, number[]> };
    global.__seizaTargets = { ...global.__seizaTargets, ...targets };
  }
}

/** The replay hooks: `open` reopens the file through `reopen` (which
 *  resolves with the new open's number once its table is rendered, and
 *  rejects if the open failed); `fling` and `jump` drive the table on
 *  screen. */
export function replay(reopen: () => Promise<number>): Replay {
  const table = (): TableContract => {
    if (!shown) throw new Error('replay: no table on screen yet');
    return shown;
  };
  return {
    open: async () => {
      const since = performance.now();
      const open = await reopen();
      // This open's table, once React has committed it (not an earlier
      // open's, which may commit first).
      while (shown?.open !== open) await nextFrame();
      await shown.whenFilled(since);
    },
    fling: () => table().fling(),
    jump: (fraction) => table().jump(fraction),
  };
}
