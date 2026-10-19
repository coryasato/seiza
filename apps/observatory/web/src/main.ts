/**
 * The page's entry: hydrates the route's prerendered HTML (the shell's
 * behaviors bind in its effects), as the route it was rendered for. The
 * contender's frame and the metrics module start after the first paint
 * (`slot.ts`).
 */

import { createElement as h } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { OBSERVATORY } from '../../contenders/paths.ts';
import { Page, ROUTE_ATTRIBUTE } from './page.ts';
import './page.css';

const root = document.getElementById('root')!;
const path = root.querySelector(`[${ROUTE_ATTRIBUTE}]`)?.getAttribute(ROUTE_ATTRIBUTE) ?? OBSERVATORY;
hydrateRoot(root, h(Page, { path }));
