// Every track and tier the roster declares resolves to an emblem, and a
// missing one fails (GH-238 item 3).
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emblemNames, emblemSvg } from './kit-emblems';

const ROOT = join(__dirname, '../../../..');
const KDF = join(ROOT, 'data/units/kdf');

interface Unit { id: string; upgrades?: Record<string, { tiers: unknown[] }> }
const units: Unit[] = readdirSync(KDF)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(KDF, f), 'utf8')) as Unit);

describe('kit emblems', () => {
  it('the roster is swept, not empty', () => {
    const tracks = units.flatMap((u) => Object.keys(u.upgrades ?? {}));
    expect(tracks.length).toBeGreaterThanOrEqual(54);
  });

  it('every shipped track has a head and every tier has an emblem', () => {
    const missing: string[] = [];
    for (const u of units) {
      for (const [track, def] of Object.entries(u.upgrades ?? {})) {
        if (emblemSvg(track) === null) missing.push(`${u.id}:${track}`);
        for (let tier = 1; tier <= def.tiers.length; tier++) {
          if (emblemSvg(track, tier) === null) missing.push(`${u.id}:${track}:${tier}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('ships exactly twelve, each paint-free (currentColor only, no hex)', () => {
    const names = emblemNames();
    expect(names).toHaveLength(12);
    for (const n of names) {
      const svg = emblemSvg(n.replace(/-t\d$/, ''), /-t(\d)$/.test(n) ? Number(n.slice(-1)) : undefined);
      expect(svg, n).not.toBeNull();
      expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
      expect(svg).toContain('viewBox="0 0 24 24"');
    }
  });

  it('tiers of one track are distinct drawings', () => {
    for (const track of ['armour', 'sensors', 'firepower']) {
      expect(new Set([1, 2, 3].map((t) => emblemSvg(track, t))).size).toBe(3);
    }
  });

  it('a track no file covers is null, so the hatch draws alone', () => {
    expect(emblemSvg('fire_control')).toBeNull();
    expect(emblemSvg('armour', 4)).toBeNull();
  });
});
