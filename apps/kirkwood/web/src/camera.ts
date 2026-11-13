// The camera a hand moves: a map's, with a map's four numbers (what it
// looks at, a point on the ecliptic; its distance from it; its tilt from
// straight down; its bearing), and a roll: the opening's pose, which a hand's
// first tilt or turn eases out and the way home gives back. The scene places its
// camera from them (`scene.ts`, `place`); this is what a hand does to them:
// a drag pans along the ecliptic, a wheel zooms toward the pointer, a drag
// let go moving glides to rest, a drag with Shift held tilts and
// turns about what the camera looks at, a double click zooms in toward
// the pointer, the arrows pan and + and − zoom, and the way home flies it
// back to where it opened. It knows no Three.js: the scene tells it where a window
// position's ray meets the ecliptic.
//
// The interface hands every input over (`crate/src/host.rs`: GPUI's canvas
// takes every DOM event), and only in space: to the fixed frame's camera,
// or riding with Jupiter to the ride's own, a hand of its own on numbers in
// the frame that turns. Why: `docs/DECISIONS.md`, "Input".

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
/** The tilt and the turn: degrees a CSS pixel of the drag, across the
 *  window for the bearing and up and down for the tilt; the most tilt from
 *  straight down, short of edge-on and never under the plane. */
export const TURN = { bearing: 0.8, tilt: 0.5, most: 85 };
/** A double click: how much nearer, and how long the way there (ms). */
export const DOUBLE = { nearer: 2, ms: 260 };

/** The keys: how far one press of an arrow carries the camera (CSS px at
 *  what it looks at; held, the key's repeats keep it going), how much
 *  nearer or farther one press of + or − takes it, and how long that way
 *  is (ms). */
export const KEYS = { pan: 120, zoom: 1.6, ms: 260 };
/** The way home: how long the camera's flight back to where it opened is (ms). */
export const HOME = { ms: 700 };

/** The pose: how long the roll the camera opens with takes to ease out
 *  to a level horizon, on its first tilt or turn (ms). */
export const POSE = { ms: 320 };

/** Where a camera can be flown: a view's numbers, with a roll only where
 *  the flight should leave it one (home, to the opening's pose). */
export type Place = Omit<View, 'roll'> & { roll?: number };

/** The modifiers, as the interface hands them over (`scene.rs`). */
export const CTRL = 1;
export const SHIFT = 2;

/** How much farther (past 1) or nearer a wheel's `delta` takes a camera,
 *  with the modifiers held. */
export function zoomBy(delta: number, modifiers: number): number {
  const rate = modifiers & CTRL ? ZOOM.pinch : ZOOM.wheel;
  return Math.exp(Math.min(ZOOM.most, Math.max(-ZOOM.most, -delta * rate)));
}

export interface Ground {
  /** Where a window position's ray meets the ecliptic (x, y, au, in the
   *  frame the view's numbers are in), within `REACH`; nothing over the sky
   *  or past the reach. With `held`, always a point: past the reach or over
   *  the sky, the one at the reach the same way round. */
  ground(x: number, y: number, held: boolean): [number, number] | undefined;
  /** A CSS pixel at what the camera looks at, au. */
  pixel(): number;
  /** The nearest and the farthest the camera goes, au. */
  limits(): [number, number];
}

export interface Hand {
  /** A press anywhere in the window: a camera moving on its own stops. */
  press(): void;
  /** A drag on the scene: its start (the button, 0 the left; the
   *  modifiers), its moves, its end. `now` is the page clock. */
  dragStart(x: number, y: number, button: number, modifiers: number, now: number): void;
  dragMove(x: number, y: number, now: number): void;
  dragEnd(x: number, y: number, now: number): void;
  /** A wheel at a window position: toward the pointer. */
  wheel(x: number, y: number, delta: number, modifiers: number, now: number): void;
  /** A double click at a window position: nearer, toward the pointer. */
  zoomIn(x: number, y: number, now: number): void;
  /** An arrow key: the camera slides along the ecliptic, `right` and `up`
   *  each -1, 0, or 1 as the window has them, and comes to rest as a glide
   *  does. */
  nudge(right: number, up: number, now: number): void;
  /** The + key or the − key: nearer or farther, toward what the camera
   *  looks at. */
  zoomStep(nearer: boolean, now: number): void;
  /** The way home: the camera flies to `to`, asked for at each step (a
   *  place that follows the window is where it is when the camera lands). */
  home(to: () => Place, now: number): void;
  /** What moves on its own (the glide, a zoom on its way, the flight
   *  home) moved on to `now`: whether the camera moved. */
  step(now: number): boolean;
  /** Everything let go: a flight of the scene's own has the camera. */
  rest(): void;
  /** Whether the camera is moving on its own. */
  gliding(): boolean;
}

/** The hand on `view`. `changed` is called when it moved the camera from
 *  an input (what moves on its own is `step`'s to report). */
export function createHand(view: View, scene: Ground, changed: () => void, { glideMs = GLIDE.ms } = {}): Hand {
  /** The ecliptic's point a pan holds under the pointer. */
  let grab: [number, number] | undefined;
  /** Where the pointer was at the last move of a drag that tilts and turns. */
  let turn: [number, number] | undefined;
  /** Where the camera looked, and when, over the drag's last moves. */
  let trail: { at: number; x: number; y: number }[] = [];
  /** The glide: what the camera looks at, au a ms, as of `at`. */
  let glide: { vx: number; vy: number; at: number } | undefined;
  /** A double click's zoom: the point that holds (if the pointer had one),
   *  the distance it began at and ends at, and when it began. */
  let zoom: { under: [number, number] | undefined; from: number; to: number; at: number; ms: number; key?: boolean } | undefined;
  /** The pose's roll easing out to a level horizon, from what it was and
   *  when: begun by the first tilt or turn of a camera that has a roll (a
   *  pan and a zoom keep it), it goes on to its end whatever is pressed. */
  let level: { from: number; at: number } | undefined;
  /** The flight home: where the camera was, where it goes, and when it began. */
  let flight: { from: Place; to: () => Place; at: number } | undefined;

  const bound = () => {
    const out = Math.hypot(view.x, view.y);
    if (out > AT_MOST) [view.x, view.y] = [(view.x * AT_MOST) / out, (view.y * AT_MOST) / out];
  };
  /** The camera at `distance`, the point `under` (if any) holding still:
   *  the camera and what it looks at close on it together. */
  const zoomTo = (distance: number, under: [number, number] | undefined) => {
    const scaled = distance / view.distance;
    if (under) {
      view.x = under[0] + (view.x - under[0]) * scaled;
      view.y = under[1] + (view.y - under[1]) * scaled;
    }
    view.distance = distance;
    bound();
  };
  const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.abs(a);
  const within = (distance: number) => {
    const [nearest, farthest] = scene.limits();
    return Math.min(farthest, Math.max(nearest, distance));
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
  const turned = (x: number, y: number) => {
    if (!turn) return;
    const [dx, dy] = [x - turn[0], y - turn[1]];
    turn = [x, y];
    if (!dx && !dy) return;
    // As a tabletop is turned by its near edge: a drag to the right
    // carries what's nearer than the middle to the right. A drag up
    // lifts the camera toward straight down, and a drag down lowers it
    // toward the side view.
    view.bearing = (((view.bearing - dx * TURN.bearing) % 360) + 360) % 360;
    const tilt = view.tilt + dy * TURN.tilt;
    // (A camera opened past either end by a knob only comes back in.)
    view.tilt = Math.min(Math.max(TURN.most, view.tilt), Math.max(Math.min(0, view.tilt), tilt));
    changed();
  };

  /** The glide moved on to `now`: whether the camera moved. */
  const slide = (now: number): boolean => {
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
  };

  return {
    press() {
      glide = undefined;
      zoom = undefined;
      flight = undefined;
    },
    dragStart(x, y, button, modifiers, now) {
      glide = undefined;
      zoom = undefined;
      flight = undefined;
      grab = undefined;
      turn = undefined;
      // The left button alone: plain it pans, with Shift held it tilts and
      // turns. (Ctrl is a pinch's, on a wheel; held with a drag it pans.)
      if (button !== 0) return;
      if (modifiers & SHIFT) {
        // A tilt and a turn are a level camera's: the pose eases out
        // under the drag's first moves.
        if (view.roll && !level) level = { from: view.roll, at: now };
        turn = [x, y];
        return;
      }
      grab = scene.ground(x, y, true);
      trail = [{ at: now, x: view.x, y: view.y }];
    },
    dragMove(x, y, now) {
      pan(x, y, now);
      turned(x, y);
    },
    dragEnd(_x, _y, now) {
      turn = undefined;
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
      zoom = undefined;
      flight = undefined;
      const distance = within(view.distance * zoomBy(delta, modifiers));
      // (At a stop already. Not an exact test: the ride's distance is kept
      // as a ratio, and comes back a rounding off.)
      if (same(distance, view.distance)) return;
      // The point under the pointer holds still. Over the sky there is none.
      zoomTo(distance, scene.ground(x, y, false));
      // A pan under way holds its point at the new distance, and its speed
      // is read from here on: the zoom's own move isn't the hand's.
      if (grab) {
        grab = scene.ground(x, y, true);
        trail = [{ at: now, x: view.x, y: view.y }];
      }
      changed();
    },
    zoomIn(x, y, now) {
      glide = undefined;
      flight = undefined;
      const to = within(view.distance / DOUBLE.nearer);
      zoom = same(to, view.distance) ? undefined : { under: scene.ground(x, y, false), from: view.distance, to, at: now, ms: DOUBLE.ms };
    },
    nudge(right, up, now) {
      // (A hand mid-drag has the camera.)
      if ((!right && !up) || grab || turn) return;
      zoom = undefined;
      flight = undefined;
      // Along the ecliptic as the window has it: to the right, and away
      // from the camera. A glide that would cover the key's reach; a held
      // key's repeats start it again, so the camera keeps its speed. (The
      // glide it replaces is moved on to now first: a repeat comes between
      // two frames, and what the camera covered since the last is its.)
      slide(now);
      const bearing = (view.bearing * Math.PI) / 180;
      const [sin, cos] = [Math.sin(bearing), Math.cos(bearing)];
      // With the pose's roll the window's right isn't the plane's: the way
      // along the plane that goes straight across the window (or up it),
      // the plane's depth being foreshortened by the tilt. (Not past 78°:
      // nearer edge-on a pixel up the window is most of the plane.)
      const roll = (view.roll * Math.PI) / 180;
      const flat = Math.max(0.2, Math.cos((view.tilt * Math.PI) / 180));
      const [across, away] = [right * Math.cos(roll) - up * Math.sin(roll), (right * Math.sin(roll) + up * Math.cos(roll)) / (roll ? flat : 1)];
      const speed = (KEYS.pan * scene.pixel()) / glideMs / Math.hypot(across, away);
      glide = { vx: (across * cos - away * sin) * speed, vy: (across * sin + away * cos) * speed, at: now };
    },
    zoomStep(nearer, now) {
      // A held key's repeats come faster than a step is long: one step is
      // let run most of its way before the next begins.
      if (grab || turn) return;
      if (zoom?.key && nearer === zoom.to < zoom.from && now - zoom.at < 0.6 * zoom.ms) return;
      const to = within(nearer ? view.distance / KEYS.zoom : view.distance * KEYS.zoom);
      // (At a stop already: the key does nothing, and ends nothing.)
      if (same(to, view.distance)) return;
      glide = undefined;
      flight = undefined;
      zoom = { under: undefined, from: view.distance, to, at: now, ms: KEYS.ms, key: true };
    },
    home(to, now) {
      // (A hand mid-drag has the camera.)
      if (grab || turn) return;
      glide = undefined;
      zoom = undefined;
      level = undefined;
      const [from, home] = [{ x: view.x, y: view.y, distance: view.distance, tilt: view.tilt, bearing: view.bearing, roll: view.roll }, to()];
      const there = same(from.distance, home.distance) && Math.hypot(from.x - home.x, from.y - home.y) <= 1e-9 * home.distance && Math.abs(from.tilt - home.tilt) < 1e-9 && Math.abs(from.bearing - home.bearing) < 1e-9 && Math.abs(from.roll - (home.roll ?? from.roll)) < 1e-9;
      flight = there ? undefined : { from, to, at: now };
    },
    step(now) {
      let moved = false;
      if (level) {
        // (A frame's time can be before the press's, in the frame of it.)
        const t = Math.min(1, Math.max(0, (now - level.at) / POSE.ms));
        // Fast at first, easing in to a level horizon.
        view.roll = t >= 1 ? 0 : level.from * (1 - t) ** 3;
        if (t >= 1) level = undefined;
        moved = true;
      }
      if (flight) {
        const [from, to] = [flight.from, flight.to()];
        // (A frame's time can be before the press's, in the frame of it.)
        const t = Math.min(1, Math.max(0, (now - flight.at) / HOME.ms));
        // Eased both ways; the distance even in its ratio, and the bearing
        // the short way round.
        const k = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
        const round = ((((to.bearing - from.bearing) % 360) + 540) % 360) - 180;
        if (t >= 1) Object.assign(view, to);
        else {
          view.x = from.x + (to.x - from.x) * k;
          view.y = from.y + (to.y - from.y) * k;
          view.distance = from.distance * (to.distance / from.distance) ** k;
          view.tilt = from.tilt + (to.tilt - from.tilt) * k;
          // (Home to a posed opening gives the pose back.)
          if (to.roll !== undefined) view.roll = from.roll! + (to.roll - from.roll!) * k;
          view.bearing = (((from.bearing + round * k) % 360) + 360) % 360;
        }
        if (t >= 1) flight = undefined;
        moved = true;
      }
      if (zoom) {
        // (A frame's time can be before the press's, in the frame of it.)
        const t = Math.min(1, Math.max(0, (now - zoom.at) / zoom.ms));
        // Fast at first, easing in to rest; a zoom is even in its ratio.
        zoomTo(t >= 1 ? zoom.to : zoom.from * (zoom.to / zoom.from) ** (1 - (1 - t) ** 3), zoom.under);
        if (t >= 1) zoom = undefined;
        moved = true;
      }
      return slide(now) || moved;
    },
    rest() {
      glide = undefined;
      zoom = undefined;
      flight = undefined;
      grab = undefined;
      turn = undefined;
    },
    gliding: () => !!glide || !!zoom || !!flight || !!level,
  };
}
