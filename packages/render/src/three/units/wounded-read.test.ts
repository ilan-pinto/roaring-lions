/**
 * GH-707 wounded readability: the pure halves. Each assertion below was turned red by a named
 * mutation (see the commit message).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WOUND_DOWN, WOUND_NONE, WOUND_STABILISED } from '@lions/sim';

/** `WOUND_ADMITTED` and `WOUND_GONE` (tuning.ts, 3 and 4) are not exported from the sim's index; literals, from the oracle. */
const WOUND_ADMITTED = 3;
const WOUND_GONE = 4;
import {
  bleedFractionOf,
  liftWoundedTemplate,
  patchWoundedFloor,
  setWoundedLift,
  WOUNDED_GATE_HI,
  WOUNDED_GATE_LO,
  WOUNDED_LIFT,
  woundedFloorValue,
  type BleedSource,
} from './wounded-read';
import { SelectionRingBatch } from './selection-ring';
import { WOUND_RING, TEAM_RING } from './readability';

const types = [
  { id: 'inf_squad', wounds: { bleedTicks: 1200, typeId: 'wounded_kdf' } },
  { id: 'wounded_kdf', wounds: null },
  { id: 'civilians', wounds: { bleedTicks: 400, typeId: 'civilians' } },
  { id: 'at_team', wounds: { bleedTicks: 600, typeId: 'wounded_kdf' } },
];
/** A literal world: 0 a squad, 1 a man down from it, 2 a man whose squad is gone (parent -1), 3 an in-place
 *  civilian, 4 a man shed by an AT team (entity 5), whose clock is 600 where the first shedder's is 1200,
 *  6 and 7 men already admitted and gone. */
const sim = (over: Partial<BleedSource['state']> = {}): BleedSource => ({
  unitTypes: types,
  state: {
    typeIdx: [0, 1, 1, 2, 1, 3, 1, 1],
    woundState: [WOUND_NONE, WOUND_DOWN, WOUND_STABILISED, WOUND_DOWN, WOUND_DOWN, WOUND_NONE, WOUND_ADMITTED, WOUND_GONE],
    bleedTicks: [0, 300, 900, 100, 150, 0, 50, 50],
    woundParent: [-1, 0, -1, -1, 5, -1, -1, -1],
    ...over,
  },
});

describe('bleedFractionOf', () => {
  it('reads a squad-shed man against the PARENT squad type', () => {
    expect(bleedFractionOf(sim(), 1)).toEqual({ fraction: 300 / 1200, bleeding: true });
  });
  it('finds a last man (parent -1) through the type that sheds his kind, and calls a stabilised one not bleeding', () => {
    expect(bleedFractionOf(sim(), 2)).toEqual({ fraction: 900 / 1200, bleeding: false });
  });
  it('reads an in-place civilian against his OWN type', () => {
    expect(bleedFractionOf(sim(), 3)).toEqual({ fraction: 100 / 400, bleeding: true });
  });
  it('reads the clock against the type that actually shed him, not the first that sheds his kind', () => {
    expect(bleedFractionOf(sim(), 4)).toEqual({ fraction: 150 / 600, bleeding: true });
  });
  it('is null for anyone not down or stabilised, admitted and gone included', () => {
    for (const id of [0, 5, 6, 7]) expect(bleedFractionOf(sim(), id)).toBeNull();
  });
  it('clamps a clock above the full, and falls back to a full band when no type says how long', () => {
    expect(bleedFractionOf(sim({ bleedTicks: [0, 5000, 0, 0] }), 1)?.fraction).toBe(1);
    const none = { ...sim(), unitTypes: types.map((t) => ({ id: t.id, wounds: null })) };
    expect(bleedFractionOf(none, 1)).toEqual({ fraction: 1, bleeding: true });
  });
});

describe('the albedo floor', () => {
  const shader = 'uniform vec3 x;\nvoid main() {\n  vec3 outgoingLight = vec3(0.);\n  #include <opaque_fragment>\n}';
  it('patches the fragment shader once, before the output is written', () => {
    const out = patchWoundedFloor(shader);
    expect(out).toContain('uniform float uWoundedFloor;');
    expect(out.indexOf('outgoingLight += diffuseColor.rgb')).toBeLessThan(out.indexOf('#include <opaque_fragment>'));
  });
  it('gates the fill on how dark the lit result is, so a lit body is untouched', () => {
    const out = patchWoundedFloor(shader);
    expect(out).toContain('uniform float uWoundedGateLo;');
    expect(out).toMatch(/float gate = 1\.0 - smoothstep\(uWoundedGateLo, uWoundedGateHi, lit\);/);
    expect(out).toMatch(/max\(uWoundedFloor - lit, 0\.0\) \* 0\.7 \* gate/);
    expect(WOUNDED_GATE_LO).toBeLessThan(WOUNDED_GATE_HI);
  });
  it('refuses a shader whose chunks moved, instead of silently doing nothing', () => {
    expect(() => patchWoundedFloor('void main() {}')).toThrow(/opaque_fragment/);
  });
  it('clones the material (never touching the shared one) and the layer writes the one shared uniform', () => {
    const shared = new THREE.MeshStandardMaterial({ color: 0x556b2f });
    const a = new THREE.Mesh(new THREE.BufferGeometry(), shared);
    const b = new THREE.Mesh(new THREE.BufferGeometry(), shared);
    const root = new THREE.Group().add(a, b);
    const copies = liftWoundedTemplate(root);
    expect(copies).toHaveLength(1);
    expect(a.material).toBe(b.material);
    expect(a.material).not.toBe(shared);
    expect(shared.onBeforeCompile.toString()).not.toContain('uWoundedFloor');
    expect(woundedFloorValue()).toBe(WOUNDED_LIFT);
    expect(setWoundedLift(false)).toBeGreaterThanOrEqual(1);
    expect(woundedFloorValue()).toBe(0);
    setWoundedLift(true);
    expect(woundedFloorValue()).toBe(WOUNDED_LIFT);
  });
});

describe('the wounded ring (arc mode)', () => {
  const SHADOW: readonly [number, number, number] = [0, 0, 0];
  const place = (r: number) => ({ x: 5, z: 5, radiusTiles: r, color: [1, 0.7, 0.2] as const });
  const arcBatch = () => new SelectionRingBatch({ capacity: 4, resolveShadow: () => SHADOW, style: WOUND_RING });
  it('carries an aArc attribute, filled per ring with the fraction and the pulse flag', () => {
    const b = arcBatch();
    b.beginFrame();
    expect(b.push(place(0.5), () => 0, 7, 0.4, true)).toBe(true);
    expect(b.push(place(0.5), () => 0, 8, 1.7, false)).toBe(true);
    const arc = b.mesh.geometry.getAttribute('aArc') as THREE.BufferAttribute;
    const first = b.firstVertexOf('small', 0);
    const second = b.firstVertexOf('small', 1);
    expect([arc.getX(first), arc.getY(first)]).toEqual([expect.closeTo(0.4, 5), 1]);
    // A fraction above 1 clamps; no pulse is 0.
    expect([arc.getX(second), arc.getY(second)]).toEqual([1, 0]);
  });
  it('refuses a large-grid ring rather than writing past its small-only arc buffer', () => {
    const b = arcBatch();
    b.beginFrame();
    expect(b.push(place(1.5), () => 0, 1, 0.5, true)).toBe(false);
  });
  it('builds the selection and team rings with no arc attribute and no arc in their shaders', () => {
    for (const style of [undefined, TEAM_RING]) {
      const b = new SelectionRingBatch({ capacity: 2, resolveShadow: () => SHADOW, style });
      expect(b.mesh.geometry.getAttribute('aArc')).toBeUndefined();
      expect(b.mesh.material.vertexShader).not.toContain('aArc');
      expect(b.mesh.material.fragmentShader).not.toContain('vArc');
      expect(b.mesh.material.uniforms.uTimeSec).toBeUndefined();
    }
  });
  it('caps the arc\'s extra thickness in screen pixels, so it stays a band at any zoom', () => {
    const b = arcBatch();
    expect(WOUND_RING.arcExtraMaxPx).toBeGreaterThan(0);
    expect(b.mesh.material.fragmentShader).toMatch(/float extra = min\(w \* \(1\.800000 - 1\.0\), 2\.000000 \/ uPxPerTile\);/);
  });
  it('setClock writes the pulse uniforms, and is a no-op on a ring with no arc', () => {
    const b = arcBatch();
    b.setClock(3.5, false);
    expect(b.mesh.material.uniforms.uTimeSec.value).toBe(3.5);
    expect(b.mesh.material.uniforms.uPulseOn.value).toBe(0);
    const plain = new SelectionRingBatch({ capacity: 2, resolveShadow: () => SHADOW });
    expect(() => plain.setClock(1, true)).not.toThrow();
  });
});
