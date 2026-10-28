import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  isKitPiece,
  isTexturedBackdropKit,
  KIT_PIECES,
  TEXTURED_BACKDROP_KITS,
} from './textured-backdrop';
import { readBackdropKit } from './backdrop-load';
import { KIT_GLB, readGlb, repoPath } from './backdrop-kit-fixture';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const py = (rel: string): string => readFileSync(repoPath(rel), 'utf8');

describe('the textured-backdrop opt-out is a named list', () => {
  it('covers exactly the Wadi Halam kit', () => {
    // If this grows, the growth should be a decision someone made, not something that arrived with an asset.
    expect([...TEXTURED_BACKDROP_KITS].sort()).toEqual(['wadi_halam_kit']);
    expect(isTexturedBackdropKit('wadi_halam_kit')).toBe(true);
    expect(isTexturedBackdropKit('some_other_kit')).toBe(false);
  });

  // Drift between the two sides is the failure this exists to stop: listed here but not there and the gate
  // rejects a GLB the runtime requires; listed there but not here and the runtime draws an atlas the gate waved
  // past without ever checking it carries one.
  it('agrees with TEXTURED_BACKDROP_EXEMPT in tools/validate_mesh_assets.py', () => {
    const block = /TEXTURED_BACKDROP_EXEMPT\s*=\s*\{([^}]*)\}/.exec(py('tools/validate_mesh_assets.py'));
    expect(block, 'TEXTURED_BACKDROP_EXEMPT not found in tools/validate_mesh_assets.py').not.toBeNull();
    const ids = [...(block as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(ids).toEqual([...TEXTURED_BACKDROP_KITS].sort());
  });

  it('agrees with BACKDROP_PIECES in tools/validate_mesh_assets.py, caps included', () => {
    const block = /BACKDROP_PIECES\s*=\s*\{([^}]*)\}/.exec(py('tools/validate_mesh_assets.py'));
    expect(block, 'BACKDROP_PIECES not found in tools/validate_mesh_assets.py').not.toBeNull();
    const rows = [...(block as RegExpExecArray)[1].matchAll(/"(bd_[a-z0-9_]+)":\s*(\d+)/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(Object.fromEntries(rows)).toEqual(KIT_PIECES);
    expect(rows.length).toBe(Object.keys(KIT_PIECES).length);
  });

  it("agrees with the pieces' own caps in tools/backdrop/pieces.py (which export_kit.py enforces)", () => {
    const src = py('tools/backdrop/pieces.py');
    const rows = [...src.matchAll(/Piece\("(bd_[a-z0-9_]+)", "[a-z]+", (\d+),/g)].map((m) => [m[1], Number(m[2])] as const);
    // the three walls are built by one constructor with the variant appended: `Piece("bd_wall_far_" + variant, "far", 8000, ...`
    const wall = /Piece\("bd_wall_far_" \+ variant, "far", (\d+),/.exec(src);
    expect(wall, 'wall constructor not found in pieces.py').not.toBeNull();
    for (const v of ['a', 'b', 'c']) rows.push([`bd_wall_far_${v}`, Number((wall as RegExpExecArray)[1])]);
    const fromPy = Object.fromEntries(rows);
    const olive = /OLIVE_CAP = (\d+)/.exec(py('tools/backdrop/export_kit.py'));
    expect(olive, 'OLIVE_CAP not found in export_kit.py').not.toBeNull();
    fromPy.bd_olive = Number((olive as RegExpExecArray)[1]);
    const house = /HOUSE_CAP = (\d+)/.exec(py('tools/backdrop/export_kit.py'));
    expect(house, 'HOUSE_CAP not found in export_kit.py').not.toBeNull();
    fromPy.bd_house = Number((house as RegExpExecArray)[1]);
    expect(fromPy).toEqual(KIT_PIECES);
  });
});

describe('the shipped kit GLB holds the contract', () => {
  const { json } = readGlb(KIT_GLB);

  it('ships exactly one material, one image and one texture', () => {
    expect([json.materials?.length, json.images?.length, json.textures?.length]).toEqual([1, 1, 1]);
  });

  it('names every piece of the closed list exactly once, each rl_textured, and every placed piece an LOD1 twin', () => {
    const nodes = json.nodes.filter((n) => n.mesh !== undefined);
    const main = nodes.filter((n) => n.extras?.rl_lod === undefined);
    const twins = nodes.filter((n) => n.extras?.rl_lod === 1);
    expect(main.map((n) => n.extras?.rl_piece as string).sort()).toEqual(Object.keys(KIT_PIECES).sort());
    expect(twins.map((n) => n.extras?.rl_piece as string).sort()).toEqual(Object.keys(KIT_PIECES).filter((p) => p !== 'bd_olive' && p !== 'bd_house').sort());
    for (const n of nodes) expect(n.extras?.rl_textured, n.name).toBe(true);
  });

  it('keeps every LOD1 twin to at most 40% of its main mesh', () => {
    const tris = (n: (typeof json.nodes)[number]): number => json.accessors[json.meshes[n.mesh as number].primitives[0].indices as number].count / 3;
    for (const n of json.nodes) {
      if (n.extras?.rl_lod !== 1) continue;
      const main = json.nodes.find((m) => m.extras?.rl_piece === n.extras?.rl_piece && m.extras?.rl_lod === undefined);
      expect(tris(n), n.extras?.rl_piece as string).toBeLessThanOrEqual(0.4 * tris(main as typeof n));
    }
  });

  it('keeps every piece under its triangle cap', () => {
    for (const n of json.nodes) {
      if (n.mesh === undefined || n.extras?.rl_lod !== undefined) continue;
      const name = n.extras?.rl_piece as string;
      const prim = json.meshes[n.mesh].primitives[0];
      const tris = json.accessors[prim.indices as number].count / 3;
      expect(tris, name).toBeLessThanOrEqual(KIT_PIECES[name]);
    }
  });

  it('knows its own pieces', () => {
    expect(isKitPiece('bd_terrace_a')).toBe(true);
    expect(isKitPiece('bd_toString')).toBe(false);
    expect(isKitPiece('constructor')).toBe(false);
  });
});

describe('readBackdropKit holds both locks at load', () => {
  /** The real GLB, parsed with a placeholder atlas (node has no image decode). */
  async function scene(): Promise<THREE.Group> {
    const buf = readFileSync(repoPath(KIT_GLB));
    const loader = new GLTFLoader();
    loader.register(() => ({
      name: 'rl_test_atlas',
      loadTexture: () => Promise.resolve(new THREE.Texture()),
    }));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return (await loader.parseAsync(ab, '')).scene;
  }

  it('reads all twenty pieces, the shared atlas and the olive', async () => {
    const kit = readBackdropKit(await scene(), 'wadi_halam_kit');
    expect([...kit.source.pieces.keys()].sort()).toEqual(Object.keys(KIT_PIECES).sort());
    expect(kit.map).toBeInstanceOf(THREE.Texture);
    expect(kit.olive).not.toBeNull();
    // tiles, not metres: a wall is about 12 tiles tall, not 37
    const wall = kit.source.pieces.get('bd_wall_far_a');
    let top = 0;
    for (let k = 1; k < (wall?.positions.length ?? 0); k += 3) top = Math.max(top, wall?.positions[k] ?? 0);
    expect(top).toBeGreaterThan(11);
    expect(top).toBeLessThan(14);
    expect(kit.source.pieces.get('bd_terrace_a')?.olives.length).toBe(28);
    // every placed piece carries its LOD1 twin, in tiles too, with fewer triangles over the same footprint
    for (const [name, p] of kit.source.pieces) {
      if (name === 'bd_olive' || name === 'bd_house') expect(p.lod1, name).toBeUndefined();
      else expect((p.lod1?.index.length ?? Infinity) / p.index.length, name).toBeLessThan(0.4);
    }
    expect(kit.source.pieces.get('bd_terrace_a')?.anchors.map((a) => a.name)).toEqual(['anchor_house_0', 'anchor_house_1']);
  });

  it('refuses a kit id outside the list', async () => {
    expect(() => readBackdropKit(new THREE.Group(), 'some_other_kit')).toThrow(/TEXTURED_BACKDROP_KITS/);
  });

  it('refuses a node that does not declare rl_textured', async () => {
    const s = await scene();
    let hit = false;
    s.traverse((o) => {
      if (!hit && (o as THREE.Mesh).isMesh) {
        (o.userData as { rl_textured?: boolean }).rl_textured = false;
        hit = true;
      }
    });
    expect(() => readBackdropKit(s, 'wadi_halam_kit')).toThrow(/rl_textured/);
  });

  it('refuses a piece outside the closed list', async () => {
    const s = await scene();
    let hit = false;
    s.traverse((o) => {
      if (!hit && (o as THREE.Mesh).isMesh) {
        (o.userData as { rl_piece?: string }).rl_piece = 'bd_made_up';
        hit = true;
      }
    });
    expect(() => readBackdropKit(s, 'wadi_halam_kit')).toThrow(/closed list/);
  });

  it('refuses a piece with no LOD1 twin, and an LOD1 with no main mesh', async () => {
    const lone = await scene();
    let victim: THREE.Object3D | null = null;
    lone.traverse((o) => {
      if (victim === null && (o as THREE.Mesh).isMesh && o.userData.rl_piece === 'bd_taper' && o.userData.rl_lod === 1) victim = o;
    });
    (victim as unknown as THREE.Object3D).removeFromParent();
    expect(() => readBackdropKit(lone, 'wadi_halam_kit')).toThrow(/no LOD1 for piece.*bd_taper/);

    const orphan = await scene();
    const main: THREE.Object3D[] = [];
    orphan.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.rl_piece === 'bd_taper' && o.userData.rl_lod === undefined) main.push(o);
    });
    for (const m of main) m.removeFromParent();
    expect(() => readBackdropKit(orphan, 'wadi_halam_kit')).toThrow(/missing piece.*bd_taper/);
  });

  it('refuses a missing piece, a duplicated piece and a texture-less piece', async () => {
    const gone = await scene();
    let victim: THREE.Object3D | null = null;
    gone.traverse((o) => {
      if (victim === null && (o as THREE.Mesh).isMesh && o.userData.rl_piece === 'bd_scree_c') victim = o;
    });
    (victim as unknown as THREE.Object3D).removeFromParent();
    expect(() => readBackdropKit(gone, 'wadi_halam_kit')).toThrow(/missing piece.*bd_scree_c/);

    const twice = await scene();
    let seen = 0;
    twice.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.rl_lod === undefined && seen++ < 2) o.userData.rl_piece = 'bd_crest_a';
    });
    expect(() => readBackdropKit(twice, 'wadi_halam_kit')).toThrow(/appears twice/);

    const bare = await scene();
    bare.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.rl_piece === 'bd_taper') (m.material as THREE.MeshStandardMaterial).map = null;
    });
    expect(() => readBackdropKit(bare, 'wadi_halam_kit')).toThrow(/base colour map/);
  });

  it('refuses a second atlas: the kit ships exactly one', async () => {
    const two = await scene();
    two.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.userData.rl_piece === 'bd_taper') {
        // the GLB's one material is shared by every node: give this node its own, with its own atlas
        const own = (m.material as THREE.MeshStandardMaterial).clone();
        own.map = new THREE.Texture();
        m.material = own;
      }
    });
    expect(() => readBackdropKit(two, 'wadi_halam_kit')).toThrow(/second atlas/);
  });
});
