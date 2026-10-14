/**
 * The damage pass (`damage-pass.ts`) against the SHIPPED bytes.
 *
 * Every oracle here is a literal or a fact about the live vehicle measured
 * independently of the pass -- never a number the pass itself computed --
 * so moving a verb's own parameter cannot move its test with it (CLAUDE.md,
 * "Every check gets an input that makes it fail").
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { applyDamagePass, invertAffine, parseDamageArgs, stripDamage, DAMAGE_KEY, Geo } from './damage-pass';
import { DAMAGE_RECIPES, type DamageOp } from './damage-recipes';
import { applyWreckPass } from './wreck-pass';
import { WRECK_RECIPES } from './wreck-recipes';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const vehicleFile = (id: string) => path.join(REPO, 'art', 'meshes', 'vehicles', `${id}.glb`);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const ids = Object.keys(DAMAGE_RECIPES);

const read = (id: string): Promise<Document> => io.read(vehicleFile(id));
const node = (doc: Document, name: string): Node => {
  const hit = doc.getRoot().listNodes().find((n) => n.getName() === name);
  if (!hit) throw new Error(`no node ${name}`);
  return hit;
};
const liveBytes = (doc: Document): string[] =>
  doc
    .getRoot()
    .listNodes()
    .filter((n) => n.getMesh() && !n.getName().startsWith('WRECK_'))
    .flatMap((n) => n.getMesh()!.listPrimitives())
    .flatMap((p) => [...p.listAttributes(), p.getIndices()!])
    .map((a) => {
      const arr = a.getArray()!;
      return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
    });

/** Every vertex of a primitive, carried into the ground (death_root) frame by its node. */
function groundVerts(n: Node): [number, number, number][] {
  const m = n.getMatrix();
  const p = n.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!.getArray() as Float32Array;
  const out: [number, number, number][] = [];
  for (let i = 0; i < p.length; i += 3) {
    out.push([
      m[0] * p[i]! + m[4] * p[i + 1]! + m[8] * p[i + 2]! + m[12],
      m[1] * p[i]! + m[5] * p[i + 1]! + m[9] * p[i + 2]! + m[13],
      m[2] * p[i]! + m[6] * p[i + 1]! + m[10] * p[i + 2]! + m[14],
    ]);
  }
  return out;
}

describe('damage pass, on the shipped files', () => {
  // NOT a byte comparison with the file on disk, and that was learned on CI:
  // the pass's trigonometry (Math.sin/cos/atan in the curve, the peel and the
  // droop) is not bit-identical across Node/V8 versions, so a file written on
  // the lead's machine differs from a CI rerun in the last float bits. What
  // must hold everywhere is that the file is CURRENT: the same faces, the
  // same vertex order, every attribute within 0.1 mm of what the pass writes
  // now. Byte-stability of a re-run is held IN-PROCESS by the next test.
  it.each(ids)('%s: the file on disk is what the pass writes (same faces; every attribute within 1e-4)', async (id) => {
    const disk = await read(id);
    const doc = await read(id);
    applyDamagePass(doc, id, DAMAGE_RECIPES[id]!);
    const twins = (d: Document) =>
      d
        .getRoot()
        .listNodes()
        .filter((n) => DAMAGE_KEY in (n.getExtras() ?? {}))
        .map((n) => [n.getName(), n.getMesh()!.listPrimitives()[0]!] as const);
    const want = twins(doc);
    const got = new Map(twins(disk));
    expect([...got.keys()].sort()).toEqual(want.map(([n]) => n).sort());
    for (const [name, prim] of want) {
      const other = got.get(name)!;
      expect(Array.from(other.getIndices()!.getArray()!)).toEqual(Array.from(prim.getIndices()!.getArray()!));
      for (const sem of prim.listSemantics()) {
        const a = prim.getAttribute(sem)!.getArray()!;
        const b = other.getAttribute(sem)?.getArray();
        expect(b?.length).toBe(a.length);
        let worst = 0;
        for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b![i]!));
        expect({ twin: name, attribute: sem, worst: worst < 1e-4 }).toEqual({ twin: name, attribute: sem, worst: true });
      }
    }
  });

  it.each(ids)('%s: a re-run in one process is a no-op on the bytes', async (id) => {
    const doc = await read(id);
    applyDamagePass(doc, id, DAMAGE_RECIPES[id]!);
    const once = Buffer.from(await io.writeBinary(doc));
    applyDamagePass(doc, id, DAMAGE_RECIPES[id]!);
    expect(Buffer.from(await io.writeBinary(doc)).equals(once)).toBe(true);
  });

  it.each(ids)('%s: never touches a live accessor, and the wreck pass strips every copy', async (id) => {
    const damaged = await read(id);
    const before = liveBytes(damaged);
    // In memory: the pass itself must not write into a live accessor.
    applyDamagePass(damaged, id, DAMAGE_RECIPES[id]!);
    expect(liveBytes(damaged)).toEqual(before);
    expect(damaged.getRoot().listMeshes().some((m) => DAMAGE_KEY in (m.getExtras() ?? {}))).toBe(true);
    const rewrecked = await read(id);
    applyWreckPass(rewrecked, id, WRECK_RECIPES[id]!);
    expect(liveBytes(rewrecked)).toEqual(before);
    expect(rewrecked.getRoot().listMeshes().filter((m) => DAMAGE_KEY in (m.getExtras() ?? {}))).toEqual([]);
    // ... and a twin shares its live mesh again.
    for (const n of rewrecked.getRoot().listNodes().filter((x) => x.getName().startsWith('WRECK_'))) {
      const live = node(rewrecked, n.getName().slice('WRECK_'.length));
      expect(n.getMesh()).toBe(live.getMesh());
    }
  });

  it.each(ids)('%s: every damaged copy carries exactly its source attribute set and material', async (id) => {
    const doc = await read(id);
    const twins = doc.getRoot().listNodes().filter((n) => DAMAGE_KEY in (n.getExtras() ?? {}));
    expect(twins.length).toBeGreaterThan(0);
    for (const twin of twins) {
      const source = (twin.getExtras()[DAMAGE_KEY] as { source: string }).source;
      expect(twin.getName()).toBe(`WRECK_${source}`);
      const [copy] = twin.getMesh()!.listPrimitives();
      const [live] = node(doc, source).getMesh()!.listPrimitives();
      expect(copy!.getMaterial()).toBe(live!.getMaterial());
      const shape = (p: typeof copy) =>
        p!.listSemantics().map((s) => [s, p!.getAttribute(s)!.getComponentType(), p!.getAttribute(s)!.getType()]);
      expect(shape(copy)).toEqual(shape(live));
    }
  });

  it('stripDamage then applyDamagePass leaves no orphan accessor (byte-stable twice in a row)', async () => {
    const doc = await read('mbt_lavi');
    stripDamage(doc);
    const plain = Buffer.from(await io.writeBinary(doc));
    applyDamagePass(doc, 'mbt_lavi', DAMAGE_RECIPES.mbt_lavi!);
    stripDamage(doc);
    expect(Buffer.from(await io.writeBinary(doc)).equals(plain)).toBe(true);
  });
});

/** The outline each verb promises, measured in the ground frame against literals. */
describe('damage verbs change the OUTLINE (Lavi)', () => {
  const op = <V extends DamageOp['verb']>(verb: V) =>
    DAMAGE_RECIPES.mbt_lavi!.find((o) => o.verb === verb) as Extract<DamageOp, { verb: V }>;

  // The live hull's half-width, |z| of hull_hull's bounds, measured
  // 2026-10-14 -- literals, so the strip's own `out0` cannot move the bar.
  it.each([
    ['mbt_lavi', 1.45],
    ['officer_armour', 1.45],
    ['ifv_namer', 2.06],
    ['dozer_d9', 2.13],
  ] as const)('throwTrack (%s): hundreds of rubber vertices lie on the sand OUTSIDE the hull footprint', async (id, halfWidth) => {
    const doc = await read(id);
    const outside = groundVerts(node(doc, 'WRECK_hull_rubber')).filter(([, y, z]) => Math.abs(z) > halfWidth + 0.15 && y < 0.1);
    expect(outside.length).toBeGreaterThan(200);
  });

  it('peelPlate: the torn plate stands proud of the hull side', async () => {
    const doc = await read('mbt_lavi');
    const plate = op('peelPlate');
    // In the twin's OWN frame: the live hull is |z| <= 1.45 (hull_hull's
    // bounds, measured 2026-10-14). A skirt plate torn and swung outward
    // must reach at least 0.45 m beyond that.
    const p = node(doc, 'WRECK_hull_hull').getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!.getArray() as Float32Array;
    let out = -Infinity;
    for (let i = 0; i < p.length; i += 3) out = Math.max(out, p[i + 2]! * plate.side);
    expect(out).toBeGreaterThan(1.9);
  });

  it('breakBarrel: the muzzle droops at least 0.4 m nearer the sand than the slumped wreck held it', async () => {
    // The muzzle: the live tube's vertices forward of x 2.9 (the census in
    // damage-recipes.ts: nothing on turret_metal between x 1.79 and 3.00).
    const muzzleY = (doc: Document): number => {
      const n = node(doc, 'WRECK_turret_metal');
      const m = n.getMatrix();
      const p = n.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!.getArray() as Float32Array;
      let y = 0;
      let k = 0;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i]! <= 2.9) continue;
        y += m[1] * p[i]! + m[5] * p[i + 1]! + m[9] * p[i + 2]! + m[13];
        k++;
      }
      expect(k).toBeGreaterThan(0);
      return y / k;
    };
    const broken = await read('mbt_lavi');
    const plain = await read('mbt_lavi');
    applyWreckPass(plain, 'mbt_lavi', WRECK_RECIPES.mbt_lavi!);
    expect(muzzleY(plain) - muzzleY(broken)).toBeGreaterThan(0.4);
    // and nothing on it goes under the ground
    expect(Math.min(...groundVerts(node(broken, 'WRECK_turret_metal')).map((v) => v[1]))).toBeGreaterThanOrEqual(0);
  });
});

describe('damage pass, pieces', () => {
  it('invertAffine inverts a rotation plus translation', () => {
    const c = Math.cos(0.7);
    const s = Math.sin(0.7);
    const m = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 3, -2, 5, 1] as unknown as Parameters<typeof invertAffine>[0];
    const inv = invertAffine(m);
    const p = [0.3, 1.1, -2.4];
    const q = [0, 1, 2].map((r) => m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]!);
    const back = [0, 1, 2].map((r) => inv[r]! * q[0]! + inv[4 + r]! * q[1]! + inv[8 + r]! * q[2]! + inv[12 + r]!);
    back.forEach((v, k) => expect(v).toBeCloseTo(p[k]!, 9));
  });

  it('Geo.compact drops unused vertices and keeps every face', async () => {
    const doc = await read('mbt_lavi');
    const g = new Geo(node(doc, 'hull_rubber').getMesh()!.listPrimitives()[0]!);
    const faces = g.faces;
    g.cut((f) => f % 2 === 0);
    const kept = g.faces;
    g.compact();
    expect(g.faces).toBe(kept);
    expect(kept).toBe(Math.floor(faces / 2));
    expect(Math.max(...g.idx)).toBe(g.count - 1);
  });

  it('refuses an unrecognised argument rather than rewriting every vehicle', () => {
    expect(() => parseDamageArgs(['--id', 'mbt_lavi'])).toThrow(/unrecognised/);
    expect(parseDamageArgs(['--', '--id=mbt_lavi'])).toEqual(['mbt_lavi']);
    expect(parseDamageArgs([])).toBe('all');
  });
});
