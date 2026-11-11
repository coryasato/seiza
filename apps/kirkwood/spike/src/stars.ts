// Throwaway: the sky behind the belt, from the Gaia sample's bright stars
// (`data.ts`'s stars.bin). Each star is drawn in its real direction, at
// infinity (the camera's turn moves it, the camera's place doesn't), its
// brightness and size from its G magnitude and its tint from bp_rp.
// Nothing here is placed by hand: where the stars crowd is the Milky Way.
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector4 } from 'three';
import { RAMP_GLSL, STAR_TINT, mapUniforms } from './colors.ts';
import { knob } from './look.ts';

const VERTEX = /* glsl */ `
  uniform float uSize;
  uniform float uGain;
  // The faintest star's G, then the exponents of brightness and of size
  // on a star's flux, and the most a star grows.
  uniform vec4 uMag;
  attribute vec2 light;
  varying vec3 vColor;
  varying float vGrow;
  ${RAMP_GLSL}
  void main() {
    gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position.z = 0.0;
    // log10 of the star's flux over the faintest's.
    float flux = 0.4 * (uMag.x - light.x / 20.0);
    vGrow = clamp(pow(10.0, flux * uMag.z), 1.0, uMag.w);
    gl_PointSize = uSize * vGrow;
    // A star with no bp_rp (255) is drawn as the Sun's color.
    float tint = light.y > 254.5 ? 0.82 : light.y / 50.0 - 1.0;
    vColor = ramp(tint) * uGain * pow(10.0, flux * uMag.y);
  }
`;

/** A dot grown past its least size keeps a core of that size and gains a
 *  wide, faint halo: `profile(r², grow)`. Shared with the belt's dots. */
export const PROFILE_GLSL = /* glsl */ `
  float profile(float r2, float grow) {
    float k = r2 * grow * grow;
    return (1.0 - r2) * (exp(-1.5 * k) + 0.08 / (1.0 + 0.5 * k));
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uFade;
  varying vec3 vColor;
  varying float vGrow;
  ${PROFILE_GLSL}
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    gl_FragColor = vec4(vColor, uFade * profile(r2, vGrow));
  }
`;

export interface Stars {
  points: Points;
  /** 1 in space, 0 where the stars have no place (a against e). */
  fade(by: number): void;
  drawn: number;
}

/** The stars of `file` brighter than `cut` (G), at `pixelRatio` device
 *  pixels a CSS pixel. */
export function createStars(file: ArrayBuffer, cut: number, pixelRatio: number): Stars {
  const count = new DataView(file).getUint32(0, true);
  const light = new Uint8Array(file, 4 + count * 6, count * 2);
  // Brightest first: the cut is how many are drawn.
  let drawn = 0;
  for (let low = 0, high = count; low < high; ) {
    const mid = (low + high) >> 1;
    if (light[mid * 2]! < cut * 20) low = drawn = mid + 1;
    else high = mid;
  }
  const geometry = new BufferGeometry();
  // The file's i16s start 4 bytes in, so they're copied to be aligned.
  geometry.setAttribute('position', new BufferAttribute(new Int16Array(file.slice(4, 4 + count * 6)), 3, true));
  geometry.setAttribute('light', new BufferAttribute(light, 2));
  geometry.setDrawRange(0, drawn);
  const map = mapUniforms(STAR_TINT, true);
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: map.defines,
    uniforms: {
      ...map.uniforms,
      uSize: { value: knob('starSize', 1.1) * pixelRatio },
      uGain: { value: knob('starGain', 0.11) },
      uMag: { value: new Vector4(cut, knob('starBright', 0.62), knob('starGrow', 0.15), 12) },
      uFade: { value: 1 },
    },
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return { points, drawn, fade: (by) => void (material.uniforms.uFade!.value = by) };
}
