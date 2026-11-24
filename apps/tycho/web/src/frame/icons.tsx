/** The frame's icons: the design canvas's, drawn on a 16 px grid at a
 *  1.4 px stroke. */

const PATHS = {
  file: <path d="M4 2h5l3 3v9H4zM9 2v3h3" />,
  rows: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
  chevd: <path d="M3.5 6L8 10.5 12.5 6" />,
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
