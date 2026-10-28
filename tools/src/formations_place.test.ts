// GH-859 P1a Task 2 (plan Ruling 14): "every shipped formation places N units on open ground with
// no tile used twice, for N = 2..24 and every class mix in a fixed table". It is RUN here, not
// imagined: the plain-node validators (tools/validate_formations.mjs) cannot import the sim's
// generator, so this is a vitest test. The roster tables below are literals.
import { describe, expect, it } from 'vitest';
import { formations } from '@lions/data';
import { assignTemplate, compileFormation, type FormationJson, type TemplateUnit } from '@lions/sim';

const W = 48;
const H = 48;
const CLICK = 24;
/** The click sits near the far edge so 24 rows fit behind it: a column of 24 vehicles is 36 deep. */
const CLICK_Y = 10;
const ARMOUR = 0;
const LIGHT = 1;
const RECON = 2;
const INFANTRY = 3;
const SUPPORT = 4;
const MEDIC = 5;
const AIRCRAFT = 6;

/** Five mixes, each a fixed roster 24 long; N takes the first N. */
const ROSTERS: Record<string, number[]> = {
  'all infantry': Array<number>(24).fill(INFANTRY),
  'all armour': Array<number>(24).fill(ARMOUR),
  // 3 armour, 2 light, 1 recon, 12 infantry, 2 support, 2 medic, 2 aircraft, interleaved so a short order is already a mix
  'KDF company': [
    ARMOUR, INFANTRY, INFANTRY, LIGHT, SUPPORT, MEDIC, AIRCRAFT, ARMOUR, INFANTRY, INFANTRY, RECON, INFANTRY,
    INFANTRY, LIGHT, MEDIC, SUPPORT, INFANTRY, ARMOUR, INFANTRY, INFANTRY, INFANTRY, AIRCRAFT, INFANTRY, INFANTRY,
  ],
  // aircraft and infantry only, one for one
  'air-heavy': [AIRCRAFT, INFANTRY, AIRCRAFT, INFANTRY, AIRCRAFT, INFANTRY, AIRCRAFT, INFANTRY, AIRCRAFT, INFANTRY, AIRCRAFT, INFANTRY,
    AIRCRAFT, INFANTRY, AIRCRAFT, INFANTRY, AIRCRAFT, INFANTRY, AIRCRAFT, INFANTRY, AIRCRAFT, INFANTRY, AIRCRAFT, INFANTRY],
  // the enemy's: light, infantry and support only (4 light, 16 infantry, 4 support)
  'enemy': [
    INFANTRY, LIGHT, INFANTRY, INFANTRY, SUPPORT, INFANTRY, INFANTRY, LIGHT, INFANTRY, INFANTRY, INFANTRY, SUPPORT,
    INFANTRY, LIGHT, INFANTRY, INFANTRY, SUPPORT, INFANTRY, INFANTRY, LIGHT, INFANTRY, INFANTRY, INFANTRY, SUPPORT,
  ],
};

function asUnit(id: number, cls: number): TemplateUnit {
  const vehicle = cls === ARMOUR || cls === LIGHT || cls === RECON;
  return { id, domain: vehicle ? 1 : 0, cls, vehicle, air: cls === AIRCRAFT };
}

describe('every shipped formation places N = 2..24 on open ground', () => {
  const open = new Uint8Array(W * H);
  const tallies = { checked: 0, overflowed: 0 };
  for (const json of formations) {
    const tpl = compileFormation(json as unknown as FormationJson);
    for (const [mixName, roster] of Object.entries(ROSTERS)) {
      it(`${tpl.id} / ${mixName}`, () => {
        for (let n = 2; n <= 24; n++) {
          const units = roster.slice(0, n).map((cls, i) => asUnit(i + 1, cls));
          const { slots, overflow } = assignTemplate(
            {
              width: W, height: H, masks: [open, open], origins: [[CLICK, CLICK_Y], [CLICK, CLICK_Y]], clickX: CLICK, clickY: CLICK_Y,
              fromX: CLICK, fromY: 40, units, reserved: new Uint8Array(W * H), cover: new Uint8Array(W * H),
            },
            tpl
          );
          const where = `${tpl.id} / ${mixName} / N=${n}`;
          // every member gets a slot, and no tile is used twice
          expect(slots, where).toHaveLength(n);
          expect(new Set(slots.map((s) => `${s.x},${s.y}`)).size, where).toBe(n);
          // No overflow: every member is on a template slot. A column of armour is 3 rows a hull, so the
          // walk's cap of 24 holds 17 of them (rows 0..8 in file 0, 0..7 in file 1); hull 18 onward is the
          // SPILL (S3), which runs on behind the column in the same pattern rather than packing at the click.
          expect(overflow, where).toHaveLength(0);
          // every slot is inside the walk, except a files element's spill, which only a column of hulls reaches
          const spilled = slots.filter((s) => Math.abs(s.x - CLICK) + Math.abs(s.y - CLICK_Y) > tpl.extent);
          const hullsInColumn = tpl.id === 'column' && mixName === 'all armour';
          expect(spilled.map((s) => s.id), where).toEqual(hullsInColumn ? Array.from({ length: Math.max(0, n - 17) }, (_, k) => 18 + k) : []);
          // where the spill lands: strictly behind (larger y; forward is -y) every slot inside the walk, in
          // the column's own two files (x = 24 and 26), 3 rows from the hull before it in its file
          for (const sp of spilled) {
            expect(sp.x === CLICK || sp.x === CLICK + 2, `${where} id ${sp.id} file`).toBe(true);
            for (const s of slots) if (!spilled.includes(s)) expect(sp.y, `${where} id ${sp.id} behind id ${s.id}`).toBeGreaterThan(s.y);
          }
          if (hullsInColumn && n === 24) {
            expect(spilled.map((s) => [s.x, s.y])).toEqual([[26, 35], [24, 37], [26, 38], [24, 40], [26, 41], [24, 43], [26, 44]]);
          }
          // vehicle spacing, in the file formations (the spill included): two ground vehicles in one
          // lateral are never closer than VEHICLE_RANK_DEPTH (3) apart, and none sits one lateral from
          // another. (The ring is exempt: a full ring of hulls is adjacent by design, which the P2
          // fallback addresses once measured.)
          if (tpl.id !== 'ambush') {
            const veh = slots.filter((s) => units[s.id - 1].vehicle && !units[s.id - 1].air);
            for (const a of veh) {
              for (const b of veh) {
                if (a.id >= b.id) continue;
                const lat = Math.abs(a.x - b.x); // lateral is x for the south approach
                const fwd = Math.abs(a.y - b.y);
                expect(lat === 1, `${where}: ${a.id}/${b.id} one lateral apart`).toBe(false);
                if (lat === 0) expect(fwd, `${where}: ${a.id}/${b.id} same lateral`).toBeGreaterThanOrEqual(3);
              }
            }
          }
          tallies.checked++;
        }
      });
    }
  }
  it('checked every (formation, mix, N): 3 x 5 x 23 = 345 placements, so an empty roster cannot pass', () => {
    // vitest runs the `it`s above first, in order, in this file
    expect(formations).toHaveLength(3);
    expect(Object.keys(ROSTERS)).toHaveLength(5);
    for (const roster of Object.values(ROSTERS)) expect(roster).toHaveLength(24);
    expect(tallies.checked).toBe(345);
  });
});
