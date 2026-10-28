/**
 * Reading a loaded backdrop kit GLB into what `buildBackdrop` places.
 *
 * The GLB is one scene of 37 mesh nodes -- 19 pieces and the 18 LOD1 twins
 * of the placed ones (`extras.rl_lod` 1) -- each named by `extras.rl_piece`,
 * all sharing one material and one atlas. Nothing is looked
 * up by node order or index (a re-export reshuffles it): every piece is found by
 * `rl_piece`, the way `campaign/world-scene.ts` finds a region by `rl_region`.
 *
 * ## Both locks, checked at load
 *
 * `rl_textured` says a node ships a bake; `TEXTURED_BACKDROP_KITS` says whether
 * this kit may. A kit outside the list, a node with no flag, a piece outside
 * `KIT_PIECES`, a second atlas or a missing piece all THROW, and the renderer
 * turns the throw into a `console.error` naming the file and today's skirt
 * (`ThreeRenderer.loadBackdropKit`). The mirror-image checks on the bytes are
 * `check_backdrop_meshes` in `tools/validate_mesh_assets.py`.
 *
 * Positions arrive in metres and are scaled by `MESH_SCALE` here, so the kit is
 * in tiles from then on. Anchors and olives travel as JSON strings in node
 * extras, in the same GLB-local metres (x, up, z).
 */
import * as THREE from 'three';
import { MESH_SCALE } from '../units/mesh-anim';
import { prepareTexturedMap } from '../world-materials';
import type { KitGeometry, KitPieceSource, KitSource } from './backdrop-kit';
import type { LoadedBackdropKit } from './backdrop';
import { KIT_PIECES, OLIVE_PIECE, isKitPiece, isTexturedBackdropKit } from './textured-backdrop';

interface PieceExtras {
  rl_textured?: unknown;
  rl_piece?: unknown;
  rl_lod?: unknown;
  rl_anchors?: unknown;
  rl_olives?: unknown;
}

function floats(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): Float32Array {
  const out = new Float32Array(a.count * size);
  for (let i = 0; i < a.count; i++) {
    out[i * size] = a.getX(i);
    out[i * size + 1] = a.getY(i);
    if (size > 2) out[i * size + 2] = a.getZ(i);
  }
  return out;
}

const scale3 = (p: readonly number[]): [number, number, number] => [p[0] * MESH_SCALE, p[1] * MESH_SCALE, p[2] * MESH_SCALE];

/**
 * @param root the `gltf.scene` from the shared loader
 * @param kitId the map's `backdrop.kit`
 */
export function readBackdropKit(root: THREE.Object3D, kitId: string): LoadedBackdropKit {
  try {
    return readBackdropKitUnguarded(root, kitId);
  } catch (err) {
    freeLoaderOwned(root);
    throw err;
  }
}

/** The loader's own geometries and materials (the atlas lives on only in a kit that was read whole). */
function freeLoaderOwned(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
  });
}

function readBackdropKitUnguarded(root: THREE.Object3D, kitId: string): LoadedBackdropKit {
  if (!isTexturedBackdropKit(kitId)) {
    throw new Error(
      `backdrop kit "${kitId}" is not in TEXTURED_BACKDROP_KITS -- add it there (and to TEXTURED_BACKDROP_EXEMPT in tools/validate_mesh_assets.py) or drop the kit`
    );
  }
  root.updateMatrixWorld(true);
  const pieces = new Map<string, KitPieceSource>();
  const lod1 = new Map<string, KitGeometry>();
  let map: THREE.Texture | null = null;
  let olive: THREE.BufferGeometry | null = null;
  const toTiles = new THREE.Matrix4().makeScale(MESH_SCALE, MESH_SCALE, MESH_SCALE);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const ex = mesh.userData as PieceExtras;
    const name = typeof ex.rl_piece === 'string' ? ex.rl_piece : '(no rl_piece)';
    if (ex.rl_textured !== true) throw new Error(`backdrop kit "${kitId}": node "${mesh.name}" does not declare rl_textured`);
    if (!isKitPiece(name)) throw new Error(`backdrop kit "${kitId}": node "${mesh.name}" names piece "${name}", outside the closed list`);
    const isLod1 = ex.rl_lod === 1;
    if (ex.rl_lod !== undefined && !isLod1) throw new Error(`backdrop kit "${kitId}": node "${mesh.name}" has rl_lod ${String(ex.rl_lod)}, only 1 exists`);
    if ((isLod1 ? lod1 : pieces).has(name)) throw new Error(`backdrop kit "${kitId}": piece "${name}" appears twice`);
    const own = (mesh.material as THREE.MeshStandardMaterial | undefined)?.map ?? null;
    if (own === null) throw new Error(`backdrop kit "${kitId}": piece "${name}" carries no base colour map`);
    if (map === null) map = own;
    else if (map !== own) throw new Error(`backdrop kit "${kitId}": piece "${name}" has a second atlas (the kit ships exactly one)`);
    const g = mesh.geometry.clone().applyMatrix4(toTiles.clone().multiply(mesh.matrixWorld));
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const idx = g.getIndex();
    if (!pos || !nor || !uv || !idx) throw new Error(`backdrop kit "${kitId}": piece "${name}" lacks position, normal, uv or index`);
    if (isLod1) {
      lod1.set(name, { positions: floats(pos, 3), normals: floats(nor, 3), uvs: floats(uv, 2), index: idx.array as Uint16Array | Uint32Array });
      g.dispose();
      return;
    }
    const anchors = typeof ex.rl_anchors === 'string' ? (JSON.parse(ex.rl_anchors) as { name: string; p: number[] }[]) : [];
    const olives = typeof ex.rl_olives === 'string' ? (JSON.parse(ex.rl_olives) as number[][]) : [];
    const src: KitPieceSource = {
      name,
      positions: floats(pos, 3),
      normals: floats(nor, 3),
      uvs: floats(uv, 2),
      index: idx.array as Uint16Array | Uint32Array,
      anchors: anchors.map((a) => ({ name: a.name, p: scale3(a.p) })),
      olives: olives.map(scale3),
    };
    if (name === OLIVE_PIECE) olive = g;
    else g.dispose();
    pieces.set(name, src);
  });
  const missing = Object.keys(KIT_PIECES).filter((p) => !pieces.has(p));
  if (missing.length > 0) throw new Error(`backdrop kit "${kitId}" is missing piece(s): ${missing.join(', ')}`);
  // Every placed piece ships its LOD1 twin (the minimum-zoom mesh); the olive has none.
  const noLod = [...pieces.keys()].filter((p) => p !== OLIVE_PIECE && !lod1.has(p));
  if (noLod.length > 0) throw new Error(`backdrop kit "${kitId}" has no LOD1 for piece(s): ${noLod.join(', ')}`);
  const stray = [...lod1.keys()].filter((p) => !pieces.has(p));
  if (stray.length > 0) throw new Error(`backdrop kit "${kitId}" has an LOD1 with no LOD0: ${stray.join(', ')}`);
  for (const [name, twin] of lod1) pieces.set(name, { ...(pieces.get(name) as KitPieceSource), lod1: twin });
  if (map === null) throw new Error(`backdrop kit "${kitId}": no mesh nodes at all`);

  // The loader's own geometries and materials are done with; the atlas lives on, shared by the kit mesh and the olives.
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) m.dispose();
  });
  const source: KitSource = { pieces };
  return { source, map: prepareTexturedMap(map), olive };
}
