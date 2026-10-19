/** The site's footer: what seiza is, and where its source is. */

import { createElement as h } from 'react';

export const SOURCE = 'https://github.com/coryasato/seiza';

export function Footer() {
  return h(
    'footer',
    { className: 'border-t' },
    h(
      'div',
      { className: 'mx-auto flex max-w-screen-2xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6' },
      h('p', null, 'seiza: heavy web apps drawn by the GPU from WebAssembly, measured against the DOM.'),
      h('a', { href: SOURCE, className: 'hover:text-foreground' }, 'Source on GitHub'),
    ),
  );
}
