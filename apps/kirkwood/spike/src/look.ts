// Throwaway: the look's knobs and its pipeline. With any of it on, the
// scene is drawn into a half-float buffer in linear light and reaches the
// canvas through one last pass:
//
//   the dust (the belt, the stars)  → the buffer
//   haze: the buffer halved three times, blurred, kept aside
//   the bodies (the Sun, Jupiter, the lines) → the buffer, over the dust
//   bloom: what's brighter than white, blurred wide, added to the buffer
//   out: buffer + haze → tone mapping → the display's encoding → the floor
//        (a tint and a fixed grain)
//
// The haze is taken before the bodies are drawn, so it's the dots' own
// light and nothing else: where they're dense it glows, in their colors.
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  HalfFloatType,
  LinearFilter,
  NeutralToneMapping,
  NoToneMapping,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type ToneMapping,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const query = new URLSearchParams(location.search);
/** A number from the page's query. */
export const knob = (name: string, fallback: number) => Number(query.get(name) ?? fallback);

/** What of the look is on: `?look` turns all of it on, and each part's own
 *  knob (`?bloom=0`, `?stars=8`) overrides that. Any part needs `hdr`. */
export interface Look {
  /** The half-float buffer and the tone mapped output. */
  hdr: boolean;
  /** A dot's brightness and size by its H. */
  mag: boolean;
  bloom: boolean;
  haze: boolean;
  /** The tint and the grain under everything. */
  floor: boolean;
  /** The Gaia stars brighter than this G; 0 for none. */
  stars: number;
  /** The Sun as a glow. */
  sun: boolean;
  tone: ToneMapping;
}
export function readLook(): Look {
  const all = query.has('look') && query.get('look') !== '0';
  const on = (name: string) => (query.has(name) ? query.get(name) !== '0' : all);
  const parts = { mag: on('mag'), bloom: on('bloom'), haze: on('haze'), floor: on('floor'), stars: query.has('stars') ? knob('stars', 0) : all ? 10.5 : 0, sun: on('sun') };
  const tones: Record<string, ToneMapping> = { agx: AgXToneMapping, aces: ACESFilmicToneMapping, neutral: NeutralToneMapping, none: NoToneMapping };
  return { ...parts, hdr: on('hdr') || parts.mag || parts.bloom || parts.haze || parts.floor || parts.stars > 0 || parts.sun, tone: tones[query.get('tone') ?? 'neutral'] ?? NeutralToneMapping };
}

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** A copy: into a target half the size, each pixel is the mean of four. */
const COPY = /* glsl */ `
  uniform sampler2D tSource;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tSource, vUv);
  }
`;

/** A Gaussian along one axis, 13 pixels wide through 7 bilinear taps. */
const BLUR = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 uStep;
  varying vec2 vUv;
  void main() {
    vec4 sum = texture2D(tSource, vUv) * 0.1964825501511404;
    sum += (texture2D(tSource, vUv + uStep * 1.411764705882353) + texture2D(tSource, vUv - uStep * 1.411764705882353)) * 0.2969069646728344;
    sum += (texture2D(tSource, vUv + uStep * 3.2941176470588234) + texture2D(tSource, vUv - uStep * 3.2941176470588234)) * 0.09447039785044732;
    sum += (texture2D(tSource, vUv + uStep * 5.176470588235294) + texture2D(tSource, vUv - uStep * 5.176470588235294)) * 0.010381362401148057;
    gl_FragColor = sum;
  }
`;

const OUT = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tHaze;
  uniform float uHaze;
  uniform float uExposure;
  uniform vec3 uFloor;
  uniform float uGrain;
  varying vec2 vUv;
  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  void main() {
    vec3 color = texture2D(tScene, vUv).rgb + uHaze * texture2D(tHaze, vUv).rgb;
    gl_FragColor = vec4(color * uExposure, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // The floor, in the display's own values: a tint, and a grain that is
    // the same every frame (the scene draws only when something moved).
    gl_FragColor.rgb += uFloor + uGrain * (hash(gl_FragCoord.xy) + hash(gl_FragCoord.yx + 71.7) - 1.0);
  }
`;

export interface Pipeline {
  setSize(width: number, height: number): void;
  /** Draws the dust, then the bodies over it, to the canvas. */
  render(dust: Scene, bodies: Scene, camera: Camera): void;
}

export function createPipeline(renderer: WebGLRenderer, look: Look): Pipeline {
  renderer.toneMapping = look.tone;
  renderer.setClearColor(0x000000, 1);
  const target = (filter = true) => {
    const made = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    if (filter) made.texture.minFilter = made.texture.magFilter = LinearFilter;
    return made;
  };
  const buffer = target();
  /** Half, a quarter, and an eighth of the buffer, and the blur's scratch. */
  const steps = [target(), target(), target()];
  const scratch = target();
  const copy = new ShaderMaterial({ vertexShader: QUAD_VERTEX, fragmentShader: COPY, uniforms: { tSource: { value: null } }, depthTest: false, depthWrite: false });
  const blur = new ShaderMaterial({ vertexShader: QUAD_VERTEX, fragmentShader: BLUR, uniforms: { tSource: { value: null }, uStep: { value: new Vector2() } }, depthTest: false, depthWrite: false });
  // The page's own background (#05060a) is the tint, so the floor is the
  // color the scene had; `?tint=` scales it, `?grain=` is the grain's
  // reach either side, in the display's 0..1.
  const tint = knob('tint', 1);
  const out = new ShaderMaterial({
    vertexShader: QUAD_VERTEX,
    fragmentShader: OUT,
    uniforms: {
      tScene: { value: buffer.texture },
      tHaze: { value: steps[2]!.texture },
      uHaze: { value: look.haze ? knob('hazeGain', 0.9) : 0 },
      uExposure: { value: knob('exposure', 1) },
      uFloor: { value: look.floor ? new Vector3(5 / 255, 6 / 255, 10 / 255).multiplyScalar(tint) : new Vector3() },
      uGrain: { value: look.floor ? knob('grain', 0.014) : 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(copy);
  const bloom = look.bloom ? new UnrealBloomPass(new Vector2(1, 1), knob('bloomGain', 0.55), knob('bloomRadius', 0.6), knob('bloomAt', 1)) : undefined;
  const blurs = knob('hazeBlurs', 2);
  const bloomScale = knob('bloomScale', 1);

  const pass = (material: ShaderMaterial, to: WebGLRenderTarget | null) => {
    quad.material = material;
    renderer.setRenderTarget(to);
    quad.render(renderer);
  };

  return {
    setSize(width, height) {
      buffer.setSize(width, height);
      steps.forEach((step, at) => step.setSize(Math.max(1, width >> (at + 1)), Math.max(1, height >> (at + 1))));
      scratch.setSize(Math.max(1, width >> 3), Math.max(1, height >> 3));
      // The bloom's own resolution, of the buffer's (`?bloomScale=`): it blurs
      // wide, so it needs few pixels.
      bloom?.setSize(Math.round(width * bloomScale), Math.round(height * bloomScale));
    },
    render(dust, bodies, camera) {
      renderer.setRenderTarget(buffer);
      renderer.render(dust, camera);
      if (look.haze) {
        let source = buffer;
        for (const step of steps) {
          copy.uniforms.tSource!.value = source.texture;
          pass(copy, step);
          source = step;
        }
        const small = steps[2]!;
        for (let turn = 0; turn < blurs; turn++) {
          blur.uniforms.tSource!.value = small.texture;
          (blur.uniforms.uStep!.value as Vector2).set(1 / small.width, 0);
          pass(blur, scratch);
          blur.uniforms.tSource!.value = scratch.texture;
          (blur.uniforms.uStep!.value as Vector2).set(0, 1 / small.height);
          pass(blur, small);
        }
      }
      renderer.autoClear = false;
      renderer.setRenderTarget(buffer);
      renderer.render(bodies, camera);
      renderer.autoClear = true;
      bloom?.render(renderer, buffer, buffer, 0, false);
      pass(out, null);
    },
  };
}
