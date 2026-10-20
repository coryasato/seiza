# site-ui

The apex site's shell (seiza.io): the navbar, the theme toggle, the footer, the token file, the Tailwind v4 setup, and shadcn's components on Base UI in its Nova style. Every page on seiza.io renders the same shell from here, React or not.

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
- **`site.css`**: Tailwind, the tokens, IBM Plex Sans (`/fonts/IBMPlexSans-Regular.ttf`, `swap`), and shadcn's `@theme inline` mapping, so `bg-primary`, `text-muted-foreground`, `bg-series-gpui`, … read the tokens. `.dark` on `<html>` is dark mode (`dark:` variants). `--site-bar` is the navbar's height (border included), for a page's sticky parts; every enabled `button` and `[role=button]` shows `cursor: pointer`.
- **`SiteShell`** (`/shell`): the navbar above the page's content and, unless `footer: false`, the footer below. The page supplies its own `<main>`. `home` is where the site's name links. `bindShell(root)` binds the shell's behaviors on a page without React.
- **`Navbar`** spans the window, its contents too (no max-width): the site's name and sections, the theme toggle, nothing a page adds, so it's the same on every page (root `docs/DECISIONS.md`, "Repo structure": the apex site's layout). A page's own navigation, and a sidebar's toggle, sit below it.
- **`theme.ts`** (`/theme`): the toggle's plain JS. `THEME_KEY` (`seiza-theme`, one `localStorage` key for the origin), `THEME_SCRIPT` (inline, before first paint), `currentTheme()`, `setTheme(theme)`, `onThemeChange(listener)` (for a page that passes the theme on, as the observatory does to its frames), `followTheme()` (the system while there's no choice, and other tabs' choices), `bindThemeToggle(button)`.
- **Components** (`/components/<name>`), from shadcn's `base-nova` registry less `font-medium` (one weight): `button` (`Button`, `buttonVariants`), `toggle-group` (`Toggle`, `ToggleGroup`, `ToggleGroupItem`, `toggleVariants`; the site's `segmented` variant: the pressed item `--background` raised on a `--muted` track), `collapsible` (`Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`), `sidebar` (the parts only: `SidebarGroup`, `SidebarGroupLabel`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuLink` with `isActive`; no provider, sheet, or cookie: a sidebar's state and layout are its page's), `navbar` (`Navbar`, `ThemeToggle`), `footer` (`Footer`, `SOURCE`). **`cn`** (`/cn`): `cn`, class names, later Tailwind classes winning; `data`, `data-*` props for `createElement`.

## Theme

The token file (`src/tokens.css`) is shadcn's Neutral, as exported from shadcn's theme creator, but for the dark `--sidebar-primary` (exported blue, used by nothing; Neutral's gray here), plus two series: `--series-gpui` blue and `--series-tanstack` orange, a value per mode, the only hue on the site. Label every series by name too, never by color alone. The accent is fills, never hue: an active item is `--sidebar-accent` behind `--sidebar-accent-foreground`, a pressed toggle `--background` raised on a `--muted` track (`segmented`), a link in running text foreground and underlined. Why: root [`docs/DECISIONS.md`](../../docs/DECISIONS.md), "Comparison protocol" (the site's theme).

## Limits

- **One face, one weight:** IBM Plex Sans Regular, the contenders' face. Nothing synthesizes a weight (`font-synthesis: none`); hierarchy is size and color.
- **Light and dark only,** by the toggle; with no choice stored, the system's.
- **Not for the observatory's contenders,** which are bare builds with their own theme (gpui-kit's), compared, not part of the site.
