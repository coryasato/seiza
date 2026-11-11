// Throwaway: the scene. The belt as one draw of points whose vertex shader
// solves each orbit (Kepler's equation, from the six elements a row the
// crate holds), colored by a through the storyboard's ramp; the Sun,
// Jupiter, and Jupiter's orbit as stand-ins. It draws only when something
// changed: the clock moved, the camera moved, the window resized.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  LineBasicMaterial,
  LineLoop,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';

/** What the scene asks of the crate, which owns the clock. */
export interface SceneHost {
  /** The clock in years, moved on to `now` (the page clock). */
  years(now: number): number;
  /** Whether the clock moves. */
  moves(): boolean;
}

export interface SceneStats {
  /** Frames drawn. */
  frames: number;
  /** Each drawn frame's `[page time, ms in render()]`. */
  draws: [number, number][];
  rows: number;
  renderer: string;
  distance: number;
}

export interface BeltScene {
  /** The belt's rows: six f32s each (a, e, i degrees; node, perihelion,
   *  anomaly radians). Uploaded to the GPU before it returns; `elements`
   *  isn't read again. */
  setElements(elements: Float32Array, rows: number): void;
  /** A wheel over the scene, at a window position: zooms. */
  wheel(x: number, y: number, delta: number): void;
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

const VERTEX = /* glsl */ `
  uniform float uYears;
  uniform float uSize;
  uniform vec3 uRamp[5];
  uniform float uStops[5];
  attribute vec3 angles;
  varying vec3 vColor;
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
    gl_PointSize = uSize;

    vec3 color = uRamp[0];
    for (int k = 0; k < 4; k++) {
      color = mix(color, uRamp[k + 1], clamp((a - uStops[k]) / (uStops[k + 1] - uStops[k]), 0.0, 1.0));
    }
    vColor = color;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uAlpha;
  varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    gl_FragColor = vec4(vColor, uAlpha * (1.0 - d));
  }
`;

const JUPITER_AU = 5.2044;
const JUPITER_YEARS = 11.862;
const ELEVATION = (38 * Math.PI) / 180;

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
  const stats: SceneStats = { frames: 0, draws: [], rows: 0, renderer: String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), distance: 13 };

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.01, 1000);
  // A stand-in body: one round point.
  const dot = (size: number, color: number) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    const disc = new ShaderMaterial({
      vertexShader: `uniform float uSize; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize; }`,
      fragmentShader: `uniform vec3 uColor; void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p); if (d > 1.0) discard; gl_FragColor = vec4(uColor, 1.0 - d * d * d); }`,
      uniforms: { uSize: { value: size }, uColor: { value: new Color(color) } },
      transparent: true,
      depthTest: false,
    });
    const points = new Points(geometry, disc);
    points.frustumCulled = false;
    scene.add(points);
    return points;
  };
  dot(14 * pixelRatio, 0xfff3d6);
  const jupiter = dot(8 * pixelRatio, 0xd9b38c);
  const orbit = new Float32Array(256 * 3);
  for (let k = 0; k < 256; k++) orbit.set([JUPITER_AU * Math.cos((k / 256) * 2 * Math.PI), 0, JUPITER_AU * Math.sin((k / 256) * 2 * Math.PI)], k * 3);
  const orbitGeometry = new BufferGeometry();
  orbitGeometry.setAttribute('position', new BufferAttribute(orbit, 3));
  scene.add(new LineLoop(orbitGeometry, new LineBasicMaterial({ color: 0x3a4152 })));

  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: { ITERS: knob('iters', 6) },
    uniforms: {
      uYears: { value: 0 },
      uSize: { value: knob('size', 1.5) * pixelRatio },
      uAlpha: { value: 0.07 },
      uRamp: { value: RAMP.map(([, color]) => oklch(color)) },
      uStops: { value: RAMP.map(([a]) => a) },
    },
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });

  let dirty = true;
  const resize = () => {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  addEventListener('resize', resize);
  resize();

  const draw = (now: number) => {
    dirty = false;
    const start = performance.now();
    const years = host.years(now);
    material.uniforms.uYears!.value = years;
    const turn = (years / JUPITER_YEARS) * 2 * Math.PI;
    jupiter.position.set(JUPITER_AU * Math.cos(turn), 0, -JUPITER_AU * Math.sin(turn));
    camera.position.set(0, stats.distance * Math.sin(ELEVATION), stats.distance * Math.cos(ELEVATION));
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    stats.frames++;
    if (stats.draws.length < 20_000) stats.draws.push([now, performance.now() - start]);
  };
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (dirty || host.moves()) draw(now);
  };
  requestAnimationFrame(frame);

  return {
    stats,
    setElements(elements, rows) {
      // One buffer, read where the crate keeps it: the upload to the GPU
      // is the only copy.
      const buffer = new InterleavedBuffer(elements, 6);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new InterleavedBufferAttribute(buffer, 3, 0));
      geometry.setAttribute('angles', new InterleavedBufferAttribute(buffer, 3, 3));
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
      stats.distance = Math.min(60, Math.max(1.5, stats.distance * Math.exp(-delta * 0.002)));
      dirty = true;
    },
  };
}
