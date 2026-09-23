import { mergeConfig, type Rolldown, type UserConfig } from 'vite';

/**
 * Cross-origin isolation headers. Every app sends them in dev, preview, and
 * production, so COEP problems show up on day one instead of at deploy.
 */
export const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} as const;

type OnWarn = NonNullable<Rolldown.InputOptions['onwarn']>;

/** wasm-bindgen's generated glue binds `js_sys::eval` with a direct eval.
 *  It's generated code; keep the warning everywhere else. */
function ignoreWasmBindgenEval(next?: OnWarn): OnWarn {
  return (warning, warn) => {
    if (warning.code === 'EVAL' && warning.id?.includes('/pkg/')) return;
    if (next) next(warning, warn);
    else warn(warning);
  };
}

/**
 * The Vite config every app's host starts from. `overrides` are deep-merged
 * with Vite's `mergeConfig`. The COOP/COEP headers and the wasm-bindgen
 * warning filter always survive: an app can add headers or its own `onwarn`,
 * but can't drop either.
 */
export function seizaViteConfig(overrides: UserConfig = {}): UserConfig {
  const base: UserConfig = {
    server: { headers: crossOriginIsolationHeaders },
    preview: { headers: crossOriginIsolationHeaders },
    build: {
      target: 'esnext',
      // Report real sizes; `just <app> build` prints raw/gzip/brotli itself.
      reportCompressedSize: false,
    },
  };
  const merged = mergeConfig(base, overrides);
  return mergeConfig(merged, {
    server: { headers: crossOriginIsolationHeaders },
    preview: { headers: crossOriginIsolationHeaders },
    build: { rolldownOptions: { onwarn: ignoreWasmBindgenEval(overrides.build?.rolldownOptions?.onwarn) } },
  });
}
