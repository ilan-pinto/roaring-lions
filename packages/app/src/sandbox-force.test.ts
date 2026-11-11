// The sandbox task force as a ROSTER: which unit types a given set of flags
// will put on the map.
//
// `sandboxUnitTypes` is what the mesh loader asks before the renderer exists.
// A type placed but absent from the roster is the `SPRITE_MAP` failure mode --
// art that ships, passes every gate, and draws nothing -- and for `civilians`
// it is worse than for anything else: that type has no billboard to fall back
// on, so a miss is an invisible crowd rather than a sprite where a model
// should be.
import { describe, expect, it } from 'vitest';
import { Sim, TICKS_PER_SECOND } from '@lions/sim';
import { applyTerrain, kitLevel, maps, parseMap, units, type MapId } from '@lions/data';
import {
  SANDBOX_CIV,
  SANDBOX_ENEMY,
  SANDBOX_KDF,
  SANDBOX_KIT_LEVELS,
  SANDBOX_SUR,
  SANDBOX_WORKS_KDF,
  SANDBOX_TUNNEL_KDF,
  bootTiers,
  sandboxKitTiers,
  sandboxUnitTypes,
} from './sandbox-force';
import { sandboxSpawns } from './sandbox-spawn';
import { sandboxAnchors } from './sandbox-anchors';
import { standMapStructures } from './map-sim';
import { RIGGED_UNIT_MESHES } from './mesh-catalogue';

const NONE = { tunnel: false, sur: false, civ: false, works: false };

describe('sandboxUnitTypes', () => {
  it('names every type the base tables place, with no flags at all', () => {
    const got = sandboxUnitTypes(NONE);
    for (const [id] of [...SANDBOX_KDF, ...SANDBOX_ENEMY]) expect(got.has(id)).toBe(true);
  });

  it('adds civilians only for &civ', () => {
    expect(sandboxUnitTypes(NONE).has('civilians')).toBe(false);
    expect(sandboxUnitTypes({ ...NONE, tunnel: true, sur: true }).has('civilians')).toBe(false);
    expect(sandboxUnitTypes({ ...NONE, civ: true }).has('civilians')).toBe(true);
  });

  it('reads the same arrays the spawner iterates, for every flag', () => {
    // The one property that makes a fifth hand-kept list unnecessary.
    const all = sandboxUnitTypes({ tunnel: true, sur: true, civ: true, works: true });
    for (const [id] of [
      ...SANDBOX_KDF,
      ...SANDBOX_ENEMY,
      ...SANDBOX_TUNNEL_KDF,
      ...SANDBOX_SUR,
      ...SANDBOX_CIV,
      ...SANDBOX_WORKS_KDF,
    ]) {
      expect(all.has(id)).toBe(true);
    }
  });
});

describe('&works', () => {
  it('fields one demo_squad, and only for the flag', () => {
    expect(sandboxUnitTypes(NONE).has('demo_squad')).toBe(false);
    expect(sandboxUnitTypes({ ...NONE, works: true }).has('demo_squad')).toBe(true);
    expect(SANDBOX_WORKS_KDF.map(([id]) => id)).toEqual(['demo_squad']);
  });
});

describe('the &civ crowd', () => {
  it('is civilians and nothing else', () => {
    expect([...new Set(SANDBOX_CIV.map(([id]) => id))]).toEqual(['civilians']);
  });

  it('is a whole number of variant rotations, so no figure appears more often', () => {
    // `pickMeshVariant` is `entityId % variants.length` and the crowd takes a
    // contiguous id block, so the count decides the spread. Eight over four
    // figures is two apiece. A count that is not a multiple would show one
    // figure more often than the rest -- the artifact the four variants exist
    // to remove -- and this goes red both if the crowd is resized and if a
    // fifth figure ships.
    const variants = RIGGED_UNIT_MESHES.civilians.files.length;
    expect(variants).toBeGreaterThan(1);
    expect(SANDBOX_CIV.length % variants).toBe(0);
    expect(SANDBOX_CIV.length / variants).toBe(2);
  });

  it('stands in two clusters, not one line', () => {
    // A row of eight is the one arrangement in which "all four figures, twice"
    // is hard to see at a glance.
    const ys = SANDBOX_CIV.map(([, , dy]) => dy);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(4);
    expect(new Set(SANDBOX_CIV.map(([, dx, dy]) => `${dx},${dy}`)).size).toBe(SANDBOX_CIV.length);
  });
});

describe('the &kit ladder (N12)', () => {
  const roster = Object.values(units);

  it('covers every type the sandbox force fields, and nothing else', () => {
    expect(Object.keys(SANDBOX_KIT_LEVELS).sort()).toEqual([...new Set(SANDBOX_KDF.map(([id]) => id))].sort());
  });

  it('puts each level on at least four placements, so one frame shows all three', () => {
    const count = [0, 0, 0, 0];
    for (const [id] of SANDBOX_KDF) count[SANDBOX_KIT_LEVELS[id] ?? 0]++;
    expect(count[0]).toBe(0);
    expect(count.slice(1).every((n) => n >= 4)).toBe(true);
  });

  it('makes tiers that read back as exactly the ladder level, so sim, card and mark agree', () => {
    const tiers = sandboxKitTiers(roster);
    expect(Object.keys(tiers).sort()).toEqual(Object.keys(SANDBOX_KIT_LEVELS).sort());
    for (const [id, level] of Object.entries(SANDBOX_KIT_LEVELS)) {
      const unit = roster.find((u) => u.id === id);
      if (unit === undefined) throw new Error(`fixture: no unit "${id}" in @lions/data`);
      expect(kitLevel(unit, tiers[id] ?? {}), id).toBe(level);
    }
  });
});

describe('bootTiers', () => {
  const roster = Object.values(units);
  const account = { mbt_lavi: { armour: 1 } };

  it('is the account on a mission, whatever the URL says', () => {
    expect(bootTiers(account, { mission: true, kitFlag: true }, roster)).toBe(account);
  });

  it('is the account in a sandbox without &kit', () => {
    expect(bootTiers(account, { mission: false, kitFlag: false }, roster)).toBe(account);
  });

  it('is the ladder, not the account, in a sandbox with &kit', () => {
    expect(bootTiers(account, { mission: false, kitFlag: true }, roster)).toEqual(sandboxKitTiers(roster));
  });
});

// The sandbox force garrisons NOBODY. The roof cutaway (GH-1225) cuts over a
// building only when the viewer's own garrison holds it, and the gated golden
// capture asserts `cutawayCount() === 0` on every scenario; that precondition
// is true only while a sandbox spawns no garrison. This is the one list of what
// a sandbox places, so the pin belongs here: every placement is a bare
// `[unit, dx, dy]` with nowhere to say "garrison this house" and no stance to
// stand in, and the force each shipped map actually spawns has no unit inside,
// on its way into, or holding a building.
describe('the sandbox force garrisons nobody', () => {
  const ALL = { tunnel: true, sur: true, civ: true, works: true };
  const TABLES = {
    SANDBOX_KDF,
    SANDBOX_ENEMY,
    SANDBOX_SUR,
    SANDBOX_CIV,
    SANDBOX_TUNNEL_KDF,
    SANDBOX_WORKS_KDF,
  } as const;

  it('builds every shipped map’s force and finds no garrison stance or target', () => {
    // The shape is the pin: a placement that can carry a stance or a target is
    // a fourth field, or an object where a dx/dy belongs. `sandboxSpawns`
    // (`sandbox-spawn.ts`) reads all three and nothing else, so a fourth
    // element is data the force would drop -- and the one obvious thing to put
    // there is where a unit should garrison.
    for (const [name, rows] of Object.entries(TABLES)) {
      for (const [i, row] of rows.entries()) {
        expect(row.length, `${name}[${i}] fields`).toBe(3);
        expect(typeof row[0], `${name}[${i}] unit id`).toBe('string');
        expect(typeof row[1], `${name}[${i}] dx`).toBe('number');
        expect(typeof row[2], `${name}[${i}] dy`).toBe('number');
      }
    }

    const planned =
      SANDBOX_KDF.length + SANDBOX_TUNNEL_KDF.length + SANDBOX_ENEMY.length + SANDBOX_SUR.length + SANDBOX_CIV.length;
    for (const mapId of Object.keys(maps) as MapId[]) {
      const parsed = parseMap(maps[mapId]);
      const sim = new Sim({ seed: 20260727, width: parsed.width, height: parsed.height, capacity: 256 });
      applyTerrain(parsed, sim);
      standMapStructures(sim, parsed);

      const typeOf = new Map<string, number>();
      for (const id of sandboxUnitTypes(ALL)) {
        const spec = (units as Record<string, unknown>)[id];
        if (spec === undefined) throw new Error(`sandbox places unknown unit "${id}"`);
        typeOf.set(id, sim.addUnitType(spec as never));
      }

      // The REAL spawner `main.ts` boots with, not a second copy of its loop.
      sandboxSpawns(sim, typeOf, sandboxAnchors(parsed), ALL);
      // A placement silently dropped would make "nobody is garrisoned" cheaper
      // than it looks. `&works` is excluded: its squad arrives through
      // `sandboxWorksMission`, not this spawner.
      expect(sim.entityCount, mapId).toBe(planned);

      // A queued garrison reaches the state arrays only on a tick: without
      // stepping, a mutant that queued one in the placer would still read -1.
      // Two seconds (40 ticks at 20 Hz) is past the command pass and the walk
      // to the door.
      for (let t = 0; t < 2 * TICKS_PER_SECOND; t++) sim.tick();

      for (let id = 0; id < sim.entityCount; id++) {
        const st = sim.state;
        // A garrison needs a structure to stand in AND the structure it was
        // ordered into; either one is a garrison the cutaway would trigger on.
        expect([st.garrisonedIn[id], st.garrisonGoal[id]], `${mapId}: unit ${id} garrison`).toEqual([-1, -1]);
        // No stance either: an ambush or a patrol is an order a sandbox spawn
        // does not carry.
        expect(sim.ambushRadiusSqOf(id), `${mapId}: unit ${id} ambush`).toBe(0);
        expect(sim.isPatrolling(id), `${mapId}: unit ${id} patrol`).toBe(false);
      }
    }
  });
});
