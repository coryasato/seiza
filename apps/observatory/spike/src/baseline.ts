// React and ReactDOM alone, rendering one element: the size baseline the
// spike's page (TanStack Virtual, the scroll model, the rows) is set against.

import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(h('div', null, 'rows'));
