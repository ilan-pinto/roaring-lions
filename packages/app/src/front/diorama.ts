/**
 * The scene host's diorama world: a real map, its buildings, and a handful of
 * idle units, built from `DioramaJson` (spec §3.2, §10) the same way
 * `bootBattlefield` builds a mission's -- `map-sim.ts`'s `standMapStructures`
 * and `mesh-catalogue.ts`'s `meshPlanFor` (Task 2 of the scene-host plan) are
 * the shared pieces both take, rather than a second copy of either loop.
 *
 * Invariant 1 ("sim runs at a fixed 20 Hz tick") has nothing to say about a
 * `Sim` that is never ticked, which is exactly what this builds: the menu's
 * units stand for a photograph, not a battle. No tick means no RNG draw, no
 * event, and no determinism surface -- the sim invariants apply to what runs,
 * and this never runs.
 */
import { fx, Sim, type UnitTypeJson } from '@lions/sim';
import { applyTerrain, maps, parseMap, units, type DioramaJson, type MapJson, type ParsedMap } from '@lions/data';
import { standMapStructures } from '../map-sim';
import { meshPlanFor, type MeshPlan } from '../mesh-catalogue';

/**
 * A degree heading -> Q16.16 turn fraction, masked to the facing field's own
 * range -- `packages/sim/src/mission.ts:1247`'s placement conversion,
 * mirrored verbatim: `const facing = p.facing_deg !== undefined ?
 * fx.div(fx.from(p.facing_deg), fx.fromInt(360)) & 0xffff : 0;`. A full turn
 * is `1.0` in Q16.16, so a degree is `1/360` of a turn; a diorama unit with
 * the same `facing_deg` as a mission placement ends up facing identically.
 */
export function facingFromDeg(deg: number): number {
  return fx.div(fx.from(deg), fx.fromInt(360)) & 0xffff;
}

// bootBattlefield's own seed (main.ts). Nothing here consumes randomness --
// nothing ticks -- but a `Sim` still requires one to construct.
const DIORAMA_SEED = 20260727;

/** A built diorama: the world a scene host renders, plus the camera point and
 *  reference zoom its JSON authored. */
export interface DioramaWorld {
  readonly sim: Sim;
  readonly map: ParsedMap;
  readonly plan: MeshPlan;
  readonly camera: { readonly x: number; readonly y: number };
  readonly zoomAtRef: number;
}

/**
 * Stands `d`'s map and units in a fresh, never-ticked `Sim`, and plans the
 * meshes the host needs to draw them -- the diorama half of what
 * `bootBattlefield` does for a real mission, minus everything a photograph
 * has no use for (tunnels, ROE, the mission runtime, upgrades: the menu shows
 * base units, so `applyUpgrades` never runs).
 *
 * Throws by name -- naming the diorama's own id alongside the bad reference,
 * the same shape `sim.ts`'s own "unknown tunnel" throw takes -- for a map
 * `data/maps` does not have, or a unit `data/units` does not have; either is
 * an authoring mistake in the diorama JSON, not a runtime condition to
 * recover from.
 */
export function buildDioramaWorld(d: DioramaJson): DioramaWorld {
  const mapJson = (maps as Record<string, MapJson | undefined>)[d.map];
  if (mapJson === undefined) {
    throw new Error(`diorama "${d.id}" names map "${d.map}", which data/maps does not have`);
  }
  const map = parseMap(mapJson);

  const sim = new Sim({
    seed: DIORAMA_SEED,
    width: map.width,
    height: map.height,
    capacity: Math.max(8, d.units.length),
  });
  // Cover and blocked terrain, plus the buildings -- entities, not terrain --
  // exactly as bootBattlefield stands them.
  applyTerrain(map, sim);
  standMapStructures(sim, map);

  // Every unit type the game knows, registered once -- as bootBattlefield
  // does -- not merely the diorama's own roster, so a type index is always
  // there for the spawn loop below to find.
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) {
    typeOf.set(u.id, sim.addUnitType(u as UnitTypeJson));
  }

  for (const p of d.units) {
    const typeIdx = typeOf.get(p.unit);
    if (typeIdx === undefined) {
      throw new Error(`diorama "${d.id}" names unit "${p.unit}", which data/units does not have`);
    }
    const [x, y] = p.at;
    sim.spawn(typeIdx, 0, fx.from(x + 0.5), fx.from(y + 0.5), facingFromDeg(p.facing_deg ?? 0));
  }

  const plan = meshPlanFor(map, new Set(d.units.map((u) => u.unit)));

  return {
    sim,
    map,
    plan,
    camera: { x: d.camera.at[0], y: d.camera.at[1] },
    zoomAtRef: d.camera.zoom_at_1080p,
  };
}
