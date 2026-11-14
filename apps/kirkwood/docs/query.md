# The page's query

The flags and knobs Kirkwood reads from its URL's query, for the checks and for looking. Each works in `just kirkwood dev` and in a release build.

## The crate's

A flag the crate can't read falls back to its default without a word: check what it shows.

- `?date=YYYY-MM-DD`: where the clock starts; `?paused` holds it (`crate/src/web.rs`).
- `?perf` for the table's probes, with `?probe-cells` its drawn cells (`host.rs`); it also opens `seiza`'s perf panel over the scene.
- `?live=<a second>`: the live columns' rate; `?liveDecimals=<0 to 3>`: a moving cell's decimals. Both for looking.
- `?glass=<0 to 1>`: what's left of the table's panel's fill, 0.2 as it ships (`host.rs`, `GLASS_FILL`); at 1 it is opaque, and the scene blurs nothing behind it. Chosen by the owner's eye (`docs/DECISIONS.md`, "Table").
- `?fly=0`: a group picked leaves the camera and the panel as they are. For the checks.

## The scene's

Read in `web/src/knobs.ts`; `scene.ts` and `look.ts` say what each does. A knob that isn't a number is the page's error, never a default taken without a word.

- **Held states:** `?flight=<0 to 1>` holds the sort flight partway, `?ride=<0 to 1>` the ride with Jupiter, and with `?ride=1`, `?gap=<0 to 3>` a gap held picked (the 3:1, 5:2, 7:3, 2:1). `?integrate=0` leaves the Hildas and the Trojans on their 2026 ellipses, for the checks to set the integration against.
- **The camera:** `?az`, `?elev`, `?roll` (degrees), `?dist` (au), `?at=<x>,<y>` (what it looks at, on the ecliptic, au).
- **Resolution:** `?scale` (the scene's pixels for each of the display's).
- **Rows alone:** `?only=<row>,<row>` draws those rows alone, as plain discs `?size` CSS px across, with no Sun, Jupiter, sky, haze, or bloom; `?hard=0` draws them as the belt's dots are.
- **Lines and bands:** `?marks` (lines from the Sun toward Jupiter, 60° either side of it, and opposite); `?band=<au>,<au>` (the orbit sizes that stay lit, `?bandGain` times as bright); `?alpha` (a dot's opacity).
- **The look, part by part:** `?sky=0`, `?haze=0`, `?bloom=0`, `?scrim=0`, and `?bloomScale` (the bloom's resolution, of the buffer's).
- **Chosen, and left for looking:** `?markerE` (the marker's eccentricity, 0.25), `?markerDim` (the opacity a picked gap leaves the belt, of what the ride leaves it, 0.6), `?glide` (the glide's time constant, ms; 220), `?gray` (what a drawn group leaves of a gray dot's opacity; 0.5), and `?glassBlur` (the blur behind the glass panel, CSS px; 8; `?glass` is the crate's, above).
- **Not yet chosen by eye:** `?found` (how far from a found row the camera's flight ends, au; 2) and `?rideSky=<0 to 1>` (how much of the sky the frame that turns with Jupiter keeps, turning with it; none as it ships, and the page's sentence about the stars doesn't follow the knob).
