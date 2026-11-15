// Where each of the three files is in the bucket: under the first 16 hex
// digits of its SHA-256, the manifest's. The key changes when the file does,
// so a deploy puts a new file beside the old one, and the Worker that's live
// goes on reading its own until the new Worker, built with the new manifest,
// replaces it: the page, its manifest, and the files it's sent change
// together (docs/DECISIONS.md, "Hosting"). The Worker and every script that
// fills a bucket read the key from here.
import manifest from '../../data/MANIFEST.json' with { type: 'json' };

/** The bucket's key for the file `name` as it is; its brotli 11 copy is `<key>.br`. */
export function keyOf(name: string): string | undefined {
  const entry = (manifest as Record<string, { sha256?: string } | undefined>)[name];
  return entry?.sha256 ? `${entry.sha256.slice(0, 16)}/${name}` : undefined;
}
