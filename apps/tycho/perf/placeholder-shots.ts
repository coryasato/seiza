// The static placeholder shell against GPUI's first frame: screenshots of
// both (the same page, the app's wasm held back for one and the engine chunk
// for the other) and their comparison. Used by `placeholder.ts`.

import { type Browser, type Page } from '@playwright/test';
import { hideDevicePixelContentBox } from './common.ts';

export type Scheme = 'light' | 'dark';
export const SCHEMES: Scheme[] = ['light', 'dark'];

/**
 * GPUI and the browser can't draw the same text identically (different
 * rasterizers, and GPUI measures text its own way), so the comparison is by
 * region:
 *
 * - **Text and icons**: found in both images inside the placeholder's box for
 *   them (padded), as the pixels far from the local background. The bounding
 *   boxes must agree within INK_DX device px across (long runs drift ~1 px
 *   apart in advance rounding) and inkDy up or down; the ink's mass (summed
 *   contrast with the background, so weight and color both move it) within
 *   ×/÷ inkMass.
 * - **Boxes**: a skeleton standing in for a component (a button). Its edges
 *   must match the component's border box within boxEdge; what's inside
 *   isn't compared.
 * - **Surfaces** (everything else: fills, borders, the title bar's gradient,
 *   corners): each pixel as the mean of a BLOCK×BLOCK square, differing
 *   above SURFACE_COLOR in any channel from the other image's at the same
 *   place or one device px around it (GPUI and the browser round half-pixel
 *   edges in opposite directions); at most SURFACE_SHARE of them may differ.
 *
 * The limits were set from negative controls (`placeholder.ts --controls`):
 * each catches a 1 px move or size change, a wrong fill, border, or muted
 * color, or a fallback font, and none fires on the real placeholder.
 */
export const INK_DX = 3;
/** Up or down, device px: GPUI's rasterizer draws text up to ~2 px lower at
 *  DPR 1 (1 device px at DPR 2), whatever the layout. */
export const inkDy = (scale: number) => (scale < 1.5 ? 2 : 1);
/** Ink mass, ×/÷: at DPR 1 GPUI's rasterizer draws small and muted text up
 *  to ~18% lighter than the browser does. */
export const inkMass = (scale: number) => (scale < 1.5 ? 1.25 : 1.15);
/** Each edge, device px: exact at DPR 1; at DPR 2 GPUI's unrounded text
 *  widths differ a little (it measures glyphs at the device scale), and some
 *  window sizes round one device px apart. */
export const boxEdge = (scale: number) => (scale < 1.5 ? 0 : 1);
export const BLOCK = 3;
export const SURFACE_COLOR = 4;
export const SURFACE_SHARE = 0.0004;
/** Regions are searched this far (CSS px) around the placeholder's boxes. */
const PAD = 6;

/** A region of the placeholder to compare, CSS px. */
export interface Region {
  name: string;
  kind: 'text' | 'icon' | 'box';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Shots {
  placeholder: Buffer;
  firstFrame: Buffer;
  /** Text the placeholder shows, for the font check. */
  placeholderText: string;
  regions: Region[];
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/** Both screenshots for one color scheme, from two cold pages. `alter` is CSS
 *  added to the placeholder, for negative controls. */
export async function shoot(
  browser: Browser,
  url: string,
  scheme: Scheme,
  alter = '',
  { width = 1440, height = 900, dpr = 2 } = {},
): Promise<Shots> {
  const open = async () => {
    // Reduced motion: the skeletons hold still (no pulse) and the placeholder
    // leaves without its fade, so screenshots are repeatable.
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, colorScheme: scheme, reducedMotion: 'reduce' });
    if (dpr !== 1) await context.addInitScript(hideDevicePixelContentBox);
    return context;
  };

  // The placeholder: the app's wasm never arrives.
  const held = await open();
  await held.route(/tycho_bg-[\w-]+\.wasm$/, () => {});
  const before = await held.newPage();
  await before.goto(url);
  if (alter) await before.addStyleTag({ content: alter });
  await before.waitForFunction(() => performance.getEntriesByName('seiza:placeholder-painted', 'mark').length > 0, null, { timeout: 30_000 });
  await twoFrames(before);
  const placeholder = await before.screenshot();
  const { placeholderText, regions } = await before.evaluate(() => {
    const root = document.getElementById('seiza-placeholder')!;
    const regions: { name: string; kind: 'text' | 'icon' | 'box'; x: number; y: number; width: number; height: number }[] = [];
    const add = (name: string, kind: 'text' | 'icon' | 'box', rect: DOMRect) => {
      if (rect.width > 0) regions.push({ name, kind, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (!text) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      add(text, 'text', range.getBoundingClientRect());
    }
    for (const svg of root.querySelectorAll('svg')) add(`icon ${svg.parentElement?.className.match(/sz-theme-\w+/)?.[0] ?? ''}`, 'icon', svg.getBoundingClientRect());
    root.querySelectorAll('.sz-skeleton').forEach((skeleton, index) => add(`skeleton ${index + 1}`, 'box', skeleton.getBoundingClientRect()));
    return { placeholderText: root.innerText, regions };
  });
  await held.close();

  // The first frame: the engine chunk never arrives, so the shell stays as
  // it first drew ("Engine loading…"). Taken once the placeholder is gone.
  const live = await open();
  await live.route(/\/assets\/engine-[\w-]+\.js$/, () => {});
  const after = await live.newPage();
  await after.goto(url);
  await after.waitForFunction(() => performance.getEntriesByName('gpui:first-frame', 'mark').length > 0 && !document.getElementById('seiza-placeholder'), null, { timeout: 60_000 });
  await twoFrames(after);
  const firstFrame = await after.screenshot();
  await live.close();
  return { placeholder, firstFrame, placeholderText, regions };
}

export interface RegionResult {
  name: string;
  kind: Region['kind'];
  /** What was found in each image, device px, [left, top, right, bottom]. */
  firstFrame: number[] | null;
  placeholder: number[] | null;
  /** The largest left/right and top/bottom edge differences, device px. */
  dx: number;
  dy: number;
  /** The placeholder's ink mass over the first frame's. */
  mass: number;
}

export interface Comparison {
  regions: RegionResult[];
  surface: { share: number; differing: number; compared: number; box: { x: number; y: number; width: number; height: number } | null };
  /** Differing surface pixels in red, regions in blue, over a faded copy of
   *  the first frame. */
  image: Buffer;
  failures: string[];
}

/** Compares the placeholder's screenshot with the first frame's in a browser
 *  canvas (no image library). `scale` is the screenshots' DPR. */
export async function compare(browser: Browser, shots: Shots, scale = 2): Promise<Comparison> {
  const page = await browser.newPage();
  try {
    const result = await page.evaluate(
      async ({ a, b, regions, scale, pad, block, surfaceColor }) => {
        const load = async (base64: string) => createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const [imageA, imageB] = await Promise.all([load(a), load(b)]);
        const { width, height } = imageA;
        const read = (image: ImageBitmap) => {
          const canvas = new OffscreenCanvas(width, height);
          const context = canvas.getContext('2d')!;
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, width, height).data;
        };
        const pa = read(imageA);
        const pb = read(imageB);
        const at = (p: Uint8ClampedArray, x: number, y: number) => [p[(y * width + x) * 4]!, p[(y * width + x) * 4 + 1]!, p[(y * width + x) * 4 + 2]!];
        const far = (c: number[], bg: number[]) => Math.max(...c.map((v, k) => Math.abs(v - bg[k]!)));

        // Regions: the background is the most common color on the region's
        // edge; what differs from it by more than the threshold is found.
        const ignored = new Uint8Array(width * height);
        const regionResults = regions.map((region) => {
          const x0 = Math.max(0, Math.floor((region.x - pad) * scale));
          const y0 = Math.max(0, Math.floor((region.y - pad / 2) * scale));
          const x1 = Math.min(width, Math.ceil((region.x + region.width + pad) * scale));
          const y1 = Math.min(height, Math.ceil((region.y + region.height + pad / 2) * scale));
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ignored[y * width + x] = 1;
          // Text and icons are far from their background; a skeleton is
          // only a few levels off it (#f5f5f5 on white).
          const threshold = region.kind === 'box' ? 6 : 60;
          const find = (p: Uint8ClampedArray) => {
            const counts = new Map<string, number>();
            for (let x = x0; x < x1; x++)
              for (const y of [y0, y1 - 1]) {
                const key = at(p, x, y).join();
                counts.set(key, (counts.get(key) ?? 0) + 1);
              }
            const bg = [...counts.entries()].sort((m, n) => n[1] - m[1])[0]![0].split(',').map(Number);
            let [l, t, r, btm] = [Infinity, Infinity, -1, -1];
            let mass = 0;
            for (let y = y0; y < y1; y++)
              for (let x = x0; x < x1; x++) {
                const contrast = far(at(p, x, y), bg);
                if (contrast <= threshold) continue;
                l = Math.min(l, x);
                t = Math.min(t, y);
                r = Math.max(r, x);
                btm = Math.max(btm, y);
                mass += contrast;
              }
            return mass ? { box: [l, t, r, btm], mass } : null;
          };
          const first = find(pb);
          const held = find(pa);
          return {
            name: region.name,
            kind: region.kind,
            firstFrame: first?.box ?? null,
            placeholder: held?.box ?? null,
            dx: first && held ? Math.max(Math.abs(first.box[0]! - held.box[0]!), Math.abs(first.box[2]! - held.box[2]!)) : Infinity,
            dy: first && held ? Math.max(Math.abs(first.box[1]! - held.box[1]!), Math.abs(first.box[3]! - held.box[3]!)) : Infinity,
            mass: first && held ? held.mass / first.mass : 0,
          };
        });

        // Surfaces: block means (summed-area tables), outside the regions.
        const sat = (p: Uint8ClampedArray) =>
          [0, 1, 2].map((c) => {
            const t = new Float64Array((width + 1) * (height + 1));
            for (let y = 0; y < height; y++) {
              let row = 0;
              for (let x = 0; x < width; x++) {
                row += p[(y * width + x) * 4 + c]!;
                t[(y + 1) * (width + 1) + x + 1] = t[y * (width + 1) + x + 1]! + row;
              }
            }
            return t;
          });
        const [sa, sb] = [sat(pa), sat(pb)];
        const w = width + 1;
        const mean = (t: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
          (t[y1 * w + x1]! - t[y0 * w + x1]! - t[y1 * w + x0]! + t[y0 * w + x0]!) / ((y1 - y0) * (x1 - x0));
        const r = block >> 1;
        const out = new OffscreenCanvas(width, height);
        const context = out.getContext('2d')!;
        const image = context.createImageData(width, height);
        let differing = 0;
        let compared = 0;
        let [minX, minY, maxX, maxY] = [width, height, -1, -1];
        for (let y = 0; y < height; y++) {
          const y0 = Math.max(0, y - r);
          const y1 = Math.min(height, y + r + 1);
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            image.data[i] = image.data[i + 1] = image.data[i + 2] = 128 + (pb[i]! + pb[i + 1]! + pb[i + 2]!) / 6;
            image.data[i + 3] = 255;
            if (ignored[y * width + x]) {
              image.data[i + 2] = 255;
              continue;
            }
            const x0 = Math.max(0, x - r);
            const x1 = Math.min(width, x + r + 1);
            // The placeholder's block against the first frame's at this
            // pixel or one device px around it.
            let delta = Infinity;
            for (let oy = -1; oy <= 1 && delta > surfaceColor; oy++)
              for (let ox = -1; ox <= 1 && delta > surfaceColor; ox++) {
                const [bx0, bx1, by0, by1] = [Math.max(0, x0 + ox), Math.min(width, x1 + ox), Math.max(0, y0 + oy), Math.min(height, y1 + oy)];
                if (bx1 <= bx0 || by1 <= by0) continue;
                let d = 0;
                for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(mean(sa[c]!, x0, y0, x1, y1) - mean(sb[c]!, bx0, by0, bx1, by1)));
                delta = Math.min(delta, d);
              }
            compared++;
            if (delta > surfaceColor) {
              differing++;
              image.data[i] = 255;
              image.data[i + 1] = image.data[i + 2] = 0;
              [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
            }
          }
        }
        context.putImageData(image, 0, 0);
        const bytes = new Uint8Array(await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return {
          regions: regionResults,
          surface: {
            differing,
            compared,
            share: differing / compared,
            box: maxX < 0 ? null : { x: minX / scale, y: minY / scale, width: (maxX - minX + 1) / scale, height: (maxY - minY + 1) / scale },
          },
          image: btoa(binary),
        };
      },
      { a: shots.placeholder.toString('base64'), b: shots.firstFrame.toString('base64'), regions: shots.regions, scale, pad: PAD, block: BLOCK, surfaceColor: SURFACE_COLOR },
    );
    const failures = [
      ...result.regions.flatMap((region) => {
        const name = `"${region.name}"`;
        if (!region.firstFrame || !region.placeholder) return [`${name}: not found in ${region.firstFrame ? 'the placeholder' : 'the first frame'}`];
        if (region.kind === 'box') {
          const edge = Math.max(region.dx, region.dy);
          return edge > boxEdge(scale) ? [`${name} edges are ${edge} device px from the first frame's (limit ${boxEdge(scale)})`] : [];
        }
        return [
          ...(region.dx > INK_DX ? [`${name} is ${region.dx} device px across from the first frame's (limit ${INK_DX})`] : []),
          ...(region.dy > inkDy(scale) ? [`${name} is ${region.dy} device px up or down from the first frame's (limit ${inkDy(scale)})`] : []),
          ...(Math.abs(Math.log(region.mass)) > Math.log(inkMass(scale))
            ? [`${name} ink mass is ${region.mass.toFixed(2)}× the first frame's (limit ×/÷ ${inkMass(scale)})`]
            : []),
        ];
      }),
      ...(result.surface.share > SURFACE_SHARE
        ? [`${(result.surface.share * 100).toFixed(3)}% of surface pixels differ (limit ${SURFACE_SHARE * 100}%), within ${JSON.stringify(result.surface.box)}`]
        : []),
    ];
    return { ...result, image: Buffer.from(result.image, 'base64'), failures };
  } finally {
    await page.close();
  }
}
