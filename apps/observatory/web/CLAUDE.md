# The observatory's page (`web/`)

The page's architecture. Claude Code loads this file when a file under `web/` is read. The observatory's rules and the map of its folders are in `apps/observatory/CLAUDE.md`, the repo's in the root `CLAUDE.md`; both apply here. Paths are relative to `apps/observatory/`.

## What it is

Vite on `shared-web/` and `@seiza/site-ui`, `base: '/observatory/'`, React without JSX, in the site's shell (`SiteShell`, no footer; `site/ui/CLAUDE.md`). One HTML file per route: `index.html` the Overview, `tall-table/index.html` the component's page, `tall-table/<scenario>/index.html` each scenario's comparison (`src/components.ts`'s `ROUTES`, from `contenders/scenarios.ts`). Each is prerendered by `shared-web`'s `prerender` (`src/prerender.ts`, Node only) and hydrated by `src/main.ts` as the route its HTML names (`data-route`, not the URL). On a scenario's route the contender's window fills the first screen, the description below it. What the page shows and why (the dashboard, the window, its cards and readings): `docs/DECISIONS.md`, "Page"; the design canvas is the visual spec.

## Rules

- **First paint carries only the first screen.** Anything below the fold renders after first paint: prerendered, it delays it. The galleries (the Overview's and the component's page's bodies, `src/gallery.ts`) are a chunk of their own: the prerender renders them directly and the client hydrates them through `lazy` (`page.ts`'s `Galleries`), so their HTML is whole and their code isn't first-paint JS. The status bar's box (`.observatory-status` in `page.css`, `contain: strict`) is in the prerendered HTML; its contents (`src/numbers.ts`, a chunk of its own, never prerendered), the meter, the metrics module, and the frame all come after first paint (`src/paint.ts`). The budgets are first paint (paint timing) and first-paint JS (`perf/page.ts`).
- **Never type a number into the page.** `cold.ts` resolves the cold numbers at build time from `perf/budgets.json` and `perf/results/` through `shared-web/scripts/results.ts`, as `report` resolves them (`virtual:cold-numbers`); the galleries' words come from it too (`virtual:gallery`, `readouts.ts`'s `galleryOf`), the only numbers in the first-paint JS; and the data file's rows from `data/MANIFEST.json` (`virtual:data-rows`, the one value the prerendered title bar needs, so the prerender gets the plugin too). `cold.ts` fails the build on a script face without a verdict.
- **One contender at a time, in a frame a switch destroys:** the window (`src/slot.ts`) creates a same-origin frame at the scenario's level after the page's first paint; a flip or a stop destroys it and creates the next. `?side=` and `?stop=` pick the first frame and a switch writes them, the defaults omitted; a scenario's link carries the route's `?side=`, never `?stop=`. The page's theme goes in as `?theme=` once, then by message, and again at the frame's `load`. The title bar's controls stay disabled until the shown frame's first `contender:filled` or its `contender:failed` arrives by `postMessage`.
- **The page's readouts stay off the contender's main thread as far as they can** (they share it; their budget is `readout-cost`'s): `src/live.ts` records raw readings from listeners on the frame's window, runs a rAF loop only while a scroll (on the wide sheet, a drag too) is under way or, under a feed, from the first rows painted on, and reads memory never during a scroll; the metrics module turns readings into numbers at 4 Hz, nothing while the page is hidden; the status bar's numbers are written by `textContent` from that refresh, never a React render; the wide sheet's selection and copy live in `slot.ts`'s `toolsStore`, outside React's state, so only the Copy button and the status bar's left re-render. A side loaded second or from the cache is labeled warm.
- **Drop every reference to a destroyed frame:** anything from a frame's realm keeps the frame alive (`live.ts`'s `release`; `perf/CLAUDE.md`, "Anything from a frame's realm").
- **The page talks to a contender only through its frame:** `components.ts` holds each contender's name, label, and a URL per level, never its code, and the rest crosses by `postMessage` and the frame's published globals (`docs/contender-contract.md`). What it imports from `contenders/` is shared modules (`scenarios.ts`, `paths.ts`, `contract.ts`, `follow.ts`, `tools.ts`, `fonts/faces.ts`, `wall/desks.ts`) and one pure module of the TanStack contender's, `paint.ts`, so the galleries' heat draws as the cells do.
- **What a screen reader hears:** the side's state is the page's `aria-live` text, changed only by a load (the app, the engine, the data, ready cold or warm, failed); the wide sheet's selection and copy are said in the status bar's own polite region, which speaks the copy line's words when they change, never a copy's share, and a selection's count once it rests. A fonts load that fails leaves the window usable.
- **The meter takes the pointer only on its buttons and its header,** so a click or a wheel under it reaches the contender; an explainer's popover renders into the body, fixed from its trigger, so no box clips it.
- **A card with `apart` wins only where the two sides' runs don't overlap** (its `-min` and `-max` metrics; `readouts.ts`).
- **The dev and preview servers serve what the frames load, as the deploy does:** both contenders' release builds at their bases (each level's too), the engine, the font, the admin table's script faces, and the data. `scripts/grays.ts` (in `lint`) holds the site's surface grays within ΔE 2.5 of the contenders' `theme.css`.
- **The description says where the canvas falls short,** as the README's "Canvas tradeoffs" does: each story's `shortfalls` beyond every scenario's (`STORIES`).

## Where each piece is

```
index.html, tall-table/index.html, tall-table/<scenario>/index.html   one per route, prerendered
cold.ts               the virtual modules: cold numbers, the galleries' words, the data's rows (resolveCold for perf/page.ts)
src/main.ts           hydration as the route its HTML names
src/prerender.ts      each route's HTML (Node only)
src/page.ts           the dashboard: the sidebar (sidebar.ts), the inset card, the crumb and its scenario menu, the window, the description
src/gallery.ts        the Overview's and the component's page's bodies; mechanisms.ts, where each side wins (MECHANISMS)
src/components.ts     the components, their contenders' URLs per level, their scenarios and what the page says of each, ROUTES
src/slot.ts           the contender's window: the frame, the title bar (toggle, dial, follow toggle, fonts toggle, Copy), the side's state
src/numbers.ts        the status bar's contents, the panel per scenario, the description (STORIES), the toggles and Copy button
src/readouts.ts       pure: each scenario's cards, their metrics and keys, the chart's rows, the Download parts, the verdicts' words
src/live.ts           this tab's raw readings from the frame; metrics.ts loads the metrics module after first paint
src/meter.ts          the meter: frame time and memory, open, a pill, or hidden, in a corner
src/explainer.ts      every explainer and the phone's overflow menu
src/scripts.ts        the admin table's scripts (SCRIPT_ROWS), pure
src/paint.ts          after the page's first paint
src/page.css          the page's own styles; scripts/grays.ts, the grays check
```

## Commands

The page's own check, `just observatory page`, is in `perf/CLAUDE.md`.

```
just observatory dev           # the page's Vite dev server, with COOP/COEP, its frames on the contenders' release builds (build them first)
just observatory build         # the page's release build (one prerendered HTML file per route), asset sizes
just observatory preview       # serve that build (brotli) with the contenders' builds, the engine, the font, and the data, as the deploy does
```
