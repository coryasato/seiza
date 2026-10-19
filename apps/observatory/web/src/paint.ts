/**
 * Runs `run` once, after the page's first paint: at its paint timing entry
 * (the frame's presentation, after the task that drew it), or two frames on
 * where there's no paint timing. A page that can't paint (hidden now, or
 * before its paint) runs it at once, as there's nothing to wait for. The
 * page's contender frames and its metrics module start here (root
 * `CLAUDE.md`, rule 2).
 */
export function afterFirstPaint(run: () => void): void {
  let done = false;
  let observer: PerformanceObserver | undefined;
  const once = () => {
    if (done) return;
    done = true;
    observer?.disconnect();
    document.removeEventListener('visibilitychange', hidden);
    run();
  };
  const hidden = () => {
    if (document.visibilityState === 'hidden') once();
  };
  if (PerformanceObserver.supportedEntryTypes.includes('paint')) {
    observer = new PerformanceObserver(once);
    observer.observe({ type: 'paint', buffered: true });
  } else {
    requestAnimationFrame(() => requestAnimationFrame(once));
  }
  document.addEventListener('visibilitychange', hidden);
  hidden();
}
