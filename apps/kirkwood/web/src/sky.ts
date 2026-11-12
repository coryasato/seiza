// The sky behind the belt: Gaia's stars brighter than G 10.5, from
// data/stars.bin (docs/data.md, "`stars.bin`"). Each star is drawn in its
// real direction, at infinity (the camera's turn moves it, the camera's
// place doesn't), its brightness and size from its G magnitude and its tint
// from bp_rp. Nothing is placed by hand: where the stars crowd is the Milky
// Way.
//
// The stars are the scene's own, not the crate's: they aren't rows
// (`docs/DECISIONS.md`, "Look"). They stay behind the rows: faint, and
// their tints soft, so an orange star isn't read as an inner-belt dot.
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3, Vector4 } from 'three';

const MAGIC = 0x3153574b; // "KWS1", little-endian
const HEADER = 8;
/** The faintest star in the file (its cut), G. */
const CUT = 10.5;
/** A star's light, of what its G alone would give: faint, behind the rows. */
const GAIN = 0.11;

/** A star's tint by Gaia's bp_rp (blue less red magnitude), in linear
 *  light: blue-white through the Sun's 0.82 to orange-red. By eye, not a
 *  blackbody fit. In oklch: (0.88 0.06 255), (0.95 0.02 250),
 *  (0.96 0.02 90), (0.88 0.06 65), (0.80 0.09 45). */
const TINT = {
  stops: [-0.2, 0.4, 0.82, 1.5, 2.6],
  colors: [
    [0.5117, 0.702, 1.0],
    [0.7819, 0.8705, 0.9719],
    [0.9292, 0.8841, 0.7685],
    [0.9041, 0.6315, 0.4267],
    [0.8647, 0.4106, 0.2684],
  ],
} as const;

/** A dot grown past its least size keeps a core of that size and gains a
 *  wide, faint halo: `profile(r², grow)`. The belt's dots use it too. */
export const PROFILE = /* glsl */ `
  float profile(float r2, float grow) {
    float k = r2 * grow * grow;
    return (1.0 - r2) * (exp(-1.5 * k) + 0.08 / (1.0 + 0.5 * k));
  }
`;

const VERTEX = /* glsl */ `
  uniform float uSize;
  uniform float uGain;
  // The faintest star's G, then the exponents of brightness and of size
  // on a star's flux, and the most a star grows.
  uniform vec4 uMag;
  uniform vec3 uTint[${TINT.stops.length}];
  uniform float uStops[${TINT.stops.length}];
  // G in twentieths of a magnitude; bp_rp from -1 in fiftieths, 255 for none.
  attribute vec2 light;
  varying vec3 vColor;
  varying float vGrow;
  void main() {
    // The file's directions are in the ecliptic's axes; the ecliptic is
    // the scene's xz plane. No translation: a star is at infinity.
    gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * vec3(position.x, position.z, -position.y), 1.0);
    gl_Position.z = 0.0;
    // log10 of the star's flux over the faintest's.
    float flux = 0.4 * (uMag.x - light.x / 20.0);
    vGrow = clamp(pow(10.0, flux * uMag.z), 1.0, uMag.w);
    gl_PointSize = uSize * vGrow;
    // A star with no bp_rp is given the Sun's.
    float color = light.y > 254.5 ? 0.82 : light.y / 50.0 - 1.0;
    vec3 tint = uTint[0];
    for (int k = 0; k < ${TINT.stops.length - 1}; k++) {
      tint = mix(tint, uTint[k + 1], clamp((color - uStops[k]) / (uStops[k + 1] - uStops[k]), 0.0, 1.0));
    }
    vColor = tint * uGain * pow(10.0, flux * uMag.y);
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vGrow;
  ${PROFILE}
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    gl_FragColor = vec4(vColor, profile(r2, vGrow));
  }
`;

export interface Sky {
  points: Points;
  /** The stars drawn: every star of the file. */
  stars: number;
  /** A star's least size follows the scene's pixels. */
  setPixelRatio(pixelRatio: number): void;
  /** What's left of the stars' light, 1 to 0: they leave the picture as
   *  the dots leave space. At 0 they aren't drawn. */
  setFade(left: number): void;
}

/** The sky from the file's bytes, which the GPU takes at the first draw:
 *  the attributes are views over them. */
export function createSky(file: ArrayBuffer): Sky {
  const header = new DataView(file);
  if (file.byteLength < HEADER || header.getUint32(0, true) !== MAGIC) throw new Error("the sky's file doesn't start as one (KWS1)");
  const stars = header.getUint32(4, true);
  const lightAt = Math.ceil((HEADER + stars * 6) / 4) * 4;
  if (file.byteLength < lightAt + stars * 2) throw new Error(`the sky's file is ${file.byteLength} bytes, too few for its ${stars} stars`);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Int16Array(file, HEADER, stars * 3), 3, true));
  geometry.setAttribute('light', new BufferAttribute(new Uint8Array(file, lightAt, stars * 2), 2));
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTint: { value: TINT.colors.map((color) => new Vector3(...color)) },
      uStops: { value: [...TINT.stops] },
      uSize: { value: 0 },
      uGain: { value: GAIN },
      uMag: { value: new Vector4(CUT, 0.62, 0.15, 12) },
    },
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  // Behind the rows.
  points.renderOrder = -1;
  return {
    points,
    stars,
    setPixelRatio: (pixelRatio) => void (material.uniforms.uSize!.value = 1.1 * pixelRatio),
    setFade: (left) => {
      material.uniforms.uGain!.value = GAIN * left;
      points.visible = left > 0;
    },
  };
}
