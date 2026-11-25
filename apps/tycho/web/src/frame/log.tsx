/**
 * The right panel and its Log tab, as the design canvas's Frame C draws it
 * (`docs/DECISIONS.md`, "Scope", 2026-11-20, the log; the Row tab comes
 * with the table's basics): collapsed until the top bar's button opens it
 * (`core.ts`'s `setLogOpen`), each entry's command in Plex Mono (a drag's
 * words in its place), the reply, where it came from and when, and the way
 * back or "current". The entries are the app's (`state.ts`, `LogEntry`):
 * this draws them and calls `back_to`. At a phone the panel is a sheet
 * over the lower part of the table (Phone 3), Base UI's Drawer, not modal,
 * so the table above stays in reach.
 *
 * Keys: Escape puts focus on the table and leaves the panel open; the
 * chrome isn't selectable, so select-all in the tab takes its entries.
 */

import { Drawer } from '@base-ui/react/drawer';
import { Tabs } from '@base-ui/react/tabs';
import { type KeyboardEvent, type ReactNode, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { backTo, canvasKeys, isLogOpen, setLogOpen, subscribeLog } from './core.ts';
import { Icon, type IconName } from './icons.tsx';
import type { FrameState, LogEntry, Origin } from './state.ts';

export const useLogOpen = (): boolean => useSyncExternalStore(subscribeLog, isLogOpen, () => false);

/** Below Tailwind's `sm`, where the frame draws the phone's. */
const PHONE = '(width < 40rem)';
const subscribeMedia = (listener: () => void) => {
  const query = matchMedia(PHONE);
  query.addEventListener('change', listener);
  addEventListener('resize', listener);
  return () => {
    query.removeEventListener('change', listener);
    removeEventListener('resize', listener);
  };
};
const usePhone = (): boolean => useSyncExternalStore(subscribeMedia, () => matchMedia(PHONE).matches, () => false);
const useViewportHeight = (): number => useSyncExternalStore(subscribeMedia, () => innerHeight, () => 0);

const ORIGIN_ICONS: Record<Origin, IconName> = {
  drop: 'pointer',
  pick: 'pointer',
  sample: 'pointer',
  click: 'pointer',
  typed: 'keyboard',
  pasted: 'clipboard',
};

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function Entry({ entry, current }: { entry: LogEntry; current: boolean }) {
  return (
    <li
      data-entry={entry.id}
      data-origin={entry.origin}
      data-reply={entry.replyKind}
      data-current={current || undefined}
      className="flex flex-col gap-1 border-b border-border-subtle py-[9px] pr-2 pl-3"
    >
      <div className="flex min-h-[26px] items-center gap-2">
        {entry.command !== null ? (
          <span data-command className="min-w-0 flex-1 font-mono text-xs leading-[17px] [overflow-wrap:anywhere] whitespace-pre-wrap text-foreground">{entry.command}</span>
        ) : (
          <span data-words className="min-w-0 flex-1 text-[12.5px] leading-[17px] whitespace-pre-wrap text-foreground">{entry.words}</span>
        )}
        {current ? (
          <span className="shrink-0 rounded px-1.5 py-px text-[10.5px] whitespace-nowrap text-accent select-none bg-accent-tint">current</span>
        ) : (
          entry.back && (
            <button
              type="button"
              data-back
              onClick={() => backTo(entry.id)}
              aria-label="Return to this view"
              title="Return to this view"
              className="flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-subtle select-none hover:bg-surface-raised hover:text-foreground"
            >
              <Icon name="restore" />
            </button>
          )
        )}
      </div>
      <div className={`text-xs leading-[17px] [overflow-wrap:anywhere] tabular-nums ${entry.replyKind === 'error' ? 'text-error' : 'text-foreground-muted'}`}>{entry.reply}</div>
      <div className="flex items-center gap-[5px] text-[10.5px] text-foreground-subtle">
        <Icon name={ORIGIN_ICONS[entry.origin]} size={11} />
        <span>
          {entry.origin} · <time dateTime={new Date(entry.at).toISOString()}>{clock.format(entry.at)}</time>
        </span>
      </div>
    </li>
  );
}

/** The entries, oldest first, kept scrolled to the newest as one is added,
 *  and the foot. */
function LogBody({ log }: { log: FrameState['log'] }) {
  const list = useRef<HTMLOListElement>(null);
  const last = log.entries.at(-1)?.id;
  useLayoutEffect(() => {
    const node = list.current?.parentElement;
    if (node) node.scrollTop = node.scrollHeight;
  }, [last]);
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ol ref={list} aria-label="Steps" className="m-0 list-none p-0 select-text">
          {log.entries.map((entry) => (
            <Entry key={entry.id} entry={entry} current={entry.id === log.current} />
          ))}
        </ol>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-2 text-[11px] text-foreground-subtle">
        <Icon name="lock" size={12} />
        <span>Replies are Tycho&rsquo;s own. Nothing is sent to a model.</span>
      </div>
    </>
  );
}

/** Escape gives the table the keys, the panel left open; select-all takes
 *  the entries alone. */
function panelKeys(event: KeyboardEvent<HTMLElement>): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    canvasKeys()?.focus({ preventScroll: true });
  } else if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
    const steps = event.currentTarget.querySelector('ol');
    if (!steps) return;
    event.preventDefault();
    getSelection()?.selectAllChildren(steps);
  }
}

/** The tabs' row: Log, the one tab until the row's comes, and the panel's
 *  own button at its end. */
function TabRow({ phone, end }: { phone: boolean; end: ReactNode }) {
  return (
    <div className={`flex shrink-0 items-center justify-between border-b border-border pr-1.5 pl-0.5 select-none ${phone ? 'h-10' : 'h-9'}`}>
      <Tabs.List className="flex">
        <Tabs.Tab
          value="log"
          className={`cursor-pointer px-2.5 text-foreground-muted data-[active]:font-medium data-[active]:text-foreground data-[active]:shadow-[inset_0_-2px_0_var(--accent)] ${phone ? 'h-10 px-3 text-[13px]' : 'h-9 text-[12.5px]'}`}
        >
          Log
        </Tabs.Tab>
      </Tabs.List>
      {end}
    </div>
  );
}

const iconButton = 'flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-raised hover:text-foreground';

/** At a wide page: a column at the right, beside the table. */
function SidePanel({ log }: { log: FrameState['log'] }) {
  return (
    <Tabs.Root
      defaultValue="log"
      render={<aside id="log" aria-label="Log" />}
      onKeyDown={panelKeys}
      className="flex min-h-0 w-[344px] flex-col overflow-hidden border-l border-border bg-surface [grid-area:side]"
    >
      <TabRow
        phone={false}
        end={
          <button type="button" data-action="log" aria-label="Collapse the panel" title="Collapse the panel" className={iconButton}>
            <Icon name="panelr" />
          </button>
        }
      />
      <Tabs.Panel value="log" className="flex min-h-0 flex-1 flex-col outline-none">
        <LogBody log={log} />
      </Tabs.Panel>
    </Tabs.Root>
  );
}

/** How tall the phone's sheet opens: the design's (470 px of a 760 px
 *  page), with the table and its selected row in sight above; it drags to
 *  the page's height under the top bar, and down to close. */
const SHEET_OPENS = 0.62;
const TOP_BAR = 44;

/** At a phone: the panels' sheet over the lower part of the table. */
function Sheet({ log, open }: { log: FrameState['log']; open: boolean }) {
  const height = useViewportHeight();
  const full = Math.max(height - TOP_BAR, 1);
  return (
    <Drawer.Root
      open={open}
      // Pressing the table, or focus going to it, leaves the sheet open:
      // the table above it is what its steps act on.
      modal={false}
      disablePointerDismissal
      snapPoints={[SHEET_OPENS, full]}
      onOpenChange={(next, details) => {
        // Escape is the panel's own (`panelKeys`): the table takes the keys
        // and the sheet stays.
        if (!next && details.reason === 'escape-key') return;
        setLogOpen(next);
      }}
    >
      <Drawer.Portal>
        <Drawer.Viewport className="pointer-events-none fixed inset-0 z-[15] flex items-end">
          <Drawer.Popup
            id="log-sheet"
            aria-label="Log"
            onKeyDown={panelKeys}
            style={{ height: full }}
            className="pointer-events-auto flex w-full flex-col overflow-hidden rounded-t-[14px] border-t border-border-strong bg-surface shadow-[0_-12px_32px_var(--shadow)] outline-none touch-none [padding-bottom:max(0px,calc(var(--drawer-snap-point-offset)+var(--drawer-swipe-movement-y)))] [transform:translateY(calc(var(--drawer-snap-point-offset)+var(--drawer-swipe-movement-y)))] transition-transform duration-[300ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:[transform:translateY(calc(100%+2px))] data-[starting-style]:[transform:translateY(calc(100%+2px))] data-[ending-style]:[padding-bottom:0] data-[starting-style]:[padding-bottom:0] data-[swiping]:select-none motion-reduce:transition-none"
          >
            <div aria-hidden="true" className="flex h-3.5 shrink-0 items-center justify-center">
              <span className="h-1 w-9 rounded-sm bg-border-strong" />
            </div>
            <Tabs.Root defaultValue="log" className="flex min-h-0 flex-1 flex-col">
              <TabRow
                phone
                end={
                  <Drawer.Close aria-label="Close" className={iconButton}>
                    <Icon name="x" />
                  </Drawer.Close>
                }
              />
              <Tabs.Panel value="log" render={<Drawer.Content />} className="flex min-h-0 flex-1 flex-col outline-none touch-auto">
                <LogBody log={log} />
              </Tabs.Panel>
            </Tabs.Root>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** The panel, while a file is open: a column, or at a phone the sheet. */
export function LogPanel({ state }: { state: FrameState }) {
  const open = useLogOpen();
  const phone = usePhone();
  if (!state.file) return null;
  if (phone) return <Sheet log={state.log} open={open} />;
  return open ? <SidePanel log={state.log} /> : null;
}

/** The top bar's button: the panel, opened and collapsed. Pressed through
 *  `data-action`, as every control the page may show before React is. */
export function LogButton() {
  const open = useLogOpen();
  return (
    <button type="button" data-action="log" aria-label="Log" aria-pressed={open} title="Show or hide the log" className={`${iconButton} aria-pressed:text-foreground`}>
      <Icon name="panelr" />
    </button>
  );
}
