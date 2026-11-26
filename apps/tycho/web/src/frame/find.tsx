/**
 * Find's bar, as the Toolbar page's Find inline, Find just opened, and
 * their phone boards draw it: at a wide page at the toolbar's right (the
 * chips stepping down to icons while it's open), at a phone a second row
 * of its own under the first, which doesn't change. "Find in the table",
 * the count ("3 of 18"), Previous match, Next match, and Close find; under
 * the input, until a character is typed, the tag that says the second
 * press is the browser's, said to a screen reader too
 * (`docs/DECISIONS.md`, "Scope", 2026-11-21).
 *
 * The page holds whether it's open (`core.ts`'s `openFind`, `closeFind`,
 * and Cmd/Ctrl+F); the app holds the term, the count, and the steps
 * (`crate/src/find.rs`): the term as typed goes to `App.find`, which the
 * table highlights, and Enter, Shift+Enter, and the buttons to
 * `App.find_step`, whose match the table selects. Focus stays in the
 * input through the steps.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { closeFind, findKeyName, findStep, findTerm, getFind, openFind, subscribeFind } from './core.ts';
import { Icon, type IconName } from './icons.tsx';
import type { FrameState } from './state.ts';

/** Find's open state: its opening's count and the term it opened on. */
export const useFind = () => useSyncExternalStore(subscribeFind, getFind, () => null);

const BUTTON = 'flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-muted hover:bg-surface-raised hover:text-foreground aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent';

function Button({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-disabled={disabled || undefined}
      // Focus stays in the input, so Enter goes on stepping.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => disabled || onPress()}
      className={BUTTON}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

/** The toolbar's Find, closed (Toolbar 0 and 1): opens the bar. */
export function FindButton() {
  return (
    <button type="button" aria-label={`Find (${findKeyName()})`} title={`Find (${findKeyName()})`} data-tool="find" onClick={() => openFind()} className={BUTTON}>
      <Icon name="search" size={14} />
    </button>
  );
}

/** The bar, open: `grow` at a phone, its row's width. */
export function FindBar({ state, grow }: { state: FrameState; grow: boolean }) {
  const open = useFind();
  if (!open) return null;
  return <Bar key={open.seq} state={state} grow={grow} start={open.term} />;
}

function Bar({ state, grow, start }: { state: FrameState; grow: boolean; start: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(start);
  const [typed, setTyped] = useState(start !== '');
  // Said once it's open, so a screen reader hears it (a live region
  // announces a change, not what it held when drawn).
  const [said, setSaid] = useState('');
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
    // Opened by the bar's `find`: its closing gives the table focus after
    // this runs, so the input takes it back once that's done.
    const again = setTimeout(() => input.current?.focus({ preventScroll: true }));
    const tag = setTimeout(() => setSaid(`${findKeyName()} again for the browser's find`), 100);
    return () => {
      clearTimeout(again);
      clearTimeout(tag);
    };
  }, []);
  const find = state.find;
  const term = text !== '';
  return (
    <div id="find" role="search" aria-label="Find in the table" className={`relative flex items-center gap-1 ${grow ? 'min-w-0 flex-1' : ''}`}>
      {!typed && (
        <div
          data-find-tag
          aria-hidden="true"
          className="absolute top-[calc(100%+6px)] left-0 z-[5] flex h-[26px] items-center gap-1.5 rounded-md border border-border-strong bg-surface pr-[9px] pl-1.5 text-[11.5px] whitespace-nowrap text-foreground-muted shadow-[0_8px_20px_var(--shadow)]"
        >
          <kbd className="rounded border border-border-strong px-1 font-mono text-[10.5px] text-foreground">{findKeyName()}</kbd>
          <span>again for the browser&rsquo;s find</span>
        </div>
      )}
      <span data-find-said aria-live="polite" className="sr-only">
        {typed ? '' : said}
      </span>
      <label className={`flex h-[26px] items-center gap-1.5 rounded-md border border-accent bg-surface-raised px-2 ${grow ? 'min-w-0 flex-1' : 'w-[220px]'}`}>
        <Icon name="search" size={13} className="shrink-0 text-foreground-muted" />
        <input
          ref={input}
          type="text"
          aria-label="Find in the table"
          placeholder="Find in the table"
          value={text}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setText(event.target.value);
            setTyped(true);
            findTerm(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              if (term) findStep(event.shiftKey);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              // The panels' own Escape isn't this one.
              event.stopPropagation();
              closeFind('back');
            }
          }}
          className="w-full min-w-0 border-0 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-foreground-subtle"
        />
        {/* Always there while the bar is, so its first words are a change
            a screen reader announces. */}
        <span role="status" className={`shrink-0 text-[11.5px] whitespace-nowrap tabular-nums empty:hidden ${find.error ? 'text-error' : 'text-foreground-subtle'}`}>
          {term && find.text ? find.text : ''}
        </span>
      </label>
      <Button icon="up" label="Previous match" disabled={!term} onPress={() => findStep(true)} />
      <Button icon="down" label="Next match" disabled={!term} onPress={() => findStep(false)} />
      <Button icon="x" label="Close find" onPress={() => closeFind('back')} />
    </div>
  );
}
