/** The frame as HTML, at build time and in dev (`shared-web`'s
 *  `prerender`): the page before any JS. */

import { renderToString } from 'react-dom/server';
import { Frame } from './view.tsx';

export const render = (): string => renderToString(<Frame />);
