/**
 * A column's menu and a cell's menu, as the design canvas's Columns 1 and
 * Columns 2 draw them, holding only what runs (`docs/DECISIONS.md`,
 * "Scope", 2026-11-24): a column's sort either way, "Filter this column"
 * (the toolbar's filter editor on it, `toolbar.tsx`), Pin to the left
 * (Unpin on a pinned one), Hide (Show on a hidden one), and Fit to its
 * values; a cell's keep and leave out its value, Copy, and Focus row in
 * panel. Grouping and the profile join with their goal, where Columns 1
 * draws them.
 *
 * Opened by the table's presses (`state.ts`, `TablePress`: the header
 * icon's under its bounds, a header's or a cell's context press at the
 * pointer, a finger's tap on a header at a phone) and by the column list
 * (`columns.tsx`, `openColumnMenu`). A wide page's menu is Base UI's Menu
 * anchored there; a phone's, a sheet from the bottom, its rows a finger
 * tall (Phone 4). An action is a click's command (`core.ts`, `act`), or
 * the table's call (Fit, Copy), and puts focus on the table, but Focus row
 * in panel, which puts it at the row's field; Escape puts focus back where
 * it came from.
 *
 * A field's menu in the Row tab (`rowview.tsx`, Row 2) is a cell's menu
 * opened from its field's button, holding keep, leave out, and Copy (the
 * row is already open): Copy copies the field's whole value, and focus
 * goes back to the button. The table's presses that open the Row tab (a double press,
 * Enter on a cell with no popover, the popover's "Focus row in panel") are
 * heard here too (`core.ts`, `openRow`): each takes focus to the cell's
 * field but the double press, which leaves it on the table
 * (`docs/DECISIONS.md`, "Scope", 2026-11-25).
 */

import { Drawer } from '@base-ui/react/drawer';
import { Menu } from '@base-ui/react/menu';
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { act, appNow, canvasKeys, copyField, copySelection, fitColumn, focusRow, focusTable, getFind, openRow, rowValues, subscribeFind } from './core.ts';
import { Badge, Icon, type IconName } from './icons.tsx';
import { usePhone } from './log.tsx';
import { type ColumnFacts, type FrameState, subscribePress, type TablePress } from './state.ts';
import { openFilterEditor } from './toolbar.tsx';

/** What a menu is anchored to: an element (a row of the column list), or a
 *  box in the page (the header's icon, the pointer). */
type Anchor = Element | { getBoundingClientRect(): DOMRect };

type Open =
  | { kind: 'column'; index: number; anchor: Anchor; fromTable: boolean }
  | { kind: 'cell'; index: number; row: number; value: string | null; anchor: Anchor }
  | { kind: 'field'; index: number; row: number; value: string | null; known: string | null; anchor: Element };

let open: (Open & { seq: number }) | null = null;
/** Counts the menus opened: each is drawn anew, so a press while the last
 *  one is still closing opens another. */
let opened = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getOpen = () => open;
function setOpen(next: Open | null): void {
  if (next) closedByFind = false;
  open = next && { ...next, seq: ++opened };
  for (const listener of listeners) listener();
}
/** Whether find closed what was open (Cmd/Ctrl+F over it): its closing
 *  leaves focus to find. Any other closing, find open or not, puts focus
 *  where it puts it. */
let closedByFind = false;
function closeForFind(): void {
  if (!getFind() || !open) return;
  closedByFind = true;
  setOpen(null);
}

/** A field's menu, opened from its button in the Row tab: `known` is its
 *  value when the tab holds it whole (`core.ts`'s `copyField`). */
export function openFieldMenu(field: { index: number; row: number; value: string | null; known: string | null; anchor: Element }): void {
  setOpen({ kind: 'field', ...field });
}

/** A field's menu open on another row than `row` (the tab's, null with
 *  none) is closed: its Copy would copy a row the tab no longer shows. */
export function closeFieldMenuOff(row: number | null): void {
  if (open?.kind === 'field' && open.row !== row) setOpen(null);
}

/** The field whose menu is open, if one is: its button drawn pressed. */
export function useFieldMenu(): { index: number; row: number } | null {
  const current = useSyncExternalStore(subscribe, getOpen, () => null);
  return current?.kind === 'field' ? { index: current.index, row: current.row } : null;
}

/** A column's menu, opened from the column list's row `row`. */
export function openColumnMenu(index: number, row: HTMLElement): void {
  setOpen({ kind: 'column', index, anchor: row, fromTable: false });
}

/** A box `at` of the canvas, in the page: the press's coordinates are the
 *  canvas's own. */
function inPage(at: NonNullable<TablePress['at']>): Anchor {
  return {
    getBoundingClientRect: () => {
      const canvas = document.querySelector('#table-slot > canvas')?.getBoundingClientRect();
      return new DOMRect((canvas?.left ?? 0) + at.x, (canvas?.top ?? 0) + at.y, at.width, at.height);
    },
  };
}

/** The pointer that pressed last was a finger: a phone's tap on a header
 *  opens its menu, a mouse's selects the column. */
let touched = false;
const noteTouch = (event: PointerEvent) => (touched = event.pointerType === 'touch');

function pressed(press: TablePress, phone: boolean): void {
  // The Row tab: Enter and the popover's button (pressed or by Enter) with
  // focus at the cell's field, the double press with it left on the table.
  if (press.row !== null && (press.kind === 'double' || press.kind === 'enter' || press.kind === 'open')) {
    openRow(press.kind === 'double' ? null : { row: press.row, column: press.column.index }, phone);
    return;
  }
  if (!press.at) return;
  const anchor = inPage(press.at);
  if (press.kind === 'icon' || press.kind === 'header' || (press.kind === 'tap' && phone && touched)) {
    setOpen({ kind: 'column', index: press.column.index, anchor, fromTable: true });
  } else if (press.kind === 'cell' && press.row !== null) {
    setOpen({ kind: 'cell', index: press.column.index, row: press.row, value: press.value, anchor });
  }
}

/** Cmd/Ctrl+C as the platform writes it. */
const copyKey = (): string => (typeof navigator !== 'undefined' && !/Mac|iPhone|iPad/.test(navigator.platform) ? 'Ctrl C' : '⌘C');

interface Item {
  icon: IconName;
  label: string;
  hint?: string;
  /** It places focus itself (the table, then the row's field once drawn):
   *  the menu's closing leaves focus where it went. */
  focuses?: boolean;
  run: () => void;
}

/** A column's sort either way, in its type's words ("Sort smallest
 *  first", "Sort A to Z"), ascending first, as the crate's completion
 *  words them; none for a file that can't be sorted. */
function sortItems(column: ColumnFacts, sortable: boolean): Item[] {
  if (!sortable) return [];
  const line = `sort ${column.typed} `;
  const items = appNow()?.complete(line, line.length).items ?? [];
  return ['asc', 'desc'].flatMap((direction) => {
    const item = items.find((item) => item.text === direction);
    return item ? [{ icon: direction === 'asc' ? 'up' : 'down', label: `Sort ${item.detail}`, run: () => act(`sort ${column.typed} ${direction}`) } satisfies Item] : [];
  });
}

/** A column's items, in Columns 1's places: its sort either way, "Filter
 *  this column" (the filter editor on it, which takes focus), then Pin or
 *  Unpin, Hide, and Fit; a hidden column's only Show (it can't be pinned,
 *  and has no width to fit). */
function columnItems(column: ColumnFacts, sortable: boolean, anchor: Anchor): Item[][] {
  // Where the editor's Escape goes: the column list's row the menu came
  // from, or the table.
  const back = () => (anchor instanceof HTMLElement ? anchor : canvasKeys());
  if (column.hidden) return [[{ icon: 'eye', label: 'Show', run: () => act(`show ${column.typed}`) }]];
  const sorts = sortItems(column, sortable);
  return [
    ...(sorts.length ? [sorts] : []),
    [{ icon: 'filter', label: 'Filter this column…', focuses: true, run: () => openFilterEditor(column.index, back()) }],
    [
      column.pinned
        ? { icon: 'pin', label: 'Unpin', run: () => act(`unpin ${column.typed}`) }
        : { icon: 'pin', label: 'Pin to the left', run: () => act(`pin ${column.typed}`) },
      { icon: 'eyeoff', label: 'Hide', run: () => act(`hide ${column.typed}`) },
      { icon: 'columns', label: 'Fit to its values', run: () => fitColumn(column.index) },
    ],
  ];
}

/** Keep the rows with row `row`'s value of `column`, or leave them out:
 *  `=` or `!=` its exact value (read whole, not the press's cut text), a
 *  NULL's `is null` or `not null`. The command is the crate's
 *  (`App.filter_line`, which quotes the value), and its refusal, say a
 *  value the column's type can't be filtered on, is said in the frame's
 *  line as any click's is. */
function keepValue(row: number, column: number, keep: boolean): void {
  void rowValues(row).then(async (values) => {
    const field = values?.fields.find((field) => field.index === column);
    const app = appNow();
    if (!field || !app) return;
    let value = field.value;
    // Cut: read it whole. `length` counts characters (code points), as
    // spreading a string does; `.length` would count UTF-16 units. A read
    // that fails filters on nothing, never on NULL.
    if (value !== null && [...value].length < field.length) {
      value = await app.row_text(row, column);
      if (value === null) return;
    }
    const line = value === null ? app.filter_line(column, keep ? 'is null' : 'not null', []) : app.filter_line(column, keep ? '=' : '!=', [value]);
    if (line) act(line);
  });
}

/** The two filters by a value, as Columns 2 and Row 2 draw them. */
const keepItems = (row: number, column: number): Item[] => [
  { icon: 'filter', label: 'Keep rows with this value', run: () => keepValue(row, column, true) },
  { icon: 'x', label: 'Leave out rows with this value', run: () => keepValue(row, column, false) },
];

/** A cell's items: keep and leave out its value, then Copy (the
 *  selection, which a context press inside it keeps) and Focus row in
 *  panel (the cell selected alone, then the Row
 *  tab, opened or turned to, focus at the cell's field: the app's `open`
 *  press, heard above, after the frame carrying the selection). */
function cellItems(row: number, column: number): Item[][] {
  return [
    keepItems(row, column),
    [
      { icon: 'copy', label: 'Copy', hint: copyKey(), run: copySelection },
      // The table holds focus until the field takes it, once its row is
      // drawn (a row that doesn't read never does).
      {
        icon: 'panelr',
        label: 'Focus row in panel',
        focuses: true,
        run: () => {
          focusTable();
          focusRow(row, column);
        },
      },
    ],
  ];
}

/** A field's items in the Row tab: keep and leave out its value, then
 *  Copy, its whole value, its outcome said on the field's own Copy
 *  button (Row 2). */
function fieldItems(row: number, index: number, known: string | null): Item[][] {
  return [keepItems(row, index), [{ icon: 'copy', label: 'Copy', run: () => copyField(row, index, known) }]];
}

function ColumnHead({ column, phone }: { column: ColumnFacts; phone: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${phone ? 'h-10 border-b border-border px-4' : 'px-2.5 pt-1 pb-2'}`}>
      <Badge kind={column.type} />
      <span className={`min-w-0 truncate font-medium text-foreground ${phone ? 'text-[13.5px]' : 'text-[12.5px]'}`}>{column.name}</span>
      <span className="shrink-0 font-mono text-[10.5px] text-foreground-subtle">{column.dataType}</span>
    </div>
  );
}

function CellHead({ column, row, value, phone }: { column: ColumnFacts; row: number; value: string | null; phone: boolean }) {
  return (
    <div className={`flex flex-col gap-[3px] ${phone ? 'border-b border-border px-4 py-2.5' : 'px-2.5 pt-1 pb-2'}`}>
      <div className="flex items-center gap-2">
        <Badge kind={column.type} />
        <span className="min-w-0 truncate text-[11.5px] text-foreground-muted tabular-nums">
          {column.name} · row {(row + 1).toLocaleString('en-US')}
        </span>
      </div>
      {value === null ? (
        <span className="text-[11px] tracking-[0.04em] text-foreground-subtle">NULL</span>
      ) : (
        <span className="truncate text-[12.5px] text-foreground">{value.split('\n', 1)[0]}</span>
      )}
    </div>
  );
}

/** Where a menu's closing puts focus: nowhere new after an item that
 *  places it itself (Base UI's `false`: it gave the table focus, and the
 *  row's field takes it when drawn, which may be after the menu's closing
 *  has played); the table after any other item (`toTable`); else back where
 *  it came from (`true`). */
function finalFocus(acted: Item | null, toTable: boolean): boolean | HTMLElement | null {
  // Find opened over it (Cmd/Ctrl+F): focus is find's.
  if (closedByFind) return false;
  if (acted?.focuses) return false;
  return acted && toTable ? canvasKeys() : true;
}

/** At a wide page: Base UI's Menu at its anchor. */
function PopupMenu({
  head,
  items,
  anchor,
  width,
  side,
  align = 'start',
  toTable = true,
  done,
}: {
  head: ReactNode;
  items: Item[][];
  anchor: Anchor;
  width: number;
  side: 'bottom' | 'right';
  align?: 'start' | 'end';
  /** An action gives the table focus; else focus goes back as Escape's. */
  toTable?: boolean;
  done: () => void;
}) {
  // The item that ran: closing then gives the table focus, or leaves it
  // where an item that focuses put it; Escape or a press outside puts focus
  // back where it was. Open until it closes, then gone once its closing has
  // played out.
  const acted = useRef<Item | null>(null);
  const [open, setOpenHere] = useState(true);
  return (
    <Menu.Root open={open} onOpenChange={setOpenHere} onOpenChangeComplete={(now) => now || done()}>
      <Menu.Portal>
        <Menu.Positioner anchor={anchor} side={side} align={align} sideOffset={4} collisionPadding={8} className="z-20 outline-none">
          <Menu.Popup
            data-menu
            finalFocus={() => finalFocus(acted.current, toTable)}
            style={{ width }}
            className="max-w-[calc(100vw-16px)] rounded-[10px] border border-border-strong bg-surface p-1.5 shadow-[0_16px_40px_var(--shadow)] outline-none select-none transition-opacity duration-100 data-[ending-style]:opacity-0 motion-reduce:transition-none"
          >
            {head}
            {items.map((group, i) => (
              <Menu.Group key={i}>
                {i > 0 && <Menu.Separator className="mx-1 my-[5px] h-px bg-border" />}
                {group.map((item) => (
                  <Menu.Item
                    key={item.label}
                    onClick={() => {
                      acted.current = item;
                      item.run();
                    }}
                    className="group flex h-[30px] cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[13px] text-foreground outline-none data-[highlighted]:bg-surface-active"
                  >
                    <Icon name={item.icon} className="text-foreground-muted group-data-[highlighted]:text-accent" />
                    <span className="flex-1 whitespace-nowrap">{item.label}</span>
                    {item.hint && <span className="text-[11.5px] whitespace-nowrap text-foreground-subtle">{item.hint}</span>}
                  </Menu.Item>
                ))}
              </Menu.Group>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** At a phone: a sheet from the bottom over a scrim, its rows 44 px tall
 *  (Phone 4). */
function SheetMenu({ head, items, label, toTable = true, done }: { head: ReactNode; items: Item[][]; label: string; toTable?: boolean; done: () => void }) {
  const acted = useRef<Item | null>(null);
  const [open, setOpenHere] = useState(true);
  return (
    <Drawer.Root open={open} onOpenChange={setOpenHere} onOpenChangeComplete={(now) => now || done()}>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-[25] bg-[var(--scrim)] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Drawer.Viewport className="fixed inset-0 z-[26] flex items-end">
          <Drawer.Popup
            data-menu
            aria-label={label}
            finalFocus={() => finalFocus(acted.current, toTable)}
            className="w-full overflow-hidden rounded-t-[14px] border-t border-border-strong bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_32px_var(--shadow)] outline-none select-none [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[300ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:[transform:translateY(calc(100%+2px))] data-[starting-style]:[transform:translateY(calc(100%+2px))] motion-reduce:transition-none"
          >
            <div aria-hidden="true" className="flex h-3.5 items-center justify-center">
              <span className="h-1 w-9 rounded-sm bg-border-strong" />
            </div>
            {head}
            <Drawer.Content className="py-1" role="menu">
              {items.map((group, i) => (
                <div key={i} role="group">
                  {i > 0 && <div role="separator" className="mx-4 my-1 h-px bg-border" />}
                  {group.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        acted.current = item;
                        item.run();
                        setOpenHere(false);
                      }}
                      className="flex h-11 w-full cursor-pointer items-center gap-3 px-4 text-left text-sm text-foreground outline-none hover:bg-surface-active focus-visible:bg-surface-active"
                    >
                      <Icon name={item.icon} size={16} className="text-foreground-muted" />
                      <span className="flex-1">{item.label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** The menu open, if any: drawn from the frame's columns, so a column
 *  pinned or hidden since its press shows as it is now. */
export function Menus({ state }: { state: FrameState }) {
  const phone = usePhone();
  const current = useSyncExternalStore(subscribe, getOpen, () => null);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  useEffect(() => {
    document.addEventListener('pointerdown', noteTouch, { capture: true });
    const unsubscribe = subscribePress((press) => pressed(press, phoneRef.current));
    // Cmd/Ctrl+F with a menu open: the menu closes and find takes focus
    // (`docs/DECISIONS.md`, "Scope", 2026-11-21, the page's keys).
    const unfind = subscribeFind(closeForFind);
    return () => {
      document.removeEventListener('pointerdown', noteTouch, { capture: true });
      unsubscribe();
      unfind();
    };
  }, []);
  // A file closed or replaced: its menu goes with it. A file's opening is
  // its log's first entry, whose number counts across files, so another
  // file's is another number even under the same name.
  const opening = state.log.entries[0]?.id ?? null;
  useEffect(() => setOpen(null), [opening]);
  if (!current || !state.file) return null;
  const column = state.columns.find((column) => column.index === current.index);
  if (!column) return null;
  const done = () => setOpen(null);
  // A new press opens a new menu: keyed by it, so the last one's state
  // (an item run, its closing) never carries over.
  const key = current.seq;
  if (current.kind === 'column') {
    const items = columnItems(column, state.tools.unsortable === null, current.anchor);
    if (phone) return <SheetMenu key={key} label={`${column.name}'s menu`} head={<ColumnHead column={column} phone />} items={items} done={done} />;
    return <PopupMenu key={key} head={<ColumnHead column={column} phone={false} />} items={items} anchor={current.anchor} width={236} side={current.fromTable ? 'bottom' : 'right'} done={done} />;
  }
  const head = <CellHead column={column} row={current.row} value={current.value} phone={phone} />;
  if (current.kind === 'field') {
    const items = fieldItems(current.row, column.index, current.known);
    if (phone) return <SheetMenu key={key} label={`Row ${current.row + 1}'s ${column.name}`} head={head} items={items} toTable={false} done={done} />;
    return <PopupMenu key={key} head={head} items={items} anchor={current.anchor} width={264} side="bottom" align="end" toTable={false} done={done} />;
  }
  if (phone) return <SheetMenu key={key} label={`Row ${current.row + 1}'s ${column.name}`} head={head} items={cellItems(current.row, column.index)} done={done} />;
  return <PopupMenu key={key} head={head} items={cellItems(current.row, column.index)} anchor={current.anchor} width={264} side="bottom" done={done} />;
}
