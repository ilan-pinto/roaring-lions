/**
 * The running-gear pass, against documents built in memory (the shipped GLBs
 * are judged by `validate_mesh_assets.py` and `mesh_roster.test.ts`).
 *
 * The fixture is the shape the scans have, in miniature: a tyre welded to the
 * arch above it (they share rim vertices, which the pass must split), a kit
 * part hosted on the hull, and a track band welded into one loop on each side.
 */
import { describe, expect, it } from 'vitest';
import { Document, NodeIO, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  applyRunningGear,
  loopFromPoints,
  nearestOnLoop,
  parseRunningGearArgs,
  pitchFor,
  splitVertices,
} from './running-gear-pass';
import { applyKitGraft } from './kit-pass';
import { RG_EXTRAS_KEY, RG_NOT_TRACK, RG_TRACK_ATTR, RG_WHEEL_ATTR, type RgExtras } from './running-gear-contract';
import type { RunningGearRecipe } from './running-gear-recipes';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const SEG = 24;

interface Geo {
  pos: number[];
  idx: number[];
}

function addMesh(doc: Document, name: string, g: Geo, extras: Record<string, unknown> = {}): Primitive {
  const buffer = doc.getRoot().listBuffers()[0];
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor(`${name}_P`, buffer).setType('VEC3').setArray(new Float32Array(g.pos)))
    .setAttribute(
      'NORMAL',
      doc.createAccessor(`${name}_N`, buffer).setType('VEC3').setArray(new Float32Array(g.pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)))
    )
    .setIndices(doc.createAccessor(`${name}_I`, buffer).setType('SCALAR').setArray(new Uint16Array(g.idx)));
  const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)).setExtras(extras);
  doc.getRoot().listScenes()[0].addChild(node);
  return prim;
}

/** A tyre at (0, 0.5), radius 0.5, between z 1.0 and 1.2: a hub fan on the
 *  outer face and a tread band. Rim vertex 6 (the top) is SHARED with an arch
 *  triangle above it. */
function tyreAndArch(side = 1): Geo {
  const pos: number[] = [0, 0.5, 1.2 * side];
  const idx: number[] = [];
  for (let k = 0; k < SEG; k++) {
    const a = (2 * Math.PI * k) / SEG;
    pos.push(0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), 1.2 * side);
  }
  for (let k = 0; k < SEG; k++) {
    const a = (2 * Math.PI * k) / SEG;
    pos.push(0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), 1.0 * side);
  }
  for (let k = 0; k < SEG; k++) {
    const k1 = (k + 1) % SEG;
    idx.push(0, 1 + k, 1 + k1);
    idx.push(1 + k, 1 + SEG + k, 1 + k1, 1 + k1, 1 + SEG + k, 1 + SEG + k1);
  }
  // The arch: a triangle over the top, welded to the top rim vertex.
  const top = 1 + SEG / 4;
  const base = pos.length / 3;
  pos.push(-0.4, 1.2, 1.1 * side, 0.4, 1.2, 1.1 * side);
  idx.push(top, base + 1, base);
  return { pos, idx };
}

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Geo => ({
  pos: [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1],
  idx: [0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6, 4, 0, 3, 4, 3, 7, 1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7, 4, 5, 1, 4, 1, 0],
});

const WHEELED: RunningGearRecipe = {
  cut: 1.03,
  wheels: [{ side: 'r', x: 0, y: 0.5, r: 0.5, zIn: 1.0, zOut: 1.2, steer: true }],
};

function wheeledDoc(extraHull?: Geo): Document {
  const doc = new Document();
  doc.createBuffer();
  doc.createScene('scene');
  addMesh(doc, 'hull_hull', extraHull ?? box(-1, 1, 1.0, 2.0, -0.8, 0.8), { rl_role: 'hull' });
  addMesh(doc, 'hull_rubber', tyreAndArch(), { rl_role: 'rubber' });
  return doc;
}

/** A stadium-shaped track loop of `n` segments, between `z0` and `z1`. */
function trackBand(z0: number, z1: number, n = 60): Geo {
  const ring: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * 2 * Math.PI;
    ring.push([1.5 * Math.cos(t), 0.4 + 0.4 * Math.sin(t)]);
  }
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [x, y] of ring) pos.push(x, y, z0, x, y, z1);
  for (let k = 0; k < n; k++) {
    const a = 2 * k;
    const b = 2 * ((k + 1) % n);
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { pos, idx };
}

function trackedDoc(): Document {
  const doc = new Document();
  doc.createBuffer();
  doc.createScene('scene');
  addMesh(doc, 'hull_hull', box(-1, 1, 1.0, 2.0, -0.8, 0.8), { rl_role: 'hull' });
  const r = trackBand(1.0, 1.4);
  const l = trackBand(-1.4, -1.0);
  const n = r.pos.length / 3;
  addMesh(doc, 'hull_rubber', { pos: [...r.pos, ...l.pos], idx: [...r.idx, ...l.idx.map((i) => i + n)] }, { rl_role: 'rubber' });
  return doc;
}

const TRACKED: RunningGearRecipe = {
  cut: 1,
  wheels: [],
  track: { zIn: 0.9, zOut: 1.5, loopMaxY: 10, band: 0.05, minComponentTris: 10, excludeDiscs: [] },
};

function primOf(doc: Document, name: string): Primitive {
  const node = doc.getRoot().listNodes().find((n) => n.getName() === name);
  const prim = node?.getMesh()?.listPrimitives()[0];
  if (!prim) throw new Error(`no ${name}`);
  return prim;
}

function arr(prim: Primitive, sem: string): number[] {
  const a = prim.getAttribute(sem)?.getArray();
  if (!a) throw new Error(`no ${sem}`);
  return Array.from(a);
}

describe('running-gear pass: wheels', () => {
  it('keeps every existing vertex as a prefix and appends the split', () => {
    const doc = wheeledDoc();
    const before = arr(primOf(doc, 'hull_rubber'), 'POSITION');
    const report = applyRunningGear(doc, 'fixture', WHEELED);
    const after = arr(primOf(doc, 'hull_rubber'), 'POSITION');
    expect(after.slice(0, before.length)).toEqual(before);
    // Exactly one vertex is shared between the tyre and the arch.
    expect(report.addedVertices).toBe(1);
    expect(after.length).toBe(before.length + 3);
  });

  it('shares no vertex between a wheel face and a static face', () => {
    const doc = wheeledDoc();
    applyRunningGear(doc, 'fixture', WHEELED);
    const prim = primOf(doc, 'hull_rubber');
    const wheel = arr(prim, RG_WHEEL_ATTR);
    const ind = Array.from(prim.getIndices()?.getArray() ?? []);
    const faceTag = new Map<number, Set<number>>();
    for (let t = 0; t < ind.length / 3; t++) {
      const tags = new Set([wheel[ind[t * 3]], wheel[ind[t * 3 + 1]], wheel[ind[t * 3 + 2]]]);
      expect(tags.size).toBe(1);
      for (let c = 0; c < 3; c++) {
        const v = ind[t * 3 + c];
        const set = faceTag.get(v) ?? new Set<number>();
        set.add([...tags][0]);
        faceTag.set(v, set);
      }
    }
    for (const set of faceTag.values()) expect(set.size).toBe(1);
    // The arch stays static, the tyre turns.
    expect(new Set(wheel)).toEqual(new Set([0, 1]));
  });

  it('keeps every tagged vertex inside its cut disc and writes the extras', () => {
    const doc = wheeledDoc();
    applyRunningGear(doc, 'fixture', WHEELED);
    const extras = doc.getRoot().listScenes()[0].getExtras()[RG_EXTRAS_KEY] as RgExtras;
    expect(extras.wheels).toHaveLength(1);
    const w = extras.wheels[0];
    expect(w).toMatchObject({ side: 'r', index: 0, radius: 0.5, steer: true });
    const prim = primOf(doc, 'hull_rubber');
    const pos = arr(prim, 'POSITION');
    const wheel = arr(prim, RG_WHEEL_ATTR);
    let tagged = 0;
    wheel.forEach((k, v) => {
      if (k === 0) return;
      tagged++;
      expect(Math.hypot(pos[v * 3] - w.centre[0], pos[v * 3 + 1] - w.centre[1])).toBeLessThanOrEqual(w.cutRadius + 1e-6);
    });
    expect(tagged).toBe(1 + 2 * SEG);
  });

  it('writes both attributes on every tagged mesh and on its kit parts', () => {
    const doc = wheeledDoc();
    // A kit part on hull_rubber, the way the graft writes one.
    const kit = addMesh(doc, 'kit_armour_1_hull_rubber', box(0.8, 0.9, 1.0, 1.1, 0.9, 1.0), {
      rl_role: 'rubber',
      rl_kit: { track: 'armour', tier: 1, host: 'hull_rubber' },
    });
    applyRunningGear(doc, 'fixture', WHEELED);
    const host = primOf(doc, 'hull_rubber');
    expect(host.listSemantics().sort()).toEqual(['NORMAL', 'POSITION', RG_TRACK_ATTR, RG_WHEEL_ATTR].sort());
    expect(kit.listSemantics().sort()).toEqual(host.listSemantics().sort());
    expect(new Set(arr(kit, RG_WHEEL_ATTR))).toEqual(new Set([0]));
    expect(new Set(arr(kit, RG_TRACK_ATTR))).toEqual(new Set([RG_NOT_TRACK]));
    // hull_hull has no wheel face, so it is untouched.
    expect(primOf(doc, 'hull_hull').getAttribute(RG_WHEEL_ATTR)).toBeNull();
  });

  it('writes the same bytes on a second run', async () => {
    const doc = wheeledDoc();
    applyRunningGear(doc, 'fixture', WHEELED);
    const once = await io.writeBinary(doc);
    const again = await io.readBinary(once);
    applyRunningGear(again, 'fixture', WHEELED);
    const twice = await io.writeBinary(again);
    expect(Buffer.from(twice).equals(Buffer.from(once))).toBe(true);
  });

  it('refuses a wheel with no face in its disc, and overlapping discs', () => {
    expect(() =>
      applyRunningGear(wheeledDoc(), 'fixture', { cut: 1, wheels: [{ side: 'r', x: 5, y: 0.5, r: 0.5, zIn: 1, zOut: 1.2 }] })
    ).toThrow(/has no face inside its disc/);
    expect(() =>
      applyRunningGear(wheeledDoc(), 'fixture', {
        cut: 1,
        wheels: [
          { side: 'r', x: 0, y: 0.5, r: 0.5, zIn: 1, zOut: 1.2 },
          { side: 'r', x: 0.6, y: 0.5, r: 0.5, zIn: 1, zOut: 1.2 },
        ],
      })
    ).toThrow(/overlap/);
  });

  it('steers the full 20 degrees in the open, and less beside a wall', () => {
    const open = applyRunningGear(wheeledDoc(), 'fixture', WHEELED);
    expect(open.wheels[0].maxSteerDeg).toBe(20);
    // A wing just inboard of the tyre's front, outside its disc in side view.
    const wing = box(0.3, 0.9, 0.3, 0.7, 0.86, 0.96);
    const walled = applyRunningGear(wheeledDoc(wing), 'fixture', WHEELED);
    expect(walled.wheels[0].maxSteerDeg).toBeLessThan(20);
  });
});

describe('running-gear pass: tracks', () => {
  it('tags the loop on both sides, with a whole number of pitches', () => {
    const doc = trackedDoc();
    const report = applyRunningGear(doc, 'fixture', TRACKED);
    expect(report.tracks.map((t) => t.side).sort()).toEqual(['l', 'r']);
    for (const t of report.tracks) {
      expect(t.faces).toBe(120);
      expect(Math.abs(t.loopLength / t.pitch - Math.round(t.loopLength / t.pitch))).toBeLessThan(1e-4);
    }
  });

  it('lifts the low corners of a face that spans the seam', () => {
    const doc = trackedDoc();
    applyRunningGear(doc, 'fixture', TRACKED);
    const extras = doc.getRoot().listScenes()[0].getExtras()[RG_EXTRAS_KEY] as RgExtras;
    const L = extras.tracks[0].loopLength;
    const prim = primOf(doc, 'hull_rubber');
    const u = arr(prim, RG_TRACK_ATTR);
    const ind = Array.from(prim.getIndices()?.getArray() ?? []);
    let seamFaces = 0;
    for (let t = 0; t < ind.length / 3; t++) {
      const us = [u[ind[t * 3]], u[ind[t * 3 + 1]], u[ind[t * 3 + 2]]];
      expect(Math.max(...us) - Math.min(...us)).toBeLessThan(L / 2);
      if (Math.max(...us) > L) seamFaces++;
    }
    expect(seamFaces).toBeGreaterThan(0);
  });

  it('refuses a tracked recipe whose side has no track face', () => {
    expect(() =>
      applyRunningGear(trackedDoc(), 'fixture', { ...TRACKED, track: { ...TRACKED.track!, zIn: 1.45, zOut: 1.5 } })
    ).toThrow();
  });
});

describe('the loop and the split', () => {
  it('walks clockwise from the top, so the bottom run grows rearward', () => {
    const loop = loopFromPoints([
      [-1, 0],
      [1, 0],
      [1, 1],
      [-1, 1],
      [0, 0.5],
    ]);
    expect(loop.length).toBeCloseTo(6);
    const front = nearestOnLoop(loop, 0.5, 0);
    const rear = nearestOnLoop(loop, -0.5, 0);
    expect(rear.u).toBeGreaterThan(front.u);
  });

  it('rounds the pitch to a whole number of bars', () => {
    expect(pitchFor(15.65)).toBeCloseTo(15.65 / 52);
    expect(pitchFor(0.1)).toBeCloseTo(0.1);
  });

  it('keeps the static tuple on the original vertex', () => {
    const out = splitVertices(3, new Uint32Array([0, 1, 2, 0, 1, 2]), {
      wheel: new Uint8Array([1, 1, 1, 0, 0, 0]),
      track: new Float64Array(6).fill(RG_NOT_TRACK),
    });
    expect(Array.from(out.idx)).toEqual([3, 4, 5, 0, 1, 2]);
    expect(Array.from(out.wheel)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(Array.from(out.source)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('parses --id and refuses an unknown one', () => {
    expect(parseRunningGearArgs([])).toBe('all');
    expect(parseRunningGearArgs(['--', '--id=jeep_shoded'])).toEqual(['jeep_shoded']);
    expect(() => parseRunningGearArgs(['--id=heli_peten'])).toThrow(/no recipe/);
  });
});

describe('the kit pass on a running-gear host', () => {
  it('zero-fills the pair on a part grafted onto a host that carries it', async () => {
    const { kitVehicle, kitSource } = await import('./kit-fixture');
    const target = kitVehicle();
    // Give hull_hull the pair, the way the running-gear pass leaves a host.
    const host = primOf(target, 'hull_hull');
    const n = host.getAttribute('POSITION')?.getCount() ?? 0;
    const buffer = target.getRoot().listBuffers()[0];
    host.setAttribute(RG_WHEEL_ATTR, target.createAccessor('w', buffer).setType('SCALAR').setArray(new Uint8Array(n)));
    host.setAttribute(RG_TRACK_ATTR, target.createAccessor('t', buffer).setType('SCALAR').setArray(new Float32Array(n).fill(-1)));
    applyKitGraft(target, kitSource(), 'fixture');
    const part = primOf(target, 'kit_armour_1_hull_hull');
    expect(part.listSemantics().sort()).toEqual(host.listSemantics().sort());
    expect(new Set(arr(part, RG_WHEEL_ATTR))).toEqual(new Set([0]));
    expect(new Set(arr(part, RG_TRACK_ATTR))).toEqual(new Set([RG_NOT_TRACK]));
    // A part on a host without the pair gets neither.
    expect(primOf(target, 'kit_sensors_2_turret_metal').getAttribute(RG_WHEEL_ATTR)).toBeNull();
  });
});
