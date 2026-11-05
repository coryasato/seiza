// Writes the bare host's `dist/build.json`: the features it was built with
// (which the scripts read, `harness.ts`'s `builtFeatures`) and the tree it
// was built from (`drawnFrom`), so the smoke check's reference screens are
// filed under the tree that drew them (`builtFrom`).
//
// Usage: node components/tall-table/perf/build-info.ts [features]

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { drawnFrom, hostWebDir } from './harness.ts';

writeFileSync(join(hostWebDir, 'dist/build.json'), `${JSON.stringify({ features: process.argv[2] ?? '', tree: drawnFrom() })}\n`);
