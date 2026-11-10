const sharp = (await import(new URL('../../../../node_modules/sharp/dist/index.mjs', import.meta.url).pathname)).default;
const [dir, ...ids] = process.argv.slice(2);
const tiles = []; let y = 0;
for (const id of ids) for (const side of ['gpui', 'dom']) {
  const img = sharp(`${dir}/${id}-${side}.png`).extract({ left: 0, top: 0, width: 330, height: 60 }).resize(990, 180, { kernel: 'nearest' });
  tiles.push({ input: await img.png().toBuffer(), left: 0, top: y }); y += 185;
}
await sharp({ create: { width: 990, height: y, channels: 3, background: '#888' } }).composite(tiles).png().toFile(`${dir}/zoom.png`);
