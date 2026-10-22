/**
 * Content negotiation for a Worker that serves precompressed build files
 * (Cloudflare compresses on the fly at a low level, so each app's deploy
 * writes quality-11 copies and its Worker picks one). Runs in a Worker: no
 * Node or DOM.
 */

/**
 * Whether the browser takes `coding` (`br`, `gzip`). Cloudflare documents
 * `cf.clientAcceptEncoding` as what the browser sent (the header a Worker
 * sees may differ); the header is the fallback, as in `wrangler dev`.
 */
export function accepts(request: Request, coding: string): boolean {
  const cf = (request as { cf?: { clientAcceptEncoding?: string } }).cf;
  const header = cf?.clientAcceptEncoding ?? request.headers.get('Accept-Encoding') ?? '';
  return header.split(',').some((part) => {
    const [name, ...params] = part.trim().split(';');
    if (name?.trim().toLowerCase() !== coding) return false;
    const q = params.map((param) => /^\s*q=([\d.]+)\s*$/.exec(param)?.[1]).find((value) => value !== undefined);
    return q === undefined || Number(q) > 0;
  });
}
