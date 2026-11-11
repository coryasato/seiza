// Throwaway: the scene's color mappings, in one place so either is swapped
// by editing or replacing a table here. The shaders read them as uniforms
// (`mapUniforms`) and know only "a value, through stops, to a color".
import { Vector3 } from 'three';

/** A value mapped to a color through stops, oklch (l, c, hue in degrees). */
export interface ColorMap {
  stops: number[];
  colors: [number, number, number][];
}

/** A dot's color by its orbit size: a in au (the storyboard's color note). */
export const ORBIT_SIZE: ColorMap = {
  stops: [1.6, 2.7, 3.2, 3.97, 5.2],
  colors: [
    [0.76, 0.14, 27],
    [0.93, 0.07, 84],
    [0.81, 0.1, 258],
    [0.76, 0.14, 298],
    [0.88, 0.13, 161],
  ],
};

/** A star's tint by Gaia's bp_rp (blue minus red magnitude): blue-white
 *  through the Sun's 0.82 to orange-red. By eye, not a blackbody fit. */
export const STAR_TINT: ColorMap = {
  stops: [-0.2, 0.4, 0.82, 1.5, 2.6],
  colors: [
    [0.88, 0.06, 255],
    [0.95, 0.02, 250],
    [0.96, 0.02, 90],
    [0.88, 0.06, 65],
    [0.8, 0.09, 45],
  ],
};

/** oklch → sRGB, 0..1: gamma-encoded for a shader that writes the display's
 *  values itself, linear for one whose output is tone mapped after. */
export function oklch([l, c, h]: [number, number, number], linear: boolean): Vector3 {
  const [a, b] = [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (value: number) => {
    const v = Math.min(1, Math.max(0, value));
    if (linear) return v;
    return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return new Vector3(
    encode(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    encode(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    encode(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  );
}

/** A map's uniforms, and the define that sizes the shader's arrays. */
export function mapUniforms(map: ColorMap, linear: boolean) {
  return {
    uniforms: { uRamp: { value: map.colors.map((color) => oklch(color, linear)) }, uStops: { value: map.stops } },
    defines: { RAMP: map.stops.length },
  };
}

/** The GLSL that reads a map: `ramp(value)`. */
export const RAMP_GLSL = /* glsl */ `
  uniform vec3 uRamp[RAMP];
  uniform float uStops[RAMP];
  vec3 ramp(float value) {
    vec3 color = uRamp[0];
    for (int k = 0; k < RAMP - 1; k++) {
      color = mix(color, uRamp[k + 1], clamp((value - uStops[k]) / (uStops[k + 1] - uStops[k]), 0.0, 1.0));
    }
    return color;
  }
`;
