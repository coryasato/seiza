import type { ColumnType } from './state.ts';

/** The frame's icons: the design canvas's, drawn on a 16 px grid at a
 *  1.4 px stroke. */

const PATHS = {
  file: <path d="M4 2h5l3 3v9H4zM9 2v3h3" />,
  rows: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
  chevd: <path d="M3.5 6L8 10.5 12.5 6" />,
  up: <path d="M8 13V3M8 3L4.5 6.5M8 3l3.5 3.5" />,
  filter: <path d="M2.5 3.5h11l-4.2 5v4l-2.6 1v-5z" />,
  sort: <path d="M5 3v10M5 13l-2-2M5 13l2-2M11 13V3M11 3L9 5M11 3l2 2" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  down: <path d="M8 3v10M8 13l-3.5-3.5M8 13l3.5-3.5" />,
  more: (
    <>
      <circle cx="3.5" cy="8" r="0.8" />
      <circle cx="8" cy="8" r="0.8" />
      <circle cx="12.5" cy="8" r="0.8" />
    </>
  ),
  chevr: <path d="M6 3.5L10.5 8 6 12.5" />,
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </>
  ),
  moon: <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3 5.5 5.5 0 1 0 13 9.5z" />,
  x: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  prompt: <path d="M4 4.5L7.5 8 4 11.5M9 12h3.5" />,
  pin: <path d="M6 2.5h4l-.5 4 2 2h-7l2-2zM8 8.5V14" />,
  restore: <path d="M3 8a5 5 0 1 0 1.6-3.7M3 3v3h3" />,
  clipboard: (
    <>
      <rect x="3.5" y="3" width="9" height="11" rx="1.5" />
      <path d="M6 3V2h4v1" />
    </>
  ),
  hash: <path d="M6 2.5l-1 11M11 2.5l-1 11M3 6h10.5M2.5 10H13" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2 1.3" />
    </>
  ),
  check: <path d="M3.5 8.5l3 3 6-7" />,
  panelr: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M10 3v10" />
    </>
  ),
  panell: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M6 3v10" />
    </>
  ),
  columns: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M6.2 3v10M9.8 3v10" />
    </>
  ),
  eye: (
    <>
      <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" />
      <circle cx="8" cy="8" r="1.6" />
    </>
  ),
  eyeoff: <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4zM3 13L13 3" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M3 10.5v-7a1 1 0 0 1 1-1h6.5" />
    </>
  ),
  pointer: <path d="M4 2.5l8 5-3.6.9L7 12z" />,
  keyboard: (
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <path d="M4.5 9.5h7" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className ?? ''}`}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Tycho's mark: a four-pointed star in the accent. */
export function Logo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <path d="M8 1l1.5 5.5L15 8l-5.5 1.5L8 15l-1.5-5.5L1 8l5.5-1.5z" fill="var(--accent)" />
    </svg>
  );
}

/** A column's type badge: a glyph as well as a color. */
export function Badge({ kind }: { kind: ColumnType }) {
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
    <span aria-hidden="true" className={`flex h-4 w-[18px] shrink-0 items-center justify-center rounded select-none ${look}`}>
      {glyph}
    </span>
  );
}
