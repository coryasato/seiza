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
// For the checks and for looking (the page's query): the camera, `?az`,
// `?elev`, `?roll` (degrees), `?dist` (au), `?at=<x>,<y>` (what it looks
// at, on the ecliptic, au); `?scale` (the scene's pixels for each of the
// display's); `?only=<row>,<row>` (those rows alone, as plain discs
// `?size` CSS px across, with no Sun, Jupiter, sky, haze, or bloom;
// `?hard=0` draws them as the belt's dots are); `?marks` (lines from the
// Sun toward Jupiter, 60° either side of it, and opposite);
// `?band=<au>,<au>` (the orbit sizes that stay lit, `?bandGain` times as
// bright, the rest dimmed); `?alpha` (a dot's opacity); `?sky=0` (no
// stars); and the look's own (`look.ts`).
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, GLBufferAttribute, LineBasicMaterial, LineLoop, LineSegments, Matrix4, Mesh, NormalBlending, PerspectiveCamera, PlaneGeometry, Points, Scene, ShaderMaterial, Vector2, Vector3, Vector4, WebGLRenderer, type NormalOrGLBufferAttributes } from 'three';
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
  /** The sort flight in the last frame drawn: 0 in space, 1 landed. */
  flight: number;
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
  /** A wheel over the scene, at a window position: zooms. (The interface
   *  hands none over while the dots are out of space.) */
  wheel(x: number, y: number, delta: number): void;
  /** Projection × view (column-major), then the window's width and height. */
  viewProjection(): number[];
  /** The names the scene draws, and where (CSS px). */
  labels(): { text: string; left: number; top: number; width: number; height: number; shown: boolean }[];
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

/** The belt's dots, their tints through a ramp of `stops` stops. Every
 *  color here is linear light, written as it is into the look's buffer. */
const vertex = (stops: number) => /* glsl */ `
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
  // 1 for a row drawn alone as a plain disc: one size, one color.
  uniform float uHard;
  uniform vec3 uPlain;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vGrow;
  ${PLACE}
  ${FLIGHT}

  void main() {
    // A row with no ellipse (e not below 1) has no place on one: no dot.
    if (!(a > 0.0) || !(e < 1.0)) {
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
    vec3 tint = uRamp[0];
    for (int k = 0; k < ${stops - 1}; k++) {
      tint = mix(tint, uRamp[k + 1], clamp((a - uStops[k]) / (uStops[k + 1] - uStops[k]), 0.0, 1.0));
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
 *  90°), turned 34° about its line of sight so the belt runs corner to
 *  corner (`docs/DECISIONS.md`, "Look"). The crate's test of the shader's
 *  arithmetic counts pixels from a copy of this camera and `FOV`
 *  (`crate/src/shader.rs`, `on_screen`): change them together. */
const OPENING = { az: 200, elev: 24, roll: -34, dist: 13 };
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
  const AZIMUTH = (knob('az', OPENING.az) * Math.PI) / 180;
  const ELEVATION = (knob('elev', OPENING.elev) * Math.PI) / 180;
  const ROLL = (knob('roll', OPENING.roll) * Math.PI) / 180;
  const scale = knob('scale', 1);
  const alone = only();
  // `?flight=<0 to 1>`: the sort flight held there, for a screenshot.
  if (has('flight')) host.holdFlight(knob('flight', 0));
  /** Rows drawn alone are plain discs, to be found in a screenshot. */
  const hard = !!alone && on('hard');
  const marked = has('marks');

  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const stats: SceneStats = { frames: 0, years: 0, rows: 0, points: 0, stars: 0, renderer: String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), distance: knob('dist', OPENING.dist), flight: 0 };
  const look = createLook(renderer, PAGE, !!alone);

  // The dust is the rows and the sky; the bodies are what the scene adds.
  // The look draws them apart, so its haze is the dust's alone.
  const dust = new Scene();
  const bodies = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.01, 1000);
  /** What the camera looks at. */
  const target = new Vector3(...inScene(...lookedAt(), 0));
  /** The scene's pixels for each CSS pixel. */
  let pixelRatio = 1;
  /** Something changed that the next frame must draw. */
  let dirty = true;
  let sky: Sky | undefined;

  // What the scene adds: plainly not dots. None of it beside rows drawn alone.
  // Jupiter's orbit first, so the discs are drawn over it.
  const turn = host.jupiterOrbit();
  const orbit = new Float32Array(turn.length);
  for (let at = 0; at < turn.length; at += 3) orbit.set(inScene(turn[at]!, turn[at + 1]!, turn[at + 2]!), at);
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
  const name = (text: string) => {
    const label = document.createElement('div');
    label.textContent = text;
    // Out of sight but laid out, so its size can be read.
    label.style.visibility = 'hidden';
    names.append(label);
    return { label, text, left: 0, top: 0, width: 0, height: 0, shown: false };
  };
  const sunName = name('Sol');
  const jupiterName = name('Jupiter');
  if (alone) names.hidden = true;
  // A name's size is read here and kept, never in a frame (a read there is
  // a layout every frame): now, and again when the interface's face
  // arrives, which changes it and so where a centered name goes.
  const measure = () => {
    for (const named of [sunName, jupiterName]) [named.width, named.height] = [named.label.offsetWidth, named.label.offsetHeight];
    dirty = true;
  };
  measure();
  document.fonts.addEventListener('loadingdone', measure);

  // Color is orbit size: the crate's table, which the legend is drawn from.
  const ramp = host.ramp();
  const stops = ramp.length / 4;
  const material = new ShaderMaterial({
    vertexShader: vertex(stops),
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
      uFlight: { value: 0 },
      uAxes: { value: new Vector4(...Array.from(host.axes())) },
      uPlot: { value: new Vector4() },
    },
    blending: hard ? NormalBlending : AdditiveBlending,
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

  /** The camera where it is now, centered in what a panel `inset` px wide leaves. */
  const place = (inset: number) => {
    camera.aspect = innerWidth / innerHeight;
    // The panel covers the window's right `inset` px: the picture moves
    // left by half of it.
    if (inset > 0) camera.setViewOffset(innerWidth, innerHeight, inset / 2, 0, innerWidth, innerHeight);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    const toward = new Vector3(Math.cos(ELEVATION) * Math.sin(AZIMUTH), Math.sin(ELEVATION), Math.cos(ELEVATION) * Math.cos(AZIMUTH));
    camera.position.copy(target).addScaledVector(toward, stats.distance);
    // Straight down, "up" is the way the camera would face from the side.
    const up = Math.cos(ELEVATION) < 1e-3 ? new Vector3(-Math.sin(AZIMUTH), 0, -Math.cos(AZIMUTH)) : new Vector3(0, 1, 0);
    camera.up.copy(up.applyAxisAngle(toward, ROLL));
    camera.lookAt(target);
    camera.updateMatrixWorld();
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
  const put = (named: ReturnType<typeof name>, at: Vector3, dx: (width: number) => number, dy: number) => {
    const where = onScreen(at);
    const inside = !!where && where[0] >= 0 && where[0] <= innerWidth && where[1] >= 0 && where[1] <= innerHeight;
    if (named.shown !== inside) named.label.style.visibility = inside ? 'visible' : 'hidden';
    named.shown = inside;
    if (!where || !inside) return;
    named.left = Math.round(where[0] + dx(named.width));
    named.top = Math.round(where[1] + dy);
    named.label.style.transform = `translate(${named.left}px, ${named.top}px)`;
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
  /** Asks the crate. Nothing here may run between making the views over
   *  its memory and uploading them: a call into the wasm can grow it. */
  const ask = (now: number): Frame => {
    const [years, inset, changes, flight, space] = [host.years(now), host.inset(), host.scrimChanges(), host.flight(now), host.space()];
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
    return { years, inset, scrim, flight, space, plot, jupiter: jupiter_ };
  };
  // Landed, time moves no dot: of the clock, only the way back draws.
  const moved = (frame: Frame, from: Frame) =>
    (frame.years !== from.years && frame.flight < 1) || frame.inset !== from.inset || frame.scrim !== from.scrim || frame.flight !== from.flight || frame.plot !== from.plot;
  /** What isn't a row, as it leaves the picture and returns: the sky, the
   *  Sun, Jupiter, its orbit, the marks, and the names; and the haze,
   *  which on the axes would light the gaps. */
  let space = 1;
  const leave = (left: number) => {
    sun.material.uniforms.uFade!.value = left;
    jupiter.material.uniforms.uFade!.value = left;
    orbitLine.opacity = left;
    if (marks) marks.material.opacity = 0.55 * left;
    sky?.setFade(left);
    look.setHaze(left);
    if (left !== space) names.style.opacity = String(left);
    space = left;
  };

  const render = (frame: Frame) => {
    dirty = false;
    last = frame;
    place(frame.inset);
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
    (material.uniforms.uPlot!.value as Vector4).set(...frame.plot);
    leave(frame.space);
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
      put(jupiterName, jupiter.position, () => JUPITER_PX / 2 + 8, -9);
    }
    // `?glass`: the blur behind the panel is as wide as the panel is now.
    if (glass && frame.inset !== glassWidth) glass.style.width = `${(glassWidth = frame.inset)}px`;
    stats.frames++;
    stats.years = frame.years;
    stats.flight = frame.flight;
  };
  /** The belt's room on the GPU: a buffer a column, and what draws from them. */
  interface Belt {
    rows: number;
    buffers: WebGLBuffer[];
    draws: Points<BufferGeometry<NormalOrGLBufferAttributes>>[];
  }
  let belt: Belt | undefined;
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
  const tick = (now: number) => {
    requestAnimationFrame(tick);
    const frame = ask(now);
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
      // One geometry for the belt, drawn as far as its rows are in; for
      // rows drawn alone, one a row, each a draw of that one point from
      // the same buffers, once its block is in.
      const ranges: [number, number][] = alone ? alone.map((row) => [row, 1]) : [[0, 0]];
      const draws = ranges.map(([start, count]) => {
        if (start >= rows) throw new Error(`?only: no row ${start}; there are ${rows}`);
        const geometry = new BufferGeometry<NormalOrGLBufferAttributes>();
        COLUMNS.forEach((attribute, column) => geometry.setAttribute(attribute, new GLBufferAttribute(buffers[column]!, gl.FLOAT, 1, 4, rows)));
        // No `position` attribute to count by: the range says how many.
        geometry.setDrawRange(start, count);
        const points = new Points(geometry, material);
        points.frustumCulled = false;
        points.visible = false;
        dust.add(points);
        return points;
      });
      belt = { rows, buffers, draws };
    },
    addRows(blocks, through, now) {
      if (!belt) throw new Error('rows before the belt has its room');
      // Everything the crate is asked comes first; then the views, read
      // where the crate keeps each block, and their upload, in one go.
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
      for (const buffer of belt.buffers) gl.deleteBuffer(buffer);
      belt = undefined;
      dirty = true;
    },
    wantsSky: !alone && on('sky'),
    setSky(file) {
      sky = createSky(file);
      sky.setPixelRatio(pixelRatio);
      sky.setFade(space);
      dust.add(sky.points);
      stats.stars = sky.stars;
      // Drawn now, so the caller's mark is of stars on screen.
      render(ask(performance.now()));
    },
    wheel(_x, _y, delta) {
      stats.distance = Math.min(60, Math.max(0.05, stats.distance * Math.exp(-delta * 0.002)));
      dirty = true;
    },
    viewProjection() {
      place(last?.inset ?? 0);
      return [...new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements, innerWidth, innerHeight];
    },
    under(x, y) {
      place(last?.inset ?? 0);
      const eye = camera.position;
      const ray = new Vector3((2 * x) / innerWidth - 1, 1 - (2 * y) / innerHeight, 0.5).unproject(camera).sub(eye);
      // Level with the ecliptic or away from it: the ray never meets it.
      if (!(ray.y * eye.y < 0)) return undefined;
      const reach = -eye.y / ray.y;
      return [eye.x + ray.x * reach, -(eye.z + ray.z * reach)];
    },
    labels: () =>
      [sunName, jupiterName].map((named) => ({ text: named.text, left: named.left, top: named.top, width: named.width, height: named.height, shown: named.shown && !names.hidden && space > 0 })),
  };
}
