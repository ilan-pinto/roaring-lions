/**
 * Every SHIPPED `art/meshes/vehicles/*.glb`, run through the real
 * `buildVehicleMeshTemplate` / `instantiateVehicleMesh` pair.
 *
 * The vehicle animation path was added to an engine whose nine shipped
 * vehicle assets all declare zero `animations` and zero skins. Two things
 * therefore need proving, and neither is provable against a fixture:
 *
 *  1. **The clipless path did not move.** A real GLB with no clips must
 *     still produce an entity with no mixer, no actions, and no latched
 *     clip -- the exact object shape it produced before any of this
 *     existed. `mesh-vehicle.test.ts` proves that for a hand-built fixture;
 *     this file proves it for the files that actually ship.
 *
 *  2. **A clip that ships must be one the engine can play.** An asset
 *     authored with a clip named `tracks_roll` (or `Armature|move`, the
 *     shape a careless Blender export produces) makes
 *     `buildVehicleMeshTemplate` THROW at load -- which in the browser is a
 *     vehicle type that silently never draws. Catching that here turns a
 *     runtime blank into a CI failure.
 *
 * Written as an invariant rather than as "no vehicle has clips", on
 * purpose: the moment the asset side authors a real clip this file must
 * keep passing, not go red for the wrong reason. What it pins is the
 * RELATIONSHIP -- clips present iff mixer allocated -- which holds on both
 * sides of that change.
 *
 * `GLTFLoader.parseAsync` on a `Buffer` needs no network and no
 * `WebGLRenderer`, the same headless property `mesh-unit.ts`'s own top
 * comment records; `tools/src/mesh_gait.test.ts` is the precedent for a
 * test reading the shipped meshes off disk.
 *
 * 2026-09-07: this file's own `environment: 'node'` (`vitest.config.ts`'s
 * root default -- deliberately not jsdom, per the paragraph above) stopped
 * being enough the moment six shipped GLBs started carrying a real
 * `base_color` image. `GLTFParser.loadImageSource` reaches for the global
 * `self` to decide how to decode a texture's bytes, which plain Node does
 * not define -- `ReferenceError: self is not defined`, thrown from deep
 * inside `assignTexture`/`loadMaterial`, on every textured vehicle. The
 * fix is NOT to switch this file to jsdom (that would re-add the network/
 * WebGL weight this test exists to avoid); `self = globalThis` is enough
 * for `loadImageSource` to pick a code path, and the path it picks then
 * fails to actually decode (no `Image`/`createImageBitmap` in Node either)
 * -- caught by `GLTFLoader`'s own error handler and logged as a console
 * warning, not thrown, because texture PIXELS are not what this file
 * checks. Materials, clips and pivots are still built correctly either way.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildVehicleMeshTemplate, instantiateVehicleMesh } from './mesh-vehicle';
import { CLIP_NAMES } from './mesh-anim';
import { TEXTURED_VEHICLE_TYPES } from './textured-vehicle';

// See this file's own top comment, 2026-09-07 paragraph.
if (typeof (globalThis as { self?: unknown }).self === 'undefined') {
  (globalThis as { self?: unknown }).self = globalThis;
}

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const VEHICLE_MESHES = `${REPO}art/meshes/vehicles/`;

/** Every shipped vehicle GLB, by unit type id (the file basename IS the id
 *  `vehicle-mesh-role.ts`'s ramp table is keyed by -- `ThreeRenderer.
 *  loadVehicleMesh`'s own doc comment on that convention). */
function shippedVehicleIds(): string[] {
  return readdirSync(VEHICLE_MESHES)
    .filter((f) => f.endsWith('.glb'))
    .map((f) => f.slice(0, -'.glb'.length))
    .sort();
}

async function parseShipped(id: string) {
  const bytes = readFileSync(`${VEHICLE_MESHES}${id}.glb`);
  // `Buffer` is a `Uint8Array` view over a pool, so hand `parseAsync` a
  // standalone `ArrayBuffer` rather than the whole pool behind it.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new GLTFLoader().parseAsync(ab, '');
}

describe('shipped vehicle GLBs', () => {
  it('finds the whole set on disk -- a glob that matched nothing would pass every case below vacuously', () => {
    expect(shippedVehicleIds().length).toBeGreaterThanOrEqual(9);
  });

  it.each(shippedVehicleIds())('%s: every authored clip name is one the engine can play', async (id) => {
    const gltf = await parseShipped(id);
    // Not `expect(...).not.toThrow()`: naming the offender is the whole
    // value here, and `buildVehicleMeshTemplate`'s own throw already does.
    // `allowTextured` mirrors `ThreeRenderer.loadVehicleMesh`'s own
    // computation (`TEXTURED_VEHICLE_TYPES.has(id)`) -- six of nine-plus
    // shipped GLBs now carry a real base_color material (2026-09-07), and
    // without this a real load would throw "ships a texture, but ... is not
    // in TEXTURED_VEHICLE_TYPES" on every one of them.
    const template = buildVehicleMeshTemplate(gltf, id, TEXTURED_VEHICLE_TYPES.has(id));
    for (const name of template.clips.keys()) {
      expect(CLIP_NAMES).toContain(name);
    }
  });

  it.each(shippedVehicleIds())('%s: a mixer exists exactly when clips do', async (id) => {
    const gltf = await parseShipped(id);
    const template = buildVehicleMeshTemplate(gltf, id, TEXTURED_VEHICLE_TYPES.has(id));
    const entity = instantiateVehicleMesh(template, id);

    expect(entity.mixer === null).toBe(template.clips.size === 0);
    expect(entity.actions.size).toBe(template.clips.size);
    // Never pre-latched: the first `applyMeshClip` of the entity's life has
    // to be able to start something, clipless or not.
    expect(entity.currentClip).toBeNull();
  });

  it.each(shippedVehicleIds())(
    '%s: with no clips authored, the clone carries no animation machinery at all',
    async (id) => {
      const gltf = await parseShipped(id);
      const template = buildVehicleMeshTemplate(gltf, id, TEXTURED_VEHICLE_TYPES.has(id));
      if (template.clips.size > 0) return; // an authored clip is not this case
      const entity = instantiateVehicleMesh(template, id);
      expect(entity.mixer).toBeNull();
      expect(entity.actions.size).toBe(0);
      // The turret/rotor pivots are the ONLY things this path animates, and
      // they are driven by `updateVehicleMeshes`'s own springs, not by a
      // mixer -- unchanged by any of this.
      expect(entity.turretPivot === null).toBe(!template.hasTurretPivot);
      expect(entity.rotorPivot === null).toBe(!template.hasRotorPivot);
    }
  );
});
