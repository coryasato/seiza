// A phone's page. Kirkwood is built for a larger screen: it holds 90 MB
// of rows and draws 1.6 million dots through a mouse's or a trackpad's
// camera. A phone isn't sent any of it unasked: the page's own script
// decides before the wasm, the font, or a file is asked for (the HTML's
// preloads carry the same media query, `vite.config.ts`), and shows what
// the app looks like, says what it's built for, offers to send the link
// on, and opens the app anyway if asked.

/** Not a phone: something whose first pointer is a fine one, or a window
 *  at least this many CSS px both ways (a tablet is; a phone held either
 *  way isn't, nor one with a pen or a mouse beside its screen: its first
 *  pointer is still a finger). The HTML's preloads of the wasm and the
 *  font carry it as their `media`. */
export const NOT_PHONE = '(pointer: fine), (min-width: 600px) and (min-height: 600px)';

/** The app's own pictures, in the order they're shown (`public/phone/`,
 *  taken by `checks/see.ts --only stills`), and what each is. */
const STILLS: [string, string][] = [
  ['belt', 'The asteroid belt from above its plane: 1.58 million dots, colored by orbit size, the Sun at the middle and Jupiter outside.'],
  ['table', 'The table of the same rows, open beside the belt.'],
  ['sorted', 'The dots sorted by orbit size: the gaps Daniel Kirkwood found in the catalog.'],
  ['ride', 'Riding with Jupiter: the Trojans ahead of it and behind, and the Hildas in a triangle.'],
  ['gap', 'A gap picked: a marker on an orbit that takes a third of Jupiter\'s.'],
];
/** How long each is shown, and its fade, ms. */
const SHOWN_MS = 4000;
const FADE_MS = 800;
/** What the app asks for, opened: the wasm and the three files, as a
 *  deploy sends them (brotli 11: `docs/DECISIONS.md`, "Hosting"; the page
 *  can't work it out, the manifest's bytes being the files' own). */
const DOWNLOAD = '55 MB';

export const isPhone = (): boolean => !matchMedia(NOT_PHONE).matches;

/** The phone's page, in place of the app; `open` when it's asked for anyway. */
export function showPhone(open: () => void): void {
  const base = import.meta.env.BASE_URL;
  const page = document.createElement('main');
  page.id = 'phone';
  const style = document.createElement('style');
  style.textContent = `
    html, body { overflow: auto; height: auto; min-height: 100%; }
    #phone { position: relative; z-index: 3; box-sizing: border-box; max-width: 640px; margin: 0 auto; padding: 20px 16px 32px; font: 15px/22px system-ui, sans-serif; color: #fafafa; }
    #phone h1 { margin: 0 0 12px; font-size: 20px; line-height: 28px; font-weight: 600; }
    #phone figure { position: relative; margin: 0 -16px 16px; aspect-ratio: 1440 / 900; background: #05060a; overflow: hidden; }
    #phone figure img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity ${FADE_MS}ms; }
    #phone figure img.shown { opacity: 1; }
    #phone p { margin: 0 0 12px; }
    #phone .muted { color: oklch(0.708 0 0); font-size: 13px; line-height: 19px; }
    #phone .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 8px; }
    #phone button { height: 40px; padding: 0 14px; border: 1px solid oklch(0.3 0 0); border-radius: 8px; background: oklch(0.269 0 0); color: inherit; font: inherit; }
    #phone button.first { background: #fafafa; color: #05060a; border-color: #fafafa; }
    @media (prefers-reduced-motion: reduce) { #phone figure img { transition: none; } }
  `;
  const figure = document.createElement('figure');
  const caption = document.createElement('p');
  caption.className = 'muted';
  caption.setAttribute('aria-live', 'off');
  // The first is the still: the rest are asked for one at a time, each
  // when the one before it has been shown.
  const stills = STILLS.map(([name, says], at) => {
    const still = document.createElement('img');
    still.alt = says;
    still.decoding = 'async';
    if (!at) {
      still.src = `${base}phone/${name}.jpg`;
      still.className = 'shown';
    }
    figure.append(still);
    return still;
  });
  caption.textContent = STILLS[0]![1];
  let shown = 0;
  /** The stills that didn't arrive: passed over from then on. */
  const failed = new Set<number>();
  stills.forEach((still, at) => still.addEventListener('error', () => failed.add(at)));
  const still_ = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const turn = setInterval(() => {
    if (still_ || document.hidden) return;
    // The next one that may yet be shown.
    let next = shown;
    do next = (next + 1) % stills.length;
    while (next !== shown && failed.has(next));
    if (next === shown) return;
    const [name, says] = STILLS[next]!;
    const to = stills[next]!;
    if (to.complete && to.naturalWidth) {
      stills[shown]!.className = '';
      to.className = 'shown';
      caption.textContent = says;
      shown = next;
    } else if (!to.src) {
      // (Shown at the turn after it arrives.)
      to.src = `${base}phone/${name}.jpg`;
    }
  }, SHOWN_MS);

  const heading = document.createElement('h1');
  heading.textContent = 'Kirkwood';
  const what = document.createElement('p');
  what.textContent = 'The asteroid belt, drawn from a table of 1.58 million orbits. Every dot is a row: fly through the belt, sort it into the gaps, ride along with Jupiter, and open the table the dots come from.';
  const why = document.createElement('p');
  why.textContent = 'Kirkwood is built for a larger screen: a laptop or a desktop, or a tablet, where there is room for the belt and its table side by side. These are pictures of it.';
  const actions = document.createElement('div');
  actions.className = 'actions';
  const send = document.createElement('button');
  send.className = 'first';
  // (Not every browser has a share sheet: the types say they all do.)
  const shares = 'share' in navigator;
  const SEND = shares ? 'Send the link on' : 'Copy the link';
  send.textContent = SEND;
  send.addEventListener('click', () => {
    const url = location.origin + location.pathname;
    const said = (text: string) => {
      send.textContent = text;
      setTimeout(() => (send.textContent = SEND), 2000);
    };
    if (shares) void navigator.share({ title: 'Kirkwood', text: 'The asteroid belt, drawn from a table of 1.58 million orbits.', url }).catch(() => {});
    else void navigator.clipboard.writeText(url).then(() => said('Copied'), () => said(url));
  });
  const anyway = document.createElement('button');
  anyway.textContent = 'Open it anyway';
  anyway.addEventListener('click', () => {
    clearInterval(turn);
    page.remove();
    style.remove();
    open();
  });
  actions.append(send, anyway);
  const cost = document.createElement('p');
  cost.className = 'muted';
  cost.textContent = `Opening it here downloads ${DOWNLOAD} and holds every row in memory. On a phone it may be slow, its controls are small, and the browser may close the page.`;
  // Whose the data in the pictures is: the app's own credits (the foot
  // of its controls' list, `host.rs`).
  const credits = document.createElement('p');
  credits.className = 'muted';
  credits.textContent = 'Asteroids: NASA/JPL Small-Body Database. Jupiter\'s orbit: NASA/JPL Horizons. Stars: ESA/Gaia/DPAC.';
  page.append(heading, figure, caption, what, why, actions, cost, credits);
  document.head.append(style);
  document.body.append(page);
}
