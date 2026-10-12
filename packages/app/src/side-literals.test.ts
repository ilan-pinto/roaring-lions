// Keeps "side 0 is the player" out of the app's selection, orders, hover and
// HUD (network design §5.1): in a versus room seat 1 commands sim side 1, so
// every such site asks relationOf / isOwnSide / isHostileSide / colorSlot with
// the viewer threaded in. Reads the SOURCE: the point is that no new literal
// can be written, which no behavioural test of today's sites can promise.
// The body is packages/render/src/side-literals.test.ts's, with ROOT, the
// scanned roots and PENDING_TASK_6 changed.
//
// Scanned: main.ts, input/, ui/, voice/. Outside those roots, and not scanned
// (single-player by construction -- no room ever reaches them):
//   tutorial/       -- the tutorial is one mission, never a room.
//   telemetry/      -- reports the single-player session's own force.
//   mission-log.ts  -- the campaign mission log; a room plays no mission.
//   hold-outside.ts -- a mission objective's hold check; a room has none.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SCANNED = ['main.ts', 'input', 'ui', 'voice'];
/** Files N1a Task 6 converts (the HUD, minimap, alerts and voice director);
 *  Task 6 empties this list. Nothing else may ever be added to it. */
const PENDING_TASK_6 = [
  'ui/hud.ts',
  'ui/hud-model.ts',
  'ui/minimap.ts',
  'ui/alerts.ts',
  'ui/alert-world.ts',
  'ui/sandbox-feed.ts',
  'ui/withdrew.ts',
  'ui/intel-moments.ts',
  'ui/stall-hint.ts',
  'voice/director.ts',
];
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

describe('no side literal in the app\'s selection, orders, hover and HUD', () => {
  it('finds none outside comments and civilian checks', () => {
    const hits: string[] = [];
    const scanned = SCANNED.flatMap((s) => {
      const p = join(ROOT, s);
      return statSync(p).isDirectory() ? files(p) : [p];
    }).filter((f) => !PENDING_TASK_6.includes(f.slice(ROOT.length)));
    for (const f of scanned) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (!allowed(line) && PATTERNS.some((p) => p.test(line))) hits.push(`${f.slice(ROOT.length)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
