/**
 * The knock-out effects (`gun-out-fx.ts`, `data/vfx/gun_out_puff.json`, `gun_out_fire.json`): the
 * lead's ruling of 4 Nov. A short puff at the moment, a small fire for 8-15 s that thins into the
 * damage wisp, and nothing the sim could read back.
 */
import { describe, it, expect } from 'vitest';
import {
  GUN_OUT_FIRE_DENSITY,
  GUN_OUT_FIRE_INTERVAL_MS,
  GUN_OUT_FIRE_MAGNITUDE,
  GUN_OUT_FX_SALT,
  gunOutFireMagnitude,
  gunOutFireSeconds,
  gunOutFireThrows,
  gunOutWindow,
  liftShiftTiles,
} from './gun-out-fx';
import puffJson from '../../../../../data/vfx/gun_out_puff.json';
import fireJson from '../../../../../data/vfx/gun_out_fire.json';
import killJson from '../../../../../data/vfx/catastrophic_kill.json';
import paletteJson from '../../../../../data/palette.json';

type Layer = { sprite: string; count: [number, number]; size_px: [number, number]; additive?: boolean; color_over_life: string[]; lifetime_ms: [number, number] };
const layers = (j: unknown): Layer[] => (j as { particles: Layer[] }).particles;

describe('the fire lasts 8-15 s of sim time', () => {
  it('every knock-out draws a duration inside [8, 15), spread across the range, the same on every machine', () => {
    const secs = Array.from({ length: 400 }, (_, id) => gunOutFireSeconds(id));
    expect(Math.min(...secs)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...secs)).toBeLessThan(15);
    // Spread, not a constant: a draw per entity (the lead's "say 8-15 s").
    expect(Math.min(...secs)).toBeLessThan(8.6);
    expect(Math.max(...secs)).toBeGreaterThan(14.4);
    expect(new Set(secs.map((s) => Math.floor(s * 2))).size).toBeGreaterThanOrEqual(12);
    expect(gunOutFireSeconds(7)).toBe(gunOutFireSeconds(7));
  });

  it('the window is dated from the knock-out: the puff first, the fire as long as its draw', () => {
    const w = gunOutWindow(9, 1234);
    expect(w.startMs).toBe(1234);
    expect(w.puffEndMs - w.startMs).toBeLessThan(1000);
    expect(w.fireEndMs - w.startMs).toBeCloseTo(gunOutFireSeconds(9) * 1000, 6);
  });
});

describe('the fire dies down into the wisp', () => {
  it('the magnitude tapers linearly and is 0 outside the window', () => {
    const life = 10_000;
    expect(gunOutFireMagnitude(0, life)).toBeCloseTo(GUN_OUT_FIRE_MAGNITUDE, 6);
    expect(gunOutFireMagnitude(life - 1, life)).toBeLessThan(GUN_OUT_FIRE_MAGNITUDE * 0.35);
    expect(gunOutFireMagnitude(life - 1, life)).toBeGreaterThan(0);
    expect(gunOutFireMagnitude(life / 2, life)).toBeLessThan(gunOutFireMagnitude(life / 4, life));
    expect(gunOutFireMagnitude(-1, life)).toBe(0);
    expect(gunOutFireMagnitude(life, life)).toBe(0);
  });

  it('the flicker thins: far more slots throw in the first quarter of the burn than in the last', () => {
    const life = 12_000;
    const slots = life / GUN_OUT_FIRE_INTERVAL_MS;
    const count = (from: number, to: number): number => {
      let n = 0;
      for (let id = 0; id < 40; id++) {
        for (let s = Math.floor(from * slots); s < Math.floor(to * slots); s++) {
          if (gunOutFireThrows(id, s, s * GUN_OUT_FIRE_INTERVAL_MS, life)) n++;
        }
      }
      return n;
    };
    const early = count(0, 0.25);
    const late = count(0.75, 1);
    expect(early).toBeGreaterThan(late * 1.8);
    // And it is a flicker, not a steady flame: neither end throws every slot.
    expect(early / (40 * (slots / 4))).toBeLessThan(GUN_OUT_FIRE_DENSITY + 0.1);
    expect(late).toBeGreaterThan(0);
  });

  it('is seeded by (entity, slot) alone: the same roll twice, a different roll for another entity', () => {
    const rolls = (id: number): boolean[] => Array.from({ length: 60 }, (_, s) => gunOutFireThrows(id, s, 0, 12_000));
    expect(rolls(3)).toEqual(rolls(3));
    expect(rolls(3)).not.toEqual(rolls(4));
    expect(GUN_OUT_FX_SALT).toBe(0x40000);
  });
});

describe('the lift: a particle has no height, so the spawn point is shifted to where that height projects', () => {
  it('is nothing at the ground, grows with height, and points up-screen (away from the camera, toward -x,-y)', () => {
    expect(Math.abs(liftShiftTiles(0).x) + Math.abs(liftShiftTiles(0).y)).toBe(0);
    const a = liftShiftTiles(0.35);
    const b = liftShiftTiles(0.7);
    expect(b.x).toBeCloseTo(a.x * 2, 6);
    expect(b.y).toBeCloseTo(a.y * 2, 6);
    expect(b.x).toBeLessThan(-0.1);
    expect(b.y).toBeLessThan(-0.1);
    // A 0.7 tile turret ring lands a few tenths of a tile up-screen, not a tile and not nothing.
    expect(Math.hypot(b.x, b.y)).toBeGreaterThan(0.3);
    expect(Math.hypot(b.x, b.y)).toBeLessThan(1.5);
  });
});

describe('the emitters', () => {
  it('are authored in palette keys only, never a raw hex', () => {
    const keys = new Set<string>();
    const ramps = (paletteJson as { ramps: Record<string, unknown>; reserved: Record<string, unknown> });
    for (const j of [puffJson, fireJson]) {
      for (const l of layers(j)) for (const k of l.color_over_life) keys.add(k);
    }
    for (const k of keys) {
      expect(k).not.toMatch(/^#/);
      const band = k.slice(0, k.indexOf('.'));
      expect(band in ramps.ramps || band in ramps.reserved, k).toBe(true);
    }
  });

  it('are on the firepower_kill trigger, above the units', () => {
    for (const j of [puffJson, fireJson]) {
      expect((j as { trigger: string }).trigger).toBe('firepower_kill');
      expect((j as { layer: string }).layer).toBe('above_units');
    }
  });

  it('are clearly smaller than a vehicle-kill fire: a fraction of its count, its flame dots a third its size', () => {
    const kill = layers(killJson);
    const killFlame = kill.find((l) => l.sprite === 'soft_dot') as Layer;
    const killSmoke = kill.find((l) => l.sprite === 'smoke_puff') as Layer;
    const flame = layers(fireJson).find((l) => l.sprite === 'soft_dot') as Layer;
    expect(flame.count[1]).toBeLessThanOrEqual(killFlame.count[0] / 10);
    expect(flame.size_px[1]).toBeLessThanOrEqual(killFlame.size_px[1] / 3);
    for (const l of layers(fireJson)) expect(l.size_px[1]).toBeLessThanOrEqual(killFlame.size_px[0] / 2);
    // The flame is NOT the additive hot core (`additive` renders opaque and blooms: the first capture's white disc).
    expect(flame.additive).not.toBe(true);
    const puff = layers(puffJson)[0];
    expect(puff.count[1]).toBeLessThanOrEqual(killSmoke.count[0] / 3);
    expect(puff.size_px[1]).toBeLessThanOrEqual(killSmoke.size_px[0]);
  });
});
