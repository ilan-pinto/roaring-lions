import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  RG_MAX_WHEELS,
  RG_MAX_WHEEL_RAD_S,
  applyWheelRotation,
  forwardSpeed,
  makeRunningGearState,
  parseRunningGear,
  resetRunningGear,
  sideSpeeds,
  stepRunningGear,
  wheelRotation,
  wheelVertex,
  type RunningGearInput,
  type RunningGearSpec,
} from './running-gear';
import { RG_APPLY_GLSL, RG_PROGRAM_KEY, runningGearMaterial } from './running-gear-material';
import { bindRunningGear, releaseRunningGear, runningGearBinding, writeRunningGearUniforms } from './running-gear-binding';
import type { VehicleMeshEntity } from './mesh-vehicle';

/** A jeep-like 4x4, its front axle steered, as the pass writes it. */
const EXTRAS = {
  rl_running_gear: {
    version: 1,
    wheels: [
      { side: 'r', index: 0, centre: [1.6, 0.43, 0.94], radius: 0.43, cutRadius: 0.44, steer: true, maxSteerRad: 0.349066 },
      { side: 'r', index: 1, centre: [-1.3, 0.43, 0.94], radius: 0.43, cutRadius: 0.44, steer: false, maxSteerRad: 0 },
      { side: 'l', index: 0, centre: [1.6, 0.43, -0.94], radius: 0.43, cutRadius: 0.44, steer: true, maxSteerRad: 0.2 },
      { side: 'l', index: 1, centre: [-1.3, 0.43, -0.94], radius: 0.43, cutRadius: 0.44, steer: false, maxSteerRad: 0 },
    ],
    tracks: [],
  },
};
const TRACKED = {
  rl_running_gear: {
    version: 1,
    wheels: [],
    tracks: [
      { side: 'r', loopLength: 15, pitch: 0.3, gauge: 1.5 },
      { side: 'l', loopLength: 15, pitch: 0.3, gauge: 1.5 },
    ],
  },
};
const spec = (u: unknown = EXTRAS): RunningGearSpec => {
  const s = parseRunningGear(u, 'fixture');
  if (!s) throw new Error('no spec');
  return s;
};

function input(over: Partial<RunningGearInput> = {}): RunningGearInput {
  return {
    entityId: 0,
    spec: spec(),
    smoothedSpeedTilesS: 0,
    yawRateTurnsS: 0,
    moveX: 0,
    moveY: 0,
    headingTurns: 0,
    cruiseTilesS: 2.9,
    dtSeconds: 1 / 60,
    ...over,
  };
}

describe('parseRunningGear', () => {
  it('reads the extras and derives gauge, wheelbase and the axle clamp', () => {
    const s = spec();
    expect(s.wheels).toHaveLength(4);
    expect(s.gauge).toEqual({ r: 0.94, l: 0.94 });
    expect(s.wheelbase).toBeCloseTo(2.9);
    // The axle steers to the SMALLER of its two wheels' measured clearance.
    expect(s.steerLimit).toBeCloseTo(0.2);
    expect(spec(TRACKED).gauge).toEqual({ r: 1.5, l: 1.5 });
  });

  it('is null without extras, and refuses a malformed one', () => {
    expect(parseRunningGear({}, 'x')).toBeNull();
    expect(() => parseRunningGear({ rl_running_gear: { version: 2, wheels: [], tracks: [] } }, 'x')).toThrow(/version/);
    expect(() =>
      parseRunningGear({ rl_running_gear: { version: 1, wheels: [{ side: 'r', index: 0, centre: [0, 0, 1], radius: 0 }], tracks: [] } }, 'x')
    ).toThrow(/radius/);
  });
});

describe('stepRunningGear', () => {
  it('leaves a parked vehicle exactly at rest, and unbound', () => {
    const st = makeRunningGearState(2);
    for (let f = 0; f < 120; f++) stepRunningGear(st, input());
    expect(Array.from(st.angle.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    expect(st.moved[0]).toBe(0);
    expect(st.amp[0]).toBe(0);
  });

  it('turns a wheel once per 2 pi r of ground, backwards about +Z', () => {
    const st = makeRunningGearState(1);
    // 1 tile/s = 3 m/s for 1/60 s steps; pick a time that covers pi r (half a turn).
    const r = 0.43;
    const v = 3; // m/s
    const frames = Math.round(((Math.PI * r) / v) * 600);
    for (let f = 0; f < frames; f++) {
      stepRunningGear(st, input({ smoothedSpeedTilesS: 1, moveX: 0.05, dtSeconds: 1 / 600 }));
    }
    // Half a turn, negative about +Z: wrapped to +-pi.
    expect(Math.abs(Math.abs(st.angle[0]) - Math.PI)).toBeLessThan(0.02);
    expect(st.moved[0]).toBe(1);
    // A quarter turn is unambiguous in sign.
    const st2 = makeRunningGearState(1);
    for (let f = 0; f < frames / 2; f++) stepRunningGear(st2, input({ smoothedSpeedTilesS: 1, moveX: 0.05, dtSeconds: 1 / 600 }));
    expect(st2.angle[0]).toBeCloseTo(-Math.PI / 2, 1);
  });

  it('caps the drawn spin at 15 rad/s (A8)', () => {
    const st = makeRunningGearState(1);
    stepRunningGear(st, input({ smoothedSpeedTilesS: 2.9, moveX: 0.145, dtSeconds: 0.01 }));
    expect(st.angle[0]).toBeCloseTo(-RG_MAX_WHEEL_RAD_S * 0.01, 9);
  });

  it('runs the outside of a right turn faster, and the sides opposite on the spot (A10)', () => {
    // Increasing facing is a right turn: the LEFT side is outside.
    const moving = sideSpeeds(3, 0.5, { r: 1, l: 1 });
    expect(moving.l).toBeGreaterThan(moving.r);
    const spot = sideSpeeds(0, 0.5, { r: 1, l: 1 });
    expect(Math.sign(spot.l)).toBe(1);
    expect(Math.sign(spot.r)).toBe(-1);
    const st = makeRunningGearState(1);
    stepRunningGear(st, input({ spec: spec(TRACKED), yawRateTurnsS: 0.1 }));
    expect(st.phase[0]).toBeGreaterThan(0.5); // right side ran backwards (wrapped below 1)
    expect(st.phase[1]).toBeGreaterThan(0);
    expect(st.phase[1]).toBeLessThan(0.5);
    expect(st.moved[0]).toBe(1);
  });

  it('runs backwards while the hull faces away from where it is going (A11)', () => {
    // Moving +x while the hull faces -x (facing 0.5).
    expect(forwardSpeed(input({ smoothedSpeedTilesS: 1, moveX: 0.05, headingTurns: 0.5 }), 1).mps).toBeCloseTo(-3);
    const st = makeRunningGearState(1);
    stepRunningGear(st, input({ smoothedSpeedTilesS: 1, moveX: 0.05, headingTurns: 0.5 }));
    expect(st.angle[0]).toBeGreaterThan(0);
    // With no tick delta it holds the last cosine rather than snapping to 1.
    stepRunningGear(st, input({ smoothedSpeedTilesS: 0.5, headingTurns: 0.5 }));
    expect(st.lastCos[0]).toBeCloseTo(-1);
  });

  it('is an exact no-op on a hit-stop frame (dt 0)', () => {
    const st = makeRunningGearState(1);
    stepRunningGear(st, input({ smoothedSpeedTilesS: 1, moveX: 0.05 }));
    const before = Float64Array.from(st.angle);
    const phase = Float64Array.from(st.phase);
    stepRunningGear(st, input({ smoothedSpeedTilesS: 1, moveX: 0.05, dtSeconds: 0 }));
    expect(Array.from(st.angle)).toEqual(Array.from(before));
    expect(Array.from(st.phase)).toEqual(Array.from(phase));
  });

  it('steers toward the turn, clamped to the axle, and not on the spot (A9)', () => {
    const st = makeRunningGearState(1);
    stepRunningGear(st, input({ smoothedSpeedTilesS: 1, moveX: 0.05, yawRateTurnsS: 0.2 }));
    expect(st.steer[0]).toBeCloseTo(0.2); // clamped to the smaller clearance
    stepRunningGear(st, input({ smoothedSpeedTilesS: 1, moveX: 0.05, yawRateTurnsS: 0.005 }));
    expect(st.steer[0]).toBeCloseTo(Math.atan((2.9 * 0.005 * 2 * Math.PI) / 3));
    stepRunningGear(st, input({ yawRateTurnsS: 0.2 }));
    expect(st.steer[0]).toBe(0);
  });

  it('ramps the tread in over a quarter of cruise (A7)', () => {
    const st = makeRunningGearState(1);
    stepRunningGear(st, input({ spec: spec(TRACKED), smoothedSpeedTilesS: 0.1, moveX: 0.005, cruiseTilesS: 1.3 }));
    expect(st.amp[0]).toBeCloseTo(0.1 / (0.25 * 1.3));
    stepRunningGear(st, input({ spec: spec(TRACKED), smoothedSpeedTilesS: 1.3, moveX: 0.065, cruiseTilesS: 1.3 }));
    expect(st.amp[0]).toBe(1);
  });

  it('resets a fresh entity to rest', () => {
    const st = makeRunningGearState(2);
    stepRunningGear(st, input({ entityId: 1, smoothedSpeedTilesS: 1, moveX: 0.05 }));
    resetRunningGear(st, 1);
    expect(Array.from(st.angle.subarray(RG_MAX_WHEELS, RG_MAX_WHEELS + 4))).toEqual([0, 0, 0, 0]);
    expect(st.moved[1]).toBe(0);
    expect(st.lastCos[1]).toBe(1);
  });
});

describe('the wheel transform (the GLSL mirror)', () => {
  it('returns the vertex bit for bit at the rest rotation', () => {
    const p: [number, number, number] = [1.6123456789, 0.123456789, 0.987654321];
    const c: [number, number, number] = [1.6, 0.43, 0.94];
    const out = wheelVertex(p, c, [1, 0, 1, 0]);
    expect(out).toEqual(p);
  });

  it('carries a rim point to the opposite rim at half a turn, and steers toward +Z on a right turn', () => {
    const top = applyWheelRotation([0, 0.43, 0], [Math.cos(Math.PI), Math.sin(Math.PI), 1, 0]);
    expect(top[0]).toBeCloseTo(0);
    expect(top[1]).toBeCloseTo(-0.43);
    // A positive steer state (right turn) yaws the wheel's forward axis toward +Z.
    const st = makeRunningGearState(1);
    st.steer[0] = 0.3;
    const rot = wheelRotation(st, 0, spec(), 0, false, [0, 0, 0, 0]);
    const fwd = applyWheelRotation([1, 0, 0], rot);
    expect(fwd[2]).toBeGreaterThan(0);
    // The rear wheel does not steer.
    expect(wheelRotation(st, 0, spec(), 1, false, [0, 0, 0, 0])[3]).toBe(0);
    // Hidden (the debug layer) is exactly the rest pose.
    expect(wheelRotation(st, 0, spec(), 0, true, [0, 0, 0, 0])).toEqual([1, 0, 1, 0]);
  });

  it('is the GLSL the shader runs, term for term', () => {
    expect(RG_APPLY_GLSL).toContain('vec3 a = vec3(rot.x * d.x - rot.y * d.y, rot.y * d.x + rot.x * d.y, d.z);');
    expect(RG_APPLY_GLSL).toContain('return vec3(rot.z * a.x + rot.w * a.z, a.y, -rot.w * a.x + rot.z * a.z);');
  });
});

describe('the material and the binding', () => {
  // Every clone of one vehicle type shares its template's material: so do these.
  const SHARED_BAKE = new THREE.MeshStandardMaterial({ color: 0x808080 });
  function entityWith(...geoms: THREE.BufferGeometry[]): { entity: VehicleMeshEntity; meshes: THREE.Mesh[]; base: THREE.MeshStandardMaterial } {
    const base = SHARED_BAKE;
    const root = new THREE.Object3D();
    const meshes = geoms.map((g) => new THREE.Mesh(g, base));
    for (const m of meshes) root.add(m);
    const entity = { root, liveTop: [...root.children] } as unknown as VehicleMeshEntity;
    return { entity, meshes, base };
  }
  const tagged = (): THREE.BufferGeometry => {
    const g = new THREE.BoxGeometry();
    const n = g.getAttribute('position').count;
    g.setAttribute('_rl_wheel', new THREE.BufferAttribute(new Uint8Array(n).fill(1), 1));
    g.setAttribute('_rl_track', new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1));
    return g;
  };

  it('patches the shader in the p + (R d - d) form, under one shared program key', () => {
    const { material } = runningGearMaterial(new THREE.MeshStandardMaterial(), spec());
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('transformed += rgApply(rgD, uRgRot[rgK]) - rgD;');
    expect(shader.fragmentShader).toContain('rgBarIntegral');
    expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(['uRgAxle', 'uRgRot', 'uRgTrack', 'uRgPitchInv']));
    expect(material.customProgramCacheKey()).toContain(RG_PROGRAM_KEY);
  });

  it('swaps only tagged meshes, one clone per entity, and puts the bake back', () => {
    const a = entityWith(tagged(), tagged(), new THREE.BoxGeometry());
    const b = entityWith(tagged());
    const ba = bindRunningGear(a.entity, spec());
    const bb = bindRunningGear(b.entity, spec());
    expect(ba?.materials).toHaveLength(1);
    expect(a.meshes[0].material).toBe(a.meshes[1].material);
    expect(a.meshes[0].material).not.toBe(a.base);
    expect(a.meshes[2].material).toBe(a.base);
    // Two vehicles never share a clone or its uniforms (three re-uploads a
    // standard material's custom uniforms only when the material changes).
    expect(ba?.materials[0]).not.toBe(bb?.materials[0]);
    expect(ba?.uniforms[0].uRgRot).not.toBe(bb?.uniforms[0].uRgRot);
    expect(bindRunningGear(a.entity, spec())).toBe(ba);
    releaseRunningGear(a.entity);
    expect(a.meshes[0].material).toBe(a.base);
    expect(runningGearBinding(a.entity)).toBeUndefined();
  });

  it('writes the rest pose and no tread while the layer is hidden', () => {
    const a = entityWith(tagged());
    const binding = bindRunningGear(a.entity, spec());
    if (!binding) throw new Error('unbound');
    const st = makeRunningGearState(1);
    stepRunningGear(st, input({ smoothedSpeedTilesS: 1, moveX: 0.05 }));
    writeRunningGearUniforms(binding, st, 0, false);
    expect(binding.uniforms[0].uRgRot.value[0].y).not.toBe(0);
    writeRunningGearUniforms(binding, st, 0, true);
    expect(binding.uniforms[0].uRgRot.value[0].toArray()).toEqual([1, 0, 1, 0]);
    expect(binding.uniforms[0].uRgTrack.value.z).toBe(0);
  });

  it('is null on an entity with nothing tagged', () => {
    expect(bindRunningGear(entityWith(new THREE.BoxGeometry()).entity, spec())).toBeNull();
  });
});
