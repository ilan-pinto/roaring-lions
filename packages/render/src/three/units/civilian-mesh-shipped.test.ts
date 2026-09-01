/**
 * The four SHIPPED `art/meshes/civilians/*.glb`, run through the real
 * `buildMeshUnitTemplate` / `instantiateMeshUnit` pair.
 *
 * `mesh-vehicle-shipped.test.ts` is the precedent and the reasoning is the
 * same: a mesh asset can satisfy every gate a fixture can express and still
 * be wrong in ways only the bytes on disk can show. What this file adds over
 * that one is the half `pnpm validate:meshes` cannot check, because that gate
 * renders a mesh and looks at pixels:
 *
 *  1. **The contract, read the way the ENGINE reads it.** Zero materials,
 *     zero images, zero textures; every `extras.rl_role` inside the closed
 *     set; every clip name one `isMeshClipName` accepts. `buildMeshUnitTemplate`
 *     throws on any of those, and in the browser a throw at load is a unit
 *     type that silently never draws.
 *
 *  2. **What a civilian must NOT carry.** GH-149: "Civilians must not read as
 *     fighters. The ROE system deducts for civilian casualties, so the player
 *     has to tell them apart at gameplay zoom: no webbing, no pouches, no
 *     weapon." `webbing`, `weapon` and `charge` are all legal mesh roles, so
 *     nothing in the contract or the render gate would object to a civilian
 *     wearing one. This file is the only thing that would.
 *
 *  3. **`down` is a HELD pose, not the crawl cycle it came from.** The
 *     supplied `Crawl_and_Look_Back` carries about four metres of root
 *     motion. `resolveClip` returns `down` for a PINNED unit and
 *     `applyMeshClip` loops it, so shipping the cycle would drag a stationary
 *     civilian four metres and snap it back forever; `mesh-death.ts` plays it
 *     with `{ once: true }`, so a killed one would crawl away from its own
 *     corpse. `tools/import_meshy_civilians.py` holds one frame instead, and
 *     the build gate that enforces it only runs when someone rebuilds the
 *     asset. This asserts it about the bytes that ship.
 *
 * `GLTFLoader.parseAsync` on a `Buffer` needs no network and no
 * `WebGLRenderer` -- the same headless property `mesh-unit.ts`'s own top
 * comment records.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildMeshUnitTemplate, instantiateMeshUnit } from './mesh-unit';
import { CLIP_NAMES } from './mesh-anim';
import { MESH_ROLES, isMeshRole } from './mesh-role';

const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const CIVILIAN_MESHES = `${REPO}art/meshes/civilians/`;

/** The roles a civilian may never carry. Mirrors `FORBIDDEN_ROLES` in
 *  `tools/civilian_roles.py`, which enforces the same rule on the build side;
 *  kept by hand across the language boundary the same way
 *  `validate_mesh_assets.py`'s `DECOR_ROLES` mirrors `decor-role.ts`. */
const FORBIDDEN_CIVILIAN_ROLES = ['webbing', 'weapon', 'charge'] as const;

/** The four figures, by file basename. */
function shippedFigures(): string[] {
  return readdirSync(CIVILIAN_MESHES)
    .filter((f) => f.endsWith('.glb'))
    .map((f) => f.slice(0, -'.glb'.length))
    .sort();
}

async function parseShipped(figure: string) {
  const bytes = readFileSync(`${CIVILIAN_MESHES}${figure}.glb`);
  // `Buffer` is a `Uint8Array` view over a pool, so hand `parseAsync` a
  // standalone `ArrayBuffer` rather than the whole pool behind it.
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  return new GLTFLoader().parseAsync(ab, '');
}

/** Every `rl_role` (falling back to the node name, exactly as
 *  `buildMeshUnitTemplate` does) present in a parsed GLB. */
function rolesIn(gltf: Awaited<ReturnType<typeof parseShipped>>): string[] {
  const found = new Set<string>();
  gltf.scene.traverse((o) => {
    const mesh = o as { isMesh?: boolean; name: string; userData: { rl_role?: unknown } };
    if (!mesh.isMesh) return;
    const extras = mesh.userData.rl_role;
    found.add(typeof extras === 'string' && extras.length > 0 ? extras : mesh.name);
  });
  return [...found].sort();
}

describe('shipped civilian GLBs', () => {
  it('finds all four on disk -- a glob that matched nothing would pass every case below vacuously', () => {
    expect(shippedFigures()).toEqual([
      'civilian_child',
      'civilian_woman',
      'farm_worker',
      'office_worker',
    ]);
  });

  it.each(shippedFigures())(
    '%s: loads through the real template builder, on the civilian side',
    async (figure) => {
      const gltf = await parseShipped(figure);
      // Not `.not.toThrow()`: `buildMeshUnitTemplate` names the offending role
      // or clip in its own message, and losing that is losing the whole value.
      const template = buildMeshUnitTemplate(gltf, 'civilian');
      expect(template.materials.length).toBeGreaterThan(0);
      expect(template.geometries.length).toBe(template.materials.length);
    }
  );

  it.each(shippedFigures())('%s: carries zero materials, images and textures', async (figure) => {
    const gltf = await parseShipped(figure);
    // The parser hands back the raw glTF JSON, which is where the contract's
    // "zero of each" is actually observable -- a `THREE.Mesh` always has SOME
    // material once three.js has finished with it.
    const json = (gltf.parser as { json: Record<string, unknown[]> }).json;
    expect(json.materials ?? []).toHaveLength(0);
    expect(json.images ?? []).toHaveLength(0);
    expect(json.textures ?? []).toHaveLength(0);
  });

  it.each(shippedFigures())('%s: every role is in the closed set', async (figure) => {
    const roles = rolesIn(await parseShipped(figure));
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(isMeshRole(role), `${figure} carries rl_role ${role}`).toBe(true);
    }
  });

  it.each(shippedFigures())(
    '%s: carries no webbing, no weapon and no charge -- a civilian must not read as a fighter (GH-149)',
    async (figure) => {
      const roles = rolesIn(await parseShipped(figure));
      for (const forbidden of FORBIDDEN_CIVILIAN_ROLES) {
        expect(MESH_ROLES, 'the guard is only meaningful while these are legal roles').toContain(
          forbidden
        );
        expect(roles).not.toContain(forbidden);
      }
    }
  );

  it('the farm worker carries his tool as wood and metal, never as a weapon', async () => {
    const roles = rolesIn(await parseShipped('farm_worker'));
    expect(roles).toContain('wood');
    expect(roles).toContain('metal');
    expect(roles).not.toContain('weapon');
  });

  it.each(shippedFigures())(
    '%s: authors exactly idle, move and down -- and every name is one the engine can play',
    async (figure) => {
      const template = buildMeshUnitTemplate(await parseShipped(figure), 'civilian');
      for (const name of template.clips.keys()) expect(CLIP_NAMES).toContain(name);
      // `fire`, `work` and `wreck` are deliberately unauthored: a civilian
      // neither shoots nor digs, and `meshClipOrFallback` degrades both to
      // `idle`. Asserted rather than left implicit so ADDING one is a
      // decision someone makes on purpose.
      expect([...template.clips.keys()].sort()).toEqual(['down', 'idle', 'move']);
    }
  );

  it.each(shippedFigures())(
    '%s: `down` is a held pose, not the crawl cycle it was cut from',
    async (figure) => {
      const template = buildMeshUnitTemplate(await parseShipped(figure), 'civilian');
      const down = template.clips.get('down');
      expect(down).toBeDefined();
      // Two keyframes at 30 fps -- `_VIS_FRAMES`-style, so the clip is
      // well-formed rather than degenerate, and under a tenth of a second
      // either way. The SOURCE crawl is 6.93 s; anything near that length
      // here means the whole cycle shipped.
      expect(down!.duration).toBeLessThan(0.2);

      // And the pose really is held: every track's samples are constant.
      // Duration alone would pass a two-frame clip that still moved.
      for (const track of down!.tracks) {
        const values = track.values;
        const stride = values.length / track.times.length;
        for (let i = 0; i < stride; i++) {
          expect(
            Math.abs(values[i] - values[values.length - stride + i]),
            `${figure} down: ${track.name} component ${i} moves`
          ).toBeLessThan(1e-6);
        }
      }
    }
  );

  it.each(shippedFigures())('%s: clones get their own skeleton', async (figure) => {
    const template = buildMeshUnitTemplate(await parseShipped(figure), 'civilian');
    const a = instantiateMeshUnit(template, 'civilians');
    const b = instantiateMeshUnit(template, 'civilians');
    expect(a.root).not.toBe(b.root);
    expect(a.actions.size).toBe(template.clips.size);
    expect(a.currentClip).toBeNull();
  });

  it('the child was supplied no idle and no crawl, and ships with both anyway', async () => {
    // GH-149's own open question. The answer is a rotation retarget from the
    // woman's rig (`tools/civilian_retarget.py`, measured against ground
    // truth at 2.31 deg mean), and what matters at this boundary is only
    // that the child is not the odd one out at runtime: a civilian with no
    // `idle` falls back to nothing at all through `applyMeshClip`'s `!next`
    // guard, and one with no `down` stands upright while pinned and while
    // dead.
    const child = buildMeshUnitTemplate(await parseShipped('civilian_child'), 'civilian');
    const woman = buildMeshUnitTemplate(await parseShipped('civilian_woman'), 'civilian');
    expect([...child.clips.keys()].sort()).toEqual([...woman.clips.keys()].sort());
    // The retarget replays the donor's own timeline, so the borrowed idle is
    // the same length as the idle it came from.
    expect(child.clips.get('idle')!.duration).toBeCloseTo(
      woman.clips.get('idle')!.duration,
      2
    );
  });
});
