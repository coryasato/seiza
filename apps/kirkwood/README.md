# Kirkwood

> *Daniel Kirkwood found the gaps in the asteroid belt in the 1860s without a telescope: certain orbit sizes were missing from the catalog.*

**Being built.** What runs today: the belt in space, 1,580,265 asteroids each on its own orbit around the Sun, with Jupiter on its, and time running at a year a second from 1976 to 2076; "Ride with Jupiter", which turns the view with the planet so it holds still, and shows one family of asteroids as a triangle and another as two clouds ahead of and behind it; and the table of all 1,580,272 rows, held in the page's memory, in a panel behind a handle. Each dot is colored by the size of its orbit and is as bright as the asteroid would look, in front of 779,012 of Gaia's brightest stars. On a slow connection the belt fills in as it arrives, the first-numbered asteroids first, and the page counts the dots so far. "Sort by orbit size" flies every dot into a chart of orbit size against how stretched the orbit is, and back, where the gaps open under the chart's axes, with a label over each gap and a count of the rows in view. Not built yet: anything that links a dot to its row.

Kirkwood is the asteroid belt as a scene to fly through, drawn from a table of 1.58 million asteroids (NASA/JPL), with that table beside it. **Every dot is a row:** click a row and the camera flies to it; draw around a group of dots and the table shows their rows.

What it will show:

- **The belt in space,** every asteroid on its own orbit, with time sped up from years to seconds.
- **The view that turns with Jupiter,** where one family of asteroids traces a triangle and another sits in two clouds ahead of and behind the planet.
- **The Kirkwood gaps.** They can't be seen in space. "Sort by orbit size" flies every dot into a chart of orbit size against how stretched the orbit is, and the gaps open as the dots land.
- **A gap, explained by playing:** pick one, and a marker asteroid dropped there shows why Jupiter keeps that orbit empty.

It's a showcase: an app for fun around the table that [Tycho](../tycho/) is built on, not a tool and not a benchmark. It will live at `tycho.seiza.io/kirkwood`.

## Honest about the picture

- **Dot sizes are exaggerated.** At true scale every asteroid is an invisible speck millions of kilometers from the next; the belt is empty.
- **The gaps aren't shown forming.** That took millions of years. The orbits are computed from each asteroid's measured elements.
- **Nearly every dot is on its 2026 orbit.** Each asteroid keeps the ellipse it was on in June 2026, as if only the Sun pulled on it. That is its real place that day and close to it for a decade either side; further out it's a picture of the belt, not a forecast, so the date stops at 1976 and 2076. The two families that move in step with Jupiter, the Hildas and the Trojans, are the exception: Jupiter's pull is what keeps them where they are, so those 24,872 are moved under the Sun and Jupiter together. Against JPL's own places that puts the Trojan Hektor within 0.02 au fifty years out, where its ellipse alone is 2.7 au off; Saturn and the rest are still left out.
- **Brightness is real, but squeezed.** A dot's brightness and size come from the asteroid's measured brightness (H) and its distance from the Sun, compressed so the faintest still show. In the sky Ceres outshines a small asteroid thousands of times over; here, far less.
- **The stars aren't rows.** The sky behind the belt is real, each star in its true direction (ESA's Gaia), but it's a backdrop: only the asteroids are in the table. The star sample has nothing brighter than magnitude 1.7, so Sirius and the few stars like it are missing.
- **Riding with Jupiter, two families are brightened.** The Hildas (8,400) and the Trojans (16,472) are a sliver of 1.58 million dots, so in that view they're drawn three and two times as bright and the rest of the belt dimmed, and the page says so. The stars are left out of it: turned with the view they'd wheel around the screen.
- **The Sun and Jupiter are drawn far too big,** and the Sun's glow is for show.
- **Seven rows have no dot.** They're passing through the solar system on paths that never close, and the page counts them apart.

## Canvas tradeoffs

To be written as the app is built: what a canvas-drawn scene and table give up against the DOM (accessibility, text selection, find-in-page, bundle size), and what Kirkwood does about each. As it stands: the table is drawn on a canvas, so a screen reader finds nothing in it, its text can't be selected, and the browser's find-in-page doesn't see it.

## Credits

- **Asteroids:** NASA/JPL Small-Body Database, fetched 2026-11-11. Jupiter's orbit: NASA/JPL Horizons.
- **Stars:** This work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC).

## For contributors

Run it: build the data files once ([`docs/data.md`](docs/data.md), "Commands": the fetch, then prep, then the sky's file from Tycho's Gaia sample), then `just kirkwood dev` from the repo root. What's next: [`PLAN.md`](PLAN.md). Why it's built this way: [`docs/DECISIONS.md`](docs/DECISIONS.md) and the research, [`docs/research/asteroid-belt.md`](../../docs/research/asteroid-belt.md).
