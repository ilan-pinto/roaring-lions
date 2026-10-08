// What the scene graph holds, in bytes, grouped by who owns it -- the
// attribution half of `pnpm perf:memory` (tools/src/perf/memory.ts, GH-469).
//
// The instrument's GL ledger counts every byte the page asks WebGL for, but
// a GL texture or buffer has no name. This walks the three.js objects the
// renderer owns -- the scene, plus the mesh TEMPLATES it clones units from,
// which are not in the scene -- and sums, per labelled group:
//
//   * geometry bytes: every attribute array (interleaved buffers once), the
//     index, morph targets, an InstancedMesh's instance arrays. These arrays
//     are what is uploaded, AND three keeps them in the JS heap afterwards,
//     so the same number is a GPU cost and a JS (ArrayBuffer) cost;
//   * texture bytes: width x height x depth x bytes-per-texel x (4/3 when a
//     mip chain is generated), from the texture's own format and type -- an
//     ESTIMATE of the GPU copy, labelled as one.
//
// Each geometry and texture (by its `Source`, which is what three uploads)
// is counted ONCE, in the first group that reaches it (groups are walked in the order given), so the groups sum to a total
// with no double counting and a template's geometry shows up under its
// template only when no live clone in the scene already shares it.
//
// Debug only: it allocates its answer, and nothing in `frame()` calls it.
import * as THREE from 'three';

export interface InventoryGroup {
  label: string;
  objects: number;
  geometries: number;
  geometryBytes: number;
  textures: number;
  textureBytes: number;
  /** Largest textures in this group: `[name, w, h, bytes]`. */
  topTextures: [string, number, number, number][];
}

export interface MemoryInventory {
  groups: InventoryGroup[];
  /** three's own counters (`renderer.info`), which are counts, not bytes. */
  info: { geometries: number; textures: number; programs: number } | null;
}

const CHANNELS: Record<number, number> = {
  [THREE.RGBAFormat]: 4,
  [THREE.RGBAIntegerFormat]: 4,
  [THREE.RGFormat]: 2,
  [THREE.RGIntegerFormat]: 2,
  [THREE.RedFormat]: 1,
  [THREE.RedIntegerFormat]: 1,
  [THREE.AlphaFormat]: 1,
  [THREE.LuminanceFormat]: 1,
  [THREE.LuminanceAlphaFormat]: 2,
  [THREE.DepthFormat]: 1,
  [THREE.DepthStencilFormat]: 1,
};

const TYPE_BYTES: Record<number, number> = {
  [THREE.UnsignedByteType]: 1,
  [THREE.ByteType]: 1,
  [THREE.ShortType]: 2,
  [THREE.UnsignedShortType]: 2,
  [THREE.IntType]: 4,
  [THREE.UnsignedIntType]: 4,
  [THREE.FloatType]: 4,
  [THREE.HalfFloatType]: 2,
  [THREE.UnsignedInt248Type]: 4,
};

/** Bytes per texel for a three texture's format and type. Unknown pairs read
 *  as RGBA8 (4), the common case, rather than 0 -- an inventory that drops
 *  what it cannot classify under-reports silently. */
export function texelBytes(format: number, type: number): number {
  if (type === THREE.UnsignedInt248Type) return 4;
  const ch = CHANNELS[format] ?? 4;
  return ch * (TYPE_BYTES[type] ?? 1);
}

function dims(image: unknown): [number, number, number] | null {
  if (image === null || typeof image !== 'object') return null;
  const o = image as { width?: unknown; height?: unknown; depth?: unknown; naturalWidth?: unknown; naturalHeight?: unknown };
  const w = typeof o.naturalWidth === 'number' && o.naturalWidth > 0 ? o.naturalWidth : o.width;
  const h = typeof o.naturalHeight === 'number' && o.naturalHeight > 0 ? o.naturalHeight : o.height;
  if (typeof w !== 'number' || typeof h !== 'number') return null;
  return [w, h, typeof o.depth === 'number' ? o.depth : 1];
}

/** Estimated GPU bytes for one texture, mip chain included when one is
 *  generated or supplied. A render target's texture counts here too. */
export function textureBytes(t: THREE.Texture): { w: number; h: number; bytes: number } {
  const imgs: unknown[] = Array.isArray(t.image) ? (t.image as unknown[]) : [t.image];
  let w = 0;
  let h = 0;
  let bytes = 0;
  // A GLB texture whose CPU copy was released after upload (gltf-loader.ts)
  // has a closed bitmap of width 0; its real size was kept on userData.
  const released = t.userData?.rlReleasedImage as { width: number; height: number } | null | undefined;
  for (const img of imgs) {
    const d = released && released.width > 0 ? ([released.width, released.height, 1] as [number, number, number]) : dims(img);
    if (!d) continue;
    [w, h] = d;
    bytes += d[0] * d[1] * d[2] * texelBytes(t.format, t.type);
  }
  const mips = t.mipmaps && t.mipmaps.length > 1;
  const generated =
    t.generateMipmaps && t.minFilter !== THREE.NearestFilter && t.minFilter !== THREE.LinearFilter;
  if (mips || generated) bytes = Math.round((bytes * 4) / 3);
  return { w, h, bytes };
}

/** Bytes of every array a geometry uploads. Interleaved buffers are counted
 *  once through `seen`, which the caller shares across the whole walk. */
export function geometryBytes(g: THREE.BufferGeometry, seen: Set<unknown> = new Set()): number {
  let n = 0;
  const add = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null | undefined): void => {
    if (!a) return;
    const backing = 'isInterleavedBufferAttribute' in a && a.isInterleavedBufferAttribute ? a.data : a;
    if (seen.has(backing)) return;
    seen.add(backing);
    n += (backing as { array: ArrayLike<number> & { byteLength: number } }).array.byteLength;
  };
  for (const a of Object.values(g.attributes)) add(a);
  for (const list of Object.values(g.morphAttributes)) for (const a of list) add(a);
  add(g.index);
  return n;
}

function texturesOf(material: THREE.Material, out: THREE.Texture[]): void {
  const visit = (v: unknown): void => {
    if (v instanceof THREE.Texture) out.push(v);
  };
  for (const v of Object.values(material)) {
    visit(v);
    // A uniform object ({ value }) held directly on the material, or in a
    // ShaderMaterial's `uniforms` table, one level deep.
    if (v !== null && typeof v === 'object' && !(v instanceof THREE.Texture)) {
      visit((v as { value?: unknown }).value);
      for (const u of Object.values(v as Record<string, unknown>)) {
        if (u !== null && typeof u === 'object') visit((u as { value?: unknown }).value);
      }
    }
  }
}

/**
 * Sum `entries` in order, counting each geometry and texture once. `entries`
 * is `[label, root]`; several entries may share a label and are merged.
 */
export function buildInventory(
  entries: Iterable<readonly [string, THREE.Object3D]>,
  renderer: THREE.WebGLRenderer | null = null,
  extraTextures: Iterable<readonly [string, THREE.Texture]> = []
): MemoryInventory {
  const groups = new Map<string, InventoryGroup>();
  const seenGeo = new Set<unknown>();
  const seenBuf = new Set<unknown>();
  const seenTex = new Set<unknown>();
  const seenMat = new Set<unknown>();
  const groupFor = (label: string): InventoryGroup => {
    let g = groups.get(label);
    if (!g) {
      g = { label, objects: 0, geometries: 0, geometryBytes: 0, textures: 0, textureBytes: 0, topTextures: [] };
      groups.set(label, g);
    }
    return g;
  };
  const addTexTo = (grp: InventoryGroup, t: THREE.Texture): void => {
    // By SOURCE, not by Texture: a cloned texture (a template's material
    // cloned per unit) is a new Texture over the same Source, and three
    // uploads a Source once.
    const key: unknown = t.source ?? t;
    if (seenTex.has(key)) return;
    seenTex.add(key);
    const b = textureBytes(t);
    grp.textures += 1;
    grp.textureBytes += b.bytes;
    grp.topTextures.push([t.name || t.constructor.name, b.w, b.h, b.bytes]);
  };
  for (const [label, root] of entries) {
    const grp = groupFor(label);
    const addTex = (t: THREE.Texture): void => addTexTo(grp, t);
    root.traverse((o) => {
      grp.objects += 1;
      const m = o as THREE.Mesh & Partial<THREE.InstancedMesh> & Partial<THREE.SkinnedMesh>;
      if (m.geometry instanceof THREE.BufferGeometry && !seenGeo.has(m.geometry)) {
        seenGeo.add(m.geometry);
        grp.geometries += 1;
        grp.geometryBytes += geometryBytes(m.geometry, seenBuf);
      }
      if (m.instanceMatrix && !seenBuf.has(m.instanceMatrix)) {
        seenBuf.add(m.instanceMatrix);
        grp.geometryBytes += m.instanceMatrix.array.byteLength;
      }
      if (m.instanceColor && !seenBuf.has(m.instanceColor)) {
        seenBuf.add(m.instanceColor);
        grp.geometryBytes += m.instanceColor.array.byteLength;
      }
      const boneTex = m.skeleton?.boneTexture;
      if (boneTex) addTex(boneTex);
      const mats = m.material === undefined ? [] : Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (!(mat instanceof THREE.Material) || seenMat.has(mat)) continue;
        seenMat.add(mat);
        const ts: THREE.Texture[] = [];
        texturesOf(mat, ts);
        for (const t of ts) addTex(t);
      }
    });
  }
  for (const [label, t] of extraTextures) addTexTo(groupFor(label), t);
  const out = [...groups.values()];
  for (const g of out) {
    g.topTextures.sort((a, b) => b[3] - a[3]);
    g.topTextures = g.topTextures.slice(0, 8);
  }
  out.sort((a, b) => b.geometryBytes + b.textureBytes - (a.geometryBytes + a.textureBytes));
  return {
    groups: out,
    info: renderer
      ? {
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          programs: renderer.info.programs?.length ?? 0,
        }
      : null,
  };
}
