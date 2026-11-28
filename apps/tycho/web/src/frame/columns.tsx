/**
 * The left panel's column list, as the design canvas's Views 1 draws its
 * lower half (the views above it come with their goal): its head
 * "Columns" with the shown count of all, the search field, and each
 * column a row of its badge and name, a hidden one muted with the eye-off
 * icon, a column with nulls its share at the right ("0.3% null") where
 * it's known of every row in view. A press, Enter, or Space on a row opens
 * its column's profile in place under it, one at a time (the Profile
 * page's Panel 1 to 3, drawn from the frame's `profiles`, every word the
 * app's: `crate/src/panel.rs`), and again closes it; Escape in it closes
 * it, focus back on its row. Its foot holds Filter, Sort, Hide, and More,
 * which opens the column's whole menu (`menus.tsx`), so a keyboard reaches
 * every item from the list (`docs/DECISIONS.md`, "Scope", 2026-11-27). A
 * screen reader hears its stage change once, through a live region. The
 * head's "Show and hide columns" button opens Columns 4's list as a
 * dropdown under it.
 *
 * At a wide page it's a column of the page's grid at the table's left
 * (`core.ts`'s `setColumnsOpen`, the root's `data-columns`); at a phone,
 * the panels' sheet's Columns tab (`log.tsx`), the same profile in it.
 */

import { Popover } from '@base-ui/react/popover';
import { type KeyboardEvent, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import {
  act,
  askProfileFor,
  focusTable,
  getOpenProfile,
  isColumnsOpen,
  type OpenProfile,
  setOpenProfile,
  subscribeColumns,
  subscribeOpenProfile,
  takeProfileFocus,
} from './core.ts';
import { Badge, Icon, type IconName } from './icons.tsx';
import { openColumnMenu, openSortMenu } from './menus.tsx';
import type { ColumnFacts, ColumnType, FrameState, PanelProfile } from './state.ts';
import { openFilterEditor } from './toolbar.tsx';

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
 *  the popup's inside: the left panel's head opens it under its button,
 *  and the toolbar's Columns control under itself (`toolbar.tsx`). */
export function ShowHideList({ columns }: { columns: ColumnFacts[] }) {
  const [query, setQuery] = useState('');
  const hidden = columns.filter((column) => column.hidden).length;
  return (
    <>
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
    </>
  );
}

/** The popup's frame, wherever it's anchored. */
export const SHOW_HIDE_POPUP =
  'flex max-h-[min(480px,calc(100dvh-80px))] w-[288px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-[10px] border border-border-strong bg-surface shadow-[0_16px_40px_var(--shadow)] outline-none select-none';

/** The panel's head's button, the list anchored under it, its left edge
 *  at the button's and kept inside the page. */
function ShowHide({ columns }: { columns: ColumnFacts[] }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Show and hide columns"
        title="Show and hide columns"
        className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-raised hover:text-foreground data-[popup-open]:bg-surface-raised data-[popup-open]:text-foreground"
      >
        <Icon name="columns" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="z-20">
          <Popover.Popup id="columns-dropdown" aria-label="Show and hide columns" className={SHOW_HIDE_POPUP}>
            <ShowHideList columns={columns} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const useOpenProfile = (): OpenProfile | null => useSyncExternalStore(subscribeOpenProfile, getOpenProfile, () => null);

/** The bars' color, by the column's type. */
const BAR: Record<ColumnType, string> = {
  number: 'bg-type-number',
  time: 'bg-type-time',
  text: 'bg-type-text',
  boolean: 'bg-type-boolean',
};

/** `item` (a row, or a row and its open profile) kept in its list's
 *  sight as far as it fits, its top first, the list alone scrolled
 *  (`scrollIntoView` would scroll the page around it). */
function keepInSight(item: HTMLElement): void {
  const list = item.closest('ul');
  if (!list) return;
  const top = item.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  const bottom = top + item.offsetHeight;
  if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  if (top < list.scrollTop) list.scrollTop = top;
}

/** The histogram: Panel 1's placeholder bars until bins are read, then a
 *  sample's muted, every row's full; its range under it. */
function Bars({ profile, type }: { profile: PanelProfile | undefined; type: ColumnType }) {
  const bins = profile?.bins ?? null;
  const most = bins ? Math.max(1, ...bins) : 1;
  return (
    <div className="flex flex-col gap-[3px]">
      <div aria-hidden="true" data-bars={bins ? (profile?.sampled ? 'sampled' : 'exact') : 'waiting'} className="flex h-11 items-end gap-[2px]">
        {(bins ?? Array.from({ length: 20 }, () => -1)).map((count, i) =>
          count < 0 ? (
            <span key={i} className="h-2.5 flex-1 rounded-[1px] bg-border-strong" />
          ) : count === 0 ? (
            <span key={i} className="h-px flex-1 bg-border" />
          ) : (
            <span key={i} style={{ height: Math.max(2, Math.round((count / most) * 44)), opacity: profile?.sampled ? 0.32 : 0.7 }} className={`flex-1 rounded-[1px] ${BAR[type]}`} />
          ),
        )}
      </div>
      {profile?.range && (
        <div className="flex justify-between gap-2 text-[10.5px] text-foreground-subtle tabular-nums">
          <span className="truncate">{profile.range[0]}</span>
          <span className="truncate">{profile.range[1]}</span>
        </div>
      )}
    </div>
  );
}

/** A text column's most common values, as the Grouping page's sketch of
 *  a text column's profile draws them. */
function TopValues({ profile, type }: { profile: PanelProfile; type: ColumnType }) {
  const top = profile.top ?? [];
  const most = Math.max(1, ...top.map((value) => value.count));
  return (
    <div className="flex flex-col gap-[5px]">
      {top.map((value) => (
        <div key={value.value} className="flex items-center gap-2 text-[11.5px]">
          <span title={value.value} className="w-[84px] shrink-0 truncate text-foreground">
            {value.value}
          </span>
          <span aria-hidden="true" className="flex h-1.5 min-w-0 flex-1">
            <span style={{ width: `${Math.max(2, Math.round((value.count / most) * 100))}%`, opacity: profile.sampled ? 0.32 : 0.7 }} className={`h-1.5 rounded-[2px] ${BAR[type]}`} />
          </span>
          <span className="shrink-0 text-right text-foreground-subtle tabular-nums">{value.words}</span>
        </div>
      ))}
      {profile.topLine && <span className="text-[10.5px] text-foreground-subtle">{profile.topLine}</span>}
    </div>
  );
}

/** A button of the profile's foot; `iconOnly`, its name in its label and
 *  title alone (More: four words don't fit the panel's width). */
function FootButton({ icon, label, title, disabled, iconOnly, onPress }: { icon: IconName; label: string; title?: string; disabled?: boolean; iconOnly?: boolean; onPress: (button: HTMLElement) => void }) {
  return (
    <button
      type="button"
      title={title ?? (iconOnly ? label : undefined)}
      aria-label={iconOnly ? label : undefined}
      aria-disabled={disabled || undefined}
      onClick={(event) => !disabled && onPress(event.currentTarget)}
      className={`flex h-6 shrink-0 cursor-pointer items-center gap-[5px] rounded-[5px] border border-border-strong text-[11.5px] text-foreground-muted outline-none hover:bg-surface-active hover:text-foreground focus-visible:border-accent aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent ${iconOnly ? 'w-6 justify-center' : 'px-2'}`}
    >
      <Icon name={icon} size={12} />
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}

/** A figure's label and value fit half the panel's width: else the grid is
 *  one column ("Distinct" beside "at least 2,249"). */
const fitsHalf = (figure: { label: string; value: string }): boolean => figure.label.length + figure.value.length <= 18;

/** A column's profile, under its row: the type and the stage's line, the
 *  shape, the figures, and the foot. */
function Profile({ id, column, profile, unsortable, row }: { id: string; column: ColumnFacts; profile: PanelProfile | undefined; unsortable: string | null; row: () => HTMLElement | null }) {
  const text = column.type === 'text' || column.type === 'boolean';
  return (
    <div id={id} role="region" aria-label={`${column.name}'s profile`} aria-busy={profile?.reading ?? true} data-profile={column.name} data-stage={profile?.stage ?? 'none'} className="flex flex-col gap-2.5 border-b border-border bg-surface-raised px-3 pt-2.5 pb-3">
      <div className="flex items-baseline justify-between gap-2 text-[10.5px] text-foreground-subtle">
        <span className="shrink-0 font-mono">{column.dataType}</span>
        <span data-line className={`min-w-0 text-right ${profile?.error ? 'text-error' : ''}`}>
          {profile?.line ?? ''}
        </span>
      </div>
      {text && profile?.top ? <TopValues profile={profile} type={column.type} /> : text ? null : <Bars profile={profile} type={column.type} />}
      <dl className={`m-0 grid gap-x-4 gap-y-1 ${(profile?.figures ?? []).every(fitsHalf) ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {(profile?.figures ?? []).map((figure) => (
          <div key={figure.label} className="flex min-w-0 justify-between gap-2 text-[11.5px]">
            <dt className="truncate text-foreground-subtle">{figure.label}</dt>
            <dd className="m-0 shrink-0 text-foreground tabular-nums">{figure.value}</dd>
          </div>
        ))}
      </dl>
      {profile?.note && <span className="-mt-1 text-[10.5px] text-foreground-subtle">{profile.note}</span>}
      <div className="flex gap-1.5">
        {column.hidden ? (
          <FootButton icon="eye" label="Show" onPress={() => act(`show ${column.typed}`)} />
        ) : (
          <>
            <FootButton icon="filter" label="Filter" onPress={() => openFilterEditor(column.index, row())} />
            <FootButton icon="sort" label="Sort" disabled={unsortable !== null} title={unsortable ?? undefined} onPress={(button) => openSortMenu(column.index, button)} />
            <FootButton icon="eyeoff" label="Hide" onPress={() => act(`hide ${column.typed}`)} />
          </>
        )}
        <FootButton icon="more" label="More" title={`More: ${column.name}'s menu`} iconOnly onPress={(button) => openColumnMenu(column.index, button)} />
      </div>
    </div>
  );
}

/** A column's row and, while it's open, its profile under it. */
function ColumnRow({ column, open, file, share, profile, unsortable, focusAsk }: { column: ColumnFacts; open: boolean; file: number; share: string | undefined; profile: PanelProfile | undefined; unsortable: string | null; focusAsk: number | null }) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLLIElement>(null);
  const id = useId();
  // Opened, the profile comes into sight under its row, and again as a
  // stage makes it taller (a text column's values come with its answer).
  useEffect(() => {
    if (open && itemRef.current) keepInSight(itemRef.current);
  }, [open, profile?.stage]);
  // "Show its profile", or Escape in it: the row takes focus once drawn.
  useEffect(() => {
    if (focusAsk === null || !rowRef.current) return;
    takeProfileFocus();
    rowRef.current.focus({ preventScroll: true });
    keepInSight(rowRef.current);
  }, [focusAsk]);
  const label = [column.name, column.hidden ? 'hidden' : share].filter(Boolean).join(', ');
  return (
    <li
      ref={itemRef}
      onKeyDown={(event) => {
        // Escape in the open profile (not in a menu it opened: React
        // passes a portal's keys up to it) closes it, focus on its row.
        if (event.key !== 'Escape' || !open || !event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        event.stopPropagation();
        setOpenProfile(null, file);
        rowRef.current?.focus({ preventScroll: true });
      }}
    >
      <button
        ref={rowRef}
        type="button"
        data-column={column.index}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpenProfile(open ? null : column.name, file)}
        className={`group flex h-7 w-full cursor-pointer items-center gap-2 pr-2.5 pl-3 text-left outline-none hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:shadow-[inset_2px_0_0_var(--accent)] ${open ? 'bg-surface-raised' : ''}`}
      >
        <Badge kind={column.type} />
        <span className={`min-w-0 flex-1 truncate text-[12.5px] ${column.hidden ? 'text-foreground-subtle' : 'text-foreground'}`}>{column.name}</span>
        {column.hidden ? (
          <Icon name="eyeoff" size={12} className="text-foreground-subtle" />
        ) : (
          share && (
            <span data-nulls className="shrink-0 text-[10.5px] whitespace-nowrap text-foreground-subtle tabular-nums">
              {share}
            </span>
          )
        )}
        <span className={`shrink-0 transition-transform duration-100 motion-reduce:transition-none ${open ? 'text-foreground-muted' : '-rotate-90 text-foreground-subtle opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}>
          <Icon name="chevd" size={12} />
        </span>
      </button>
      {open && <Profile id={id} column={column} profile={profile} unsortable={unsortable} row={() => rowRef.current} />}
    </li>
  );
}

/** The list: its head, the search, and the rows. */
export function ColumnList({ state }: { state: FrameState }) {
  const { columns } = state;
  const [query, setQuery] = useState('');
  const listId = useId();
  const shown = columns.filter((column) => !column.hidden).length;
  // The open profile, if it was opened in this file and its column is
  // still one of it: another file closes it.
  const file = state.log.entries[0]?.id ?? 0;
  const asked = useOpenProfile();
  const open = asked && asked.file === file && columns.some((column) => column.name === asked.column) ? asked : null;
  const openColumn = open?.column ?? null;
  // While the list is drawn, its open column's profile is read; drawn no
  // longer (the panel or the sheet closed), it isn't. Each list asks as
  // itself: at a phone the wide panel stays mounted, hidden, beside the
  // sheet's, and one closing mustn't take back the other's ask.
  const asker = useId();
  useEffect(() => {
    askProfileFor(asker, openColumn);
    return () => askProfileFor(asker, null);
  }, [asker, openColumn]);
  // "Show its profile" on a column the search leaves out: the search goes.
  const focusAsk = open?.focus ? open.seq : null;
  const rows = matching(columns, focusAsk !== null && !matching(columns, query).some((column) => column.name === openColumn) ? '' : query);
  useEffect(() => {
    if (focusAsk !== null && query && !matching(columns, query).some((column) => column.name === openColumn)) setQuery('');
  }, [focusAsk]);
  // Its stage, said once as it changes: not every bar, nor every wait.
  const profile = state.profiles.find((profile) => profile.column === openColumn);
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (profile) setSaid(`${profile.column}'s profile: ${profile.line}`);
  }, [openColumn, profile?.stage]);
  useEffect(() => {
    if (!openColumn) setSaid('');
  }, [openColumn]);
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
          <ColumnRow
            key={column.index}
            column={column}
            open={column.name === openColumn}
            file={file}
            share={state.nullShares[column.name]}
            profile={column.name === openColumn ? profile : undefined}
            unsortable={state.tools.unsortable}
            focusAsk={column.name === openColumn ? focusAsk : null}
          />
        ))}
        {rows.length === 0 && <li className="px-3 py-2 text-xs text-foreground-subtle">No column&rsquo;s name holds &ldquo;{query.trim()}&rdquo;.</li>}
      </ul>
      <span data-profile-said aria-live="polite" className="sr-only">
        {said}
      </span>
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
      <ColumnList state={state} />
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
