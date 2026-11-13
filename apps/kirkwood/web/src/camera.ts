// The camera a hand moves: a map's, with a map's four numbers (what it
// looks at, a point on the ecliptic; its distance from it; its tilt from
// straight down; its bearing), and the opening's roll. The scene places its
// camera from them (`scene.ts`, `place`); this is what a hand does to them:
// a drag pans along the ecliptic, a wheel zooms toward the pointer, and a
// drag let go moving glides to rest. It knows no Three.js: the scene tells
// it where a window position's ray meets the ecliptic.
//
// The interface hands every input over (`crate/src/host.rs`: GPUI's canvas
// takes every DOM event), and only in space, in the fixed frame.
// Why: `docs/DECISIONS.md`, "Input".

/** The camera's numbers: `x`, `y` what it looks at (the ecliptic's, au),
 *  `distance` from it (au), `tilt` from straight down, `bearing` the way it
 *  stands from what it looks at, round the ecliptic's pole (`?az`), and
 *  `roll` about its line of sight, all degrees. */
export interface View {
  x: number;
  y: number;
  distance: number;
  tilt: number;
  bearing: number;
  roll: number;
}

/** A wheel's reach, au; how fast it zooms, a wheel's pixel and a pinch's
 *  (a trackpad's pinch is a wheel with Ctrl held, in smaller steps); and
 *  the most one event zooms, as an exponent. */
export const ZOOM = { nearest: 0.05, farthest: 60, wheel: 0.002, pinch: 0.01, most: 0.5 };
/** How far out on the ecliptic a pointer still holds a point, in camera
 *  distances along the plane: past it (toward the horizon, where a pixel
 *  is tens of au) a drag holds the point at this reach, and a wheel zooms
 *  toward what the camera looks at, as it does over the sky. */
export const REACH = 8;
/** How far from the Sun the camera may look, au: the wheel's farthest. */
export const AT_MOST = ZOOM.farthest;
/** The glide: its time constant (ms; `?glide`), the speeds it starts over
 *  and rests under and the most it starts at (CSS px a second), the part of
 *  the drag its speed is read from (short, so a hand that stopped and only
 *  trembles reads as slow), and how long a still hand before the release
 *  means no glide (ms). */
export const GLIDE = { ms: 220, from: 80, rest: 4, most: 2000, read: 50, still: 60 };

/** The modifiers, as the interface hands them over (`scene.rs`). */
export const CTRL = 1;
export const SHIFT = 2;

/** How much farther (past 1) or nearer a wheel's `delta` takes a camera,
 *  with the modifiers held: the fixed frame's, and the ride's own. */
export function zoomBy(delta: number, modifiers: number): number {
  const rate = modifiers & CTRL ? ZOOM.pinch : ZOOM.wheel;
  return Math.exp(Math.min(ZOOM.most, Math.max(-ZOOM.most, -delta * rate)));
}

export interface Ground {
  /** Where a window position's ray meets the ecliptic (x, y, au), within
   *  `REACH`; nothing over the sky or past the reach. With `held`, always
   *  a point: past the reach or over the sky, the one at the reach the same
   *  way round. */
  ground(x: number, y: number, held: boolean): [number, number] | undefined;
  /** A CSS pixel at what the camera looks at, au. */
  pixel(): number;
}

export interface Hand {
  /** A press anywhere in the window: a glide stops. */
  press(): void;
  /** A drag on the scene: its start (the button, 0 the left; the
   *  modifiers), its moves, its end. `now` is the page clock. */
  dragStart(x: number, y: number, button: number, modifiers: number, now: number): void;
  dragMove(x: number, y: number, now: number): void;
  dragEnd(x: number, y: number, now: number): void;
  /** A wheel at a window position: toward the pointer. */
  wheel(x: number, y: number, delta: number, modifiers: number, now: number): void;
  /** The glide moved on to `now`: whether the camera moved. */
  step(now: number): boolean;
  /** Everything let go: a flight of the scene's own has the camera. */
  rest(): void;
  /** Whether the camera is gliding. */
  gliding(): boolean;
}

/** The hand on `view`. `changed` is called when it moved the camera from
 *  an input (a glide's moves are `step`'s to report). */
export function createHand(view: View, scene: Ground, changed: () => void, glideMs = GLIDE.ms): Hand {
  /** The ecliptic's point a pan holds under the pointer. */
  let grab: [number, number] | undefined;
  /** Where the camera looked, and when, over the drag's last moves. */
  let trail: { at: number; x: number; y: number }[] = [];
  /** The glide: what the camera looks at, au a ms, as of `at`. */
  let glide: { vx: number; vy: number; at: number } | undefined;

  const bound = () => {
    const out = Math.hypot(view.x, view.y);
    if (out > AT_MOST) [view.x, view.y] = [(view.x * AT_MOST) / out, (view.y * AT_MOST) / out];
  };
  const pan = (x: number, y: number, now: number) => {
    if (!grab) return;
    const under = scene.ground(x, y, true)!;
    // The camera slides along the plane, so the ray through the pointer
    // meets it as far off as the held point now is.
    view.x += grab[0] - under[0];
    view.y += grab[1] - under[1];
    bound();
    trail.push({ at: now, x: view.x, y: view.y });
    while (trail.length > 2 && now - trail[0]!.at > GLIDE.read) trail.shift();
    changed();
  };

  return {
    press() {
      glide = undefined;
    },
    dragStart(x, y, button, modifiers, now) {
      glide = undefined;
      grab = undefined;
      // The left button alone pans. With a modifier held the drag is the
      // tilt's and the turn's, not a pan's.
      if (button !== 0 || modifiers & (CTRL | SHIFT)) return;
      grab = scene.ground(x, y, true);
      trail = [{ at: now, x: view.x, y: view.y }];
    },
    dragMove(x, y, now) {
      pan(x, y, now);
    },
    dragEnd(_x, _y, now) {
      if (!grab) return;
      const first = trail[0]!;
      const last = trail[trail.length - 1]!;
      grab = undefined;
      // Let go moving: the hand was still moving at the release.
      if (trail.length < 2 || now - last.at > GLIDE.still || last.at <= first.at) return;
      let [vx, vy] = [(last.x - first.x) / (last.at - first.at), (last.y - first.y) / (last.at - first.at)];
      const pixel = scene.pixel();
      const speed = (Math.hypot(vx, vy) / pixel) * 1000;
      if (speed < GLIDE.from) return;
      if (speed > GLIDE.most) [vx, vy] = [(vx * GLIDE.most) / speed, (vy * GLIDE.most) / speed];
      glide = { vx, vy, at: now };
    },
    wheel(x, y, delta, modifiers, now) {
      glide = undefined;
      const distance = Math.min(ZOOM.farthest, Math.max(ZOOM.nearest, view.distance * zoomBy(delta, modifiers)));
      const scaled = distance / view.distance;
      if (scaled === 1) return;
      // The point under the pointer holds still: the camera and what it
      // looks at close on it together. Over the sky there is none.
      const under = scene.ground(x, y, false);
      if (under) {
        view.x = under[0] + (view.x - under[0]) * scaled;
        view.y = under[1] + (view.y - under[1]) * scaled;
      }
      view.distance = distance;
      bound();
      // A pan under way holds its point at the new distance, and its speed
      // is read from here on: the zoom's own move isn't the hand's.
      if (grab) {
        grab = scene.ground(x, y, true);
        trail = [{ at: now, x: view.x, y: view.y }];
      }
      changed();
    },
    step(now) {
      if (!glide) return false;
      // (A frame's time can be before the release's, in the frame of it.)
      const dt = now - glide.at;
      if (dt <= 0) return false;
      const left = Math.exp(-dt / glideMs);
      // What a speed falling off this way covers in `dt`.
      view.x += glide.vx * glideMs * (1 - left);
      view.y += glide.vy * glideMs * (1 - left);
      glide = { vx: glide.vx * left, vy: glide.vy * left, at: now };
      const before = [view.x, view.y];
      bound();
      const speed = (Math.hypot(glide.vx, glide.vy) / scene.pixel()) * 1000;
      // At rest, or held at the farthest it may look.
      if (speed < GLIDE.rest || before[0] !== view.x || before[1] !== view.y) glide = undefined;
      return true;
    },
    rest() {
      glide = undefined;
      grab = undefined;
    },
    gliding: () => !!glide,
  };
}
