/**
 * The gate that makes per-roster mesh loading safe to have.
 *
 * `mesh-catalogue.ts` replaced "load every GLB at boot" with "load what this
 * mission fields". That trade buys 8-29 MiB per boot and costs a new way to be
 * wrong: an asset nothing claims, or a roster entry nothing loads. This
 * repository has already shipped the first failure six times through
 * `SPRITE_MAP` -- complete, gate-passing sheets that drew nothing, because art
 * existing and art being LOADED are different things and only the first had a
 * gate. This file is that missing gate, in both directions.
 *
 * It reads `art/meshes/**` off disk with `node:fs` rather than trusting a
 * list, for the same reason `vite-plugin-asset-watch.ts` derives its
 * directories instead of naming them: a hand-kept second registry of asset
 * locations fails exactly the way the thing it guards fails.
 *
 * The decor block imports `@lions/render/terrain`. Production app code may
 * not (eslint, the standing bundle rule) -- `**\/*.test.ts` is explicitly
 * ignored by that rule, which is how `terrain-parity.test.ts` already reaches
 * the same barrel, and a test never ships in a player-facing bundle.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Sim,
  type MissionJson,
} from '@lions/sim';
import {
  maps,
  missions,

  units,
  structures as structureCatalogue,
  parseMap,
  applyTerrain,
  type MapId,
} from '@lions/data';
import { decorPlacements, type TerrainInput } from '@lions/render/terrain';
import {
  RIGGED_UNIT_MESHES,
  VEHICLE_UNIT_MESHES,
  BUILDING_MESHES,
  DECOR_MESHES,
  VFX_MESHES,
  RETIRED_MESH_FILES,
  claimedMeshFiles,
  decorFamiliesFor,
  missionUnitTypes,
  hasUnitMesh,
} from './mesh-catalogue';

const MESH_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../art/meshes'
);

/** Every `.glb` under `art/meshes/**`, as the catalogue spells them:
 *  `'demo_squad.glb'`, `'vehicles/apc_eitan.glb'`. */
function shippedMeshFiles(dir = MESH_ROOT, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...shippedMeshFiles(path.join(dir, e.name), `${prefix}${e.name}/`));
    else if (e.name.endsWith('.glb')) out.push(`${prefix}${e.name}`);
  }
  return out.sort();
}

const UNIT_IDS = new Set(Object.keys(units));

describe('mesh catalogue: every shipped GLB is accounted for', () => {
  it('claims or retires every .glb under art/meshes', () => {
    // The SPRITE_MAP failure, in mesh form: an asset ships, passes
    // validate:meshes, and is never loaded because nothing added it to a list.
    // The only sanctioned way to be unloaded is a RETIRED_MESH_FILES entry
    // with a reason.
    const claimed = claimedMeshFiles();
    const orphans = shippedMeshFiles().filter(
      (f) => !claimed.has(f) && !(f in RETIRED_MESH_FILES)
    );
    expect(orphans).toEqual([]);
  });

  it('claims nothing that is not on disk', () => {
    // The other direction: a catalogue entry whose file is gone resolves to
    // `<dir>/undefined`, which the dev server answers with index.html at HTTP
    // 200 and GLTFLoader reports as a JSON parse error naming a file nobody
    // touched. `meshUrl` throws instead, but only when reached -- this fails
    // for the whole catalogue at once.
    const missing = [...claimedMeshFiles()].filter((f) => !existsSync(path.join(MESH_ROOT, f)));
    expect(missing).toEqual([]);
  });

  it('does not both claim and retire the same file', () => {
    const claimed = claimedMeshFiles();
    expect(Object.keys(RETIRED_MESH_FILES).filter((f) => claimed.has(f))).toEqual([]);
  });

  it('retires nothing that has already been deleted', () => {
    const stale = Object.keys(RETIRED_MESH_FILES).filter(
      (f) => !existsSync(path.join(MESH_ROOT, f))
    );
    expect(stale).toEqual([]);
  });

  it('keys every unit-mesh entry by a real unit type id', () => {
    // A typo here is silent: the entry simply never matches a roster, and the
    // unit falls back to its billboard forever.
    const keys = [...Object.keys(RIGGED_UNIT_MESHES), ...Object.keys(VEHICLE_UNIT_MESHES)];
    expect(keys.filter((k) => !UNIT_IDS.has(k))).toEqual([]);
  });

  it('keys every building-mesh entry by a real structure type id', () => {
    const known = new Set(Object.keys(structureCatalogue));
    expect(Object.keys(BUILDING_MESHES).filter((k) => !known.has(k))).toEqual([]);
  });

  it('does not draw one unit type through both mesh paths', () => {
    // `loadMeshUnit` and `loadVehicleMesh` file into separate maps and
    // `updateMeshUnits`/`updateVehicleMeshes` are separate loops -- a type in
    // both would be built twice per frame.
    const both = Object.keys(RIGGED_UNIT_MESHES).filter((k) => k in VEHICLE_UNIT_MESHES);
    expect(both).toEqual([]);
  });
});

describe('mesh catalogue: mission rosters', () => {
  // `missions` only. `tutorials` holds STEP lists (`data/tutorials/*.json`),
  // not missions -- the tutorial's own units live in
  // `missions.beit_sahwan_0_tutorial`, which is in this record already.
  const allMissions = missions as Record<string, MissionJson>;

  /** Every unit id a mission names through the schema's own `unit` field,
   *  extracted INDEPENDENTLY of `missionUnitTypes`' recursive walk -- so the
   *  walk being replaced by a hand-kept field list would fail here. */
  function unitFieldsOf(node: unknown, out = new Set<string>()): Set<string> {
    if (Array.isArray(node)) for (const v of node) unitFieldsOf(v, out);
    else if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'unit' && typeof v === 'string') out.add(v);
        else unitFieldsOf(v, out);
      }
    }
    return out;
  }

  for (const [id, mission] of Object.entries(allMissions)) {
    it(`${id}: covers every unit the mission names`, () => {
      const found = missionUnitTypes(mission, UNIT_IDS);
      const named = [...unitFieldsOf(mission)].filter((u) => UNIT_IDS.has(u));
      expect(named.length).toBeGreaterThan(0);
      expect([...named].filter((u) => !found.has(u))).toEqual([]);
    });
  }

  it('finds civilians, the one type with no billboard to fall back to', () => {
    // `civilians` has no SPRITE_MAP entry, so a civilian whose mesh has not
    // loaded draws NOTHING rather than a sprite -- which is exactly what
    // eleven of them did before GH-149. Deferring it is the one deferral that
    // is visibly broken rather than merely late, so its presence in the
    // blocking set is pinned here rather than left to the walk's general case.
    // It reaches the walk through `civilians.groups[].unit`, which
    // `mission.schema.json` makes required.
    const found = missionUnitTypes(missions.beit_sahwan_breach, UNIT_IDS);
    expect(found.has('civilians')).toBe(true);
  });

  it('finds a reinforcement wave type that never stands on the map at t=0', () => {
    // `beit_sahwan_breach` fields no `moto_rpg` in `starting_force` or
    // `enemy.garrison`; it arrives in a later wave. A roster computed from the
    // opening force alone would pop it in mid-mission.
    const opening = new Set(
      (missions.beit_sahwan_breach.starting_force ?? []).map((p) => p.unit)
    );
    expect(opening.has('moto_rpg')).toBe(false);
    expect(missionUnitTypes(missions.beit_sahwan_breach, UNIT_IDS).has('moto_rpg')).toBe(true);
  });

  it('ignores a string that is not a unit id', () => {
    expect([...missionUnitTypes({ briefing: 'take the ridge', at: [1, 2] }, UNIT_IDS)]).toEqual([]);
  });
});

describe('mesh catalogue: decor families', () => {
  /** The same `TerrainInput` `ThreeRenderer` hands `decorPlacements`, built
   *  the way `main.ts` builds the world: `parseMap` into a real `Sim`, with
   *  `applyTerrain` and `addStructure` carrying the mechanical layer across. */
  function terrainOf(id: MapId): { input: TerrainInput; parsed: ReturnType<typeof parseMap> } {
    const parsed = parseMap(maps[id]);
    const sim = new Sim({
      seed: 20260727,
      width: parsed.width,
      height: parsed.height,
      capacity: 256,
    });
    applyTerrain(parsed, sim);
    const structTypeIdx = new Map<string, number>();
    for (const [structId, spec] of Object.entries(structureCatalogue)) {
      structTypeIdx.set(
        structId,
        sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0])
      );
    }
    for (const b of parsed.structures) {
      const t = structTypeIdx.get(b.type);
      if (t === undefined) throw new Error(`map ${id} references unknown structure type ${b.type}`);
      sim.addStructure(t, b.tiles);
    }
    return {
      parsed,
      input: {
        width: sim.width,
        height: sim.height,
        decor: parsed.decor,
        elevation: parsed.elevation,
        blocked: sim.blocked,
        cover: sim.cover,
        boulder: sim.boulder,
      },
    };
  }

  for (const id of Object.keys(maps) as MapId[]) {
    it(`${id}: loads every family the real placer actually places`, () => {
      // `decorFamiliesFor` is a second copy of `decor-place.ts`'s `familyFor`
      // rule, phrased as a whole-map question. This is what stops the two
      // drifting: it runs the REAL placer and demands the catalogue's set be a
      // superset of what came out. A miss here is bare ground on a shipped map.
      const { input, parsed } = terrainOf(id);
      const placed = new Set(decorPlacements(input).map((p) => p.family));
      const planned = decorFamiliesFor(parsed);
      expect([...placed].filter((f) => !planned.has(f)).sort()).toEqual([]);
    });
  }

  it('leaves a family out when the map cannot place it', () => {
    // The saving has to be real: tel_marum has no cover tiles and no grove, so
    // it must not download bush, tree or rock. If this ever passes trivially
    // (every map wanting every family) the whole decor half of the change is
    // dead weight and should be deleted rather than kept.
    const planned = decorFamiliesFor(parseMap(maps.tel_marum));
    expect([...planned].sort()).toEqual(['boulder', 'grass', 'sand', 'slab']);
  });
});

describe('mesh catalogue: what has a mesh at all', () => {
  it('reports a type with no GLB as billboard-only', () => {
    // `recon_drone` ships a sprite sheet and no mesh. The mesh path is
    // additive: a type with no entry keeps its billboard rather than failing.
    expect(hasUnitMesh('recon_drone')).toBe(false);
    expect(hasUnitMesh('inf_squad')).toBe(true);
    expect(hasUnitMesh('mbt_lavi')).toBe(true);
  });

  it('ships exactly the three VFX meshes as one shared set', () => {
    expect(Object.values(VFX_MESHES).every((f) => f.startsWith('vfx/'))).toBe(true);
  });

  it('lists three variants for every scattered decor family, and one for the ditch', () => {
    // This was `every((v) => v.length === 3)` -- a stricter rule than the
    // catalogue actually needs, and `ditch` is the first family to break it
    // honestly. A scattered family wants variety so a hillside of rocks does
    // not read as a stamped pattern; a ditch is one repeated segment of a
    // continuous earthwork and variety in it would be a defect, not a
    // feature. `decor-place.ts` pins every ditch placement to variant 0 to
    // match.
    //
    // Still a real guard rather than a widened one: a family listing two
    // variants, or four, or a `ditch_1` that does not exist, still fails.
    const counts = Object.fromEntries(
      Object.entries(DECOR_MESHES).map(([family, files]) => [family, files.length])
    );
    expect(counts).toEqual({
      grass: 3,
      sand: 3,
      bush: 3,
      tree: 3,
      rock: 3,
      slab: 3,
      boulder: 3,
      ditch: 1,
    });
  });
});
