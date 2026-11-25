/**
 * The row detail view, the right panel's Row tab, as the design canvas's
 * Row 1 to 4 and Frame C draw it (`docs/DECISIONS.md`, "Scope",
 * 2026-11-20, "The row detail view always shows the active cell's row"):
 * its head "Row 7 of 38,112" with Previous row and Next row (they move the
 * table's selection, `App.select`) and Copy the row; then every column a
 * field in the view's order, hidden ones included and marked, the active
 * cell's field in the accent. A field under the pointer or in focus shows
 * Copy this value and its menu (Copy alone until the filters, Row 2); long
 * text is cut at eight lines with "Show all N characters" (Row 3); with
 * nothing selected the tab says so (Row 4).
 *
 * One state: the tab follows the table's active cell (`FrameState.active`),
 * its values read from the app (`App.row`: the page the table holds, or
 * that one row read alone). The values and the field names are the text;
 * the head and the buttons are chrome, never selected, so select-all in the
 * tab (`log.tsx`'s `panelKeys`) takes the fields alone.
 *
 * Focus: opened by Enter, the popover's "Focus row in panel", or the cell
 * menu's, the active cell's field takes it once drawn (`core.ts`,
 * `openRow`, `takeRowFocus`); opened by a double press it stays on the
 * table (`docs/DECISIONS.md`, "Scope", 2026-11-25). Tab moves between the
 * fields and their buttons.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { copyRowText, dropRowFocus, getFieldCopy, getRowFocusAsks, rowValues, selectCell, subscribeFieldCopy, subscribeRowFocus, takeRowFocus } from './core.ts';
import { Badge, Icon, type IconName } from './icons.tsx';
import { closeFieldMenuOff, openFieldMenu, useFieldMenu } from './menus.tsx';
import type { FrameState, RowValues } from './state.ts';

type Field = RowValues['fields'][number];

const count = (n: number): string => n.toLocaleString('en-US');

/** Eight lines of the value's 18 px. */
const LONG_HEIGHT = 8 * 18;

const iconButton = 'flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-muted select-none hover:bg-surface-raised hover:text-foreground aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent';
const smallButton = 'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-foreground-muted select-none hover:bg-surface-active hover:text-foreground aria-expanded:bg-surface-active aria-expanded:text-foreground';

/** A copy button: its icon a check for a moment once the browser wrote
 *  it, or an x where it couldn't. A field's says its menu's copies too
 *  (`field`: `core.ts`'s `copyField`). */
function CopyButton({ label, run, className, size = 14, field }: { label: string; run: () => Promise<boolean>; className: string; size?: number; field?: { row: number; column: number } }) {
  const [done, setDone] = useState<'copied' | 'failed' | null>(null);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), 1200);
    return () => clearTimeout(timer);
  }, [done]);
  const menuCopy = useSyncExternalStore(subscribeFieldCopy, getFieldCopy, () => null);
  const heard = useRef(menuCopy?.seq ?? 0);
  useEffect(() => {
    if (!menuCopy || menuCopy.seq === heard.current) return;
    heard.current = menuCopy.seq;
    if (field && menuCopy.row === field.row && menuCopy.column === field.column) setDone(menuCopy.ok ? 'copied' : 'failed');
  }, [menuCopy, field?.row, field?.column]);
  const icon: IconName = done === 'copied' ? 'check' : done === 'failed' ? 'x' : 'copy';
  const title = done === 'copied' ? 'Copied' : done === 'failed' ? "Couldn't copy" : label;
  return (
    <button type="button" aria-label={label} title={title} data-done={done ?? undefined} onClick={() => void run().then((ok) => setDone(ok ? 'copied' : 'failed'))} className={className}>
      <Icon name={icon} size={size} />
    </button>
  );
}

/** Scrolls `list` the least distance that shows `field`, its top first
 *  when it's taller than the list; never the page or a sheet around it, as
 *  `scrollIntoView` may. */
function keepInSight(list: HTMLElement, field: HTMLElement): void {
  const outer = list.getBoundingClientRect();
  const inner = field.getBoundingClientRect();
  if (inner.top < outer.top) list.scrollTop -= outer.top - inner.top;
  else if (inner.bottom > outer.bottom) list.scrollTop += Math.min(inner.bottom - outer.bottom, inner.top - outer.top);
}

/** A value: NULL as NULL; long text cut at eight lines with Show all. */
function Value({ field }: { field: Field }) {
  const text = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState(false);
  const [open, setOpen] = useState(false);
  // Measured again whenever the field's width changes (a phone turned, the
  // sheet settling, the type loading after the first frame).
  useLayoutEffect(() => {
    const node = text.current;
    if (!node) return;
    const measure = () => setCut(node.scrollHeight > LONG_HEIGHT + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [field.value]);
  if (field.value === null) return <div className="text-[11px] leading-[18px] tracking-[0.04em] text-foreground-subtle">NULL</div>;
  // The app gives at most 10,000 characters of a value; Copy this value
  // copies all of it.
  const partial = field.length > [...field.value].length;
  return (
    <>
      <div
        ref={text}
        style={open ? undefined : { maxHeight: LONG_HEIGHT }}
        className="overflow-hidden text-[13px] leading-[18px] whitespace-pre-wrap text-foreground tabular-nums [overflow-wrap:anywhere]"
      >
        {field.value}
      </div>
      {cut && !open && (
        <button type="button" data-show-all onClick={() => setOpen(true)} className="mt-0.5 flex h-[22px] cursor-pointer items-center gap-1 self-start text-xs text-accent select-none">
          <Icon name="chevd" size={11} />
          <span>Show all {count(field.length)} characters</span>
        </button>
      )}
      {open && partial && (
        <div className="text-[11px] leading-4 text-foreground-subtle select-none">
          The first {count([...field.value].length)} of {count(field.length)} characters. Copy this value copies all of them.
        </div>
      )}
    </>
  );
}

function FieldRow({ field, row, active, menu }: { field: Field; row: number; active: boolean; menu: boolean }) {
  // The value when the tab holds it whole: a copy writes it at once where
  // a browser has no ClipboardItem (`core.ts`'s `copyRowText`).
  const known = field.value !== null && field.length === [...field.value].length ? field.value : null;
  return (
    <div
      data-field={field.index}
      data-active={active || undefined}
      tabIndex={0}
      role="group"
      aria-label={`${field.name}${field.hidden ? ', hidden in the table' : ''}`}
      className={`group flex flex-col gap-[3px] border-b border-border-subtle pt-[7px] pr-2 pb-2 pl-3 outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] ${
        active ? 'bg-accent-tint shadow-[inset_2px_0_0_var(--accent)] focus-visible:shadow-[inset_2px_0_0_var(--accent),inset_0_0_0_1px_var(--accent)]' : menu ? 'bg-surface-raised' : 'hover:bg-surface-raised focus-within:bg-surface-raised'
      }`}
    >
      <div className="flex h-5 items-center gap-1.5">
        <Badge kind={field.type} />
        <span className="min-w-0 truncate text-[11.5px] text-foreground-muted">{field.name}</span>
        {field.hidden && <span className="shrink-0 text-[10.5px] whitespace-nowrap text-foreground-subtle select-none">hidden in the table</span>}
        <span className="flex-1" />
        <div className={`flex items-center gap-0.5 ${menu ? '' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-done]]:opacity-100 [@media(hover:none)]:opacity-100'}`}>
          <CopyButton label="Copy this value" run={() => copyRowText(row, field.index, known)} field={{ row, column: field.index }} className={smallButton} size={12} />
          <button
            type="button"
            aria-label={`${field.name}'s menu`}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={(event) => openFieldMenu({ index: field.index, row, value: field.value, known, anchor: event.currentTarget })}
            className={smallButton}
          >
            <Icon name="more" size={12} />
          </button>
        </div>
      </div>
      {/* Keyed by its row: an opened value closes on another row. */}
      <Value key={row} field={field} />
    </div>
  );
}

/** The tab's body, while a file is open. */
export function RowView({ state }: { state: FrameState }) {
  const active = state.active;
  const rows = state.file?.rows ?? 0;
  const [values, setValues] = useState<RowValues | null>(null);
  /** The row last asked for, and whether its read failed. */
  const [read, setRead] = useState<{ row: number; failed: boolean } | null>(null);
  const fields = useRef<HTMLDivElement>(null);
  const menu = useFieldMenu();
  const focusAsks = useSyncExternalStore(subscribeRowFocus, getRowFocusAsks, () => 0);
  // A file's opening is its log's first entry (`menus.tsx`'s rule).
  const opening = state.log.entries[0]?.id ?? null;
  // What the view is, for the fields: their order, types, and hidden
  // flags (a CSV's column widened to text reads its row again). The
  // frame's `columns` is a new array at every publish, so it's compared by
  // this, not by itself.
  const viewKey = state.columns.map((column) => `${column.index}:${column.dataType}${column.hidden ? ':h' : ''}`).join(',');
  // Read again when the row, the view, or the file changes; an answer that
  // comes after the next ask is dropped. A read failed is said.
  useEffect(() => {
    // A field's menu on another row closes: its Copy would copy that row.
    closeFieldMenuOff(active?.row ?? null);
    if (!active) {
      setValues(null);
      return;
    }
    // An ask for focus at another row is stale now (Enter, then an arrow
    // before its row came).
    dropRowFocus(active.row);
    setRead({ row: active.row, failed: false });
    let live = true;
    void rowValues(active.row).then((next) => {
      if (!live) return;
      if (next) setValues(next);
      setRead({ row: active.row, failed: next === null });
    });
    return () => {
      live = false;
    };
  }, [active?.row, viewKey, opening]);
  // The field Enter asked for, once its row is drawn: now if it is, or
  // when its values come.
  useLayoutEffect(() => {
    if (!values) return;
    const column = takeRowFocus(values.row);
    if (column === null) return;
    const field = fields.current?.querySelector<HTMLElement>(`[data-field="${column}"]`);
    field?.focus({ preventScroll: true });
    if (fields.current && field) keepInSight(fields.current, field);
  }, [values, focusAsks]);
  // The active field kept in sight as the selection moves to another row
  // or along it; not when the same row is read again (a hide, a type
  // widened), which would undo the visitor's own scroll in the tab.
  const kept = useRef<string | null>(null);
  // The fields' list is drawn anew (scrolled to its top) after "No row
  // selected", and another file's is another list: the field is brought
  // into sight again then, even for the same row and column.
  useLayoutEffect(() => {
    kept.current = null;
  }, [opening, active === null]);
  // A field's menu opened on the last row's fields, shown faded while the
  // next row's read, closes once they're drawn.
  useEffect(() => {
    if (values) closeFieldMenuOff(values.row);
  }, [values]);
  useLayoutEffect(() => {
    if (!values || !active) return;
    const key = `${values.row}:${active.column}`;
    if (kept.current === key) return;
    kept.current = key;
    const field = fields.current?.querySelector<HTMLElement>(`[data-field="${active.column}"]`);
    if (fields.current && field) keepInSight(fields.current, field);
  }, [values, active?.column]);

  if (!active) {
    return (
      <div data-row-empty className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-9 pb-20 text-center select-none">
        <Icon name="rows" size={20} className="text-foreground-subtle" />
        <span className="text-[13px] font-medium text-foreground">No row selected</span>
        <span className="text-xs leading-[17px] text-foreground-subtle">Select a cell and its whole row is here: every column, hidden ones too, and long text in full.</span>
      </div>
    );
  }
  // The last row's fields stay, faded, until the next row's come; with
  // none to show, a line says the row is reading, or that it failed.
  const shown = values;
  const stale = !!shown && shown.row !== active.row;
  const failed = read?.row === active.row && read.failed;
  return (
    <>
      <div className="flex h-[38px] shrink-0 items-center justify-between border-b border-border pr-1.5 pl-3 select-none">
        <div className="flex items-baseline gap-1.5 tabular-nums">
          <span data-row-head className="text-[12.5px] font-medium text-foreground">Row {count(active.row + 1)}</span>
          <span className="text-[11.5px] text-foreground-subtle">of {count(rows)}</span>
        </div>
        <div className="flex items-center gap-0.5">
          {/* aria-disabled, not disabled: a disabled button drops its
              focus to the page, so a keyboard stepping to the first or
              last row would leave the panel. */}
          <button type="button" data-row-step="previous" aria-label="Previous row" title="Previous row" aria-disabled={active.row === 0} onClick={() => active.row > 0 && selectCell(active.row - 1, active.column)} className={iconButton}>
            <Icon name="up" />
          </button>
          <button type="button" data-row-step="next" aria-label="Next row" title="Next row" aria-disabled={active.row + 1 >= rows} onClick={() => active.row + 1 < rows && selectCell(active.row + 1, active.column)} className={iconButton}>
            <Icon name="down" />
          </button>
          <CopyButton label="Copy the row" run={() => copyRowText(active.row, null)} className={iconButton} />
        </div>
      </div>
      <div ref={fields} data-select-all id="row-view" aria-label={`Row ${count(active.row + 1)}`} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain select-text ${stale ? 'opacity-60' : ''}`}>
        {failed ? (
          <div data-row-status role="status" className="px-3 py-3 text-xs text-error select-none">
            Couldn&rsquo;t read row {count(active.row + 1)}.
          </div>
        ) : (
          !shown && (
            <div data-row-status role="status" className="px-3 py-3 text-xs text-foreground-subtle select-none">
              Reading row {count(active.row + 1)}&hellip;
            </div>
          )
        )}
        {!failed && shown?.fields.map((field) => (
          <FieldRow key={field.index} field={field} row={shown.row} active={field.index === active.column} menu={menu?.index === field.index && menu.row === shown.row} />
        ))}
      </div>
    </>
  );
}
