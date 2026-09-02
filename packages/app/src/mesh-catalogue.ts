/**
 * Every GLB the app can load, and the arithmetic that decides which of them a
 * given mission or sandbox actually needs.
 *
 * WHY THIS FILE EXISTS. `main.ts` used to load the whole mesh library at boot,
 * unconditionally, before the loading screen was even on screen. Measured
 * against a production build served from disk (`vite build`, `packages/app/
 * dist`, byte-counted server-side because the browser's resource-timing buffer
 * caps at 250 entries and this page passes 3,700 requests): **65 GLB fetches,
 * 40.04 MiB, identical for every mission and every sandbox**. `tel_marum_1_
 * recon` fields nine unit types and downloaded all thirty.
 *
 * THE FAILURE MODE THIS FILE MUST NOT REPRODUCE. `SPRITE_MAP` in `main.ts` is
 * a hand-kept list of which sheets to load, and art has shipped complete,
 * gate-passing and drawing NOTHING six times on this branch because someone
 * added the asset and never the list entry. No gate catches it. A per-roster
 * mesh loader is the same shape of hazard twice over -- a file nothing claims,
 * and a claimed type no roster asks for -- so both directions are gated:
 *
 *   1. A GLB on disk that no entry below claims fails `mesh-catalogue.test.ts`
 *      by name. `RETIRED_MESH_FILES` is the only way to be unclaimed, and each
 *      entry there carries the reason it is not loaded.
 *   2. A catalogue entry whose file is gone throws at boot from `meshUrl`,
 *      naming the asset -- rather than resolving to `<base>/undefined`, which
 *      the SPA fallback answers with index.html at HTTP 200 and GLTFLoader
 *      reports as a JSON parse error naming a file nobody touched (see
 *      `vite-plugin-asset-watch.ts`'s header for that mechanism in full).
 *   3. A type that reaches the field with a catalogue entry and no loaded
 *      template is picked up by `main.ts`'s per-second sweep, which loads it
 *      and warns by name. A roster miss is therefore loud and self-healing,
 *      never a silently-missing unit.
 *
 * PATHS ARE DATA, URLS ARE A FUNCTION. Every table here holds a plain relative
 * path (`'demo_squad.glb'`, `'vehicles/apc_eitan.glb'`). `meshUrl` is the only
 * place `new URL(..., import.meta.url)` appears, and it dispatches on the
 * directory because Vite's rewrite globs `art/meshes/*.glb` -- one `*`, which
 * does not cross a `/`. Keeping the tables URL-free is what lets
 * `mesh-catalogue.test.ts` compare them against `fs.readdirSync` without
 * asking Vite to resolve an asset under `environment: 'node'`.
 */

import { DECOR, type ParsedMap } from '@lions/data';

/** Which ramp pair a rigged mesh is shaded through. Mirrors
 *  `three/units/mesh-role.ts`'s own `MeshFaction`, restated as a string union
 *  for the same reason `main.ts` used `as const` before: eslint forbids any
 *  static import from `@lions/render/three` in this package, type-only
 *  included, and `loadMeshUnit`'s own parameter type still rejects a wrong
 *  faction at the call site. */
export type MeshFactionName = 'kdf' | 'enemy' | 'civilian';

/** Decor families, mirroring `three/terrain/decor-place.ts`'s `DecorFamily`
 *  for the same reason and with the same guard: `mesh-catalogue.test.ts` runs
 *  the real `decorPlacements` over every shipped map and fails if this file's
 *  derivation misses a family that actually gets placed. */
export type DecorFamilyName =
  | 'grass'
  | 'sand'
  | 'bush'
  | 'tree'
  | 'rock'
  | 'slab'
  | 'boulder'
  | 'ditch';

/** A rigged unit mesh: one GLB per VARIANT of one unit type (`civilians` is
 *  four figures; everything else is one), plus the side it fights for. */
export interface RiggedMeshEntry {
  readonly files: readonly string[];
  readonly faction: MeshFactionName;
}

/**
 * Unit types drawing a rigged mesh through `ThreeRenderer.loadMeshUnit`.
 *
 * The faction is NOT decorative: `mesh-role.ts` shades `uniform` and `webbing`
 * through INVERTED ramps per side (KDF grey-over-olive, the militia
 * olive-over-tan), so getting it wrong reads as the wrong ARMY, not a wrong
 * tint. Kept in step with `tools/units/teams.py`'s own `TEAMS` table, which is
 * where the faction is actually decided.
 *
 * The key is the unit type id and is what a roster is matched against. The
 * file is named separately because the "team id == unit type id == file
 * basename" convention holds for the `kit.py` teams and NOT for the five
 * Meshy-supplied assets (`meshy_soldier.glb` draws `inf_squad`), which is
 * exactly why `main.ts` had to carry those as five hand-written calls beside
 * the list rather than inside it.
 */
export const RIGGED_UNIT_MESHES: Readonly<Record<string, RiggedMeshEntry>> = {
  demo_squad: { files: ['demo_squad.glb'], faction: 'kdf' },
  at_team: { files: ['at_team.glb'], faction: 'kdf' },
  sniper_team: { files: ['sniper_team.glb'], faction: 'kdf' },
  militia_cell: { files: ['militia_cell.glb'], faction: 'enemy' },
  rpg_team: { files: ['rpg_team.glb'], faction: 'enemy' },
  atgm_cell: { files: ['atgm_cell.glb'], faction: 'enemy' },
  mortar_crew: { files: ['mortar_crew.glb'], faction: 'enemy' },
  charge_squad: { files: ['charge_squad.glb'], faction: 'enemy' },
  // Despite being a motorcycle, `moto_rpg` is built by the same
  // `kit.py`/`teams.py` pipeline as every team above (composed primitives,
  // zero materials, faction-ramp colour at runtime), so it takes the rigged
  // path and a faction here, not the vehicle table's faction-baked one --
  // see `tools/units/teams.py`'s own `TEAMS['moto_rpg']`.
  moto_rpg: { files: ['moto_rpg.glb'], faction: 'enemy' },
  digger_crew: { files: ['digger_crew.glb'], faction: 'enemy' },

  // The Meshy-generated (AI, disclosed) rigged bipeds. `inf_squad` was first
  // wired to the enemy side on the reasoning that a Middle-Eastern rifleman
  // was a thematic fit KDF was not; the project lead corrected it -- the asset
  // was supplied as OUR infantry. Which side an asset fights for is a design
  // call, not one a naming heuristic gets to infer, which is why every faction
  // here is written down rather than derived.
  inf_squad: { files: ['meshy_soldier.glb'], faction: 'kdf' },
  sarim_rifles: { files: ['sarim_rifles.glb'], faction: 'enemy' },
  mortar_team: { files: ['meshy_mortar_team.glb'], faction: 'kdf' },
  yahalom_squad: { files: ['yahalom_engineer.glb'], faction: 'kdf' },

  // GH-149. Four figures for ONE unit type -- `data/units/civilians.json` is a
  // single type, so these are VARIANTS, and `three/units/mesh-variant.ts`
  // decides which entity draws which. THE ORDER OF THIS LIST IS THE VARIANT
  // ORDER (entity id `n` draws variant `n % 4`), so it is readable here rather
  // than being a property of whichever fetch finished first.
  //
  // `civilian` is a third faction added for these, and it is the load-bearing
  // part: through `kdf` a civilian wears rifle-squad olive and reads as
  // friendly infantry; through `enemy` it wears militia tan and reads as a
  // target, which is precisely what `roe.civilian_casualty_penalty` deducts
  // for.
  //
  // `civilians` is ALSO the one unit type with no `SPRITE_MAP` entry, so it
  // has no billboard to fall back to: on `three` a civilian with no loaded
  // mesh draws literally nothing, which is what eleven of them did before
  // GH-149. It is therefore the one type that must never be deferred, and
  // `missionUnitTypes` finds it the ordinary way -- `mission.schema.json`
  // makes `civilians.groups` required and every group a `placement`, so a
  // mission with civilians always names the type in a `unit` field.
  civilians: {
    files: [
      'civilians/civilian_woman.glb',
      'civilians/office_worker.glb',
      'civilians/farm_worker.glb',
      'civilians/civilian_child.glb',
    ],
    faction: 'civilian',
  },
};

/**
 * Unit types drawing a rigid vehicle mesh through
 * `ThreeRenderer.loadVehicleMesh` -- no faction parameter, because a vehicle
 * GLB is faction-specific by construction and the ramp choice already lives at
 * "which vehicle" rather than "which side" (`vehicle-mesh-role.ts`'s own top
 * comment has the argument).
 */
export const VEHICLE_UNIT_MESHES: Readonly<Record<string, string>> = {
  apc_eitan: 'vehicles/apc_eitan.glb',
  dozer_d9: 'vehicles/dozer_d9.glb',
  mbt_lavi: 'vehicles/mbt_lavi.glb',
  technical: 'vehicles/technical.glb',
  ifv_namer: 'vehicles/ifv_namer.glb',
  jeep_shoded: 'vehicles/jeep_shoded.glb',
  heli_peten: 'vehicles/heli_peten.glb',
  paramotor: 'vehicles/paramotor.glb',
  rocket_battery: 'vehicles/rocket_battery.glb',
};

/** Structure types drawing a building mesh: standing plus its wreck sibling. */
export const BUILDING_MESHES: Readonly<Record<string, { readonly idle: string; readonly wreck: string }>> = {
  shanty: { idle: 'buildings/shanty.glb', wreck: 'buildings/shanty_wreck.glb' },
  house: { idle: 'buildings/house.glb', wreck: 'buildings/house_wreck.glb' },
  warehouse: { idle: 'buildings/warehouse.glb', wreck: 'buildings/warehouse_wreck.glb' },
  apartment: { idle: 'buildings/apartment.glb', wreck: 'buildings/apartment_wreck.glb' },
  concrete: { idle: 'buildings/concrete.glb', wreck: 'buildings/concrete_wreck.glb' },
  mosque: { idle: 'buildings/mosque.glb', wreck: 'buildings/mosque_wreck.glb' },
  wall: { idle: 'buildings/wall.glb', wreck: 'buildings/wall_wreck.glb' },
  // The KDF field camp a mission places (`structures[]` in
  // mission.schema.json) and produces from -- the one building type that
  // reaches the map from mission JSON rather than from a map symbol.
  camp: { idle: 'buildings/camp.glb', wreck: 'buildings/camp_wreck.glb' },
};

/** Decor: seven families, three variants each, keyed `<family>_<variant>` --
 *  not by a unit type id, because nothing in the sim has a "bush". `boulder`
 *  is the exception: it draws `Sim.boulder` (the `b` map symbol), a real
 *  mechanic rather than scatter. */
export const DECOR_MESHES: Readonly<Record<DecorFamilyName, readonly string[]>> = {
  grass: ['decor/grass_0.glb', 'decor/grass_1.glb', 'decor/grass_2.glb'],
  sand: ['decor/sand_0.glb', 'decor/sand_1.glb', 'decor/sand_2.glb'],
  bush: ['decor/bush_0.glb', 'decor/bush_1.glb', 'decor/bush_2.glb'],
  tree: ['decor/tree_0.glb', 'decor/tree_1.glb', 'decor/tree_2.glb'],
  rock: ['decor/rock_0.glb', 'decor/rock_1.glb', 'decor/rock_2.glb'],
  slab: ['decor/slab_0.glb', 'decor/slab_1.glb', 'decor/slab_2.glb'],
  boulder: ['decor/boulder_0.glb', 'decor/boulder_1.glb', 'decor/boulder_2.glb'],
  // ONE variant, not three. The ditch has a single source and
  // `decor-place.ts` pins every placement to variant 0 for it; listing
  // `ditch_1`/`ditch_2` here would 404 on every boot of a map with a ditch.
  ditch: ['decor/ditch_0.glb'],
};

/** The three shared VFX meshes (mesh-unit-contract's VFX asset class). Not
 *  keyed by anything: one asset each, wanted by any mission where a shot is
 *  fired or a building falls, which is all of them. 0.46 MiB for the set. */
export const VFX_MESHES = {
  muzzleFlash: 'vfx/muzzle_flash.glb',
  explosionBurst: 'vfx/explosion_burst.glb',
  smokePlume: 'vfx/smoke_plume.glb',
} as const;

/**
 * Shipped GLBs that are deliberately never loaded, each with the reason.
 *
 * This is the ONLY way a file under `art/meshes/**` may go unclaimed:
 * `mesh-catalogue.test.ts` fails by name on anything else. The list is the
 * difference between "we decided not to draw this" and the six-times-repeated
 * bug where art shipped, passed every gate, and drew nothing.
 *
 * All three are `tools/units/kit.py` builds superseded by a Meshy asset. They
 * stay on disk because `export_mesh_team.py <id>` keeps regenerating them and
 * because `mesh_gait.test.ts` measures `mortar_team.glb` as the scale
 * reference for the asset that replaced it -- so each swap stays one line to
 * revert.
 */
export const RETIRED_MESH_FILES: Readonly<Record<string, string>> = {
  'inf_squad.glb': 'superseded by meshy_soldier.glb (the supplied KDF rifleman)',
  'mortar_team.glb':
    'superseded by meshy_mortar_team.glb; kept as mesh_gait.test.ts’ 88.7% gait reference',
  'yahalom_squad.glb': 'superseded by yahalom_engineer.glb (the first mesh team with a work clip)',
};

/**
 * The served URL for one catalogue path.
 *
 * Six `new URL()` forms rather than one, because Vite's
 * `vite:asset-import-meta-url` rewrite turns each into a glob whose `*` does
 * not cross a `/` -- a single `art/meshes/*` pattern would match the seventeen
 * top-level files and none of the subdirectories. Six forms also means
 * `vite-plugin-asset-watch.ts` (GH-147) derives and watches all six
 * directories from this file exactly as it did from `main.ts`, so adding a GLB
 * to any of them still invalidates the listing in a running dev server.
 *
 * Throws rather than returning a URL Vite could not resolve: an unmatched glob
 * key yields `undefined`, `new URL(undefined, ...)` resolves to
 * `<dir>/undefined`, the SPA fallback answers that with index.html at HTTP 200
 * and GLTFLoader reports `SyntaxError: Unexpected token '<'` naming a file
 * nobody touched. Naming the missing asset instead is the whole point.
 */
export function meshUrl(file: string): string {
  const slash = file.indexOf('/');
  const dir = slash === -1 ? '' : file.slice(0, slash);
  const base = slash === -1 ? file : file.slice(slash + 1);
  let href: string;
  switch (dir) {
    case '':
      href = new URL(`../../../art/meshes/${base}`, import.meta.url).href;
      break;
    case 'vehicles':
      href = new URL(`../../../art/meshes/vehicles/${base}`, import.meta.url).href;
      break;
    case 'buildings':
      href = new URL(`../../../art/meshes/buildings/${base}`, import.meta.url).href;
      break;
    case 'civilians':
      href = new URL(`../../../art/meshes/civilians/${base}`, import.meta.url).href;
      break;
    case 'decor':
      href = new URL(`../../../art/meshes/decor/${base}`, import.meta.url).href;
      break;
    case 'vfx':
      href = new URL(`../../../art/meshes/vfx/${base}`, import.meta.url).href;
      break;
    default:
      throw new Error(
        `mesh-catalogue: "${file}" is in a directory meshUrl does not glob — ` +
          `add a case here, or the asset resolves to /undefined and 404s as index.html`
      );
  }
  if (href === '' || href.endsWith('/undefined')) {
    throw new Error(
      `mesh-catalogue: art/meshes/${file} is claimed by the catalogue but not on disk`
    );
  }
  return href;
}

/** Every file path any table above claims. The completeness gate compares
 *  this against what `art/meshes/**` actually holds, in both directions. */
export function claimedMeshFiles(): Set<string> {
  const out = new Set<string>();
  for (const entry of Object.values(RIGGED_UNIT_MESHES)) for (const f of entry.files) out.add(f);
  for (const f of Object.values(VEHICLE_UNIT_MESHES)) out.add(f);
  for (const b of Object.values(BUILDING_MESHES)) {
    out.add(b.idle);
    out.add(b.wreck);
  }
  for (const files of Object.values(DECOR_MESHES)) for (const f of files) out.add(f);
  for (const f of Object.values(VFX_MESHES)) out.add(f);
  return out;
}

/** Whether this unit type has a mesh at all. A type with none keeps its
 *  billboard, which is what makes the mesh path additive. */
export function hasUnitMesh(typeId: string): boolean {
  return typeId in RIGGED_UNIT_MESHES || typeId in VEHICLE_UNIT_MESHES;
}

/**
 * Every unit type id a mission can put on the field.
 *
 * A RECURSIVE WALK of the mission JSON rather than a list of the fields that
 * name a unit (`starting_force[].unit`, `enemy.waves[].units[].type`,
 * `civilians`, a trigger's spawn, ...). That is deliberate, and it is the same
 * argument `vite-plugin-asset-watch.ts` makes for deriving its directories: a
 * hand-kept field list goes stale the first time `mission.schema.json` grows a
 * new place to name a unit, and it goes stale SILENTLY -- the mission would
 * simply field a unit whose mesh was never queued. A walk cannot go stale.
 *
 * Only string VALUES are matched, not dictionary keys. A key walk was written
 * first, on the theory that `civilians` reaches a mission only as the key of
 * its own block -- measured across all fourteen shipped missions, it adds
 * nothing any of them do not already name in a `unit` field, and
 * `mission.schema.json` requires `civilians.groups` to be a list of
 * `placement`s, so it cannot. It was deleted rather than kept as insurance:
 * an unfalsifiable branch reads as a safety check and is not one.
 *
 * Over-collection is the safe direction and is accepted: a mission whose
 * briefing text happened to be exactly `"technical"` would download one mesh
 * it does not need, where a miss would leave a unit drawing a billboard (or,
 * for `civilians`, nothing at all) until the sweep in `main.ts` caught it.
 */
export function missionUnitTypes(mission: unknown, unitIds: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      if (unitIds.has(node)) out.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v);
      }
    }
  };
  walk(mission);
  return out;
}

/**
 * Which decor families a map can place.
 *
 * Mirrors `three/terrain/decor-place.ts`'s `familyFor` and its blocked-tile
 * skip, one branch at a time, as a whole-map question rather than a per-tile
 * one. That IS a second copy of a rule, which this repository has been bitten
 * by before -- so it is pinned rather than trusted:
 * `mesh-catalogue.test.ts` runs the real `decorPlacements` over every shipped
 * map and fails if a family actually placed is missing from this set.
 *
 * The density roll can leave a family with zero placements on a map that
 * offers it, so this is a superset. One decor GLB downloaded and never drawn
 * costs 130 kB; one missing leaves bare ground.
 */
export function decorFamiliesFor(map: ParsedMap): Set<DecorFamilyName> {
  const out = new Set<DecorFamilyName>();
  const { width, height, blocked, cover, decor, boulder } = map;
  for (let t = 0; t < width * height; t++) {
    const d = decor[t];
    // A ridge is the one blocked tile that draws decor; every other blocked
    // tile is a building or fence whose box owns that ground entirely.
    if (blocked[t] !== 0 && d !== DECOR.ridge) continue;
    // Before the boulder branch, mirroring `familyFor`'s own order: a `d`
    // tile sets the boulder mask too, so testing that first would fetch
    // boulder GLBs for a map whose only vehicle obstacle is a ditch and
    // never fetch the ditch at all.
    if (d === DECOR.ditch) {
      out.add('ditch');
      continue;
    }
    if (boulder[t] !== 0) {
      out.add('boulder');
      continue;
    }
    if (d === DECOR.road) continue;
    if (d === DECOR.grove) out.add('tree');
    else if (d === DECOR.knoll) out.add('rock');
    else if (d === DECOR.ridge) out.add('slab');
    else if (cover[t] > 0) out.add('bush');
    else {
      // The fallback branch rolls between the two per tile, so a map with any
      // plain open ground can produce either.
      out.add('grass');
      out.add('sand');
    }
  }
  return out;
}
