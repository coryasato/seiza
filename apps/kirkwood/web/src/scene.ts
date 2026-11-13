// The scene: the belt as one draw of points, each row's orbit solved in the
// vertex shader from its six elements, which the crate holds (its
// attributes are filled from views over the elements' blocks in the wasm's
// memory, a block at a time as the file arrives, so the upload to the GPU
// is the only copy). With it, what the scene adds
// that isn't a row, and plainly isn't a dot: the Sun, Jupiter on its own
// orbit (the crate's, not a row's), that orbit as a line, and their names.
//
// On a canvas of its own under GPUI's, loaded after GPUI's first frame. It
// draws only when something changed: the clock, the camera, the panel's
// width, the window.
//
// The camera is a map's, and a hand's (`camera.ts`): a drag pans along the
// ecliptic, a wheel zooms toward the pointer, a drag let go moving glides
// to rest, a drag with Shift held tilts and turns, and a double
// click zooms in. Riding with Jupiter the hand has a camera of the ride's
// own, in the frame that turns. The interface hands each input over; this
// canvas hears nothing.
//
// A dot's color is its orbit size, through the crate's ramp, and its
// brightness and size come from its H as the eye would see it; all of it is
// drawn in linear light through the look's passes (`look.ts`), with the sky
// behind (`sky.ts`). Why each part: `docs/DECISIONS.md`, "Look".
//
// "Sort by orbit size" is the shader's too (`FLIGHT`): the crate holds the
// flight's progress, and each dot is placed between where it is in space
// and where its a and e put it on the crate's axes, the inner belt leaving
// first. No buffer is rewritten. What isn't a row (the sky, the Sun,
// Jupiter, its orbit, their names) leaves the picture on the way and
// returns with the dots; landed, nothing moves and nothing is drawn.
//
// "Ride with Jupiter" is the camera's: the crate holds how far the frame
// has turned to Jupiter's, and the camera flies by it from where it was to
// straight above, turned about the ecliptic's pole so that Jupiter stays
// to its right. One angle, the camera's: every dot, the Sun, and Jupiter's
// orbit turn as one, and no buffer is rewritten. The sky leaves the
// picture; the two groups in step with Jupiter (the Hildas, the Trojans)
// are lit, by their a and e, and the rest of the belt dimmed; and the
// ride's names and its dashed triangle, the page's own between the two
// canvases, are placed through the camera on the crate's three points.
//
// The Hildas and the Trojans are moved for real: the crate integrates them
// under the Sun and Jupiter (`crate/src/integrate.rs`), and their rows are
// a draw of their own, each placed where the crate has it (a buffer of
// places uploaded when the clock moves) and otherwise drawn as any row is,
// by its a, e, and H; the belt's draw leaves those rows out. Until their
// places are in (the clock jumped), they're on their ellipses with the
// rest. `?integrate=0` leaves them there.
//
// A row found (the table's selected row, the crate's to say) is marked on
// its dot, a white ring and the row's name, the page's own as the names
// are; and the fixed frame's camera flies to it, a flight of the hand's
// own, and then follows it as time runs: a zoom, a tilt, and a turn go
// round the row, and a pan or the way home lets it go, the mark staying.
//
// A group drawn (the lasso's mode, the crate's): the shape's outline is
// drawn here as the interface hands its points over, white and dashed, the
// page's own as the marker's path is; closed around a group it's kept on
// the ecliptic, where each of its points' rays met it, so it stays round
// its dots under a camera a hand moves, with a chip that counts the
// group's rows. The group's dots keep their color and every other dot
// goes gray, by a byte a row the crate picked. The outline and the chip
// show only on the clock's years the shape was drawn on: the group is a
// set of rows, and once time runs its dots leave the shape.
//
// For the checks and for looking (the page's query): the camera, `?az`,
// `?elev`, `?roll` (degrees), `?dist` (au), `?at=<x>,<y>` (what it looks
// at, on the ecliptic, au); `?scale` (the scene's pixels for each of the
// display's), and `?glide` (the glide's time constant, ms); `?only=<row>,<row>` (those rows alone, as plain discs
// `?size` CSS px across, with no Sun, Jupiter, sky, haze, or bloom;
// `?hard=0` draws them as the belt's dots are); `?marks` (lines from the
// Sun toward Jupiter, 60° either side of it, and opposite);
// `?band=<au>,<au>` (the orbit sizes that stay lit, `?bandGain` times as
// bright, the rest dimmed); `?alpha` (a dot's opacity); `?sky=0` (no
// stars); and the look's own (`look.ts`).
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, GLBufferAttribute, LineBasicMaterial, LineLoop, LineSegments, Matrix4, Mesh, NormalBlending, PerspectiveCamera, PlaneGeometry, Points, Quaternion, Scene, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderer, type NormalOrGLBufferAttributes } from 'three';
import { FOUND, GLIDE, REACH, SHIFT, ZOOM, aimedAt, createHand, type Place, type View } from './camera.ts';
import { has, knob, numbers, on, text } from './knobs.ts';
import { createLook } from './look.ts';
import { PROFILE, createSky, type Sky } from './sky.ts';

/** What the scene asks of the crate, which owns the clock, the panel, and
 *  Jupiter's orbit. */
export interface SceneHost {
  /** The clock, moved on to `now` (the page clock): years since the
   *  elements' epoch, a year being one turn of a 1 au orbit. */
  years(now: number): number;
  /** The panel's width on screen (CSS px). */
  inset(): number;
  /** Where Jupiter is, `years` after the epoch: ecliptic x, y, z in au. */
  jupiter(years: number): ArrayLike<number>;
  /** Jupiter's orbit, one turn: x, y, z of each place. */
  jupiterOrbit(): Float32Array;
  /** A dot's color by its orbit size: for each stop its a (au), then its
   *  red, green, and blue in linear light. The legend's own table. */
  ramp(): Float32Array;
  /** Where the page's text lies over the scene: left, top, width, height
   *  (CSS px); and a count that moves when they do, so they're asked for
   *  only then. */
  scrim(): ArrayLike<number>;
  scrimChanges(): number;
  /** The sort flight, moved on to `now`: 0 in space, 1 landed in a
   *  against e. */
  flight(now: number): number;
  /** How much of what isn't a row is left in the picture: 1 in space, 0
   *  with the dots landed. */
  space(): number;
  /** The axes the dots land on: the least a and the most (au), the least
   *  e and the most. */
  axes(): ArrayLike<number>;
  /** Where the axes are in a window (CSS px), in what the panel leaves,
   *  in clip space: the x of the least a and the y of the least e, then
   *  those of the most. */
  plot(width: number, height: number): ArrayLike<number>;
  /** `?flight`: holds the flight at a progress, 0 to 1. */
  holdFlight(progress: number): void;
  /** The ride with Jupiter, moved on to `now`: how far the frame has
   *  turned to Jupiter's, 0 fixed with the camera where it was, 1 turning
   *  with Jupiter from straight above. */
  ride(now: number): number;
  /** How much of the sky is left in the picture: none with the dots
   *  landed, and none in the frame that turns with Jupiter. */
  sky(): number;
  /** The three points in step with Jupiter, `years` after the epoch: 60°
   *  ahead of it, 60° behind, and opposite, at its own orbit size (the
   *  ecliptic's x, y, z of each, au). */
  ridePoints(years: number): ArrayLike<number>;
  /** The two groups the ride lights: the Hildas' least orbit size and
   *  most (au), the Trojans' least and most, and the Trojans' most e. */
  rideGroups(): ArrayLike<number>;
  /** `?ride`: holds the ride at a progress, 0 to 1. */
  holdRide(progress: number): void;
  /** A picked gap, moved on to `now`: how much of the ride's own names,
   *  triangle, and light it has taken away, 0 with no gap and 1 by the
   *  time half of one is there. Asked after `ride`. */
  gap(now: number): number;
  /** How much of the marker, its path, and the dim under them is drawn:
   *  as the ride's light comes in, and only in space. */
  gapLit(): number;
  /** The gap the marker is at: 0 to 3, in the order of the sort's chips. */
  gapMarker(): number;
  /** Where a gap's marker is, `years` after the epoch: ecliptic x, y, z
   *  in au. */
  gapPlace(gap: number, years: number): ArrayLike<number>;
  /** A gap's marker's path in the frame that turns with Jupiter, a
   *  closed curve: the x (along Jupiter's line) and y of each place, au. */
  gapPath(gap: number): Float32Array;
  /** `?gap`: holds a gap picked. `?markerE`: the marker's eccentricity. */
  holdGap(gap: number): void;
  markerE(e: number): void;
  /** The rows the crate's integration moves (the Hildas and the Trojans),
   *  in the file's order; none until the elements are held whole. */
  integratedRows(): Uint32Array;
  /** What those rows are drawn by, beside their places: each row's a,
   *  then each row's e, node, argument of perihelion, and H. */
  integratedColumns(): Float32Array;
  /** Those rows moved to `years`: where their places are in the crate's
   *  memory (x, y, z of each, au), or 0 while they aren't there yet (a
   *  jump of the clock is caught up a few milliseconds a call). With
   *  `draw` false they're stepped and no place is worked out. */
  integrated(years: number, draw: boolean): number;
  /** The row found, which the scene marks and flies to: its row, or -1
   *  with none (or one with no dot); how many times a row has been found
   *  (a flight for each); where the marked row is, `years` after the epoch
   *  (the ecliptic's x, y, z, au; empty with none), as the scene draws it:
   *  with `integrated`, a Hilda or a Trojan where the integration has it
   *  this frame, and without, on its ellipse; and its name. */
  found(): number;
  finds(): number;
  foundPlace(years: number, integrated: boolean): ArrayLike<number>;
  foundName(): string;
  /** A drawn group's work, a frame's worth (the crate places the rows
   *  while a shape is drawn, and tests them against it once it's closed);
   *  returns a count that moves when the group, or a release's fate, has
   *  changed. Then the group, asked for when it has: its closed shape as
   *  drawn (x and y of each point, window positions), the clock's years it
   *  was drawn on, what its chip says, and, asked last, where its bytes
   *  are in the crate's memory (one a row of the file, 1 in the group), or
   *  0 with no group. */
  pick(): number;
  groupShape(): Float32Array;
  groupYears(): number;
  groupChip(): string;
  groupBytes(): number;
  /** The camera as this frame drew it, for the interface's compass: how
   *  far it stands round from where it opened and its tilt from straight
   *  down (degrees; riding, the ride's own camera's, and between the two
   *  on the way), and whether a hand has moved a camera yet. Told when one
   *  of them changed, from a frame of the scene's own, never from a call
   *  the crate made. */
  cameraSeen(turned: number, tilt: number, moved: boolean): void;
  /** A view over `count` 32-bit floats of the crate's memory at `at`:
   *  good until that memory next grows, so it's made and uploaded with no
   *  call to the crate between. */
  floats(at: number, count: number): Float32Array;
  /** The same over `count` bytes. */
  bytes(at: number, count: number): Uint8Array;
}

export interface SceneStats {
  /** Frames drawn. */
  frames: number;
  /** The clock's years in the last frame drawn. */
  years: number;
  /** The rows the scene has been given so far; 0 until the first block. */
  rows: number;
  /** The points it draws them as: every one of those rows (a row with no
   *  ellipse is turned away in the shader), or those of `?only`'s. */
  points: number;
  /** The sky's stars; 0 until they're in. */
  stars: number;
  renderer: string;
  /** The camera's distance from what it looks at, au. */
  distance: number;
  /** The fixed frame's camera, a hand's to move, as last drawn: what it
   *  looks at (the ecliptic's x and y, au), its distance (au), its tilt
   *  from straight down, its bearing, and its roll (degrees). */
  camera: View;
  /** The ride's own camera, a hand's to move while riding: the same
   *  numbers in the frame that turns with Jupiter (x along Jupiter's line
   *  from the Sun). As the ride opens until a hand moves it, and again
   *  once the camera is back in the fixed frame. */
  riding: View;
  /** Whether the camera is moving on its own: gliding, let go moving or
   *  from a key; on a zoom's way; or on its flight home. */
  gliding: boolean;
  /** The row marked in the last frame drawn, or -1; and what the camera
   *  is doing about it: `waiting` to fly there (the dots are on their way
   *  back from the axes, or the frame is still turning), `flying` there,
   *  `following` it as time runs, or nothing (no row, or a hand took the
   *  camera or let the row go). */
  found: number;
  chase: 'waiting' | 'flying' | 'following' | '';
  /** The finds the camera has acted on: the crate's count, as of the last tick. */
  finds: number;
  /** A drawn group: its rows as the scene was handed them (0 with none),
   *  and how much of the gray is in, 0 to 1. */
  group: number;
  grayed: number;
  /** The sort flight in the last frame drawn: 0 in space, 1 landed. */
  flight: number;
  /** How far the frame had turned to Jupiter's in the last frame drawn. */
  ride: number;
  /** The rows drawn where the crate's integration has them, in the last
   *  frame drawn; 0 while they're on their ellipses with the rest. */
  integrated: number;
  /** Whether those rows were still on their way to the clock in the last
   *  frame drawn (it jumped: a few steps are taken a frame). */
  catchingUp: boolean;
}

export interface BeltScene {
  /** Room on the GPU for the belt's `rows` rows, none of them drawn yet. */
  setBelt(rows: number): void;
  /** The belt's next rows, a block of the elements file at a time, in the
   *  file's order. `blocks` makes, for each block, views over its seven
   *  columns where the crate holds them (a, e, i, the node, the argument
   *  of perihelion, the mean anomaly, in au and degrees, and H); they're
   *  uploaded to the GPU before this returns and not read again, since
   *  the wasm's memory growing detaches them. `through` is the rows drawn
   *  once they're in. Drawn in the next frame, or before this returns
   *  when `now` (so a mark set after it is of those rows on screen). */
  addRows(blocks: () => Float32Array[][], through: number, now: boolean): void;
  /** No belt: the rows drawn so far are dropped and their room on the GPU
   *  let go (their file stopped short, or a block couldn't be drawn). */
  clearBelt(): void;
  /** Whether the scene draws a sky: never beside rows drawn alone, or at
   *  `?sky=0`. Asked before its file is. */
  wantsSky: boolean;
  /** The sky: the bytes of data/stars.bin, drawn before this returns. */
  setSky(file: ArrayBuffer): void;
  /** Where a window position's ray meets the ecliptic: its x and y, au. */
  under(x: number, y: number): [number, number] | undefined;
  /** A wheel over the scene, at a window position, with the modifiers
   *  held (1 Ctrl, 2 Shift, 4 Alt, 8 the platform's): zooms toward the
   *  pointer; with Ctrl, as a trackpad's pinch. `frame` is whose camera it
   *  moves: 0 the fixed frame's, 1 the ride's own, in the frame that turns
   *  with Jupiter. (The interface says which, from the crate's own state,
   *  and hands no input over while the dots are out of space or the camera
   *  flies between the two.) */
  wheel(x: number, y: number, delta: number, modifiers: number, frame: number): void;
  /** A press anywhere in the window: a camera moving on its own stops. */
  press(): void;
  /** A drag on the scene, at window positions: its start (the button: 0
   *  the left, 1 the middle, 2 the right; the modifiers; the frame, as a
   *  wheel's), its moves, its end. The left button's pans along the
   *  ecliptic, and let go moving the camera glides; with Shift
   *  held it tilts and turns about what the camera looks at. */
  dragStart(x: number, y: number, button: number, modifiers: number, frame: number): void;
  dragMove(x: number, y: number): void;
  dragEnd(x: number, y: number): void;
  /** A double click on the scene: nearer, toward the pointer. */
  doubleClick(x: number, y: number, frame: number): void;
  /** An arrow key, for a frame's camera: it slides along the ecliptic,
   *  `right` and `up` each -1, 0, or 1 as the window has them. The + and −
   *  keys: nearer or farther. And the way home, the compass's press and
   *  the H key: the fixed frame's camera flies to where it opened, the
   *  ride's own to where the ride opens. */
  nudge(right: number, up: number, frame: number): void;
  zoomStep(nearer: boolean, frame: number): void;
  home(frame: number): void;
  /** A shape drawn in the lasso's mode, at window positions: its start,
   *  its next point, and its release: `closed`, the outline closes and
   *  waits for its rows; not, it's gone. */
  drawStart(x: number, y: number): void;
  drawMove(x: number, y: number): void;
  drawEnd(closed: boolean): void;
  /** The shape's outline as drawn: the x and y of each point (CSS px;
   *  NaN where one has no place on screen), and whether it's closed;
   *  nothing while none is drawn. */
  outline(): { points: number[]; closed: boolean } | undefined;
  /** Projection × view (column-major), then the window's width and height. */
  viewProjection(): number[];
  /** The names the scene draws, and where (CSS px). */
  labels(): { text: string; left: number; top: number; width: number; height: number; shown: boolean }[];
  /** The ride's dashed triangle as drawn: the x and y of its three
   *  corners (CSS px); nothing while it isn't drawn. */
  triangle(): number[] | undefined;
  /** A picked gap's marker as drawn: where it is, and its path's places
   *  in order (x and y of each, CSS px); nothing while it isn't drawn. */
  marker(): { x: number; y: number; path: number[] } | undefined;
  /** A found row's mark as drawn: where its ring is (CSS px); nothing
   *  while it isn't drawn. Its name is among `labels`. */
  found(): { x: number; y: number } | undefined;
  stats: SceneStats;
}

/** The belt's attributes, in the order of a block's columns. */
const COLUMNS = ['a', 'e', 'inc', 'node', 'peri', 'mean', 'mag'];

/** The most steps the shader takes on Kepler's equation. The crate's tests
 *  run this shader's arithmetic in 32-bit floats against its own 64-bit
 *  place for every row (`crate/src/shader.rs`): change them together. */
const STEPS = 32;

/** A row's place from its elements: the ecliptic's x, y, z in au. */
const PLACE = /* glsl */ `
  // The clock: whole years since the epoch, and the rest of a year.
  uniform vec2 uYears;
  attribute float a;
  attribute float e;
  attribute float inc;
  attribute float node;
  attribute float peri;
  attribute float mean;
  const float HALF_TURN = 3.141592653589793;
  const float TURN = 6.283185307179586;

  // Kepler's equation, E - e sin E = M, for M from a half turn back to a
  // half turn on: Newton's steps, each kept inside the bracket bisection
  // would use, from the half turn's side for a high e (where a start at M
  // overshoots, and six plain steps left rows au from their place), until
  // one moves it by nothing a float holds.
  float eccentricAnomaly(float M, float e) {
    float low = M < 0.0 ? -HALF_TURN : 0.0;
    float high = M < 0.0 ? 0.0 : HALF_TURN;
    float E = e < 0.8 ? M + e * sin(M) : (M < 0.0 ? -HALF_TURN : HALF_TURN);
    for (int step = 0; step < ${STEPS}; step++) {
      float off = E - e * sin(E) - M;
      if (off > 0.0) high = E;
      else low = E;
      float next = E - off / (1.0 - e * cos(E));
      if (!(next >= low && next <= high)) next = 0.5 * (low + high);
      float moved = abs(next - E);
      E = next;
      if (moved < 1e-7) break;
    }
    return E;
  }

  vec3 place() {
    // Turns a year: one in a^1.5 (Kepler's third law, a in au).
    float n = 1.0 / (a * sqrt(a));
    // The turns since the epoch, less the whole ones. A float holds 24
    // bits, so n is split in two and its product with the whole years is
    // exact: the turns thrown away never cost the part that's kept.
    float high = floor(n * 4096.0) / 4096.0;
    float low = n - high;
    float turned = fract(high * uYears.x) + low * uYears.x + n * uYears.y;
    float M = radians(mean) + TURN * turned;
    M -= TURN * floor(M / TURN + 0.5);
    float E = eccentricAnomaly(M, e);
    // In the orbit's own plane, x toward perihelion.
    float xo = a * (cos(E) - e);
    float yo = a * sqrt(1.0 - e * e) * sin(E);
    float co = cos(radians(node)), so = sin(radians(node));
    float cw = cos(radians(peri)), sw = sin(radians(peri));
    float ci = cos(radians(inc)), si = sin(radians(inc));
    return vec3(
      (co * cw - so * sw * ci) * xo + (-co * sw - so * cw * ci) * yo,
      (so * cw + co * sw * ci) * xo + (-so * sw + co * cw * ci) * yo,
      sw * si * xo + cw * si * yo
    );
  }
`;

/** A row the crate's integration moves: its place is handed over (the
 *  ecliptic's x, y, z in au), and its a, e, and angles are the file's,
 *  for everything else a dot is drawn by. */
const PLACE_INTEGRATED = /* glsl */ `
  attribute float a;
  attribute float e;
  attribute float node;
  attribute float peri;
  attribute vec3 placed;

  vec3 place() {
    return placed;
  }
`;
/** The integrated rows' attributes beside their places, in the order the
 *  crate hands their columns over. */
const INTEGRATED_COLUMNS = ['a', 'e', 'node', 'peri', 'mag'];

/** The sort flight: how late the outermost orbit leaves after the
 *  innermost, and how far a dot is off its neighbors', of the flight's
 *  whole; a dot's own flight is the rest. The crate's tests run this
 *  arithmetic in 32-bit floats against its own place on the axes for every
 *  row in view (`crate/src/shader.rs`): change them together. */
const STAGGER = { outer: 0.3, each: 0.1 };

/** A dot's flight from space to a against e. `flown(at)` takes the dot's
 *  place in clip space and returns it flown; `flownBy` is then how far
 *  along the dot is (0 in space, 1 landed) and `left` what's left of a dot
 *  with no place on the axes, which fades where it is. */
const FLIGHT = /* glsl */ `
  // The flight: 0 in space, 1 landed.
  uniform float uFlight;
  // The axes: the least a and the most, the least e and the most.
  uniform vec4 uAxes;
  // Where they are, in clip space: the least a and e, then the most.
  uniform vec4 uPlot;
  float flownBy;
  float left;

  vec4 flown(vec4 at) {
    flownBy = 0.0;
    left = 1.0;
    if (!(uFlight > 0.0)) return at;
    // The inner belt leaves first and the outer last, each dot a little
    // off its neighbors (by its own angles), so the columns build from
    // the left and the gaps open as the dots land.
    float along = (a - uAxes.x) / (uAxes.y - uAxes.x);
    float delay = ${STAGGER.outer.toFixed(2)} * clamp(along, 0.0, 1.0) + ${STAGGER.each.toFixed(2)} * fract(node * 0.1273 + peri * 0.0553);
    float t = clamp((uFlight - delay) / ${(1 - STAGGER.outer - STAGGER.each).toFixed(2)}, 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    // A row past the axes (its a or its e) has no place on them.
    if (!(a >= uAxes.x && a <= uAxes.y && e >= uAxes.z && e <= uAxes.w)) {
      left = 1.0 - t;
      return at;
    }
    flownBy = t;
    if (!(t > 0.0)) return at;
    vec2 plot = uPlot.xy + (uPlot.zw - uPlot.xy) * vec2(along, (e - uAxes.z) / (uAxes.w - uAxes.z));
    if (t >= 1.0) return vec4(plot, 0.0, 1.0);
    // A dot behind the camera has no place on screen: it comes in from
    // past the plot's edge.
    vec2 space = at.w > 0.0 ? at.xy / at.w : plot * 4.0;
    return vec4(space + (plot - space) * t, 0.0, 1.0);
  }
`;

/** The belt's dots, their tints through a ramp of `stops` stops; or, with
 *  `integrated`, the dots of the rows the crate's integration moves, the
 *  same but for where each is. Every color here is linear light, written
 *  as it is into the look's buffer. */
const vertex = (stops: number, integrated: boolean) => /* glsl */ `
  // A plain dot's size, in the scene's pixels.
  uniform float uSize;
  // What the camera's nearness makes of a dot in space: its size, and its
  // opacity. On the axes there is no camera: both are 1.
  uniform vec2 uNear;
  // A dot on the axes: its size and its opacity, of a plain dot's.
  uniform vec2 uLanded;
  // The page's band knob: the orbit sizes (au, x to y) that stay lit, w
  // times as bright; the rest z of a dot's opacity. No band at y 0.
  uniform vec4 uBand;
  // Color is orbit size: each stop's a, and its tint.
  uniform vec3 uRamp[${stops}];
  uniform float uStops[${stops}];
  // A row's H. The H a dot of the plain brightness and size has, then the
  // exponents of brightness and of size on the row's flux, and the most a
  // dot grows; the least brightness, so every row is drawn; and the
  // camera's distance from what it looks at.
  attribute float mag;
  uniform vec4 uMag;
  uniform float uLeast;
  uniform float uDistance;
  // The ride with Jupiter: how much of its light is on (0 to 1); the two
  // groups in step with it (the Hildas' least a and most, the Trojans',
  // and the Trojans' most e); and what the turned frame makes of a dot:
  // a Hilda's light, a Trojan's, and the opacity of the rest.
  uniform float uRide;
  uniform vec4 uGroups;
  uniform float uGroupsE;
  uniform vec3 uRideLight;
  // A gap picked, riding: how much of its marker shows (0 to 1), the
  // opacity that leaves the belt under it, and how much of the two
  // groups' light the gap has left (of uRide: the rest of it dims them
  // as the rest of the belt is).
  uniform vec3 uMarked;
  // 1 while those two groups' rows are drawn apart, from where the
  // crate's integration has them: the belt's own draw leaves them out.
  uniform float uIntegrated;
  // 1 for a row drawn alone as a plain disc: one size, one color.
  uniform float uHard;
  uniform vec3 uPlain;
  // A drawn group: 1 for a row in it; then how much of the gray is in (0
  // with no group, to 1), and what's left of a gray dot's opacity.
  attribute float picked;
  uniform vec2 uGroup;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vGrow;
  ${integrated ? PLACE_INTEGRATED : PLACE}
  ${FLIGHT}

  void main() {
    // The two groups in step with Jupiter, by their a and e.
    bool hilda = a >= uGroups.x && a <= uGroups.y;
    bool trojan = a > uGroups.z && a < uGroups.w && e < uGroupsE;
    // A row with no ellipse (e not below 1) has no place on one: no dot.
    // And none here for a row that's drawn apart.
    if (!(a > 0.0) || !(e < 1.0)${integrated ? '' : ' || (uIntegrated > 0.5 && (hilda || trojan))'}) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    vec3 at = place();
    // The ecliptic is the scene's xz plane.
    vec4 seen = projectionMatrix * modelViewMatrix * vec4(at.x, at.z, -at.y, 1.0);
    gl_Position = flown(seen);
    if (uHard > 0.5) {
      gl_PointSize = uSize;
      vColor = uPlain;
      vAlpha = left;
      vGrow = 1.0;
      return;
    }
    // A row with no H (NaN in the file, read by its bits: a comparison
    // with one is the compiler's to drop) is drawn at its faintest.
    bool none = (floatBitsToUint(mag) & 0x7fffffffu) > 0x7f800000u;
    float H = none ? 30.0 : min(mag, 30.0);
    // log10 of the row's flux over that of a row at uMag.x, as it would be
    // seen: H is a body's brightness 1 au from the Sun and from the eye,
    // and sunlight thins by the square of the distance out (set against
    // the main belt's 2.7 au) and again on the way to the eye (against the
    // camera's distance from what it looks at, so a zoom changes nothing).
    // Without it the far, large bodies outshine the belt.
    // On the axes there is no distance: a landed dot is lit as from its
    // orbit's own size, and seen from where the plain dot is.
    float sunward = max(0.3, mix(length(at), a, flownBy)) / 2.7;
    float eyeward = mix(max(0.05, seen.w) / uDistance, 1.0, flownBy);
    float flux = -0.4 * (H - uMag.x) - 2.0 * log(sunward * eyeward) / 2.302585;
    float gain = max(uLeast, pow(10.0, flux * uMag.y));
    vGrow = clamp(pow(10.0, flux * uMag.z), 1.0, uMag.w);
    vAlpha = left * mix(uNear.y, uLanded.y, flownBy);
    float banded = 1.0;
    if (uBand.y > 0.0) {
      bool lit = a >= uBand.x && a <= uBand.y;
      vAlpha *= lit ? 1.0 : uBand.z;
      banded = lit ? uBand.w : 1.0;
    }
    // In the frame that turns with Jupiter the two groups that hold their
    // shape there are lit, and the rest of the belt dimmed: a few
    // thousand dots among a million and a half don't show otherwise.
    // With a gap picked the whole belt is dimmed, under the marker's path.
    if (uRide > 0.0) {
      if (hilda || trojan) {
        banded *= mix(1.0, hilda ? uRideLight.x : uRideLight.y, uMarked.z);
        vAlpha *= mix(1.0, uRideLight.z, uRide - uMarked.z);
      } else vAlpha *= mix(1.0, uRideLight.z, uRide);
      vAlpha *= mix(1.0, uMarked.y, uMarked.x);
    }
    vec3 tint = uRamp[0];
    for (int k = 0; k < ${stops - 1}; k++) {
      tint = mix(tint, uRamp[k + 1], clamp((a - uStops[k]) / (uStops[k + 1] - uStops[k]), 0.0, 1.0));
    }
    // Color is data: a dot outside a drawn group has none, its tint's own
    // lightness in gray, and is dimmer.
    if (uGroup.x > 0.0 && picked < 0.5) {
      tint = mix(tint, vec3(dot(tint, vec3(0.2126, 0.7152, 0.0722))), uGroup.x);
      vAlpha *= mix(1.0, uGroup.y, uGroup.x);
    }
    gl_PointSize = uSize * mix(uNear.x, uLanded.x, flownBy) * vGrow * sqrt(banded);
    vColor = tint * gain * banded;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uAlpha;
  uniform float uHard;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vGrow;
  ${PROFILE}
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor, uAlpha * vAlpha * mix(profile(d, vGrow), 1.0, uHard));
  }
`;

/** A body that isn't a row: one round disc, opaque to its edge. */
const BODY_VERTEX = /* glsl */ `
  uniform float uSize;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
  }
`;
const BODY_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  // What's left of it as the dots leave space.
  uniform float uFade;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    gl_FragColor = vec4(uColor, (1.0 - d * d * d) * uFade);
  }
`;
/** The Sun: a small core far brighter than white (the bloom spreads it)
 *  inside a wide warm glow that falls off as the square of the distance
 *  and reaches nothing at the sprite's edge. Plainly not a dot, and
 *  plainly exaggerated. `uLight` is the core's light and the glow's.
 *
 *  A square that faces the camera, `uSize` of the scene's pixels across
 *  in a window `uWindow` of them, and not a point: a point is dropped
 *  whole once its center leaves the window, and is only as big as the GPU
 *  allows. */
const SUN_VERTEX = /* glsl */ `
  uniform float uSize;
  uniform vec2 uWindow;
  varying vec2 vAt;
  void main() {
    vAt = position.xy * 2.0;
    vec4 center = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    center.xy += vAt * uSize / uWindow * center.w;
    gl_Position = center;
  }
`;
const SUN_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec2 uLight;
  // What's left of it as the dots leave space.
  uniform float uFade;
  varying vec2 vAt;
  void main() {
    vec2 p = vAt;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float window = (1.0 - d) * (1.0 - d);
    vec3 light = vec3(1.0, 0.96, 0.9) * uLight.x * exp(-d * 1400.0) + uColor * uLight.y / (1.0 + d * 260.0);
    gl_FragColor = vec4(light * window * uFade, 1.0);
  }
`;

/** The page's background (`index.html`), which the look's floor tints the
 *  scene with: 0 to 1, the display's values. */
const PAGE: [number, number, number] = [5 / 255, 6 / 255, 10 / 255];
/** A row drawn alone, as a plain disc. */
const PLAIN = 0xdcd8d0;
/** A plain dot: its size (CSS px), and its opacity in the look's linear
 *  light, where much more would be most of the way to white on its own. */
const DOT = { px: 1.5, alpha: 0.016 };
/** A dot by its H: the H of a plain dot (the median), the exponents of
 *  brightness and of size on its flux, the most it grows, and the least
 *  brightness. */
const MAG = { plain: 17.7, bright: 0.45, grow: 0.2, most: 16, least: 0.4 };
/** A dot landed on the axes, of a plain dot: its size and its opacity.
 *  The same dot as in space, lit by its H as from its orbit's own size,
 *  with no haze (`docs/DECISIONS.md`, "Look"). */
const LANDED = { size: 1, alpha: 1 };
const FOV = 40;
/** The opening camera: it looks at the Sun from 13 au, 24° above the
 *  ecliptic, from ecliptic longitude 270° + `az` (at 0 it faces longitude
 *  90°), rolled 34° about its line of sight so the belt runs from the
 *  bottom left to the top right: a pose, which a hand's first tilt or turn
 *  eases out to a map's level horizon and the way home gives back
 *  (`docs/DECISIONS.md`, "Input"). The crate's test of the shader's
 *  arithmetic counts pixels from a copy of this camera and `FOV`
 *  (`crate/src/shader.rs`, `on_screen`): change them together. */
const OPENING = { az: 200, elev: 24, roll: -34, dist: 13 };
/** The camera that rides with Jupiter: straight above the Sun, 17 au up,
 *  where board 2 has Jupiter 379 px to the Sun's right in a window 900 px
 *  high; farther in a window too narrow for Jupiter at its farthest and
 *  `room` px beside it for its name. */
const RIDE = { dist: 17, room: 130 };
/** What the turned frame makes of a dot: a Hilda's light and a Trojan's,
 *  of a plain dot's (its size grows by the root of it), and the opacity
 *  of the rest of the belt (`docs/DECISIONS.md`, "Look"). */
const RIDE_LIGHT: [number, number, number] = [3, 2, 0.35];
/** The ride's names, from the point each is beside (CSS px), as board 2
 *  has them: the Trojans' right of their clouds, the one ahead above its
 *  point and the one behind below; the Hildas' two lines ending left of
 *  the corner opposite Jupiter, above it. */
const RIDE_NAMES = { ahead: [57, -29], behind: [57, 13], hildas: [-22, -54] } as const;
/** A picked gap's marker, as board 5 draws it, CSS px: a white dot in a
 *  ring, its name up and to its right, and its path's line; and the
 *  opacity that leaves the belt under them, of what the ride leaves it
 *  (`docs/DECISIONS.md`, "Look"). White is what the interface adds. */
const MARKER = { dot: 4, ring: 9, name: [16, -26], line: 1.5, dim: 0.6 } as const;
/** A found row's mark, CSS px: a white ring round its dot (no dot of its
 *  own: the dot is the row's), and the row's name up and to its right, as
 *  a gap's marker has its own. */
const FOUND_MARK = { ring: 10, line: 1.5, name: [16, -26] } as const;
/** A drawn shape's outline and its chip, as board 6 draws them, CSS px:
 *  the line and its dashes; the chip's height, how far over the shape's
 *  top it sits, and how far it keeps from the edges of what the panel
 *  leaves. The chip's border and fill are a gap's chip's (`host.rs`):
 *  neutral-700, oklch(0.371 0 0), and neutral-950, oklch(0.145 0 0). */
const OUTLINE = { line: 1.25, dash: '5 4', opacity: 0.85 } as const;
const CHIP = { height: 22, over: 12, keep: 8, border: '#404040', fill: '#0a0a0a' } as const;
/** What a drawn group makes of the rest: what's left of a gray dot's
 *  opacity and of the sky's stars (which gray dots would be taken for),
 *  and how long the gray takes to come and go, ms
 *  (`docs/DECISIONS.md`, "Look"). */
const GRAY = { alpha: 0.5, sky: 1 / 3, ms: 300 } as const;
/** What the interface adds to the scene (the ride's triangle, a picked
 *  gap's marker, its path, and its name; a found row's ring and name): white, neutral-50,
 *  oklch(0.985 0 0), the theme's foreground. */
const ADDED = '#fafafa';
/** The Sun's glow, CSS px across (its core is a twentieth of that), and
 *  how far under the Sun's place its name starts, clear of the glow's
 *  bright middle, as board 1 has it. */
const SUN_PX = 250;
const SUN_NAME_BELOW = 36;
/** Jupiter's disc, CSS px across, and its light: past white, so it blooms. */
const JUPITER_PX = 8;
const JUPITER_LIGHT = 1.8;

/** `?at=<x>,<y>`: what the camera looks at, on the ecliptic, au. */
function lookedAt(): [number, number] {
  const given = text('at');
  if (given === null) return [0, 0];
  const [x, y, ...more] = numbers(given);
  if (more.length || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`?at wants a place on the ecliptic, x and y in au; got "${given}"`);
  return [x!, y!];
}
/** `?band=<au>,<au>`: two orbit sizes, the smaller first. */
function band(): [number, number] {
  const given = text('band');
  if (given === null) return [0, 0];
  const [from, to, ...more] = numbers(given);
  if (more.length ||!(from! >= 0) || !(to! > from!) || !Number.isFinite(to)) throw new Error(`?band wants two orbit sizes in au, the smaller first; got "${given}"`);
  return [from!, to!];
}
/** `?only=<row>,<row>`: the rows drawn alone. */
function only(): number[] | undefined {
  const given = text('only');
  if (given === null) return undefined;
  const rows = numbers(given);
  if (!rows.length ||rows.some((row) => !Number.isInteger(row) || row < 0)) throw new Error(`?only wants rows, as whole numbers from 0; got "${given}"`);
  return rows;
}

/** A place in the ecliptic's axes, in the scene's: the ecliptic is its xz plane. */
const inScene = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];

export function startScene(canvas: HTMLCanvasElement, names: HTMLElement, host: SceneHost): BeltScene {
  /** The fixed frame's camera, a map's numbers: a hand's to move
   *  (`camera.ts`). Riding with Jupiter the camera is the ride's own
   *  (`rideView`, below), a hand's too until the camera is back. */
  const [lookedX, lookedY] = lookedAt();
  const view: View = { x: lookedX, y: lookedY, distance: knob('dist', OPENING.dist), tilt: 90 - knob('elev', OPENING.elev), bearing: knob('az', OPENING.az), roll: knob('roll', OPENING.roll) };
  /** Where it opened: the way home. */
  const opened: Place = { x: view.x, y: view.y, distance: view.distance, tilt: view.tilt, bearing: view.bearing, roll: view.roll };
  const scale = knob('scale', 1);
  const alone = only();
  // `?flight=<0 to 1>`: the sort flight held there, for a screenshot; and
  // `?ride=<0 to 1>`, the ride with Jupiter.
  if (has('flight')) host.holdFlight(knob('flight', 0));
  if (has('ride')) host.holdRide(knob('ride', 0));
  // `?gap=<0 to 3>`: that gap held picked (with `?ride=1`); `?markerE`,
  // to be looked at: the marker's eccentricity.
  if (has('markerE')) host.markerE(knob('markerE', 0));
  if (has('gap')) {
    const gap = knob('gap', 0);
    if (!Number.isInteger(gap) || gap < 0 || gap > 3) throw new Error(`?gap wants a gap, 0 to 3 (the 3:1, 5:2, 7:3, 2:1); got "${text('gap')}"`);
    host.holdGap(gap);
  }
  // `?rideSky=<0 to 1>`, to be looked at: how much of the sky the frame
  // that turns with Jupiter keeps (none, as it ships).
  const rideSky = Math.min(1, Math.max(0, knob('rideSky', 0)));
  // `?integrate=0`: the Hildas and the Trojans stay on their ellipses.
  const integrates = on('integrate');
  /** Rows drawn alone are plain discs, to be found in a screenshot. */
  const hard = !!alone && on('hard');
  const marked = has('marks');

  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const stats: SceneStats = { frames: 0, years: 0, rows: 0, points: 0, stars: 0, renderer: String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), distance: view.distance, camera: { ...view }, riding: { x: 0, y: 0, distance: RIDE.dist, tilt: 0, bearing: 0, roll: 0 }, gliding: false, found: -1, chase: '', finds: 0, group: 0, grayed: 0, flight: 0, ride: 0, integrated: 0, catchingUp: false };
  const look = createLook(renderer, PAGE, !!alone);

  // The dust is the rows and the sky; the bodies are what the scene adds.
  // The look draws them apart, so its haze is the dust's alone.
  const dust = new Scene();
  const bodies = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.01, 1000);
  let rideZoom = 1;
  /** The scene's pixels for each CSS pixel. */
  let pixelRatio = 1;
  /** Something changed that the next frame must draw. */
  let dirty = true;
  let sky: Sky | undefined;

  // What the scene adds: plainly not dots. None of it beside rows drawn alone.
  // Jupiter's orbit first, so the discs are drawn over it.
  const turn = host.jupiterOrbit();
  const orbit = new Float32Array(turn.length);
  /** Jupiter at its farthest from the Sun, au. */
  let farthest = 0;
  for (let at = 0; at < turn.length; at += 3) {
    orbit.set(inScene(turn[at]!, turn[at + 1]!, turn[at + 2]!), at);
    farthest = Math.max(farthest, Math.hypot(turn[at]!, turn[at + 1]!, turn[at + 2]!));
  }
  const orbitGeometry = new BufferGeometry();
  orbitGeometry.setAttribute('position', new BufferAttribute(orbit, 3));
  const orbitLine = new LineBasicMaterial({ color: 0x6a7594, transparent: true });
  bodies.add(new LineLoop(orbitGeometry, orbitLine));
  const sun = new Mesh(
    new PlaneGeometry(1, 1),
    new ShaderMaterial({
      vertexShader: SUN_VERTEX,
      fragmentShader: SUN_FRAGMENT,
      uniforms: { uSize: { value: 0 }, uWindow: { value: new Vector2(1, 1) }, uColor: { value: new Color(1, 0.74, 0.46) }, uLight: { value: new Vector2(30, 1.6) }, uFade: { value: 1 } },
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
    }),
  );
  sun.frustumCulled = false;
  // In this order whatever their depths (all three are transparent, which
  // Three.js would sort far to near: the line over a Jupiter on the far
  // side of its orbit).
  sun.renderOrder = 1;
  bodies.add(sun);
  const jupiter = new Points(
    new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(3), 3)),
    new ShaderMaterial({ vertexShader: BODY_VERTEX, fragmentShader: BODY_FRAGMENT, uniforms: { uSize: { value: 0 }, uColor: { value: new Color(0xd9b38c).multiplyScalar(JUPITER_LIGHT) }, uFade: { value: 1 } }, transparent: true, depthTest: false }),
  );
  jupiter.frustumCulled = false;
  jupiter.renderOrder = 2;
  bodies.add(jupiter);
  // `?marks`: white, as what the interface adds.
  const marks = marked ? new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xfafafa, transparent: true, opacity: 0.55, depthTest: false })) : undefined;
  if (marks) {
    marks.geometry.setAttribute('position', new BufferAttribute(new Float32Array(4 * 2 * 3), 3));
    marks.frustumCulled = false;
    bodies.add(marks);
  }
  // `?glass`, to be looked at: the page's element that blurs the scene
  // behind the table's panel, `?glassBlur` CSS px (the panel's own fill is
  // GPUI's, `host.rs`).
  const glass = has('glass') ? document.querySelector<HTMLElement>('#glass') : null;
  glass?.style.setProperty('--glass-blur', `${knob('glassBlur', 18)}px`);
  let glassWidth = 0;
  /** Nothing: what's drawn over rows drawn alone. */
  const none = new Scene();

  // Their names, in the page's own text between the two canvases: placed
  // in the frame that draws the bodies, so a name never trails its disc.
  const name = (text: string, lines: string[] = [text]) => {
    const label = document.createElement('div');
    lines.forEach((line, at) => {
      if (at) label.append(document.createElement('br'));
      label.append(line);
    });
    // Out of sight but laid out, so its size can be read.
    label.style.visibility = 'hidden';
    names.append(label);
    return { label, text, left: 0, top: 0, width: 0, height: 0, shown: false, opacity: 1 };
  };
  const sunName = name('Sol');
  const jupiterName = name('Jupiter');
  // Board 2's, in the frame that turns with Jupiter: Jupiter's name says
  // what the frame does, and the two groups in step with it are named.
  const heldName = name('Jupiter, held still');
  const aheadName = name('Trojans, 60° ahead of Jupiter');
  const behindName = name('Trojans, 60° behind');
  const hildasName = name('Hildas: a triangle that turns with Jupiter', ['Hildas: a triangle', 'that turns with Jupiter']);
  hildasName.label.style.textAlign = 'right';
  const rideNames = [heldName, aheadName, behindName, hildasName];
  // Board 5's, with a gap picked: the marker says what it is.
  const markerName = name('the marker');
  markerName.label.style.color = ADDED;
  // A found row's: the row's own name, from the rows file, set when it's found.
  const foundName = name('');
  foundName.label.style.color = ADDED;
  // A drawn group's chip: its rows, counted by the crate.
  const groupChip = name('');
  Object.assign(groupChip.label.style, { height: `${CHIP.height}px`, padding: '0 8px', display: 'flex', alignItems: 'center', boxSizing: 'border-box', border: `1px solid ${CHIP.border}`, borderRadius: '6px', background: CHIP.fill, color: ADDED, textShadow: 'none', fontVariantNumeric: 'tabular-nums' });
  const allNames = [sunName, jupiterName, ...rideNames, markerName, groupChip, foundName];
  // And its dashed triangle through the three points in step with
  // Jupiter: white, as what the interface adds.
  const SVG = 'http://www.w3.org/2000/svg';
  const triangle = document.createElementNS(SVG, 'svg');
  triangle.setAttribute('style', 'position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; visibility: hidden');
  const triangleLine = document.createElementNS(SVG, 'path');
  for (const [attribute, value] of [['fill', 'none'], ['stroke', ADDED], ['stroke-opacity', '0.5'], ['stroke-width', '1'], ['stroke-dasharray', '4 6']]) triangleLine.setAttribute(attribute!, value!);
  triangle.append(triangleLine);
  names.append(triangle);
  /** Its corners as drawn (CSS px), and whether it is. */
  let corners: number[] | undefined;
  let triangleShown = false;
  let triangleOpacity = 1;
  // A picked gap's marker and its path, white too: the path a closed
  // line, the marker a dot in a ring that moves along it.
  const marking = document.createElementNS(SVG, 'svg');
  marking.setAttribute('style', 'position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; visibility: hidden');
  const pathLine = document.createElementNS(SVG, 'path');
  for (const [attribute, value] of [['fill', 'none'], ['stroke', ADDED], ['stroke-opacity', '0.9'], ['stroke-width', String(MARKER.line)], ['stroke-linejoin', 'round']]) pathLine.setAttribute(attribute!, value!);
  const markerAt = document.createElementNS(SVG, 'g');
  const [markerRing, markerDot] = [document.createElementNS(SVG, 'circle'), document.createElementNS(SVG, 'circle')];
  for (const [attribute, value] of [['r', String(MARKER.ring)], ['fill', 'none'], ['stroke', ADDED], ['stroke-opacity', '0.5']]) markerRing.setAttribute(attribute!, value!);
  for (const [attribute, value] of [['r', String(MARKER.dot)], ['fill', ADDED]]) markerDot.setAttribute(attribute!, value!);
  markerAt.append(markerRing, markerDot);
  marking.append(pathLine, markerAt);
  names.append(marking);
  // The path comes and goes on its own, once the camera is riding.
  pathLine.style.transition = 'opacity 300ms';
  pathLine.style.opacity = '0';
  /** The marker as drawn: where it is and its path's places (CSS px; no
   *  places until the camera is riding); whether any of this, the marker,
   *  and the path show; the path's places as last written, and what for;
   *  and how much of it all shows. */
  let markerDrawn: { x: number; y: number; path: number[] } | undefined;
  let [markingShown, markerShown, pathShown] = [false, true, false];
  let pathDrawn: number[] = [];
  let pathFor = '';
  let markingOpacity = 1;
  // A found row's ring, white too: round the row's dot, which is its own.
  const finding = document.createElementNS(SVG, 'svg');
  finding.setAttribute('style', 'position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; visibility: hidden');
  const foundRing = document.createElementNS(SVG, 'circle');
  for (const [attribute, value] of [['r', String(FOUND_MARK.ring)], ['fill', 'none'], ['stroke', ADDED], ['stroke-opacity', '0.9'], ['stroke-width', String(FOUND_MARK.line)]]) foundRing.setAttribute(attribute!, value!);
  finding.append(foundRing);
  names.append(finding);
  /** The ring as drawn (CSS px), if it is. */
  let foundDrawn: { x: number; y: number } | undefined;
  // A drawn shape's outline, white too, dashed as board 6 has it.
  const outlining = document.createElementNS(SVG, 'svg');
  outlining.setAttribute('style', 'position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; visibility: hidden');
  const outlineLine = document.createElementNS(SVG, 'path');
  for (const [attribute, value] of [['fill', 'none'], ['stroke', ADDED], ['stroke-opacity', String(OUTLINE.opacity)], ['stroke-width', String(OUTLINE.line)], ['stroke-dasharray', OUTLINE.dash], ['stroke-linejoin', 'round']]) outlineLine.setAttribute(attribute!, value!);
  outlining.append(outlineLine);
  names.append(outlining);
  /** The shape while it's drawn, and closed until its rows are in: its
   *  points, window positions; and where each closed point's ray met the
   *  ecliptic through the camera it was drawn through. */
  let shape: { points: number[]; closed: boolean; anchors?: ([number, number] | undefined)[]; through?: string } | undefined;
  /** The group the crate last handed over: the years its shape was drawn
   *  on; the shape as drawn, and the camera it was drawn through
   *  (`cameraNow`); and the shape on the ecliptic, for any other camera.
   *  (A point drawn over the sky, or past the reach, has no place of its
   *  own on the ecliptic: through the camera it was drawn through, the
   *  outline is the points themselves.) */
  let group: { years: number; points: number[]; through: string; anchors: ([number, number] | undefined)[] } | undefined;
  /** The fixed frame's camera and what it draws into, as one text: the
   *  same text, the same picture of the ecliptic. */
  const cameraNow = (inset: number) => [view.x, view.y, view.distance, view.tilt, view.bearing, view.roll, inset, innerWidth, innerHeight].join();
  let groupChanges = 0;
  /** How much of the gray is in, where it's headed, and the page clock
   *  when it last moved. */
  let [grayed, grayTo, grayAt] = [0, 0, NaN];
  /** The outline as drawn, and the line as last written. */
  let outlineDrawn: { points: number[]; closed: boolean } | undefined;
  let outlineD = '';
  if (alone) names.hidden = true;
  // A name's size is read here and kept, never in a frame (a read there is
  // a layout every frame): now, and again when the interface's face
  // arrives, which changes it and so where a centered name goes.
  const measure = () => {
    for (const named of allNames) [named.width, named.height] = [named.label.offsetWidth, named.label.offsetHeight];
    dirty = true;
  };
  measure();
  document.fonts.addEventListener('loadingdone', measure);

  // Color is orbit size: the crate's table, which the legend is drawn from.
  const ramp = host.ramp();
  const stops = ramp.length / 4;
  const material = new ShaderMaterial({
    vertexShader: vertex(stops, false),
    fragmentShader: FRAGMENT,
    uniforms: {
      uYears: { value: [0, 0] },
      uSize: { value: 0 },
      uAlpha: { value: 0 },
      uHard: { value: hard ? 1 : 0 },
      uPlain: { value: new Color(PLAIN) },
      uBand: { value: new Vector4(...band(), 0.12, knob('bandGain', 1)) },
      uStops: { value: Array.from({ length: stops }, (_, stop) => ramp[stop * 4]!) },
      uRamp: { value: Array.from({ length: stops }, (_, stop) => new Vector3(ramp[stop * 4 + 1]!, ramp[stop * 4 + 2]!, ramp[stop * 4 + 3]!)) },
      uMag: { value: new Vector4(MAG.plain, MAG.bright, MAG.grow, MAG.most) },
      uLeast: { value: MAG.least },
      uDistance: { value: stats.distance },
      uNear: { value: new Vector2(1, 1) },
      uLanded: { value: new Vector2(LANDED.size, LANDED.alpha) },
      uRide: { value: 0 },
      uGroups: { value: new Vector4(...Array.from(host.rideGroups()).slice(0, 4)) },
      uGroupsE: { value: host.rideGroups()[4]! },
      uRideLight: { value: new Vector3(...RIDE_LIGHT) },
      uMarked: { value: new Vector3(0, knob('markerDim', MARKER.dim), 0) },
      uGroup: { value: new Vector2(0, knob('gray', GRAY.alpha)) },
      uIntegrated: { value: 0 },
      uFlight: { value: 0 },
      uAxes: { value: new Vector4(...Array.from(host.axes())) },
      uPlot: { value: new Vector4() },
    },
    blending: hard ? NormalBlending : AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  // The rows the crate's integration moves: the same dots (the one set of
  // uniforms), each placed where the crate has it.
  const integratedMaterial = new ShaderMaterial({
    vertexShader: vertex(stops, true),
    fragmentShader: FRAGMENT,
    uniforms: material.uniforms,
    blending: material.blending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  /** A plain dot's size, CSS px: dust, or a row drawn alone, big enough to find. */
  const dotPx = knob('size', hard ? 9 : DOT.px);
  const alpha = knob('alpha', DOT.alpha);

  const resize = () => {
    pixelRatio = devicePixelRatio * scale;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(innerWidth, innerHeight, false);
    const drawn = renderer.getDrawingBufferSize(new Vector2());
    look.setSize(drawn.x, drawn.y, pixelRatio);
    (sun.material.uniforms.uWindow!.value as Vector2).copy(drawn);
    sky?.setPixelRatio(pixelRatio);
    dirty = true;
  };
  addEventListener('resize', resize);
  resize();

  const ORIGIN = new Vector3();
  const ABOVE = new Vector3(0, 1, 0);
  const facing = new Matrix4();
  const [fixed, riding, turnSince, at] = [new Quaternion(), new Quaternion(), new Quaternion(), new Vector3()];
  /** Jupiter's longitude when the camera was last at rest, at either end
   *  of its flight. The flight is between the fixed frame's camera and
   *  the one above at this longitude, two ends that hold still, and the
   *  turn Jupiter has made since is added as the flight goes: a flight
   *  to an end that moved would take the shortest way to wherever it was
   *  each frame, and jump when that way changed sides. `since` is that
   *  turn, summed a frame at a time from the frame the flight began in
   *  (so it has no half turn to wrap at, however long a flight is held
   *  partway), and `longitudeDrawn` Jupiter's longitude in the last frame. */
  let anchor = NaN;
  let since = 0;
  let longitudeDrawn = NaN;
  /** How far above the Sun the camera rides, beside a panel `inset` px
   *  wide: the ride's own distance, or as far as keeps Jupiter at its
   *  farthest, and room for its name, inside what the panel leaves. */
  const rideDistance = (inset: number) => {
    const half = Math.max(50, (innerWidth - inset) / 2 - RIDE.room);
    return Math.max(RIDE.dist, (farthest * innerHeight) / 2 / (Math.tan((FOV * Math.PI) / 360) * half));
  };
  /** The ride's own camera, in the frame that turns with Jupiter (x along
   *  Jupiter's line from the Sun): a hand's to move while riding, and
   *  forgotten once the camera is back in the fixed frame. Its distance is
   *  kept as `rideZoom` times what the ride opens at, which follows the
   *  panel (`insetNow`: the panel's width as the camera was last placed). */
  let insetNow = 0;
  const rideAt = new Vector3();
  const rideView: View = {
    x: 0,
    y: 0,
    tilt: 0,
    bearing: 0,
    roll: 0,
    get distance() {
      return rideDistance(insetNow) * rideZoom;
    },
    set distance(au: number) {
      rideZoom = au / rideDistance(insetNow);
    },
  };
  const rideOpens = () => {
    [rideView.x, rideView.y, rideView.tilt, rideView.bearing, rideZoom] = [0, 0, 0, 0, 1];
  };
  /** The way a camera with a map's numbers faces. */
  const facingOf = (into: Quaternion, from: View) => {
    const [AZIMUTH, ELEVATION, ROLL] = [from.bearing, 90 - from.tilt, from.roll].map((degrees) => (degrees * Math.PI) / 180) as [number, number, number];
    const toward = new Vector3(Math.cos(ELEVATION) * Math.sin(AZIMUTH), Math.sin(ELEVATION), Math.cos(ELEVATION) * Math.cos(AZIMUTH));
    // Straight down, "up" is the way the camera would face from the side.
    const up = Math.cos(ELEVATION) < 1e-3 ? new Vector3(-Math.sin(AZIMUTH), 0, -Math.cos(AZIMUTH)) : new Vector3(0, 1, 0);
    return into.setFromRotationMatrix(facing.lookAt(toward, ORIGIN, up.applyAxisAngle(toward, ROLL)));
  };
  /** The camera where it is now, centered in what a panel `inset` px wide
   *  leaves: in the fixed frame where the visitor has it; riding (`ride`
   *  of the way there), the ride's own, a map's in the frame that turns,
   *  turned about the ecliptic's pole by Jupiter's longitude (as `anchor`
   *  and `since` make it): as the ride opens, straight above the Sun with
   *  Jupiter to its right and the way Jupiter goes up. */
  const place = (inset: number, ride = 0) => {
    insetNow = inset;
    camera.aspect = innerWidth / innerHeight;
    // The panel covers the window's right `inset` px: the picture moves
    // left by half of it.
    if (inset > 0) camera.setViewOffset(innerWidth, innerHeight, inset / 2, 0, innerWidth, innerHeight);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    facingOf(fixed, view);
    let distance = view.distance;
    at.set(...inScene(view.x, view.y, 0));
    if (ride > 0) {
      // The frame's one angle: Jupiter's longitude, a turn about the
      // ecliptic's pole (the scene's y: the way longitude grows). The
      // ride's camera is a map's in that frame: as it opens, straight
      // above the Sun, the way Jupiter goes (a quarter turn ahead of it)
      // up; and from there a hand's.
      facingOf(riding, rideView).premultiply(turnSince.setFromAxisAngle(ABOVE, anchor));
      fixed.slerp(riding, ride).premultiply(turnSince.setFromAxisAngle(ABOVE, ride * since));
      distance *= (rideView.distance / view.distance) ** ride;
      rideAt.set(...inScene(rideView.x, rideView.y, 0)).applyAxisAngle(ABOVE, anchor + ride * since);
      at.lerp(rideAt, ride);
    }
    camera.quaternion.copy(fixed);
    // The camera looks down its own z at what it looks at.
    camera.position.set(0, 0, 1).applyQuaternion(fixed).multiplyScalar(distance).add(at);
    camera.updateMatrixWorld();
    stats.distance = distance;
  };

  /** Where a window position's ray meets the ecliptic (x, y, au), through
   *  the camera as it is, no farther along the plane than `reach` camera
   *  distances. Past that, or over the sky: nothing, or with `held` the
   *  point at the reach the same way round, so a drag there still pans. */
  const ground = (x: number, y: number, reach: number, held: boolean): [number, number] | undefined => {
    place(last?.inset ?? 0, last?.ride);
    const eye = camera.position;
    const ray = new Vector3((2 * x) / innerWidth - 1, 1 - (2 * y) / innerHeight, 0.5).unproject(camera).sub(eye);
    const along = Math.hypot(ray.x, ray.z);
    const most = reach * stats.distance;
    // Level with the ecliptic or away from it, the ray never meets it.
    const meets = ray.y * eye.y < 0;
    let out = meets ? (Math.abs(eye.y) * along) / Math.abs(ray.y) : Infinity;
    if (!meets || out > most) {
      if (!held) return undefined;
      out = most;
    }
    return along > 0 ? [eye.x + (ray.x / along) * out, -(eye.z + (ray.z / along) * out)] : [eye.x, -eye.z];
  };
  /** `?glide`: chosen by hand, left for looking. */
  const feel = { glideMs: knob('glide', GLIDE.ms) };
  const pixelAt = (distance: number) => (2 * distance * Math.tan((FOV * Math.PI) / 360)) / innerHeight;
  /** The hand on the fixed frame's camera: a drag, a wheel, the glide,
   *  the tilt and the turn, a double click. */
  /** A hand moved a camera: the next frame is drawn, and the interface
   *  told that its hint has been taken. */
  let handMoved = false;
  const byHand = () => (dirty = handMoved = true);
  const hand = createHand(view, { ground: (x, y, held) => ground(x, y, REACH, held), pixel: () => pixelAt(view.distance), limits: () => [ZOOM.nearest, ZOOM.farthest] }, byHand, feel);
  /** The hand on the ride's own camera, its numbers in the frame that
   *  turns: a point of the ecliptic is turned back by Jupiter's longitude,
   *  as the camera was placed. It goes from as near as the fixed frame's to
   *  four times as far as the ride opens (which in a narrow window is
   *  already past the fixed frame's farthest). */
  const rideHand = createHand(
    rideView,
    {
      ground(x, y, held) {
        const world = ground(x, y, REACH, held);
        if (!world) return undefined;
        const [sin, cos] = [Math.sin(anchor), Math.cos(anchor)];
        return [world[0] * cos + world[1] * sin, world[1] * cos - world[0] * sin];
      },
      pixel: () => pixelAt(rideView.distance),
      limits: () => [ZOOM.nearest, 4 * rideDistance(insetNow)],
    },
    byHand,
    feel,
  );
  /** Whose drag is under way, if either's; and whether it pans. */
  let dragging: typeof hand | undefined;
  let panning = false;
  /** A found row and the camera. `foundRow` and `foundFinds` are what the
   *  crate last said (the row marked, and how many finds there have been:
   *  a flight for each). `chase` is what the fixed frame's camera is doing
   *  about it: waiting to fly there (it is a hand's only in space, at rest
   *  in the fixed frame), flying there, or, landed, following the row as
   *  time runs. A hand that takes the flight ends the chase, and so do a
   *  pan and the way home while following: the row stays marked. */
  let [foundRow, foundFinds] = [-1, host.finds()];
  let chase: SceneStats['chase'] = '';
  /** `?found`: how far from a found row the camera's flight ends, au. */
  const foundNear = knob('found', FOUND.near);
  /** What the crate says of the found row took effect: its name on the
   *  mark, and the camera waiting to fly, or let go of a row no longer
   *  found; then the flight begun, once the camera is a hand's. */
  const chased = (frame: Frame, now: number) => {
    // A flight a hand took over (or anything else ended) is no chase.
    if (chase === 'flying' && !hand.flying()) chase = '';
    if (frame.found !== foundRow || frame.finds !== foundFinds) {
      if (frame.found >= 0) {
        if (frame.found !== foundRow) {
          foundName.label.textContent = foundName.text = host.foundName();
          [foundName.width, foundName.height] = [foundName.label.offsetWidth, foundName.label.offsetHeight];
        }
        // (A flight under way goes on, to the row found now: its place
        // is asked for at each step. A held arrow in the table is one
        // flight that lands on the last row, not one begun again a row.)
        if (chase !== 'flying') chase = 'waiting';
      } else {
        // (A flight to a row no longer found stops where it is.)
        if (chase === 'flying') hand.press();
        chase = '';
      }
      [foundRow, foundFinds] = [frame.found, frame.finds];
    }
    if (chase !== 'waiting' || frame.flight > 0 || frame.ride > 0 || !frame.foundAt) return;
    // The camera keeps its tilt, its bearing, and its roll, and ends
    // `foundNear` from the row, looking at it: where the row is when it
    // lands (the place is asked for at each step, and the row moves).
    const [tilt, bearing] = [view.tilt, view.bearing];
    let to = frame.foundAt;
    chase = 'flying';
    const flies = hand.fly(
      () => {
        to = foundAt ?? to;
        const aim = aimedAt(to, tilt, bearing);
        return { x: aim.x, y: aim.y, distance: Math.max(foundNear + aim.under, FOUND.least), tilt, bearing };
      },
      now,
      FOUND.ms,
      () => (chase = 'following'),
    );
    // (A hand mid-drag has the camera: the flight waits for its release.)
    if (!flies) chase = 'waiting';
  };
  /** Following, the camera looks at the found row where it is now, with
   *  whatever tilt, bearing, and distance a hand has given it (never so
   *  near that the row is behind it): whether it moved. */
  const follow = (frame: Frame): boolean => {
    if (chase !== 'following' || !frame.foundAt || frame.flight > 0 || frame.ride > 0) return false;
    const aim = aimedAt(frame.foundAt, view.tilt, view.bearing);
    const distance = Math.max(view.distance, aim.under + ZOOM.nearest);
    if (aim.x === view.x && aim.y === view.y && distance === view.distance) return false;
    [view.x, view.y, view.distance] = [aim.x, aim.y, distance];
    return true;
  };
  /** The hand for an input the interface handed over for a frame (0 the
   *  fixed one's, 1 the ride's own), if the camera as last drawn is at rest
   *  there. The interface decides from the crate's state, which a reading
   *  of its own can move on a frame before the scene draws: in that frame
   *  the camera drawn is still on its way, a pointer's ray through it holds
   *  no point of either frame, and the input moves nothing. */
  const handOf = (frame: number) => {
    const ride = last?.ride ?? 0;
    return frame === 1 ? (ride >= 1 ? rideHand : undefined) : ride <= 0 ? hand : undefined;
  };
  /** Whether the camera is moving on its own. */
  const moving = () => (stats.gliding = hand.gliding() || rideHand.gliding());
  /** What the interface's compass was last told (`cameraSeen`). */
  let told = '';
  /** The compass's camera in a frame `ride` of the way to the turning
   *  one: the fixed frame's turn from where it opened and its tilt, the
   *  ride's own (which opens straight down, unturned), and between the two
   *  the short way round. */
  const tell = (ride: number) => {
    // (With the pose's roll the needle leans as the horizon does.)
    const fixedTurn = view.bearing - opened.bearing + view.roll;
    const round = ((((rideView.bearing - fixedTurn) % 360) + 540) % 360) - 180;
    const turned = (((fixedTurn + round * ride) % 360) + 360) % 360;
    const tilt = view.tilt + (rideView.tilt - view.tilt) * ride;
    // By the tenth of a degree while the camera moves on its own, and
    // exactly once it rests: the compass ends on the camera's numbers.
    const now = stats.gliding ? `${turned.toFixed(1)} ${tilt.toFixed(1)} ${handMoved}` : `${turned} ${tilt} ${handMoved}`;
    if (now === told) return;
    told = now;
    host.cameraSeen(turned, tilt, handMoved);
  };

  /** Where a place in the scene is in the window (CSS px), or nothing
   *  behind the camera. */
  const onScreen = (at: Vector3): [number, number] | undefined => {
    const clip = new Vector4(at.x, at.y, at.z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    if (!(clip.w > 0)) return undefined;
    return [((clip.x / clip.w + 1) / 2) * innerWidth, ((1 - clip.y / clip.w) / 2) * innerHeight];
  };
  /** A name beside its body: `dx`, `dy` from the body's place to the
   *  name's corner, whole pixels so the text stays sharp. */
  const put = (named: ReturnType<typeof name>, at: Vector3, dx: (width: number) => number, dy: number, opacity = 1, within?: number) => {
    const where = onScreen(at);
    // (`within`: the name itself must fit left of there, not only its body.)
    const fits = within === undefined || (!!where && where[0] + dx(named.width) >= 0 && where[0] + dx(named.width) + named.width <= within);
    const inside = opacity > 0 && fits && !!where && where[0] >= 0 && where[0] <= innerWidth && where[1] >= 0 && where[1] <= innerHeight;
    if (named.shown !== inside) named.label.style.visibility = inside ? 'visible' : 'hidden';
    if (named.opacity !== opacity) named.label.style.opacity = String((named.opacity = opacity));
    named.shown = inside;
    if (!where || !inside) return;
    const [left, top] = [Math.round(where[0] + dx(named.width)), Math.round(where[1] + dy)];
    // (Riding, the ride's names hold still: written when they move.)
    if (left === named.left && top === named.top) return;
    [named.left, named.top] = [left, top];
    named.label.style.transform = `translate(${left}px, ${top}px)`;
  };

  /** What a frame is drawn from: everything the crate is asked for it. */
  interface Frame {
    years: number;
    inset: number;
    /** The sort flight, 0 in space to 1 landed, and how much of what
     *  isn't a row is left in the picture. */
    flight: number;
    space: number;
    /** Where the axes are, in clip space: the least a and e, then the
     *  most. Asked for while the dots are out of space. */
    plot: [number, number, number, number];
    /** Where the page's text lies: left, top, width, height. */
    scrim: [number, number, number, number];
    /** Jupiter's place, in the ecliptic's axes. */
    jupiter: [number, number, number];
    /** How far the frame has turned to Jupiter's, and how much of the sky
     *  is left in the picture. */
    ride: number;
    sky: number;
    /** The three points in step with Jupiter: the x, y, z of each. Asked
     *  for while the frame is turned. */
    points: number[];
    /** Where the integrated rows' places for `years` are in the crate's
     *  memory; 0 while there are none (no such rows yet, the rows not yet
     *  moved to the clock, or no dot in space). */
    integrated: number;
    /** A picked gap: how much of the ride's own it has taken away, how much of its marker
     *  shows, which gap, and where its marker is (the ecliptic's x, y,
     *  z). The last two are asked for while the marker shows. */
    picked: number;
    marked: number;
    gap: number;
    marker: [number, number, number];
    /** The row found (-1 with none), how many finds there have been, and
     *  where the row is (the ecliptic's x, y, z). */
    found: number;
    finds: number;
    foundAt: [number, number, number] | undefined;
  }
  let last: Frame | undefined;
  /** The text's bounds as last asked for, and the crate's count then. */
  let scrim: Frame['scrim'] = [0, 0, 0, 0];
  let scrimChanges = -1;
  /** The plot as last asked for, and the window and panel it was for. */
  let plot: Frame['plot'] = [0, 0, 0, 0];
  let plotFor = [0, 0, -1];
  /** Jupiter's place as last asked for, and the years it was for. */
  let jupiter_: Frame['jupiter'] = [0, 0, 0];
  let jupiterFor = NaN;
  /** The three points as last asked for, and the years they were for. */
  let points: number[] = [];
  let pointsFor = NaN;
  /** The marker's place as last asked for, the gap and the years it was
   *  for, and each gap's path, asked for once. */
  let marker: Frame['marker'] = [0, 0, 0];
  let markerFor = [-1, NaN];
  const paths: (Float32Array | undefined)[] = [];
  /** The found row's place as last asked for, and the row and the years
   *  it was for. */
  let foundAt: Frame['foundAt'];
  let foundFor = [-1, NaN, 0];
  /** Asks the crate. Nothing here may run between making the views over
   *  its memory and uploading them: a call into the wasm can grow it. */
  const ask = (now: number): Frame => {
    const [years, inset, changes, flight, space, ride, sky] = [host.years(now), host.inset(), host.scrimChanges(), host.flight(now), host.space(), host.ride(now), host.sky()];
    if (changes !== scrimChanges) {
      const text = host.scrim();
      [scrim, scrimChanges] = [[text[0]!, text[1]!, text[2]!, text[3]!], changes];
    }
    if (flight > 0 && (innerWidth !== plotFor[0] || innerHeight !== plotFor[1] || inset !== plotFor[2])) {
      const at = host.plot(innerWidth, innerHeight);
      [plot, plotFor] = [[at[0]!, at[1]!, at[2]!, at[3]!], [innerWidth, innerHeight, inset]];
    }
    // Jupiter's place is asked for when the clock has moved and there's a
    // Jupiter to draw: not landed, where the clock may run on unseen.
    if (space > 0 && years !== jupiterFor) {
      const at = host.jupiter(years);
      [jupiter_, jupiterFor] = [[at[0]!, at[1]!, at[2]!], years];
    }
    if (space > 0 && ride > 0 && years !== pointsFor) [points, pointsFor] = [Array.from(host.ridePoints(years)), years];
    // The Hildas and the Trojans are stepped to the clock whatever is
    // drawn (so they're there when the dots fly back from the axes), and
    // their places worked out only while a dot is in space.
    const places = integrated ? host.integrated(years, flight < 1) : 0;
    // A picked gap (asked after the ride, which it follows): its marker's
    // place when the clock or the gap has moved, and its path once.
    const [picked, lit] = [host.gap(now), host.gapLit()];
    const gap = lit > 0 ? host.gapMarker() : (last?.gap ?? 0);
    if (lit > 0 && (gap !== markerFor[0] || years !== markerFor[1])) {
      const at = host.gapPlace(gap, years);
      [marker, markerFor] = [[at[0]!, at[1]!, at[2]!], [gap, years]];
    }
    if (lit > 0) paths[gap] ??= host.gapPath(gap);
    // A found row's place, when the row or the clock has moved.
    const [found, finds] = [host.found(), host.finds()];
    // (Where the scene draws it: the integration's place for a Hilda or
    // a Trojan only in a frame that draws those rows from it.)
    const apart = Number(places !== 0);
    if (found !== foundFor[0] || (found >= 0 && (years !== foundFor[1] || apart !== foundFor[2]))) {
      const at = found >= 0 ? host.foundPlace(years, !!apart) : [];
      [foundAt, foundFor] = [at.length === 3 ? [at[0]!, at[1]!, at[2]!] : undefined, [found, years, apart]];
    }
    return { years, inset, scrim, flight, space, plot, jupiter: jupiter_, ride, sky, points, integrated: places, picked, marked: lit, gap, marker, found, finds, foundAt };
  };
  // Landed, time moves no dot: of the clock, only the way back draws.
  const moved = (frame: Frame, from: Frame) =>
    (frame.years !== from.years && frame.flight < 1) || frame.inset !== from.inset || frame.scrim !== from.scrim || frame.flight !== from.flight || frame.plot !== from.plot || frame.ride !== from.ride || frame.sky !== from.sky || frame.integrated !== from.integrated || frame.picked !== from.picked || frame.marked !== from.marked || frame.gap !== from.gap || frame.found !== from.found || frame.foundAt !== from.foundAt;
  /** What isn't a row, as it leaves the picture and returns: the Sun,
   *  Jupiter, its orbit, the marks, and the names; and the haze, which on
   *  the axes would light the gaps. (The sky leaves by a number of its
   *  own: it's gone from the frame that turns with Jupiter too.) */
  let space = 1;
  let skyLeft = 1;
  const leave = (left: number) => {
    sun.material.uniforms.uFade!.value = left;
    jupiter.material.uniforms.uFade!.value = left;
    orbitLine.opacity = left;
    if (marks) marks.material.opacity = 0.55 * left;
    look.setHaze(left);
    if (left !== space) names.style.opacity = String(left);
    space = left;
  };

  /** The ride's names and its triangle, on the crate's three points,
   *  through the camera as it is. */
  const furnish = (frame: Frame) => {
    const riding = frame.space > 0 ? frame.ride : 0;
    // In the fixed frame, with none of it shown, there's nothing to do.
    if (riding <= 0 && !triangleShown && !rideNames.some((named) => named.shown)) return;
    const [ahead, behind, opposite] = [0, 3, 6].map((point) => new Vector3(...inScene(frame.points[point] ?? 0, frame.points[point + 1] ?? 0, frame.points[point + 2] ?? 0)));
    // A name that would run under the panel, or off the window, isn't
    // drawn: the camera keeps room for Jupiter's, and a narrow window has
    // none for the Trojans'.
    const room = innerWidth - frame.inset;
    // With a gap picked the two groups' names and the triangle leave, as
    // their light does: board 5 keeps Jupiter's name alone.
    const groups = riding * (1 - frame.picked);
    put(heldName, jupiter.position, () => JUPITER_PX / 2 + 8, -9, riding, room);
    put(aheadName, ahead!, () => RIDE_NAMES.ahead[0], RIDE_NAMES.ahead[1], groups, room);
    put(behindName, behind!, () => RIDE_NAMES.behind[0], RIDE_NAMES.behind[1], groups, room);
    put(hildasName, opposite!, (width) => RIDE_NAMES.hildas[0] - width, RIDE_NAMES.hildas[1], groups, room);
    const drawn = groups > 0 ? [ahead!, opposite!, behind!].map(onScreen) : [];
    const whole = drawn.length === 3 && drawn.every((corner) => corner);
    if (whole !== triangleShown) triangle.style.visibility = (triangleShown = whole) ? 'visible' : 'hidden';
    if (!whole) {
      corners = undefined;
      return;
    }
    const next = drawn.flatMap((corner) => [Math.round(corner![0] * 10) / 10, Math.round(corner![1] * 10) / 10]);
    // Riding, the three points hold still on screen: written when they move.
    if (!corners || next.some((px, corner) => px !== corners![corner])) {
      triangleLine.setAttribute('d', `M${next[0]} ${next[1]}L${next[2]} ${next[3]}L${next[4]} ${next[5]}Z`);
      corners = next;
    }
    if (groups !== triangleOpacity) triangle.style.opacity = String((triangleOpacity = groups));
  };

  /** A picked gap's marker and its path, through the camera as it is.
   *  The path is the crate's, in the frame that turns with Jupiter, so
   *  it's turned here by Jupiter's longitude: riding, it holds still on
   *  screen, and is written only when the camera or the gap has moved.
   *  On the camera's way to the ride or back the frame is still turning
   *  under it (every place would be written anew each frame, as the belt
   *  and the camera move), so the path waits for the camera to be there,
   *  and comes and goes by its own opacity; the marker and its name don't
   *  wait. */
  const mark = (frame: Frame) => {
    const lit = frame.space > 0 ? frame.marked : 0;
    const path = paths[frame.gap];
    if (lit <= 0 || !path) {
      if (markingShown) marking.style.visibility = 'hidden';
      markingShown = false;
      markerDrawn = undefined;
      pathFor = '';
      put(markerName, ORIGIN, () => 0, 0, 0);
      return;
    }
    if (!markingShown) marking.style.visibility = 'visible';
    markingShown = true;
    if (lit !== markingOpacity) marking.style.opacity = String((markingOpacity = lit));
    // The path, once the camera is riding.
    const there = frame.ride >= 1;
    if (there !== pathShown) pathLine.style.opacity = (pathShown = there) ? '1' : '0';
    const drawnFor = there ? [frame.gap, frame.inset, innerWidth, innerHeight, stats.distance, rideView.x, rideView.y, rideView.tilt, rideView.bearing].join() : '';
    if (there && drawnFor !== pathFor) {
      const longitude = Math.atan2(frame.jupiter[1], frame.jupiter[0]);
      const [sin, cos] = [Math.sin(longitude), Math.cos(longitude)];
      const seen = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
      pathDrawn = [];
      for (let place = 0; place < path.length; place += 2) {
        // Turned to the fixed frame, then into the scene's axes (the
        // ecliptic is its xz plane), then through the camera.
        const [x, z] = [path[place]! * cos - path[place + 1]! * sin, -(path[place]! * sin + path[place + 1]! * cos)];
        const w = seen[3]! * x + seen[11]! * z + seen[15]!;
        // A place level with the eye or behind it has none on screen (a
        // camera of the visitor's, tilted and near, can have the path's
        // near side behind it): the line breaks there.
        if (!(w > 1e-6)) {
          pathDrawn.push(NaN, NaN);
          continue;
        }
        pathDrawn.push(Math.round(((seen[0]! * x + seen[8]! * z + seen[12]!) / w + 1) * 5 * innerWidth) / 10, Math.round((1 - (seen[1]! * x + seen[9]! * z + seen[13]!) / w) * 5 * innerHeight) / 10);
      }
      const line: string[] = [];
      // Whole, it closes; broken, each run of places is a line of its own
      // (and the last isn't joined to the first across the break).
      const whole = !pathDrawn.some(Number.isNaN);
      let pen = false;
      for (let place = 0; place < pathDrawn.length; place += 2) {
        if (Number.isNaN(pathDrawn[place]!)) pen = false;
        else {
          line.push(`${pen ? 'L' : 'M'}${pathDrawn[place]} ${pathDrawn[place + 1]}`);
          pen = true;
        }
      }
      if (!whole && pen && !Number.isNaN(pathDrawn[0]!)) line.push(`L${pathDrawn[0]} ${pathDrawn[1]}`);
      pathLine.setAttribute('d', `${line.join('')}${whole ? 'Z' : ''}`);
    }
    pathFor = drawnFor;
    // The marker, where it is now; behind the camera it has no place on
    // screen, and neither it nor its name is drawn.
    const at = new Vector3(...inScene(...frame.marker));
    const where = onScreen(at);
    if (markerShown !== !!where) markerAt.style.visibility = (markerShown = !!where) ? 'inherit' : 'hidden';
    if (where) markerAt.setAttribute('transform', `translate(${where[0].toFixed(1)} ${where[1].toFixed(1)})`);
    markerDrawn = where ? { x: where[0], y: where[1], path: there ? pathDrawn : [] } : undefined;
    put(markerName, where ? at : ORIGIN, () => MARKER.name[0], MARKER.name[1], where ? lit : 0, innerWidth - frame.inset);
  };

  /** A found row's ring and its name, on the row's place through the
   *  camera as it is. Behind the camera it has no place on screen. */
  const found = (frame: Frame) => {
    const at = frame.space > 0 && frame.foundAt ? new Vector3(...inScene(...frame.foundAt)) : undefined;
    const where = at && onScreen(at);
    if (!!where !== !!foundDrawn) finding.style.visibility = where ? 'visible' : 'hidden';
    if (where) foundRing.setAttribute('transform', `translate(${where[0].toFixed(1)} ${where[1].toFixed(1)})`);
    foundDrawn = where ? { x: where[0], y: where[1] } : undefined;
    put(foundName, at && where ? at : ORIGIN, () => FOUND_MARK.name[0], FOUND_MARK.name[1], where ? 1 : 0, innerWidth - frame.inset);
  };

  /** A drawn shape's outline, and a group's chip. While it's drawn, and
   *  closed until its rows are in, the outline is its points as the
   *  pointer gave them. Round a group it's on the ecliptic, through the
   *  camera as it is, and only on the clock's years it was drawn on, in
   *  the fixed frame, in space: its dots have left it anywhere else. */
  const outline = (frame: Frame) => {
    let points: number[] | undefined;
    const held = !shape && !!group && frame.years === group.years && frame.space >= 1 && frame.ride <= 0;
    if (shape) points = shape.points;
    else if (held && group!.through === cameraNow(frame.inset)) points = group!.points;
    else if (held) {
      points = group!.anchors.flatMap((anchor) => {
        const where = anchor && onScreen(new Vector3(...inScene(anchor[0], anchor[1], 0)));
        return where ? [Math.round(where[0] * 10) / 10, Math.round(where[1] * 10) / 10] : [NaN, NaN];
      });
    }
    const closed = held || !!shape?.closed;
    const line: string[] = [];
    let pen = false;
    for (let point = 0; points && point < points.length; point += 2) {
      // (A point with no place on screen breaks the line, as a path's does.)
      if (Number.isNaN(points[point]!)) pen = false;
      else {
        line.push(`${pen ? 'L' : 'M'}${points[point]} ${points[point + 1]}`);
        pen = true;
      }
    }
    const whole = !!points && !points.some(Number.isNaN);
    const d = line.length > 1 ? `${line.join('')}${closed && whole ? 'Z' : ''}` : '';
    if (!!d !== !!outlineD) outlining.style.visibility = d ? 'visible' : 'hidden';
    if (d !== outlineD) outlineLine.setAttribute('d', (outlineD = d));
    outlineDrawn = d && points ? { points, closed } : undefined;
    // The chip: over the shape's top, centered on it, inside what the
    // panel leaves and clear of the row of actions.
    let [left, right, top] = [Infinity, -Infinity, Infinity];
    for (let point = 0; held && d && point < points!.length; point += 2) {
      if (Number.isNaN(points![point]!)) continue;
      [left, right, top] = [Math.min(left, points![point]!), Math.max(right, points![point]!), Math.min(top, points![point + 1]!)];
    }
    const chipped = held && Number.isFinite(top) && right >= 0 && left <= innerWidth - frame.inset && top <= innerHeight;
    if (groupChip.shown !== chipped) groupChip.label.style.visibility = (groupChip.shown = chipped) ? 'visible' : 'hidden';
    if (!chipped) return;
    const room = innerWidth - frame.inset;
    const [x, y] = [Math.round(Math.min(Math.max((left + right - groupChip.width) / 2, CHIP.keep), Math.max(CHIP.keep, room - groupChip.width - CHIP.keep))), Math.round(Math.max(top - CHIP.over - CHIP.height, CHIP.keep))];
    if (x === groupChip.left && y === groupChip.top) return;
    [groupChip.left, groupChip.top] = [x, y];
    groupChip.label.style.transform = `translate(${x}px, ${y}px)`;
  };

  const render = (frame: Frame) => {
    dirty = false;
    // The camera's flight is from the last frame drawn at rest, at either
    // end: this one, or the one before (which may be long ago: landed on
    // the axes nothing is drawn, whatever the clock does). On the way,
    // Jupiter's turn since is summed.
    const longitude = Math.atan2(frame.jupiter[1], frame.jupiter[0]);
    const rests = (ride: number) => ride <= 0 || ride >= 1;
    if (rests(frame.ride) || !last || rests(last.ride) || Number.isNaN(anchor)) [anchor, since] = [longitude, 0];
    else since += Math.atan2(Math.sin(longitude - longitudeDrawn), Math.cos(longitude - longitudeDrawn));
    longitudeDrawn = longitude;
    last = frame;
    // Back in the fixed frame, the ride's own camera is forgotten: the
    // next ride opens as board 2 has it.
    if (frame.ride <= 0) rideOpens();
    place(frame.inset, frame.ride);
    stats.camera = { ...view };
    stats.riding = { ...rideView };
    // Up close the dust thins out, by the square of how much nearer the
    // camera is than it opens: a dot's area and its opacity each grow with
    // the nearness, so the dust keeps its brightness and its colors.
    // Change one without the other and a near view fades out or burns white.
    const near = Math.max(1, OPENING.dist / stats.distance);
    const whole = Math.floor(frame.years);
    material.uniforms.uYears!.value = [whole, frame.years - whole];
    material.uniforms.uSize!.value = dotPx * pixelRatio;
    material.uniforms.uAlpha!.value = hard ? 1 : alpha;
    (material.uniforms.uNear!.value as Vector2).set(Math.min(3, Math.sqrt(near)), Math.min(12, near));
    material.uniforms.uDistance!.value = stats.distance;
    material.uniforms.uFlight!.value = frame.flight;
    // The groups' light comes in over the second half of the camera's
    // flight, and only in space: as the page's sentence about it does
    // (`host.rs`), so nothing is brightened that isn't said to be.
    material.uniforms.uRide!.value = Math.max(0, 2 * frame.ride - 1) * frame.space;
    // A picked gap's dim comes in the same way (the crate's own number).
    // What a gap has left of the two groups' light is the ride's, less
    // what the gap took.
    const marking_ = material.uniforms.uMarked!.value as Vector3;
    [marking_.x, marking_.z] = [frame.marked, (material.uniforms.uRide!.value as number) * (1 - frame.picked)];
    (material.uniforms.uPlot!.value as Vector4).set(...frame.plot);
    (material.uniforms.uGroup!.value as Vector2).x = grayed;
    // The Hildas and the Trojans where the crate's integration has them:
    // their places uploaded when the clock has moved, from a view over
    // the crate's memory made here (nothing has been asked of the crate
    // since the frame was). Without places they're the belt's own rows.
    const apart = !!integrated && frame.integrated !== 0;
    if (integrated && apart && frame.years !== integrated.years) {
      gl.bindBuffer(gl.ARRAY_BUFFER, integrated.places);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, host.floats(frame.integrated, integrated.rows * 3));
      integrated.years = frame.years;
    }
    if (integrated && apart !== integrated.apart) for (const points of integrated.draws) points.visible = integrated.apart = apart;
    material.uniforms.uIntegrated!.value = apart ? 1 : 0;
    stats.integrated = apart ? integrated!.drawn : 0;
    stats.catchingUp = !!integrated && !apart && frame.flight < 1;
    leave(frame.space);
    // `?rideSky`, to be looked at: what the ride leaves of the sky, which
    // then turns with the frame.
    // Round a drawn group the stars dim: gray dots would be taken for them.
    const starry = (rideSky > 0 ? frame.space * (1 - frame.ride * (1 - rideSky)) : frame.sky) * (1 - (1 - GRAY.sky) * grayed);
    if (starry !== skyLeft) sky?.setFade((skyLeft = starry));
    sun.material.uniforms.uSize!.value = SUN_PX * pixelRatio;
    jupiter.material.uniforms.uSize!.value = JUPITER_PX * pixelRatio;
    jupiter.position.set(...inScene(...frame.jupiter));
    if (marks) {
      const longitude = Math.atan2(frame.jupiter[1], frame.jupiter[0]);
      const points = marks.geometry.getAttribute('position') as BufferAttribute;
      [0, 60, -60, 180].forEach((ahead, ray) => {
        const toward = longitude + (ahead * Math.PI) / 180;
        // From 0.6 au out (clear of the Sun's glow) to past Jupiter's orbit.
        points.setXYZ(ray * 2, ...inScene(0.6 * Math.cos(toward), 0.6 * Math.sin(toward), 0));
        points.setXYZ(ray * 2 + 1, ...inScene(6.2 * Math.cos(toward), 6.2 * Math.sin(toward), 0));
      });
      points.needsUpdate = true;
    }
    look.setScrim(frame.scrim);
    // With the dots landed there's nothing of space to draw.
    look.render(dust, alone || frame.space <= 0 ? none : bodies, camera);
    if (!alone && frame.space > 0) {
      // Board 1: the Sun's name under it, Jupiter's beside it.
      put(sunName, sun.position, (width) => -width / 2, SUN_NAME_BELOW);
      // Board 2: riding, Jupiter's name says it's held still.
      put(jupiterName, jupiter.position, () => JUPITER_PX / 2 + 8, -9, 1 - frame.ride);
    }
    if (!alone) furnish(frame);
    if (!alone) mark(frame);
    if (!alone) found(frame);
    if (!alone) outline(frame);
    // `?glass`: the blur behind the panel is as wide as the panel is now.
    if (glass && frame.inset !== glassWidth) glass.style.width = `${(glassWidth = frame.inset)}px`;
    stats.frames++;
    stats.years = frame.years;
    stats.flight = frame.flight;
    stats.ride = frame.ride;
    stats.found = frame.found;
    stats.grayed = grayed;
    tell(frame.ride);
  };
  /** The belt's room on the GPU: a buffer a column, and what draws from them. */
  interface Belt {
    rows: number;
    buffers: WebGLBuffer[];
    /** A byte a row: 1 in a drawn group. */
    picked: WebGLBuffer;
    draws: Points<BufferGeometry<NormalOrGLBufferAttributes>>[];
  }
  let belt: Belt | undefined;
  /** The rows the crate's integration moves: their places' buffer, as
   *  the crate last handed them over (`years`; NaN before the first), and
   *  what draws from it; `drawn` of them are drawn (all, or those among
   *  `?only`'s), `apart` from the belt's own draw while places are in. */
  interface Integrated {
    rows: number;
    /** Which of the file's rows they are, and each one's byte of a drawn
     *  group. */
    list: Uint32Array;
    picked: BufferAttribute;
    places: WebGLBuffer;
    draws: Points<BufferGeometry<NormalOrGLBufferAttributes>>[];
    drawn: number;
    years: number;
    apart: boolean;
  }
  let integrated: Integrated | undefined;
  /** The belt is whole: the two groups' rows get their own draw. Asks
   *  the crate, so it runs before any view over its memory is made. */
  const integrate = () => {
    const rows = host.integratedRows();
    const count = rows.length;
    if (!count) return;
    const columns = host.integratedColumns();
    if (columns.length !== count * INTEGRATED_COLUMNS.length) throw new Error(`the scene wants five columns of the ${count} integrated rows`);
    const places = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, places);
    gl.bufferData(gl.ARRAY_BUFFER, count * 12, gl.DYNAMIC_DRAW);
    const attributes = INTEGRATED_COLUMNS.map((attribute, column) => [attribute, new BufferAttribute(columns.slice(column * count, (column + 1) * count), 1)] as const);
    const picked = new BufferAttribute(new Uint8Array(count), 1);
    // All of them; or, of rows drawn alone, those that are among them.
    const ranges: [number, number][] = alone ? alone.flatMap((row): [number, number][] => (rows.includes(row) ? [[rows.indexOf(row), 1]] : [])) : [[0, count]];
    const draws = ranges.map(([start, drawn]) => {
      const geometry = new BufferGeometry<NormalOrGLBufferAttributes>();
      for (const [attribute, values] of attributes) geometry.setAttribute(attribute, values);
      geometry.setAttribute('placed', new GLBufferAttribute(places, gl.FLOAT, 3, 4, count));
      geometry.setAttribute('picked', picked);
      geometry.setDrawRange(start, drawn);
      const points = new Points(geometry, integratedMaterial);
      points.frustumCulled = false;
      points.visible = false;
      dust.add(points);
      return points;
    });
    integrated = { rows: count, list: rows, picked, places, draws, drawn: ranges.reduce((sum, range) => sum + range[1], 0), years: NaN, apart: false };
  };
  /** The belt's first `rows` rows are in its buffers: what's drawn of it. */
  const shown = (belt: Belt, rows: number) => {
    stats.rows = rows;
    stats.points = 0;
    belt.draws.forEach((points, draw) => {
      // A row drawn alone shows once its block is in; the belt, as far
      // as it's in.
      const count = alone ? Number(alone[draw]! < rows) : rows;
      if (!alone) points.geometry.setDrawRange(0, count);
      points.visible = count > 0;
      stats.points += count;
    });
  };
  /** The crate's group changed: its bytes into the belt's buffer, the
   *  gray headed in or out, and the outline the group's or gone. Asks the
   *  crate everything first and for the bytes' address last: the view over
   *  them is uploaded with no call to it between. */
  const regroup = (now: number) => {
    const [points, years, chip] = [host.groupShape(), host.groupYears(), host.groupChip()];
    const at = belt ? host.groupBytes() : 0;
    if (at && belt) {
      const bytes = host.bytes(at, belt.rows);
      gl.bindBuffer(gl.ARRAY_BUFFER, belt.picked);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, bytes);
      if (integrated) {
        const picked = integrated.picked.array as Uint8Array;
        for (let row = 0; row < integrated.rows; row++) picked[row] = bytes[integrated.list[row]!]!;
        integrated.picked.needsUpdate = true;
      }
      let count = 0;
      for (let row = 0; row < bytes.length; row++) count += bytes[row]!;
      stats.group = count;
      // On the ecliptic, where each point's ray met it when the shape was
      // closed (or, with no shape of this page's, meets it now).
      const anchors = shape?.anchors ?? Array.from({ length: points.length / 2 }, (_, point) => ground(points[point * 2]!, points[point * 2 + 1]!, REACH, true));
      group = { years, points: Array.from(points), through: shape?.through ?? cameraNow(last?.inset ?? 0), anchors };
      groupChip.label.textContent = groupChip.text = chip;
      [groupChip.width, groupChip.height] = [groupChip.label.offsetWidth, groupChip.label.offsetHeight];
    } else {
      // (The bytes stay as they were while the gray goes out.)
      group = undefined;
      stats.group = 0;
    }
    // A release that got its rows, or none, or was let go: no shape.
    if (!shape || shape.closed) shape = undefined;
    [grayTo, grayAt] = [group ? 1 : 0, now];
    dirty = true;
  };

  const tick = (now: number) => {
    requestAnimationFrame(tick);
    // A drawn group's work, a frame's worth; and the group, when it changed.
    const changes = host.pick();
    if (changes !== groupChanges) {
      groupChanges = changes;
      regroup(now);
    }
    if (grayed !== grayTo) {
      const step = Math.max(0, now - grayAt) / GRAY.ms;
      grayed = grayTo > grayed ? Math.min(grayTo, grayed + step) : Math.max(grayTo, grayed - step);
      grayAt = now;
      dirty = true;
    }
    const frame = ask(now);
    // The camera is a hand's only in space, at rest in the fixed frame or
    // in the one that turns: a flight of the scene's own takes it, and a
    // glide ends there. (The roll's ease, once begun, goes on to its end.)
    if (frame.flight > 0 || frame.ride > 0) hand.rest();
    if (frame.flight > 0 || frame.ride < 1) rideHand.rest();
    chased(frame, now);
    const stepped = [hand.step(now), rideHand.step(now)];
    // (After the step: a flight that landed in it is followed from here.)
    const followed = follow(frame);
    if (stepped[0] || stepped[1] || followed) dirty = true;
    [stats.chase, stats.finds] = [chase, foundFinds];
    moving();
    if (dirty || !last || moved(frame, last)) render(frame);
  };
  requestAnimationFrame(tick);
  // The Sun, Jupiter, and its orbit are up before the asteroids arrive.
  render(ask(performance.now()));

  return {
    stats,
    setBelt(rows) {
      if (belt) throw new Error('the belt has its room already');
      // A buffer for each column, `rows` floats long, the scene's own (not
      // Three.js's: it would keep each array it uploads, and these are
      // filled a block at a time from views that don't last).
      const buffers = COLUMNS.map(() => {
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, rows * 4, gl.STATIC_DRAW);
        return buffer;
      });
      // And a byte a row for a drawn group: none in one, until one is drawn.
      const picked = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, picked);
      gl.bufferData(gl.ARRAY_BUFFER, rows, gl.DYNAMIC_DRAW);
      // One geometry for the belt, drawn as far as its rows are in; for
      // rows drawn alone, one a row, each a draw of that one point from
      // the same buffers, once its block is in.
      const ranges: [number, number][] = alone ? alone.map((row) => [row, 1]) : [[0, 0]];
      const draws = ranges.map(([start, count]) => {
        if (start >= rows) throw new Error(`?only: no row ${start}; there are ${rows}`);
        const geometry = new BufferGeometry<NormalOrGLBufferAttributes>();
        COLUMNS.forEach((attribute, column) => geometry.setAttribute(attribute, new GLBufferAttribute(buffers[column]!, gl.FLOAT, 1, 4, rows)));
        geometry.setAttribute('picked', new GLBufferAttribute(picked, gl.UNSIGNED_BYTE, 1, 1, rows));
        // No `position` attribute to count by: the range says how many.
        geometry.setDrawRange(start, count);
        const points = new Points(geometry, material);
        points.frustumCulled = false;
        points.visible = false;
        dust.add(points);
        return points;
      });
      belt = { rows, buffers, picked, draws };
    },
    addRows(blocks, through, now) {
      if (!belt) throw new Error('rows before the belt has its room');
      // Everything the crate is asked comes first (with the last rows,
      // the two groups its integration moves); then the views, read
      // where the crate keeps each block, and their upload, in one go.
      if (through === belt.rows && integrates && !integrated) integrate();
      const frame = now ? ask(performance.now()) : undefined;
      let at = stats.rows;
      for (const columns of blocks()) {
        const count = columns[0]?.length ?? 0;
        if (columns.length !== COLUMNS.length || columns.some((view) => view.length !== count) || at + count > belt.rows) throw new Error(`the scene wants seven columns of a block's rows, ${belt.rows} rows in all`);
        columns.forEach((view, column) => {
          gl.bindBuffer(gl.ARRAY_BUFFER, belt!.buffers[column]!);
          gl.bufferSubData(gl.ARRAY_BUFFER, at * 4, view);
        });
        at += count;
      }
      if (at !== through) throw new Error(`the scene was given rows up to ${at}, not ${through}`);
      shown(belt, through);
      if (frame) render(frame);
      else dirty = true;
    },
    clearBelt() {
      if (!belt) return;
      // Its room goes with it: the draws, their geometries, the buffers.
      shown(belt, 0);
      for (const points of belt.draws) {
        dust.remove(points);
        points.geometry.dispose();
      }
      for (const buffer of [...belt.buffers, belt.picked]) gl.deleteBuffer(buffer);
      belt = undefined;
      if (integrated) {
        for (const points of integrated.draws) {
          dust.remove(points);
          points.geometry.dispose();
        }
        gl.deleteBuffer(integrated.places);
        integrated = undefined;
        material.uniforms.uIntegrated!.value = 0;
      }
      dirty = true;
    },
    wantsSky: !alone && on('sky'),
    setSky(file) {
      sky = createSky(file);
      sky.setPixelRatio(pixelRatio);
      sky.setFade(skyLeft);
      dust.add(sky.points);
      stats.stars = sky.stars;
      // Drawn now, so the caller's mark is of stars on screen.
      render(ask(performance.now()));
    },
    press() {
      hand.press();
      rideHand.press();
      moving();
    },
    dragStart(x, y, button, modifiers, frame) {
      dragging = handOf(frame);
      panning = button === 0 && !(modifiers & SHIFT);
      dragging?.dragStart(x, y, button, modifiers, performance.now());
    },
    dragMove(x, y) {
      // A pan lets a followed row go: the camera is the hand's again.
      if (dragging === hand && panning && chase === 'following') chase = '';
      dragging?.dragMove(x, y, performance.now());
    },
    dragEnd(x, y) {
      dragging?.dragEnd(x, y, performance.now());
      dragging = undefined;
      moving();
    },
    wheel: (x, y, delta, modifiers, frame) => handOf(frame)?.wheel(x, y, delta, modifiers, performance.now()),
    doubleClick(x, y, frame) {
      handOf(frame)?.zoomIn(x, y, performance.now());
      if (moving()) dirty = handMoved = true;
    },
    nudge(right, up, frame) {
      // (An arrow is a pan: it lets a followed row go.)
      if (handOf(frame) === hand && chase === 'following') chase = '';
      handOf(frame)?.nudge(right, up, performance.now());
      if (moving()) handMoved = true;
    },
    zoomStep(nearer, frame) {
      handOf(frame)?.zoomStep(nearer, performance.now());
      if (moving()) handMoved = true;
    },
    home(frame) {
      // The ride's own camera, as the ride opens: straight above the Sun,
      // unturned, as far as the panel leaves it room for.
      // (Asked for at each step: the panel may slide on the way.)
      if (frame === 1) handOf(frame)?.fly(() => ({ x: 0, y: 0, distance: rideDistance(insetNow), tilt: 0, bearing: 0 }), performance.now());
      // The way back from a found row too: the camera stops following,
      // and the row stays marked.
      else if (handOf(frame)?.fly(() => opened, performance.now())) chase = '';
      moving();
    },
    // (The outline is the page's own line: it's written here, and no dot
    // is drawn again for it.)
    drawStart(x, y) {
      shape = { points: [x, y], closed: false };
      if (last && !alone) outline(last);
    },
    drawMove(x, y) {
      if (!shape || shape.closed) return;
      shape.points.push(x, y);
      // (A point more on a line already drawn is that much more of it
      // written: not every point again, at each one.)
      if (outlineD && outlineDrawn && !alone) outlineLine.setAttribute('d', (outlineD += `L${x} ${y}`));
      else if (last && !alone) outline(last);
    },
    drawEnd(closed) {
      if (!shape) return;
      if (closed) {
        const points = shape.points;
        // Where each point's ray meets the ecliptic, through the camera
        // the crate picks through: the outline is kept there.
        shape = { points, closed, through: cameraNow(last?.inset ?? 0), anchors: Array.from({ length: points.length / 2 }, (_, point) => ground(points[point * 2]!, points[point * 2 + 1]!, REACH, true)) };
      } else shape = undefined;
      if (last && !alone) outline(last);
    },
    outline: () => (outlineDrawn && !names.hidden && space > 0 ? outlineDrawn : undefined),
    viewProjection() {
      place(last?.inset ?? 0, last?.ride);
      return [...new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements, innerWidth, innerHeight];
    },
    under: (x, y) => ground(x, y, Infinity, false),
    labels: () => allNames.map((named) => ({ text: named.text, left: named.left, top: named.top, width: named.width, height: named.height, shown: named.shown && !names.hidden && space > 0 })),
    triangle: () => (triangleShown && !names.hidden && space > 0 ? corners : undefined),
    marker: () => (markerDrawn && !names.hidden && space > 0 ? markerDrawn : undefined),
    found: () => (foundDrawn && !names.hidden && space > 0 ? foundDrawn : undefined),
  };
}
