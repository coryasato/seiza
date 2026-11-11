# Kirkwood

> *Daniel Kirkwood found the gaps in the asteroid belt in the 1860s without a telescope: certain orbit sizes were missing from the catalog.*

**Planned; nothing is built yet.**

Kirkwood is the asteroid belt as a scene to fly through, drawn from a table of 1.57 million asteroids (NASA/JPL), with that table beside it. **Every dot is a row:** click a row and the camera flies to it; draw around a group of dots and the table shows their rows.

What it will show:

- **The belt in space,** every asteroid on its own orbit, with time sped up from years to seconds.
- **The view that turns with Jupiter,** where one family of asteroids traces a triangle and another sits in two clouds ahead of and behind the planet.
- **The Kirkwood gaps.** They can't be seen in space. "Sort by orbit size" flies every dot into a chart of orbit size against how stretched the orbit is, and the gaps open as the dots land.
- **A gap, explained by playing:** pick one, and a marker asteroid dropped there shows why Jupiter keeps that orbit empty.

It's a showcase: an app for fun around the table that [Tycho](../tycho/) is built on, not a tool and not a benchmark. It will live at `tycho.seiza.io/kirkwood`.

## Honest about the picture

- **Dot sizes are exaggerated.** At true scale every asteroid is an invisible speck millions of kilometers from the next; the belt is empty.
- **The gaps aren't shown forming.** That took millions of years. The orbits are computed from each asteroid's measured elements.

## Canvas tradeoffs

To be written with the app: what a canvas-drawn scene and table give up against the DOM (accessibility, text selection, find-in-page, bundle size), and what Kirkwood does about each.

## For contributors

What's next: [`PLAN.md`](PLAN.md). Why it's built this way: [`docs/DECISIONS.md`](docs/DECISIONS.md) and the research, [`docs/research/asteroid-belt.md`](../../docs/research/asteroid-belt.md).
