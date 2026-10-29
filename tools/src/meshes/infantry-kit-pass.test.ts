/**
 * The infantry kit pass (GH-826), against an in-memory team and kit source.
 *
 * What it pins: the packed `kit_<host>` nodes land on the team's own skin with
 * their host's material and attribute set; JOINTS_0 is re-pointed BY NAME when
 * the source skin lists its bones in another order; every live accessor is
 * byte-identical afterwards and a second run writes the same bytes; and every
 * refusal the contract names is a throw that leaves the target exactly as it
 * was. Each refusal is exercised by a source built to break that one rule.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import {
  INFANTRY_KIT_TAG_ATTR,
  applyInfantryKitGraft,
  baseHash,
  drawnFigureTris,
  parseInfantryKitArgs,
  runInfantryKitPass,
  type InfantryKitTag,
} from './infantry-kit-pass';
import { INFANTRY_KIT_PART_TRIS, infantryKitNodeName } from './kit-contract';

const io = new NodeIO();
const bufferOf = (d: Document) => d.getRoot().listBuffers()[0] ?? d.createBuffer();

/** The team's bones, in the target's order. */
const BONES = ['f0_root', 'f0_spine', 'f0_head', 'f0_weapon', 'f1_root', 'f1_spine', 'f1_head', 'f1_weapon', 'f2_root', 'f2_spine', 'f2_head', 'f2_weapon'];

interface PartSpec {
  track: string;
  tier: number;
  part: string;
  figure: string;
  bone: string;
  host?: string;
  side?: 'L' | 'R';
  slot?: string;
  tris?: number;
  /** Override what the vertices are bound to (a part that lies about its bone). */
  boundTo?: string;
  weight?: number;
}

/** A skin over `names` (in that order), joint `i` bound at x = i, so every bind matrix differs. */
function addSkin(doc: Document, names: readonly string[], ibmShift = 0) {
  const joints = names.map((n) => doc.createNode(n));
  const ibm = new Float32Array(names.length * 16);
  names.forEach((n, i) => {
    const x = BONES.indexOf(n) + (i === 0 ? ibmShift : 0);
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, 0, 0, 1], i * 16);
  });
  const acc = doc.createAccessor('ibm', bufferOf(doc)).setType('MAT4').setArray(ibm);
  const skin = doc.createSkin('rig').setInverseBindMatrices(acc);
  const scene = doc.getRoot().listScenes()[0];
  for (const j of joints) {
    skin.addJoint(j);
    scene.addChild(j);
  }
  return skin;
}

/** A triangle strip of `tris` triangles, every vertex bound to joint `joint` (weight `w`). */
function meshOf(doc: Document, name: string, tris: number, joint: number, w = 1, indexed = true) {
  const n = tris * 3;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const jnt = new Uint8Array(n * 4);
  const wgt = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    pos.set([v * 0.01, 1 + (v % 3) * 0.01, 0], v * 3);
    nrm.set([0, 1, 0], v * 3);
    uv.set([0.25, 0.75], v * 2);
    jnt[v * 4] = joint;
    wgt[v * 4] = w;
    if (w < 1) wgt[v * 4 + 1] = 1 - w;
  }
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor(`${name}_p`, bufferOf(doc)).setType('VEC3').setArray(pos))
    .setAttribute('NORMAL', doc.createAccessor(`${name}_n`, bufferOf(doc)).setType('VEC3').setArray(nrm))
    .setAttribute('TEXCOORD_0', doc.createAccessor(`${name}_t`, bufferOf(doc)).setType('VEC2').setArray(uv))
    .setAttribute('JOINTS_0', doc.createAccessor(`${name}_j`, bufferOf(doc)).setType('VEC4').setArray(jnt))
    .setAttribute('WEIGHTS_0', doc.createAccessor(`${name}_w`, bufferOf(doc)).setType('VEC4').setArray(wgt));
  if (indexed) prim.setIndices(doc.createAccessor(`${name}_i`, bufferOf(doc)).setType('SCALAR').setArray(new Uint16Array([...Array(n).keys()])));
  return doc.createMesh(name).addPrimitive(prim);
}

/** The shipped-shaped team: a `uniform` and a `weapon` role mesh on one skin, one shared material. */
async function makeTeam(): Promise<Document> {
  const doc = await io.readJSON({ json: { asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 }, resources: {} });
  const scene = doc.getRoot().listScenes()[0];
  const skin = addSkin(doc, BONES);
  const mat = doc.createMaterial('BakedMaterial');
  for (const [role, tris, joint] of [['uniform', 6, 1], ['weapon', 3, 3]] as const) {
    const mesh = meshOf(doc, role, tris, joint);
    mesh.listPrimitives()[0].setMaterial(mat);
    scene.addChild(doc.createNode(role).setMesh(mesh).setSkin(skin).setExtras({ rl_role: role }));
  }
  return doc;
}

const DEFAULT_PARTS: PartSpec[] = [
  { track: 'armour', tier: 1, part: 'helmet_cover', figure: 'f0', bone: 'head', tris: 20 },
  { track: 'armour', tier: 2, part: 'deltoid', figure: 'f0', bone: 'spine', side: 'L', slot: 'shoulder', tris: 12 },
  { track: 'armour', tier: 3, part: 'sleeve', figure: 'f0', bone: 'spine', side: 'L', slot: 'shoulder', tris: 15 },
  { track: 'firepower', tier: 1, part: 'red_dot', figure: 'f0', bone: 'weapon', host: 'weapon', slot: 'optic', tris: 7 },
  { track: 'firepower', tier: 1, part: 'red_dot', figure: 'f1', bone: 'weapon', host: 'weapon', slot: 'optic', tris: 7 },
  { track: 'sensors', tier: 1, part: 'nvg_mount', figure: 'f1', bone: 'head', tris: 9 },
];

/**
 * A kit source: a node per part on a skin that lists the bones in REVERSE, so
 * every JOINTS_0 in it is wrong for the target until it is mapped by name.
 */
async function makeSource(target: Document, parts: PartSpec[] = DEFAULT_PARTS, opts: { base?: string; ibmShift?: number; extraJoint?: string } = {}): Promise<Document> {
  const doc = await io.readJSON({ json: { asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 }, resources: {} });
  const scene = doc.getRoot().listScenes()[0];
  const names = [...BONES].reverse();
  if (opts.extraJoint) names.push(opts.extraJoint);
  const skin = addSkin(doc, names, opts.ibmShift ?? 0);
  scene.setExtras({ rl_kit_base: opts.base ?? baseHash(target) });
  const mat = doc.createMaterial('stub');
  for (const p of parts) {
    const name = infantryKitNodeName(p.track, p.tier, p.part, p.figure, p.side);
    const bound = p.boundTo ?? `${p.figure}_${p.bone}`;
    const mesh = meshOf(doc, name, p.tris ?? 6, names.indexOf(bound), p.weight ?? 1);
    mesh.listPrimitives()[0].setMaterial(mat);
    const tag: Record<string, unknown> = { track: p.track, tier: p.tier, host: p.host ?? 'uniform', part: p.part, figure: p.figure, bone: p.bone };
    if (p.slot) tag.slot = p.slot;
    if (p.side) tag.side = p.side;
    scene.addChild(doc.createNode(name).setMesh(mesh).setSkin(skin).setExtras({ rl_kit: tag }));
  }
  return doc;
}

const bytesOf = async (d: Document): Promise<string> => Buffer.from(await io.writeBinary(d)).toString('base64');
const nodeNamed = (d: Document, n: string): Node => {
  const f = d.getRoot().listNodes().find((x) => x.getName() === n);
  if (!f) throw new Error(`no node ${n}`);
  return f;
};

describe('applyInfantryKitGraft', () => {
  it('packs the parts into one node per host, on the team skin, with the host material and attributes plus the part id', async () => {
    const t = await makeTeam();
    const report = applyInfantryKitGraft(t, await makeSource(t), 'sq');
    expect(report.grafted).toHaveLength(DEFAULT_PARTS.length);
    const kitU = nodeNamed(t, 'kit_uniform');
    const kitW = nodeNamed(t, 'kit_weapon');
    for (const [kit, host] of [[kitU, 'uniform'], [kitW, 'weapon']] as const) {
      const prim = kit.getMesh()!.listPrimitives();
      expect(prim).toHaveLength(1);
      const h = nodeNamed(t, host).getMesh()!.listPrimitives()[0];
      expect(prim[0].getMaterial()).toBe(h.getMaterial());
      expect(kit.getSkin()).toBe(nodeNamed(t, host).getSkin());
      expect(prim[0].listSemantics().sort()).toEqual([...h.listSemantics(), INFANTRY_KIT_TAG_ATTR].sort());
      expect(prim[0].getIndices()).not.toBeNull();
    }
    // 4 parts on the uniform, 2 on the weapon, sorted by node name, ids by position
    const partsU = (kitU.getExtras().rl_kit as { parts: { name: string }[] }).parts;
    expect(partsU.map((p) => p.name)).toEqual([...partsU.map((p) => p.name)].sort());
    expect(partsU).toHaveLength(4);
    expect((kitW.getExtras().rl_kit as { parts: unknown[] }).parts).toHaveLength(2);
  });

  it('tags every vertex with its part id, and gives each part its own triangles', async () => {
    const t = await makeTeam();
    applyInfantryKitGraft(t, await makeSource(t), 'sq');
    const kit = nodeNamed(t, 'kit_uniform');
    const parts = (kit.getExtras().rl_kit as { parts: { name: string; tris: number }[] }).parts;
    const prim = kit.getMesh()!.listPrimitives()[0];
    const tag = prim.getAttribute(INFANTRY_KIT_TAG_ATTR)!.getArray() as Uint8Array;
    const counts = new Map<number, number>();
    for (const id of tag) counts.set(id, (counts.get(id) ?? 0) + 1);
    parts.forEach((p, id) => expect(counts.get(id)).toBe(p.tris * 3));
    // every triangle's three indices land on one part
    const idx = prim.getIndices()!.getArray()!;
    for (let i = 0; i < idx.length; i += 3) expect(new Set([tag[idx[i]], tag[idx[i + 1]], tag[idx[i + 2]]]).size).toBe(1);
  });

  it('maps JOINTS_0 by bone NAME, not by the source skin\'s order', async () => {
    const t = await makeTeam();
    applyInfantryKitGraft(t, await makeSource(t), 'sq');
    const kit = nodeNamed(t, 'kit_uniform');
    const prim = kit.getMesh()!.listPrimitives()[0];
    const joints = prim.getAttribute('JOINTS_0')!;
    const tag = prim.getAttribute(INFANTRY_KIT_TAG_ATTR)!;
    const skinJoints = kit.getSkin()!.listJoints().map((j) => j.getName());
    const parts = (kit.getExtras().rl_kit as { parts: { figure: string; bone: string }[] }).parts;
    const el = [0, 0, 0, 0];
    for (let v = 0; v < joints.getCount(); v++) {
      joints.getElement(v, el);
      const p = parts[tag.getScalar(v)];
      expect(skinJoints[el[0]]).toBe(`${p.figure}_${p.bone}`);
    }
  });

  it('keeps every live accessor byte-identical and writes the same bytes on a second run', async () => {
    const t = await makeTeam();
    const before = baseHash(t);
    const src = await makeSource(t);
    applyInfantryKitGraft(t, src, 'sq');
    expect(baseHash(t)).toBe(before);
    const once = await bytesOf(t);
    const report = applyInfantryKitGraft(t, src, 'sq');
    expect(report.stripped).toBe(2);
    expect(await bytesOf(t)).toBe(once);
  });

  describe('refusals leave the target exactly as it was', () => {
    const refuses = async (build: (t: Document) => Promise<Document>, why: RegExp, opts: Parameters<typeof applyInfantryKitGraft>[3] = {}) => {
      const t = await makeTeam();
      const before = await bytesOf(t);
      const src = await build(t);
      expect(() => applyInfantryKitGraft(t, src, 'sq', opts)).toThrow(why);
      expect(await bytesOf(t)).toBe(before);
    };

    it('a source fitted to another base (the team was re-exported or re-motioned)', () =>
      refuses((t) => makeSource(t, DEFAULT_PARTS, { base: 'deadbeef' }), /was fitted to base deadbeef/));

    it('a skin whose bind matrix moved', () => refuses((t) => makeSource(t, DEFAULT_PARTS, { ibmShift: 0.05 }), /bind matrix differs/));

    it('a bone the team has not got', () => refuses((t) => makeSource(t, DEFAULT_PARTS, { extraJoint: 'f9_tail' }), /no such bone/));

    it('a part whose node name is not its rl_kit', () =>
      refuses(async (t) => {
        const s = await makeSource(t);
        nodeNamed(s, 'kit_armour_1_helmet_cover_f0').setName('kit_armour_1_helmet_cover_f1');
        return s;
      }, /does not match its rl_kit/));

    it('a track the unit does not declare', () =>
      refuses((t) => makeSource(t), /track "sensors" is not one sq's JSON declares/, { tracks: new Set(['armour', 'firepower']) }));

    it('a tier outside 1-3', () =>
      refuses(async (t) => {
        const s = await makeSource(t);
        nodeNamed(s, 'kit_armour_1_helmet_cover_f0').setExtras({ rl_kit: { ...(nodeNamed(s, 'kit_armour_1_helmet_cover_f0').getExtras().rl_kit as object), tier: 4 } });
        return s;
      }, /outside 1-3/));

    it('a host that is not a role the team has (that would be +1 draw call)', () =>
      refuses((t) => makeSource(t, [{ track: 'armour', tier: 1, part: 'helmet_cover', figure: 'f0', bone: 'head', host: 'uniform' }, { track: 'sensors', tier: 1, part: 'nvg_mount', figure: 'f0', bone: 'head', host: 'visor' }]), /not a role primitive a kit part may join/));

    it('a host the team has no primitive for', async () => {
      const t = await makeTeam();
      nodeNamed(t, 'weapon').dispose();
      const before = await bytesOf(t);
      const src = await makeSource(t, DEFAULT_PARTS, { base: baseHash(t) });
      expect(() => applyInfantryKitGraft(t, src, 'sq')).toThrow(/names host "weapon", which is not a live mesh node/);
      expect(await bytesOf(t)).toBe(before);
    });

    it('a vertex bound to another bone than the part declares', () =>
      refuses((t) => makeSource(t, [{ track: 'armour', tier: 1, part: 'helmet_cover', figure: 'f0', bone: 'head', boundTo: 'f0_spine' }]), /bound to "f0_spine", but its rl_kit names "f0_head"/));

    it('a vertex that is not rigid (weight below 1)', () =>
      refuses((t) => makeSource(t, [{ track: 'armour', tier: 1, part: 'helmet_cover', figure: 'f0', bone: 'head', weight: 0.5 }]), /not bound to one bone at weight 1/));

    it('a part over 1.10x its approved triangles', () =>
      refuses((t) => makeSource(t, [{ track: 'armour', tier: 2, part: 'yoke', figure: 'f0', bone: 'spine', tris: Math.floor(INFANTRY_KIT_PART_TRIS.yoke * 1.1) + 1 }]), /over 1.1x the approved 32/));

    it('a part with no approved size', () =>
      refuses((t) => makeSource(t, [{ track: 'armour', tier: 2, part: 'cape', figure: 'f0', bone: 'spine' }]), /no approved triangle count/));

    it('a figure that draws more than 1,200 triangles at maximum kit', () => {
      const many: PartSpec[] = [];
      for (const track of ['armour', 'sensors', 'firepower']) for (const tier of [1, 2, 3]) for (const side of ['L', 'R'] as const) {
        many.push({ track, tier, part: 'helmet_cover', figure: 'f0', bone: 'head', side, tris: 70 });
      }
      return refuses((t) => makeSource(t, many), /figure f0 draws 1260 kit triangles/);
    });

    it('a file that carries more than 5,000 kit triangles', () => {
      const many: PartSpec[] = [];
      for (const figure of ['f0', 'f1']) for (const track of ['armour', 'sensors', 'firepower']) for (const tier of [1, 2, 3]) for (const side of ['L', 'R'] as const) {
        many.push({ track, tier, part: 'carrier', figure, bone: 'spine', side, tris: 200 });
      }
      // 36 x 200 = 7200 (over the file cap already, each node inside its own 1.10 x 190); a third figure's worth on top
      for (const track of ['armour', 'sensors', 'firepower']) for (const tier of [1, 2, 3]) for (const side of ['L', 'R'] as const) {
        many.push({ track, tier, part: 'carrier', figure: 'f2', bone: 'spine', side, tris: 200 });
      }
      return refuses((t) => makeSource(t, many), /over the 5,000 a team file may carry/);
    });
  });
});

describe('drawnFigureTris', () => {
  const tag = (o: Partial<InfantryKitTag> & { tier: number }): InfantryKitTag => ({ track: 'armour', host: 'uniform', part: 'p', figure: 'f0', bone: 'spine', ...o });
  it('counts only the highest tier of a slot, per side, and everything with no slot', () => {
    const drawn = drawnFigureTris([
      { tag: tag({ tier: 2, slot: 's', side: 'L' }), tris: 10 },
      { tag: tag({ tier: 3, slot: 's', side: 'L' }), tris: 30 },
      { tag: tag({ tier: 2, slot: 's', side: 'R' }), tris: 5 },
      { tag: tag({ tier: 1 }), tris: 100 },
      { tag: tag({ tier: 1, figure: 'f1' }), tris: 7 },
    ]);
    expect(drawn).toEqual({ f0: 30 + 5 + 100, f1: 7 });
  });
});

describe('the CLI', () => {
  it('parses --teams and --id, and refuses anything else', () => {
    expect(parseInfantryKitArgs(['--', '--teams'])).toBe('all');
    expect(parseInfantryKitArgs(['--teams', '--id=inf_squad'])).toEqual(['inf_squad']);
    expect(() => parseInfantryKitArgs(['--teams', '--wat'])).toThrow(/unrecognised argument/);
    expect(() => parseInfantryKitArgs(['--teams', '--id='])).toThrow(/unrecognised argument/);
  });

  it('grafts a team on disk, and refuses a source that names no kit team', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'inf-kit-'));
    try {
      const teams = path.join(dir, 'teams');
      const sources = path.join(dir, 'sources');
      const units = path.join(dir, 'units');
      for (const d of [teams, sources, units]) mkdirSync(d);
      writeFileSync(path.join(units, 'inf_squad.json'), JSON.stringify({ upgrades: { armour: {}, sensors: {}, firepower: {} } }));
      const t = await makeTeam();
      await io.write(path.join(teams, 'inf_squad.glb'), t);
      await io.write(path.join(sources, 'inf_squad.glb'), await makeSource(t));
      const lines: string[] = [];
      expect(await runInfantryKitPass('all', { teams, sources, units }, (l) => lines.push(l))).toEqual(['inf_squad']);
      expect(lines[0]).toMatch(/KIT_PASS_OK inf_squad 6 kit node\(s\) \(0 stripped\)/);
      const after = await io.read(path.join(teams, 'inf_squad.glb'));
      expect(nodeNamed(after, 'kit_uniform')).toBeDefined();
      await io.write(path.join(sources, 'inf_stranger.glb'), await makeSource(t));
      await expect(runInfantryKitPass('all', { teams, sources, units })).rejects.toThrow(/names no kit team/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
