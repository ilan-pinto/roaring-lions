// `pnpm closeups:garage` (GH-238 plan 3 Task 9, K11): what it owes, its
// refusal, and that the shipped set is exactly that.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RIGGED_UNIT_MESHES } from '../../packages/app/src/mesh-catalogue';
import { CLOSEUP_H, CLOSEUP_W, assertCloseupCount, closeupPlan } from './perf/garage-closeups-plan';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(REPO, 'assets/ui/garage/closeups');
const plan = closeupPlan(path.join(REPO, 'data/units/kdf'));

/** A JPEG's pixel size, from its first SOFn marker. */
function jpegSize(buf: Buffer): [number, number] {
  let i = 2;
  while (i + 9 < buf.length) {
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('no SOF marker');
}

describe('garage close-ups', () => {
  it('owes one per KDF vehicle or aircraft type and track: 47 since GH-1077', () => {
    // 59 on the 25 Oct roster, less the 23 infantry-team close-ups (8 teams;
    // WP-SC0, GH-746): they showed the 8 Oct orange claws. A literal, so a
    // roster change that ships without its close-ups fails here by name.
    expect(plan).toHaveLength(47);
    expect(new Set(plan.map((j) => j.id)).size).toBe(18);
    expect(plan.filter((j) => j.id === 'dozer_d9').map((j) => j.track)).toEqual(['armour', 'sensors']);
  });

  it('refuses a run that wrote a different count', () => {
    expect(() => assertCloseupCount(25, plan)).toThrow(/25 written, but data\/units\/kdf\/ declares 47 vehicle and aircraft/);
    expect(() => assertCloseupCount(48, plan)).toThrow();
    expect(() => assertCloseupCount(47, plan)).not.toThrow();
  });

  it('ships exactly the plan: in the manifest, on disk, 480x320', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as {
      closeups: Record<string, { file: string; unit: string; track: string }>;
    };
    expect(Object.keys(manifest.closeups).sort()).toEqual(plan.map((j) => j.key).sort());
    const jpegs = fs.readdirSync(DIR).filter((f) => f.endsWith('.jpg'));
    expect(jpegs.sort()).toEqual(plan.map((j) => `${j.key}.jpg`).sort());
    for (const j of plan) {
      const e = manifest.closeups[j.key];
      expect([e.unit, e.track], j.key).toEqual([j.id, j.track]);
      expect(jpegSize(fs.readFileSync(path.join(DIR, e.file))), j.key).toEqual([CLOSEUP_W, CLOSEUP_H]);
    }
  });

  // WP-SC0 (GH-746): the store shows the plain frame for a team until its card
  // is approved, so no infantry team may have a close-up, in the manifest or on
  // disk, and nothing a vehicle or aircraft owns may have gone missing.
  it('has no infantry-team close-up, and every vehicle or aircraft one is on disk', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as {
      closeups: Record<string, { file: string; unit: string; track: string }>;
    };
    const teams = Object.keys(RIGGED_UNIT_MESHES);
    expect(teams).toContain('inf_squad'); // the set is not vacuously empty
    const entries = Object.entries(manifest.closeups);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, e] of entries) {
      expect(teams, `${key}: an infantry team has a close-up entry`).not.toContain(e.unit);
      expect(fs.existsSync(path.join(DIR, e.file)), `${key}: ${e.file} is not on disk`).toBe(true);
    }
    for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.jpg'))) {
      const unit = f.replace(/_(armour|sensors|firepower)\.jpg$/, '');
      expect(teams, `${f}: an infantry team's close-up is on disk`).not.toContain(unit);
    }
    // Every KDF team that declares an upgrade track is covered by the above.
    const kdf = path.join(REPO, 'data/units/kdf');
    const teamsWithTracks = fs
      .readdirSync(kdf)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(kdf, f), 'utf8')) as { id: string; upgrades?: object })
      .filter((u) => u.id in RIGGED_UNIT_MESHES && Object.keys(u.upgrades ?? {}).length > 0);
    expect(teamsWithTracks.length).toBe(12);
  });
});
