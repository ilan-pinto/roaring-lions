// Who may ride inside a transport, pinned against every shipped unit JSON.
//
// `canEmbark` defaults to `FOOT_ROLES.has(role)` (sim.ts), the same set that
// once decided `wheeled` -- and it is wrong the same two ways boulders.test.ts
// records for `wheeled`. `artillery` is in the set, so the Grad (`rocket_battery`,
// a launcher on a 6x6 truck) could board a Namer, or a Yanshuf since GH-698 made
// that reachable by air; `aa` is not, so a MANPAD team (two men and a launcher,
// GH-247) could board nothing. Both now say so in JSON (`hull.can_embark`), which
// is data, not engine.
//
// The rule swept here: a GROUND unit rides iff it is on foot, i.e. `canEmbark ===
// !wheeled`, with `wheeled` itself the authored-or-defaulted answer boulders.test.ts
// pins. Air units are swept separately (they are never `wheeled`-meaningful), and
// the one flyer the default lets ride is an open question for the lead rather
// than a fix: see AIR_RIDERS_OPEN.
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { unitTypeFromJson, type UnitTypeJson } from '../../packages/sim/src/sim';

const all = Object.values(units).map((u) => ({ id: u.id, t: unitTypeFromJson(u as UnitTypeJson) }));

/** Air units the role default lets board a transport, left as shipped for the
 *  lead: the powered parachute is a man under a wing (role `support`), which the
 *  default seats; whether a flyer may climb into a Namer is a design call. */
const AIR_RIDERS_OPEN: Record<string, string> = {
  paramotor: 'role support is in FOOT_ROLES; a flyer boarding a transport is the lead\'s call',
};

describe('canEmbark: the Grad rides nothing, the mortar team rides (same role)', () => {
  it('rocket_battery, role artillery, wheeled: cannot embark', () => {
    expect(units.rocket_battery.role).toBe('artillery');
    const grad = unitTypeFromJson(units.rocket_battery as UnitTypeJson);
    expect(grad.wheeled).toBe(true);
    expect(grad.canEmbark).toBe(false);
  });
  it('mortar_team, role artillery, on foot: embarks', () => {
    expect(units.mortar_team.role).toBe('artillery');
    const mortar = unitTypeFromJson(units.mortar_team as UnitTypeJson);
    expect(mortar.wheeled).toBe(false);
    expect(mortar.canEmbark).toBe(true);
  });
  it('manpad_team, role aa, on foot: embarks (GH-247); gun_truck, the same role, does not', () => {
    expect(unitTypeFromJson(units.manpad_team as UnitTypeJson).canEmbark).toBe(true);
    expect(unitTypeFromJson(units.gun_truck as UnitTypeJson).canEmbark).toBe(false);
  });
});

describe('canEmbark sweep over every shipped unit', () => {
  it('finds units at all (a sweep over nothing passes everything)', () => {
    expect(all.filter((u) => !u.t.isAir).length).toBeGreaterThan(20);
    expect(all.filter((u) => u.t.isAir).length).toBeGreaterThan(3);
  });
  it('every ground unit rides iff it is on foot', () => {
    const wrong = all
      .filter((u) => !u.t.isAir && u.t.canEmbark === u.t.wheeled)
      .map((u) => `${u.id}: wheeled ${u.t.wheeled}, canEmbark ${u.t.canEmbark}`);
    expect(wrong).toEqual([]);
  });
  it('no air unit rides, bar the named open question; and that exemption is still needed', () => {
    const riders = all.filter((u) => u.t.isAir && u.t.canEmbark).map((u) => u.id).sort();
    expect(riders).toEqual(Object.keys(AIR_RIDERS_OPEN).sort());
  });
});
