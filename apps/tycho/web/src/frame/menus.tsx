/**
 * A column's menu and a cell's menu, as the design canvas's Columns 1 and
 * Columns 2 draw them, holding only what runs (`docs/DECISIONS.md`,
 * "Scope", 2026-11-24): a column's Pin to the left (Unpin on a pinned
 * one), Hide (Show on a hidden one), and Fit to its values; a cell's Copy
 * and Open the row. Each later item joins with its goal, where its board
 * draws it.
 *
 * Opened by the table's presses (`state.ts`, `TablePress`: the header
 * icon's under its bounds, a header's or a cell's context press at the
 * pointer, a finger's tap on a header at a phone) and by the column list
 * (`columns.tsx`, `openColumnMenu`). A wide page's menu is Base UI's Menu
 * anchored there; a phone's, a sheet from the bottom, its rows a finger
 * tall (Phone 4). An action is a click's command (`core.ts`, `act`), or
 * the table's call (Fit, Copy), and puts focus on the table; Escape puts
 * focus back where it came from.
 */

import { Drawer } from '@base-ui/react/drawer';
import { Menu } from '@base-ui/react/menu';
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { act, canvasKeys, copySelection, fitColumn, setLogOpen, setSheetTab } from './core.ts';
import { Badge, Icon, type IconName } from './icons.tsx';
import { usePhone } from './log.tsx';
import { type ColumnFacts, type FrameState, subscribePress, type TablePress } from './state.ts';

/** What a menu is anchored to: an element (a row of the column list), or a
 *  box in the page (the header's icon, the pointer). */
type Anchor = Element | { getBoundingClientRect(): DOMRect };

type Open =
  | { kind: 'column'; index: number; anchor: Anchor; fromTable: boolean }
  | { kind: 'cell'; index: number; row: number; value: string | null; anchor: Anchor };

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
  open = next && { ...next, seq: ++opened };
  for (const listener of listeners) listener();
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
  run: () => void;
}

/** A column's items: Pin or Unpin, Hide or Show, and Fit; a hidden
 *  column's only Show (it can't be pinned, and has no width to fit). */
function columnItems(column: ColumnFacts): Item[][] {
  if (column.hidden) return [[{ icon: 'eye', label: 'Show', run: () => act(`show ${column.typed}`) }]];
  return [
    [
      column.pinned
        ? { icon: 'pin', label: 'Unpin', run: () => act(`unpin ${column.typed}`) }
        : { icon: 'pin', label: 'Pin to the left', run: () => act(`pin ${column.typed}`) },
      { icon: 'eyeoff', label: 'Hide', run: () => act(`hide ${column.typed}`) },
      { icon: 'columns', label: 'Fit to its values', run: () => fitColumn(column.index) },
    ],
  ];
}

/** A cell's items: Copy (the selection, which a context press inside it
 *  keeps) and Open the row. */
function cellItems(): Item[][] {
  return [
    [
      { icon: 'copy', label: 'Copy', hint: copyKey(), run: copySelection },
      // The right panel (at a phone, the sheet on its Log tab); its Row
      // tab, open at this row, comes with the row view.
      {
        icon: 'panelr',
        label: 'Open the row',
        run: () => {
          setSheetTab('log');
          setLogOpen(true);
        },
      },
    ],
  ];
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

/** At a wide page: Base UI's Menu at its anchor. */
function PopupMenu({ head, items, anchor, width, side, done }: { head: ReactNode; items: Item[][]; anchor: Anchor; width: number; side: 'bottom' | 'right'; done: () => void }) {
  // Whether an item ran: closing then gives the table focus; Escape or a
  // press outside puts focus back where it was. Open until it closes,
  // then gone once its closing has played out.
  const acted = useRef(false);
  const [open, setOpenHere] = useState(true);
  return (
    <Menu.Root open={open} onOpenChange={setOpenHere} onOpenChangeComplete={(now) => now || done()}>
      <Menu.Portal>
        <Menu.Positioner anchor={anchor} side={side} align="start" sideOffset={4} collisionPadding={8} className="z-20 outline-none">
          <Menu.Popup
            data-menu
            finalFocus={() => (acted.current ? canvasKeys() : true)}
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
                      acted.current = true;
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
function SheetMenu({ head, items, label, done }: { head: ReactNode; items: Item[][]; label: string; done: () => void }) {
  const acted = useRef(false);
  const [open, setOpenHere] = useState(true);
  return (
    <Drawer.Root open={open} onOpenChange={setOpenHere} onOpenChangeComplete={(now) => now || done()}>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-[25] bg-[var(--scrim)] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Drawer.Viewport className="fixed inset-0 z-[26] flex items-end">
          <Drawer.Popup
            data-menu
            aria-label={label}
            finalFocus={() => (acted.current ? canvasKeys() : true)}
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
                        acted.current = true;
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
    return () => {
      document.removeEventListener('pointerdown', noteTouch, { capture: true });
      unsubscribe();
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
    const items = columnItems(column);
    if (phone) return <SheetMenu key={key} label={`${column.name}'s menu`} head={<ColumnHead column={column} phone />} items={items} done={done} />;
    return <PopupMenu key={key} head={<ColumnHead column={column} phone={false} />} items={items} anchor={current.anchor} width={236} side={current.fromTable ? 'bottom' : 'right'} done={done} />;
  }
  const head = <CellHead column={column} row={current.row} value={current.value} phone={phone} />;
  if (phone) return <SheetMenu key={key} label={`Row ${current.row + 1}'s ${column.name}`} head={head} items={cellItems()} done={done} />;
  return <PopupMenu key={key} head={head} items={cellItems()} anchor={current.anchor} width={264} side="bottom" done={done} />;
}
