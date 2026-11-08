// GH-1077 (Store/Garage WP1): the staged upgrade tracks for the nine bought-only KDF units that
// shipped with none, in docs/campaign/special_units/gh1077/tracks.json.
//
// The tracks are the balance analyst's fit (docs/campaign/economy/upgrades.md section 3, the
// "GH-1077" entries). They are staged, not landed: no `upgrades` block reaches data/units/kdf
// until WP8, which moves this file's blocks into the nine unit JSONs and deletes both this test
// and tracks.json in the same commit (T12, `bought_unit_tracks.test.ts`, replaces it). Until then
// this spec holds the staged file honest:
//   - the file names exactly the nine, and each block validates against unit.schema.json's own
//     `upgrades` subschema;
//   - every tier price is the spec section 2.2 price rule, computed here from LITERAL multipliers
//     (logistics x m, to the nearest 5, halves to even), never read back from the staged file;
//   - the shape the fit must hold (spec 2.2): armour and sensors on all nine, firepower on three,
//     the camo Lavi's deltas equal to the Lavi's, the medevac's front +0, the robot's armour hp only,
//     foot faces at most +2, and no soft unit turning hard at its top tier;
//   - the "half-landed" pin: no unit of the nine already carries `upgrades` in data/units.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { applyUpgrades, maxTiers, units, type UpgradableUnit } from '@lions/data';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGED = join(ROOT, 'docs', 'campaign', 'special_units', 'gh1077', 'tracks.json');

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => {
  compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
})({ allErrors: true, strict: false });
const unitSchema = JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'unit.schema.json'), 'utf8')) as {
  properties: { upgrades: object };
};
const validateUpgrades = ajv.compile(unitSchema.properties.upgrades);

interface Tier {
  price: number;
  patch: Record<string, number>;
}
type Block = Record<string, { tiers: Tier[] }>;
const staged = JSON.parse(readFileSync(STAGED, 'utf8')) as Record<string, Block>;

/** The nine bought-only units with no tracks on origin/main (spec 2.1). */
const NINE = [
  'air_medevac_heli',
  'at_nlos_team',
  'inf_grenadier',
  'inf_medic_squad',
  'mbt_lavi_camo',
  'spg_cluster',
  'spg_long_range',
  'ugv_recon_dog',
  'veh_ambulance',
] as const;
const WITH_FIREPOWER = ['at_nlos_team', 'inf_grenadier', 'mbt_lavi_camo'];
const FOOT = ['at_nlos_team', 'inf_grenadier', 'inf_medic_squad'];

/** Spec 2.2's multipliers, per tier, as literals. */
const MULT: Record<string, readonly [number, number, number]> = {
  armour: [0.4, 0.6, 0.85],
  sensors: [0.33, 0.5, 0.7],
  firepower: [0.5, 0.75, 1.05],
};

/** logistics x m to the nearest 5, halves to even, in integer arithmetic (m in hundredths). */
function rulePrice(logistics: number, m: number): number {
  const num = logistics * Math.round(m * 100); // price x 100
  const q = Math.floor(num / 500);
  const r = num - q * 500;
  const up = r > 250 || (r === 250 && q % 2 === 1);
  return (up ? q + 1 : q) * 5;
}

type UnitJson = UpgradableUnit & {
  cost: { logistics: number };
  hull: { armor: { front: number } };
  upgrades?: Block;
};
const unitOf = (id: string): UnitJson => (units as unknown as Record<string, UnitJson>)[id];

describe('GH-1077 staged tracks: the nine bought-only units', () => {
  it('names exactly the nine', () => {
    expect(Object.keys(staged).sort()).toEqual([...NINE]);
  });

  it('the rule itself: halves go to even, and it matches two shipped earned prices', () => {
    expect(rulePrice(265, 0.5)).toBe(130); // 132.5 -> 26.5 fives -> 26
    expect(rulePrice(400, 0.33)).toBe(130); // 132
    expect(rulePrice(906, 0.4)).toBe(360); // mbt_lavi armour tier 1 as shipped
    expect(rulePrice(292, 0.75)).toBe(220); // inf_squad firepower tier 2 as shipped
  });

  it('the Te\'o Howitzer costs 1,350 credits to max (spec T9)', () => {
    const total = Object.values(staged.spg_long_range).flatMap((t) => t.tiers).reduce((s, t) => s + t.price, 0);
    expect(total).toBe(1350);
  });

  it('the nine cost 16,050 credits to max between them', () => {
    const total = Object.values(staged).flatMap((b) => Object.values(b)).flatMap((t) => t.tiers)
      .reduce((s, t) => s + t.price, 0);
    expect(total).toBe(16050);
  });

  for (const id of NINE) {
    describe(id, () => {
      const block = staged[id];
      const unit = unitOf(id);

      it('validates against unit.schema.json\'s upgrades subschema', () => {
        const ok = validateUpgrades(block);
        expect(validateUpgrades.errors ?? null, JSON.stringify(validateUpgrades.errors)).toBeNull();
        expect(ok).toBe(true);
      });

      it('every tier price is the price rule from literal multipliers', () => {
        for (const [track, { tiers }] of Object.entries(block)) {
          const m = MULT[track];
          expect(m, `unknown track ${track}`).toBeDefined();
          expect(tiers.map((t) => t.price)).toEqual(m.map((x) => rulePrice(unit.cost.logistics, x)));
        }
      });

      it('has the fitted shape', () => {
        const tracks = Object.keys(block).sort();
        expect(tracks).toEqual(WITH_FIREPOWER.includes(id) ? ['armour', 'firepower', 'sensors'] : ['armour', 'sensors']);
        for (const { tiers } of Object.values(block)) expect(tiers.length).toBe(3);
        const armour = block.armour.tiers;
        if (id === 'air_medevac_heli') for (const t of armour) expect(t.patch['hull.armor.front']).toBe(0);
        if (id === 'ugv_recon_dog') for (const t of armour) expect(Object.keys(t.patch)).toEqual(['hull.hp']);
        if (FOOT.includes(id)) {
          for (const t of armour) {
            for (const face of ['front', 'side', 'rear']) expect(t.patch[`hull.armor.${face}`]).toBeLessThanOrEqual(2);
          }
        }
        if (id === 'mbt_lavi_camo') {
          const lavi = unitOf('mbt_lavi').upgrades;
          expect(lavi).toBeDefined();
          for (const [track, { tiers }] of Object.entries(block)) {
            expect(tiers.map((t) => t.patch)).toEqual(lavi?.[track]?.tiers.map((t) => t.patch));
          }
        }
      });

      it('applies to the shipped unit, and a soft hull stays soft at the top tier', () => {
        const withTracks = { ...unit, upgrades: block } as UnitJson;
        const top = applyUpgrades(withTracks, maxTiers(withTracks)) as UnitJson;
        const soft = unit.hull.armor.front < 30; // tuning.ts SOFT_ARMOR_LIMIT, 30 mm
        expect(top.hull.armor.front < 30).toBe(soft);
      });

      it('is still staged: the shipped unit carries no upgrades yet (WP8 moves them in one commit)', () => {
        expect(unit.upgrades).toBeUndefined();
      });
    });
  }
});
