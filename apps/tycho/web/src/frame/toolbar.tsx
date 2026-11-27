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
 * editor (Filter 1 to 3, the profile's preview left for the profile); the
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
import { createContext, type ReactNode, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ShowHideList, SHOW_HIDE_POPUP } from './columns.tsx';
import { act, appNow, canvasKeys, closeFind, getFind, setLogOpen, setSheetTab, subscribeFind } from './core.ts';
import { FindBar, FindButton, useFind } from './find.tsx';
import { Badge, Icon, type IconName } from './icons.tsx';
import { usePhone } from './log.tsx';
import type { ColumnFacts, Completion, FilterFacts, FrameState } from './state.ts';

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

/** The filter editor, as Filter 1 to 3 draw it but for the profile's
 *  preview (`docs/DECISIONS.md`, "Scope", 2026-11-26): "Keep rows where",
 *  a column, an operator in words, its value or values (a span's From and
 *  To, a time's shortcuts), `is any of` a typed list until the profile, the
 *  command at its foot, Cancel and Apply. The operators and their words
 *  are the crate's completion's after the column; the command is the
 *  crate's (`App.filter_line`), and so is what's wrong with it, read as
 *  the bar would read it (`Completion.preview`). */
function FilterEditor({ state, column: asked, phone }: { state: FrameState; column: number | null; phone: boolean }) {
  const done = useDone();
  const close = useContext(Close);
  const [index, setIndex] = useState(() => asked ?? startColumn(state)?.index ?? 0);
  const column = state.columns.find((column) => column.index === index);
  const [op, setOp] = useState(() => (column ? FIRST_OP[column.type] : '='));
  const [values, setValues] = useState<string[]>(['', '']);
  const first = useRef<HTMLInputElement>(null);
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
          ? values[0]!.split(',').map((value) => value.trim()).filter((value) => value !== '')
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
    if (to.type !== column.type) setOp(FIRST_OP[to.type]);
  };
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
          {arity === -1 && field(0, 'The values', 'Values, between commas')}
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
