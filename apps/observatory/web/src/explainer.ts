/**
 * An explainer: a trigger and the popover it opens, one behavior everywhere
 * (`docs/DECISIONS.md`, "Page", the copy): hover opens it (a fine pointer
 * that hovers only), a press pins it until pressed again, Enter or Space on
 * the trigger opens it (focus alone doesn't), Esc closes it with focus kept
 * on the trigger, and one is open at a time; hovering another leaves a
 * pinned one open. A press outside, a wheel, or a scroll closes a pinned
 * one, in the contender's frame too (a same-origin frame's events never
 * reach this window: its own window is listened to).
 *
 * The popover renders into the document's body, positioned from its
 * trigger, so it's never clipped by a box it sits in: the status bar's
 * `contain: strict` (the readout's cost, "Page"). Nothing renders until
 * it opens, so the prerendered HTML holds the trigger only.
 */

import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The one open explainer: its id, and whether a press pinned it. */
let open: { id: string; pinned: boolean; close: () => void } | null = null;
const listeners = new Set<() => void>();
const set = (next: typeof open) => {
  open = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Closes whichever explainer is open; true if one was. */
export function closeExplainer(): boolean {
  if (!open) return false;
  open.close();
  return true;
}

/** Hover opens one only where a pointer hovers. */
const hovers = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

export type Placement = 'above-end' | 'above-start' | 'below-start';

interface Props {
  /** The trigger's content and its own props (label, class). */
  trigger: ReactNode;
  triggerProps?: Record<string, unknown>;
  /** The wrapper's class: hover is the wrapper's, so the pointer can reach the popover. */
  className?: string;
  placement?: Placement;
  /** The popover's width, px (at most the window's less 16). */
  width?: number;
  /** A menu holds controls: no hover, and `role="menu"`. */
  menu?: boolean;
  popoverClass?: string;
  children?: ReactNode;
}

const GAP = 6;
const EDGE = 8;
/** How long a hover-opened one waits for the pointer to cross the gap to it. */
const LEAVE_MS = 150;

/** This window and every same-origin frame's: where a press or a key can land. */
const windows = (): Window[] => [
  window,
  ...[...document.querySelectorAll('iframe')].flatMap((frame) => {
    try {
      return frame.contentWindow?.document ? [frame.contentWindow] : [];
    } catch {
      return [];
    }
  }),
];

export function Explainer({ trigger, triggerProps, className, placement = 'below-start', width = 300, menu = false, popoverClass = '', children }: Props) {
  const id = useId();
  const current = useSyncExternalStore(subscribe, () => open, () => null);
  const isOpen = current?.id === id;
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stay = () => {
    if (leaving.current) clearTimeout(leaving.current);
    leaving.current = null;
  };
  // A hover-opened one closes once the pointer has left both the trigger and the popover.
  const leave = () => {
    stay();
    leaving.current = setTimeout(() => {
      if (open?.id === id && !open.pinned) close(false);
    }, LEAVE_MS);
  };

  const close = (focus: boolean) => {
    if (open?.id !== id) return;
    set(null);
    if (focus) button.current?.focus();
  };
  const show = (pinned: boolean) => set({ id, pinned, close: () => close(true) });

  // Placed from the trigger once open, and again on a resize or when the
  // row it sits in changes (a status bar's readings change its segments' widths).
  useLayoutEffect(() => {
    if (!isOpen) return setStyle(null);
    let last = '';
    const place = () => {
      const rect = button.current!.getBoundingClientRect();
      const w = Math.min(width, innerWidth - 2 * EDGE);
      const left = placement === 'above-end' ? rect.right - w : rect.left;
      const at: CSSProperties = { position: 'fixed', width: w, left: Math.max(EDGE, Math.min(left, innerWidth - w - EDGE)) };
      if (placement.startsWith('above')) at.bottom = innerHeight - rect.top + GAP;
      else at.top = rect.bottom + GAP;
      const key = JSON.stringify(at);
      if (key !== last) setStyle(at);
      last = key;
    };
    place();
    addEventListener('resize', place);
    const row = new MutationObserver(place);
    if (wrap.current?.parentElement) row.observe(wrap.current.parentElement, { subtree: true, childList: true, characterData: true });
    return () => {
      removeEventListener('resize', place);
      row.disconnect();
    };
  }, [isOpen, placement, width]);

  // Open: Esc closes it from anywhere, before anything under it hears the
  // key (the panel's Esc); a press outside or a scroll closes it.
  useEffect(() => {
    if (!isOpen) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      // A pressed one was opened from its trigger: focus stays there.
      close(open!.pinned);
    };
    const press = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrap.current?.contains(target) && !popover.current?.contains(target)) close(false);
    };
    const scroll = (event: Event) => {
      if (!popover.current?.contains(event.target as Node)) close(false);
    };
    const listened = windows();
    for (const target of listened) {
      target.addEventListener('keydown', key, true);
      target.addEventListener('pointerdown', press, true);
      target.addEventListener('wheel', scroll, { capture: true, passive: true });
      target.addEventListener('scroll', scroll, true);
    }
    return () => {
      stay();
      for (const target of listened) {
        target.removeEventListener('keydown', key, true);
        target.removeEventListener('pointerdown', press, true);
        target.removeEventListener('wheel', scroll, true);
        target.removeEventListener('scroll', scroll, true);
      }
    };
  }, [isOpen]);

  const popoverId = `${id}-pop`;
  return h(
    'span',
    {
      ref: wrap,
      className: `relative inline-flex ${className ?? ''}`,
      onMouseEnter: () => {
        stay();
        // A pinned one, this or another, stays until it's pressed again.
        if (!menu && hovers() && !open?.pinned && !isOpen) show(false);
      },
      onMouseLeave: () => {
        if (isOpen && !open!.pinned) leave();
      },
    },
    h(
      'button',
      {
        ref: button,
        type: 'button',
        'aria-expanded': isOpen,
        'aria-controls': isOpen ? popoverId : undefined,
        'aria-haspopup': menu ? 'menu' : undefined,
        ...triggerProps,
        // A press (Enter and Space press a button too) pins it, or unpins it.
        onClick: () => (isOpen && open!.pinned ? close(false) : show(true)),
      },
      trigger,
    ),
    isOpen && style
      ? createPortal(
          h(
            'div',
            {
              ref: popover,
              id: popoverId,
              role: menu ? 'menu' : 'tooltip',
              'data-explainer': '',
              style,
              className: `observatory-pop z-50 rounded-lg border bg-popover text-[13px] leading-[1.45] text-popover-foreground ${menu ? 'p-1' : 'px-3 py-2.5'} ${popoverClass}`,
              onMouseEnter: stay,
              onMouseLeave: () => {
                if (open?.id === id && !open.pinned) leave();
              },
            },
            children,
          ),
          document.body,
        )
      : null,
  );
}
