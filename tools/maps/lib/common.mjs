// The shared core of the large-map generators (GH-920 B1): everything tools/maps/rujm_sawda/build.mjs
// drew itself and every later large map (tools/maps/wadi_tarfan_l/build.mjs) needs the same way.
//
//   - `hash`        the scatter's only source of "randomness": a function of the tile and a salt;
//   - `halfTurnOf`  the point-reflection of a square map of side `size`, for tiles and rectangles;
//   - `halfTurn`    stage 4: write the bottom half of the grids as the half-turn of the top;
//   - `serialise`   the JSON layout of every map file (arrays of numbers stay on one line);
//   - `runCli`      `--check` (write nothing, exit 1 if a shipped file differs) or write.
//
// The library draws nothing a map is made of. rujm_sawda/build.mjs holds the witness: its `--check`
// stays at exit 0 only while every helper here does what it did when it lived in that file, and
// tools/src/map_lib_mutations.test.ts breaks each helper by one line and watches that go red.
import { readFileSync, writeFileSync } from 'node:fs';

/** A small integer hash: the scatter is a function of the tile, never of a random stream. */
export const hash = (x, y, salt) => {
  let h = (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663) ^ Math.imul(salt + 1, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

/**
 * The half-turn (x, y) -> (size - 1 - x, size - 1 - y) of a square map, as a tile function and as a
 * rectangle function. A rectangle [x, y, w, h] covers tiles x..x+w-1, so its image starts at size - x - w.
 */
export function halfTurnOf(size) {
  return {
    mirror: ([x, y]) => [size - 1 - x, size - 1 - y],
    mirrorRect: ([x, y, w, h]) => [size - x - w, size - y - h, w, h],
  };
}

/** Stage 4. Rows 0..size/2-1 of `t` and `el` are drawn; the rest are their half-turn images. */
export function halfTurn(t, el, size) {
  for (let y = size / 2; y < size; y++) {
    for (let x = 0; x < size; x++) {
      t[y][x] = t[size - 1 - y][size - 1 - x];
      el[y][x] = el[size - 1 - y][size - 1 - x];
    }
  }
}

// --- output: arrays of numbers stay on one line, as in every other map file ---------------------
function dump(v, indent = '') {
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'number')) return `[${v.join(', ')}]`;
    if (v.length === 0) return '[]';
    const inner = indent + '  ';
    return `[\n${v.map((x) => inner + dump(x, inner)).join(',\n')}\n${indent}]`;
  }
  if (v && typeof v === 'object') {
    const inner = indent + '  ';
    const ents = Object.entries(v);
    if (ents.length === 0) return '{}';
    return `{\n${ents.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${dump(x, inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(v);
}
export const serialise = (doc) => dump(doc) + '\n';

/** Entries of `o` sorted by key: marker and zone tables are written in name order. */
export const sortedByKey = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

/**
 * The CLI every generator shares. `outputs` is [[path, text], ...]. With `--check` nothing is written
 * and the exit code is 1 if any shipped file differs (a missing file counts as different).
 */
export function runCli(argv, outputs, generator) {
  if (argv.includes('--check')) {
    let bad = 0;
    for (const [p, text] of outputs) {
      let have = '';
      try {
        have = readFileSync(p, 'utf8');
      } catch {
        /* missing counts as different */
      }
      if (have !== text) {
        console.error(`${p} differs from what ${generator} writes`);
        bad++;
      }
    }
    process.exit(bad ? 1 : 0);
  }
  for (const [p, text] of outputs) writeFileSync(p, text);
  console.log(outputs.map(([p]) => `wrote ${p}`).join('\n'));
}
