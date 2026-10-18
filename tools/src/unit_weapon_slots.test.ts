// The sim reads weapon slots 0 and 1 and nothing else (`slot < 2` in sim.ts's fire,
// structure-fire and breach loops). A third entry in `weapons` is therefore a weapon that
// is on the data sheet, in the cost curve, on the garage card -- and never fires.
// `heli_peten_gunship` shipped exactly that way: [chain_gun_30, rocket_pods, hellfire],
// the Hellfire in slot 2, 0 rounds fired and 0 of 24 Lavi kills in the probe.
//
// Every check below was seen red against that file before the fix (see the commit).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { Sim, fx, TICKS_PER_SECOND } from '@lions/sim';
import { units } from '@lions/data';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'unit.schema.json'), 'utf8')) as object;
const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => {
  addSchema: (s: object) => unknown;
  compile: (s: object) => (d: unknown) => boolean;
})({ allErrors: true, strict: false });
// unit.schema.json refers to the shared unlock def by relative $ref (common.schema.json).
ajv.addSchema(JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'common.schema.json'), 'utf8')) as object);
const validateUnit = ajv.compile(SCHEMA);

interface UnitJson {
  id: string;
  weapons?: { id: string }[];
  upgrades?: Record<string, { tiers: { patch: Record<string, number> }[] }>;
}
const all = Object.values(units) as unknown as UnitJson[];

describe('weapon slots: the sim fires two', () => {
  it('no unit lists more than two weapons', () => {
    const over = all.filter((u) => (u.weapons?.length ?? 0) > 2).map((u) => `${u.id}:${u.weapons?.length}`);
    expect(over).toEqual([]);
  });

  it('the unit schema refuses a third weapon', () => {
    const lavi = JSON.parse(JSON.stringify(units.mbt_lavi)) as UnitJson;
    expect(validateUnit(lavi)).toBe(true); // the control: a real unit is valid
    const w = lavi.weapons ?? [];
    lavi.weapons = [...w, { ...w[0] }, { ...w[0] }];
    expect(lavi.weapons.length).toBeGreaterThan(2);
    expect(validateUnit(lavi)).toBe(false);
  });
});

describe('heli_peten_gunship fires its Hellfire', () => {
  const gunship = units.heli_peten_gunship as unknown as UnitJson;

  it('carries the Hellfire in slot 0 or 1', () => {
    const slot = (gunship.weapons ?? []).findIndex((w) => w.id === 'hellfire');
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(2);
  });

  it('its firepower track patches the Hellfire, wherever it sits', () => {
    // The track used to patch `weapons[1]` = the rocket pods. Dropping the pods slid the Hellfire
    // into slot 1, so the same string would have retargeted the track by accident; this pins the
    // retarget as deliberate (anti-armour: the missile's accuracy is what the credits buy).
    const hellfire = (gunship.weapons ?? []).findIndex((w) => w.id === 'hellfire');
    expect(hellfire).toBeGreaterThanOrEqual(0);
    const keys = new Set<string>();
    for (const tier of gunship.upgrades?.firepower?.tiers ?? []) {
      for (const k of Object.keys(tier.patch)) keys.add(k);
    }
    expect([...keys].sort()).toEqual([`weapons[${hellfire}].accuracy`, `weapons[${hellfire}].penetration`]);
  });

  it('shoots Hellfires at a Lavi from 9.5 tiles, outside every other weapon it has', () => {
    let hellfires = 0;
    let kills = 0;
    for (let s = 0; s < 6; s++) {
      const sim = new Sim({ seed: 7000 + s, width: 30, height: 16, capacity: 8 });
      const h = sim.addUnitType(gunship as never);
      const t = sim.addUnitType({ ...units.mbt_lavi, weapons: [] } as never);
      const lavi = sim.spawn(t, 1, fx.from(13), fx.from(8.5), 16384);
      sim.spawn(h, 0, fx.from(3.5), fx.from(8.5), 0);
      for (let k = 0; k < 120 * TICKS_PER_SECOND; k++) {
        sim.identifyTo(0, lavi);
        for (const e of sim.tick()) if (e.kind === 'fire' && e.weaponId === 'hellfire') hellfires++;
        if (!sim.state.alive[lavi]) {
          kills++;
          break;
        }
      }
    }
    expect(hellfires).toBeGreaterThan(0);
    expect(kills).toBeGreaterThan(0);
  });
});
