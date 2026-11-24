/**
 * React, after the first frame (`docs/DECISIONS.md`, "Scope", 2026-11-23,
 * the page's framework): hydrates the prerendered frame, which `core.ts`
 * has kept working until now. Loaded by `main.ts`, never before the first
 * frame, so first paint waits on none of it.
 */

import { hydrateRoot } from 'react-dom/client';
import { Frame } from './view.tsx';

export function hydrate(root: HTMLElement): void {
  hydrateRoot(root, <Frame />);
}
