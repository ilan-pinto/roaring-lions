// Keeps "side 0 is the player" out of the renderer (network design §5.1).
// Reads the SOURCE: the point is that no new literal can be written, which no
// behavioural test of today's sites can promise.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PATTERNS: RegExp[] = [
  /\b(contactLevel|tunnelContactLevel|sideSeesTile|markerSeesTile)\(\s*0\s*,/,
  // `side === 0`, `.side !== 1`, `st.side[i] === 0` -- but not `inside === 0`.
  /\bside(\[[^\]]+\])?\s*[!=]==\s*[01]\b/,
  // A call result: `sideOf(x) === 0`, `look.side(id) !== 0`, `this.sideOf(i) === 1`.
  /\bside[A-Za-z]*\((?:[^()]|\([^()]*\))*\)\s*[!=]==\s*[01]\b/,
  /teamColors\[\s*[01]\s*\]/,
];
/** Whether a source line holds a side literal. A comment line is prose. A
 *  civilian (side 2) comparison needs no exemption: no pattern matches a 2, so
 *  `side !== 2` passes on its own, and `side === 0 || side === 2` is still a
 *  hit. (A whole-line exemption for any `=== 2` hid the second; stripping the
 *  `=== 2` before matching was tried and is a no-op that no mutation can see.) */
function sideLiteralIn(line: string): boolean {
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return false;
  return PATTERNS.some((p) => p.test(line));
}

/** The guard's own falsification, kept: lines the matcher must catch and lines
 *  it must pass. A pattern that stops matching turns this red before any file
 *  is scanned. Identical in packages/app/src/side-literals.test.ts. */
const MUST_HIT = [
  'if (sim.state.side[i] === 0) n++;',
  'if (e.kind === \'removed\' && e.side !== 1) return;',
  'if (side === 0 || side === 2) keep(i);',
  'if (st.side[i] === 2 || st.side[i] === 1) continue;',
  'if (world.sideOf(e.entity) === 0) lost(e.entity);',
  'if (c === null || look.side(c.entity) !== 0) continue;',
  'if (this.sideOf(i) === 1) n++;',
  'if (sideOf(at(i)) === 0) n++;',
  'const lit = sim.contactLevel(0, i);',
  'const c = teamColors[1];',
];
const MUST_NOT_HIT = [
  '// side === 0 is the player',
  ' * the old `side === 0` path',
  'if (st.side[i] !== 2) continue;',
  'if (inside === 0) return;',
  'if (inside(x) === 0) return;',
  'if (isOwnSide(st.side[i], viewer)) n++;',
  'const lit = sim.contactLevel(viewer, i);',
  'const c = teamColors[colorSlot(side, viewer)];',
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

describe('no side literal in packages/render', () => {
  it('the matcher catches every must-hit line and passes every must-not-hit one', () => {
    expect(MUST_HIT.filter((l) => !sideLiteralIn(l))).toEqual([]);
    expect(MUST_NOT_HIT.filter((l) => sideLiteralIn(l))).toEqual([]);
  });
  it('finds none outside comments', () => {
    const hits: string[] = [];
    for (const f of files(ROOT)) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (sideLiteralIn(line)) hits.push(`${f.slice(ROOT.length)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
