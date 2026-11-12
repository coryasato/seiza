// The scene: the belt as one draw of points, each row's orbit solved in the
// vertex shader from its six elements, which the crate holds (its
// attributes are views over the elements' columns in the wasm's memory, so
// the upload to the GPU is the only copy). With it, what the scene adds
// that isn't a row, and plainly isn't a dot: the Sun, Jupiter on its own
// orbit (the crate's, not a row's), that orbit as a line, and their names.
//
// On a canvas of its own under GPUI's, loaded after GPUI's first frame. It
// draws only when something changed: the clock, the camera, the panel's
// width, the window.
//
// Not here yet: the look (linear light, a dot's brightness from its H, the
// haze, the bloom, the Sun's glow), color by orbit size, and the sky. Until
// then every dot is the same pale dust.
//
// For the checks and for looking (the page's query): the camera, `?az`,
// `?elev`, `?roll` (degrees), `?dist` (au); `?scale` (the scene's pixels
// for each of the display's); `?only=<row>,<row>` (those rows alone, as
// plain discs `?size` CSS px across, and no Sun or Jupiter); `?marks`
// (lines from the Sun toward Jupiter, 60° either side of it, and
// opposite); `?band=<au>,<au>` (the orbit sizes that stay lit, `?bandGain`
// times as bright, the rest dimmed).
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineLoop, LineSegments, Matrix4, NormalBlending, PerspectiveCamera, Points, Scene, ShaderMaterial, Vector3, Vector4, WebGLRenderer } from 'three';

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
}

export interface SceneStats {
  /** Frames drawn. */
  frames: number;
  /** The clock's years in the last frame drawn. */
  years: number;
  /** The rows the scene was given; 0 until the belt is in. */
  rows: number;
  /** The points it draws them as: every row (a row with no ellipse is
   *  turned away in the shader), or `?only`'s. */
  points: number;
  renderer: string;
  /** The camera's distance from what it looks at, au. */
  distance: number;
}

export interface BeltScene {
  /** The belt's rows. `columns` makes views over the crate's six columns
   *  (a, e, i, the node, the argument of perihelion, the mean anomaly:
   *  au and degrees), `rows` long each; they're uploaded to the GPU before
   *  this returns and not read again, since the wasm's memory growing
   *  detaches them. */
  setElements(columns: () => Float32Array[], rows: number): void;
  /** A wheel over the scene, at a window position: zooms. */
  wheel(x: number, y: number, delta: number): void;
  /** Projection × view (column-major), then the window's width and height. */
  viewProjection(): number[];
  /** The names the scene draws, and where (CSS px). */
  labels(): { text: string; left: number; top: number; width: number; height: number; shown: boolean }[];
  stats: SceneStats;
}

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

const VERTEX = /* glsl */ `
  uniform float uSize;
  // The page's band knob: the orbit sizes (au, x to y) that stay lit, w
  // times as bright; the rest z of a dot's opacity. No band at y 0.
  uniform vec4 uBand;
  varying float vAlpha;
  ${PLACE}

  void main() {
    // A row with no ellipse (e not below 1) has no place on one: no dot.
    if (!(a > 0.0) || !(e < 1.0)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    vec3 at = place();
    // The ecliptic is the scene's xz plane.
    gl_Position = projectionMatrix * modelViewMatrix * vec4(at.x, at.z, -at.y, 1.0);
    gl_PointSize = uSize;
    vAlpha = 1.0;
    if (uBand.y > 0.0) vAlpha = a >= uBand.x && a <= uBand.y ? uBand.w : uBand.z;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  // 1 for a disc with a hard edge (a row drawn alone), 0 for soft dust.
  uniform float uHard;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    gl_FragColor = vec4(uColor, uAlpha * vAlpha * mix(1.0 - d, 1.0, uHard));
    // A color is held in linear light: written as the display's.
    #include <colorspace_fragment>
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
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    gl_FragColor = vec4(uColor, 1.0 - d * d * d);
    #include <colorspace_fragment>
  }
`;

/** The page's background (`index.html`). */
const PAGE = 0x05060a;
/** Every dot, until color is orbit size. */
const DUST = 0xdcd8d0;
const FOV = 40;
/** The opening camera: it looks at the Sun from 13 au, 24° above the
 *  ecliptic, from ecliptic longitude 270° + `az` (at 0 it faces longitude
 *  90°), turned 34° about its line of sight so the belt runs corner to
 *  corner (`docs/DECISIONS.md`, "Look"). The crate's test of the shader's
 *  arithmetic counts pixels from a copy of this camera and `FOV`
 *  (`crate/src/shader.rs`, `on_screen`): change them together. */
const OPENING = { az: 200, elev: 24, roll: -34, dist: 13 };
/** The discs, CSS px across. */
const SUN_PX = 14;
const JUPITER_PX = 8;

const query = new URLSearchParams(location.search);
/** A number from the page's query, or `otherwise`; anything else there is
 *  the page's error, not a default taken without a word. */
function knob(name: string, otherwise: number): number {
  const given = query.get(name);
  if (given === null) return otherwise;
  const value = Number(given);
  if (given === '' || !Number.isFinite(value)) throw new Error(`?${name} wants a number; got "${given}"`);
  return value;
}
/** A list from the page's query, as numbers. An empty entry is no number
 *  (`Number('')` is 0, which would pass for row 0 or 0 au). */
const numbers = (given: string): number[] => given.split(',').map((entry) => (entry.trim() === '' ? NaN : Number(entry)));
/** `?band=<au>,<au>`: two orbit sizes, the smaller first. */
function band(): [number, number] {
  const given = query.get('band');
  if (given === null) return [0, 0];
  const [from, to, ...more] = numbers(given);
  if (more.length ||!(from! >= 0) || !(to! > from!) || !Number.isFinite(to)) throw new Error(`?band wants two orbit sizes in au, the smaller first; got "${given}"`);
  return [from!, to!];
}
/** `?only=<row>,<row>`: the rows drawn alone. */
function only(): number[] | undefined {
  const given = query.get('only');
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
  const marked = query.has('marks');

  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(new Color(PAGE));
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const stats: SceneStats = { frames: 0, years: 0, rows: 0, points: 0, renderer: String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), distance: knob('dist', OPENING.dist) };

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.01, 1000);
  /** What the camera looks at. */
  const target = new Vector3();
  /** The scene's pixels for each CSS pixel. */
  let pixelRatio = 1;
  /** Something changed that the next frame must draw. */
  let dirty = true;

  // What the scene adds: plainly not dots. None of it beside rows drawn alone.
  const bodies = new Scene();
  const body = (px: number, color: number) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    const material = new ShaderMaterial({ vertexShader: BODY_VERTEX, fragmentShader: BODY_FRAGMENT, uniforms: { uSize: { value: px }, uColor: { value: new Color(color) } }, transparent: true, depthTest: false });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    bodies.add(points);
    return { points, material, px };
  };
  // Jupiter's orbit first, so the discs are drawn over it.
  const turn = host.jupiterOrbit();
  const orbit = new Float32Array(turn.length);
  for (let at = 0; at < turn.length; at += 3) orbit.set(inScene(turn[at]!, turn[at + 1]!, turn[at + 2]!), at);
  const orbitGeometry = new BufferGeometry();
  orbitGeometry.setAttribute('position', new BufferAttribute(orbit, 3));
  bodies.add(new LineLoop(orbitGeometry, new LineBasicMaterial({ color: 0x3a4152, transparent: true })));
  const sun = body(SUN_PX, 0xfff3d6);
  const jupiter = body(JUPITER_PX, 0xd9b38c);
  // `?marks`: white, as what the interface adds.
  const marks = marked ? new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xfafafa, transparent: true, opacity: 0.55, depthTest: false })) : undefined;
  if (marks) {
    marks.geometry.setAttribute('position', new BufferAttribute(new Float32Array(4 * 2 * 3), 3));
    marks.frustumCulled = false;
    bodies.add(marks);
  }

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
  const sunName = name('Sun');
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

  const dust = (hard: boolean) =>
    new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uYears: { value: [0, 0] },
        uSize: { value: 0 },
        uColor: { value: new Color(DUST) },
        uAlpha: { value: hard ? 1 : knob('alpha', 0.07) },
        uHard: { value: hard ? 1 : 0 },
        uBand: { value: new Vector4(...band(), 0.12, knob('bandGain', 1)) },
      },
      blending: hard ? NormalBlending : AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
  const material = dust(!!alone);
  /** A dot's size, CSS px: dust, or a row drawn alone, big enough to find. */
  const dotPx = knob('size', alone ? 9 : 1.5);

  const resize = () => {
    pixelRatio = devicePixelRatio * scale;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(innerWidth, innerHeight, false);
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
    /** Jupiter's place, in the ecliptic's axes. */
    jupiter: [number, number, number];
  }
  let last: Frame | undefined;
  /** Asks the crate. Nothing here may run between making the views over
   *  its memory and uploading them: a call into the wasm can grow it. */
  const ask = (now: number): Frame => {
    const [years, inset] = [host.years(now), host.inset()];
    if (last && last.years === years) return { years, inset, jupiter: last.jupiter };
    const at = host.jupiter(years);
    return { years, inset, jupiter: [at[0]!, at[1]!, at[2]!] };
  };

  const render = (frame: Frame) => {
    dirty = false;
    last = frame;
    place(frame.inset);
    const whole = Math.floor(frame.years);
    material.uniforms.uYears!.value = [whole, frame.years - whole];
    material.uniforms.uSize!.value = dotPx * pixelRatio;
    sun.material.uniforms.uSize!.value = sun.px * pixelRatio;
    jupiter.material.uniforms.uSize!.value = jupiter.px * pixelRatio;
    jupiter.points.position.set(...inScene(...frame.jupiter));
    if (marks) {
      const longitude = Math.atan2(frame.jupiter[1], frame.jupiter[0]);
      const points = marks.geometry.getAttribute('position') as BufferAttribute;
      [0, 60, -60, 180].forEach((ahead, ray) => {
        const toward = longitude + (ahead * Math.PI) / 180;
        // From 0.6 au out (clear of the Sun) to past Jupiter's orbit.
        points.setXYZ(ray * 2, ...inScene(0.6 * Math.cos(toward), 0.6 * Math.sin(toward), 0));
        points.setXYZ(ray * 2 + 1, ...inScene(6.2 * Math.cos(toward), 6.2 * Math.sin(toward), 0));
      });
      points.needsUpdate = true;
    }
    renderer.autoClear = true;
    renderer.render(scene, camera);
    if (!alone) {
      renderer.autoClear = false;
      renderer.render(bodies, camera);
      // Board 1: the Sun's name under it, Jupiter's beside it.
      put(sunName, sun.points.position, (width) => -width / 2, SUN_PX / 2 + 6);
      put(jupiterName, jupiter.points.position, () => JUPITER_PX / 2 + 8, -9);
    }
    stats.frames++;
    stats.years = frame.years;
  };
  const tick = (now: number) => {
    requestAnimationFrame(tick);
    const frame = ask(now);
    if (dirty || !last || frame.years !== last.years || frame.inset !== last.inset) render(frame);
  };
  requestAnimationFrame(tick);
  // The Sun, Jupiter, and its orbit are up before the asteroids arrive.
  render(ask(performance.now()));

  return {
    stats,
    setElements(columns, rows) {
      // Everything the crate is asked comes first; then the views, read
      // where the crate keeps the columns, and their upload, in one go.
      const frame = ask(performance.now());
      const views = columns();
      if (views.length !== 6 || views.some((view) => view.length !== rows)) throw new Error(`the scene wants six columns of ${rows} rows`);
      const attributes = ['a', 'e', 'inc', 'node', 'peri', 'mean'].map((attribute, column) => [attribute, new BufferAttribute(views[column]!, 1)] as const);
      // One geometry for the belt; for rows drawn alone, one a row, each a
      // draw of that one point from the same buffers.
      const ranges: [number, number][] = alone ? alone.map((row) => [row, 1]) : [[0, rows]];
      for (const [start, count] of ranges) {
        if (start >= rows) throw new Error(`?only: no row ${start}; there are ${rows}`);
        const geometry = new BufferGeometry();
        for (const [attribute, buffer] of attributes) geometry.setAttribute(attribute, buffer);
        // No `position` attribute to count by: the range says how many.
        geometry.setDrawRange(start, count);
        const points = new Points(geometry, material);
        points.frustumCulled = false;
        scene.add(points);
      }
      stats.rows = rows;
      stats.points = ranges.reduce((sum, [, count]) => sum + count, 0);
      render(frame);
    },
    wheel(_x, _y, delta) {
      stats.distance = Math.min(60, Math.max(0.05, stats.distance * Math.exp(-delta * 0.002)));
      dirty = true;
    },
    viewProjection() {
      place(last?.inset ?? 0);
      return [...new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements, innerWidth, innerHeight];
    },
    labels: () =>
      [sunName, jupiterName].map((named) => ({ text: named.text, left: named.left, top: named.top, width: named.width, height: named.height, shown: named.shown && !names.hidden })),
  };
}
