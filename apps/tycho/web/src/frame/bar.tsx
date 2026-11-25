/**
 * The command bar (`docs/DECISIONS.md`, "Scope", 2026-11-20, "The input is
 * a command bar at the top center, apart from the log"), as the design
 * canvas's "Command bar" page draws it: an input, the list of what matches
 * the part being typed, and what Enter would do. The crate parses,
 * completes, and runs (`App.complete`, `App.command`); this draws what it
 * says. Built on Base UI's Autocomplete, inline, so its focus, keys, and
 * ARIA are the component's.
 *
 * One box, two places: with no file open it's the first screen's box (its
 * rows the ways to open one, prerendered and run by `core.ts` until React
 * hydrates); with one open it sits in the top bar and opens over the page
 * on a press or Cmd/Ctrl+K (`core.ts`'s `openBar`).
 */

import { Autocomplete } from '@base-ui/react/autocomplete';
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import sample from 'virtual:tycho-sample';
import { appNow, closeBar, isBarOpen, modKey, openBar, subscribeBar } from './core.ts';
import { Icon, type IconName } from './icons.tsx';
import { type Completion, type CompletionItem, type FrameState, takeBarFrom } from './state.ts';

type Place = 'first' | 'bar';

/** A row of the bar's list: a completion, or a way to open a file. */
type Entry =
  | { id: string; kind: 'complete'; item: CompletionItem }
  | { id: string; kind: 'open'; action: 'pick' | 'sample'; head: string; sub: string; key: string };

interface Group {
  value: string;
  items: Entry[];
}

const PLACEHOLDER = 'Type a command or paste an action';

/** As the app writes a size (`crate/src/dataset.rs`, `format_bytes`). */
const mebibytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

/** The ways to open a file: the first screen's rows, and the end of the
 *  open bar's list. Pressed by their `data-action` (Base UI names an
 *  item's DOM id, which the input's `aria-activedescendant` points at). */
function openRows(): Entry[] {
  return [
    { id: 'open-file', kind: 'open', action: 'pick', key: 'O', head: 'Choose a file', sub: "CSV or Parquet, any size. It's read here in your browser and never uploaded." },
    {
      id: 'try-sample',
      kind: 'open',
      action: 'sample',
      key: 'S',
      head: 'Try the sample',
      sub: `${sample.title} · ${sample.rows.toLocaleString('en-US')} rows · a ${mebibytes(sample.bytes)} download`,
    },
  ];
}

const VERB_ICONS: Record<string, IconName> = { pin: 'pin', unpin: 'pin', jump: 'rows', undo: 'restore' };

/** A column's type badge: a glyph as well as a color. */
function Badge({ kind }: { kind: NonNullable<CompletionItem['kind']> }) {
  const look = {
    text: 'bg-type-text-tint text-type-text',
    number: 'bg-type-number-tint text-type-number',
    time: 'bg-type-time-tint text-type-time',
    boolean: 'bg-type-boolean/15 text-type-boolean',
  }[kind];
  const glyph =
    kind === 'text' ? (
      <span className="text-[9.5px] font-semibold tracking-[-0.02em]">Aa</span>
    ) : (
      <Icon name={kind === 'number' ? 'hash' : kind === 'time' ? 'clock' : 'check'} size={10} />
    );
  return (
    <span aria-hidden="true" className={`flex h-4 w-[18px] shrink-0 items-center justify-center rounded ${look}`}>
      {glyph}
    </span>
  );
}

const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

function Keys({ pairs, right }: { pairs: [string, string][]; right?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-[11.5px] text-foreground-subtle max-sm:hidden">
      <span className="flex items-center gap-3">
        {pairs.map(([key, what]) => (
          <span key={key} className="flex items-center gap-[5px]">
            <Kbd>{key}</Kbd>
            {what}
          </span>
        ))}
      </span>
      {right && <span>{right}</span>}
    </div>
  );
}

/** The command's parts across the top, the one being typed marked. */
function Slots({ slots }: { slots: Completion['slots'] }) {
  if (slots.length === 0) return null;
  const look = { done: 'border-border-strong text-foreground', now: 'border-transparent bg-accent-tint text-accent', next: 'border-border-strong text-foreground-subtle' };
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2.5">
      {slots.map((slot, i) => (
        <span key={i} className={`rounded-[5px] border px-[7px] font-mono text-[11.5px] leading-5 whitespace-nowrap ${look[slot.state]}`}>
          {slot.text}
        </span>
      ))}
    </div>
  );
}

/** The list's heading for what's being completed. */
function groupLabel(completion: Completion, text: string): string {
  if (completion.part !== 'column') return 'Commands';
  const typed = text.slice(completion.from, completion.to).replace(/^"/, '').trim();
  return typed ? `Columns matching "${typed}"` : 'Columns';
}

/** The part being typed as a name: a quote opening it taken off, one
 *  closing it too, and a quote inside written twice read as one (as the
 *  crate's `tokenize` reads it). */
function partOf(completion: Completion, text: string): string {
  const part = text.slice(completion.from, completion.to);
  if (!part.startsWith('"')) return part;
  return part.slice(1).replace(/"$/, '').replaceAll('""', '"');
}

/** A whole command's own match: the column its part names, matched as the
 *  crate matches it, without regard to case. What Enter would do shows it,
 *  so the list doesn't. */
function ownMatch(completion: Completion, text: string, item: CompletionItem): boolean {
  return completion.preview.kind === 'command' && item.label.toLowerCase() === partOf(completion, text).toLowerCase();
}

/** The groups the list shows: on the first screen its rows alone; in the
 *  bar, with nothing typed, the commands and then the rows; while a part
 *  is typed, what matches it. */
function groupsOf(place: Place, completion: Completion | null, text: string): Group[] {
  if (place === 'first') return [{ value: 'Open', items: openRows() }];
  // A whole command lists only what else the part could be.
  const items: Entry[] = (completion?.items ?? [])
    .filter((item) => !ownMatch(completion!, text, item))
    .map((item, i) => ({ id: `complete-${i}`, kind: 'complete', item }));
  if (text.trim() === '') return [{ value: 'Commands', items }, { value: 'Open', items: openRows() }].filter((group) => group.items.length > 0);
  return items.length > 0 && completion ? [{ value: groupLabel(completion, text), items }] : [];
}

function FirstRow({ entry, busy }: { entry: Extract<Entry, { kind: 'open' }>; busy: boolean }) {
  return (
    <Autocomplete.Item
      value={entry}
      data-action={entry.action}
      data-key={entry.key}
      aria-busy={busy}
      className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-foreground-muted outline-none data-[highlighted]:bg-surface-active data-[highlighted]:text-accent max-sm:items-start"
    >
      <Icon name={entry.action === 'pick' ? 'file' : 'rows'} size={16} className="max-sm:mt-0.5" />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-sm font-medium text-foreground">{busy ? `${entry.head}…` : entry.head}</span>
        <span className="text-[12.5px] leading-[17px] text-foreground-muted">{entry.sub}</span>
      </span>
      <kbd className="kbd max-sm:hidden">{entry.key}</kbd>
    </Autocomplete.Item>
  );
}

/** A row of the open bar's list: a finger tall at a phone. */
function BarRow({ entry, typed, onComplete }: { entry: Entry; typed: string; onComplete: (item: CompletionItem) => void }) {
  const row = 'flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left outline-none hover:bg-surface-raised data-[highlighted]:bg-surface-active max-sm:h-11 max-sm:rounded-none max-sm:px-3';
  if (entry.kind === 'open') {
    return (
      <Autocomplete.Item value={entry} data-action={entry.action} className={row}>
        <Icon name={entry.action === 'pick' ? 'file' : 'rows'} className="text-foreground-muted" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground max-sm:text-sm">{entry.head}</span>
        <span className="min-w-0 truncate text-xs text-foreground-subtle max-sm:hidden">{entry.action === 'pick' ? 'CSV or Parquet, from this device' : sample.title}</span>
      </Autocomplete.Item>
    );
  }
  const { item } = entry;
  const label =
    item.kind && typed && item.label.toLowerCase().startsWith(typed.toLowerCase()) ? (
      <>
        <span className="text-accent">{item.label.slice(0, typed.length)}</span>
        {item.label.slice(typed.length)}
      </>
    ) : (
      item.label
    );
  return (
    <Autocomplete.Item value={entry} onClick={() => onComplete(item)} className={`${row} ${item.later ? 'opacity-60' : ''}`}>
      {item.kind ? <Badge kind={item.kind} /> : <Icon name={VERB_ICONS[item.label] ?? 'prompt'} className="text-foreground-muted" />}
      <span className={`min-w-0 flex-1 truncate ${item.kind ? 'text-[13px] max-sm:text-sm' : 'font-mono text-[12.5px]'} text-foreground`}>{label}</span>
      <span className="shrink-0 text-xs whitespace-nowrap text-foreground-subtle">{item.kind ? `${item.kind} · ${item.detail}` : item.detail}</span>
    </Autocomplete.Item>
  );
}

/** What Enter would do, or what the last Enter was answered. */
function Preview({ completion, answer, onCommands }: { completion: Completion | null; answer: FrameState['answer']; onCommands: () => void }) {
  if (answer) {
    return (
      <div role={answer.error ? 'alert' : 'status'} className={`px-3.5 py-3 text-[13px] leading-[19px] ${answer.error ? 'text-error' : 'text-foreground-muted'}`}>
        {answer.text}
      </div>
    );
  }
  const preview = completion?.preview;
  if (!preview) return null;
  switch (preview.kind) {
    case 'command':
      return (
        <div className="flex flex-col gap-3 px-3 py-3.5">
          {preview.steps.map((step) => (
            <div key={step} className="flex items-center gap-2 text-[13.5px] text-foreground">
              <Icon name={VERB_ICONS[completion.slots[0]?.text ?? ''] ?? 'prompt'} className="text-accent" />
              <span>{step}</span>
            </div>
          ))}
          {preview.json && (
            <div className="flex flex-col gap-[5px]">
              <span className="text-[11px] text-foreground-subtle">The action it becomes</span>
              <div className="rounded-md border border-border bg-background px-2.5 py-[9px] font-mono text-xs leading-[18px] break-all text-foreground-muted">{preview.json}</div>
            </div>
          )}
        </div>
      );
    case 'action': {
      const count = preview.steps.length;
      return (
        <>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-[12.5px] text-foreground-muted">
            <Icon name="clipboard" className="text-accent" />
            <span className="font-medium text-foreground">A pasted action</span>
            <span>
              · {count} {count === 1 ? 'step' : 'steps'} · checked against this file's columns
            </span>
          </div>
          <div className="flex flex-col gap-1.5 p-3">
            {preview.steps.map((step, i) => (
              <div key={i} className="flex h-8 items-center gap-2.5 rounded-md border border-border bg-background px-2.5">
                <span className="text-[11px] text-foreground-subtle tabular-nums">{i + 1}</span>
                <span className="text-[13px] text-foreground">{step}</span>
              </div>
            ))}
            <div className="pt-1.5 text-xs leading-[18px] text-foreground-subtle">Nothing runs until you press Enter. An action can change this view; it can't open another file, save one, or send data anywhere.</div>
          </div>
        </>
      );
    }
    case 'sentence':
      return (
        <div className="flex flex-col gap-3 px-4 pt-[18px] pb-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">Tycho reads commands, not sentences</span>
            <span className="text-[13px] leading-[19px] text-pretty text-foreground-muted">There's no model here, so nothing can interpret this. Type a command, or paste an action your own assistant wrote.</span>
          </div>
          <button
            type="button"
            onClick={onCommands}
            className="h-[30px] cursor-pointer self-start rounded-[7px] border border-border-strong px-3 text-[13px] text-foreground hover:bg-surface-raised"
          >
            See the commands
          </button>
        </div>
      );
    case 'refused':
    case 'later':
    case 'open':
    case 'nofile':
      return (
        <div role={preview.error ? 'alert' : 'status'} className={`px-3.5 py-3 text-[13px] leading-[19px] ${preview.error ? 'text-error' : 'text-foreground-muted'}`}>
          {preview.text}
        </div>
      );
    default:
      return null;
  }
}

/** The foot's keys for what's shown. */
function footKeys(completion: Completion | null, text: string, answered: boolean): { pairs: [string, string][]; right?: string } {
  const kind = completion?.preview.kind ?? 'empty';
  if (answered) return { pairs: [['esc', 'close']] };
  if (text.trim() === '') return { pairs: [['↑↓', 'move'], ['↵', 'choose'], ['esc', 'close']], right: 'Or paste an action from your assistant' };
  if (kind === 'command') return { pairs: [['↵', 'run'], ['esc', 'close']] };
  if (kind === 'action') {
    const count = completion!.preview.steps.length;
    return { pairs: [['↵', count === 2 ? 'run both' : count === 1 ? 'run' : `run all ${count}`], ['esc', 'cancel']] };
  }
  if ((completion?.items.length ?? 0) > 0) return { pairs: [['↑↓', 'move'], ['tab', 'complete'], ['esc', 'close']] };
  return { pairs: [['esc', 'close']] };
}

/**
 * The box: input, list, and what Enter would do. `place` says which:
 * `first` (no file; its rows, prerendered) or `bar` (over the page).
 */
export function CommandBox({ place, state }: { place: Place; state: FrameState }) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  /** The text came from a paste, not keys: set by the change a paste
   *  makes (`onPaste` comes first and marks the next change), cleared by
   *  any other. */
  const pasted = useRef(false);
  const pasting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const highlighted = useRef<Entry | undefined>(undefined);
  /** The command whose answer is shown: this box's last, until the text
   *  changes. An answer to another command (one sent before, answered
   *  late) is never shown or acted on (`Answer.ask`). */
  const [shown, setShown] = useState<number | null>(null);
  /** This box's command still to be answered. */
  const asked = useRef<number | null>(null);
  const nextCaret = useRef<number | null>(null);

  // Read at once (`App.complete` is synchronous) for the text, the caret,
  // and the view the app last published. None on the first screen, which
  // lists its rows alone, or before the first frame.
  const completion = useMemo(() => {
    const app = appNow();
    return place === 'bar' && app ? app.complete(text, caret) : null;
    // `state` changes as the view does (a command ran, a column dragged).
  }, [place, text, caret, state]);

  const answer = state.answer && shown !== null && state.answer.ask === shown && text.trim() !== '' ? state.answer : null;

  // A command that ran closes the bar and gives the table the keys; any
  // other answer stays in it.
  useEffect(() => {
    if (asked.current === null || state.answer?.ask !== asked.current) return;
    asked.current = null;
    if (place === 'bar' && (state.answer!.kind === 'done' || state.answer!.kind === 'undone')) closeBar('table');
  }, [state.answer, place]);

  useLayoutEffect(() => {
    if (nextCaret.current === null || !input.current) return;
    // Set by `complete` for the text it wrote, which this render shows.
    input.current.setSelectionRange(nextCaret.current, nextCaret.current);
    setCaret(nextCaret.current);
    nextCaret.current = null;
  }, [text]);

  const edit = (next: string) => {
    setText(next);
    setShown(null);
  };

  const run = () => {
    const app = appNow();
    if (!app || text.trim() === '') return;
    const ask = app.command(text, pasted.current ? 'pasted' : 'typed');
    asked.current = ask;
    setShown(ask);
  };

  /** An item put in place of the part being typed; a verb takes a space
   *  after it, ready for its part. */
  const complete = (item: CompletionItem) => {
    if (!completion) return;
    const tail = text.slice(completion.to);
    const insert = item.text + (completion.part === 'verb' && item.label !== 'undo' && !tail.startsWith(' ') ? ' ' : '');
    const next = text.slice(0, completion.from) + insert + tail;
    input.current?.focus();
    // The same text again renders nothing, so the caret is put now.
    if (next === text) {
      const at = completion.from + insert.length;
      input.current?.setSelectionRange(at, at);
      setCaret(at);
      return;
    }
    nextCaret.current = completion.from + insert.length;
    pasted.current = false;
    edit(next);
  };

  const groups = groupsOf(place, completion, text);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement> & { preventBaseUIHandler: () => void }) => {
    if (event.key === 'Escape' && place === 'bar') {
      event.preventBaseUIHandler();
      event.preventDefault();
      closeBar('back');
    } else if (event.key === 'Tab' && !event.shiftKey && completion && completion.items.length > 0 && text.trim() !== '') {
      event.preventBaseUIHandler();
      event.preventDefault();
      // What the arrows chose, else the first the list shows: never a
      // whole command's own match, which it doesn't.
      const entry = highlighted.current;
      const first = completion.items.find((item) => !ownMatch(completion, text, item));
      const item = entry?.kind === 'complete' ? entry.item : first;
      if (item) complete(item);
    } else if (event.key === 'Enter' && text.trim() !== '' && !(place === 'bar' && highlighted.current)) {
      // A line typed or pasted runs; a row the arrows chose is Base UI's
      // to press. On the first screen a row is always highlighted, and a
      // typed line is answered that a file opens first.
      event.preventBaseUIHandler();
      event.preventDefault();
      run();
    }
  };

  const busy = (action: string) => (action === 'pick' ? state.busy === 'file' : state.busy === 'sample');
  const keys = footKeys(completion, text, answer !== null);
  const typed = completion ? partOf(completion, text) : '';

  return (
    <Autocomplete.Root
      items={groups}
      value={text}
      onValueChange={(value, details) => {
        // An item's press is ours: a completion goes in place of its part
        // (`complete`), and a row runs its `data-action` (`core.ts`).
        if (details.reason === 'item-press') return;
        pasted.current = pasting.current;
        pasting.current = false;
        // The caret with the text, so completion never reads one against
        // the other's last state (`onSelect` follows only after a render).
        setCaret(input.current?.selectionStart ?? value.length);
        edit(value);
      }}
      onItemHighlighted={(value) => {
        highlighted.current = value as Entry | undefined;
      }}
      itemToStringValue={(entry: Entry) => (entry.kind === 'open' ? entry.head : entry.item.label)}
      mode="none"
      inline
      open
      autoHighlight={place === 'first' ? 'always' : false}
      highlightItemOnHover={place === 'first'}
    >
      <label
        data-bar-box=""
        className={
          place === 'first'
            ? 'flex h-11 items-center gap-[9px] border-b border-border px-3.5 max-sm:h-[46px]'
            : 'flex h-10 items-center gap-[9px] border-b border-border px-3 max-sm:h-11 max-sm:border-accent max-sm:bg-surface max-sm:pr-1.5'
        }
      >
        <Icon name="prompt" className="text-accent" />
        <Autocomplete.Input
          ref={input}
          aria-label="Command"
          placeholder={place === 'first' ? 'Type a command, or pick a way to open a file' : PLACEHOLDER}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={onKeyDown}
          onPaste={() => {
            pasting.current = true;
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[13px] text-foreground outline-none placeholder:font-sans placeholder:text-foreground-subtle max-sm:text-sm"
        />
        {place === 'first' ? (
          <kbd data-mod-key="" suppressHydrationWarning className="kbd max-sm:hidden">
            {modKey()}
          </kbd>
        ) : (
          <button
            type="button"
            aria-label="Close the command bar"
            onClick={() => closeBar('back')}
            className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-muted hover:bg-surface-raised sm:hidden"
          >
            <Icon name="x" />
          </button>
        )}
      </label>
      {place === 'bar' && completion && <Slots slots={completion.slots} />}
      {place === 'first' && answer && <Preview completion={null} answer={answer} onCommands={() => edit('')} />}
      <Autocomplete.List className={place === 'first' ? 'flex flex-col gap-0.5 p-1.5' : 'max-h-[min(55dvh,360px)] overflow-y-auto px-1.5 pt-1 pb-1.5 empty:hidden max-sm:max-h-none max-sm:px-0'}>
        {(group: Group) => (
          <Autocomplete.Group key={group.value} items={group.items}>
            {place === 'bar' && <Autocomplete.GroupLabel className="px-2.5 pt-2 pb-1 text-[11px] text-foreground-subtle max-sm:px-3">{group.value}</Autocomplete.GroupLabel>}
            <Autocomplete.Collection>
              {(entry: Entry) =>
                place === 'first' && entry.kind === 'open' ? (
                  <FirstRow key={entry.id} entry={entry} busy={busy(entry.action)} />
                ) : (
                  <BarRow key={entry.id} entry={entry} typed={completion?.part === 'column' ? typed : ''} onComplete={complete} />
                )
              }
            </Autocomplete.Collection>
          </Autocomplete.Group>
        )}
      </Autocomplete.List>
      {place === 'bar' && (
        <>
          {(answer || (completion && text.trim() !== '' && (completion.items.length === 0 || completion.preview.kind === 'command'))) && <Preview completion={completion} answer={answer} onCommands={() => edit('')} />}
          <Keys pairs={keys.pairs} right={keys.right} />
        </>
      )}
    </Autocomplete.Root>
  );
}

const useBarOpen = (): boolean => useSyncExternalStore(subscribeBar, isBarOpen, () => false);

/**
 * The bar in the top bar, with a file open: a box that opens the bar over
 * the page (a press, or Cmd/Ctrl+K), and at a phone a button whose bar
 * takes the top bar's row. When a file opens from the first screen, the
 * box moves from where the first screen's was (about 200 ms; none under
 * reduced motion).
 */
export function TopBarCommand({ state }: { state: FrameState }) {
  const open = useBarOpen();
  const box = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const from = takeBarFrom();
    const to = box.current?.getBoundingClientRect();
    if (!from || !to || to.width === 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // The box is centered in the bar: a move of its center and a change of
    // its size, never a scale, so its text isn't stretched.
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    box.current!.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)`, width: `${from.width}px`, height: `${from.height}px`, borderRadius: '12px' },
        { transform: 'none', width: `${to.width}px`, height: `${to.height}px`, borderRadius: '8px' },
      ],
      { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    );
  }, []);

  // Opened: its input takes the keys. A press outside, or focus leaving
  // it, closes it and leaves focus where it went.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>('[role=combobox]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) closeBar('none');
    };
    const away = (event: FocusEvent) => {
      const to = event.relatedTarget as Node | null;
      if (to && !panel.current?.contains(to)) closeBar('none');
    };
    const node = panel.current;
    document.addEventListener('pointerdown', outside, true);
    node?.addEventListener('focusout', away);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      node?.removeEventListener('focusout', away);
    };
  }, [open]);

  return (
    <>
      <button
        ref={box}
        type="button"
        onClick={openBar}
        aria-label={`Open the command bar (${modKey()})`}
        aria-expanded={open}
        className="flex h-[30px] w-[440px] min-w-0 shrink cursor-text items-center gap-2 overflow-hidden rounded-lg border border-border-strong bg-surface-raised pr-2 pl-2.5 text-left max-lg:w-[300px] max-sm:hidden"
      >
        <Icon name="prompt" className="text-accent" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground-subtle">{PLACEHOLDER}</span>
        <Kbd>{modKey()}</Kbd>
      </button>
      <button
        type="button"
        onClick={openBar}
        aria-label="Open the command bar"
        className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md text-accent hover:bg-surface-raised sm:hidden"
      >
        <Icon name="prompt" />
      </button>
      {open && (
        <div
          ref={panel}
          id="command-bar"
          role="dialog"
          aria-label="Command bar"
          className="fixed top-1.5 left-1/2 z-20 w-[560px] max-w-[calc(100vw-16px)] -translate-x-1/2 overflow-hidden rounded-[10px] border border-border-strong bg-surface shadow-[0_16px_40px_var(--shadow)] max-sm:inset-0 max-sm:top-0 max-sm:w-auto max-sm:max-w-none max-sm:translate-x-0 max-sm:overflow-y-auto max-sm:rounded-none max-sm:border-0"
        >
          <CommandBox place="bar" state={state} />
        </div>
      )}
    </>
  );
}
