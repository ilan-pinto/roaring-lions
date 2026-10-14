/**
 * `units/vehicle-damage.ts` in isolation (GH-31, the vehicle half). The
 * wiring into `ThreeRenderer` is `ThreeRenderer.vehicle-damage.test.ts`.
 *
 * Every `it` names the one-line mutation that was applied to the module and
 * seen to turn it red, then reverted (the falsifications are also listed in
 * the PR description).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  VEHICLE_SCAR_MIX,
  VehicleScarMaterials,
  applyVehicleDamageBand,
  vehicleDamageBand,
  vehicleDrawnBand,
  vehicleScarMixForBand,
  vehicleTakesDamageStates,
  vehicleWispsAtBand,
} from './vehicle-damage';
import { CHARRED_TINT_HEX, liftTone } from '../world-materials';
import { CHARRED_RAMP } from './vehicle-mesh-role';
import { SCAR_MIX } from './building-damage';
import { bindRunningGear, releaseRunningGear, runningGearBinding } from './running-gear-binding';
import { parseRunningGear, type RunningGearSpec } from './running-gear';
import type { VehicleMeshEntity } from './mesh-vehicle';

const SPEC: RunningGearSpec = (() => {
  const s = parseRunningGear(
    {
      rl_running_gear: {
        version: 1,
        wheels: [{ side: 'r', index: 0, centre: [1, 0.4, 0.9], radius: 0.4, cutRadius: 0.41, steer: false, maxSteerRad: 0 }],
        tracks: [],
      },
    },
    'fixture'
  );
  if (!s) throw new Error('no spec');
  return s;
})();

/** A palette part (no map) and a textured bake (with one), as the two kinds
 *  of hull material a shipped vehicle carries. */
function palette(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x8f9464, roughness: 0.55 });
}
function textured(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, map: new THREE.Texture() });
}

function tagged(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry();
  const n = g.getAttribute('position').count;
  g.setAttribute('_rl_wheel', new THREE.BufferAttribute(new Uint8Array(n).fill(1), 1));
  g.setAttribute('_rl_track', new THREE.BufferAttribute(new Float32Array(n).fill(-1), 1));
  return g;
}

/** A clone of a vehicle the way `instantiateVehicleMesh` shapes one: live
 *  children in `liveTop`, the wreck twin under `death_root` outside it, and
 *  the occlusion outline (a `MeshBasicMaterial`) hung under the hull. */
function entity(hullMat: THREE.Material, opts: { wheels?: boolean } = {}) {
  const root = new THREE.Object3D();
  const hull = new THREE.Mesh(opts.wheels ? tagged() : new THREE.BoxGeometry(), hullMat);
  const outline = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ color: 0x2f6fd9 }));
  hull.add(outline);
  const wreckMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const deathRoot = new THREE.Object3D();
  deathRoot.name = 'death_root';
  const wreck = new THREE.Mesh(new THREE.BoxGeometry(), wreckMat);
  deathRoot.add(wreck);
  root.add(hull, deathRoot);
  const e = { root, liveTop: [hull], deathRoot } as unknown as VehicleMeshEntity;
  return { e, hull, outline, wreck, wreckMat };
}

function expected(base: THREE.MeshStandardMaterial, band: number): { color: THREE.Color; roughness: number } {
  const mix = (1 - band / 8) * 0.75;
  const target = new THREE.Color(base.map ? CHARRED_TINT_HEX : liftTone(CHARRED_RAMP));
  return { color: base.color.clone().lerp(target, mix), roughness: base.roughness + (1 - base.roughness) * mix };
}

function expectScar(m: THREE.Material, base: THREE.MeshStandardMaterial, band: number): void {
  const std = m as THREE.MeshStandardMaterial;
  const want = expected(base, band);
  expect(std.color.r).toBeCloseTo(want.color.r, 6);
  expect(std.color.g).toBeCloseTo(want.color.g, 6);
  expect(std.color.b).toBeCloseTo(want.color.b, 6);
  expect(std.roughness).toBeCloseTo(want.roughness, 6);
}

describe('the bands and the mix', () => {
  it('cuts hp into the building eighths', () => {
    // Mutation: `structureHpBand` -> `Math.floor(hp * 8 / max)` reads 3 here.
    expect(vehicleDamageBand(1201, 3000)).toBe(4);
    expect(vehicleDamageBand(3000, 3000)).toBe(8);
    expect(vehicleDamageBand(1, 3000)).toBe(1);
  });

  it('is clean at 8..6, scarred at 5..1 by (1 - band/8) x 0.75, and leaves band 0 to the wreck', () => {
    // Mutations seen red: VEHICLE_SCAR_MIX 0.75 -> 0.6; `band > MAX` -> `band >= MAX`;
    // `band <= 0` -> `band < 0`.
    expect(VEHICLE_SCAR_MIX).toBe(0.75);
    expect(SCAR_MIX).toBe(0.6); // buildings keep theirs: the lead's ruling
    for (const b of [8, 7, 6, 0]) expect(vehicleScarMixForBand(b)).toBe(0);
    expect(vehicleScarMixForBand(5)).toBeCloseTo(0.75 * (3 / 8), 12);
    expect(vehicleScarMixForBand(3)).toBeCloseTo(0.75 * (5 / 8), 12);
    expect(vehicleScarMixForBand(1)).toBeCloseTo(0.75 * (7 / 8), 12);
  });

  it('wisps at bands 2..1 and nowhere else', () => {
    // Mutation: `band <= VEHICLE_WISP_BAND_MAX` -> `band <= SCAR_BAND_MAX` reads 3 as wisping.
    expect([8, 5, 3, 2, 1, 0].map(vehicleWispsAtBand)).toEqual([false, false, false, true, true, false]);
  });

  it('scars ground vehicles and helicopters, never a rotorless aircraft', () => {
    // Mutation: `!isAir || hasRotorPivot` -> `!isAir` (helicopters go clean).
    expect(vehicleTakesDamageStates(false, false)).toBe(true);
    expect(vehicleTakesDamageStates(true, true)).toBe(true);
    expect(vehicleTakesDamageStates(true, false)).toBe(false);
  });
});

describe('applyVehicleDamageBand on a hull drawing the template material', () => {
  it('touches nothing at a clean band', () => {
    const base = palette();
    const { e, hull } = entity(base);
    const scars = new VehicleScarMaterials();
    applyVehicleDamageBand(e, 7, scars);
    expect(hull.material).toBe(base);
    expect(scars.size).toBe(0);
    expect(vehicleDrawnBand(e)).toBe(7);
  });

  it('swaps in one memoised clone per (material x band), shared by every hull of the type, and never mutates the template', () => {
    const base = palette();
    const before = base.color.getHex();
    const a = entity(base);
    const b = entity(base);
    const scars = new VehicleScarMaterials();
    applyVehicleDamageBand(a.e, 3, scars);
    applyVehicleDamageBand(b.e, 3, scars);
    // Mutation: skip the memo (`perBand.set` removed) -> size 2, a/b differ.
    expect(a.hull.material).not.toBe(base);
    expect(a.hull.material).toBe(b.hull.material);
    expect(scars.size).toBe(1);
    expectScar(a.hull.material as THREE.Material, base, 3);
    expect(base.color.getHex()).toBe(before);
  });

  it('takes every band from the TEMPLATE, so stepping down does not compound, and band 8 puts the template back', () => {
    const base = textured();
    const { e, hull } = entity(base);
    const scars = new VehicleScarMaterials();
    for (const band of [5, 3, 1]) applyVehicleDamageBand(e, band, scars);
    // Mutation: `scarBase.get(current) ?? current` -> `current` (lerp from the
    // band-3 clone) reads darker than band 1's own value.
    expectScar(hull.material as THREE.Material, base, 1);
    applyVehicleDamageBand(e, 8, scars);
    expect(hull.material).toBe(base);
  });

  it('chars a textured bake toward the wreck tint and a palette part toward the charred ramp', () => {
    // Mutation: charTarget always CHARRED_TINT_HEX -> the palette assertion goes red.
    const p = palette();
    const t = textured();
    const scars = new VehicleScarMaterials();
    const ep = entity(p);
    const et = entity(t);
    applyVehicleDamageBand(ep.e, 1, scars);
    applyVehicleDamageBand(et.e, 1, scars);
    expectScar(ep.hull.material as THREE.Material, p, 1);
    expectScar(et.hull.material as THREE.Material, t, 1);
    expect((et.hull.material as THREE.MeshStandardMaterial).map).toBe(t.map);
  });

  it('leaves the occlusion outline and the wreck twin alone', () => {
    const { e, outline, wreck, wreckMat } = entity(palette());
    const outlineMat = outline.material;
    applyVehicleDamageBand(e, 1, new VehicleScarMaterials());
    // Mutation: `!std.isMeshStandardMaterial` guard removed -> the outline's
    // MeshBasicMaterial is cloned and swapped (the mock's first run threw on it).
    expect(outline.material).toBe(outlineMat);
    // Mutation: traverse `entity.root` instead of `entity.liveTop` -> the wreck is swapped.
    expect(wreck.material).toBe(wreckMat);
  });

  it('dispose releases the clones it minted', () => {
    const scars = new VehicleScarMaterials();
    const { e, hull } = entity(palette());
    applyVehicleDamageBand(e, 3, scars);
    let disposed = 0;
    (hull.material as THREE.Material).addEventListener('dispose', () => disposed++);
    scars.dispose();
    expect(disposed).toBe(1);
    expect(scars.size).toBe(0);
  });
});

describe('a hull that has moved (its own running-gear clone)', () => {
  it('writes the scar onto the running-gear clone in place: same material, no swap, no memo clone', () => {
    const base = textured();
    const { e, hull } = entity(base, { wheels: true });
    const binding = bindRunningGear(e, SPEC);
    if (!binding) throw new Error('unbound');
    const rgClone = hull.material;
    expect(rgClone).not.toBe(base);
    const scars = new VehicleScarMaterials();
    applyVehicleDamageBand(e, 3, scars);
    // Mutation: drop the running-gear branch -> the hull is swapped onto a
    // memo clone and the wheels freeze (material identity changes, size 1).
    expect(hull.material).toBe(rgClone);
    expect(scars.size).toBe(0);
    expectScar(rgClone as THREE.Material, base, 3);
    applyVehicleDamageBand(e, 8, scars);
    expect((rgClone as THREE.MeshStandardMaterial).color.getHex()).toBe(base.color.getHex());
    releaseRunningGear(e);
  });

  it('a bind after a scar inherits it, a later band is still taken from the template, and release keeps the scar on re-apply', () => {
    const base = palette();
    const { e, hull } = entity(base, { wheels: true });
    const scars = new VehicleScarMaterials();
    applyVehicleDamageBand(e, 3, scars);
    const band3 = hull.material;
    bindRunningGear(e, SPEC);
    expect(runningGearBinding(e)).toBeDefined();
    // The bind cloned the band-3 scar.
    expectScar(hull.material as THREE.Material, base, 3);
    applyVehicleDamageBand(e, 1, scars);
    // Mutation: `scarBase.get(original) ?? original` -> `original` (lerp from
    // the band-3 clone) reads darker than band 1.
    expectScar(hull.material as THREE.Material, base, 1);
    // Death hands back the bind-time material (band 3); the renderer then
    // re-draws the last living band.
    releaseRunningGear(e);
    expect(hull.material).toBe(band3);
    applyVehicleDamageBand(e, vehicleDrawnBand(e), scars);
    expectScar(hull.material as THREE.Material, base, 1);
  });
});
