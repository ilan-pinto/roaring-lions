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
  /side(\[[^\]]+\])?\s*[!=]==\s*[01]\b/,
  /\.side\s*[!=]==\s*[01]\b/,
  /teamColors\[\s*[01]\s*\]/,
];
/** Lines that are allowed: a comment, or a civilian (side 2) check. */
const allowed = (line: string): boolean => /^\s*(\/\/|\*|\/\*)/.test(line) || /===\s*2\b|!==\s*2\b/.test(line);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });
}

describe('no side literal in packages/render', () => {
  it('finds none outside comments and civilian checks', () => {
    const hits: string[] = [];
    for (const f of files(ROOT)) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (!allowed(line) && PATTERNS.some((p) => p.test(line))) hits.push(`${f.slice(ROOT.length)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
