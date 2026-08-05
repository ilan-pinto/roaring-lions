import { WEAPON_CLASS } from '@lions/sim';

/** A scalar or an inclusive [min, max] band, matching the schema's `range`. */
export type Range = number | [number, number];

/** One particle layer of an emitter. Mirrors particle_layer in the schema. */
export interface ParticleSpec {
  sprite?: string;
  count: Range;
  lifetime_ms: Range;
  emit_over_ms?: number;
  speed_tiles_s?: Range;
  cone_deg?: number;
  inherit_velocity?: number;
  gravity_tiles_s2?: number;
  drag?: number;
  size_px?: Range;
  size_over_life?: number[];
  color_over_life: string[];
  alpha_over_life?: number[];
  additive?: boolean;
  heat_shimmer?: boolean;
}

/** One emitter, as authored in data/vfx/*.json. */
export interface EmitterSpec {
  id: string;
  trigger: string;
  layer: string;
  weapon_classes?: string[];
  persistent?: boolean;
  budget_priority?: number;
  hit_stop_ms?: number;
  screen_shake?: { amplitude_px?: number; duration_ms?: number; falloff_tiles?: number };
  light?: { color?: string; intensity?: number; radius_tiles?: number; decay_ms?: number };
  particles: ParticleSpec[];
}

/**
 * Indexes weapon_fire emitters by weapon class.
 *
 * The app loads the JSON and hands it over — @lions/render must not import
 * @lions/data. Same arrangement as AudioManager.useManifest.
 */
export class EmitterLibrary {
  private byFireClass = new Map<number, EmitterSpec>();

  useEmitters(list: EmitterSpec[]): void {
    this.byFireClass.clear();
    for (const em of list) {
      if (em.trigger !== 'weapon_fire') continue;
      for (const name of em.weapon_classes ?? []) {
        const idx = WEAPON_CLASS[name];
        // An unknown class is ignored, not fatal: a data typo should not
        // take the renderer down mid-mission.
        if (idx !== undefined) this.byFireClass.set(idx, em);
      }
    }
  }

  /** The emitter for a weapon class, or null to use the generic puff. */
  fireEmitterFor(cls: number): EmitterSpec | null {
    return this.byFireClass.get(cls) ?? null;
  }
}
