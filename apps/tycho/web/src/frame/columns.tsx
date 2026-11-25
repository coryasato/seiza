/**
 * The left panel's column list, as the design canvas's Views 1 draws its
 * lower half (the views above it come with their goal): its head
 * "Columns" with the shown count of all, the search field, and each
 * column a row of its badge and name, a hidden one muted with the eye-off
 * icon. A press or Enter on a row opens the column's menu (`menus.tsx`),
 * the one way in for a keyboard or a screen reader, until the profile
 * comes (`docs/DECISIONS.md`, "Scope", 2026-11-24). The head's "Show and
 * hide columns" button opens Columns 4's list as a dropdown under it.
 *
 * At a wide page it's a column of the page's grid at the table's left
 * (`core.ts`'s `setColumnsOpen`, the root's `data-columns`); at a phone,
 * the panels' sheet's Columns tab (`log.tsx`), without a profile.
 */

import { Popover } from '@base-ui/react/popover';
import { type KeyboardEvent, useId, useState, useSyncExternalStore } from 'react';
import { act, focusTable, isColumnsOpen, subscribeColumns } from './core.ts';
import { Badge, Icon } from './icons.tsx';
import { openColumnMenu } from './menus.tsx';
import type { ColumnFacts, FrameState } from './state.ts';

const useColumnsOpen = (): boolean => useSyncExternalStore(subscribeColumns, isColumnsOpen, () => false);

/** The columns whose name holds `query`, case aside. */
const matching = (columns: ColumnFacts[], query: string): ColumnFacts[] => {
  const needle = query.trim().toLowerCase();
  return needle ? columns.filter((column) => column.name.toLowerCase().includes(needle)) : columns;
};

function Search({ value, onChange, placeholder, tall }: { value: string; onChange: (value: string) => void; placeholder: string; tall?: boolean }) {
  return (
    <label className={`flex items-center gap-1.5 rounded-md border border-border bg-background px-2 focus-within:border-border-strong ${tall ? 'h-7' : 'h-[26px]'}`}>
      <Icon name="search" size={12} className="text-foreground-subtle" />
      <input
        type="text"
        aria-label="Search columns"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        autoComplete="off"
        className={`min-w-0 flex-1 border-0 bg-transparent text-foreground outline-none placeholder:text-foreground-subtle ${tall ? 'text-[12.5px]' : 'text-xs'}`}
      />
    </label>
  );
}

/** Columns 4's list: each column's eye, the hidden count, and Show all,
 *  anchored under the head's button, its left edge at the button's and
 *  kept inside the page (Columns 4 anchors it under the toolbar's chip,
 *  which comes with the toolbar). */
function ShowHide({ columns }: { columns: ColumnFacts[] }) {
  const [query, setQuery] = useState('');
  const hidden = columns.filter((column) => column.hidden).length;
  return (
    <Popover.Root onOpenChange={(open) => open || setQuery('')}>
      <Popover.Trigger
        aria-label="Show and hide columns"
        title="Show and hide columns"
        className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-raised hover:text-foreground data-[popup-open]:bg-surface-raised data-[popup-open]:text-foreground"
      >
        <Icon name="columns" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="z-20">
          <Popover.Popup
            id="columns-dropdown"
            aria-label="Show and hide columns"
            className="flex max-h-[min(480px,calc(100dvh-80px))] w-[288px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[10px] border border-border-strong bg-surface shadow-[0_16px_40px_var(--shadow)] outline-none select-none"
          >
            <div className="shrink-0 px-2 pt-2 pb-1">
              <Search value={query} onChange={setQuery} placeholder={`Search ${columns.length.toLocaleString('en-US')} columns`} tall />
            </div>
            <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain px-1.5 pb-1">
              {matching(columns, query).map((column) => (
                <li key={column.index} data-column={column.index} className="flex h-7 items-center gap-2 pl-1.5">
                  <Badge kind={column.type} />
                  <span className={`min-w-0 flex-1 truncate text-[12.5px] ${column.hidden ? 'text-foreground-subtle' : 'text-foreground'}`}>{column.name}</span>
                  <button
                    type="button"
                    aria-label={`${column.hidden ? 'Show' : 'Hide'} ${column.name}`}
                    onClick={() => act(`${column.hidden ? 'show' : 'hide'} ${column.typed}`)}
                    className={`flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-surface-raised ${column.hidden ? 'text-accent' : 'text-foreground-subtle hover:text-foreground'}`}
                  >
                    <Icon name={column.hidden ? 'eyeoff' : 'eye'} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex shrink-0 items-center justify-between border-t border-border py-1.5 pr-2 pl-3">
              <span className="text-[11.5px] text-foreground-subtle tabular-nums">
                {hidden.toLocaleString('en-US')} of {columns.length.toLocaleString('en-US')} hidden
              </span>
              <button
                type="button"
                disabled={hidden === 0}
                onClick={() => act('show all')}
                className="h-[26px] cursor-pointer rounded-md px-2 text-[12.5px] text-foreground-muted hover:bg-surface-raised hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
              >
                Show all
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The list: its head, the search, and the rows. */
export function ColumnList({ columns }: { columns: ColumnFacts[] }) {
  const [query, setQuery] = useState('');
  const listId = useId();
  const shown = columns.filter((column) => !column.hidden).length;
  const rows = matching(columns, query);
  return (
    <>
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border pr-1.5 pl-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12.5px] font-medium text-foreground">Columns</span>
          <span data-count className="text-[11.5px] text-foreground-subtle tabular-nums">
            {shown === columns.length ? columns.length.toLocaleString('en-US') : `${shown.toLocaleString('en-US')} of ${columns.length.toLocaleString('en-US')}`}
          </span>
        </div>
        <ShowHide columns={columns} />
      </div>
      <div className="shrink-0 px-2.5 py-2">
        <Search value={query} onChange={setQuery} placeholder="Search columns" />
      </div>
      <ul id={listId} aria-label="Columns" className="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-0 pb-2">
        {rows.map((column) => (
          <li key={column.index}>
            <button
              type="button"
              data-column={column.index}
              aria-haspopup="menu"
              aria-label={column.hidden ? `${column.name}, hidden` : column.name}
              onClick={(event) => openColumnMenu(column.index, event.currentTarget)}
              className="flex h-7 w-full cursor-pointer items-center gap-2 pr-2.5 pl-3 text-left outline-none hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:shadow-[inset_2px_0_0_var(--accent)]"
            >
              <Badge kind={column.type} />
              <span className={`min-w-0 flex-1 truncate text-[12.5px] ${column.hidden ? 'text-foreground-subtle' : 'text-foreground'}`}>{column.name}</span>
              {column.hidden && <Icon name="eyeoff" size={12} className="text-foreground-subtle" />}
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-3 py-2 text-xs text-foreground-subtle">No column&rsquo;s name holds &ldquo;{query.trim()}&rdquo;.</li>}
      </ul>
    </>
  );
}

/** Escape in the panel gives the table the keys, the panel left open. Not
 *  a key from a popup it opened (the show-and-hide list): React passes a
 *  portal's events up to it, and the popup's Escape is its own. */
function panelKeys(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Escape' || !event.currentTarget.contains(event.target as Node)) return;
  event.preventDefault();
  focusTable();
}

/** The left panel, at a wide page while a file is open and it's opened. */
export function ColumnsPanel({ state }: { state: FrameState }) {
  const open = useColumnsOpen();
  if (!state.file || !open) return null;
  return (
    <aside
      id="columns"
      aria-label="Columns"
      onKeyDown={panelKeys}
      className="flex min-h-0 w-[264px] flex-col overflow-hidden border-r border-border bg-surface [grid-area:cols] max-sm:hidden"
    >
      <ColumnList columns={state.columns} />
    </aside>
  );
}

/** The top bar's left button: the left panel, opened and closed. Pressed
 *  through `data-action`, as every control the page may show before
 *  React is; a wide page's alone (at a phone the list is the sheet's). */
export function ColumnsButton() {
  const open = useColumnsOpen();
  return (
    <button
      type="button"
      data-action="columns"
      aria-label="Toggle the left panel"
      aria-pressed={open}
      title="Toggle the left panel"
      className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-muted hover:bg-surface-raised aria-pressed:text-foreground max-sm:hidden"
    >
      <Icon name="panell" />
    </button>
  );
}
