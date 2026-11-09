/**
 * Who stands in a shipped infantry GLB, and what each one's hands are made of (GH-746 follow-up, the audit's G1 G2 G3
 * G8): the shared reader under the hand gates.
 *
 * Every reading here is off the BYTES of `art/meshes/<team>.glb`, in the bind pose, with no generator and no motion
 * pass imported: a gate that borrowed the thing it checks would move with it. Three readings:
 *
 *  - the figure BUILDS in a file: one per `{prefix}_forearm_L` + `{prefix}_forearm_R` pair. A posture twin (`mtr_crew0w`)
 *    and a corpse-free duplicate (`yah_ak`) are builds of their own, because each is a figure the player can see;
 *  - the TRIANGLES a build's bones own, with their role mesh, their dominant joint and their texel in the baked skin;
 *  - the hand ASSEMBLY of a side: the connected pieces (welded at 0.5 mm) of every triangle bound to
 *    `{prefix}_hand_{side}` or `{prefix}_finger_{side}`. `_L` is the figure's anatomical RIGHT on the Meshy rigs.
 *
 * `rebindVertices` makes a copy of a file with the vertices of one bone moved to another: the constructed failing input
 * every gate here is run red on (the CLAUDE.md rule: a check that has never failed is evidence about the check).
 */
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { readAccessor, readGlb, type GlbFile } from './mesh_gait';
import { readSkinned } from './mesh_hands';

export type V3 = [number, number, number];

/** One skinned role mesh, bind pose, with its triangles' dominant joint resolved to a NAME. */
export interface RoleMesh {
  readonly name: string;
  readonly role: string;
  /** Per vertex: the joint carrying the largest weight, by node name ('' when none). */
  readonly joint: readonly string[];
  readonly pos: ReturnType<typeof readAccessor>;
  readonly uv: ReturnType<typeof readAccessor> | null;
  /** Three vertex indices per triangle. */
  readonly index: ReturnType<typeof readAccessor>;
}

/** A triangle of a `RoleMesh`. */
export interface Tri {
  readonly mesh: RoleMesh;
  readonly t: number;
  /** The dominant joint of the triangle's first vertex (the audit's rule). */
  readonly bone: string;
}

/** Every skinned role mesh of the file, the worn kit (`kit_*`) excluded: kit is not the body. */
export function readRoleMeshes(glb: GlbFile): RoleMesh[] {
  const nodes = glb.json.nodes ?? [];
  const out: RoleMesh[] = [];
  for (const node of nodes) {
    if (node.mesh === undefined || node.skin === undefined) continue;
    const name = node.name ?? '';
    if (name.startsWith('kit_')) continue;
    const mesh = glb.json.meshes?.[node.mesh];
    const skin = glb.json.skins?.[node.skin];
    if (!mesh || !skin) continue;
    const prim = mesh.primitives[0];
    if (prim.indices === undefined) continue;
    const pos = readAccessor(glb, prim.attributes.POSITION);
    const j = readAccessor(glb, prim.attributes.JOINTS_0);
    const w = readAccessor(glb, prim.attributes.WEIGHTS_0);
    const joint: string[] = new Array<string>(pos.count);
    for (let v = 0; v < pos.count; v++) {
      let best = -1;
      let bw = 0;
      for (let k = 0; k < 4; k++) {
        const x = w.data[v * 4 + k];
        if (x > bw) { bw = x; best = j.data[v * 4 + k]; }
      }
      joint[v] = best < 0 ? '' : (nodes[skin.joints[best]]?.name ?? '');
    }
    const extras = (node as { extras?: { rl_role?: unknown } }).extras;
    out.push({
      name,
      role: typeof extras?.rl_role === 'string' ? extras.rl_role : (mesh.name ?? name),
      joint,
      pos,
      uv: prim.attributes.TEXCOORD_0 === undefined ? null : readAccessor(glb, prim.attributes.TEXCOORD_0),
      index: readAccessor(glb, prim.indices),
    });
  }
  return out;
}

export function trianglesOf(m: RoleMesh): Tri[] {
  const out: Tri[] = [];
  for (let t = 0; t < m.index.count / 3; t++) out.push({ mesh: m, t, bone: m.joint[m.index.data[t * 3]] });
  return out;
}

/** Vertex indices of a triangle. */
export function triVerts(tri: Tri): [number, number, number] {
  const d = tri.mesh.index.data;
  return [d[tri.t * 3], d[tri.t * 3 + 1], d[tri.t * 3 + 2]];
}

export function triPoints(tri: Tri): [V3, V3, V3] {
  const p = tri.mesh.pos.data;
  const [a, b, c] = triVerts(tri);
  return [[p[a * 3], p[a * 3 + 1], p[a * 3 + 2]], [p[b * 3], p[b * 3 + 1], p[b * 3 + 2]], [p[c * 3], p[c * 3 + 1], p[c * 3 + 2]]];
}

export function triAreaM2(tri: Tri): number {
  const [a, b, c] = triPoints(tri);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
}

/** The figure builds in a file: every prefix that has both a `_forearm_L` and a `_forearm_R` node. */
export function figureBuilds(glb: GlbFile): string[] {
  const names = new Set((glb.json.nodes ?? []).map((n) => n.name ?? ''));
  const out: string[] = [];
  for (const n of names) {
    const m = /^(.*)_forearm_L$/.exec(n);
    if (m && names.has(`${m[1]}_forearm_R`)) out.push(m[1]);
  }
  return out.sort();
}

/** Does `bone` belong to the build `prefix`? (`mtr_crew0w_*` is not `mtr_crew0`'s.) */
export function owns(prefix: string, bone: string): boolean {
  return bone.startsWith(`${prefix}_`);
}

/** The bones a hand assembly rides: the hand, and the firing hand's trigger finger. */
export function handBones(prefix: string, side: 'L' | 'R'): string[] {
  return [`${prefix}_hand_${side}`, `${prefix}_finger_${side}`];
}

/** Welded connected components of `tris` (vertices merged at 0.5 mm), each as a list of triangles. */
export function components(tris: readonly Tri[]): Tri[][] {
  if (tris.length === 0) return [];
  const key = new Map<string, number>();
  const par: number[] = [];
  const id = (tri: Tri, k: number): number => {
    const p = tri.mesh.pos.data;
    const v = tri.mesh.index.data[tri.t * 3 + k];
    const s = `${Math.round(p[v * 3] / 0.0005)},${Math.round(p[v * 3 + 1] / 0.0005)},${Math.round(p[v * 3 + 2] / 0.0005)}`;
    let i = key.get(s);
    if (i === undefined) { i = par.length; par.push(i); key.set(s, i); }
    return i;
  };
  const find = (x: number): number => {
    while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; }
    return x;
  };
  const ids = tris.map((tri) => [id(tri, 0), id(tri, 1), id(tri, 2)]);
  for (const [a, b, c] of ids) {
    for (const x of [b, c]) { const ra = find(a), rx = find(x); if (ra !== rx) par[rx] = ra; }
  }
  const groups = new Map<number, Tri[]>();
  tris.forEach((tri, i) => {
    const r = find(ids[i][0]);
    let g = groups.get(r);
    if (!g) { g = []; groups.set(r, g); }
    g.push(tri);
  });
  return [...groups.values()];
}

export interface HandAssembly {
  /** Triangles riding the hand bone and its finger bone. */
  readonly triangles: number;
  /** Connected pieces among them: the generator makes palm, cuff, thumb, four fingers and a pad. */
  readonly pieces: number;
}

/** The hand assembly of one side of one build, read off the bytes. `{triangles: 0, pieces: 0}` when it has none. */
export function handAssembly(glb: GlbFile, prefix: string, side: 'L' | 'R', meshes = readRoleMeshes(glb)): HandAssembly {
  const bones = new Set(handBones(prefix, side));
  const tris = meshes.flatMap((m) => trianglesOf(m)).filter((t) => bones.has(t.bone));
  return { triangles: tris.length, pieces: components(tris).length };
}

// ---- the baked skin -------------------------------------------------------------------------------------------------

export interface Texture {
  readonly width: number;
  readonly height: number;
  /** RGBA, rows from the TOP (glTF's own v axis). */
  readonly data: Uint8Array;
}

/** The first embedded image of the file, decoded; null when the file carries none. */
export function readTexture(glb: GlbFile): Texture | null {
  const img = glb.json.images?.[0];
  if (!img || img.bufferView === undefined) return null;
  const bv = glb.json.bufferViews?.[img.bufferView];
  if (!bv) return null;
  const bytes = Buffer.from(glb.bin.buffer, glb.bin.byteOffset + (bv.byteOffset ?? 0), bv.byteLength);
  if (img.mimeType === 'image/png') {
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, data: png.data };
  }
  const j = jpeg.decode(bytes, { useTArray: true });
  return { width: j.width, height: j.height, data: j.data };
}

/** CIE L*a*b* (D65) of an sRGB 0-255 triple. */
export function lab(r: number, g: number, b: number): V3 {
  const lin = [r, g, b].map((c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  const X = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047;
  const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const Z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

export function deltaE(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The Lab colour of a pixel. */
export function labAt(tex: Texture, x: number, y: number): V3 {
  const px = Math.min(tex.width - 1, Math.max(0, x));
  const py = Math.min(tex.height - 1, Math.max(0, y));
  const o = (py * tex.width + px) * 4;
  return lab(tex.data[o], tex.data[o + 1], tex.data[o + 2]);
}

/** The Lab colour a triangle is painted: its UV centroid's texel; null for a mesh with no UVs. */
export function triLab(tex: Texture, tri: Tri): V3 | null {
  const uv = tri.mesh.uv;
  if (!uv) return null;
  const [a, b, c] = triVerts(tri);
  const u = (uv.data[a * 2] + uv.data[b * 2] + uv.data[c * 2]) / 3;
  const v = (uv.data[a * 2 + 1] + uv.data[b * 2 + 1] + uv.data[c * 2 + 1]) / 3;
  const fr = (x: number): number => x - Math.floor(x);
  return labAt(tex, Math.floor(fr(u) * tex.width), Math.floor(fr(v) * tex.height));
}


// ---- the hand, either generation ------------------------------------------------------------------------------------

/** The roles that are held or worn kit, never skin: a claw-tone patch on one of these is a pouch or a stock, not a hand. */
const NOT_SKIN_ROLES: ReadonlySet<string> = new Set(['weapon', 'metal', 'charge', 'wood', 'webbing', 'face']);
/** A bone on which hand geometry belongs (the forearm carries a Meshy claw; the fist is the corpse's). */
export const HAND_OK_BONE = /_(hand|fist|finger|forearm)_[LR]$/;
/** How far past the elbow-to-tip axis a Meshy claw is taken to reach: the distal 0.12 m of the forearm bone's surface. */
export const CLAW_REACH_M = 0.12;

/** A figure's `rl_hands` declaration (the hands pass writes it into the scene extras); null on a file it has not been through. */
export function handsExtras(glb: GlbFile): { glove: [number, number] } | null {
  const e = (glb.json.scenes?.[0]?.extras ?? {}) as { rl_hands?: { glove?: [number, number] } };
  return e.rl_hands?.glove ? { glove: e.rl_hands.glove } : null;
}

export type HandKind = 'modelled' | 'claw' | 'none';

/**
 * The geometry a side's hand is made of. `modelled`: triangles on `{p}_hand_{side}` (and its trigger finger). `claw`: no
 * hand bone, so the forearm bone's triangles within `CLAW_REACH_M` of its farthest point from the elbow joint. `none`:
 * neither -- the arm is fused into the torso, or there is no forearm geometry.
 */
export function handTriangles(
  glb: GlbFile, prefix: string, side: 'L' | 'R', meshes = readRoleMeshes(glb)
): { kind: HandKind; tris: Tri[] } {
  const all = meshes.flatMap((m) => trianglesOf(m));
  const hb = new Set(handBones(prefix, side));
  const own = all.filter((t) => hb.has(t.bone));
  if (own.length > 0) return { kind: 'modelled', tris: own };
  const fb = `${prefix}_forearm_${side}`;
  const elbow = readSkinned(glb).heads.get(fb);
  const fa = all.filter((t) => t.bone === fb && !NOT_SKIN_ROLES.has(t.mesh.role));
  if (!elbow || fa.length === 0) return { kind: 'none', tris: [] };
  const d = fa.map((t) => {
    const c = centroid(t);
    return Math.hypot(c[0] - elbow[0], c[1] - elbow[1], c[2] - elbow[2]);
  });
  const far = Math.max(...d);
  const tris = fa.filter((_, i) => d[i] >= far - CLAW_REACH_M);
  return tris.length > 0 ? { kind: 'claw', tris } : { kind: 'none', tris: [] };
}

export function centroid(t: Tri): V3 {
  const [a, b, c] = triPoints(t);
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
}

/** The legacy Meshy claw tones, CIE L*a*b* literals: the KDF orange claw (54, 16, 40) and (42, 18, 33), the crew's pink skin (55, 28, 26). */
export const LEGACY_CLAW_TONES: readonly V3[] = [[42, 18, 33], [54, 16, 40], [55, 28, 26]];
/** A claw-tone patch smaller than this is texture noise on a pouch, not a left-over hand. */
export const STRAY_MIN_CM2 = 20;
/** A stray piece must lie within this of the figure's own hand (rest pose) to be a claw's left-over. */
export const STRAY_NEAR_HAND_M = 0.12;
/** A triangle whose UV centroid is this close (texels) to the glove texel is painted as a modelled glove. */
export const GLOVE_TEXEL_RADIUS = 2;

export interface StrayPiece {
  readonly build: string;
  readonly bones: string[];
  readonly triangles: number;
  readonly areaCm2: number;
  /** `tone`: painted a legacy claw tone near the hand; `glove`: painted the modelled glove's own texel. */
  readonly how: 'tone' | 'glove';
}

/** A claw tone is chromatic enough to tell from a uniform when its chroma C* (of L*a*b*) is at least this. Orange, pink and tan
 *  claws are 27-42; the black, dark-olive and grey claws are 4-13, the same as the trousers and pouches beside them. */
export const CLAW_TONE_MIN_CHROMA = 25;

export interface StrayReport {
  readonly pieces: StrayPiece[];
  /** Builds whose claw is too close to the body's own colour for a tone test to mean anything (dark claws): G2 CANNOT SEE
   *  a fragment on them. Honest absence of a reading, listed rather than passed. */
  readonly blind: string[];
}

/**
 * Hand-coloured geometry bound to a bone that is not a hand (the audit's G2 (a)): the third orange "hand" at a Combat
 * Engineer's hip. Two tests, because there are two generations of hand:
 *
 *  - a Meshy claw is painted one flat tone. The build's OWN claw tone (the median Lab of its claw triangles) and the
 *    `LEGACY_CLAW_TONES` literals are matched (deltaE 10) against the same figure's non-hand geometry within
 *    `STRAY_NEAR_HAND_M` of its hand; a connected patch of at least `STRAY_MIN_CM2` is the claw's left-over. This only
 *    means something when the tone is not the body's: below `CLAW_TONE_MIN_CHROMA` the build is `blind`, because a black
 *    claw matches black trousers and pouches (a first try without that rule flagged a belt and a sleeve as claws);
 *  - a modelled hand is painted ONE texel (`rl_hands.glove`); any triangle on that texel off a hand bone is a hand piece
 *    bound to the wrong bone, and no gear is painted with it.
 *
 * Corpse rigs (`*death*` bones) are the other build and are not read; held and worn roles are not skin.
 */
export function strayClawReport(glb: GlbFile): StrayReport {
  const meshes = readRoleMeshes(glb);
  const tex = readTexture(glb);
  if (!tex) throw new Error('strayClawPieces: the file carries no baked skin to read tones from');
  const glove = handsExtras(glb)?.glove ?? null;
  const all = meshes.flatMap((m) => trianglesOf(m));
  const out: StrayPiece[] = [];
  const blind: string[] = [];
  const builds = figureBuilds(glb);
  for (const p of builds) {
    const mine = all.filter((t) => owns(p, t.bone) && !/death/.test(t.bone) && !HAND_OK_BONE.test(t.bone));
    const hs = (['L', 'R'] as const).map((s) => handTriangles(glb, p, s, meshes));
    const handTris = hs.flatMap((h) => h.tris);
    const hands = handTris.map(centroid);
    const near = (c: V3): boolean => hands.some((h) => Math.hypot(h[0] - c[0], h[1] - c[1], h[2] - c[2]) <= STRAY_NEAR_HAND_M);
    const claw = hs.some((h) => h.kind === 'claw');
    if (hands.length === 0 && !isTwin(p, builds)) blind.push(p);
    // The legacy claw tones (KDF orange, the crews' pink) describe CLAWS. A build whose hands are modelled gloves with
    // their own texel (`rl_hands.glove`) and no claw is read by that texel (`painted` below), not by them: the Meshy Rifle
    // Squad's vest is the kit carrier's coyote by the lead's ruling (9 Nov 2026), Lab (43, 7, 31), 10.8 dE from the
    // legacy (42, 18, 33), and its pouches beside the fists read as six "claw" pieces on the spine.
    const tones: V3[] = glove !== null && !claw ? [] : [...LEGACY_CLAW_TONES];
    if (claw) {
      const labs = handTris.filter((t) => hs.some((h) => h.kind === 'claw' && h.tris.includes(t))).map((t) => triLab(tex, t)).filter((l): l is V3 => l !== null);
      if (labs.length > 0) {
        const own = [0, 1, 2].map((k) => labs.map((l) => l[k]).sort((a, b) => a - b)[labs.length >> 1]) as V3;
        if (Math.hypot(own[1], own[2]) >= CLAW_TONE_MIN_CHROMA) tones.push(own);
        else if (!isTwin(p, builds)) blind.push(p);
      }
    }
    const tone = mine.filter((t) => {
      if (NOT_SKIN_ROLES.has(t.mesh.role) || hands.length === 0) return false;
      const l = triLab(tex, t);
      return l !== null && tones.some((x) => deltaE(l, x) <= 10) && near(centroid(t));
    });
    const painted = glove === null ? [] : mine.filter((t) => {
      const uv = t.mesh.uv;
      if (!uv) return false;
      const [a, b, c] = triVerts(t);
      const u = ((uv.data[a * 2] + uv.data[b * 2] + uv.data[c * 2]) / 3) * tex.width;
      const v = ((uv.data[a * 2 + 1] + uv.data[b * 2 + 1] + uv.data[c * 2 + 1]) / 3) * tex.height;
      return Math.hypot(u - glove[0], v - glove[1]) <= GLOVE_TEXEL_RADIUS;
    });
    for (const [how, set, min] of [['tone', tone, STRAY_MIN_CM2], ['glove', painted, 1]] as const) {
      for (const comp of components(set)) {
        const areaCm2 = comp.reduce((a, t) => a + triAreaM2(t), 0) * 1e4;
        if (areaCm2 < min) continue;
        out.push({ build: p, bones: [...new Set(comp.map((t) => t.bone))].sort(), triangles: comp.length, areaCm2, how });
      }
    }
  }
  return { pieces: out, blind };
}

export function strayClawPieces(glb: GlbFile): StrayPiece[] {
  return strayClawReport(glb).pieces;
}

// ---- constructed failing inputs -------------------------------------------------------------------------------------

/**
 * A copy of `glb` with every vertex whose DOMINANT joint is `from` (and, optionally, only the first `limit` of them) moved
 * to the joint `to`: weight slot 0 of the vertex is rewritten to `to` and the other slots are zeroed. The bytes of the
 * copy are what every reader above then sees; the file on disk is untouched.
 */
export function rebindVertices(glb: GlbFile, from: string, to: string, limit = Infinity): GlbFile {
  const json = JSON.parse(JSON.stringify(glb.json)) as GlbFile['json'];
  const bin = new Uint8Array(glb.bin);
  const copy: GlbFile = { json, bin };
  const nodes = json.nodes ?? [];
  let moved = 0;
  for (const node of nodes) {
    if (node.mesh === undefined || node.skin === undefined) continue;
    const skin = json.skins?.[node.skin];
    if (!skin) continue;
    const toSlot = skin.joints.findIndex((n) => nodes[n]?.name === to);
    if (toSlot < 0) throw new Error(`rebindVertices: no joint ${to} in the skin of ${node.name}`);
    const prim = json.meshes![node.mesh].primitives[0];
    const jAcc = json.accessors![prim.attributes.JOINTS_0];
    const wAcc = json.accessors![prim.attributes.WEIGHTS_0];
    const jBv = json.bufferViews![jAcc.bufferView!];
    const wBv = json.bufferViews![wAcc.bufferView!];
    const jBase = (jBv.byteOffset ?? 0) + (jAcc.byteOffset ?? 0);
    const wBase = (wBv.byteOffset ?? 0) + (wAcc.byteOffset ?? 0);
    const jSize = jAcc.componentType === 5121 ? 1 : 2;
    const jStride = jBv.byteStride ?? 4 * jSize;
    const wStride = wBv.byteStride ?? 16;
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const readJ = (o: number): number => (jSize === 1 ? dv.getUint8(o) : dv.getUint16(o, true));
    const writeJ = (o: number, x: number): void => { if (jSize === 1) dv.setUint8(o, x); else dv.setUint16(o, x, true); };
    for (let v = 0; v < jAcc.count; v++) {
      let best = 0;
      let bw = -1;
      for (let k = 0; k < 4; k++) {
        const w = dv.getFloat32(wBase + v * wStride + k * 4, true);
        if (w > bw) { bw = w; best = k; }
      }
      if (bw <= 0) continue;
      if (nodes[skin.joints[readJ(jBase + v * jStride + best * jSize)]]?.name !== from) continue;
      if (moved >= limit) continue;
      moved++;
      for (let k = 0; k < 4; k++) {
        writeJ(jBase + v * jStride + k * jSize, k === 0 ? toSlot : 0);
        dv.setFloat32(wBase + v * wStride + k * 4, k === 0 ? 1 : 0, true);
      }
    }
  }
  if (moved === 0) throw new Error(`rebindVertices: no vertex rides ${from}; the constructed input would be the shipped file`);
  return copy;
}

export { readGlb };

// ---- the population -------------------------------------------------------------------------------------------------

/** Not teams of living soldiers: the casualty rigs and the robot dog. */
export const NOT_A_TEAM = /^(wounded_|ugv_)/;

/** Every infantry GLB in `dir` that carries at least one figure build, as `[team, glb]`. The population first: a census
 *  that read nothing would pass everything, so each caller pins its size. */
export function infantryTeams(dir: string, list: (d: string) => string[], read: (path: string) => GlbFile = readGlb): [string, GlbFile][] {
  return list(dir)
    .filter((n) => n.endsWith('.glb') && !NOT_A_TEAM.test(n))
    .map((n) => [n.replace(/\.glb$/, ''), read(`${dir}${n}`)] as [string, GlbFile])
    .filter(([, g]) => figureBuilds(g).length > 0);
}

/** A walker twin (`mtr_crew0w`) is the same soldier in another posture: the base build stands for both. */
export function isTwin(prefix: string, builds: readonly string[]): boolean {
  return prefix.endsWith('w') && builds.includes(prefix.slice(0, -1));
}
