// GH-1075 P3: the twelve unit busts. File facts only (dimensions from the WebP header, bytes, catalogue both ways):
// the pixels are Pillow/libwebp output, which may differ in bytes across machines, so re-run identity is proved
// locally by sha256 in the commit message and not asserted here.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { avatarPresets } from '../../../packages/data/src/avatar';

const DIR = join(__dirname, '..', '..', '..', 'assets', 'ui', 'avatars', 'units');

// The twelve of spec 3.3, written out.
const UNITS = [
  'inf_squad', 'sniper_team', 'yahalom_squad', 'inf_medic_squad', 'mbt_lavi', 'heli_peten',
  'sarim_rifles', 'militia_cell', 'atgm_cell', 'rpg_team', 'technical', 'rocket_battery',
];

/** Canvas size from the WebP container itself: VP8X, lossy VP8 or lossless VP8L. */
function webpSize(buf: Buffer): { w: number; h: number; riffOk: boolean } {
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
  expect(buf.toString('ascii', 8, 12)).toBe('WEBP');
  const riffOk = buf.readUInt32LE(4) === buf.length - 8;
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), riffOk };
  if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, riffOk };
  if (kind === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, riffOk };
  }
  throw new Error(`unknown WebP chunk ${kind}`);
}

describe('the unit busts', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.webp')).sort();

  it('are the twelve unit presets of the catalogue and nothing else, both ways', () => {
    expect(files.map((f) => f.slice(0, -5))).toEqual([...UNITS].sort());
    const units = avatarPresets.filter((p) => p.family === 'unit');
    expect(units.map((p) => (p.family === 'unit' ? p.unit : '')).sort()).toEqual([...UNITS].sort());
    for (const p of units) expect(files, p.id).toContain(`${p.family === 'unit' ? p.unit : ''}.webp`);
    expect(readdirSync(DIR).filter((f) => !f.endsWith('.webp'))).toEqual([]);
  });

  it.each(UNITS)('%s is 256 x 256, a whole RIFF, and at most 24 KiB', (unit) => {
    const path = join(DIR, `${unit}.webp`);
    const { w, h, riffOk } = webpSize(readFileSync(path));
    expect([w, h]).toEqual([256, 256]);
    expect(riffOk).toBe(true);
    expect(statSync(path).size).toBeLessThanOrEqual(24 * 1024);
  });

  it('the header reader can tell 255 from 256 (the check can fail)', () => {
    // A hand-built VP8X header for a 255 x 256 canvas.
    const b = Buffer.alloc(30);
    b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22, 4); b.write('WEBPVP8X', 8, 'ascii');
    b.writeUIntLE(254, 24, 3); b.writeUIntLE(255, 27, 3);
    expect(webpSize(b)).toMatchObject({ w: 255, h: 256 });
  });
});
