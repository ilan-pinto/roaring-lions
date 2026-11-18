// GH-1384 slice 1: the branched-tier validators (tools/validate_branches.mjs, B1-B7 and C1), the per-tier checks
// validate_data.mjs runs through it (every patched path exists, every tier monotone, both branches of a branched
// one), and validate_balance.py's mirror (`--max-tier` refuses a branched tier with no `--branch`). Every unit
// here is hand-built and inline, the ceiling a literal passed in, so no test reads the shipped roster or edits
// a shipped constant (design §5.2, "the validators").
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRANCH_CEILING, BRANCHED_TRACKS_MAX, tierPatches, upgradeTierFailures, validateBranches } from '../validate_branches.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const EN = { 'garage.branch.fx.a': 'A', 'garage.branch.fx.b': 'B', 'garage.branch.fx.c': 'C', 'garage.branch.fx.d': 'D' };
const T1 = { price: 455, patch: { 'weapons[0].accuracy': 0.03, 'weapons[0].penetration': 104 } };
const T2 = { price: 680, patch: { 'weapons[0].accuracy': 0.06, 'weapons[0].penetration': 208 } };
const A = { id: 'a', label: 'garage.branch.fx.a', patch: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 208 } };
const B = { id: 'b', label: 'garage.branch.fx.b', patch: { 'weapons[0].accuracy': 0.06, 'weapons[0].penetration': 325 } };
const branched = (branches: unknown[]) => ({ price: 950, branches });
const FIRE = (t3: unknown = branched([A, B])) => ({ tiers: [T1, T2, t3] });
const ARM1 = { price: 300, patch: { 'hull.hp': 100, 'hull.armor.front': 30 } };
const ARM2 = { price: 450, patch: { 'hull.hp': 200, 'hull.armor.front': 60 } };
const AA = { id: 'c', label: 'garage.branch.fx.c', patch: { 'hull.hp': 300, 'hull.armor.front': 60 } };
const AB = { id: 'd', label: 'garage.branch.fx.d', patch: { 'hull.hp': 200, 'hull.armor.front': 90 } };
const ARMOUR = (t3: unknown = { price: 640, branches: [AA, AB] }) => ({ tiers: [ARM1, ARM2, t3] });

const unit = (upgrades: Record<string, unknown>) => ({
  file: 'data/units/kdf/fx.json',
  doc: { id: 'fx', faction: 'kdf', hull: { hp: 2000, armor: { front: 600 } }, weapons: [{ accuracy: 0.85, penetration: 1300 }], upgrades },
});
/** The literal ceiling for the fixture: today's linear tier 3, written by hand. */
const CEILING = {
  fx: {
    firepower: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 325 },
    armour: { 'hull.hp': 300, 'hull.armor.front': 90 },
  },
};
const run = (upgrades: Record<string, unknown>, opts: { tracksMax?: number; ceiling?: object } = {}) =>
  validateBranches([unit(upgrades)], { en: EN, ceiling: { fx: { firepower: CEILING.fx.firepower } }, ...opts });

describe('validateBranches (B1-B7, C1)', () => {
  it('passes a well-formed branched tier', () => {
    expect(run({ firepower: FIRE() })).toEqual([]);
  });
  it('refuses three branches (the schema too), naming the unit and the track', () => {
    const out = run({ firepower: FIRE(branched([A, B, { ...B, id: 'z' }])) });
    expect(out.join('\n')).toMatch(/fx\).*upgrades\.firepower tier 3 has 3 branches/);
  });
  it('refuses a branch on tier 2 (B1)', () => {
    const out = run({ firepower: { tiers: [T1, branched([A, B]), T2] } });
    expect(out.join('\n')).toMatch(/upgrades\.firepower tier 2 is branched.*\(B1\)/);
  });
  it('refuses two branches with one id, and a label key en.json lacks (B2)', () => {
    expect(run({ firepower: FIRE(branched([A, { ...B, id: 'a' }])) }).join('\n')).toMatch(/both branches have id "a" \(B2\)/);
    expect(run({ firepower: FIRE(branched([A, { ...B, label: 'garage.branch.fx.nope' }])) }).join('\n')).toMatch(/"garage\.branch\.fx\.nope" is not in en\.json \(B2\)/);
  });
  it('refuses a branch patching another set of paths than the tier below (B3)', () => {
    const out = run({ firepower: FIRE(branched([A, { ...B, patch: { 'weapons[0].penetration': 325 } }])) });
    expect(out.join('\n')).toMatch(/branch "b" patches \[weapons\[0\]\.penetration\].*\(B3\)/);
  });
  it('refuses a dominating branch (B5), and one below tier 2 on a path (B4)', () => {
    const dominating = { ...A, patch: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 325 } };
    // `dominating` wins or ties everywhere against B; B itself raises a path and gives one up, so only A's own B5 line may fire.
    const out = run({ firepower: FIRE(branched([dominating, B])) }).join('\n');
    expect(out).toMatch(/branch "a" dominates or is dominated.*\(B5\)/);
    expect(out).not.toMatch(/branch "b" dominates/);
    const under = { ...B, patch: { 'weapons[0].accuracy': 0.05, 'weapons[0].penetration': 325 } };
    expect(run({ firepower: FIRE(branched([A, under])) }).join('\n')).toMatch(/smaller branch value 0\.05 is not the tier below's 0\.06 \(B4\)/);
  });
  it('refuses a branch one step above its ceiling, and a branched track with no ceiling row (B7)', () => {
    const over = { ...B, patch: { 'weapons[0].accuracy': 0.06, 'weapons[0].penetration': 326 } };
    expect(run({ firepower: FIRE(branched([A, over])) }).join('\n')).toMatch(/weapons\[0\]\.penetration: the envelope 326 is above the BRANCH_CEILING 325 \(B7\)/);
    expect(run({ firepower: FIRE() }, { ceiling: {} }).join('\n')).toMatch(/upgrades\.firepower is branched but has no BRANCH_CEILING row \(B7\)/);
    // and a row for a track that is not branched is a dead row
    expect(run({ firepower: FIRE() }, { ceiling: { ...CEILING } }).join('\n')).toMatch(/BRANCH_CEILING has a row for fx\.armour, which is not a branched track/);
  });
  it('per track (Q3), with the cap raised to 2: a valid first track and a dominating second is refused, naming the second', () => {
    const domArmour = { price: 640, branches: [{ ...AA, patch: { 'hull.hp': 300, 'hull.armor.front': 90 } }, { ...AB, patch: ARM2.patch }] };
    const out = run({ firepower: FIRE(), armour: ARMOUR(domArmour) }, { tracksMax: 2, ceiling: CEILING });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((l) => /upgrades\.armour/.test(l))).toBe(true);
    expect(run({ firepower: FIRE(), armour: ARMOUR() }, { tracksMax: 2, ceiling: CEILING })).toEqual([]);
  });
  it('C1, at the shipped cap of 1: the same valid two-track unit is refused, naming the cap', () => {
    expect(BRANCHED_TRACKS_MAX).toBe(1);
    expect(run({ firepower: FIRE(), armour: ARMOUR() }, { ceiling: CEILING }).join('\n')).toMatch(/branches 2 tracks \(armour, firepower\); BRANCHED_TRACKS_MAX is 1 \(C1\)/);
  });
});

describe('BRANCH_CEILING: the hand-written table (R13), pinned', () => {
  // A second, independent copy of the shipped tier-3 deltas before branching (origin/dev e1845a77e), so an edit to
  // the table is an edit to this test as well: a ceiling raised to let a branch in must be raised here in view.
  it('holds exactly the thirteen pre-branch tier-3 rows', () => {
    expect(BRANCH_CEILING).toEqual({
      mbt_lavi: { firepower: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 325 } },
      ifv_namer: { firepower: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 30 } },
      apc_eitan: { firepower: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 6 } },
      sniper_team: { firepower: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 11 } },
      heli_peten: { firepower: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 30 } },
      inf_squad: { firepower: { 'weapons[0].accuracy': 0.1, 'weapons[0].penetration': 2 } },
      jeep_shoded: { armour: { 'hull.hp': 130, 'hull.armor.front': 4, 'hull.armor.side': 2, 'hull.armor.rear': 2 } },
      dozer_d9: { armour: { 'hull.hp': 600, 'hull.armor.front': 60, 'hull.armor.side': 42, 'hull.armor.rear': 28 } },
      apc_kipod: { armour: { 'hull.hp': 438, 'hull.armor.front': 65, 'hull.armor.side': 40, 'hull.armor.rear': 25 } },
      at_team: { sensors: { 'sensors.optics': 0.28, 'sensors.sight_tiles': 3 } },
      scout_shachaf: { sensors: { 'sensors.optics': 0.47, 'sensors.sight_tiles': 3 } },
      mortar_team: { sensors: { 'sensors.optics': 0.23, 'sensors.sight_tiles': 3 } },
      recon_drone: { sensors: { 'sensors.optics': 0.5, 'sensors.sight_tiles': 3 } },
    });
  });
});

describe('the per-tier checks every track gets (validate_data.mjs, through upgradeTierFailures)', () => {
  const has = (_u: never, path: string): boolean =>
    path === 'hull.hp' || path === 'hull.armor.front' || /^weapons\[0\]\./.test(path);
  it('a branch that patches a path the unit does not have is refused', () => {
    const bad = { ...B, patch: { 'weapons[0].accuracy': 0.06, 'weapons[0].penetration': 325, 'sensors.optics': 0.1 } };
    const out = upgradeTierFailures('fx.json', unit({ firepower: FIRE(branched([A, bad])) }).doc, has);
    expect(out.join('\n')).toMatch(/tier 3 patches sensors\.optics, which this unit does not have/);
  });
  it('each branch is held monotone over the tier below', () => {
    const under = { ...B, patch: { 'weapons[0].accuracy': 0.05, 'weapons[0].penetration': 325 } };
    expect(upgradeTierFailures('fx.json', unit({ firepower: FIRE(branched([A, under])) }).doc, has).join('\n')).toMatch(/tier 3 is not monotone over tier 2 \(weapons\[0\]\.accuracy 0\.05 < 0\.06\)/);
    expect(upgradeTierFailures('fx.json', unit({ firepower: FIRE() }).doc, has)).toEqual([]);
  });
  it('a tier with neither patch nor branches, or both, is a failure, never read as {}', () => {
    expect(() => tierPatches({ price: 1 })).toThrow(/neither/);
    expect(() => tierPatches({ price: 1, patch: {}, branches: [] })).toThrow(/both/);
    expect(upgradeTierFailures('fx.json', unit({ firepower: FIRE({ price: 950 }) }).doc, has).join('\n')).toMatch(/tier 3: tier has neither "patch" nor "branches"/);
  });
});

describe('validate_balance.py --max-tier on a roster with a branched tier', () => {
  // A fixture roster: the shipped roster copied, then ONE unit (jeep_shoded, whose two branches print 1.4 and 1.3)
  // left branched and the other twelve flattened to a plain tier 3 = branch 1, so only that unit tells the two apart.
  const powerOf = (out: string, id: string): string | undefined => new RegExp(`^${id}\\s+(\\S+)`, 'm').exec(out)?.[1];
  it('refuses with no --branch, and --branch=1 and --branch=2 print different power figures for that unit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rl-branches-'));
    try {
      cpSync(join(ROOT, 'data/units'), join(dir, 'units'), { recursive: true });
      for (const id of ['mbt_lavi', 'ifv_namer', 'apc_eitan', 'sniper_team', 'heli_peten', 'inf_squad', 'dozer_d9', 'apc_kipod', 'at_team', 'scout_shachaf', 'mortar_team', 'recon_drone']) {
        const file = join(dir, 'units/kdf', `${id}.json`);
        const j = JSON.parse(readFileSync(file, 'utf8'));
        for (const track of Object.values(j.upgrades as Record<string, { tiers: { price: number; patch?: object; branches?: { patch: object }[] }[] }>)) {
          const last = track.tiers[track.tiers.length - 1];
          if (last.branches) track.tiers[track.tiers.length - 1] = { price: last.price, patch: last.branches[0].patch };
        }
        writeFileSync(file, JSON.stringify(j));
      }
      const py = (...extra: string[]) =>
        spawnSync('python3', ['tools/validate_balance.py', '--units', join(dir, 'units'), '--max-tier', '--upgrade-cost-factor', '0.02', '--report', ...extra], { cwd: ROOT, encoding: 'utf8' });
      const none = py();
      expect(none.status).not.toBe(0);
      expect(none.stdout).toMatch(/max-tier pass refused: .*jeep_shoded armour tier 3 is branched/);
      const one = py('--branch=1');
      const two = py('--branch=2');
      expect(one.status).toBe(0);
      expect(two.status).toBe(0);
      expect(powerOf(one.stdout, 'jeep_shoded')).toBeDefined();
      expect(powerOf(one.stdout, 'jeep_shoded')).not.toBe(powerOf(two.stdout, 'jeep_shoded'));
      // and every OTHER unit prints the same figure on both lines, so the difference is that one unit's branch
      expect(powerOf(one.stdout, 'mbt_lavi')).toBe(powerOf(two.stdout, 'mbt_lavi'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
