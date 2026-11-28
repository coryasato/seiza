/**
 * The toolbar over the table, as the design canvas's Toolbar page draws it
 * (`docs/DECISIONS.md`, "Scope", 2026-11-21: one control a kind, never a
 * chip a filter, the count beside them): Filter, Sort, and Columns
 * outlined with nothing applied (Toolbar 0); a chip a kind with something
 * ("Filters · 5", "launch_date ↓" with its remove, "3 hidden"; Toolbar 1,
 * Option 1); the rows in view beside them. At a phone, the icons with
 * their counts (Option 3 at a phone, Toolbar 0 at a phone). Find at its
 * right (`find.tsx`): while it's open the chips step down to those icons
 * at a wide page (Find inline), and at a phone it takes a second row.
 *
 * What each control opens: the filters' chip their list (Option 1, its
 * list open), each filter read in words and removed alone, and "Add a
 * filter"; Filter, and "Filter this column" in a column's menu, the filter
 * editor (Filter 1 to 3, its preview drawn from the column's profile); the
 * sort's the sort editor (Columns 3); the hidden chip, or Columns, the
 * show-and-hide list (Columns 4). At a wide page each is a popover under
 * its control; at a phone a sheet from the bottom, but Columns, which
 * turns the panels' sheet to its Columns tab. Everything acts through the
 * page's `command` as a click (`core.ts`, `act`): the crate reads, checks,
 * and logs it, and the editors' foot is the command as the bar reads it.
 */

import { Drawer } from '@base-ui/react/drawer';
import { Popover } from '@base-ui/react/popover';
import { Select } from '@base-ui/react/select';
import { createContext, type ReactNode, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ShowHideList, SHOW_HIDE_POPUP } from './columns.tsx';
import { act, appNow, askProfileFor, canvasKeys, closeFind, getFind, setLogOpen, setSheetTab, subscribeFind } from './core.ts';
import { FindBar, FindButton, useFind } from './find.tsx';
import { Badge, Icon, type IconName } from './icons.tsx';
import { usePhone } from './log.tsx';
import type { ColumnFacts, ColumnType, Completion, FilterFacts, FrameState, PanelProfile } from './state.ts';

/** What the toolbar has open: the filters' list, the filter editor (on
 *  `column`, its index, or the first one shown), the sort editor, or the
 *  show-and-hide list. */
type Open =
  | { kind: 'filters' }
  /** `back`: where Escape puts focus, when not on the control (a column's
   *  menu opened it from the column list's row, or from the table). */
  | { kind: 'filter'; column: number | null; back?: HTMLElement | null }
  | { kind: 'sort' }
  | { kind: 'columns' };

let open: (Open & { seq: number }) | null = null;
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
const useOpen = () => useSyncExternalStore(subscribe, getOpen, () => null);

/** A column's menu's "Filter this column": the editor on it, Escape
 *  giving focus `back` where the menu was opened from. */
export function openFilterEditor(column: number, back: HTMLElement | null): void {
  setOpen({ kind: 'filter', column, back });
}

const count = (n: number) => n.toLocaleString('en-US');

/** "29,118 of 71,431 rows", or with nothing filtered "71,431 rows"; at a
 *  phone the rows in view alone. */
function RowCount({ state, phone }: { state: FrameState; phone: boolean }) {
  const total = state.file?.rows ?? 0;
  const shown = state.tools.shown;
  // The filters asked for aren't counted yet: no count beside them that
  // would read as theirs.
  if (state.tools.counting)
    return (
      <span data-count className="shrink-0 pl-1.5 text-xs whitespace-nowrap text-foreground-subtle">
        Counting rows…
      </span>
    );
  return (
    <span data-count className="shrink-0 pl-1.5 text-xs whitespace-nowrap text-foreground-subtle tabular-nums">
      <span className="text-foreground">{count(shown ?? total)}</span>
      {shown === null || phone ? ' rows' : ` of ${count(total)} rows`}
    </span>
  );
}

const CHIP = 'flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md text-[12.5px] whitespace-nowrap outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]';
const ON = 'bg-accent-tint text-accent';
const OFF = 'border border-border text-foreground-muted hover:bg-surface-raised hover:text-foreground';

/** A sort's arrow as the chip writes it. */
const arrow = (direction: 'asc' | 'desc') => (direction === 'asc' ? '↑' : '↓');

/** What each control says, for its label and its look. */
interface Control {
  kind: 'filter' | 'sort' | 'columns';
  icon: IconName;
  /** At a wide page. */
  label: string;
  /** At a phone, beside the icon; null for none (nothing applied). */
  short: string | null;
  /** For a screen reader. */
  aria: string;
  on: boolean;
  chevron?: boolean;
}

function controls(state: FrameState): Control[] {
  const { filters, sort } = state.tools;
  const hidden = state.columns.filter((column) => column.hidden).length;
  const sortName = sort && state.columns.find((column) => column.index === sort.column)?.name;
  return [
    filters.length
      ? {
          kind: 'filter',
          icon: 'filter',
          label: `Filters · ${count(filters.length)}`,
          short: count(filters.length),
          aria: `${count(filters.length)} filter${filters.length === 1 ? '' : 's'}`,
          on: true,
          chevron: true,
        }
      : { kind: 'filter', icon: 'filter', label: 'Filter', short: null, aria: 'Filter', on: false },
    sort && sortName
      ? { kind: 'sort', icon: 'sort', label: `${sortName} ${arrow(sort.direction)}`, short: '1', aria: `Sorted by ${sortName}, ${sort.words}`, on: true }
      : { kind: 'sort', icon: 'sort', label: 'Sort', short: null, aria: 'Sort', on: false },
    hidden
      ? { kind: 'columns', icon: 'eyeoff', label: `${count(hidden)} hidden`, short: count(hidden), aria: `${count(hidden)} hidden column${hidden === 1 ? '' : 's'}`, on: true }
      : { kind: 'columns', icon: 'columns', label: 'Columns', short: null, aria: 'Columns', on: false },
  ];
}

/** The kind a control opens: the filters' chip their list, Filter the
 *  editor. */
const opens = (control: Control): Open =>
  control.kind === 'filter' ? (control.on ? { kind: 'filters' } : { kind: 'filter', column: null }) : { kind: control.kind };

/** Whether `current` is what `control`'s popover holds: the filter's
 *  control holds both the list and the editor ("Add a filter" swaps one
 *  for the other in place). */
const holds = (control: Control, current: Open | null) =>
  !!current && (control.kind === 'filter' ? current.kind === 'filter' || current.kind === 'filters' : current.kind === control.kind);

/** A wide page's control: its button, and the sort's remove beside it in
 *  one chip; `compact` while find is open, its icon and count alone (Find
 *  inline), the same popover on it. Its popover keeps drawing what it held
 *  while its closing plays (Base UI drops the popup once it has), so it
 *  never fades out empty. */
function Chip({ control, state, compact }: { control: Control; state: FrameState; compact: boolean }) {
  const current = useOpen();
  const shown = holds(control, current);
  const acted = useRef(false);
  const last = useRef<Open | null>(null);
  if (shown) last.current = current;
  const held = shown ? current : last.current;
  // Each opening starts unacted, however it was opened: its trigger, a
  // column's menu (`openFilterEditor`), or "Add a filter".
  const seq = shown ? current?.seq : null;
  useEffect(() => {
    if (seq != null) acted.current = false;
  }, [seq]);
  const close = (byAction: boolean) => {
    acted.current = byAction;
    setOpen(null);
  };
  const removable = control.on && control.kind === 'sort' && !compact;
  return (
    <Popover.Root
      open={shown}
      onOpenChange={(now) => {
        if (now) {
          acted.current = false;
          setOpen(opens(control));
        } else if (holds(control, getOpen())) setOpen(null);
      }}
    >
      {/* One shape whatever the state, so the trigger stays the same
          element (the popover's anchor) as a sort comes and goes. */}
      <span className={`flex h-[26px] shrink-0 items-center rounded-md ${control.on ? ON : OFF}`}>
        <Popover.Trigger
          data-tool={control.kind}
          aria-label={control.aria}
          className={`${CHIP} h-full ${compact ? 'px-2 tabular-nums' : removable ? 'pr-1 pl-2' : control.chevron ? 'pr-1.5 pl-2' : 'pr-[9px] pl-2'}`}
        >
          <Icon name={control.icon} size={13} />
          {compact ? control.short && <span>{control.short}</span> : <span>{control.label}</span>}
          {control.chevron && !compact && <Icon name="chevd" size={11} />}
        </Popover.Trigger>
        {removable && (
          <button
            type="button"
            aria-label="Remove the sort"
            onClick={() => act('clear sort')}
            className="mr-[5px] flex size-[18px] cursor-pointer items-center justify-center rounded hover:bg-accent-tint"
          >
            <Icon name="x" size={11} />
          </button>
        )}
      </span>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={8} className="z-20 outline-none">
          <Popover.Popup
            data-menu
            finalFocus={() => {
              // Find opened over it: focus is find's.
              if (closedByFind) return false;
              if (acted.current) return canvasKeys();
              const back = held?.kind === 'filter' ? held.back : null;
              return back?.isConnected ? back : true;
            }}
            className={control.kind === 'columns' ? SHOW_HIDE_POPUP : 'max-w-[calc(100vw-16px)] overflow-hidden rounded-[10px] border border-border-strong bg-surface shadow-[0_16px_40px_var(--shadow)] outline-none select-none'}
          >
            <Close.Provider value={close}>{held && <Inside current={held} state={state} phone={false} />}</Close.Provider>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Closes the popup or the sheet a control's inside is drawn in, through
 *  it, so its closing plays (a sheet clears the store once it has):
 *  `byAction`, an action ended it, and focus goes to the table as the
 *  menus' does; else (Cancel) back where it was, as Escape or a press
 *  outside puts it. */
const Close = createContext<(byAction: boolean) => void>(() => setOpen(null));

/** Close what's open after an action that ends it. */
function useDone(): () => void {
  const close = useContext(Close);
  return () => close(true);
}

/** The open control's inside, at either size. */
function Inside({ current, state, phone }: { current: Open; state: FrameState; phone: boolean }) {
  switch (current.kind) {
    case 'filters':
      return <FilterList state={state} phone={phone} />;
    case 'filter':
      return <FilterEditor key={`${current.column}`} state={state} column={current.column} phone={phone} />;
    case 'sort':
      return <SortEditor state={state} phone={phone} />;
    case 'columns':
      return <ShowHideList columns={state.columns} />;
  }
}

/** The filters' list (Option 1, its list open). */
function FilterList({ state, phone }: { state: FrameState; phone: boolean }) {
  const done = useDone();
  const { filters } = state.tools;
  // The last filter removed: nothing left to list, and the table takes the
  // keys, as after any action that ends the list.
  useEffect(() => {
    if (filters.length === 0 && getOpen()?.kind === 'filters') done();
  }, [filters.length]);
  return (
    <div className={phone ? 'w-full' : 'w-[340px]'}>
      <div className="flex h-9 items-center justify-between border-b border-border pr-2 pl-3">
        <span className="text-[12.5px] font-medium text-foreground">Filters · {count(filters.length)}</span>
        <button
          type="button"
          onClick={() => {
            act('clear filters');
            done();
          }}
          className="h-6 cursor-pointer rounded-[5px] px-2 text-xs text-foreground-muted hover:bg-surface-raised hover:text-foreground"
        >
          Clear all
        </button>
      </div>
      <ul className="m-0 max-h-[min(320px,50dvh)] list-none overflow-y-auto px-1.5 py-1">
        {filters.map((filter, i) => (
          <FilterRow key={`${i}:${filter.line}`} filter={filter} column={state.columns.find((column) => column.index === filter.column)} phone={phone} />
        ))}
      </ul>
      <div className="border-t border-border p-1.5">
        <button
          type="button"
          onClick={() => setOpen({ kind: 'filter', column: null })}
          className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 text-[12.5px] text-foreground-muted hover:bg-surface-raised hover:text-foreground ${phone ? 'h-11 w-full text-sm' : 'h-7'}`}
        >
          <Icon name="plus" size={13} />
          <span>Add a filter</span>
        </button>
      </div>
    </div>
  );
}

/** A filter's values as its words read them: `1 and 10`, `mb, mww`. */
const spoken = (filter: FilterFacts) => (filter.op === 'between' ? filter.values.join(' and ') : filter.values.join(', '));

function FilterRow({ filter, column, phone }: { filter: FilterFacts; column: ColumnFacts | undefined; phone: boolean }) {
  if (!column) return null;
  const values = spoken(filter);
  return (
    <li className={`flex items-center gap-2 pr-0.5 pl-1.5 ${phone ? 'h-11' : 'h-8'}`}>
      <Badge kind={column.type} />
      <span className="min-w-0 flex-1 truncate text-[12.5px]" title={`${column.name} ${filter.words}${values ? ` ${values}` : ''}`}>
        <span className="text-foreground">{column.name}</span> <span className="text-foreground-subtle">{filter.words}</span>
        {values && <span className="font-mono text-xs text-foreground"> {values}</span>}
      </span>
      <button
        type="button"
        aria-label={`Remove the filter: ${column.name} ${filter.words}${values ? ` ${values}` : ''}`}
        onClick={() => act(filter.remove)}
        className={`flex shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-foreground-subtle hover:bg-surface-raised hover:text-foreground ${phone ? 'size-9' : 'size-6'}`}
      >
        <Icon name="x" size={12} />
      </button>
    </li>
  );
}

/** A select of the editors: a column (its badge and name), an operator, a
 *  direction. */
function Choice<T extends string | number>({
  label,
  value,
  items,
  onChange,
  width,
  disabled,
}: {
  label: string;
  value: T;
  items: { value: T; label: string; badge?: ColumnFacts['type'] }[];
  onChange: (value: T) => void;
  width?: number;
  disabled?: boolean;
}) {
  const shown = items.find((item) => item.value === value);
  return (
    <Select.Root value={value} onValueChange={(next) => next !== null && onChange(next as T)} disabled={disabled}>
      <Select.Trigger
        aria-label={label}
        style={width ? { width } : undefined}
        className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface-raised pr-1.5 pl-2 text-[12.5px] whitespace-nowrap text-foreground outline-none focus-visible:border-accent data-[disabled]:cursor-default data-[disabled]:opacity-60 ${width ? 'shrink-0' : 'min-w-0 flex-1'}`}
      >
        {shown?.badge && <Badge kind={shown.badge} />}
        <span className="min-w-0 flex-1 truncate text-left">{shown?.label ?? ''}</span>
        <Icon name="chevd" size={11} className="text-foreground-muted" />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner side="bottom" align="start" sideOffset={4} alignItemWithTrigger={false} collisionPadding={8} className="z-40 outline-none">
          <Select.Popup className="max-h-[min(320px,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto rounded-[10px] border border-border-strong bg-surface p-1 shadow-[0_16px_40px_var(--shadow)] outline-none select-none">
            <Select.List>
              {items.map((item) => (
                <Select.Item
                  key={item.value}
                  value={item.value}
                  className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[12.5px] text-foreground outline-none data-[highlighted]:bg-surface-active data-[selected]:text-accent"
                >
                  {item.badge && <Badge kind={item.badge} />}
                  <Select.ItemText className="whitespace-nowrap">{item.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

/** The crate's completion of `line`, its caret at the end; null before
 *  the app. */
const completion = (line: string): Completion | null => appNow()?.complete(line, line.length) ?? null;

/** The column an editor starts on: the table's active cell's, else the
 *  first one shown. */
function startColumn(state: FrameState): ColumnFacts | undefined {
  const shown = state.columns.filter((column) => !column.hidden);
  return shown.find((column) => column.index === state.active?.column) ?? shown[0];
}

const columnItems = (columns: ColumnFacts[]) => columns.map((column) => ({ value: column.index, label: column.name, badge: column.type }));

/** The editors' foot: the command as the bar reads it, and its buttons. */
function Foot({ line, children }: { line: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border bg-background py-2 pr-2 pl-3">
      <span data-line className="min-w-0 truncate font-mono text-[11.5px] text-foreground-muted" title={line}>
        {line}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

const QUIET = 'h-[26px] cursor-pointer rounded-md px-2.5 text-[12.5px] text-foreground-muted hover:bg-surface-raised hover:text-foreground';

/** The operator a column's editor starts on, by its type, as Filter 1
 *  to 3 draw them: a number's `is at least`, text's `is any of`, a time's
 *  `is between`. */
const FIRST_OP: Record<ColumnFacts['type'], string> = { number: '>=', text: 'in', time: 'between', boolean: '=' };

/** A date `days` ago (0: today), as ISO writes it, in the page's zone. */
function isoDay(days: number, from = new Date()): string {
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** The bars' color, by the column's type, as the column list's. */
const BAR: Record<ColumnType, string> = {
  number: 'bg-type-number',
  time: 'bg-type-time',
  text: 'bg-type-text',
  boolean: 'bg-type-boolean',
};

/** Filter 1's and 3's histogram under the fields: the profile's bars, those
 *  the filter keeps in the accent as the value changes (`keeps`, the
 *  crate's `App.filter_bins`; none marked until a value is one), the range
 *  under them with the line between its ends. Until bars are read, the
 *  column list's placeholders. */
function PreviewBars({ profile, type, keeps }: { profile: PanelProfile | undefined; type: ColumnType; keeps: Uint8Array | null }) {
  const bins = profile?.bins ?? null;
  const most = bins ? Math.max(1, ...bins) : 1;
  const range = profile?.previewRange;
  return (
    <div data-preview="bars" className="flex flex-col gap-1">
      <div aria-hidden="true" data-bars={bins ? (keeps ? 'marked' : profile?.sampled ? 'sampled' : 'exact') : 'waiting'} className="flex h-10 items-end gap-[2px]">
        {(bins ?? Array.from({ length: 20 }, () => -1)).map((count, i) => {
          if (count < 0) return <span key={i} className="h-2.5 flex-1 rounded-[1px] bg-border-strong" />;
          if (count === 0) return <span key={i} className="h-px flex-1 bg-border" />;
          const kept = keeps ? keeps[i] === 1 : null;
          const height = Math.max(2, Math.round((count / most) * 40));
          return (
            <span
              key={i}
              data-kept={kept === null ? undefined : kept}
              style={{ height, opacity: kept === null ? (profile?.sampled ? 0.32 : 0.7) : kept ? 0.9 : 0.35 }}
              className={`flex-1 rounded-[1px] ${kept ? 'bg-accent' : BAR[type]}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between gap-2 text-[10.5px] text-foreground-subtle tabular-nums">
        <span className="shrink-0">{range?.[0] ?? ''}</span>
        <span data-preview-line className={`min-w-0 text-center ${profile?.error ? 'text-error' : ''}`}>
          {profile?.previewLine ?? ''}
        </span>
        <span className="shrink-0">{range?.[1] ?? ''}</span>
      </div>
    </div>
  );
}

/** How many values Filter 2's checklist shows unsearched, as it draws them. */
const CHECKLIST_SHOWN = 6;

/** Filter 2's checklist: a text column's values with their bars and counts,
 *  the search in the field's place narrowing them, the values checked
 *  always among them; a value checked writes `in`'s list. */
function Checklist({ values, checked, query, onToggle, phone }: { values: NonNullable<PanelProfile['values']>; checked: string[]; query: string; onToggle: (value: string) => void; phone: boolean }) {
  const needle = query.trim().toLowerCase();
  const matching = needle ? values.filter((value) => value.value.toLowerCase().includes(needle)) : values;
  const cut = matching.slice(0, CHECKLIST_SHOWN);
  const shown = [...cut, ...values.filter((value) => checked.includes(value.value) && !cut.includes(value))];
  const most = Math.max(1, ...values.map((value) => value.count));
  const said =
    shown.length === values.length
      ? values.length === 1
        ? 'its one value'
        : `all ${values.length.toLocaleString('en-US')} values`
      : `${shown.length.toLocaleString('en-US')} of ${values.length.toLocaleString('en-US')} values shown`;
  return (
    <div data-preview="values" className="flex flex-col">
      {shown.map((value) => {
        const on = checked.includes(value.value);
        return (
          <label key={value.value} className={`flex cursor-pointer items-center gap-2 px-0.5 ${phone ? 'h-11' : 'h-7'}`}>
            <input type="checkbox" checked={on} onChange={() => onToggle(value.value)} className="m-0 size-3.5 shrink-0 cursor-pointer accent-[var(--accent-fill)]" />
            <span title={value.value} className="w-[108px] shrink-0 truncate text-[12.5px] text-foreground">
              {value.value}
            </span>
            <span aria-hidden="true" className="flex h-1.5 min-w-0 flex-1">
              <span style={{ width: `${Math.max(1, (value.count / most) * 100)}%`, opacity: on ? 0.8 : 0.35 }} className="h-1.5 rounded-[2px] bg-type-text" />
            </span>
            <span className="w-[60px] shrink-0 text-right text-[11.5px] text-foreground-subtle tabular-nums">{value.words}</span>
          </label>
        );
      })}
      {shown.length === 0 && <span className="px-0.5 py-1.5 text-[11.5px] text-foreground-subtle">No value holds &ldquo;{query.trim()}&rdquo;.</span>}
      <span data-preview-line className="px-0.5 pt-1 text-[11px] text-foreground-subtle">
        {said} · counts from the profile of the rows in view
      </span>
    </div>
  );
}

/** The filter editor, as Filter 1 to 3 draw it (`docs/DECISIONS.md`,
 *  "Scope", 2026-11-26 and 2026-11-27): "Keep rows where", a column, an
 *  operator in words, its value or values (a span's From and To, a time's
 *  shortcuts), the preview, the command at its foot, Cancel and Apply. The
 *  operators and their words are the crate's completion's after the
 *  column; the command is the crate's (`App.filter_line`), and so is what's
 *  wrong with it, read as the bar would read it (`Completion.preview`). The
 *  preview is the column's profile, asked for while the editor is on it
 *  (`askProfileFor`) and read again by nothing typed: a number's or a
 *  time's bars, those the filter keeps marked (`App.filter_bins`), and a
 *  text column's `is any of` a checklist of its values once every row in
 *  view is read and it has few (`PanelProfile.values`), else a typed
 *  list. */
function FilterEditor({ state, column: asked, phone }: { state: FrameState; column: number | null; phone: boolean }) {
  const done = useDone();
  const close = useContext(Close);
  const [index, setIndex] = useState(() => asked ?? startColumn(state)?.index ?? 0);
  const column = state.columns.find((column) => column.index === index);
  const [op, setOp] = useState(() => (column ? FIRST_OP[column.type] : '='));
  const [values, setValues] = useState<string[]>(['', '']);
  const [checked, setChecked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const first = useRef<HTMLInputElement>(null);
  // The preview's profile, read while the editor is on its column; a
  // boolean has none.
  const asker = useId();
  const asking = column && column.type !== 'boolean' ? column.name : null;
  useEffect(() => {
    askProfileFor(asker, asking);
    return () => askProfileFor(asker, null);
  }, [asker, asking]);
  const profile = column && state.profiles.find((profile) => profile.column === column.name);
  const listed = column?.type === 'text' && op === 'in' ? (profile?.values ?? null) : null;
  const typedList = values[0]!.split(',').map((value) => value.trim()).filter((value) => value !== '');
  // The checklist replaces the typed list once the values are known, if
  // what's typed is all among them (else the typed list stays as typed).
  // Decided when the values come or go, or the column or the operator
  // changes, never by a key: a value typed whole doesn't swap the field
  // being typed in. What's checked outlives an operator's change; what's
  // typed, all among the values, is checked.
  const [listing, setListing] = useState(false);
  const focusSearch = useRef(false);
  useEffect(() => {
    const fits = listed !== null && typedList.every((value) => listed.some((item) => item.value === value));
    if (fits && typedList.length) setChecked(typedList);
    // Focus in the typed field moves to the search that takes its place.
    if (fits) focusSearch.current = first.current !== null && document.activeElement === first.current;
    setListing(fits);
  }, [index, op, listed !== null]);
  const checklist = listing && listed !== null;
  useEffect(() => {
    if (checklist && focusSearch.current) first.current?.focus();
    focusSearch.current = false;
  }, [checklist]);
  if (!column) return null;
  const ops = (completion(`filter ${column.typed} `)?.items ?? []).map((item) => ({ value: item.text, label: item.detail }));
  const arity = op === 'is null' || op === 'not null' ? 0 : op === 'between' ? 2 : op === 'in' ? -1 : 1;
  // Nothing typed is no value: the foot reads `filter mass_kg >=`, and
  // the plan refuses it, where `""` would be a value.
  const given =
    arity === 0
      ? []
      : arity === 2
        ? values[0] === '' && values[1] === ''
          ? []
          : values.slice(0, 2)
        : arity === -1
          ? checklist
            ? listed.filter((item) => checked.includes(item.value)).map((item) => item.value)
            : typedList
          : values[0] === ''
            ? []
            : [values[0]!];
  const line = appNow()?.filter_line(column.index, op, given) ?? '';
  const preview = line ? completion(line)?.preview : undefined;
  const ready = preview?.kind === 'command';
  // A fault once something's typed: a value not begun waits.
  const typed = arity === 0 || given.some((value) => value !== '');
  const fault = !ready && typed && preview?.text ? preview.text : null;
  const apply = () => {
    if (!ready) return;
    act(line);
    done();
  };
  const pick = (next: number) => {
    const to = state.columns.find((column) => column.index === next);
    if (!to) return;
    setIndex(next);
    // Another type starts on its own first operator, as its board draws it.
    // and with its fields empty: a number typed isn't a value of text.
    if (to.type !== column.type) {
      setOp(FIRST_OP[to.type]);
      setValues(['', '']);
    }
    setChecked([]);
    setQuery('');
  };
  const toggle = (value: string) => setChecked((now) => (now.includes(value) ? now.filter((item) => item !== value) : [...now, value]));
  const keeps = column.type === 'number' || column.type === 'time' ? (appNow()?.filter_bins(column.index, op, given) ?? null) : null;
  const field = (at: number, label: string, placeholder: string) => (
    <label className="flex h-7 min-w-0 flex-1 items-center rounded-md border border-border-strong bg-background px-2 focus-within:border-accent">
      <input
        ref={at === 0 ? first : undefined}
        type="text"
        aria-label={label}
        placeholder={placeholder}
        value={values[at]}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setValues((now) => now.map((value, i) => (i === at ? event.target.value : value)))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            apply();
          }
        }}
        className="w-full min-w-0 border-0 bg-transparent font-mono text-[12.5px] text-foreground outline-none placeholder:font-sans placeholder:text-foreground-subtle"
      />
    </label>
  );
  const shortcut = (label: string, from: string) => (
    <button
      type="button"
      onClick={() => setValues([from, isoDay(0)])}
      className="h-6 cursor-pointer rounded-[5px] border border-border-strong px-2 text-[11.5px] whitespace-nowrap text-foreground-muted hover:bg-surface-raised hover:text-foreground"
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Filter" className={phone ? 'w-full' : 'w-[372px]'}>
      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-medium whitespace-nowrap text-foreground">Keep rows where</span>
          <Choice label="Column" value={column.index} items={columnItems(state.columns)} onChange={pick} />
        </div>
        <div className="flex gap-1.5">
          <Choice label="Operator" value={op} items={ops} onChange={setOp} width={150} />
          {arity === 1 && field(0, 'The value', '')}
          {arity === -1 && !checklist && field(0, 'The values', 'Values, between commas')}
          {arity === -1 && checklist && (
            <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border-strong bg-background px-2 focus-within:border-accent">
              <Icon name="search" size={12} className="shrink-0 text-foreground-subtle" />
              <input
                ref={first}
                type="text"
                aria-label="Search the values"
                value={query}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    apply();
                  }
                }}
                className="w-full min-w-0 border-0 bg-transparent text-[12.5px] text-foreground outline-none"
              />
            </label>
          )}
        </div>
        {arity === 2 && (
          <div className="flex items-center gap-1.5">
            {field(0, 'From', column.type === 'time' ? 'YYYY-MM-DD' : '')}
            <span className="text-xs text-foreground-subtle">and</span>
            {field(1, 'To', column.type === 'time' ? 'YYYY-MM-DD' : '')}
          </div>
        )}
        {arity === 2 && column.type === 'time' && (
          <div className="flex gap-1.5">
            {shortcut('Last 7 days', isoDay(7))}
            {shortcut('Last 30 days', isoDay(30))}
            {shortcut('This year', `${new Date().getFullYear()}-01-01`)}
          </div>
        )}
        {checklist && <Checklist values={listed} checked={checked} query={query} onToggle={toggle} phone={phone} />}
        {arity === -1 && !checklist && column.type === 'text' && profile?.reading && (
          <span data-preview-line className="-mt-1 text-[11px] text-foreground-subtle">
            {profile.previewLine}
          </span>
        )}
        {(column.type === 'number' || column.type === 'time') && <PreviewBars profile={profile} type={column.type} keeps={keeps} />}
        {fault && (
          <span role="status" className="text-[11.5px] leading-4 text-error">
            {fault}
          </span>
        )}
      </div>
      <Foot line={line}>
        <button type="button" onClick={() => close(false)} className={QUIET}>
          Cancel
        </button>
        <button
          type="button"
          aria-disabled={!ready}
          onClick={apply}
          className="h-[26px] cursor-pointer rounded-md bg-accent-fill px-2.5 text-[12.5px] font-semibold text-accent-on aria-disabled:cursor-default aria-disabled:opacity-50"
        >
          Apply
        </button>
      </Foot>
    </div>
  );
}

/** The sort editor, as Columns 3 draws it: "Sort by", a column, its two
 *  directions in its type's words, the line under them, the command at
 *  its foot, and Remove the sort. A direction pressed sorts at once; a
 *  column picked with a sort in effect sorts by it, its type's first
 *  direction (the header's cycle), and without one waits for a direction.
 *  A file that can't be sorted says why. */
function SortEditor({ state, phone }: { state: FrameState; phone: boolean }) {
  const done = useDone();
  const sort = state.tools.sort;
  const [picked, setPicked] = useState(() => sort?.column ?? startColumn(state)?.index ?? 0);
  // The sort moved under it (a header's arrow, the bar): the editor follows.
  useEffect(() => {
    if (sort) setPicked(sort.column);
  }, [sort?.column]);
  const column = state.columns.find((column) => column.index === picked);
  if (!column) return null;
  const directions = (completion(`sort ${column.typed} `)?.items ?? [])
    .map((item) => ({ value: item.text as 'asc' | 'desc', words: item.detail }))
    .sort((a, b) => (a.value === 'asc' ? -1 : b.value === 'asc' ? 1 : 0));
  const current = sort?.column === column.index ? sort.direction : null;
  const line = current ? `sort ${column.typed} ${current}` : `sort ${column.typed}`;
  const unsortable = state.tools.unsortable;
  return (
    <div role="group" aria-label="Sort" className={phone ? 'w-full' : 'w-[300px]'}>
      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-medium whitespace-nowrap text-foreground">Sort by</span>
          <Choice
            label="Column"
            value={column.index}
            items={columnItems(state.columns)}
            disabled={!!unsortable}
            onChange={(next) => {
              setPicked(next);
              const to = state.columns.find((column) => column.index === next);
              if (sort && to && next !== sort.column) act(`sort ${to.typed}`);
            }}
          />
        </div>
        {unsortable ? (
          <span className="text-[11.5px] leading-4 text-foreground-muted">{unsortable}</span>
        ) : (
          <>
            <div role="radiogroup" aria-label="Direction" className="flex gap-0.5 rounded-[7px] border border-border bg-background p-0.5">
              {directions.map((direction) => (
                <button
                  key={direction.value}
                  type="button"
                  role="radio"
                  aria-checked={current === direction.value}
                  onClick={() => current !== direction.value && act(`sort ${column.typed} ${direction.value}`)}
                  className={`h-[26px] flex-1 cursor-pointer rounded-[5px] text-[12.5px] ${current === direction.value ? 'bg-surface-active font-medium text-foreground' : 'text-foreground-muted hover:text-foreground'}`}
                >
                  {direction.words.charAt(0).toUpperCase() + direction.words.slice(1)}
                </button>
              ))}
            </div>
            <span className="text-[11.5px] leading-4 text-foreground-subtle">One column at a time. A header&rsquo;s arrow does the same.</span>
          </>
        )}
      </div>
      <Foot line={line}>
        <button
          type="button"
          aria-disabled={!sort}
          onClick={() => {
            if (!sort) return;
            act('clear sort');
            done();
          }}
          className={`${QUIET} aria-disabled:cursor-default aria-disabled:opacity-50`}
        >
          Remove the sort
        </button>
      </Foot>
    </div>
  );
}

/** At a phone: the open control's sheet from the bottom, over a scrim. */
function Sheet({ current, state }: { current: Open & { seq: number }; state: FrameState }) {
  const [shown, setShown] = useState(true);
  const acted = useRef(false);
  const label = { filters: 'Filters', filter: 'Filter', sort: 'Sort', columns: 'Columns' }[current.kind];
  return (
    <Drawer.Root open={shown} onOpenChange={setShown} onOpenChangeComplete={(now) => now || (getOpen()?.seq === current.seq && setOpen(null))}>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-[25] bg-[var(--scrim)] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Drawer.Viewport className="fixed inset-0 z-[26] flex items-end">
          <Drawer.Popup
            data-menu
            aria-label={label}
            finalFocus={() => (closedByFind ? false : acted.current ? canvasKeys() : true)}
            className="w-full overflow-hidden rounded-t-[14px] border-t border-border-strong bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_32px_var(--shadow)] outline-none select-none [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-[300ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:[transform:translateY(calc(100%+2px))] data-[starting-style]:[transform:translateY(calc(100%+2px))] motion-reduce:transition-none"
          >
            <div aria-hidden="true" className="flex h-3.5 items-center justify-center">
              <span className="h-1 w-9 rounded-sm bg-border-strong" />
            </div>
            <Drawer.Content>
              <Close.Provider
                value={(byAction) => {
                  acted.current = byAction;
                  setShown(false);
                }}
              >
                <Inside current={current} state={state} phone />
              </Close.Provider>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** At a phone, a control's icon and its count (Option 3 at a phone),
 *  outlined with nothing applied (Toolbar 0 at a phone). */
function IconControl({ control }: { control: Control }) {
  return (
    <button
      type="button"
      data-tool={control.kind}
      aria-label={control.aria}
      onClick={() => {
        if (control.kind === 'columns') {
          // The panels' sheet's Columns tab is the phone's list.
          setSheetTab('columns');
          setLogOpen(true);
        } else setOpen(opens(control));
      }}
      className={`${CHIP} h-[26px] px-2 tabular-nums ${control.on ? ON : OFF}`}
    >
      <Icon name={control.icon} size={13} />
      {control.short && <span>{control.short}</span>}
    </button>
  );
}

/** The toolbar, while a file is open. */
export function Toolbar({ state }: { state: FrameState }) {
  const phone = usePhone();
  const current = useOpen();
  const finding = useFind() !== null;
  // A file closed or replaced: what was open goes with it, find too.
  const opening = state.log.entries[0]?.id ?? null;
  useEffect(() => {
    setOpen(null);
    closeFind('none');
  }, [opening]);
  // Cmd/Ctrl+F with a popover or a sheet open: it closes, and find takes
  // focus.
  useEffect(() => subscribeFind(closeForFind), []);
  if (!state.file) return null;
  const all = controls(state);
  return (
    <div className="flex flex-col border-b border-border bg-background [grid-area:tools]">
      <div id="toolbar" role="toolbar" aria-label="The view" className="flex h-10 items-center justify-between gap-2 pr-2 pl-2.5">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {phone
            ? all.map((control) => <IconControl key={control.kind} control={control} />)
            : all.map((control) => <Chip key={control.kind} control={control} state={state} compact={finding} />)}
          <RowCount state={state} phone={phone} />
        </div>
        <div className="flex shrink-0 items-center">{finding ? !phone && <FindBar state={state} grow={false} /> : <FindButton />}</div>
        {phone && current && current.kind !== 'columns' && <Sheet key={current.seq} current={current} state={state} />}
      </div>
      {/* At a phone, find's own row: the first is unchanged. */}
      {finding && phone && (
        <div className="flex h-9 items-center pr-1.5 pb-2 pl-2.5">
          <FindBar state={state} grow />
        </div>
      )}
    </div>
  );
}
