// Two fingers on the scene. GPUI's canvas takes every touch, and its
// recognizer follows one at a time: the first finger is the interface's
// (on the surface, the left button's press, drag, and release: `host.rs`,
// `touch_listener`), and a second is ignored. So the page counts the
// fingers itself, on the window, before GPUI's canvas hears them, and
// hands the scene the two it has: a pinch zooms, a twist turns, and both
// dragged up or down tilt, as a map's do.

export interface TwoFingers {
  /** Two fingers are down, at window positions (CSS px); `frame` is whose
   *  camera a hand has now (0 the fixed frame's, 1 the ride's; -1 nobody's). */
  start(ax: number, ay: number, bx: number, by: number, frame: number): void;
  move(ax: number, ay: number, bx: number, by: number): void;
  /** Fewer than two are. */
  end(): void;
  /** A trackpad's pinch as Safari tells it: `by` times as far, toward a
   *  window position. */
  pinch(x: number, y: number, by: number, frame: number): void;
}

/** `hand`: whose camera a hand has; `inset`: the panel's width on screen.
 *  Two fingers are the scene's only where both are left of the panel. */
export function watchTouches(scene: () => TwoFingers | undefined, hand: () => number, inset: () => number): void {
  const down = new Map<number, [number, number]>();
  let two: [number, number] | undefined;
  const points = (): [number, number, number, number] => {
    const [a, b] = [down.get(two![0])!, down.get(two![1])!];
    return [a[0], a[1], b[0], b[1]];
  };
  const ended = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || !down.delete(event.pointerId)) return;
    if (two?.includes(event.pointerId)) {
      two = undefined;
      scene()?.end();
    }
  };
  // (In the capture phase: before the canvas's own listeners.)
  addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType !== 'touch') return;
      down.set(event.pointerId, [event.clientX, event.clientY]);
      // (Nothing to hand them to before the scene is up, and nothing of
      // the crate's to ask: on a phone's page it never is.)
      if (down.size !== 2 || two || !scene()) return;
      const ids = [...down.keys()] as [number, number];
      const room = innerWidth - inset();
      if (ids.some((id) => down.get(id)![0] > room)) return;
      two = ids;
      scene()?.start(...points(), hand());
    },
    true,
  );
  addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'touch' || !down.has(event.pointerId)) return;
      down.set(event.pointerId, [event.clientX, event.clientY]);
      if (two?.includes(event.pointerId)) scene()?.move(...points());
    },
    true,
  );
  addEventListener('pointerup', ended, true);
  addEventListener('pointercancel', ended, true);

  // Safari tells a trackpad's pinch as gesture events of its own, never
  // as the wheel with Ctrl that the other browsers send and the scene
  // zooms by; unanswered, it zooms the page. Each change is the scale
  // since the gesture began. (On a touch screen it tells two fingers this
  // way as well: those are counted above.)
  let scaled = 1;
  const pinched = (event: Event) => {
    const { scale, clientX, clientY } = event as Event & { scale?: number; clientX: number; clientY: number };
    // (Before the scene is up the page's own zoom is left alone.)
    if (down.size || !scale || !scene()) return;
    event.preventDefault();
    if (event.type === 'gesturestart') scaled = 1;
    else if (clientX <= innerWidth - inset()) scene()?.pinch(clientX, clientY, scaled / scale, hand());
    scaled = scale;
  };
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) addEventListener(type, pinched, { capture: true, passive: false });
}
