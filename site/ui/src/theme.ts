/**
 * The site's theme, plain JS (root `docs/DECISIONS.md`, "Comparison
 * protocol": one toggle for the whole apex). The choice is one
 * `localStorage` key, shared by every page on the origin; without one the
 * site follows the system. `THEME_SCRIPT`, inline in each page's `<head>`,
 * applies it before first paint; the rest binds after, and a page with
 * React binds through the shell's wrappers (`components/navbar.ts`). A page
 * that hands the theme on (the observatory's contender frames) listens with
 * `onThemeChange`.
 */

export type Theme = 'light' | 'dark';

/** The one key, for every page on seiza.io. */
export const THEME_KEY = 'seiza-theme';
/** The event the root dispatches when the theme changes; `detail` is the
 *  theme. */
export const THEME_EVENT = 'seiza:theme';

const SYSTEM_DARK = '(prefers-color-scheme: dark)';

/**
 * Inline in `<head>` (`siteVite` injects it), before anything paints: the
 * stored choice, or the system's, as `.dark` on `<html>`. Storage can
 * throw (blocked site data); the system's theme then.
 */
export const THEME_SCRIPT = `(() => {
  let stored = null;
  try { stored = localStorage.getItem(${JSON.stringify(THEME_KEY)}); } catch {}
  const dark = stored ? stored === 'dark' : matchMedia(${JSON.stringify(SYSTEM_DARK)}).matches;
  document.documentElement.classList.toggle('dark', dark);
})();`;

/** The theme on screen. */
export const currentTheme = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

function stored(): Theme | null {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    return theme === 'light' || theme === 'dark' ? theme : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme): void {
  if (theme === currentTheme()) return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: theme }));
}

/** Shows `theme` and keeps it as the visitor's choice. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Kept for this page only.
  }
  apply(theme);
}

/** Calls `listener` with each new theme; returns the unsubscribe. */
export function onThemeChange(listener: (theme: Theme) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<Theme>).detail);
  document.documentElement.addEventListener(THEME_EVENT, handle);
  return () => document.documentElement.removeEventListener(THEME_EVENT, handle);
}

let following = false;

/** Follows the system while there's no stored choice, and another tab's
 *  choice when it's made; once per page. */
export function followTheme(): void {
  if (following) return;
  following = true;
  matchMedia(SYSTEM_DARK).addEventListener('change', (event) => {
    if (!stored()) apply(event.matches ? 'dark' : 'light');
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_KEY) return;
    apply(stored() ?? (matchMedia(SYSTEM_DARK).matches ? 'dark' : 'light'));
  });
}

/** Makes `button` the toggle: a press switches to the other theme. Its
 *  label says which it switches to. Returns the unbind. */
export function bindThemeToggle(button: HTMLElement): () => void {
  followTheme();
  const label = () => button.setAttribute('aria-label', currentTheme() === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme');
  const press = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  label();
  button.addEventListener('click', press);
  const unsubscribe = onThemeChange(label);
  return () => {
    button.removeEventListener('click', press);
    unsubscribe();
  };
}
