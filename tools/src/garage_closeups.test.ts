// `pnpm closeups:garage` (GH-238 plan 3 Task 9, K11): what it owes, its
// refusal, and that the shipped set is exactly that.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
  it('owes one per KDF type and track: 54 on the 7 Oct roster', () => {
    // The plan's 49 counted seventeen types; heli_peten_gunship (3 tracks)
    // and recon_zikit (2) have landed since. A literal, so a roster change
    // that ships without its close-ups fails here by name.
    expect(plan).toHaveLength(54);
    expect(new Set(plan.map((j) => j.id)).size).toBe(19);
    expect(plan.filter((j) => j.id === 'dozer_d9').map((j) => j.track)).toEqual(['armour', 'sensors']);
  });

  it('refuses a run that wrote a different count', () => {
    expect(() => assertCloseupCount(48, plan)).toThrow(/48 written, but data\/units\/kdf\/ declares 54/);
    expect(() => assertCloseupCount(55, plan)).toThrow();
    expect(() => assertCloseupCount(54, plan)).not.toThrow();
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
});
