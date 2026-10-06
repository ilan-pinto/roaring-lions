/**
 * The kit pass: graft a vehicle's upgrade kit into its shipped GLB as `kit_*`
 * nodes, touching nothing that was already there.
 *
 *     pnpm kit:meshes                  # every vehicle with a kit source
 *     pnpm kit:meshes -- --id=mbt_lavi # one (and it must have a source)
 *
 * Plan: `docs/superpowers/plans/2026-10-07-kitted-vehicles.md`, Task 2. The
 * contract the result keeps is `docs/superpowers/specs/2026-08-28-mesh-unit-
 * contract.md`, "v5 (vehicles)". Pipeline order for a vehicle:
 * `export_vehicle_kit.py` (Blender) -> `pnpm kit:meshes` -> `pnpm wreck:meshes`
 * -> `pnpm encode:meshes`.
 *
 * The SOURCE is `art/parts/kit/<id>.glb`, written by the Blender exporter: one
 * node per (track, tier, host) named `kit_<track>_<tier>_<host>`, at the scene
 * root, its vertices in VEHICLE world space, carrying `POSITION`, `NORMAL` and
 * `TEXCOORD_0`, no material, and `extras.rl_kit = { track, tier, host }`. The
 * TARGET is `art/meshes/vehicles/<id>.glb`, rewritten in place.
 *
 * Four things about it are worth knowing before touching it.
 *
 * **Why a graft and not a Blender re-export.** Every live node's accessors stay
 * byte-identical: the pass ADDS nodes, meshes and accessors and removes only
 * what an earlier run of itself added. A Blender round trip re-triangulates,
 * re-orders and re-quantises the shipped Meshy hulls, and those hulls are in
 * every gated golden scenario.
 *
 * **The world-to-host transform happens HERE, once.** A kit node is parented
 * beside its host with the host's own local TRS, so its world matrix IS the
 * host's and its vertices are in the host's own space; the renderer's merge
 * (`applyVehicleKit`) is then a concatenation with no matrix at all. So each
 * source vertex goes through `inverse(hostWorld) x sourceWorld`, and each
 * normal through that matrix's inverse-transpose, renormalised. Leave the
 * inverse out and a turret part lands one pivot offset away from where the
 * Blender scene put it -- `kit-pass.test.ts` measures exactly that.
 *
 * **The host decides the attribute set and the material, not the source.** A
 * textured host (a Meshy bake) needs `TEXCOORD_0`, because the part's colour IS
 * the texel its UVs were pinned to; a palette host (the Namer, Eitan, Kipod and
 * Shachaf weapon stations) has no UVs and no material, so the part's
 * `TEXCOORD_0` is dropped and it draws the host's ramp. A primitive with an
 * attribute its host lacks would stop the merge from being a concatenation.
 *
 * **Idempotent, and the trap is the same one `wreck-pass.ts` documents.**
 * Disposing a node leaves its mesh, and disposing a mesh leaves its
 * primitives' accessors on the Root, where the writer still emits them. So the
 * strip walks node -> mesh -> primitive -> accessor and disposes each accessor
 * only once nothing but the Root holds it. A second run writes the same bytes.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NodeIO,
  type Accessor,
  type Document,
  type Material,
  type Node,
  type Scene,
  type mat4,
} from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { KIT_MAX_TIER, KIT_TRACK_PATTERN, isKitName, kitNodeName } from './kit-contract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** Where the Blender exporter writes each vehicle's kit (an intermediate, like
 *  a `.blend`: NOT under `art/meshes/`, which `encode:meshes` ships whole). */
export const KIT_SOURCES = path.join(REPO, 'art', 'parts', 'kit');
const VEHICLES = path.join(REPO, 'art', 'meshes', 'vehicles');
const KDF_UNITS = path.join(REPO, 'data', 'units', 'kdf');

/** The eight KDF vehicles that carry kit (spec §3, ruling K9 keeps the gunship
 *  and the command Lavi out). */
export const KIT_VEHICLES: readonly string[] = [
  'apc_eitan',
  'apc_kipod',
  'dozer_d9',
  'heli_peten',
  'ifv_namer',
  'jeep_shoded',
  'mbt_lavi',
  'scout_shachaf',
];

/** The root nodes and subtrees that are not live geometry: the wreck pass's. */
const DEATH_ROOT = 'death_root';
const WRECK_PREFIX = 'WRECK_';

/** The attribute sets a host may carry. Anything else (a tangent, a vertex
 *  colour, a second UV set) is one the graft cannot write for the part. */
const PALETTE_ATTRIBUTES = ['NORMAL', 'POSITION'];
const TEXTURED_ATTRIBUTES = ['NORMAL', 'POSITION', 'TEXCOORD_0'];

/** glTF's TRIANGLES primitive mode. */
const TRIANGLES = 4;

// ---------------------------------------------------------------------------
// 4x4 arithmetic, column-major (glTF's convention). Hand-rolled for the same
// reason `wreck-pass.ts` gives: a multiply and an affine inverse are all this
// needs, and a dependency for them would be worse than writing them.
// ---------------------------------------------------------------------------

/** `a x b`: b is applied first. */
function multiply(a: mat4, b: mat4): mat4 {
  const out = new Array<number>(16).fill(0) as unknown as mat4;
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** The inverse of an AFFINE matrix (bottom row 0 0 0 1), or a throw. A node
 *  transform is always affine; a singular one (a zero scale) has no inverse
 *  and a part cannot be placed in its space. */
function invertAffine(m: mat4, what: string): mat4 {
  const [a, b, c] = [m[0], m[1], m[2]];
  const [d, e, f] = [m[4], m[5], m[6]];
  const [g, h, i] = [m[8], m[9], m[10]];
  const c00 = e * i - f * h;
  const c01 = f * g - d * i;
  const c02 = d * h - e * g;
  const det = a * c00 + b * c01 + c * c02;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    throw new Error(`${what}: its world matrix is singular (det ${det}), so a part cannot be put in its space`);
  }
  const inv = 1 / det;
  // Write the linear part as N = [[a, b, c], [d, e, f], [g, h, i]] -- that is
  // the TRANSPOSE of the matrix `m` holds, because `m` is column-major and
  // a, b, c are its first COLUMN. `r` below is the textbook inverse of N, so
  // r = (M^-1)^T, and M^-1's row j, column k is r[k][j].
  const r00 = c00 * inv;
  const r01 = (c * h - b * i) * inv;
  const r02 = (b * f - c * e) * inv;
  const r10 = c01 * inv;
  const r11 = (a * i - c * g) * inv;
  const r12 = (c * d - a * f) * inv;
  const r20 = c02 * inv;
  const r21 = (b * g - a * h) * inv;
  const r22 = (a * e - b * d) * inv;
  const [tx, ty, tz] = [m[12], m[13], m[14]];
  // Column-major: column k of M^-1 is (r[k][0], r[k][1], r[k][2]); the new
  // translation is -M^-1 t, whose row j is -(sum over k of r[k][j] t_k).
  return [
    r00, r01, r02, 0,
    r10, r11, r12, 0,
    r20, r21, r22, 0,
    -(r00 * tx + r10 * ty + r20 * tz),
    -(r01 * tx + r11 * ty + r21 * tz),
    -(r02 * tx + r12 * ty + r22 * tz),
    1,
  ];
}

/** The 3x3 normal matrix of `m`, inverse-transpose of its linear part, as
 *  column-major nine numbers. */
function normalMatrix(m: mat4, what: string): number[] {
  const inv = invertAffine(m, what);
  // Transpose of inv's upper-left 3x3, column-major.
  return [inv[0], inv[4], inv[8], inv[1], inv[5], inv[9], inv[2], inv[6], inv[10]];
}

// ---------------------------------------------------------------------------
// Stripping, for idempotence
// ---------------------------------------------------------------------------

/** Dispose an accessor iff nothing but the Root still references it. */
function disposeIfOrphan(accessor: Accessor): void {
  const held = accessor.listParents().filter((p) => p.propertyType !== 'Root');
  if (held.length === 0) accessor.dispose();
}

/**
 * Remove every `kit_*` node, and every mesh, primitive and accessor that only
 * kit nodes used. Returns how many nodes went.
 *
 * A mesh is disposed only if no surviving node references it -- the contract
 * says nothing else shares a kit mesh (the wreck pass never twins one), but a
 * strip that disposed a shared mesh would delete live geometry on a file that
 * broke that rule, which is the worse of the two ways to fail.
 */
export function stripKit(doc: Document): number {
  const doomed = doc
    .getRoot()
    .listNodes()
    .filter((n) => isKitName(n.getName()));
  const meshes = new Set(doomed.map((n) => n.getMesh()).filter((m) => m !== null));
  for (const node of doomed) {
    // A kit part is a leaf by contract; dispose any children first anyway, so
    // nothing is left orphaned on the Root.
    const sub: Node[] = [];
    node.traverse((n) => sub.push(n));
    for (const n of sub.reverse()) n.dispose();
  }
  for (const mesh of meshes) {
    if (mesh.listParents().some((p) => p.propertyType === 'Node')) continue;
    const accessors = new Set<Accessor>();
    for (const prim of mesh.listPrimitives()) {
      for (const a of prim.listAttributes()) accessors.add(a);
      const idx = prim.getIndices();
      if (idx) accessors.add(idx);
      prim.dispose();
    }
    mesh.dispose();
    for (const a of accessors) disposeIfOrphan(a);
  }
  return doomed.length;
}

// ---------------------------------------------------------------------------
// The graft
// ---------------------------------------------------------------------------

/** What one host offers a part: where it hangs, what it draws with. */
interface Host {
  readonly node: Node;
  readonly material: Material | null;
  readonly textured: boolean;
  readonly role: string;
  readonly world: mat4;
}

/** One parsed source part, before it is placed. */
interface SourcePart {
  readonly node: Node;
  readonly name: string;
  readonly track: string;
  readonly tier: number;
  readonly host: string;
}

export interface KitGraftOptions {
  /** The upgrade tracks the unit's JSON declares. When given, a part on any
   *  other track is refused -- no firepower part on the D9. */
  readonly tracks?: ReadonlySet<string>;
}

export interface KitGraftReport {
  readonly stripped: number;
  readonly grafted: readonly string[];
}

const roleOf = (node: Node): string => {
  const role = node.getExtras().rl_role;
  return typeof role === 'string' ? role : '';
};

/** True if `node` or any ancestor is the wreck pass's `death_root`. */
function underDeathRoot(node: Node): boolean {
  for (let walk: Node | null = node; walk; walk = walk.getParentNode()) {
    if (walk.getName() === DEATH_ROOT) return true;
  }
  return false;
}

/** Every live mesh node of the target, by name: not a kit part, not a wreck
 *  twin, not under the death root. A node that cannot host a part (a name two
 *  live nodes share, more than one primitive, an attribute set the graft
 *  cannot write) maps to the REASON, so a part naming it is refused by name
 *  rather than guessed at -- and a file whose unhosted nodes are odd is not. */
function liveHosts(doc: Document): Map<string, Host | string> {
  const out = new Map<string, Host | string>();
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    const mesh = node.getMesh();
    if (!mesh || isKitName(name) || name.startsWith(WRECK_PREFIX) || underDeathRoot(node)) continue;
    if (out.has(name)) {
      out.set(name, 'two live nodes share that name');
      continue;
    }
    const prims = mesh.listPrimitives();
    if (prims.length !== 1) {
      out.set(name, `it has ${prims.length} primitives, so no single material and attribute set`);
      continue;
    }
    const semantics = prims[0].listSemantics().slice().sort();
    const textured = semantics.join() === TEXTURED_ATTRIBUTES.join();
    if (!textured && semantics.join() !== PALETTE_ATTRIBUTES.join()) {
      out.set(
        name,
        `it carries [${semantics.join(', ')}]; a host carries exactly [${PALETTE_ATTRIBUTES.join(', ')}] ` +
          `or [${TEXTURED_ATTRIBUTES.join(', ')}]`
      );
      continue;
    }
    out.set(name, {
      node,
      material: prims[0].getMaterial(),
      textured,
      role: roleOf(node),
      world: node.getWorldMatrix(),
    });
  }
  return out;
}

/** Read and check one source node's `rl_kit` against its own name. */
function parseSourcePart(node: Node, vehicleId: string, opts: KitGraftOptions): SourcePart {
  const name = node.getName();
  const where = `${vehicleId}: kit source node "${name}"`;
  if (!isKitName(name)) {
    throw new Error(`${where} is not a kit part -- every node in a kit source is named kit_<track>_<tier>_<host>`);
  }
  const kit = node.getExtras().rl_kit as unknown;
  if (typeof kit !== 'object' || kit === null) throw new Error(`${where} carries no extras.rl_kit`);
  const { track, tier, host } = kit as Record<string, unknown>;
  if (typeof host !== 'string' || host.length === 0) {
    throw new Error(`${where} names no host (extras.rl_kit.host) -- a part with no host cannot be placed`);
  }
  if (typeof track !== 'string' || !KIT_TRACK_PATTERN.test(track)) {
    throw new Error(`${where}: rl_kit.track ${JSON.stringify(track)} is not a lower-case track name`);
  }
  if (typeof tier !== 'number' || !Number.isInteger(tier) || tier < 1 || tier > KIT_MAX_TIER) {
    throw new Error(`${where}: rl_kit.tier ${JSON.stringify(tier)} is outside 1-${KIT_MAX_TIER}`);
  }
  if (opts.tracks && !opts.tracks.has(track)) {
    throw new Error(
      `${where}: track "${track}" is not one ${vehicleId}'s JSON declares under upgrades ` +
        `(${[...opts.tracks].sort().join(', ') || 'none'})`
    );
  }
  const want = kitNodeName(track, tier, host);
  if (name !== want) throw new Error(`${where} does not match its rl_kit, which names "${want}"`);
  if (!node.getMesh()) throw new Error(`${where} has no mesh`);
  return { node, name, track, tier, host };
}

/**
 * Every refusal a part's GEOMETRY can earn, checked before anything in the
 * target changes (`applyKitGraft` calls this for every part first).
 */
function checkPart(part: SourcePart, host: Host, vehicleId: string): void {
  const where = `${vehicleId}: kit part "${part.name}"`;
  const srcPrims = part.node.getMesh()?.listPrimitives() ?? [];
  if (srcPrims.length === 0) throw new Error(`${where}'s mesh has no primitives`);
  const allowed = new Set(TEXTURED_ATTRIBUTES);
  srcPrims.forEach((src, k) => {
    if (src.getMode() !== TRIANGLES) throw new Error(`${where}: primitive ${k} is not TRIANGLES`);
    if (src.getMaterial()) {
      throw new Error(`${where}: primitive ${k} carries a material; a kit part takes its host's, so its source carries none`);
    }
    const stray = src.listSemantics().filter((s) => !allowed.has(s));
    if (stray.length) throw new Error(`${where}: primitive ${k} carries [${stray.join(', ')}], which no host has`);
    const pos = src.getAttribute('POSITION');
    const normal = src.getAttribute('NORMAL');
    const uv = src.getAttribute('TEXCOORD_0');
    if (!pos) throw new Error(`${where}: primitive ${k} has no POSITION`);
    if (!normal) throw new Error(`${where}: primitive ${k} has no NORMAL`);
    if (host.textured && !uv) {
      throw new Error(
        `${where}: host "${part.host}" is textured, so the part needs TEXCOORD_0 pinned to its bake -- it has none`
      );
    }
    const count = pos.getCount();
    if (normal.getCount() !== count || (uv && uv.getCount() !== count)) {
      throw new Error(`${where}: primitive ${k}'s attributes disagree on their vertex count`);
    }
    if (src.getIndices() && !src.getIndices()?.getArray()) throw new Error(`${where}: primitive ${k}'s indices have no data`);
    const el = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      normal.getElement(i, el);
      if (!(Math.hypot(el[0], el[1], el[2]) > 0)) throw new Error(`${where}: vertex ${i} has a zero normal`);
    }
  });
  // The matrices too: a singular host or part has no inverse to place it by.
  normalMatrix(multiply(invertAffine(host.world, `host "${part.host}"`), part.node.getWorldMatrix()), `kit part "${part.name}"`);
}

/** Put `source`'s part on `host` in `target`: new mesh, new accessors, a node
 *  beside the host with the host's local TRS. */
function graftPart(target: Document, part: SourcePart, host: Host, vehicleId: string): void {
  const where = `${vehicleId}: kit part "${part.name}"`;
  const buffer = target.getRoot().listBuffers()[0] ?? target.createBuffer();
  const toHost = multiply(invertAffine(host.world, `host "${part.host}"`), part.node.getWorldMatrix());
  const nrm = normalMatrix(toHost, `kit part "${part.name}"`);

  const mesh = target.createMesh(part.name);
  const srcMesh = part.node.getMesh();
  if (!srcMesh) throw new Error(`${where} has no mesh`);
  const srcPrims = srcMesh.listPrimitives();
  if (srcPrims.length === 0) throw new Error(`${where}'s mesh has no primitives`);

  srcPrims.forEach((src, k) => {
    const tag = srcPrims.length > 1 ? `${part.name}_${k}` : part.name;
    const pos = src.getAttribute('POSITION');
    const normal = src.getAttribute('NORMAL');
    const uv = src.getAttribute('TEXCOORD_0');
    if (!pos || !normal) throw new Error(`${where}: primitive ${k} lost an attribute after its check`);
    const count = pos.getCount();
    const p = new Float32Array(count * 3);
    const n = new Float32Array(count * 3);
    const el = [0, 0, 0];
    const m = toHost;
    for (let i = 0; i < count; i++) {
      pos.getElement(i, el);
      p[i * 3] = m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12];
      p[i * 3 + 1] = m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13];
      p[i * 3 + 2] = m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14];
      normal.getElement(i, el);
      const nx = nrm[0] * el[0] + nrm[3] * el[1] + nrm[6] * el[2];
      const ny = nrm[1] * el[0] + nrm[4] * el[1] + nrm[7] * el[2];
      const nz = nrm[2] * el[0] + nrm[5] * el[1] + nrm[8] * el[2];
      const len = Math.hypot(nx, ny, nz);
      if (!(len > 0)) throw new Error(`${where}: vertex ${i} has a zero normal`);
      n[i * 3] = nx / len;
      n[i * 3 + 1] = ny / len;
      n[i * 3 + 2] = nz / len;
    }

    const prim = target
      .createPrimitive()
      .setMode(TRIANGLES)
      .setMaterial(host.material)
      .setAttribute('POSITION', target.createAccessor(`${tag}_POSITION`, buffer).setType('VEC3').setArray(p))
      .setAttribute('NORMAL', target.createAccessor(`${tag}_NORMAL`, buffer).setType('VEC3').setArray(n));
    if (host.textured && uv) {
      const t = new Float32Array(count * 2);
      const e2 = [0, 0];
      for (let i = 0; i < count; i++) {
        uv.getElement(i, e2);
        t[i * 2] = e2[0];
        t[i * 2 + 1] = e2[1];
      }
      prim.setAttribute('TEXCOORD_0', target.createAccessor(`${tag}_TEXCOORD_0`, buffer).setType('VEC2').setArray(t));
    }
    const idx = src.getIndices();
    if (idx) {
      const arr = idx.getArray();
      if (!arr) throw new Error(`${where}: primitive ${k}'s indices have no data`);
      prim.setIndices(target.createAccessor(`${tag}_INDICES`, buffer).setType('SCALAR').setArray(arr.slice()));
    }
    mesh.addPrimitive(prim);
  });

  const node = target
    .createNode(part.name)
    .setMesh(mesh)
    .setTranslation(host.node.getTranslation())
    .setRotation(host.node.getRotation())
    .setScale(host.node.getScale())
    .setExtras({ rl_role: host.role, rl_kit: { track: part.track, tier: part.tier, host: part.host } });

  const parent = host.node.getParentNode();
  if (parent) {
    parent.addChild(node);
  } else {
    const scene: Scene | undefined = target.getRoot().listScenes()[0];
    if (!scene) throw new Error(`${vehicleId}: no scene`);
    scene.addChild(node);
  }
}

/**
 * Strip every `kit_*` node from `target`, then graft every part of `source`
 * onto its host. Every refusal is a throw naming the part, BEFORE anything is
 * grafted: a source is checked whole first, so a bad part never leaves a
 * half-grafted document behind.
 */
export function applyKitGraft(
  target: Document,
  source: Document,
  vehicleId: string,
  opts: KitGraftOptions = {}
): KitGraftReport {
  const scene = source.getRoot().listScenes()[0];
  if (!scene) throw new Error(`${vehicleId}: the kit source has no scene`);

  const parts: SourcePart[] = [];
  for (const top of scene.listChildren()) {
    top.traverse((node) => {
      parts.push(parseSourcePart(node, vehicleId, opts));
    });
  }
  if (parts.length === 0) throw new Error(`${vehicleId}: the kit source has no parts`);

  const seen = new Set<string>();
  for (const part of parts) {
    if (seen.has(part.name)) {
      throw new Error(
        `${vehicleId}: two kit parts for (track ${part.track}, tier ${part.tier}, host ${part.host}) -- ` +
          `one node per (track, tier, host)`
      );
    }
    seen.add(part.name);
  }
  parts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const hosts = liveHosts(target);
  const resolved = parts.map((part) => {
    const host = hosts.get(part.host);
    if (host === undefined) {
      throw new Error(
        `${vehicleId}: kit part "${part.name}" names host "${part.host}", which is not a live mesh node ` +
          `(live: ${[...hosts.keys()].sort().join(', ')})`
      );
    }
    if (typeof host === 'string') {
      throw new Error(`${vehicleId}: kit part "${part.name}" names host "${part.host}", which cannot host a part: ${host}`);
    }
    checkPart(part, host, vehicleId);
    return { part, host };
  });
  // Only now, with every part checked and every host found: a refused source
  // leaves the target exactly as it was.
  const stripped = stripKit(target);
  for (const { part, host } of resolved) graftPart(target, part, host, vehicleId);
  return { stripped, grafted: parts.map((p) => p.name) };
}

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

const ID_FLAG = '--id=';

/**
 * argv -> the vehicles to graft. Empty means every vehicle with a source.
 * Strict for the reason `parseWreckArgs` gives: an argument nobody recognised
 * must not fall through to a default that rewrites tracked art.
 */
export function parseKitArgs(argv: readonly string[]): readonly string[] | 'all' {
  const ids: string[] = [];
  for (const arg of argv) {
    if (arg === '--') continue;
    if (!arg.startsWith(ID_FLAG) || arg.length === ID_FLAG.length) {
      throw new Error(
        `unrecognised argument "${arg}" -- usage: kit:meshes [--id=<vehicle>]... ` +
          `-- kit vehicles: ${KIT_VEHICLES.join(', ')}`
      );
    }
    ids.push(arg.slice(ID_FLAG.length));
  }
  return ids.length ? ids : 'all';
}

/** The upgrade tracks `data/units/kdf/<id>.json` declares. */
export function declaredTracks(id: string, unitsDir: string = KDF_UNITS): ReadonlySet<string> {
  const json = JSON.parse(readFileSync(path.join(unitsDir, `${id}.json`), 'utf8')) as {
    upgrades?: Record<string, unknown>;
  };
  return new Set(Object.keys(json.upgrades ?? {}));
}

export interface KitPassDirs {
  readonly sources?: string;
  readonly vehicles?: string;
  readonly units?: string;
}

/**
 * Graft the named vehicles (or every one with a source) and write them back.
 * Returns the ids it grafted, which is empty -- and not an error -- when no
 * source exists yet and none was asked for by name.
 */
export async function runKitPass(
  ids: readonly string[] | 'all',
  dirs: KitPassDirs = {},
  log: (line: string) => void = console.log
): Promise<readonly string[]> {
  const sourcesDir = dirs.sources ?? KIT_SOURCES;
  const vehiclesDir = dirs.vehicles ?? VEHICLES;
  const unitsDir = dirs.units ?? KDF_UNITS;

  const files = existsSync(sourcesDir) ? readdirSync(sourcesDir).filter((f) => f.endsWith('.glb')) : [];
  // A source for something that is not a kit vehicle is a typo or a stale
  // file, and grafting it nowhere would be silent.
  for (const f of files) {
    const id = f.slice(0, -'.glb'.length);
    if (!KIT_VEHICLES.includes(id)) {
      throw new Error(
        `${path.join(sourcesDir, f)} names no kit vehicle -- kit vehicles: ${KIT_VEHICLES.join(', ')}`
      );
    }
  }
  const available = new Set(files.map((f) => f.slice(0, -'.glb'.length)));

  let wanted: readonly string[];
  if (ids === 'all') {
    wanted = KIT_VEHICLES.filter((id) => available.has(id));
    if (wanted.length === 0) {
      log(`KIT_PASS no kit sources under ${path.relative(REPO, sourcesDir) || sourcesDir} -- nothing to graft`);
      return [];
    }
  } else {
    for (const id of ids) {
      if (!KIT_VEHICLES.includes(id)) {
        throw new Error(`"${id}" is not a kit vehicle -- kit vehicles: ${KIT_VEHICLES.join(', ')}`);
      }
      if (!available.has(id)) {
        throw new Error(`${id}: no kit source at ${path.join(sourcesDir, `${id}.glb`)} -- export it first`);
      }
    }
    wanted = ids;
  }

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const id of wanted) {
    const file = path.join(vehiclesDir, `${id}.glb`);
    const before = statSync(file).size;
    const target = await io.read(file);
    const source = await io.read(path.join(sourcesDir, `${id}.glb`));
    const report = applyKitGraft(target, source, id, { tracks: declaredTracks(id, unitsDir) });
    await io.write(file, target);
    const after = statSync(file).size;
    log(
      `KIT_PASS_OK ${id} ${report.grafted.length} kit node(s) (${report.stripped} stripped), ` +
        `${after - before >= 0 ? '+' : ''}${after - before} bytes`
    );
  }
  return wanted;
}

async function main(): Promise<number> {
  await runKitPass(parseKitArgs(process.argv.slice(2)));
  return 0;
}

// Only when this file is the process entry point -- its tests import it and
// must not write to `art/meshes/`.
const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  );
}
