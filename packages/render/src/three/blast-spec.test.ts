import { describe, expect, it } from 'vitest';
import type { EmitterSpec } from '../vfx/emitters';
import catastrophic from '../../../../data/vfx/catastrophic_kill.json';
import shellImpact from '../../../../data/vfx/shell_impact.json';
import { blastHitStopMs, blastLightSpec, blastShake } from './blast-spec';

const kill = catastrophic as unknown as EmitterSpec;
const impact = shellImpact as unknown as EmitterSpec;

describe('the adopted emitters carry what the renderer is about to read', () => {
  // R-P: `additive` is the on-palette hot core and stays; what was missing is
  // the flag that lets the POOLED fireball supersede the stacked quads, which
  // `structure_collapse.json` has had all along.
  it('catastrophic_kill hands its hot core to the pooled burst and its smoke to the pooled plume', () => {
    expect(kill.particles[0].additive).toBe(true);
    expect(kill.particles[0].mesh_burst).toBe(true);
    expect(kill.particles[1].mesh_plume).toBe(true);
  });

  // R-Q: measured -- shell_impact.json declares NO mesh_plume today, so a
  // mortar bomb gets a fireball and nothing that persists. The blast's third
  // element is simply absent on the mortar half.
  it('shell_impact gains a column and the three presentation blocks', () => {
    expect(impact.particles.some((p) => p.mesh_plume === true)).toBe(true);
    expect(impact.light?.color).toBe('vfx.fire');
    expect(impact.screen_shake?.amplitude_px).toBeGreaterThan(0);
    expect(impact.hit_stop_ms).toBeGreaterThan(0);
  });

  // The schema's own ceilings, asserted here so a later edit cannot quietly
  // author past them and rely on validate:data being run.
  it('stays inside the schema ceilings it is validated against', () => {
    expect(kill.screen_shake!.amplitude_px!).toBeLessThanOrEqual(24);
    expect(kill.hit_stop_ms!).toBeLessThanOrEqual(120);
    expect(impact.screen_shake!.amplitude_px!).toBeLessThanOrEqual(24);
    expect(impact.hit_stop_ms!).toBeLessThanOrEqual(120);
  });
});

describe('scaling by the caller\'s power term', () => {
  it('a full-power blast is the emitter verbatim', () => {
    const light = blastLightSpec(kill, 1);
    expect(light).toEqual({ color: 'vfx.fire', intensity: 3.5, radius_tiles: 7, decay_ms: 500 });
    expect(blastShake(kill, 1)).toEqual({ amplitudePx: 9, durationMs: 420, falloffTiles: 14 });
    expect(blastHitStopMs(kill, 1)).toBe(70);
  });

  // G0 #14: "mortar shares at its own power". SHELL_PROFILES.mortar is 0.3.
  it('a mortar bomb gets three tenths of it', () => {
    expect(blastLightSpec(kill, 0.3)!.intensity).toBeCloseTo(1.05, 6);
    expect(blastShake(kill, 0.3)!.amplitudePx).toBeCloseTo(2.7, 6);
    expect(blastHitStopMs(kill, 0.3)).toBe(21);
  });

  // DURATION and REACH are not scaled -- only STRENGTH is. A weaker blast is
  // quieter, not shorter and not smaller in the world: a shake whose duration
  // shrank with power would read as a different EFFECT rather than a smaller
  // one, and a light whose radius shrank would stop touching the ground it
  // is lighting.
  it('scales strength and leaves duration and reach alone', () => {
    expect(blastShake(kill, 0.3)!.durationMs).toBe(420);
    expect(blastShake(kill, 0.3)!.falloffTiles).toBe(14);
    expect(blastLightSpec(kill, 0.3)!.decay_ms).toBe(500);
    expect(blastLightSpec(kill, 0.3)!.radius_tiles).toBe(7);
  });

  it('answers null and zero for a missing emitter or a zero power, never a half-built spec', () => {
    expect(blastLightSpec(null, 1)).toBeNull();
    expect(blastShake(null, 1)).toBeNull();
    expect(blastHitStopMs(null, 1)).toBe(0);
    expect(blastLightSpec(kill, 0)).toBeNull();
    expect(blastShake(kill, 0)).toBeNull();
    expect(blastHitStopMs(kill, 0)).toBe(0);
  });

  it('an emitter that declares no presentation blocks is silent, not a default', () => {
    const bare = { id: 'x', trigger: 'weapon_fire', layer: 'above_units', particles: [] } as unknown as EmitterSpec;
    expect(blastLightSpec(bare, 1)).toBeNull();
    expect(blastShake(bare, 1)).toBeNull();
    expect(blastHitStopMs(bare, 1)).toBe(0);
  });
});
