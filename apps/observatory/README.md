# Observatory

> *Where the instruments are compared.*

**Planned, not built yet.** It will live at `seiza.io/observatory`.

The Observatory is seiza's comparison site. For each component in the repo (first the virtualized table behind [Tycho](../tycho/)), it will put the component's base level, drawn by GPUI on a canvas from WebAssembly, next to a 1:1 React equivalent drawn in the DOM, and measure both the same way.

- **Only the UI differs:** both sides read the same data through the same engine (DuckDB-Wasm), with the same queries and the same paging numbers.
- **The same scope:** a comparison level is two builds with identical features; neither carries code the other lacks.
- **Measured, not raced:** contenders run one at a time, since two in one tab share a main thread and a GPU. The recorded numbers come from cold Playwright runs; a replay in your browser is labelled warm.
- **Where React wins, too:** first pixels and bundle size are likely React's, and the page will say so.

The rules are the root [`CLAUDE.md`](../../CLAUDE.md)'s "Comparison protocol", and the decisions behind them are in the root [`docs/DECISIONS.md`](../../docs/DECISIONS.md). What's next, and what has to happen first, is in [`PLAN.md`](PLAN.md).
