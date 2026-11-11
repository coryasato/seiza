// Throwaway: the scene. The belt as one draw of points whose vertex shader
// solves each orbit (Kepler's equation, from the six elements a row the
// crate holds), colored by a through the storyboard's ramp; the Sun,
// Jupiter, and Jupiter's orbit as stand-ins. The same shader flies each dot
// between its place in space and a against e (the sort flight), and grays
// every dot outside a drawn group. The camera flies in to a group and back.
// It draws only when something changed: the clock moved, the dots or the
// camera are in flight, the panel moved, the window resized.
//
// With none of the look's knobs (src/look.ts) it draws as it did before
// the look was tried: straight to the canvas, in the display's own values.
// With any of them, into the look's pipeline.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { ORBIT_SIZE, RAMP_GLSL, mapUniforms } from './colors.ts';
import { createPipeline, knob, readLook } from './look.ts';
import { PROFILE_GLSL, createStars, type Stars } from './stars.ts';

/** What the scene asks of the crate, which owns the clock, the sort
 *  flight, and the panel. */
export interface SceneHost {
  /** The clock in years, moved on to `now` (the page clock). */
  years(now: number): number;
  /** The sort flight's progress, moved on to `now`: 0 in space, 1 landed. */
  flight(now: number): number;
  /** The panel's width on screen (CSS px). */
  inset(): number;
  /** Whether the clock or the flight has a frame to draw. */
  moves(): boolean;
  /** The camera arrived where it was flown to. */
  flown(): void;
}

export interface SceneStats {
  /** Frames drawn. */
  frames: number;
  /** Each drawn frame's `[page time, ms in render()]`. */
  draws: [number, number][];
  rows: number;
  /** Stars drawn. */
  stars: number;
  renderer: string;
  distance: number;
  /** The camera is flying. */
  flying: boolean;
}

export interface BeltScene {
  /** The belt's rows: six f32s each (a, e, i degrees; node, perihelion,
   *  anomaly radians), and with the look's `mag`, each row's H. Uploaded
   *  to the GPU before it returns; neither is read again. */
  setElements(elements: Float32Array, rows: number, magnitudes?: Float32Array): void;
  /** The sky: `data.ts`'s stars.bin. */
  setStars(file: ArrayBuffer): void;
  /** A wheel over the scene, at a window position: zooms. */
  wheel(x: number, y: number, delta: number): void;
  /** Projection × view (column-major), then the window's width and height. */
  viewProjection(): Float32Array;
  /** Flies until a sphere fills what a panel `inset` px wide leaves. */
  flyTo(center: [number, number, number], radius: number, inset: number, ms: number): void;
  /** Flies back to the whole belt. */
  flyHome(ms: number): void;
  /** A byte a row, 255 for a row of the drawn group; empty for no group.
   *  Copied before it returns. */
  setPicked(picked: Uint8Array): void;
  /** The closed shape in window px (x then y), kept on the ecliptic from
   *  here on; empty for none. */
  setOutline(points: Float32Array): void;
  /** For `look.ts`: `frames` frames drawn back to back with the clock
   *  moving, each waited on until the GPU finished it (a pixel read back).
   *  The ms a frame: median, and the 90th percentile. */
  bench(frames: number): [number, number];
  stats: SceneStats;
}

/** a against e, as the storyboard's boards 3 and 4 draw it at 1440×900:
 *  a 1.5 to 5.5 au from 80 px to 80 px short of the right edge (or of the
 *  panel), e 0 to 0.6 from 129 px above the bottom up to 96 px. */
const PLOT = { a: [1.5, 5.5], e: [0, 0.6], left: 80, right: 80, top: 96, bottom: 129 } as const;

const VERTEX = /* glsl */ `
  uniform float uYears;
  uniform float uSize;
  // The sort flight, 0 in space to 1 landed; and a against e's corners in
  // clip space: (a 1.5, e 0) then (a 5.5, e 0.6).
  uniform float uFlight;
  uniform vec4 uPlot;
  // 1 while a group is drawn: every other dot is gray.
  uniform float uGroup;
  uniform float uGray;
  attribute vec3 angles;
  attribute float picked;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vGrow;
  #ifdef MAG
    // A row's H. The H a dot of the plain brightness and size has, then
    // the exponents of brightness and of size on the row's flux, and the
    // most a dot grows; and the least brightness, so every row is drawn.
    attribute float mag;
    uniform vec4 uMag;
    uniform float uLeast;
    uniform float uDistance;
  #endif
  const float TAU = 6.283185307179586;
  ${RAMP_GLSL}

  void main() {
    float a = position.x;
    float e = position.y;
    // An unbound orbit (5 of the sample's rows) has no place on an ellipse.
    if (!(a > 0.0) || !(e < 1.0)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float inc = radians(position.z);
    // Years for one orbit: a^1.5 (Kepler's third law, a in au).
    float M = mod(angles.z + TAU / (a * sqrt(a)) * uYears, TAU);
    float E = M + e * sin(M);
    for (int k = 0; k < ITERS; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    float xo = a * (cos(E) - e);
    float yo = a * sqrt(1.0 - e * e) * sin(E);
    float co = cos(angles.x), so = sin(angles.x);
    float cw = cos(angles.y), sw = sin(angles.y);
    float ci = cos(inc), si = sin(inc);
    float X = (co * cw - so * sw * ci) * xo + (-co * sw - so * cw * ci) * yo;
    float Y = (so * cw + co * sw * ci) * xo + (-so * sw + co * cw * ci) * yo;
    float Z = sw * si * xo + cw * si * yo;
    // The ecliptic is the scene's xz plane.
    gl_Position = projectionMatrix * modelViewMatrix * vec4(X, Z, -Y, 1.0);
    float depth = gl_Position.w;
    if (uFlight > 0.0) {
      vec2 plot = mix(uPlot.xy, uPlot.zw, vec2((a - ${PLOT.a[0].toFixed(1)}) / ${(PLOT.a[1] - PLOT.a[0]).toFixed(1)}, e / ${PLOT.e[1].toFixed(1)}));
      // The inner belt leaves first and the outer last, each dot a little
      // off its neighbors (by its own angles), so the columns build up
      // from the left and the gaps open as they land.
      float delay = 0.3 * clamp((a - 1.6) / 3.6, 0.0, 1.0) + 0.1 * fract(angles.x * 7.31 + angles.y * 3.17);
      float t = smoothstep(0.0, 1.0, clamp((uFlight - delay) / 0.6, 0.0, 1.0));
      // A dot behind the camera has no place on screen: it comes in from
      // past the plot's edge.
      vec2 space = gl_Position.w > 0.0 ? gl_Position.xy / gl_Position.w : plot * 4.0;
      gl_Position = vec4(mix(space, plot, t), 0.0, 1.0);
    }
    float gain = 1.0;
    vGrow = 1.0;
    #ifdef MAG
      // log10 of the row's flux over that of a row at uMag.x, as it would
      // be seen: H is a body's brightness 1 au from the Sun and from the
      // eye, and sunlight thins by the square of the distance out (set
      // against the main belt's 2.7 au) and again on the way to the eye
      // (against the camera's distance from what it looks at, so a zoom
      // changes nothing). Without it the sample's far, large bodies
      // (a 30 au and beyond, H under 8) outshine the belt.
      float sunward = max(0.3, length(vec3(X, Y, Z))) / 2.7;
      float eyeward = max(0.05, depth) / uDistance;
      float flux = -0.4 * (min(mag, 30.0) - uMag.x) - 2.0 * log(sunward * eyeward) / 2.302585;
      gain = max(uLeast, pow(10.0, flux * uMag.y));
      vGrow = clamp(pow(10.0, flux * uMag.z), 1.0, uMag.w);
    #endif
    gl_PointSize = uSize * vGrow;

    float lit = mix(1.0, picked, uGroup);
    vColor = mix(vec3(uGray), ramp(a), lit) * gain;
    vAlpha = mix(0.3, 1.0, lit);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vGrow;
  ${PROFILE_GLSL}
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    #ifdef MAG
      gl_FragColor = vec4(vColor, uAlpha * vAlpha * profile(d, vGrow));
    #else
      gl_FragColor = vec4(vColor, uAlpha * vAlpha * (1.0 - d));
    #endif
  }
`;

/** The Sun as the look draws it: a small core far brighter than white (the
 *  bloom spreads it) inside a wide warm glow that falls off as the square
 *  of the distance and reaches zero at the sprite's edge. */
const SUN_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFade;
  uniform vec2 uLight;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float window = (1.0 - d) * (1.0 - d);
    vec3 light = vec3(1.0, 0.96, 0.9) * uLight.x * exp(-d * 1400.0) + uColor * uLight.y / (1.0 + d * 260.0);
    gl_FragColor = vec4(light * window, uFade);
  }
`;

const JUPITER_AU = 5.2044;
const JUPITER_YEARS = 11.862;
const FOV = 40;

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export function startScene(canvas: HTMLCanvasElement, host: SceneHost): BeltScene {
  const look = readLook();
  // The camera: on load it looks at the Sun from `dist` au away, `elev`
  // degrees above the ecliptic, from ecliptic longitude 270° + `az`
  // (so at `az` 0 it faces longitude 90°), turned `roll` degrees about
  // its own line of sight. The whole look (`?look`) opens on the belt at
  // an angle; anything less keeps the camera the spike had.
  const opening = new URLSearchParams(location.search).has('look') ? { az: 200, elev: 24, roll: -34, dist: 13 } : { az: 0, elev: 38, roll: 0, dist: 13 };
  const AZIMUTH = (knob('az', opening.az) * Math.PI) / 180;
  const ELEVATION = (knob('elev', opening.elev) * Math.PI) / 180;
  const ROLL = (knob('roll', opening.roll) * Math.PI) / 180;
  /** The camera's distance from what it looks at, on load (au). */
  const HOME = knob('dist', opening.dist);

  // `run.ts`'s and `look.ts`'s knobs: `?size=` (a dot's CSS px), `?scale=`
  // (the scene's pixels per CSS px, of the display's), `?draw=` (rows
  // drawn), `?iters=` (Newton steps), `?alpha=` (a dot's opacity).
  const pixelRatio = devicePixelRatio * knob('scale', 1);
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(new Color(0x05060a));
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const stats: SceneStats = { frames: 0, draws: [], rows: 0, stars: 0, renderer: String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), distance: HOME, flying: false };
  const pipeline = look.hdr ? createPipeline(renderer, look) : undefined;

  // The dust is the rows (and the stars); the bodies are what the scene
  // adds. The look draws them apart, so its haze is the dust's alone;
  // without it they're one scene, drawn in the order they always were.
  const dust = new Scene();
  const bodies = pipeline ? new Scene() : dust;
  const camera = new PerspectiveCamera(FOV, 1, 0.01, 1000);
  /** What the camera looks at, from `stats.distance` away. */
  const target = new Vector3();
  let fly: { from: Vector3; to: Vector3; fromDistance: number; toDistance: number; start: number; ms: number } | undefined;
  // A stand-in body: one round point. In the look's buffer a `boost` past
  // 1 is brighter than white, and blooms.
  const dot = (size: number, color: number, boost = 1) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    const disc = new ShaderMaterial({
      vertexShader: `uniform float uSize; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uFade; void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p); if (d > 1.0) discard; gl_FragColor = vec4(uColor, (1.0 - d * d * d) * uFade); }`,
      uniforms: { uSize: { value: size }, uColor: { value: new Color(color).multiplyScalar(boost) }, uFade: { value: 1 } },
      transparent: true,
      depthTest: false,
    });
    const points = new Points(geometry, disc);
    points.frustumCulled = false;
    bodies.add(points);
    return points;
  };
  const glow = () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    const [, most] = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
    const material = new ShaderMaterial({
      vertexShader: `uniform float uSize; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }`,
      fragmentShader: SUN_FRAGMENT,
      uniforms: {
        uSize: { value: Math.min(most ?? 256, knob('sunSize', 250) * pixelRatio) },
        uColor: { value: new Color(1, 0.74, 0.46) },
        uFade: { value: 1 },
        uLight: { value: new Vector2(knob('sunCore', 30), knob('sunGlow', 1.6)) },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthTest: false,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    bodies.add(points);
    return points;
  };
  const sun = look.sun ? glow() : dot(14 * pixelRatio, 0xfff3d6);
  const jupiter = dot(8 * pixelRatio, 0xd9b38c, pipeline ? 1.8 : 1);
  const orbit = new Float32Array(256 * 3);
  for (let k = 0; k < 256; k++) orbit.set([JUPITER_AU * Math.cos((k / 256) * 2 * Math.PI), 0, JUPITER_AU * Math.sin((k / 256) * 2 * Math.PI)], k * 3);
  const orbitGeometry = new BufferGeometry();
  orbitGeometry.setAttribute('position', new BufferAttribute(orbit, 3));
  const orbitLine = new LineBasicMaterial({ color: pipeline ? 0x6a7594 : 0x3a4152, transparent: true });
  bodies.add(new LineLoop(orbitGeometry, orbitLine));
  // The drawn shape, once closed: white, as what the interface adds.
  const outline = new LineLoop(new BufferGeometry(), new LineBasicMaterial({ color: 0xfafafa, transparent: true, opacity: 0.85, depthTest: false }));
  outline.frustumCulled = false;
  outline.visible = false;
  bodies.add(outline);

  // The look blends in linear light, where the plain 0.07 a dot would be
  // most of the way to white on its own.
  const alpha = knob('alpha', pipeline ? 0.016 : 0.07);
  const map = mapUniforms(ORBIT_SIZE, !!pipeline);
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: { ITERS: knob('iters', 6), ...map.defines, ...(look.mag ? { MAG: 1 } : {}) },
    uniforms: {
      ...map.uniforms,
      uYears: { value: 0 },
      uSize: { value: 0 },
      uAlpha: { value: 0 },
      uFlight: { value: 0 },
      uPlot: { value: new Vector4() },
      uGroup: { value: 0 },
      // In the look's linear light and among its stars, the unpicked dots
      // need more than the display's 0.42 to stay a visible belt.
      uGray: { value: pipeline ? 0.4 : 0.42 },
      uMag: { value: new Vector4(knob('magAt', 17.7), knob('magBright', 0.45), knob('magGrow', 0.2), 16) },
      uLeast: { value: knob('magLeast', 0.4) },
      uDistance: { value: HOME },
    },
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  let picked: BufferAttribute | undefined;
  let stars: Stars | undefined;

  let dirty = true;
  let inset = 0;
  const resize = () => {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(innerWidth, innerHeight, false);
    pipeline?.setSize(Math.round(innerWidth * pixelRatio), Math.round(innerHeight * pixelRatio));
    dirty = true;
  };
  addEventListener('resize', resize);
  resize();

  /** The camera where it is now, centered in what the panel leaves. */
  const place = () => {
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

  const draw = (now: number, atYears?: number) => {
    dirty = false;
    const start = performance.now();
    const years = atYears ?? host.years(now);
    const flight = host.flight(now);
    inset = host.inset();
    let arrived = false;
    if (fly) {
      const k = Math.min(1, (now - fly.start) / fly.ms);
      target.lerpVectors(fly.from, fly.to, ease(k));
      stats.distance = Math.exp(Math.log(fly.fromDistance) + (Math.log(fly.toDistance) - Math.log(fly.fromDistance)) * ease(k));
      if (k >= 1) {
        fly = undefined;
        stats.flying = false;
        arrived = true;
      }
    }
    place();
    // Up close the dust thins out, by the square of how much nearer the
    // camera is: each dot's area and its opacity both grow with the
    // nearness, so the dust keeps its brightness and a group's dots still
    // show. Landed in a against e the camera's distance means nothing.
    const near = Math.max(1, HOME / stats.distance);
    const landed = ease(flight);
    material.uniforms.uSize!.value = knob('size', 1.5) * pixelRatio * (1 + (Math.min(3, near ** 0.5) - 1) * (1 - landed));
    material.uniforms.uAlpha!.value = alpha * (1 + (Math.min(12, near) - 1) * (1 - landed));
    material.uniforms.uDistance!.value = stats.distance;
    material.uniforms.uYears!.value = years;
    material.uniforms.uFlight!.value = flight;
    const x = (px: number) => (2 * px) / innerWidth - 1;
    const y = (px: number) => 1 - (2 * px) / innerHeight;
    (material.uniforms.uPlot!.value as Vector4).set(x(PLOT.left), y(innerHeight - PLOT.bottom), x(innerWidth - inset - PLOT.right), y(PLOT.top));
    // The Sun, Jupiter, its orbit, and the stars have no place in a against e.
    for (const body of [sun, jupiter]) (body.material as ShaderMaterial).uniforms.uFade!.value = 1 - landed;
    stars?.fade((1 - landed) * (material.uniforms.uGroup!.value ? 0.35 : 1));
    orbitLine.opacity = 1 - landed;
    (outline.material as LineBasicMaterial).opacity = 0.85 * (1 - landed);
    const turn = (years / JUPITER_YEARS) * 2 * Math.PI;
    jupiter.position.set(JUPITER_AU * Math.cos(turn), 0, -JUPITER_AU * Math.sin(turn));
    if (pipeline) pipeline.render(dust, bodies, camera);
    else renderer.render(dust, camera);
    stats.frames++;
    if (stats.draws.length < 20_000) stats.draws.push([now, performance.now() - start]);
    if (arrived) host.flown();
  };
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (dirty || fly || host.moves() || host.inset() !== inset) draw(now);
  };
  requestAnimationFrame(frame);

  const flyOver = (to: Vector3, toDistance: number, ms: number) => {
    fly = { from: target.clone(), to, fromDistance: stats.distance, toDistance, start: performance.now(), ms };
    stats.flying = true;
  };

  return {
    stats,
    setElements(elements, rows, magnitudes) {
      // One buffer, read where the crate keeps it: the upload to the GPU
      // is the only copy.
      const buffer = new InterleavedBuffer(elements, 6);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new InterleavedBufferAttribute(buffer, 3, 0));
      geometry.setAttribute('angles', new InterleavedBufferAttribute(buffer, 3, 3));
      if (look.mag) {
        if (!magnitudes) throw new Error('the look draws by H: no magnitudes');
        geometry.setAttribute('mag', new BufferAttribute(magnitudes, 1));
      }
      picked = new BufferAttribute(new Uint8Array(rows), 1, true);
      geometry.setAttribute('picked', picked);
      geometry.setDrawRange(0, Math.min(rows, knob('draw', rows)));
      const belt = new Points(geometry, material);
      belt.frustumCulled = false;
      dust.add(belt);
      stats.rows = rows;
      // Drawn now, in the caller's task: the upload reads `elements`, a
      // view the wasm's memory detaches the next time it grows.
      draw(performance.now());
    },
    setStars(file) {
      if (!(look.stars > 0)) return;
      stars = createStars(file, look.stars, pixelRatio);
      stars.points.renderOrder = -1;
      dust.add(stars.points);
      stats.stars = stars.drawn;
      dirty = true;
    },
    wheel(_x, _y, delta) {
      if (fly) return;
      stats.distance = Math.min(60, Math.max(0.05, stats.distance * Math.exp(-delta * 0.002)));
      dirty = true;
    },
    viewProjection() {
      place();
      const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      return new Float32Array([...matrix.elements, innerWidth, innerHeight]);
    },
    flyTo(center, radius, panel, ms) {
      // Far enough for the sphere to fit the narrower of the window's
      // height and the width the panel leaves, with a margin.
      const half = (FOV * Math.PI) / 360;
      const across = Math.atan((Math.tan(half) * Math.max(1, innerWidth - panel)) / innerHeight);
      flyOver(new Vector3(...center), Math.max(0.05, (1.2 * radius) / Math.sin(Math.min(half, across))), ms);
    },
    flyHome(ms) {
      flyOver(new Vector3(), HOME, ms);
    },
    setPicked(bytes) {
      if (!picked) return;
      const group = bytes.length === picked.count;
      if (group) (picked.array as Uint8Array).set(bytes);
      if (group) picked.needsUpdate = true;
      material.uniforms.uGroup!.value = group ? 1 : 0;
      dirty = true;
    },
    setOutline(points) {
      // Each point goes where its ray from the camera meets the ecliptic,
      // so the shape stays over the dots it was drawn around as the camera
      // moves.
      place();
      const on: number[] = [];
      const eye = camera.position;
      for (let at = 0; at + 1 < points.length; at += 2) {
        const ray = new Vector3((2 * points[at]!) / innerWidth - 1, 1 - (2 * points[at + 1]!) / innerHeight, 0.5).unproject(camera).sub(eye);
        if (ray.y >= 0) continue;
        const reach = -eye.y / ray.y;
        on.push(eye.x + ray.x * reach, 0, eye.z + ray.z * reach);
      }
      outline.geometry.dispose();
      outline.geometry = new BufferGeometry();
      outline.geometry.setAttribute('position', new BufferAttribute(new Float32Array(on), 3));
      outline.visible = on.length >= 9;
      dirty = true;
    },
    bench(frames) {
      const pixel = new Uint8Array(4);
      const times: number[] = [];
      for (let k = -8; k < frames; k++) {
        const start = performance.now();
        draw(start, (k + 8) / 60);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        if (k >= 0) times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      dirty = true;
      return [times[times.length >> 1]!, times[Math.floor(times.length * 0.9)]!];
    },
  };
}
