// The surface grays the page and the contenders share, held close (root
// docs/DECISIONS.md, "Comparison protocol": the site's theme): each of the
// site's tokens (site/ui/src/tokens.css, shadcn's format, oklch) against the
// same name in the contenders' generated theme.css (gpui-kit's default
// theme, hex), light and dark, within TOLERANCE in OKLab (ΔE × 100, about
// one just-noticeable step per unit). A token with alpha is composited over
// its side's background first (the site's dark border is white at 10%).
// The frames are the exhibits and may differ slightly; a gpui-kit bump that
// moves a gray further fails here, loudly. A built-in control: a gray moved
// by 0.03 in lightness must fail.
//
// Usage: node apps/observatory/web/scripts/grays.ts (`just observatory lint` runs it)

import { readFileSync } from 'node:fs';

const TOLERANCE = 2.5;
/** The surface grays both sides name: what the page draws around the
 *  frames and the frames draw inside. */
const SHARED = ['background', 'foreground', 'muted-foreground', 'border', 'ring'];
/** Named on both sides but apart by design, so reported, not held: shadcn
 *  raises a dark popover to the card's gray, gpui-kit draws it in the
 *  background's, and the contenders' popovers (the cells' tooltip) stay
 *  inside their frames. */
const APART = ['popover', 'popover-foreground'];

const site = readFileSync(new URL('../../../../site/ui/src/tokens.css', import.meta.url), 'utf8');
const contenders = readFileSync(new URL('../../contenders/tall-table/tanstack/web/src/theme.css', import.meta.url), 'utf8');

/** The `--name: value;` pairs of the first block opened by `selector`. */
function block(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no "${selector}" block`);
  const body = css.slice(start, css.indexOf('}', start));
  return new Map([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
}

type Lab = [number, number, number];
interface Color {
  lab: Lab;
  alpha: number;
}

function fromOklch(value: string): Color {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+)%)?\)$/.exec(value);
  if (!match) throw new Error(`not an oklch() color: ${value}`);
  const [l, c, h] = [Number(match[1]), Number(match[2]), (Number(match[3]) * Math.PI) / 180];
  return { lab: [l, c * Math.cos(h), c * Math.sin(h)], alpha: match[4] ? Number(match[4]) / 100 : 1 };
}

const linear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const gamma = (channel: number) => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055);

/** Linear sRGB → OKLab (Björn Ottosson's matrices). */
function oklab([r, g, b]: [number, number, number]): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab → linear sRGB. */
function rgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

function fromHex(value: string): Color {
  const match = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(value);
  if (!match) throw new Error(`not a #rrggbb[aa] color: ${value}`);
  const channels = [0, 2, 4].map((at) => linear(parseInt(match[1]!.slice(at, at + 2), 16) / 255)) as [number, number, number];
  return { lab: oklab(channels), alpha: match[2] ? parseInt(match[2], 16) / 255 : 1 };
}

/** `color` over `under`, blended in sRGB as the browser does. */
function over(color: Color, under: Color): Lab {
  if (color.alpha === 1) return color.lab;
  const top = rgb(color.lab).map(gamma);
  const bottom = rgb(under.lab).map(gamma);
  return oklab(top.map((channel, i) => linear(channel * color.alpha + bottom[i]! * (1 - color.alpha))) as [number, number, number]);
}

const deltaE = (x: Lab, y: Lab) => 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);

function compare(siteTokens: Map<string, string>, contenderTokens: Map<string, string>, names = SHARED): { name: string; deltaE: number }[] {
  const siteBackground = fromOklch(siteTokens.get('background')!);
  const contenderBackground = fromHex(contenderTokens.get('background')!);
  return names.map((name) => {
    const ours = siteTokens.get(name);
    const theirs = contenderTokens.get(name);
    if (!ours || !theirs) throw new Error(`--${name} is missing from ${ours ? 'theme.css' : 'tokens.css'}`);
    return { name, deltaE: deltaE(over(fromOklch(ours), siteBackground), over(fromHex(theirs), contenderBackground)) };
  });
}

const modes = [
  { mode: 'light', site: block(site, ':root'), contenders: block(contenders, ':root') },
  { mode: 'dark', site: block(site, '.dark'), contenders: block(contenders, ':root[data-theme="dark"]') },
];
const failures: string[] = [];
for (const { mode, site, contenders } of modes) {
  const rows = compare(site, contenders);
  const apart = compare(site, contenders, APART);
  console.log(`${mode}: ${rows.map(({ name, deltaE }) => `${name} ${deltaE.toFixed(2)}`).join(', ')} (apart by design: ${apart.map(({ name, deltaE }) => `${name} ${deltaE.toFixed(2)}`).join(', ')})`);
  for (const { name, deltaE } of rows) if (deltaE > TOLERANCE) failures.push(`${mode} --${name}: ΔE ${deltaE.toFixed(2)} over ${TOLERANCE}`);
}

// The control: the site's light muted foreground 0.03 lighter must fail.
const moved = new Map(modes[0]!.site);
moved.set('muted-foreground', moved.get('muted-foreground')!.replace(/^oklch\(([\d.]+)/, (_, l: string) => `oklch(${(Number(l) + 0.03).toFixed(3)}`));
const control = compare(moved, modes[0]!.contenders).find(({ name }) => name === 'muted-foreground')!;
if (control.deltaE <= TOLERANCE) failures.push(`the control passed: a gray moved by 0.03 is ΔE ${control.deltaE.toFixed(2)}, inside ${TOLERANCE}`);

if (failures.length) {
  console.error(`FAIL: the site's grays have moved from the contenders' theme.css\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log(`grays: within ΔE ${TOLERANCE} in both modes (control: ΔE ${control.deltaE.toFixed(2)} fails)`);
