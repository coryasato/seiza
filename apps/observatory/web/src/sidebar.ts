/**
 * The sidebar's state, plain JS (`docs/DECISIONS.md`, "Page": the
 * dashboard): open or fully collapsed on a desktop, the visitor's choice
 * kept in one `localStorage` key; on a phone closed at every load, opening
 * over the content with a scrim. The state is an attribute on `<html>`,
 * set by `SIDEBAR_SCRIPT` inline in the `<head>` before first paint, and
 * the layout follows it in CSS (`page.css`), so the prerendered HTML is the
 * same in every state and a reload never shifts it. `bindSidebar` binds
 * the toggle and the scrim once the page hydrates.
 */

/** The one key: `closed`, or open without it. */
export const SIDEBAR_KEY = 'seiza-observatory-sidebar';
/** The attribute on `<html>`: `open` or `closed`. Without it (no script
 *  ran) the CSS shows a desktop's sidebar open and a phone's closed. */
export const SIDEBAR_ATTRIBUTE = 'data-observatory-sidebar';
/** Where the sidebar sits beside the content rather than over it:
 *  Tailwind's `md`, as `page.css`'s rules. */
const DESKTOP = '(min-width: 48rem)';
/** The attributes `bindSidebar` finds the toggle and the scrim by. */
export const SIDEBAR_TOGGLE = 'data-observatory-sidebar-toggle';
export const SIDEBAR_SCRIM = 'data-observatory-sidebar-scrim';

/** Inline in `<head>` (`vite.config.ts`), before anything paints: a
 *  phone's sidebar closed whatever is stored, a desktop's as stored.
 *  Storage can throw (blocked site data); open then. */
export const SIDEBAR_SCRIPT = `(() => {
  let open = false;
  if (matchMedia(${JSON.stringify(DESKTOP)}).matches) {
    open = true;
    try { open = localStorage.getItem(${JSON.stringify(SIDEBAR_KEY)}) !== 'closed'; } catch {}
  }
  document.documentElement.setAttribute(${JSON.stringify(SIDEBAR_ATTRIBUTE)}, open ? 'open' : 'closed');
})();`;

/** What `SIDEBAR_SCRIPT` sets, for a load or a crossing of the breakpoint. */
function initial(desktop: MediaQueryList): boolean {
  if (!desktop.matches) return false;
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== 'closed';
  } catch {
    return true;
  }
}

const isOpen = () => document.documentElement.getAttribute(SIDEBAR_ATTRIBUTE) !== 'closed';

/** Binds every toggle and scrim in `root`; once per page. Returns the unbind. */
export function bindSidebar(root: ParentNode = document): () => void {
  const desktop = matchMedia(DESKTOP);
  const toggles = [...root.querySelectorAll<HTMLElement>(`[${SIDEBAR_TOGGLE}]`)];
  const show = (open: boolean) => {
    document.documentElement.setAttribute(SIDEBAR_ATTRIBUTE, open ? 'open' : 'closed');
    for (const toggle of toggles) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close the sidebar' : 'Open the sidebar');
    }
  };
  const set = (open: boolean) => {
    show(open);
    if (!desktop.matches) return;
    try {
      if (open) localStorage.removeItem(SIDEBAR_KEY);
      else localStorage.setItem(SIDEBAR_KEY, 'closed');
    } catch {
      // Kept for this page only.
    }
  };
  // The script's state again: it may not have run (the attribute is then
  // missing, and storage still holds the choice).
  show(initial(desktop));

  const press = () => set(!isOpen());
  const close = () => set(false);
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !desktop.matches && isOpen()) close();
  };
  // Crossing the breakpoint starts that layout's state afresh: a phone's
  // sidebar closed, a desktop's as stored.
  const resized = () => show(initial(desktop));
  const scrims = [...root.querySelectorAll<HTMLElement>(`[${SIDEBAR_SCRIM}]`)];
  for (const toggle of toggles) toggle.addEventListener('click', press);
  for (const scrim of scrims) scrim.addEventListener('click', close);
  document.addEventListener('keydown', key);
  desktop.addEventListener('change', resized);
  return () => {
    for (const toggle of toggles) toggle.removeEventListener('click', press);
    for (const scrim of scrims) scrim.removeEventListener('click', close);
    document.removeEventListener('keydown', key);
    desktop.removeEventListener('change', resized);
  };
}
