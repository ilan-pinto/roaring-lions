// The shipped storyboard (docs/cinematics/shots.json): every shot is valid,
// every still is on disk, every still is a 16:9 frame, and the whole plan
// fits the cap. A shot added past the cap turns this red before anyone can
// spend on it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBudget, HARD_CAP_USD } from './budget';
import { promptFor } from './request';
import { estimateShot, loadStoryboard } from './shots';

const ROOT = join(__dirname, '..', '..', '..');
const board = loadStoryboard(join(ROOT, 'docs/cinematics/shots.json'));

/** Width and height of a baseline or progressive JPEG, from its SOF marker. */
function jpegSize(buf: Buffer): { w: number; h: number } {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error('no SOF marker');
}

describe('docs/cinematics/shots.json', () => {
  it('plans the approved scope: a three-shot intro, seven towns, two Tel Marum replacements', () => {
    const groups = board.shots.map((s) => s.group);
    expect(groups.filter((g) => g === 'intro')).toHaveLength(3);
    expect(groups.filter((g) => g === 'regen')).toHaveLength(2);
    expect(new Set(groups.filter((g) => g !== 'intro' && g !== 'regen'))).toEqual(
      new Set(['beit_sahwan', 'khan_rafid', 'deir_amun', 'tel_marum', 'qarn_hadid', 'umm_zeitoun', 'wadi_halam'])
    );
  });

  it('has every still on disk, 1280x720', () => {
    for (const s of board.shots) {
      const file = join(ROOT, s.still);
      expect(existsSync(file), s.still).toBe(true);
      expect(jpegSize(readFileSync(file)), s.still).toEqual({ w: 1280, h: 720 });
    }
  });

  it('fits the hard cap with room for retakes', () => {
    const total = board.shots.reduce((sum, s) => sum + estimateShot(s, promptFor(s).length).totalUsd, 0);
    expect(checkBudget(0, total).allowed).toBe(true);
    // The report's $45-115 band for the recommended set (its section 5).
    expect(total).toBeGreaterThanOrEqual(45);
    expect(total).toBeLessThanOrEqual(115);
    expect(HARD_CAP_USD - total).toBeGreaterThan(30);
  });
});
