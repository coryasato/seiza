# Kirkwood

> *Daniel Kirkwood found the gaps in the asteroid belt in the 1860s without a telescope: certain orbit sizes were missing from the catalog.*

**Live at [kirkwood.seiza.io](https://kirkwood.seiza.io/).** What runs there: the belt in space, 1,580,265 asteroids each on its own orbit around the Sun, with Jupiter on its, and time running at a year a second from 1976 to 2076; "Ride with Jupiter", which turns the view with the planet so it holds still, and shows one family of asteroids as a triangle and another as two clouds ahead of and behind it; and the table of all 1,580,272 rows, held in the page's memory, in a panel behind a handle. Each dot is colored by the size of its orbit and is as bright as the asteroid would look, in front of 779,012 of Gaia's brightest stars. On a slow connection the belt fills in as it arrives, the first-numbered asteroids first, and the page counts the dots so far. "Sort by orbit size" flies every dot into a chart of orbit size against how stretched the orbit is, and back, where the gaps open under the chart's axes, with a label over each gap and a count of the rows in view. Press a gap's label and the view rides with Jupiter with a marker dropped at that gap: its path there closes into a loop, and a card says why the orbit empties. The camera is yours to move, as a map's is ("Moving the camera", below). Press a row of the table and the camera flies to that asteroid, rings it in white with its name, and keeps it in the middle as time runs; "Find Ceres" does it for the first row. And the other way: "Draw a group" pauses time and lets you draw a shape around some dots; they keep their color while the rest of the belt goes gray, a label counts them, and the table shows only their rows, which a press on a number column's arrow sorts. As the group is picked the camera flies in until it fills the view, the table comes in beside it, and the group's four biggest asteroids are named on their dots. "Show all rows", "The whole belt", or the button again gives everything back, the camera where it was. A click on a single dot does the same for one row: the table shows that asteroid alone, and the camera flies to it.

Two of the table's columns move as time runs: `sun_au` and `jupiter_au`, each asteroid's distance from the Sun and from Jupiter on the date shown, worked out again twice a second. While time runs they show one decimal, since the rest would change faster than it can be read; pause and they show three. And the table sorts by any of its number columns: press the arrow beside `diameter` (scroll the table sideways to reach it) and its top rows are the biggest bodies on file, Ceres first. Press one, or walk down them with the arrow keys, and the camera flies to each in turn.

Kirkwood is the asteroid belt as a scene to fly through, drawn from a table of 1.58 million asteroids (NASA/JPL), with that table beside it. **Every dot is a row:** click a row and the camera flies to it; draw around a group of dots and the table shows their rows.

What it shows:

- **The belt in space,** every asteroid on its own orbit, with time sped up from years to seconds.
- **The view that turns with Jupiter,** where one family of asteroids traces a triangle and another sits in two clouds ahead of and behind the planet.
- **The Kirkwood gaps.** They can't be seen in space. "Sort by orbit size" flies every dot into a chart of orbit size against how stretched the orbit is, and the gaps open as the dots land.
- **A gap, explained by playing:** pick one, and a marker asteroid dropped there shows why Jupiter keeps that orbit empty.

It's a showcase: an app for fun around the table that [Tycho](../tycho/) is built on, not a tool and not a benchmark. It lives at [kirkwood.seiza.io](https://kirkwood.seiza.io/), a subdomain of its own; links to its old address, `tycho.seiza.io/kirkwood`, still lead here.

## Moving the camera

The camera works like a map's, in space and while riding with Jupiter. On the chart of the gaps nothing moves.

| | Mouse | Trackpad | Touch | Keys |
|---|---|---|---|---|
| Move | Drag | Click and drag | Drag with one finger | The arrows |
| Zoom | Scroll, or double click | Pinch, or two fingers up and down | Pinch, or double tap | + and − |
| Tilt and turn | Shift + drag | Shift + click and drag | Two fingers up and down; twist them | |
| Back to the first view | The compass, bottom right | The compass | The compass | H |
| This list, on the page | The ? button | The ? button | The ? button | ? |

Two fingers do one thing at a time: a pinch zooms and a twist turns together, and two fingers moved up or down together tilt. The list on the page also sets the scene's resolution (full, three quarters, or half of the display's): fewer pixels draw more frames a second, and the choice is kept for the next visit.

The page opens on a slanted view, the belt running corner to corner. Moving and zooming keep the slant; the first tilt or turn levels the horizon, as a map's is. The compass's ring flattens as the camera tilts and its needle turns as the camera does (it leans at the opening, with the slant); pressed, it flies the camera back to the opening view. A one-line hint of the controls shows until you first move the camera, then folds to the ? button, and stays folded on your next visit. With the table open, the keys are the table's.

## Honest about the picture

- **Dot sizes are exaggerated.** At true scale every asteroid is an invisible speck millions of kilometers from the next; the belt is empty.
- **The gaps aren't shown forming.** That took millions of years. The orbits are computed from each asteroid's measured elements.
- **Nearly every dot is on its 2026 orbit.** Each asteroid keeps the ellipse it was on in June 2026, as if only the Sun pulled on it. That is its real place that day and close to it for a decade either side; further out it's a picture of the belt, not a forecast, so the date stops at 1976 and 2076. The two families that move in step with Jupiter, the Hildas and the Trojans, are the exception: Jupiter's pull is what keeps them where they are, so those 24,872 are moved under the Sun and Jupiter together. Against JPL's own places that puts the Trojan Hektor within 0.02 au fifty years out, where its ellipse alone is 2.7 au off; Saturn and the rest are still left out.
- **Brightness is real, but squeezed.** A dot's brightness and size come from the asteroid's measured brightness (H) and its distance from the Sun, compressed so the faintest still show. In the sky Ceres outshines a small asteroid thousands of times over; here, far less.
- **The stars aren't rows.** The sky behind the belt is real, each star in its true direction (ESA's Gaia), but it's a backdrop: only the asteroids are in the table. The star sample has nothing brighter than magnitude 1.7, so Sirius and the few stars like it are missing.
- **The marker isn't an asteroid.** Pick a gap and a white dot in a ring is dropped on an orbit made up for it: the gap's size, a stretch of 0.25, and exactly in step with Jupiter, so its path seen from the turning view closes into a loop. It's white, the page calls it "the marker", and no count includes it. It shows where such an orbit keeps meeting Jupiter; it isn't pulled out of place the way a real asteroid there would be.
- **Riding with Jupiter, two families are brightened.** The Hildas (8,400) and the Trojans (16,472) are a sliver of 1.58 million dots, so in that view they're drawn three and two times as bright and the rest of the belt dimmed, and the page says so. The stars are left out of it: turned with the view they'd wheel around the screen.
- **The Sun and Jupiter are drawn far too big,** and the Sun's glow is for show.
- **Seven rows have no dot.** They're passing through the solar system on paths that never close, and the page counts them apart. Their two distance cells are empty.
- **The two moving columns are computed, not fetched.** `sun_au` and `jupiter_au` come from where each asteroid's orbit puts it on the date shown, and Jupiter's puts it: they're as good as the places are (above).
- **Not every "asteroid" is in the belt.** The catalog is JPL's whole list of small bodies with an asteroid's designation, so sorting by diameter puts bodies from beyond Neptune among the biggest (Varuna is second), far outside the picture's belt.

## Canvas tradeoffs

Kirkwood is two canvases: the scene (WebGL) and, over it, the interface and the table (GPUI). Drawing to a canvas gives up things a page does for free. Where Kirkwood stands on each, and what it does about it:

- **Accessibility: a screen reader finds nothing.** Neither canvas has an accessibility tree, so the picture, the title's lines, the actions, and the table's rows are all silent, and the names the page places over the scene (the Sun's, Jupiter's, a group's) are hidden from it too: alone, they'd be names with nothing to name. *What it does:* nothing yet beyond the page's title and description. Kirkwood is a picture first, and a reader who can't see it gets the table through [Tycho's](../tycho/) asteroid sample no better. *To close it:* a hidden DOM mirror of the lines, the actions, and the table's visible rows (the table's own: [its README](../../components/tall-table/README.md#canvas-tradeoffs)).
- **Color carries the data.** A dot's color is its orbit size and a gray dot is outside the picked group; nothing else on the dot says either. The ramp's five colors are near one lightness, so a reader who can't tell its hues apart can't read orbit size off a dot in space. *What it does:* the legend names the ramp's ends in au, "Sort by orbit size" puts the same number on an axis, where a dot's place says it, and a group's rows are counted in words and listed in the table, each with its `a`.
- **Text selection and copy: none.** No text on the page can be selected, and the table doesn't copy: its `copy` feature isn't built in. *What it does:* a pressed row is found in the scene by name, and every row is in JPL's own database under the same designation. *To close it:* build the table's `copy` in (whole cells, rows, and columns, as tab-separated values).
- **Find-in-page sees almost nothing.** The browser's find reaches only the few names the page places over the scene; no row, title line, or card. *What it does:* "Find Ceres" for the first row, a press on any row, a click on any dot, and a sort by a number column to bring the biggest or brightest to the top. There is no search by name yet (`PLAN.md`, long-term goals).
- **The keyboard: every camera move, and the table's rows; not the actions.** The arrows, + and −, H, and ? move the camera and open the list of controls; Escape shuts the list and leaves the group's drawing; with the table open, its keys walk and page its rows, and the camera flies to each. *What it gives up:* the four actions, the time control, a gap's label, the table's handle and its sort arrows, and the resolution's steps need a pointer.
- **Motion isn't reduced.** The camera's flights, the dots' sort, and the turning view run as they are whatever the system's "reduce motion" says (only the phone's page honors it). Time can be paused, and nothing flies unless an action is pressed.
- **The bytes it ships.** Before anything is drawn: the page's script (28 KiB), the wasm (2.75 MiB), and the one font (69 KiB), each as brotli, where a page of HTML would paint with none of them. After the first frame: the scene's module (123 KiB) and the data, 51.3 MB as brotli (97 MB once unpacked: every asteroid's orbit, every row's cells, and the stars), streamed in and held in memory, since every dot is a row. Nothing is fetched as it's needed and nothing is paged: a visitor on a metered link pays for all of it, and the page shows what has arrived while it does.

What a canvas costs the controls:

- **Nothing can be tabbed to.** The compass, the ? button, the list of controls, and the four actions are drawn, not elements: Tab doesn't reach them (the keyboard, above).
- **The keys work while the page has the keyboard.** A click in the address bar or another frame takes it; a click on the page gives it back. With Ctrl, Alt, or Cmd held, a key is left to the browser, so its own zoom still works.
- **Touch is built by hand, and is coarser than a mouse.** A canvas gets none of a page's own gestures, so each is written: one finger, a pinch, a twist, a tilt, a tap, a double tap. A tap picks the dot within 6 px of it, a mouse's reach, which a fingertip covers many times over in the dense belt; drawing a group works with one finger. There is no long press, and nothing is hovered.
- **Safari's trackpad pinch is answered apart.** Safari tells a pinch in events of its own, which the page listens for; the other browsers send a wheel.
- **A phone gets pictures, not the app.** On a window under 600 px either way whose pointer is a finger, the page shows pictures of the app, says it's built for a larger screen, offers to send the link on, and downloads nothing of the app unless "Open it anyway" is pressed (55 MB then, every row held in memory, the controls laid out for a wide window).
- **The scene can lose its graphics.** A browser may take a WebGL context back (a GPU reset, too many tabs, a long sleep). The page says so in the count's place, and when the browser gives one back every dot is drawn again from the rows it still holds; if it never does, the page says to reload.
- **The hint's fold and the scene's resolution are kept in this browser's storage** for the site, a word and a number; where storage is off, the hint is whole and the resolution full on every visit.

## Credits

On the page, the same three are at the foot of the list the ? button opens (and of the phone's page).

- **Asteroids:** NASA/JPL Small-Body Database, fetched 2026-11-11. Jupiter's orbit: NASA/JPL Horizons.
- **Stars:** This work has made use of data from the European Space Agency (ESA) mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC).

## For contributors

Run it: build the data files once ([`docs/data.md`](docs/data.md), "Commands": the fetch, then prep, then `just kirkwood gaia`, the Gaia sample and the sky's file from it), then `just kirkwood dev` from the repo root. What's next: [`PLAN.md`](PLAN.md). Why it's built this way: [`docs/DECISIONS.md`](docs/DECISIONS.md) and the research, [`docs/research/asteroid-belt.md`](../../docs/research/asteroid-belt.md).
