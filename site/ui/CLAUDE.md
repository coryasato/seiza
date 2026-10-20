# site-ui

The apex site's shell, `@seiza/site-ui`: what every page on seiza.io renders around its content (root `CLAUDE.md`, "The apex site").

---

This is the shell's context. What it offers a page is in `README.md`; why it's built this way, in the root `docs/DECISIONS.md` ("Repo structure": the apex site's builds, the apex site and Tycho; "Comparison protocol": the site's theme and its toggle). Its work is a milestone of the app whose page drives it (the observatory's, `apps/observatory/PLAN.md`), measured there. The repo-wide rules in the root `CLAUDE.md` apply here too.

## Rules

1. **The shell never waits on JS.** Its markup is React rendered to HTML at build time; anything it does is plain JS bound after (`theme.ts`, `bindShell`), with a React wrapper that binds it in an effect. A component's first render must be the same on the server and the client: read nothing from the browser while rendering (a theme-dependent icon is both icons, shown by CSS).
2. **No app knowledge.** No observatory paths, contenders, or metrics: a page passes what it needs (`home`, `links`, its content).
3. **The tokens are the export.** `src/tokens.css` is shadcn's theme creator's file as exported (its one changed value says so in place); change it by exporting again, and keep the accent rules and the series in `README.md`, "Theme". The components are shadcn's Nova source (its `base-nova` registry), as React without JSX, less `font-medium`; a change to their look is a design decision. The observatory's lint (`apps/observatory/web/scripts/grays.ts`) holds its surface grays close to the contenders' generated `theme.css`; a token change that fails it is a design decision, recorded in the root `docs/DECISIONS.md`.
4. **Every dependency pinned exactly,** as the observatory's: React with the TanStack contender's version, Base UI, Tailwind, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`.

## Layout

```
site/ui/
  src/
    tokens.css      # the token file, as exported, + the two series
    site.css        # Tailwind, the tokens, the face, shadcn's @theme mapping
    theme.ts        # the toggle's plain JS and the inline <head> script
    shell.ts        # SiteShell, bindShell
    vite.ts         # siteVite(): Tailwind, the head script, /fonts/ in dev and preview
    cn.ts
    components/     # button, toggle-group, collapsible (on Base UI), sidebar (its parts), navbar, footer
  README.md         # for a page that uses it
  CLAUDE.md         # this file
```

## Commands

```
npm run typecheck --workspace @seiza/site-ui   # also in `just observatory lint`
```
