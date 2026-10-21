// Serving an app under test: its release build through `vite preview`, and
// its data requests through a proxy that counts them at the server.

import { createServer, request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { preview } from 'vite';

/**
 * Fails with a clear message if something already listens on `port`, such as
 * a running dev server. Without this, a second server would exit with
 * EADDRINUSE while a readiness probe happily talked to the first one.
 */
export function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `port ${port} is in use (another \`just <app> dev\` or \`preview\`?); stop it first`
            : `can't check port ${port}: ${error.message}`,
        ),
      ),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
}

/**
 * One data response, counted at the server: a proxy between Vite's preview
 * proxy and the data server. Playwright doesn't report requests made by sync
 * XHRs in a worker (DuckDB-Wasm's), so the page can't be the source.
 */
export interface DataResponse {
  /** Wall-clock ms when the request arrived, and when its body ended (null
   *  while it's still streaming). `bytes` counts up as the body arrives. */
  startedAt: number;
  endedAt: number | null;
  method: string;
  path: string;
  range: string | null;
  status: number;
  bytes: number;
}

export interface CountingProxy {
  log: DataResponse[];
  close(): void;
}

export async function startCountingProxy(listenPort: number, upstreamPort: number): Promise<CountingProxy> {
  await assertPortFree(listenPort);
  const log: DataResponse[] = [];
  const server = createServer((req, res) => {
    const entry: DataResponse = { startedAt: Date.now(), endedAt: null, method: req.method ?? '', path: req.url ?? '', range: req.headers.range ?? null, status: 0, bytes: 0 };
    log.push(entry);
    const upstream = httpRequest({ host: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers: req.headers }, (response) => {
      entry.status = response.statusCode ?? 0;
      response.on('data', (chunk: Buffer) => (entry.bytes += chunk.length));
      response.on('end', () => (entry.endedAt = Date.now()));
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    });
    upstream.on('error', (error) => res.destroy(error));
    req.pipe(upstream);
  });
  return new Promise((resolve, reject) => {
    server.once('error', (error) => reject(new Error(`counting proxy can't listen on ${listenPort}: ${error.message}`)));
    server.listen(listenPort, '127.0.0.1', () => resolve({ log, close: () => server.close() }));
  });
}

/**
 * A proxy in front of `upstreamPort` that shapes every response as a
 * network profile would: `latency` ms before each response starts, and
 * every body through one shared `download` (bytes/s), as Chromium's
 * emulation does. For what Chromium's own throttling doesn't reach: a
 * same-process frame's worker escapes the page's `emulateNetworkConditions`
 * and can't take its own (`Not supported`), so a page whose frame has a
 * worker is throttled here instead, with its comparisons the same way.
 */
export async function startThrottlingProxy(listenPort: number, upstreamPort: number, network: { latency: number; download: number }): Promise<{ url: string; close(): void }> {
  await assertPortFree(listenPort);
  const SLICE = 16 * 1024;
  // When the shared link is next free, ms.
  let free = 0;
  const after = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const server = createServer((req, res) => {
    const arrived = Date.now();
    const upstream = httpRequest({ host: 'localhost', port: upstreamPort, path: req.url, method: req.method, headers: req.headers }, async (response) => {
      response.pause();
      await after(Math.max(0, arrived + network.latency - Date.now()));
      res.writeHead(response.statusCode ?? 502, response.headers);
      // One slice at a time, each when the shared link has room for it.
      let sending = Promise.resolve();
      response.on('data', (chunk: Buffer) => {
        response.pause();
        sending = sending.then(async () => {
          for (let at = 0; at < chunk.length; at += SLICE) {
            const slice = chunk.subarray(at, at + SLICE);
            const now = Date.now();
            free = Math.max(free, now) + (slice.length / network.download) * 1000;
            await after(free - now);
            res.write(slice);
          }
          response.resume();
        });
      });
      response.on('end', () => void sending.then(() => res.end()));
      response.resume();
    });
    upstream.on('error', (error) => res.destroy(error));
    req.pipe(upstream);
  });
  return new Promise((resolve, reject) => {
    server.once('error', (error) => reject(new Error(`throttling proxy can't listen on ${listenPort}: ${error.message}`)));
    server.listen(listenPort, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${listenPort}/`, close: () => server.close() }));
  });
}

/** Waits (up to `timeout`) for these requests' bodies to finish. */
export async function settled(requests: DataResponse[], timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (requests.some((request) => request.endedAt === null) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export interface AppServer {
  url: string;
  /** Data responses counted at the server; null against a given URL. */
  proxy: CountingProxy | null;
  close(): Promise<void>;
}

/** A data server for `serveApp` to start behind its counting proxy. */
export interface DataServer {
  /** Where the app's Vite config proxies data requests: the counting
   *  proxy listens here. */
  proxyPort: number;
  /** Where `start` serves the data: the proxy forwards here. */
  port: number;
  start(): Promise<{ close(): Promise<void> }>;
}

/**
 * The app under test. With `given` (a script's `--url`: production)
 * nothing starts, and nothing counts data bytes. Otherwise the release build
 * (`webDir`'s dist) through `vite preview` on `port`, and, with `data`, its
 * data server behind a counting proxy.
 */
export async function serveApp(given: string | undefined, options: { webDir: string; port: number; data?: DataServer }): Promise<AppServer> {
  if (given) return { url: given, proxy: null, close: async () => {} };
  const { webDir, port, data } = options;
  // Before starting anything: a dev server already there would otherwise
  // fail the proxy and leave this script's data server running.
  await assertPortFree(port);
  if (data) await assertPortFree(data.proxyPort);
  const dev = data ? await data.start() : null;
  let proxy: CountingProxy | null = null;
  try {
    if (data) proxy = await startCountingProxy(data.proxyPort, data.port);
    const server = await preview({ root: webDir, preview: { port, strictPort: true }, logLevel: 'warn' });
    return {
      url: `http://localhost:${port}/`,
      proxy,
      close: async () => {
        await server.close();
        proxy?.close();
        await dev?.close();
      },
    };
  } catch (error) {
    proxy?.close();
    await dev?.close();
    throw error;
  }
}
