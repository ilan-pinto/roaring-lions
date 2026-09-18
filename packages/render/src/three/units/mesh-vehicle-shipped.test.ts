/**
 * Every SHIPPED `art/meshes/vehicles/*.glb`, run through the real
 * `buildVehicleMeshTemplate` / `instantiateVehicleMesh` pair.
 *
 * ## What this file pins, and what changed on 2026-09-15
 *
 * It used to pin the CLIPLESS case: all eleven shipped vehicles declared zero
 * `animations`, and the thing worth proving was that a real GLB with no
 * clips still produced an entity with no mixer, no actions and no latched
 * clip -- the exact object shape it had before the vehicle animation path
 * existed.
 *
 * That is no longer a property of anything that ships. `pnpm wreck:meshes`
 * (`tools/src/meshes/wreck-pass.ts`) now writes a **wreck** into every
 * vehicle GLB: a `death_root` node of static `WRECK_*` children that share
 * their live twins' meshes, plus two clips, `idle` and `wreck`, that scale
 * one set to zero and the other to one. So the assertions below invert --
 * every shipped vehicle now HAS clips and DOES allocate a mixer -- and what
 * this file pins is the asset contract
 * (`docs/superpowers/specs/2026-09-14-vehicle-wreck-design.md` §4.1),
 * parsed out of the shipped bytes the way
 * `mesh-team-death-shipped.test.ts` parses infantry's.
 *
 * The clipless path is still ENGINE behaviour and is still tested -- against
 * the hand-built fixtures in `mesh-vehicle.test.ts` ("allocates NO mixer and
 * NO actions for a clipless GLB", "a clipless entity is inert under
 * applyMeshClip"), which is where it belongs now that no shipped file
 * exercises it. The relationship this file keeps asserting is the one that
 * holds on BOTH sides of that change: **a mixer exists exactly when clips
 * do.**
 *
 * Two things remain provable only against the real files:
 *
 *  1. **A clip that ships must be one the engine can play.** An asset
 *     authored with a clip named `tracks_roll` (or `Armature|move`, the
 *     shape a careless Blender export produces) makes
 *     `buildVehicleMeshTemplate` THROW at load -- which in the browser is a
 *     vehicle type that silently never draws. Catching that here turns a
 *     runtime blank into a CI failure.
 *
 *  2. **The wreck pass actually ran on the shipped bytes.** A re-export that
 *     skipped `pnpm wreck:meshes` produces a file that loads fine and simply
 *     has no death state; `tools/validate_mesh_assets.py`'s
 *     `check_vehicle_wrecks` reads the same contract straight out of the
 *     glTF JSON, and this file reads it back through the loader the game
 *     actually uses -- so a contract that is satisfied on paper but does not
 *     survive `GLTFLoader` (a mesh silently duplicated rather than shared,
 *     say) fails here rather than in a frame.
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
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildVehicleMeshTemplate, instantiateVehicleMesh } from './mesh-vehicle';
import type { VehicleMeshTemplate } from './mesh-vehicle';
import { CLIP_NAMES } from './mesh-anim';
import { transitionIsCut } from './mesh-clip';
import { TEXTURED_VEHICLE_TYPES } from './textured-vehicle';

// See this file's own top comment, 2026-09-07 paragraph.
if (typeof (globalThis as { self?: unknown }).self === 'undefined') {
  (globalThis as { self?: unknown }).self = globalThis;
}

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const VEHICLE_MESHES = `${REPO}art/meshes/vehicles/`;

/** The death root's node name and the wreck children's name prefix --
 *  `DEATH_ROOT` / `WRECK_PREFIX` in `tools/src/meshes/wreck-pass.ts`,
 *  restated here rather than imported: `packages/render` must not reach into
 *  `tools`, and a bytes contract is worth writing down on both sides so a
 *  rename on one of them is a red test rather than a silent miss. */
const DEATH_ROOT = 'death_root';
const WRECK_PREFIX = 'WRECK_';

/** Eleven shipped vehicle GLBs, censused 2026-09-15. A floor rather than an
 *  equality so a twelfth vehicle is not a red test on the day it lands --
 *  but raised from the stale `9` it sat at, because a floor nobody maintains
 *  stops proving the glob found anything. */
const SHIPPED_VEHICLE_COUNT = 11;

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

async function templateFor(id: string): Promise<VehicleMeshTemplate> {
  const gltf = await parseShipped(id);
  // `allowTextured` mirrors `ThreeRenderer.loadVehicleMesh`'s own
  // computation (`TEXTURED_VEHICLE_TYPES.has(id)`) -- seven of the eleven
  // shipped GLBs carry a real base_color material, and without this a real
  // load would throw "ships a texture, but ... is not in
  // TEXTURED_VEHICLE_TYPES" on every one of them.
  return buildVehicleMeshTemplate(gltf, id, TEXTURED_VEHICLE_TYPES.has(id));
}

/** `death_root`, or `null`. Searched among the scene ROOT's direct children,
 *  not by `traverse`: the contract places it as a SIBLING of the live
 *  geometry, and a death root that had drifted under a hull would still be
 *  found by a traverse while being wrong (the hull's own transform would
 *  then apply to it twice). */
function deathRootOf(template: VehicleMeshTemplate): THREE.Object3D | null {
  return template.root.children.find((o) => o.name === DEATH_ROOT) ?? null;
}

/** The top-level LIVE nodes: everything the scene holds except the death
 *  root. These are what the clips scale to zero when a vehicle dies. */
function liveTopLevel(template: VehicleMeshTemplate): THREE.Object3D[] {
  return template.root.children.filter((o) => o.name !== DEATH_ROOT);
}

describe('shipped vehicle GLBs', () => {
  it('finds the whole set on disk -- a glob that matched nothing would pass every case below vacuously', () => {
    expect(shippedVehicleIds().length).toBeGreaterThanOrEqual(SHIPPED_VEHICLE_COUNT);
  });

  it.each(shippedVehicleIds())('%s: every authored clip name is one the engine can play', async (id) => {
    const template = await templateFor(id);
    // Not `expect(...).not.toThrow()`: naming the offender is the whole
    // value here, and `buildVehicleMeshTemplate`'s own throw already does.
    for (const name of template.clips.keys()) {
      expect(CLIP_NAMES).toContain(name);
    }
  });

  it.each(shippedVehicleIds())('%s: carries exactly the clips `idle` and `wreck`', async (id) => {
    const template = await templateFor(id);
    expect([...template.clips.keys()].sort()).toEqual(['idle', 'wreck']);
  });

  it.each(shippedVehicleIds())('%s: a mixer exists exactly when clips do', async (id) => {
    const template = await templateFor(id);
    const entity = instantiateVehicleMesh(template, id);

    expect(entity.mixer === null).toBe(template.clips.size === 0);
    expect(entity.actions.size).toBe(template.clips.size);
    // The relationship above holds vacuously if BOTH sides are empty, which
    // is exactly what a vehicle that missed the wreck pass looks like. Say
    // out loud which side of it the shipped files are on now.
    expect(entity.mixer).not.toBeNull();
    // Never pre-latched: the first `applyMeshClip` of the entity's life has
    // to be able to start something.
    expect(entity.currentClip).toBeNull();
    // The turret/rotor pivots are driven by `updateVehicleMeshes`'s own
    // springs, not by a mixer -- unchanged by any of this, and worth
    // re-asserting beside the mixer now that one exists to confuse them
    // with.
    expect(entity.turretPivot === null).toBe(!template.hasTurretPivot);
    expect(entity.rotorPivot === null).toBe(!template.hasRotorPivot);
  });

  it.each(shippedVehicleIds())('%s: `idle`/`wreck` are held poses, not animated collapses', async (id) => {
    const template = await templateFor(id);
    for (const name of ['idle', 'wreck'] as const) {
      const clip = template.clips.get(name);
      expect(clip).toBeDefined();
      if (!clip) continue;
      // The pass writes two STEP keys at t = 0 and t = 0.1. The ceiling is
      // loose because what matters is "static", not the exact numeral --
      // the same reasoning, and the same 0.2, `mesh-team-death-shipped.
      // test.ts` uses for infantry's `down`/`wreck`.
      expect(clip.duration).toBeLessThan(0.2);

      // Duration alone would pass a two-key clip that still MOVED between
      // its keys. Every sample against the FIRST, not the first against the
      // last: a first-vs-last check passes any CYCLE.
      for (const track of clip.tracks) {
        const values = track.values;
        const stride = values.length / track.times.length;
        for (let s = 1; s < track.times.length; s++) {
          for (let i = 0; i < stride; i++) {
            expect(Math.abs(values[s * stride + i] - values[i])).toBeLessThan(1e-6);
          }
        }
      }
    }
  });

  it.each(shippedVehicleIds())(
    '%s: each clip keys `scale` on every top-level live node and on `death_root`, nothing else',
    async (id) => {
      const template = await templateFor(id);
      const wanted = new Set([...liveTopLevel(template).map((o) => o.name), DEATH_ROOT].map((n) => `${n}.scale`));
      // A vehicle with no live top-level node would make this vacuous.
      expect(wanted.size).toBeGreaterThanOrEqual(2);

      for (const name of ['idle', 'wreck'] as const) {
        const clip = template.clips.get(name);
        expect(clip).toBeDefined();
        if (!clip) continue;
        // Sets, not lengths: a clip that keyed one node twice and another
        // not at all has the right count and the wrong contract.
        expect(new Set(clip.tracks.map((t) => t.name))).toEqual(wanted);
      }
    }
  );

  it.each(shippedVehicleIds())(
    '%s: `idle` shows the live nodes and hides the death root; `wreck` is the reverse',
    async (id) => {
      const template = await templateFor(id);
      const live = new Set(liveTopLevel(template).map((o) => `${o.name}.scale`));
      // This is the clause that keeps a wreck from drawing INSIDE its own
      // live vehicle. `death_root` is authored at scale 1 in the file
      // (nothing else could be, for a node whose children have to survive a
      // `clone`), so the only thing standing between the shipped bytes and
      // a doubled vehicle on screen is `idle`'s frame-0 zero.
      for (const [name, liveValue] of [
        ['idle', 1],
        ['wreck', 0],
      ] as const) {
        const clip = template.clips.get(name);
        expect(clip).toBeDefined();
        if (!clip) continue;
        for (const track of clip.tracks) {
          const want = live.has(track.name) ? liveValue : 1 - liveValue;
          for (const v of track.values) {
            // Reported as an object so a failure names the clip and the
            // track rather than printing `expected 1 to be 0`.
            expect({ clip: name, track: track.name, value: v }).toEqual({
              clip: name,
              track: track.name,
              value: want,
            });
          }
        }
      }
    }
  );

  it.each(shippedVehicleIds())('%s: carries a `death_root` of `WRECK_*` children', async (id) => {
    const template = await templateFor(id);
    const deathRoot = deathRootOf(template);
    expect(deathRoot).not.toBeNull();
    if (!deathRoot) return;
    expect(deathRoot.children.length).toBeGreaterThanOrEqual(1);
    for (const child of deathRoot.children) {
      expect(child.name.startsWith(WRECK_PREFIX)).toBe(true);
      expect((child.userData as { rl_wreck?: unknown }).rl_wreck).toBe(true);
    }
  });

  it.each(shippedVehicleIds())(
    "%s: every wreck child SHARES its live twin's geometry -- the same object, not a copy",
    async (id) => {
      const template = await templateFor(id);
      const deathRoot = deathRootOf(template);
      expect(deathRoot).not.toBeNull();
      if (!deathRoot) return;

      // Every `BufferGeometry` reachable from the live half. `GLTFLoader`
      // gives two nodes that reference one glTF mesh two `Mesh` objects
      // sharing ONE geometry (`GLTFParser._getNodeRef` clones the object;
      // `Mesh.copy` shares the geometry by reference) -- so IDENTITY here is
      // the load-bearing assertion. A structural comparison would pass a
      // duplicated buffer, which is the 1.6-3.4 MiB per file this contract
      // exists to avoid.
      const liveGeometries = new Set<THREE.BufferGeometry>();
      for (const node of liveTopLevel(template)) {
        node.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) liveGeometries.add(mesh.geometry);
        });
      }
      expect(liveGeometries.size).toBeGreaterThan(0);

      let wreckMeshes = 0;
      deathRoot.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        wreckMeshes++;
        // `toBe` against the matching live geometry, so a failure prints
        // which wreck part lost its sharing rather than "false is not true".
        const twin = [...liveGeometries].find((g) => g === mesh.geometry);
        expect(twin).toBe(mesh.geometry);
      });
      expect(wreckMeshes).toBeGreaterThanOrEqual(1);
    }
  );

  it.each(shippedVehicleIds())(
    '%s: one `WRECK_` twin per live mesh node, by name -- a wreck missing a part is a part left standing',
    async (id) => {
      const template = await templateFor(id);
      const deathRoot = deathRootOf(template);
      expect(deathRoot).not.toBeNull();
      if (!deathRoot) return;

      // The case above is a CONTAINMENT test: every wreck mesh it finds must
      // share a live geometry, so a death root that is MISSING a child gives
      // it nothing to look at and it passes. Falsified by a reviewer on
      // 2026-09-15 -- a repacked `scout_shachaf` with one `WRECK_` child
      // deleted satisfied every other case here and
      // `check_vehicle_wrecks`'s clauses 1-3 alike. The pass names each
      // child `WRECK_<live node name>` (`wreck-pass.ts`), so comparing the
      // two SETS by name is what makes a failure say which part is gone
      // rather than only that one is.
      const wanted = new Set<string>();
      for (const node of liveTopLevel(template)) {
        node.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) wanted.add(`${WRECK_PREFIX}${o.name}`);
        });
      }
      expect(wanted.size).toBeGreaterThan(0);

      const got = new Set<string>();
      deathRoot.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) got.add(o.name);
      });
      expect(got).toEqual(wanted);
      // Sets collapse duplicates, so state the count as well: two wreck
      // children sharing one name would otherwise satisfy the line above
      // while one live part went untwinned.
      let wreckMeshCount = 0;
      deathRoot.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) wreckMeshCount++;
      });
      expect(wreckMeshCount).toBe(wanted.size);
    }
  );

  it.each(shippedVehicleIds())('%s: idle -> wreck is a CUT under D2 (both clips key node scale, differently)', async (id) => {
    const template = await templateFor(id);
    const idle = template.clipScale.get('idle');
    const wreck = template.clipScale.get('wreck');
    expect(idle, `${id}: idle signature`).not.toBeNull();
    expect(wreck, `${id}: wreck signature`).not.toBeNull();
    expect(transitionIsCut(idle, wreck)).toBe(true);
  });
});
