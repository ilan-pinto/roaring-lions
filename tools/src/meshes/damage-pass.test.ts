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
import { beforeAll, describe, expect, it } from 'vitest';
import { applyDamagePass, damagePassReady, invertAffine, parseDamageArgs, stripDamage, DAMAGE_KEY, Geo } from './damage-pass';
import { DAMAGE_RECIPES, type DamageOp } from './damage-recipes';
import { applyWreckPass } from './wreck-pass';
import { WRECK_RECIPES } from './wreck-recipes';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const vehicleFile = (id: string) => path.join(REPO, 'art', 'meshes', 'vehicles', `${id}.glb`);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const ids = Object.keys(DAMAGE_RECIPES);

// Every test that runs `applyWreckPass` carries this instead of vitest's 5 s
// default: the wreck pass is what costs here (0.9-2.1 s a call on an Apple M3
// Pro under load, profiled 2026-10-15 against a 4-40 ms GLB read and a 4-48 ms
// damage pass), and it is the fact under test, so it is not cut. Measured
// single-file, 2026-10-15, per test: three runs at a load average of 12-20 on
// 12 cores read "never touches" 0.15-0.47 s, the lost-wheel pair 0.13-0.71 s,
// breakBarrel 0.24-0.38 s, the snapped rotor 0.13-0.15 s; three at 31-78 (two
// other test loops running) 0.24-2.00 / 0.23-1.86 / 0.56-1.54 / 0.31-1.52 s.
// Under a full parallel `pnpm test` on a loaded machine two of them crossed
// 5 s. The margin is for contention only: needing it on a quiet machine
// would be a regression.
const WRECK_PASS_TIMEOUT_MS = 30_000;

// meshoptimizer's WASM, for the rocket battery's `simplify`.
beforeAll(async () => {
  await damagePassReady;
});

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
  }, WRECK_PASS_TIMEOUT_MS);

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
  }, WRECK_PASS_TIMEOUT_MS);
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

/** The wheel-off corner drop: the WRECK pass's `lostWheel` and the damage pass's `dropTyre`, together. */
describe('lost wheel (wheeled hulls)', () => {
  const lostIds = Object.keys(WRECK_RECIPES).filter((id) => WRECK_RECIPES[id]!.lostWheel !== undefined);

  it('the two tables name the same wheel, both ways', () => {
    expect(lostIds.length).toBeGreaterThan(0);
    for (const id of Object.keys(DAMAGE_RECIPES)) {
      const tyres = DAMAGE_RECIPES[id]!.filter((o) => o.verb === 'dropTyre').map((o) => (o as { wheel: number }).wheel);
      const lost = WRECK_RECIPES[id]?.lostWheel;
      if (lost === undefined) expect(tyres).toEqual([]);
      else {
        expect(tyres.length).toBeGreaterThan(0);
        for (const w of tyres) expect(w).toBe(lost);
      }
    }
    for (const id of lostIds) expect(DAMAGE_RECIPES[id]).toBeDefined();
  });

  /** The live vehicle's own lowest point and half-width, measured here, never by the pass. */
  const liveExtent = (doc: Document): { ground: number; halfWidth: number } => {
    let ground = Infinity;
    let halfWidth = 0;
    for (const n of doc.getRoot().listScenes()[0]!.listChildren()) {
      if (n.getName().startsWith('kit_') || n.getName() === 'death_root') continue;
      n.traverse((x) => {
        const mesh = x.getMesh();
        if (!mesh || x.getName().startsWith('kit_')) return;
        const m = x.getWorldMatrix();
        const p = mesh.listPrimitives()[0]!.getAttribute('POSITION')!.getArray() as Float32Array;
        for (let i = 0; i < p.length; i += 3) {
          ground = Math.min(ground, m[1] * p[i]! + m[5] * p[i + 1]! + m[9] * p[i + 2]! + m[13]);
          halfWidth = Math.max(halfWidth, Math.abs(m[2] * p[i]! + m[6] * p[i + 1]! + m[10] * p[i + 2]! + m[14]));
        }
      });
    }
    return { ground, halfWidth };
  };
  const wheelOf = (doc: Document, k: number) =>
    (doc.getRoot().listScenes()[0]!.getExtras().rl_running_gear as { wheels: { centre: number[]; radius: number }[] }).wheels[k]!;

  /**
   * Named outlier, with its numbers and a DEMOTION assertion. The rocket
   * battery's slump (7 degrees nose-up) already rests it on the launcher's
   * rear overhang, 0.66 m behind the rear axle (hull_plate at x -2.45 in its
   * own frame), so its rear tyres were in the air before any was lost. Tipping
   * onto the lost corner lowers that overhang further and the seat lifts the
   * whole body: the lost axle ends 0.19 m HIGHER (measured 2026-10-15) while
   * the hull leans onto that quarter, which rests on the sand. The exemption
   * fails, and tells you to delete it, the day that axle comes down.
   */
  const ON_OVERHANG: ReadonlySet<string> = new Set(['rocket_battery']);

  it.each(lostIds)('%s: the lost corner comes down at least 0.03 m against the same wreck with all its wheels', async (id) => {
    const doc = await read(id);
    const plain = await read(id);
    applyWreckPass(plain, id, { ...WRECK_RECIPES[id]!, lostWheel: undefined });
    const c = wheelOf(doc, WRECK_RECIPES[id]!.lostWheel!).centre as [number, number, number];
    const axleY = (d: Document) => {
      const m = node(d, 'WRECK_hull_rubber').getMatrix();
      return m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13];
    };
    // 0.03, not the tyre's thickness: where the body already sat on that
    // corner (the jeep's rear) it can only come down until it is on the sand,
    // which the next test holds. Measured: Eitan 0.33, Kipod 0.31, Shachaf
    // 0.21, gun truck 0.21, jeep 0.07, technical 0.05 (design record §8).
    if (ON_OVERHANG.has(id)) {
      // Demotion: still not dropping. If this goes red, delete the exemption.
      expect(axleY(plain) - axleY(doc)).toBeLessThan(0.03);
      return;
    }
    expect(axleY(plain) - axleY(doc)).toBeGreaterThan(0.03);
  }, WRECK_PASS_TIMEOUT_MS);

  it.each(lostIds)('%s: the hull LEANS onto the lost corner, not merely sinks (at least 0.08 m more lean across that axle)', async (id) => {
    // Lean: the lost axle's height less the other wheel on the same axle's.
    // A seat alone (no tip) lowers the whole body and leaves this unchanged.
    // Measured: Eitan 0.25, Kipod 0.29, Shachaf 0.21, jeep 0.17, gun truck
    // 0.16, technical 0.12.
    const lean = (d: Document): number => {
      const ws = (d.getRoot().listScenes()[0]!.getExtras().rl_running_gear as { wheels: { side: string; centre: number[] }[] }).wheels;
      const lost = ws[WRECK_RECIPES[id]!.lostWheel!]!;
      const other = ws
        .filter((w) => w.side !== lost.side)
        .reduce((a, b) => (Math.abs(b.centre[0]! - lost.centre[0]!) < Math.abs(a.centre[0]! - lost.centre[0]!) ? b : a));
      const m = node(d, 'WRECK_hull_rubber').getMatrix();
      const y = (c: number[]) => m[1] * c[0]! + m[5] * c[1]! + m[9] * c[2]! + m[13];
      return y(lost.centre) - y(other.centre);
    };
    const doc = await read(id);
    const plain = await read(id);
    applyWreckPass(plain, id, { ...WRECK_RECIPES[id]!, lostWheel: undefined });
    expect(lean(plain) - lean(doc)).toBeGreaterThan(0.08);
  }, WRECK_PASS_TIMEOUT_MS);

  it.each(lostIds)('%s: the lost corner is down on the sand, and nothing away from that wheel is under it', async (id) => {
    const doc = await read(id);
    const { ground } = liveExtent(doc);
    const w = wheelOf(doc, WRECK_RECIPES[id]!.lostWheel!);
    const [cx, cy, cz] = w.centre as [number, number, number];
    // "At that wheel": a literal cylinder about its axle, 1.1 r round and
    // 0.5 m either side -- wider than any tyre, so the oracle does not move
    // with the pass's own tyre volume (lost-tyre.ts).
    let cornerLow = Infinity;
    let elsewhereLow = Infinity;
    for (const n of doc.getRoot().listNodes().filter((x) => x.getName().startsWith('WRECK_'))) {
      const p = n.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')!.getArray() as Float32Array;
      const m = n.getMatrix();
      const turret = n.getName().startsWith('WRECK_turret') || n.getName().startsWith('WRECK_rotor');
      for (let i = 0; i < p.length; i += 3) {
        const y = m[1] * p[i]! + m[5] * p[i + 1]! + m[9] * p[i + 2]! + m[13];
        // On the overhang outlier, "that corner" is the whole quarter of the
        // hull the lost wheel stands in (same side, same end), overhang included.
        const atWheel = ON_OVERHANG.has(id)
          ? !turret && Math.sign(p[i]!) === Math.sign(cx) && Math.sign(p[i + 2]!) === Math.sign(cz)
          : !turret && Math.hypot(p[i]! - cx, p[i + 1]! - cy) < 1.1 * w.radius && Math.abs(p[i + 2]! - cz) < 0.5;
        if (atWheel) cornerLow = Math.min(cornerLow, y);
        else elsewhereLow = Math.min(elsewhereLow, y);
      }
    }
    expect(cornerLow - ground).toBeLessThan(0.02);
    expect(elsewhereLow - ground).toBeGreaterThan(-0.005);
  });

  it.each(lostIds)('%s: the tyre lies on the sand outside the hull outline', async (id) => {
    const doc = await read(id);
    const { halfWidth } = liveExtent(doc);
    const outside = groundVerts(node(doc, 'WRECK_hull_rubber')).filter(([, y, z]) => Math.abs(z) > halfWidth + 0.15 && y < 0.6);
    expect(outside.length).toBeGreaterThan(40);
  });

  it('blowOut: the gun truck keeps a scatter of glass shards and loses the rest', async () => {
    const doc = await read('gun_truck');
    const live = node(doc, 'hull_glass').getMesh()!.listPrimitives()[0]!.getIndices()!.getCount() / 3;
    const kept = node(doc, 'WRECK_hull_glass').getMesh()!.listPrimitives()[0]!.getIndices()!.getCount() / 3;
    expect(kept).toBeGreaterThan(0);
    expect(kept / live).toBeLessThan(0.3);
  });
});

describe('snapped rotor (Peten)', () => {
  const groundYs = async (id: string, plainWreck: boolean): Promise<number[]> => {
    const doc = await read(id);
    if (plainWreck) applyWreckPass(doc, id, WRECK_RECIPES[id]!);
    return groundVerts(node(doc, 'WRECK_rotor_metal')).map((v) => v[1]);
  };
  it.each(['heli_peten', 'heli_peten_gunship'])('%s: blades hang lower and a broken piece lies on the sand', async (id) => {
    const after = await groundYs(id, false);
    const before = await groundYs(id, true);
    const mean = (a: number[]) => a.reduce((s, y) => s + y, 0) / a.length;
    // The disc's mean height drops by at least 0.3 m (the bend stood it up).
    expect(mean(before) - mean(after)).toBeGreaterThan(0.3);
    // Hundreds of rotor vertices within 0.15 m of the sand that were not there.
    const onSand = (a: number[]) => a.filter((y) => y < 0.15).length;
    expect(onSand(after) - onSand(before)).toBeGreaterThan(100);
    expect(Math.min(...after)).toBeGreaterThanOrEqual(0);
  }, WRECK_PASS_TIMEOUT_MS);
});

describe('simplified copy (rocket battery)', () => {
  const RAW_CAP = 524288; // the lead's ruling; a literal here, not DAMAGE_CAP_RAW_BYTES
  const copyRaw = (doc: Document): number => {
    const prim = node(doc, 'WRECK_hull_rubber').getMesh()!.listPrimitives()[0]!;
    return [...prim.listAttributes(), prim.getIndices()!].reduce((n, a) => n + a.getArray()!.byteLength, 0);
  };
  const withRatio = async (ratio: number): Promise<Document> => {
    const doc = await read('rocket_battery');
    const ops = DAMAGE_RECIPES.rocket_battery!.map((o) => (o.verb === 'simplify' ? { ...o, ratio } : o));
    applyDamagePass(doc, 'rocket_battery', ops);
    return doc;
  };
  const shipped = () => (DAMAGE_RECIPES.rocket_battery!.find((o) => o.verb === 'simplify') as { ratio: number }).ratio;

  it('simplifies first, so its collapses run on the shipped bytes', () => {
    expect(DAMAGE_RECIPES.rocket_battery![0]!.verb).toBe('simplify');
  });

  it('fits the raw cap at the shipped ratio, and the next 0.01 up does not: simplified only to the budget', async () => {
    expect(copyRaw(await withRatio(shipped()))).toBeLessThanOrEqual(RAW_CAP);
    expect(copyRaw(await withRatio(Math.round((shipped() + 0.01) * 100) / 100))).toBeGreaterThan(RAW_CAP);
  });
});
