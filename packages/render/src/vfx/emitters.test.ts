import { describe, expect, it } from 'vitest';
import { WEAPON_CLASS } from '@lions/sim';
import { EmitterLibrary, type EmitterSpec } from './emitters';

const spec = (id: string, classes: string[]): EmitterSpec => ({
  id,
  trigger: 'weapon_fire',
  layer: 'above_units',
  weapon_classes: classes,
  particles: [{ count: 1, lifetime_ms: 100, color_over_life: ['vfx.fire'] }],
});

describe('EmitterLibrary', () => {
  it('indexes an emitter under every class it declares', () => {
    const lib = new EmitterLibrary();
    lib.useEmitters([spec('fire_missile', ['atgm', 'rpg'])]);
    expect(lib.fireEmitterFor(WEAPON_CLASS.atgm)?.id).toBe('fire_missile');
    expect(lib.fireEmitterFor(WEAPON_CLASS.rpg)?.id).toBe('fire_missile');
  });

  it('returns null for a class no emitter claims', () => {
    const lib = new EmitterLibrary();
    lib.useEmitters([spec('fire_small_arms', ['small_arms'])]);
    // Callers fall back to the generic puff, which is what lets this ship
    // one class at a time.
    expect(lib.fireEmitterFor(WEAPON_CLASS.mortar)).toBeNull();
  });

  it('ignores emitters whose trigger is not weapon_fire', () => {
    const lib = new EmitterLibrary();
    const kill: EmitterSpec = { ...spec('catastrophic_kill', ['apfsds']), trigger: 'catastrophic_kill' };
    lib.useEmitters([kill]);
    expect(lib.fireEmitterFor(WEAPON_CLASS.apfsds)).toBeNull();
  });

  it('ignores an unknown class name rather than throwing', () => {
    const lib = new EmitterLibrary();
    lib.useEmitters([spec('bad', ['not_a_weapon'])]);
    expect(lib.fireEmitterFor(WEAPON_CLASS.small_arms)).toBeNull();
  });

  it('is empty before any emitters are registered', () => {
    expect(new EmitterLibrary().fireEmitterFor(WEAPON_CLASS.apfsds)).toBeNull();
  });
});
