// Throwaway: the scene. The belt as one draw of points whose vertex shader
// solves each orbit (Kepler's equation, from the six elements a row the
// crate holds), colored by a through the storyboard's ramp; the Sun,
// Jupiter, and Jupiter's orbit as stand-ins. The same shader flies each dot
// between its place in space and a against e (the sort flight), and grays
// every dot outside a drawn group. The camera flies in to a group and back.
// It draws only when something changed: the clock moved, the dots or the
// camera are in flight, the panel moved, the window resized.
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
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';

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
  renderer: string;
  distance: number;
  /** The camera is flying. */
  flying: boolean;
}

export interface BeltScene {
  /** The belt's rows: six f32s each (a, e, i degrees; node, perihelion,
   *  anomaly radians). Uploaded to the GPU before it returns; `elements`
   *  isn't read again. */
  setElements(elements: Float32Array, rows: number): void;
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
  stats: SceneStats;
}

/** The storyboard's ramp (its color note): a in au, then oklch. */
const RAMP: [number, [number, number, number]][] = [
  [1.6, [0.76, 0.14, 27]],
  [2.7, [0.93, 0.07, 84]],
  [3.2, [0.81, 0.1, 258]],
  [3.97, [0.76, 0.14, 298]],
  [5.2, [0.88, 0.13, 161]],
];

/** oklch → sRGB, gamma-encoded, 0..1. */
function oklch([l, c, h]: [number, number, number]): Vector3 {
  const [a, b] = [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (linear: number) => {
    const v = Math.min(1, Math.max(0, linear));
    return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return new Vector3(
    encode(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    encode(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    encode(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  );
}

/** a against e, as the storyboard's boards 3 and 4 draw it at 1440×900:
 *  a 1.5 to 5.5 au from 80 px to 80 px short of the right edge (or of the
 *  panel), e 0 to 0.6 from 129 px above the bottom up to 96 px. */
const PLOT = { a: [1.5, 5.5], e: [0, 0.6], left: 80, right: 80, top: 96, bottom: 129 } as const;

const VERTEX = /* glsl */ `
  uniform float uYears;
  uniform float uSize;
  uniform vec3 uRamp[5];
  uniform float uStops[5];
  // The sort flight, 0 in space to 1 landed; and a against e's corners in
  // clip space: (a 1.5, e 0) then (a 5.5, e 0.6).
  uniform float uFlight;
  uniform vec4 uPlot;
  // 1 while a group is drawn: every other dot is gray.
  uniform float uGroup;
  attribute vec3 angles;
  attribute float picked;
  varying vec3 vColor;
  varying float vAlpha;
  const float TAU = 6.283185307179586;

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
    gl_PointSize = uSize;

    vec3 color = uRamp[0];
    for (int k = 0; k < 4; k++) {
      color = mix(color, uRamp[k + 1], clamp((a - uStops[k]) / (uStops[k + 1] - uStops[k]), 0.0, 1.0));
    }
    float lit = mix(1.0, picked, uGroup);
    vColor = mix(vec3(0.42), color, lit);
    vAlpha = mix(0.3, 1.0, lit);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor, uAlpha * vAlpha * (1.0 - d));
  }
`;

const JUPITER_AU = 5.2044;
const JUPITER_YEARS = 11.862;
const ELEVATION = (38 * Math.PI) / 180;
/** The camera's distance from what it looks at, on load (au). */
const HOME = 13;
const FOV = 40;

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

/** `run.ts`'s knobs, for finding what a frame's time goes to: `?size=` (a
 *  dot's CSS px), `?scale=` (the scene's pixels per CSS px, of the
 *  display's), `?draw=` (rows drawn), `?iters=` (Newton steps). */
const knob = (name: string, fallback: number) => Number(new URLSearchParams(location.search).get(name) ?? fallback);

export function startScene(canvas: HTMLCanvasElement, host: SceneHost): BeltScene {
  const pixelRatio = devicePixelRatio * knob('scale', 1);
  const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(new Color(0x05060a));
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const stats: SceneStats = { frames: 0, draws: [], rows: 0, renderer: String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), distance: HOME, flying: false };

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.01, 1000);
  /** What the camera looks at, from `stats.distance` away. */
  const target = new Vector3();
  let fly: { from: Vector3; to: Vector3; fromDistance: number; toDistance: number; start: number; ms: number } | undefined;
  // A stand-in body: one round point.
  const dot = (size: number, color: number) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    const disc = new ShaderMaterial({
      vertexShader: `uniform float uSize; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uFade; void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p); if (d > 1.0) discard; gl_FragColor = vec4(uColor, (1.0 - d * d * d) * uFade); }`,
      uniforms: { uSize: { value: size }, uColor: { value: new Color(color) }, uFade: { value: 1 } },
      transparent: true,
      depthTest: false,
    });
    const points = new Points(geometry, disc);
    points.frustumCulled = false;
    scene.add(points);
    return points;
  };
  const sun = dot(14 * pixelRatio, 0xfff3d6);
  const jupiter = dot(8 * pixelRatio, 0xd9b38c);
  const orbit = new Float32Array(256 * 3);
  for (let k = 0; k < 256; k++) orbit.set([JUPITER_AU * Math.cos((k / 256) * 2 * Math.PI), 0, JUPITER_AU * Math.sin((k / 256) * 2 * Math.PI)], k * 3);
  const orbitGeometry = new BufferGeometry();
  orbitGeometry.setAttribute('position', new BufferAttribute(orbit, 3));
  const orbitLine = new LineBasicMaterial({ color: 0x3a4152, transparent: true });
  scene.add(new LineLoop(orbitGeometry, orbitLine));
  // The drawn shape, once closed: white, as what the interface adds.
  const outline = new LineLoop(new BufferGeometry(), new LineBasicMaterial({ color: 0xfafafa, transparent: true, opacity: 0.85, depthTest: false }));
  outline.frustumCulled = false;
  outline.visible = false;
  scene.add(outline);

  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: { ITERS: knob('iters', 6) },
    uniforms: {
      uYears: { value: 0 },
      uSize: { value: 0 },
      uAlpha: { value: 0 },
      uRamp: { value: RAMP.map(([, color]) => oklch(color)) },
      uStops: { value: RAMP.map(([a]) => a) },
      uFlight: { value: 0 },
      uPlot: { value: new Vector4() },
      uGroup: { value: 0 },
    },
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  let picked: BufferAttribute | undefined;

  let dirty = true;
  let inset = 0;
  const resize = () => {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(innerWidth, innerHeight, false);
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
    camera.position.set(target.x, target.y + stats.distance * Math.sin(ELEVATION), target.z + stats.distance * Math.cos(ELEVATION));
    camera.lookAt(target);
    camera.updateMatrixWorld();
  };

  const draw = (now: number) => {
    dirty = false;
    const start = performance.now();
    const years = host.years(now);
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
    material.uniforms.uAlpha!.value = 0.07 * (1 + (Math.min(12, near) - 1) * (1 - landed));
    material.uniforms.uYears!.value = years;
    material.uniforms.uFlight!.value = flight;
    const x = (px: number) => (2 * px) / innerWidth - 1;
    const y = (px: number) => 1 - (2 * px) / innerHeight;
    (material.uniforms.uPlot!.value as Vector4).set(x(PLOT.left), y(innerHeight - PLOT.bottom), x(innerWidth - inset - PLOT.right), y(PLOT.top));
    // The Sun, Jupiter, and its orbit have no place in a against e.
    for (const body of [sun, jupiter]) (body.material as ShaderMaterial).uniforms.uFade!.value = 1 - landed;
    orbitLine.opacity = 1 - landed;
    (outline.material as LineBasicMaterial).opacity = 0.85 * (1 - landed);
    const turn = (years / JUPITER_YEARS) * 2 * Math.PI;
    jupiter.position.set(JUPITER_AU * Math.cos(turn), 0, -JUPITER_AU * Math.sin(turn));
    renderer.render(scene, camera);
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
    setElements(elements, rows) {
      // One buffer, read where the crate keeps it: the upload to the GPU
      // is the only copy.
      const buffer = new InterleavedBuffer(elements, 6);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new InterleavedBufferAttribute(buffer, 3, 0));
      geometry.setAttribute('angles', new InterleavedBufferAttribute(buffer, 3, 3));
      picked = new BufferAttribute(new Uint8Array(rows), 1, true);
      geometry.setAttribute('picked', picked);
      geometry.setDrawRange(0, Math.min(rows, knob('draw', rows)));
      const belt = new Points(geometry, material);
      belt.frustumCulled = false;
      scene.add(belt);
      stats.rows = rows;
      // Drawn now, in the caller's task: the upload reads `elements`, a
      // view the wasm's memory detaches the next time it grows.
      draw(performance.now());
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
  };
}
