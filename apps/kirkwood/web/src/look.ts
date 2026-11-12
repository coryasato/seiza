// The look (`docs/DECISIONS.md`, "Look"): the scene is drawn in linear
// light into a half-float buffer, where a dot can be brighter than white,
// and reaches the canvas through one last pass:
//
//   the dust (the belt, the sky)   → the buffer
//   haze: the buffer halved three times, blurred, kept aside
//   the bodies (the Sun, Jupiter, the lines) → the buffer, over the dust
//   bloom: what's brighter than white, blurred wide, added to the buffer
//   out: buffer + haze → quieter under the page's text → tone mapping
//        (Khronos's neutral curve) → the display's encoding → the floor
//        (the page's own color as a tint, and a grain that never moves)
//
// The haze is taken before the bodies are drawn, so it's the dots' own
// light and nothing else: keep that order.
//
// Knobs, for looking and for weighing a part's cost: `?haze=0`, `?bloom=0`,
// `?bloomScale` (the bloom's resolution, of the buffer's), `?scrim=0`.
import { HalfFloatType, LinearFilter, NeutralToneMapping, ShaderMaterial, UnsignedByteType, Vector2, Vector3, Vector4, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { knob, on } from './knobs.ts';

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
  uniform vec3 uFloor;
  uniform float uGrain;
  // Where the page's text lies, in the buffer's pixels from its bottom
  // left (left, bottom, right, top); then how far the quiet fades out past
  // it, and what's left of the light under it.
  uniform vec4 uScrim;
  uniform vec2 uQuiet;
  varying vec2 vUv;
  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  void main() {
    vec3 color = texture2D(tScene, vUv).rgb + uHaze * texture2D(tHaze, vUv).rgb;
    vec2 outside = max(max(uScrim.xy - gl_FragCoord.xy, gl_FragCoord.xy - uScrim.zw), 0.0);
    color *= mix(1.0, uQuiet.y, 1.0 - smoothstep(0.0, uQuiet.x, length(outside)));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // The floor, in the display's own values: a tint, and a grain that is
    // the same every frame (the scene draws only when something moved).
    gl_FragColor.rgb += uFloor + uGrain * (hash(gl_FragCoord.xy) + hash(gl_FragCoord.yx + 71.7) - 1.0);
  }
`;

/** The quiet under the page's text: how far it fades out past the text
 *  (CSS px), and what's left of the light there. */
const QUIET = { fade: 56, left: 0.3 };

export interface Look {
  /** The buffer's size, in the scene's own pixels, `pixelRatio` of them a
   *  CSS pixel. */
  setSize(width: number, height: number, pixelRatio: number): void;
  /** Where the page's text lies over the scene: left, top, width, height,
   *  CSS px. */
  setScrim(bounds: ArrayLike<number>): void;
  /** Draws the dust, then the bodies over it, to the canvas. */
  render(dust: Scene, bodies: Scene, camera: Camera): void;
}

/** The look's passes. `plain` leaves out the haze, the bloom, and the quiet
 *  under the page's text: a row drawn alone, to be found in a screenshot, is
 *  a disc as it is and nothing around it.
 *  `page` is the page's own background, 0 to 1 in the display's values. */
export function createLook(renderer: WebGLRenderer, page: [number, number, number], plain: boolean): Look {
  renderer.toneMapping = NeutralToneMapping;
  renderer.setClearColor(0x000000, 1);
  // The buffer holds light past white, which a GPU must be able to draw
  // into. One that can't gets the display's 8 bits: every dot is still
  // drawn, nothing is brighter than white, and so there's nothing to bloom.
  const deep = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  const target = () => {
    const made = new WebGLRenderTarget(1, 1, { type: deep ? HalfFloatType : UnsignedByteType, depthBuffer: false });
    made.texture.minFilter = made.texture.magFilter = LinearFilter;
    return made;
  };
  const buffer = target();
  /** Half, a quarter, and an eighth of the buffer, and the blur's scratch. */
  const steps = [target(), target(), target()];
  const scratch = target();
  const material = (fragmentShader: string, uniforms: ShaderMaterial['uniforms']) => new ShaderMaterial({ vertexShader: QUAD_VERTEX, fragmentShader, uniforms, depthTest: false, depthWrite: false });
  const copy = material(COPY, { tSource: { value: null } });
  const blur = material(BLUR, { tSource: { value: null }, uStep: { value: new Vector2() } });
  const hazy = !plain && on('haze');
  const scrimmed = !plain && on('scrim');
  const out = material(OUT, {
    tScene: { value: buffer.texture },
    tHaze: { value: steps[2]!.texture },
    uHaze: { value: hazy ? 0.9 : 0 },
    uFloor: { value: new Vector3(...page) },
    uGrain: { value: 0.014 },
    uScrim: { value: new Vector4() },
    uQuiet: { value: new Vector2(1, 1) },
  });
  const quad = new FullScreenQuad(copy);
  // Its threshold at white: it spreads the Sun, the biggest bodies, and
  // the brightest stars, and leaves the dust alone.
  const bloom = deep && !plain && on('bloom') ? new UnrealBloomPass(new Vector2(1, 1), 0.55, 0.6, 1) : undefined;
  const bloomScale = knob('bloomScale', 1);
  let size = { width: 1, height: 1, pixelRatio: 1 };
  let scrim: ArrayLike<number> = [0, 0, 0, 0];

  const pass = (shader: ShaderMaterial, to: WebGLRenderTarget | null) => {
    quad.material = shader;
    renderer.setRenderTarget(to);
    quad.render(renderer);
  };
  const quiet = () => {
    const [left, top, width, height] = [scrim[0]!, scrim[1]!, scrim[2]!, scrim[3]!].map((px) => px * size.pixelRatio) as [number, number, number, number];
    // No text measured yet, or the knob: nothing is quieted.
    const there = scrimmed && width > 0 && height > 0;
    (out.uniforms.uScrim!.value as Vector4).set(left, size.height - top - height, left + width, size.height - top);
    (out.uniforms.uQuiet!.value as Vector2).set(QUIET.fade * size.pixelRatio, there ? QUIET.left : 1);
  };

  return {
    setSize(width, height, pixelRatio) {
      size = { width, height, pixelRatio };
      buffer.setSize(width, height);
      steps.forEach((step, at) => step.setSize(Math.max(1, width >> (at + 1)), Math.max(1, height >> (at + 1))));
      scratch.setSize(Math.max(1, width >> 3), Math.max(1, height >> 3));
      // The bloom blurs wide, so it can do with fewer pixels than the buffer.
      bloom?.setSize(Math.round(width * bloomScale), Math.round(height * bloomScale));
      quiet();
    },
    setScrim(bounds) {
      scrim = bounds;
      quiet();
    },
    render(dust, bodies, camera) {
      renderer.autoClear = true;
      renderer.setRenderTarget(buffer);
      renderer.render(dust, camera);
      if (hazy) {
        let source = buffer;
        for (const step of steps) {
          copy.uniforms.tSource!.value = source.texture;
          pass(copy, step);
          source = step;
        }
        const small = steps[2]!;
        for (let turn = 0; turn < 2; turn++) {
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
