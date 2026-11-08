/**
 * @vitest-environment jsdom
 *
 * GH-943 P2 (T5) gates for `selection-ring.node.ts`. The graph is compiled to GLSL by three's own `GLSLNodeBuilder` (no GPU), on the
 * REAL ring batch's mesh, so these read the real generated shader and the real attribute set. Each spec has a one-line falsification,
 * run by hand and listed in the commit message.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NUMBER_OPS } from '../fog-ops';
import { DECAL_POLYGON_OFFSET_FACTOR, DECAL_POLYGON_OFFSET_UNITS } from '../decal-pool';
import { MATERIAL_MATHS } from '../material-maths';
import { adoptMaterials, createTwinCache, legacyTwinSlot } from '../node-material-adoption';
import { censusUnported, PORTED_MATERIAL_KEYS } from '../backend/unported';
import { SELECTION_RING, TEAM_RING, WOUND_RING } from './readability';
import {
  RING_STYLE_KEY as LEGACY_STYLE_KEY,
  ringFragmentOps,
  ringPxPerTile,
  SELECTION_RING_MATERIAL_NAME,
  SelectionRingBatch,
  type RingStyle,
} from './selection-ring';
import {
  createNodeRingMaterial,
  NODE_RING_MATERIAL_NAME,
  RING_BOUND_KEY,
  RING_STYLE_KEY,
  type RingTwinBound,
  type RingUniformRecord,
} from './selection-ring.node';

const SHADOW: readonly [number, number, number] = [0.02, 0.03, 0.04];
const NODE_MATERIAL_MARKER = 'rl-node-material-';

// LITERALS, never imported from the code under test: the shipped selection style as numbers.
const STYLE: RingStyle = { coreAlpha: 0.95, haloAlpha: 0.5, thicknessTiles: 0.1, minThicknessPx: 2.5 };
const WOUND: RingStyle = {
  coreAlpha: 0.95,
  haloAlpha: 0.55,
  thicknessTiles: 0.07,
  minThicknessPx: 2.5,
  arcThicken: 1.8,
  arcExtraMaxPx: 2,
  pulsePeriodS: 1.6,
  pulseMinAlpha: 0.55,
};

/** The coverage at `(x, z)` of a unit circle, on numbers. */
function cover(style: RingStyle, x: number, z: number, pxPerTile: number, arc?: { fraction: number; pulse: number; timeSec: number; pulseOn: number }) {
  return ringFragmentOps(NUMBER_OPS, style, { localX: x, localZ: z, axA: 1, axB: 1, pxPerTile, arc });
}

describe('the ring fragment maths on numbers (literals)', () => {
  it('the core is solid over [-w, 0], the halo is solid just outside, and the two never both cover', () => {
    // pxPerTile 100: the pixel floor is 0.025 tiles, so w = 0.1.
    const inside = cover(STYLE, 0.95, 0, 100);
    expect(inside.ca).toBeCloseTo(0.95, 12);
    expect(inside.ha).toBeCloseTo(0, 12);
    const outside = cover(STYLE, 1.02, 0, 100);
    expect(outside.ca).toBeCloseTo(0, 12);
    expect(outside.ha).toBeCloseTo(0.5, 12);
    // Centre of the ring and far outside: nothing.
    expect(cover(STYLE, 0, 0, 100).a).toBeCloseTo(0, 12);
    expect(cover(STYLE, 1.2, 0, 100).a).toBe(0);
  });
  it('the combined alpha is ca + ha (1 - ca)', () => {
    const c = cover(STYLE, 1.007, 0, 100);
    expect(c.a).toBeCloseTo(c.ca + c.ha * (1 - c.ca), 12);
    expect(c.ca).toBeGreaterThan(0);
    expect(c.ha).toBeGreaterThan(0);
  });
  it('the pixel floor binds on a thin axis: at 10 px per tile the core is 0.25 tiles wide, at 100 it is 0.1', () => {
    // 0.2 tiles inside the edge: outside a 0.1 core, inside a 0.25 one.
    expect(cover(STYLE, 0.8, 0, 100).ca).toBe(0);
    expect(cover(STYLE, 0.8, 0, 10).ca).toBeCloseTo(0.95, 12);
  });
  it('the ellipse is exact on both semi-axes (a = 2, b = 1)', () => {
    const o = (x: number, z: number) => ringFragmentOps(NUMBER_OPS, STYLE, { localX: x, localZ: z, axA: 2, axB: 1, pxPerTile: 100 });
    // On the outer edge of each semi-axis the core is at its feather's midpoint: the same value on both.
    expect(o(2, 0).ca).toBeCloseTo(o(0, 1).ca, 9);
    expect(o(1.95, 0).ca).toBeCloseTo(0.95, 9);
    expect(o(0, 0.95).ca).toBeCloseTo(0.95, 9);
  });
});

describe('the wound ring\'s arc and pulse, on numbers (literals)', () => {
  // Direction (-1, -1) in (x, z) is the sweep's zero (3/8 of a turn before atan's zero). r = 0.91 is 0.09 inside the edge.
  const r = 0.91 / Math.SQRT2;
  const arc = (fraction: number, pulse: number, timeSec: number, pulseOn: number) => ({ fraction, pulse, timeSec, pulseOn });
  it('the sweep thickens the core inward over its fraction of the circle and only there', () => {
    // pxPerTile 100: w = 0.07, the arc adds min(0.056, 2 / 100) = 0.02, so 0.09 inside the edge is inside the thick core only.
    expect(cover(WOUND, -r, -r, 100, arc(0.5, 0, 0, 1)).ca).toBeCloseTo(0.95, 9);
    expect(cover(WOUND, -r, -r, 100, arc(0, 0, 0, 1)).ca).toBe(0);
    // The opposite side of the circle is turn 0.5: outside a quarter sweep.
    expect(cover(WOUND, r, r, 100, arc(0.25, 0, 0, 1)).ca).toBe(0);
  });
  it('breathes on the clock it is given: t = 0 is the middle of the swing, a quarter period is full, and pulse 0 holds it', () => {
    const at = (t: number, pulse: number, on: number) => cover(WOUND, 0.95, 0, 100, arc(0, pulse, t, on)).ca;
    expect(at(0, 1, 1)).toBeCloseTo(0.95 * (0.55 + 0.45 * 0.5), 9);
    expect(at(0.4, 1, 1)).toBeCloseTo(0.95, 9);
    expect(at(0.4, 1, 1)).not.toBeCloseTo(at(0, 1, 1), 3);
    // `uPulseOn` 0 (reduced motion) and a man no longer bleeding hold it steady at 1.
    expect(at(0, 1, 0)).toBeCloseTo(0.95, 9);
    expect(at(0, 0, 1)).toBeCloseTo(0.95, 9);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------

interface Compiled {
  readonly glsl: string;
  readonly vertex: string;
  readonly used: ReadonlySet<unknown>;
}

async function compile(mesh: THREE.Mesh): Promise<Compiled> {
  const W = await import('three/webgpu');
  const r = new W.WebGPURenderer({ forceWebGL: true });
  const builder = new W.GLSLNodeBuilder(mesh as never, r) as unknown as {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: unknown;
    build(): void;
    uniforms: { fragment: Array<{ node: unknown }> };
    fragmentShader: string;
    vertexShader: string;
  };
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.OrthographicCamera();
  builder.material = mesh.material;
  builder.build();
  return { glsl: builder.fragmentShader, vertex: builder.vertexShader, used: new Set<unknown>(builder.uniforms.fragment.map((u) => u.node)) };
}

async function twinOf(batch: SelectionRingBatch): Promise<THREE.Material> {
  const W = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const legacy = batch.material;
  return createNodeRingMaterial(
    { W, TSL: TSL as never, maths: MATERIAL_MATHS.ring },
    legacy.userData[RING_STYLE_KEY] as RingStyle,
    legacy.uniforms as unknown as RingUniformRecord
  );
}

const ringBatch = (style?: RingStyle): SelectionRingBatch => new SelectionRingBatch({ capacity: 4, resolveShadow: () => SHADOW, style });
const boundOf = (m: THREE.Material): RingTwinBound => m.userData[RING_BOUND_KEY] as RingTwinBound;
type Updatable = { update(): void; value: unknown };

describe('the twin graph', () => {
  it('reads the style the legacy material carries under the key both sides spell', () => {
    expect(RING_STYLE_KEY).toBe(LEGACY_STYLE_KEY);
    expect(ringBatch(WOUND).material.userData[RING_STYLE_KEY]).toBe(WOUND);
  });

  it('is an unlit, premultiplied, depth-tested, non-writing, double-sided mark with the decal polygon offset and the census name', async () => {
    const b = ringBatch();
    const m = (await twinOf(b)) as THREE.Material & { fog: boolean; maskNode: unknown };
    const legacy = b.material;
    expect(m.name.startsWith(NODE_MATERIAL_MARKER)).toBe(true);
    expect(m.name).toBe(NODE_RING_MATERIAL_NAME);
    expect(m.transparent).toBe(true);
    expect(m.blending).toBe(THREE.CustomBlending);
    expect([m.blendSrc, m.blendDst, m.blendSrcAlpha, m.blendDstAlpha]).toEqual([
      THREE.OneFactor,
      THREE.OneMinusSrcAlphaFactor,
      THREE.OneFactor,
      THREE.OneMinusSrcAlphaFactor,
    ]);
    expect(m.depthTest).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.side).toBe(THREE.DoubleSide);
    expect(m.polygonOffset).toBe(true);
    expect([m.polygonOffsetFactor, m.polygonOffsetUnits]).toEqual([DECAL_POLYGON_OFFSET_FACTOR, DECAL_POLYGON_OFFSET_UNITS]);
    // The twin and the legacy material agree on every state, so only the shader differs.
    for (const k of ['transparent', 'blending', 'blendSrc', 'blendDst', 'blendSrcAlpha', 'blendDstAlpha', 'depthTest', 'depthWrite', 'side', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits'] as const) {
      expect(m[k], k).toBe(legacy[k]);
    }
    expect(m.fog).toBe(false);
    expect(m.maskNode).not.toBeNull();
    // Still no normal: the AO pre-pass stays off the ring.
    expect(b.mesh.geometry.getAttribute('normal')).toBeUndefined();
  });

  it('compiles with its attributes, a discard, and only the arc style reads aArc', async () => {
    const plain = ringBatch();
    plain.mesh.material = await twinOf(plain);
    const p = await compile(plain.mesh);
    for (const a of ['aOffset', 'aAxes', 'aRingColor']) expect(p.vertex, a).toContain(a);
    expect(p.vertex).not.toContain('aArc');
    expect(p.glsl).toContain('discard');
    const wound = ringBatch(WOUND);
    wound.mesh.material = await twinOf(wound);
    const w = await compile(wound.mesh);
    expect(w.vertex).toContain('aArc');
    expect(w.glsl).toContain('sin(');
  });

  it('every bound uniform reaches the graph', async () => {
    for (const style of [undefined, WOUND]) {
      const b = ringBatch(style);
      b.mesh.material = await twinOf(b);
      const { used } = await compile(b.mesh);
      for (const [name, node] of Object.entries(boundOf(b.mesh.material))) expect(used.has(node), `${name} is bound but the graph never reads it`).toBe(true);
    }
  });

  it('the batch\'s writes reach the twin: after endFrame(zoom) the twin reads ringPxPerTile(zoom), with the twin on the mesh', async () => {
    const b = ringBatch();
    b.mesh.material = await twinOf(b);
    const px = boundOf(b.mesh.material).uPxPerTile as unknown as Updatable;
    b.endFrame(1);
    px.update();
    expect(px.value).toBe(ringPxPerTile(1));
    b.endFrame(2.5);
    px.update();
    expect(px.value).toBe(ringPxPerTile(2.5));
    expect(px.value).not.toBe(ringPxPerTile(1));
  });

  it('the wound ring breathes on the sim clock: setClock reaches the twin, a repaint at the same clock moves nothing, and reduced motion holds it', async () => {
    const b = ringBatch(WOUND);
    b.mesh.material = await twinOf(b);
    const bound = boundOf(b.mesh.material);
    const t = bound.uTimeSec as unknown as Updatable;
    const on = bound.uPulseOn as unknown as Updatable;
    b.setClock(0.4, true);
    t.update();
    on.update();
    expect([t.value, on.value]).toEqual([0.4, 1]);
    // A zero-time repaint: the same clock again. Nothing the graph reads changes.
    t.update();
    expect(t.value).toBe(0.4);
    b.setClock(0.4, false);
    t.update();
    on.update();
    expect([t.value, on.value]).toEqual([0.4, 0]);
    // The time the graph reads is that bound uniform, and no frame-time builtin.
    const { used } = await compile(b.mesh);
    expect(used.has(bound.uTimeSec)).toBe(true);
    expect(used.has(bound.uPulseOn)).toBe(true);
  });

  it('a style without an arc binds no clock at all', async () => {
    const b = ringBatch(TEAM_RING);
    b.mesh.material = await twinOf(b);
    expect(boundOf(b.mesh.material).uTimeSec).toBeUndefined();
    expect(boundOf(b.mesh.material).uPulseOn).toBeUndefined();
  });
});

describe('adoption and the census', () => {
  it('the real ring material is keyed rl-selection-ring and is the ring slot\'s legacy material, in all three styles', () => {
    for (const style of [undefined, TEAM_RING, WOUND_RING]) {
      const b = ringBatch(style);
      expect(b.material.name).toBe(SELECTION_RING_MATERIAL_NAME);
      expect(PORTED_MATERIAL_KEYS.has(b.material.name)).toBe(true);
      expect(legacyTwinSlot(b.material)).toBe('ring');
    }
  });

  it('adoptMaterials swaps each ring batch\'s mesh to a twin the census can place by its name, and the legacy object keeps the record', async () => {
    const W = await import('three/webgpu');
    const TSL = await import('three/tsl');
    const batches = [ringBatch(), ringBatch(TEAM_RING), ringBatch(WOUND_RING)];
    const root = new THREE.Group();
    for (const b of batches) root.add(b.mesh);
    const kit = {
      ground: null,
      foliage: null,
      ring: (legacy: THREE.ShaderMaterial) =>
        createNodeRingMaterial({ W, TSL: TSL as never, maths: MATERIAL_MATHS.ring }, legacy.userData[RING_STYLE_KEY] as RingStyle, legacy.uniforms as unknown as RingUniformRecord),
    };
    expect(adoptMaterials(root, kit, createTwinCache())).toBe(3);
    for (const b of batches) {
      expect(b.mesh.material).not.toBe(b.material);
      expect(b.mesh.material.name.startsWith(NODE_MATERIAL_MARKER)).toBe(true);
      b.beginFrame();
      b.endFrame(1.5);
      expect((b.material.uniforms.uPxPerTile.value as number)).toBe(ringPxPerTile(1.5));
    }
  });

  it('L-matched keeps the legacy ring visible: with the ported keys the census leaves it alone, without them it hides and names it', () => {
    const b = ringBatch();
    b.mesh.visible = true;
    const scene = new THREE.Scene();
    scene.add(b.mesh);
    expect(censusUnported(scene, { portedKeys: PORTED_MATERIAL_KEYS })).toEqual([]);
    expect(b.mesh.visible).toBe(true);
    const hooks = censusUnported(scene);
    expect(hooks.map((h) => h.key)).toEqual([SELECTION_RING_MATERIAL_NAME]);
    expect(b.mesh.visible).toBe(false);
  });
});

// The selection ring constants the literals above were read from: a drift here means the literals need re-reading, not the code.
describe('the literals match the shipped style', () => {
  it('SELECTION_RING', () => {
    expect([SELECTION_RING.coreAlpha, SELECTION_RING.haloAlpha, SELECTION_RING.thicknessTiles, SELECTION_RING.minThicknessPx]).toEqual([0.95, 0.5, 0.1, 2.5]);
    expect([SELECTION_RING.featherTiles, SELECTION_RING.haloTiles]).toEqual([0.015, 0.03]);
  });
  it('WOUND_RING', () => {
    expect([WOUND_RING.coreAlpha, WOUND_RING.haloAlpha, WOUND_RING.thicknessTiles, WOUND_RING.arcThicken, WOUND_RING.arcExtraMaxPx, WOUND_RING.pulsePeriodS, WOUND_RING.pulseMinAlpha]).toEqual([0.95, 0.55, 0.07, 1.8, 2, 1.6, 0.55]);
  });
});
