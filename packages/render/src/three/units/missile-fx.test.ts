import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WEAPON_CLASS } from '@lions/sim';
import type { EmitterSpec } from '../../vfx';
import { FX_RENDER_ORDER, FX_RENDER_ORDER_ADDITIVE } from './render-order';
import { MissileFx } from './missile-fx';
import type { MissileLaunch, TargetTrack } from './missiles';
import * as missileTrail from './missile-trail';

const TRAIL: EmitterSpec = {
  id: 'missile_trail', trigger: 'projectile_trail', layer: 'above_units',
  particles: [
    { sprite: 'soft_dot', count: 1, lifetime_ms: 16, size_px: 2.5, color_over_life: ['vfx.white_hot'], additive: true },
    { sprite: 'soft_dot', count: 1, lifetime_ms: 16, size_px: 6, color_over_life: ['vfx.fire'], alpha_over_life: [0.55] },
    { sprite: 'smoke_puff', count: 1, lifetime_ms: 1600, size_px: 2.5, size_over_life: [1, 3.2],
      color_over_life: ['limestone.1', 'limestone.3', 'gunmetal.1'], alpha_over_life: [0.7, 0] },
  ],
};
const resolve = (k: string): string =>
  k.startsWith('vfx') ? '#FFB43C' : k.startsWith('gunmetal') ? '#8E9491' : '#E6D8BE';
const LAUNCH: MissileLaunch = {
  sx: 0, sy: 0, tx: 8, ty: 0, simDistTiles: 8, side: 0, cls: WEAPON_CLASS.atgm, weaponId: 'spike_atgm',
  target: 1, willHit: true, shooterAir: false, targetAir: false, tick: 5, shooter: 0,
};
const TRACK: TargetTrack = { x: [0, 8], y: [0, 0], alive: [1, 1] };

describe('MissileFx', () => {
  it('owns three meshes in the bands the spec names, all depth-tested, none writing depth', () => {
    const fx = new MissileFx();
    expect(fx.meshes).toHaveLength(3);
    expect(fx.bodyMesh.renderOrder).toBe(FX_RENDER_ORDER);
    expect(fx.spriteMesh.renderOrder).toBe(FX_RENDER_ORDER);
    expect(fx.coreMesh.renderOrder).toBe(FX_RENDER_ORDER_ADDITIVE);
    for (const m of fx.meshes) {
      const mat = (m as unknown as { material: { depthTest: boolean; depthWrite: boolean } }).material;
      expect(mat.depthTest).toBe(true);
      expect(mat.depthWrite).toBe(false);
    }
    expect((fx.coreMesh.material as THREE.ShaderMaterial).fragmentShader).toContain('float a = 1.0');
    fx.dispose();
  });

  it('costs nothing idle and three draws in flight (N18)', () => {
    const fx = new MissileFx();
    fx.setLook(TRAIL, resolve);
    fx.step(1 / 60, TRACK, null, 0, 0);
    expect(fx.meshes.filter((m) => m.visible)).toHaveLength(0);
    fx.launch(LAUNCH);
    fx.step(0.5, TRACK, null, 0, 0);
    expect(fx.meshes.filter((m) => m.visible)).toHaveLength(3);
    fx.dispose();
  });

  it('reports a landing on the frame the flight ends, and keeps the trail after it', () => {
    const fx = new MissileFx();
    fx.setLook(TRAIL, resolve);
    fx.launch(LAUNCH); // 8 tiles at 4 tiles/s: 39 ticks = 1.95 s = 124.8 frames of 1/64
    let landings = 0;
    for (let f = 0; f < 124; f++) landings += fx.step(1 / 64, TRACK, null, 0, 0).length;
    expect(landings).toBe(0);
    landings += fx.step(1 / 64, TRACK, null, 0, 0).length;
    expect(landings).toBe(1);
    expect(fx.missiles).toHaveLength(0);
    expect(fx.trail.live).toBeGreaterThan(0);
    expect(fx.spriteMesh.visible).toBe(true);
    for (let f = 0; f < 200; f++) fx.step(1 / 60, TRACK, null, 0, 0);
    expect(fx.trail.live).toBe(0);
    fx.dispose();
  });

  it('models and lands a missile before any look is set, drawing no trail or glow', () => {
    const fx = new MissileFx();
    fx.launch(LAUNCH);
    fx.step(0.5, TRACK, null, 0, 0);
    expect(fx.missiles).toHaveLength(1);
    expect(fx.trail.live).toBe(0);
    expect(fx.spriteMesh.visible).toBe(false);
    expect(fx.coreMesh.visible).toBe(false);
    fx.dispose();
  });

  it('the debug flag hides all three through the next step, and answers 3 (P-5)', () => {
    const fx = new MissileFx();
    fx.setLook(TRAIL, resolve);
    fx.launch(LAUNCH);
    expect(fx.setDebugHidden(true)).toBe(3);
    fx.step(0, TRACK, null, 0, 0);
    expect(fx.meshes.filter((m) => m.visible)).toHaveLength(0);
    fx.setDebugHidden(false);
    fx.step(0, TRACK, null, 0, 0);
    expect(fx.meshes.filter((m) => m.visible)).toHaveLength(3);
    fx.dispose();
  });

  it('binds one worldYAt callback for emitAlongFlight, reused across missiles and frames (fix round 1)', () => {
    const fx = new MissileFx();
    fx.setLook(TRAIL, resolve);
    const spy = vi.spyOn(missileTrail, 'emitAlongFlight');
    fx.launch(LAUNCH);
    fx.launch({ ...LAUNCH, target: -1, willHit: false, tick: 6 });
    fx.step(0.05, TRACK, null, 0, 0);
    fx.step(0.05, TRACK, null, 0, 0);
    // Two missiles, two frames: at least four calls, one per missile per step.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4);
    const callbacks = spy.mock.calls.map((call) => call[3]);
    const first = callbacks[0];
    for (const cb of callbacks) expect(cb).toBe(first);
    spy.mockRestore();
    fx.dispose();
  });

  it('refuses a non-missile class without throwing', () => {
    const fx = new MissileFx();
    expect(fx.launch({ ...LAUNCH, cls: WEAPON_CLASS.small_arms })).toBeNull();
    expect(fx.missiles).toHaveLength(0);
    fx.dispose();
  });
});
