#!/usr/bin/env node
// Writes assets/ui/avatars/crests/<id>.svg for the twelve crests (GH-1075 P2).
//
//   node tools/avatars/build_crests.mjs
//
// Deterministic: no clock, no randomness; a re-run is byte-identical. Refuses a charge with a stroke or gap
// under 18 units (see crest_geometry.mjs). crest-lion is read from art/src/insignia/roaring_lion.svg, never redrawn.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, buildAll } from './crest_geometry.mjs';

const out = join(ROOT, 'assets', 'ui', 'avatars', 'crests');
mkdirSync(out, { recursive: true });
for (const { id, svg } of buildAll()) {
  writeFileSync(join(out, `${id}.svg`), svg);
  console.log(`${id}.svg  ${Buffer.byteLength(svg)} bytes`);
}
