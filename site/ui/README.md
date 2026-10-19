# site-ui

The apex site's shell (seiza.io): the navbar, the theme toggle, the footer, the token file, the Tailwind v4 setup, and shadcn's components on Base UI. Every page on seiza.io renders the same shell from here, React or not.

**Used by:** [the observatory's page](../../apps/observatory/web/). **Package:** `@seiza/site-ui`.

## Use it

A page's Vite config adds the site's plugins, and prerenders its first screen (`shared-web`'s `prerender`) so the shell is HTML before any JS runs:

```ts
// vite.config.ts
import { siteVite } from '@seiza/site-ui/vite';
export default defineConfig(seizaViteConfig({ preload: [] }, { plugins: [siteVite(), prerender({ … })] }));
```

```css
/* the page's CSS */
@import '@seiza/site-ui/site.css';
@source './';
```

```ts
// the page's view (React without JSX, as the rest of the repo)
h(SiteShell, { home: '/', links: [{ label: 'Observatory', href: '/observatory/', current: true }] }, content);
```

- **`siteVite()`** (`/vite`): Tailwind v4, the theme script inline in the `<head>`, and the font at `/fonts/` in dev and preview (`@seiza/web`'s `serveFonts`).
- **`site.css`**: Tailwind, the tokens, IBM Plex Sans (`/fonts/IBMPlexSans-Regular.ttf`, `swap`), and shadcn's `@theme inline` mapping, so `bg-primary`, `text-muted-foreground`, `bg-series-gpui`, … read the tokens. `.dark` on `<html>` is dark mode (`dark:` variants).
- **`SiteShell`** (`/shell`): the navbar above the page's content and the footer below. `home` is where the site's name links. `bindShell(root)` binds the shell's behaviors on a page without React.
- **`theme.ts`** (`/theme`): the toggle's plain JS. `THEME_KEY` (`seiza-theme`, one `localStorage` key for the origin), `THEME_SCRIPT` (inline, before first paint), `currentTheme()`, `setTheme(theme)`, `onThemeChange(listener)` (for a page that passes the theme on, as the observatory does to its frames), `followTheme()` (the system while there's no choice, and other tabs' choices), `bindThemeToggle(button)`.
- **Components** (`/components/<name>`): `button` (`Button`, `buttonVariants`), `toggle-group` (`ToggleGroup`, `ToggleGroupItem`: a segmented control), `collapsible` (`Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`), `navbar` (`Navbar`, `ThemeToggle`), `footer`. **`cn`** (`/cn`): class names, later Tailwind classes winning.

## Theme

The token file (`src/tokens.css`) is shadcn's Neutral with a sky primary and a blue chart ramp, as exported from shadcn's theme creator, plus two series: `--series-gpui` and `--series-tanstack` (`--chart-2`/`--chart-5` in light, `--chart-1`/`--chart-3` in dark, the pairs that pass a palette check). Label every series by name too, never by color alone. In dark mode, text and icons in the accent use `--sidebar-primary`, never `--primary` (fills only); the light sidebar's active item is `--primary` behind `--primary-foreground`. Why: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Comparison protocol" (the site's theme).

## Limits

- **One face, one weight:** IBM Plex Sans Regular, the contenders' face. Nothing synthesizes a weight (`font-synthesis: none`); hierarchy is size and color.
- **Light and dark only,** by the toggle; with no choice stored, the system's.
- **Not for the observatory's contenders,** which are bare builds with their own theme (gpui-kit's), compared, not part of the site.
