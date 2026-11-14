---
paths:
  - "site/**"
  - "apps/observatory/web/**"
  - "apps/observatory/worker/**"
  - "apps/tycho/web/**"
  - "shared-web/**"
---

# The apex site (`site/`)

seiza.io holds more than the observatory: a landing page at `/` (when it ships) and other sections later. Why it's built this way: `docs/DECISIONS.md`, "Repo structure" (the apex site's builds; the apex site and Tycho).

- **`site/ui/` (`@seiza/site-ui`) is the site's shell,** one source for every page on seiza.io: the navbar, the theme toggle, the footer, the token file (`src/tokens.css`), the Tailwind v4 setup (`site.css`, `siteVite()`), and shadcn's components on Base UI. Its markup is React rendered to HTML at build time (a page's prerender, `shared-web`'s `prerender`), so the shell never waits on JS; its behaviors are plain JS (`theme.ts`) with thin React wrappers, so a page without React renders the same markup and calls `bindShell`. Its rules, API, and limits: `site/ui/CLAUDE.md` and `README.md`.
- **Each page is its own build,** cached and budgeted on its own, joining the shell as a package: the observatory's is `apps/observatory/web/` (its nav and everything below the navbar are the observatory's). `site/landing/` and `site/worker/` (the one Worker for the apex) come when the landing page ships; until then the observatory's Worker serves the apex.
- **One theme toggle for the apex:** one `localStorage` key (`seiza-theme`), applied by an inline script in each page's `<head>` before first paint; a page that frames others (the observatory's contenders) passes it on.
- **No UI shared with Tycho** and nothing site-specific in `shared-web/`, which stays app-agnostic. Dependencies run `shared-web/` ← `site/ui/` ← the site's pages. The observatory's contenders never import `site/ui/`: they're bare builds, compared, not part of the site.
- **Fixed paths every build on the apex shares:** the font at `/fonts/` (`shared-web/fonts/`; the path is `shared-web/src/font.ts`'s, served by its `serveFonts` in dev and preview, staged by the deploy), so it's cached across them.
