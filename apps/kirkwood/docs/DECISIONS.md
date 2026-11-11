# Decisions: Kirkwood

Why Kirkwood is built the way it is. Decisions that bind every app, and the ones that made Kirkwood a showcase and gave it its home, are in the root [`docs/DECISIONS.md`](../../../docs/DECISIONS.md) ("Repo structure", "Hosting").

One bullet per decision, under its area, oldest first: what was chosen, what chose it, and *[where it came from]* (the research, the storyboard's review, a milestone). A decision that replaces another marks the old one *Superseded* rather than deleting it. The research's reasoning is in [`docs/research/asteroid-belt.md`](../../../docs/research/asteroid-belt.md); the storyboard is [the canvas](https://claude.ai/artifact/Vpx3w9Jb6EAW5RFJbLKKoi).

## Scene

- **2026-11-10** · **The table links to the scene four ways:** a row flies the camera to its asteroid; a dot or a drawn group filters the table to its rows (a filter, not a jump: a group's rows are scattered through the file); columns computed from the orbit change as time runs; and "Sort by orbit size" flies the dots from space into a against e. A selection is a set of rows, not a region: its asteroids stay picked as they drift apart. *[Research]*
- **2026-11-10** · **Kepler orbits for the whole belt, a real integration for the Hildas and Trojans only.** N-body over 1.57 M bodies isn't feasible in a tab, and the gaps took millions of years to form, so they aren't shown forming. Over decades either side of the elements' epoch a Kepler orbit looks the same as an integration; the resonant groups are thousands of particles under the Sun and Jupiter, small enough to integrate, and they're where Jupiter's pull is the story. *[Research]*
- **2026-11-10** · **The asteroids only, not Gaia.** A map of the 25 M stars would be 16 times the points, a table that can't live in memory, and nothing that moves. *[Research]*
- **2026-11-10** · **No tour on load.** The scene fills the window and the table is summoned. A visitor opts in through one-press actions ("Sort by orbit size", "Ride with Jupiter", "Find Ceres"), a row of buttons beside the time control. *[Research; storyboard review]*
- **2026-11-10** · **A drawn group is flown in to.** The shape is freehand and picks everything under it through the scene's depth; time pauses while it's drawn. When it closes, the camera flies in until the group fills the scene, and its biggest bodies get a name and diameter. Chosen from three drawn alternatives over staying at the belt's scale and over drawing from the tilted on-load camera: the zoom gives the moment action and focus. *[Storyboard review, board 6's alternatives]*

## Look

- **2026-11-10** · **Color is orbit size.** Every dot is tinted by its own a: rose at the inner edge (1.6 au), pale gold (2.7), blue (3.2), violet at the Hildas (3.97), green at the Trojans (5.2), with dense dust washing toward white. In space it reads as rings, warm inside and blue outside; landed in a against e the colors stand in order, and the Hildas and Trojans tell apart without extra brightness. Chosen over the first drawing's uncolored dust (brightness alone) as more pleasant to look at. The ramp's exact colors are the storyboard's stand-ins (its color note, in oklch) until the scene is built. Weighed: color by class (about 88% of the rows are one class, so the belt stays one color) and by albedo or diameter (expected empty for most rows). *[Storyboard review]*
- **2026-11-10** · **White is for what the interface adds, and gray for what isn't picked.** A drawn shape's outline, a marker, and its path are white, since any accent hue clashes with the ramp somewhere along it (cyan against the outer belt, amber against the inner). Around a picked group the rest of the belt loses its color, so color also means picked. *[Storyboard review]*
- **2026-11-10** · **The belt is glowing dust, not rocks, and the page says its dots are exaggerated.** At true scale an asteroid is an invisible speck millions of kilometers from the next. *[Research]*

## Table

- **2026-11-10** · **The table comes in as a panel on the scene's right, behind a handle on the right edge that carries the row count.** Weighed: the table as a layer under the scene's canvas that toggles front and back, which stays the fallback if GPUI can't draw over the scene. *[Storyboard review; M0 A1 confirms or replaces it]*
- **2026-11-10** · **Live cells are for a person to read.** Which columns are live and how often they refresh waits on the spike, under one constraint: a cell never changes faster than someone can follow. *[Storyboard review; M0 B3]*

## Planning

- **2026-11-10** · **The plan is written before the spike, and the spike is its first milestone.** The research put the plan last, after a throwaway spike and the sizing of the rows. The storyboard's review settled enough (the look, the table's place, what a drawn group does, the home) to plan the app now, so the spike and the sizing became M0, and each later milestone builds named boards. *[Owner, after the storyboard review]*
