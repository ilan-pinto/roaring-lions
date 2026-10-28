/**
 * The infantry kit pass: graft a TEAM's upgrade kit into its shipped GLB as
 * skinned `kit_*` nodes, touching nothing that was already there.
 *
 *     pnpm kit:meshes -- --teams                 # every team with a kit source
 *     pnpm kit:meshes -- --teams --id=inf_squad  # one
 *
 * GH-826. Spec: `docs/superpowers/specs/2026-10-26-infantry-kit-design.md`,
 * section 3 (the vehicle-kit model carried over to skinned teams). Pipeline
 * order for a team, load-bearing: `tools/units/export_infantry_kit.py`
 * (Blender, writes `art/parts/inf_kit/<team>.glb`) is built against the team's
 * GLB AFTER `pnpm motion:meshes` and `pnpm gait:meshes`; then this pass; then
 * `pnpm encode:meshes`. The kit goes in after the gait pass because the graft
 * keeps every live accessor byte-identical, and the motion pass refuses a file
 * it has already been through.
 *
 * The SOURCE is a Blender export: one skinned node per kit part, named
 * `kit_<track>_<tier>_<part>[_<L|R>]_<figure>` (`kit-contract.ts`), carrying
 * POSITION, NORMAL, TEXCOORD_0 (pinned to a texel of the team's own atlas),
 * JOINTS_0 and WEIGHTS_0 (one bone, weight 1), no usable material, and
 * `extras.rl_kit`. The TARGET is `art/meshes/<team>.glb`, rewritten in place.
 *
 * What this adds to the vehicle pass (`kit-pass.ts`, whose `stripKit` it
 * reuses):
 *
 * **The part is skinned, so its bones are re-pointed, not its vertices moved.**
 * Source and target are the same rig in the same frame (the part was fitted to
 * the target's own bind pose), so vertices are copied as they are; what
 * changes is JOINTS_0, which indexes the SOURCE skin's joint list. Each joint
 * is mapped by NAME to the target skin's index. The target's skin is shared:
 * a kit node is one more mesh on the same skeleton, so the renderer's clone
 * gives it the same bones for free.
 *
 * **A stale source is refused, twice.** (a) Every source joint's inverse bind
 * matrix must equal the target's joint of that name; (b) the source carries
 * `rl_kit_base`, a hash of the POSITION, JOINTS_0 and WEIGHTS_0 bytes of every
 * live primitive it was fitted to (`export_infantry_kit.py`'s `base_hash`),
 * which must equal the target's. A re-export or a re-run motion pass moves
 * those bytes, and a part fitted to the old body would graft cleanly and sit
 * off the new one.
 *
 * **The host decides the attribute set and the material.** A part joins its
 * host's role primitive at load, so it has exactly its host's attributes and
 * its host's material: +0 draw calls, and the atlas is never re-encoded, so
 * tier 0 cannot move.
 *
 * **The parts are PACKED, one node per host.** The source is a node per part
 * (the art); the shipping file carries `kit_uniform` and `kit_weapon`, each
 * one primitive whose vertices carry `_RL_KIT`, the part's id in
 * `extras.rl_kit.parts` (`packHost` says why: +138 KiB encoded as 81 nodes,
 * against a +64 KiB budget).
 *
 * **Budgets are refused here, not discovered later.** A node over 1.10x its
 * approved triangles (`INFANTRY_KIT_PART_TRIS`), a figure drawing more than
 * 1,200 at maximum kit, a file carrying more than 5,000.
 *
 * Idempotent: it strips every `kit_*` node first, so a second run writes the
 * same bytes.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Accessor, type Document, type Node, type Primitive, type Skin } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { stripKit } from './kit-pass';
import {
  INFANTRY_KIT_FIGURE_TRIS,
  INFANTRY_KIT_FILE_TRIS,
  INFANTRY_KIT_HOSTS,
  INFANTRY_KIT_PART_SLACK,
  INFANTRY_KIT_PART_TRIS,
  INFANTRY_KIT_TEAMS,
  KIT_MAX_TIER,
  KIT_PREFIX,
  KIT_TRACK_PATTERN,
  infantryKitNodeName,
  isKitName,
} from './kit-contract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const INFANTRY_KIT_SOURCES = path.join(REPO, 'art', 'parts', 'inf_kit');
const TEAMS = path.join(REPO, 'art', 'meshes');
const KDF_UNITS = path.join(REPO, 'data', 'units', 'kdf');

/** A host primitive carries exactly these; so does a part. */
const SKINNED_ATTRIBUTES = ['JOINTS_0', 'NORMAL', 'POSITION', 'TEXCOORD_0', 'WEIGHTS_0'];
const TRIANGLES = 4;
const IBM_TOLERANCE = 1e-4;

export interface InfantryKitTag {
  readonly track: string;
  readonly tier: number;
  readonly host: string;
  readonly part: string;
  readonly figure: string;
  readonly bone: string;
  readonly slot?: string;
  readonly side?: string;
}

/** The node names of a team's live meshes: not kit parts, not a death twin. */
function liveMeshNodes(doc: Document): Node[] {
  return doc
    .getRoot()
    .listNodes()
    .filter((n) => n.getMesh() !== null && !isKitName(n.getName()))
    .sort((a, b) => (a.getName() < b.getName() ? -1 : a.getName() > b.getName() ? 1 : 0));
}

const bytes = (a: Accessor): Buffer => {
  const arr = a.getArray();
  if (!arr) throw new Error(`accessor ${a.getName()} has no data`);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
};

/**
 * sha256 over POSITION, JOINTS_0 and WEIGHTS_0 of every live primitive, nodes
 * in name order. `export_infantry_kit.py` computes the same number from the
 * file's bytes; a graft that only ADDS kit nodes leaves it unchanged.
 */
export function baseHash(doc: Document): string {
  const h = createHash('sha256');
  for (const node of liveMeshNodes(doc)) {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      for (const sem of ['POSITION', 'JOINTS_0', 'WEIGHTS_0']) {
        const acc = prim.getAttribute(sem);
        if (!acc) throw new Error(`live node "${node.getName()}" has no ${sem}`);
        h.update(bytes(acc));
      }
    }
  }
  return h.digest('hex');
}

export function parseInfantryTag(node: Node, team: string): InfantryKitTag {
  const name = node.getName();
  const where = `${team}: kit source node "${name}"`;
  const raw = node.getExtras().rl_kit as unknown;
  if (typeof raw !== 'object' || raw === null) throw new Error(`${where} carries no extras.rl_kit`);
  const { track, tier, host, part, figure, bone, slot, side } = raw as Record<string, unknown>;
  const str = (v: unknown, what: string): string => {
    if (typeof v !== 'string' || v.length === 0) throw new Error(`${where}: rl_kit.${what} ${JSON.stringify(v)} is not a name`);
    return v;
  };
  const t = str(track, 'track');
  if (!KIT_TRACK_PATTERN.test(t)) throw new Error(`${where}: rl_kit.track ${JSON.stringify(t)} is not a lower-case track name`);
  if (typeof tier !== 'number' || !Number.isInteger(tier) || tier < 1 || tier > KIT_MAX_TIER) {
    throw new Error(`${where}: rl_kit.tier ${JSON.stringify(tier)} is outside 1-${KIT_MAX_TIER}`);
  }
  const h = str(host, 'host');
  if (!INFANTRY_KIT_HOSTS.includes(h)) {
    throw new Error(`${where}: rl_kit.host "${h}" is not a role primitive a kit part may join (${INFANTRY_KIT_HOSTS.join(', ')})`);
  }
  if (slot !== undefined && (typeof slot !== 'string' || slot.length === 0)) {
    throw new Error(`${where}: rl_kit.slot ${JSON.stringify(slot)} is not a name`);
  }
  if (side !== undefined && side !== 'L' && side !== 'R') throw new Error(`${where}: rl_kit.side ${JSON.stringify(side)} is not L or R`);
  const tag: InfantryKitTag = {
    track: t,
    tier,
    host: h,
    part: str(part, 'part'),
    figure: str(figure, 'figure'),
    bone: str(bone, 'bone'),
    ...(slot === undefined ? {} : { slot: slot as string }),
    ...(side === undefined ? {} : { side: side as string }),
  };
  const want = infantryKitNodeName(tag.track, tag.tier, tag.part, tag.figure, tag.side);
  if (name !== want) throw new Error(`${where} does not match its rl_kit, which names "${want}"`);
  return tag;
}

interface SourcePart {
  readonly node: Node;
  readonly tag: InfantryKitTag;
  readonly tris: number;
}

export interface InfantryKitOptions {
  /** The tracks the unit's JSON declares under `upgrades`. */
  readonly tracks?: ReadonlySet<string>;
}

export interface InfantryKitReport {
  readonly stripped: number;
  readonly grafted: readonly string[];
  readonly nodeTris: number;
  /** The most any one figure draws at maximum kit (slots superseded). */
  readonly figureTris: Readonly<Record<string, number>>;
}

/** Triangles one figure DRAWS with every track at tier 3: the highest tier in
 *  each (slot, side) only. The same filter `units/infantry-kit.ts` applies. */
export function drawnFigureTris(parts: readonly { tag: InfantryKitTag; tris: number }[]): Record<string, number> {
  const best = new Map<string, number>();
  for (const { tag } of parts) {
    if (tag.slot === undefined) continue;
    const key = `${tag.figure}/${tag.slot}/${tag.side ?? ''}`;
    best.set(key, Math.max(best.get(key) ?? 0, tag.tier));
  }
  const out: Record<string, number> = {};
  for (const { tag, tris } of parts) {
    if (tag.slot !== undefined && tag.tier !== best.get(`${tag.figure}/${tag.slot}/${tag.side ?? ''}`)) continue;
    out[tag.figure] = (out[tag.figure] ?? 0) + tris;
  }
  return out;
}

function skinOf(doc: Document, what: string): Skin {
  const skins = doc.getRoot().listSkins();
  if (skins.length !== 1) throw new Error(`${what}: ${skins.length} skins, a team has exactly one`);
  return skins[0];
}

function jointIndexByName(skin: Skin, what: string): Map<string, number> {
  const out = new Map<string, number>();
  skin.listJoints().forEach((j, i) => {
    if (out.has(j.getName())) throw new Error(`${what}: two joints are named "${j.getName()}"`);
    out.set(j.getName(), i);
  });
  return out;
}

/** Every source joint's inverse bind matrix against the target's joint of that name. */
function checkSameRig(target: Skin, source: Skin, team: string): void {
  const tIdx = jointIndexByName(target, `${team} (target)`);
  const tIbm = target.getInverseBindMatrices();
  const sIbm = source.getInverseBindMatrices();
  if (!tIbm || !sIbm) throw new Error(`${team}: a skin with no inverse bind matrices`);
  const a: number[] = new Array<number>(16).fill(0);
  const b: number[] = new Array<number>(16).fill(0);
  source.listJoints().forEach((joint, i) => {
    const j = tIdx.get(joint.getName());
    if (j === undefined) throw new Error(`${team}: the kit source skins to "${joint.getName()}", and the team's skin has no such bone`);
    sIbm.getElement(i, a);
    tIbm.getElement(j, b);
    let worst = 0;
    for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
    if (worst > IBM_TOLERANCE) {
      throw new Error(
        `${team}: the kit source's "${joint.getName()}" bind matrix differs from the team's by ${worst.toExponential(2)} -- ` +
          `the team was re-exported since the kit was fitted; run tools/units/export_infantry_kit.py again`
      );
    }
  });
}

interface Host {
  readonly node: Node;
  readonly material: ReturnType<Primitive['getMaterial']>;
  readonly indexed: boolean;
}

function liveHosts(doc: Document): Map<string, Host | string> {
  const out = new Map<string, Host | string>();
  for (const node of liveMeshNodes(doc)) {
    const name = node.getName();
    if (out.has(name)) {
      out.set(name, 'two live nodes share that name');
      continue;
    }
    const prims = node.getMesh()?.listPrimitives() ?? [];
    if (prims.length !== 1) {
      out.set(name, `it has ${prims.length} primitives, so no single material and attribute set`);
      continue;
    }
    const sems = prims[0].listSemantics().sort();
    if (sems.join() !== SKINNED_ATTRIBUTES.join()) {
      out.set(name, `it carries [${sems.join(', ')}]; a skinned host carries exactly [${SKINNED_ATTRIBUTES.join(', ')}]`);
      continue;
    }
    out.set(name, { node, material: prims[0].getMaterial(), indexed: prims[0].getIndices() !== null });
  }
  return out;
}

function checkPart(part: SourcePart, host: Host, team: string, sourceJoints: readonly string[], targetJoints: Map<string, number>): void {
  const { tag, node } = part;
  const where = `${team}: kit part "${node.getName()}"`;
  const prims = node.getMesh()?.listPrimitives() ?? [];
  if (prims.length !== 1) throw new Error(`${where}'s mesh has ${prims.length} primitives; a kit part is exactly one, merged into its host's one`);
  const src = prims[0];
  if (src.getMode() !== TRIANGLES) throw new Error(`${where}: its primitive is not TRIANGLES`);
  const sems = src.listSemantics().sort();
  if (sems.join() !== SKINNED_ATTRIBUTES.join()) {
    throw new Error(`${where}: it carries [${sems.join(', ')}], and its host "${tag.host}" [${SKINNED_ATTRIBUTES.join(', ')}]; they must match`);
  }
  if ((src.getIndices() !== null) !== host.indexed) {
    throw new Error(`${where}: it and host "${tag.host}" must both be indexed or neither -- the renderer's merge cannot concatenate the two`);
  }
  const pos = src.getAttribute('POSITION');
  const nrm = src.getAttribute('NORMAL');
  const uv = src.getAttribute('TEXCOORD_0');
  const joints = src.getAttribute('JOINTS_0');
  const weights = src.getAttribute('WEIGHTS_0');
  if (!pos || !nrm || !uv || !joints || !weights) throw new Error(`${where}: an attribute went missing after its check`);
  const count = pos.getCount();
  if ([nrm, uv, joints, weights].some((a) => a.getCount() !== count)) throw new Error(`${where}: its attributes disagree on their vertex count`);
  // One bone, weight 1: a part is rigid on the bone the manifest names.
  const wantBone = `${tag.figure}_${tag.bone}`;
  if (!targetJoints.has(wantBone)) throw new Error(`${where}: the team's skin has no bone "${wantBone}"`);
  const j = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    joints.getElement(i, j);
    weights.getElement(i, w);
    if (Math.abs(w[0] - 1) > 1e-6 || w[1] !== 0 || w[2] !== 0 || w[3] !== 0) {
      throw new Error(`${where}: vertex ${i} is not bound to one bone at weight 1 (${w.join(', ')})`);
    }
    const name = sourceJoints[j[0]];
    if (name !== wantBone) throw new Error(`${where}: vertex ${i} is bound to "${name}", but its rl_kit names "${wantBone}"`);
  }
  const el = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    nrm.getElement(i, el);
    if (!(Math.hypot(el[0], el[1], el[2]) > 0)) throw new Error(`${where}: vertex ${i} has a zero normal`);
  }
  const idx = src.getIndices();
  if (idx && !idx.getArray()) throw new Error(`${where}: its indices have no data`);
  const limit = INFANTRY_KIT_PART_TRIS[tag.part];
  if (limit === undefined) throw new Error(`${where}: part "${tag.part}" has no approved triangle count in INFANTRY_KIT_PART_TRIS`);
  if (part.tris > Math.floor(limit * INFANTRY_KIT_PART_SLACK)) {
    throw new Error(`${where}: ${part.tris} triangles is over ${INFANTRY_KIT_PART_SLACK}x the approved ${limit} for "${tag.part}"`);
  }
}

/**
 * Strip every `kit_*` node from `target`, then graft every part of `source`.
 * Every refusal is a throw naming the part, BEFORE anything is grafted.
 */
export function applyInfantryKitGraft(
  target: Document,
  source: Document,
  team: string,
  opts: InfantryKitOptions = {}
): InfantryKitReport {
  const scene = source.getRoot().listScenes()[0];
  if (!scene) throw new Error(`${team}: the kit source has no scene`);
  const targetSkin = skinOf(target, `${team} (target)`);
  const sourceSkin = skinOf(source, `${team} (kit source)`);
  checkSameRig(targetSkin, sourceSkin, team);
  const targetJoints = jointIndexByName(targetSkin, team);
  const sourceJoints = sourceSkin.listJoints().map((n) => n.getName());

  const wantBase = baseHash(target);
  const haveBase = (scene.getExtras() as Record<string, unknown>).rl_kit_base;
  if (haveBase !== wantBase) {
    throw new Error(
      `${team}: the kit source was fitted to base ${String(haveBase).slice(0, 12)}, and the team is now ${wantBase.slice(0, 12)} -- ` +
        `the team's body changed (a re-export or a re-run motion pass); run tools/units/export_infantry_kit.py again`
    );
  }

  const parts: SourcePart[] = [];
  for (const top of scene.listChildren()) {
    top.traverse((node) => {
      if (node.getMesh() === null) return; // the armature and its bones
      const tag = parseInfantryTag(node, team);
      if (opts.tracks && !opts.tracks.has(tag.track)) {
        throw new Error(
          `${team}: kit part "${node.getName()}": track "${tag.track}" is not one ${team}'s JSON declares under upgrades ` +
            `(${[...opts.tracks].sort().join(', ') || 'none'})`
        );
      }
      const idx = node.getMesh()?.listPrimitives()[0]?.getIndices();
      const tris = idx ? idx.getCount() / 3 : (node.getMesh()?.listPrimitives()[0]?.getAttribute('POSITION')?.getCount() ?? 0) / 3;
      parts.push({ node, tag, tris });
    });
  }
  if (parts.length === 0) throw new Error(`${team}: the kit source has no parts`);
  const seen = new Set<string>();
  for (const p of parts) {
    if (seen.has(p.node.getName())) throw new Error(`${team}: two kit parts named "${p.node.getName()}"`);
    seen.add(p.node.getName());
  }
  parts.sort((a, b) => (a.node.getName() < b.node.getName() ? -1 : a.node.getName() > b.node.getName() ? 1 : 0));

  const hosts = liveHosts(target);
  const resolved = parts.map((part) => {
    const host = hosts.get(part.tag.host);
    if (host === undefined) {
      throw new Error(
        `${team}: kit part "${part.node.getName()}" names host "${part.tag.host}", which is not a live mesh node ` +
          `(live: ${[...hosts.keys()].sort().join(', ')}); a part on a role the team has no primitive for would be +1 draw call`
      );
    }
    if (typeof host === 'string') throw new Error(`${team}: kit part "${part.node.getName()}" names host "${part.tag.host}", which cannot host a part: ${host}`);
    checkPart(part, host, team, sourceJoints, targetJoints);
    return { part, host };
  });

  const nodeTris = parts.reduce((n, p) => n + p.tris, 0);
  if (nodeTris > INFANTRY_KIT_FILE_TRIS) {
    throw new Error(`${team}: the kit totals ${nodeTris.toLocaleString()} triangles, over the ${INFANTRY_KIT_FILE_TRIS.toLocaleString()} a team file may carry`);
  }
  const figureTris = drawnFigureTris(parts);
  for (const [fig, n] of Object.entries(figureTris)) {
    if (n > INFANTRY_KIT_FIGURE_TRIS) {
      throw new Error(`${team}: figure ${fig} draws ${n} kit triangles at maximum kit, over the ${INFANTRY_KIT_FIGURE_TRIS} a figure may`);
    }
  }

  // Only now, with every part checked: a refused source leaves the target as it was.
  const stripped = stripKit(target);
  const buffer = target.getRoot().listBuffers()[0] ?? target.createBuffer();
  for (const host of INFANTRY_KIT_HOSTS) {
    const group = resolved.filter((r) => r.part.tag.host === host);
    if (group.length === 0) continue;
    packHost(target, host, group.map((r, id) => ({ part: r.part, id })), group[0].host, targetSkin, sourceJoints, targetJoints, buffer);
  }
  return { stripped, grafted: parts.map((p) => p.node.getName()), nodeTris, figureTris };
}

/** The per-vertex part id the packed kit primitives carry (`_rl_kit` at run time). */
export const INFANTRY_KIT_TAG_ATTR = '_RL_KIT';

/** The node a host's kit is packed into: `kit_<host>`. */
export const infantryKitHostNode = (host: string): string => `${KIT_PREFIX}${host}`;

/** One entry of `extras.rl_kit.parts` on a packed node: a part's id is its
 *  index in the table, and the value of `_RL_KIT` on every vertex of the part. */
export type PackedPart = InfantryKitTag & { readonly name: string; readonly tris: number };

/**
 * Pack every part bound for `host` into ONE primitive on ONE node, `kit_<host>`.
 *
 * Why packed, and not a node per part as the spec first drew it: a node per
 * part is 81 nodes, 81 meshes and 486 accessors for `inf_squad`, and the glTF
 * JSON that costs (about 1.2 KB a part, uncompressed even in the Draco file)
 * took the encoded file +138 KiB, over the +64 KiB budget (measured 28 Oct).
 * Packed, the JSON is two nodes and twelve accessors and the vertex data is
 * what it was. The part boundary survives as `_RL_KIT`, one byte per vertex
 * (the part's index in `extras.rl_kit.parts`), which the runtime filters on
 * (`units/infantry-kit.ts`). The Blender source is still one node per part:
 * that is the art; this is its shipping form.
 */
function packHost(
  target: Document,
  host: string,
  group: readonly { part: SourcePart; id: number }[],
  hostNode: Host,
  skin: Skin,
  sourceJoints: readonly string[],
  targetJoints: Map<string, number>,
  buffer: ReturnType<Document['createBuffer']>
): void {
  const prims = group.map((g) => {
    const p = g.part.node.getMesh()?.listPrimitives()[0];
    if (!p) throw new Error(`${g.part.node.getName()}: no primitive after its check`);
    return p;
  });
  const verts = prims.reduce((n, p) => n + (p.getAttribute('POSITION')?.getCount() ?? 0), 0);
  const indexCount = prims.reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0), 0);
  if (verts > 65535) throw new Error(`${host}: ${verts} kit vertices do not fit 16-bit indices`);
  const pos = new Float32Array(verts * 3);
  const nrm = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const jnt = new Uint8Array(verts * 4);
  const wgt = new Float32Array(verts * 4);
  const tag = new Uint8Array(verts);
  const idx = new Uint16Array(indexCount);
  const read = (a: Accessor | null, w: number, out: Float32Array, base: number): void => {
    if (!a) throw new Error(`${host}: an attribute went missing after its check`);
    const el = new Array<number>(w).fill(0);
    for (let i = 0; i < a.getCount(); i++) {
      a.getElement(i, el);
      for (let k = 0; k < w; k++) out[(base + i) * w + k] = el[k];
    }
  };
  let v0 = 0;
  let i0 = 0;
  group.forEach((g, n) => {
    const p = prims[n];
    const count = p.getAttribute('POSITION')?.getCount() ?? 0;
    read(p.getAttribute('POSITION'), 3, pos, v0);
    read(p.getAttribute('NORMAL'), 3, nrm, v0);
    read(p.getAttribute('TEXCOORD_0'), 2, uv, v0);
    read(p.getAttribute('WEIGHTS_0'), 4, wgt, v0);
    const j = p.getAttribute('JOINTS_0');
    const el = [0, 0, 0, 0];
    for (let i = 0; i < count; i++) {
      j?.getElement(i, el);
      const t = targetJoints.get(sourceJoints[el[0]]);
      if (t === undefined || t > 255) throw new Error(`${g.part.node.getName()}: joint ${el[0]} has no byte-sized target index`);
      jnt[(v0 + i) * 4] = t;
      tag[v0 + i] = g.id;
    }
    const ia = p.getIndices()?.getArray();
    if (!ia) throw new Error(`${g.part.node.getName()}: its indices have no data`);
    for (let i = 0; i < ia.length; i++) idx[i0 + i] = ia[i] + v0;
    v0 += count;
    i0 += ia.length;
  });
  const name = infantryKitHostNode(host);
  const prim = target
    .createPrimitive()
    .setMode(TRIANGLES)
    .setMaterial(hostNode.material)
    .setAttribute('POSITION', target.createAccessor(`${name}_POSITION`, buffer).setType('VEC3').setArray(pos))
    .setAttribute('NORMAL', target.createAccessor(`${name}_NORMAL`, buffer).setType('VEC3').setArray(nrm))
    .setAttribute('TEXCOORD_0', target.createAccessor(`${name}_TEXCOORD_0`, buffer).setType('VEC2').setArray(uv))
    .setAttribute('JOINTS_0', target.createAccessor(`${name}_JOINTS_0`, buffer).setType('VEC4').setArray(jnt))
    .setAttribute('WEIGHTS_0', target.createAccessor(`${name}_WEIGHTS_0`, buffer).setType('VEC4').setArray(wgt))
    .setAttribute(INFANTRY_KIT_TAG_ATTR, target.createAccessor(`${name}_KIT`, buffer).setType('SCALAR').setArray(tag))
    .setIndices(target.createAccessor(`${name}_INDICES`, buffer).setType('SCALAR').setArray(idx));
  const mesh = target.createMesh(name).addPrimitive(prim);
  const parts: PackedPart[] = group.map((g) => ({ ...g.part.tag, name: g.part.node.getName(), tris: g.part.tris }));
  const node = target
    .createNode(name)
    .setMesh(mesh)
    .setSkin(skin)
    .setTranslation(hostNode.node.getTranslation())
    .setRotation(hostNode.node.getRotation())
    .setScale(hostNode.node.getScale())
    .setExtras({ rl_kit: { host, parts } });
  const parent = hostNode.node.getParentNode();
  if (parent) parent.addChild(node);
  else {
    const scene = target.getRoot().listScenes()[0];
    if (!scene) throw new Error('no scene');
    scene.addChild(node);
  }
}

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

/** argv (after `--teams`) -> the teams to graft. Strict, for `parseKitArgs`'s reason. */
export function parseInfantryKitArgs(argv: readonly string[]): readonly string[] | 'all' {
  const ids: string[] = [];
  for (const arg of argv) {
    if (arg === '--' || arg === '--teams') continue;
    if (!arg.startsWith('--id=') || arg.length === '--id='.length) {
      throw new Error(`unrecognised argument "${arg}" -- usage: kit:meshes -- --teams [--id=<team>]... -- kit teams: ${INFANTRY_KIT_TEAMS.join(', ')}`);
    }
    ids.push(arg.slice('--id='.length));
  }
  return ids.length ? ids : 'all';
}

export function declaredTeamTracks(id: string, unitsDir: string = KDF_UNITS): ReadonlySet<string> {
  const json = JSON.parse(readFileSync(path.join(unitsDir, `${id}.json`), 'utf8')) as { upgrades?: Record<string, unknown> };
  return new Set(Object.keys(json.upgrades ?? {}));
}

export interface InfantryKitDirs {
  readonly sources?: string;
  readonly teams?: string;
  readonly units?: string;
}

export async function runInfantryKitPass(
  ids: readonly string[] | 'all',
  dirs: InfantryKitDirs = {},
  log: (line: string) => void = console.log
): Promise<readonly string[]> {
  const sourcesDir = dirs.sources ?? INFANTRY_KIT_SOURCES;
  const teamsDir = dirs.teams ?? TEAMS;
  const unitsDir = dirs.units ?? KDF_UNITS;
  const files = existsSync(sourcesDir) ? readdirSync(sourcesDir).filter((f) => f.endsWith('.glb')) : [];
  for (const f of files) {
    const id = f.slice(0, -'.glb'.length);
    if (!INFANTRY_KIT_TEAMS.includes(id)) {
      throw new Error(`${path.join(sourcesDir, f)} names no kit team -- kit teams: ${INFANTRY_KIT_TEAMS.join(', ')}`);
    }
  }
  const available = new Set(files.map((f) => f.slice(0, -'.glb'.length)));
  let wanted: readonly string[];
  if (ids === 'all') {
    wanted = INFANTRY_KIT_TEAMS.filter((id) => available.has(id));
    if (wanted.length === 0) {
      log(`KIT_PASS no infantry kit sources under ${path.relative(REPO, sourcesDir) || sourcesDir} -- nothing to graft`);
      return [];
    }
  } else {
    for (const id of ids) {
      if (!INFANTRY_KIT_TEAMS.includes(id)) throw new Error(`"${id}" is not a kit team -- kit teams: ${INFANTRY_KIT_TEAMS.join(', ')}`);
      if (!available.has(id)) throw new Error(`${id}: no kit source at ${path.join(sourcesDir, `${id}.glb`)} -- export it first`);
    }
    wanted = ids;
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const id of wanted) {
    const file = path.join(teamsDir, `${id}.glb`);
    const before = statSync(file).size;
    const target = await io.read(file);
    const source = await io.read(path.join(sourcesDir, `${id}.glb`));
    const report = applyInfantryKitGraft(target, source, id, { tracks: declaredTeamTracks(id, unitsDir) });
    await io.write(file, target);
    const after = statSync(file).size;
    const figs = Object.entries(report.figureTris).map(([f, n]) => `${f} ${n}`).join(', ');
    log(
      `KIT_PASS_OK ${id} ${report.grafted.length} kit node(s) (${report.stripped} stripped), ${report.nodeTris} tris in the file, ` +
        `drawn at max kit: ${figs}, ${after - before >= 0 ? '+' : ''}${after - before} bytes`
    );
  }
  return wanted;
}

export async function main(argv: readonly string[]): Promise<number> {
  await runInfantryKitPass(parseInfantryKitArgs(argv));
  return 0;
}
