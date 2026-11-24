/**
 * The page's frame around the table, as the design canvas draws it
 * (`docs/DECISIONS.md`, "Scope", 2026-11-20 and 2026-11-21), scaled back
 * to what Tycho has now: the top bar (the file's name and its menu of
 * facts, and the command bar, `bar.tsx`), the first screen (the bar,
 * open), the status bar, and the drop's haze; at a
 * phone, no status bar, its facts in the file's menu and the engine's
 * state a line under the top bar. React draws the state the app publishes
 * (`state.ts`); what a control does is `core.ts`'s, by its `data-action`,
 * so the prerendered page works before React loads. Rendered to HTML at
 * build time (`prerender.tsx`) and hydrated after the first frame
 * (`hydrate.tsx`).
 */

import { Popover } from '@base-ui/react/popover';
import { useSyncExternalStore } from 'react';
import { CommandBox, TopBarCommand } from './bar.tsx';
import { Icon, Logo } from './icons.tsx';
import { getState, INITIAL, subscribe, type FrameState, type Line } from './state.ts';

/** The app's state; the prerendered page's while hydrating. */
const useFrame = (): FrameState => useSyncExternalStore(subscribe, getState, () => INITIAL);

/** A credit's site (`planet4589.org/space/gcat`) as a link: a lowercase
 *  host with a path, so a version (`2.1`) or an initial (`J.McDowell`)
 *  isn't taken for one. */
function Credit({ text }: { text: string }) {
  const site = /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s),]*/.exec(text);
  if (!site) return <>{text}</>;
  const before = text.slice(0, site.index);
  const after = text.slice(site.index + site[0].length);
  return (
    <>
      {before}
      <a href={`https://${site[0]}`} target="_blank" rel="noreferrer" className="underline decoration-border-strong underline-offset-3 hover:text-foreground">
        {site[0]}
      </a>
      {after}
    </>
  );
}

function Dot({ state }: { state: FrameState['engine']['state'] }) {
  const color = state === 'ready' ? 'bg-ok' : state === 'loading' ? 'bg-accent' : 'bg-error';
  return <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${color}`} />;
}

const RetryButton = () => (
  <button type="button" data-action="retry" className="h-[18px] cursor-pointer rounded border border-border-strong px-1.5 text-[11px] text-foreground hover:bg-surface-raised">
    Retry
  </button>
);

const engineDown = (state: FrameState) => state.engine.state === 'failed' || state.engine.state === 'stopped';

/** The file's name, and under it what's known about the file. */
function FileMenu({ state }: { state: FrameState }) {
  const file = state.file!;
  return (
    <Popover.Root>
      <Popover.Trigger className="flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[13px] font-medium text-foreground hover:bg-surface-raised max-sm:flex-1 max-sm:border max-sm:border-border-strong max-sm:bg-surface-raised data-[popup-open]:border-accent">
        <Icon name="file" className="text-foreground-muted" />
        <span className="min-w-0 truncate">{file.name}</span>
        <Icon name="chevd" size={12} className="text-foreground-subtle" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-20">
          <Popover.Popup className="flex w-[380px] max-w-[calc(100vw-16px)] flex-col gap-2 rounded-[10px] border border-border-strong bg-surface px-3.5 py-3 text-xs text-foreground-muted shadow-[0_16px_40px_var(--shadow)] outline-none">
            <Popover.Title className="m-0 text-[13px] font-medium text-foreground">{file.name}</Popover.Title>
            <span className="tabular-nums">
              {file.facts}
              {file.sample && ' · the sample'}
            </span>
            {file.load && <span className="tabular-nums">{file.load}</span>}
            {file.notes.map((note) => (
              <span key={note.text} className={note.error ? 'text-error' : ''}>
                {note.text}
              </span>
            ))}
            <span className="flex items-center gap-1.5 sm:hidden">
              <Dot state={state.engine.state} />
              <span>{state.engine.text}</span>
              <span>·</span>
              <Icon name="lock" size={12} />
              <span>Local only</span>
            </span>
            {file.credit && (
              <>
                <span className="h-px bg-border" />
                <span className="leading-[18px]">
                  <Credit text={file.credit} />
                </span>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function TopBar({ state }: { state: FrameState }) {
  return (
    // The bar in the middle, the file's name and the page's buttons in
    // two equal sides, so it stays centered.
    <header className="z-10 flex h-11 items-center gap-3 border-b border-border bg-surface pr-2.5 pl-3 [grid-area:top] max-sm:gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className="flex shrink-0 items-center gap-[7px]">
          <Logo />
          <span className={`text-[13.5px] font-semibold tracking-[-0.01em] text-foreground ${state.file ? 'max-sm:hidden' : ''}`}>Tycho</span>
        </div>
        {state.file && (
          <>
            <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border-strong max-sm:hidden" />
            <FileMenu state={state} />
          </>
        )}
      </div>
      {state.file && <TopBarCommand state={state} />}
      <div className="flex min-w-0 items-center justify-end gap-1.5 sm:flex-1">
        <button
          type="button"
          data-action="theme"
          aria-label="Switch theme (Cmd/Ctrl+Shift+L)"
          title="Switch theme (Cmd/Ctrl+Shift+L)"
          className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-muted hover:bg-surface-raised"
        >
          {/* Both, shown by the theme: the page renders the same whatever it is. */}
          <Icon name="sun" className="theme-dark" />
          <Icon name="moon" className="theme-light" />
        </button>
      </div>
    </header>
  );
}

/** At a phone, where there's no status bar: the engine's state while it
 *  isn't ready, or the workbench's line. */
function PhoneLine({ state }: { state: FrameState }) {
  const line: Line | null = state.engine.state === 'ready' ? state.message : { text: state.engine.text, error: engineDown(state) };
  if (!line) return null;
  return (
    <div role="status" className="flex min-h-[26px] items-center gap-1.5 border-b border-border bg-surface px-3 py-1 text-[11.5px] text-foreground-muted [grid-area:line] sm:hidden">
      {state.engine.state !== 'ready' && <Dot state={state.engine.state} />}
      <span className={line.error ? 'text-error' : ''}>{line.text}</span>
      {engineDown(state) && <RetryButton />}
    </div>
  );
}

/** The first screen: over a ghost of the table, a heading and the command
 *  bar, open, its rows the ways to open a file (`docs/DECISIONS.md`,
 *  "Scope", 2026-11-20, "The first screen is the command bar, open in a
 *  blank workbench"). The URL row comes with its goal. */
function FirstScreen({ state }: { state: FrameState }) {
  return (
    // Over the canvas, which shows through (the perf panel draws there):
    // only its own controls take a press.
    <main id="first" className="pointer-events-none relative z-[1] overflow-hidden [grid-area:main]">
      <div aria-hidden="true" className="ghost absolute inset-0" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[18px] p-6 max-sm:justify-start max-sm:gap-4 max-sm:px-3 max-sm:pt-7 [&>*]:pointer-events-auto">
        <h1 className="m-0 text-center text-[22px] leading-7 font-semibold tracking-[-0.015em] text-foreground max-sm:text-xl max-sm:leading-[26px]">
          <span className="max-sm:hidden">Drop a file, or pick one below</span>
          <span className="sm:hidden">Choose a file</span>
        </h1>
        {state.message && (
          <div role={state.message.error ? 'alert' : 'status'} className={`flex w-full max-w-[560px] items-start gap-2.5 rounded-[10px] border bg-surface px-3.5 py-3 text-[13px] ${state.message.error ? 'border-error text-foreground' : 'border-border text-foreground-muted'}`}>
            {state.message.error && <Icon name="x" size={16} className="mt-px text-error" />}
            <span className="min-w-0 flex-1">{state.message.text}</span>
            {engineDown(state) && <RetryButton />}
          </div>
        )}
        <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-border-strong bg-surface shadow-[0_16px_40px_var(--shadow)]">
          {/* With no file, the bar's place: Cmd/Ctrl+K and focus come here. */}
          <CommandBox place="first" state={state} />
          <div className="flex items-center justify-between gap-3 border-t border-border px-3.5 py-2 text-[11.5px] text-foreground-subtle">
            <span className="flex items-center gap-3 max-sm:hidden">
              <span className="flex items-center gap-[5px]">
                <kbd className="kbd">↑↓</kbd>move
              </span>
              <span className="flex items-center gap-[5px]">
                <kbd className="kbd">↵</kbd>open
              </span>
            </span>
            <span className="flex items-center gap-[5px]">
              <Icon name="lock" size={12} />
              Your file stays in this tab
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}

function StatusBar({ state }: { state: FrameState }) {
  const hint = state.file ? state.message : state.engine.state === 'loading' ? { text: 'You can drop a file now. It opens when the engine is ready.', error: false } : null;
  return (
    <footer className="flex h-[26px] items-center gap-3.5 border-t border-border bg-surface px-3 text-[11.5px] whitespace-nowrap text-foreground-subtle [grid-area:status] max-sm:hidden">
      <span role="status" className="flex items-center gap-1.5">
        <Dot state={state.engine.state} />
        <span>{state.engine.text}</span>
        {engineDown(state) && <RetryButton />}
      </span>
      {state.file && (
        <span className="tabular-nums">
          {state.file.facts}
          {state.file.load && ` · ${state.file.load}`}
        </span>
      )}
      <span className="flex items-center gap-[5px]">
        <Icon name="lock" size={12} />
        Local only
      </span>
      {hint && <span className={`ml-auto min-w-0 truncate ${hint.error ? 'text-error' : ''}`}>{hint.text}</span>}
    </footer>
  );
}

/** Over everything while a file is dragged (CSS shows it, on the root's
 *  `data-dragging`, which `core.ts` sets). */
const Haze = () => (
  <div aria-hidden="true" className="haze fixed inset-0 z-30 flex-col items-center justify-center gap-3 bg-[var(--haze)] text-center backdrop-blur-[4px]">
    <span className="flex size-14 items-center justify-center rounded-[14px] border border-border-strong bg-surface-active text-accent">
      <Icon name="file" size={26} />
    </span>
    <span className="mt-1 text-[22px] leading-7 font-semibold tracking-[-0.015em] text-[var(--haze-foreground)]">Drop to open</span>
    <span className="text-[13.5px] text-[var(--haze-foreground-muted)]">CSV or Parquet</span>
  </div>
);

export function Frame() {
  const state = useFrame();
  return (
    <>
      <TopBar state={state} />
      <PhoneLine state={state} />
      <FirstScreen state={state} />
      <StatusBar state={state} />
      <Haze />
    </>
  );
}
