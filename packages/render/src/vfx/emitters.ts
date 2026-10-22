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
  direction_offset_deg?: number;
  gravity_tiles_s2?: number;
  drag?: number;
  size_px?: Range;
  size_over_life?: number[];
  color_over_life: string[];
  alpha_over_life?: number[];
  additive?: boolean;
  heat_shimmer?: boolean;
  /** This layer is superseded by a pooled, modelled mesh once one has
   *  loaded (three.js backend, `&mesh` only) -- `ThreeRenderer.onFire`
   *  spawns `MuzzleFlashManager` instead of this particle spec when both
   *  this flag and `MuzzleFlashManager.ready` are true, and falls back to
   *  spawning the particle exactly as authored otherwise (mesh not loaded,
   *  `&mesh` off, or Pixi, which never reads this field at all). See
   *  `packages/render/src/three/units/muzzle-flash.ts`'s own top comment. */
  mesh_flash?: boolean;
  /** The `mesh_flash` sibling for a `structure_collapse`-triggered hot core:
   *  superseded by `ExplosionBurstManager` instead, under the identical
   *  fallback contract (mesh not loaded, `&mesh` off, or Pixi -> the
   *  authored particle exactly as declared). See
   *  `packages/render/src/three/units/explosion-burst.ts`'s own top comment.
   *  Superseded by `flipbook` on three when the emitter declares one (D6). */
  mesh_burst?: boolean;
  /** The `mesh_burst` sibling for the multi-second smoke AFTERMATH rather
   *  than the sub-second fireball: superseded by `SmokePlumeManager`
   *  instead, under the identical fallback contract (mesh not loaded,
   *  `&mesh` off, or Pixi -> the authored particle exactly as declared).
   *  See `packages/render/src/three/units/smoke-plume.ts`'s own top comment.
   *  Superseded by `flipbook` on three when the emitter declares one (D6), as
   *  is a `smoke_puff` sprite layer. */
  mesh_plume?: boolean;
}

/**
 * One layer of a flipbook recipe (Defilade T4, Task 5). Mirrors
 * `flipbook_layer` in `vfx_emitter.schema.json`; `FlipbookFx.spawnRecipe`
 * (`three/units/flipbook-fx.ts`) is the only reader. Every `[a, b]` below is
 * sampled uniformly from the presentation PRNG unless noted; `power` is the
 * caller's event power and `k` the instance index within the layer.
 */
export interface FlipbookLayerSpec {
  type: 'fire' | 'smoke' | 'dirt';
  count: number;
  /** `[base, per_index]`: instance k starts `base + per_index * k` ms after the spawn. */
  delay_ms: [number, number];
  duration_ms: [number, number];
  /** `base + per_power * power + per_index_power * k * power + rand * U(0,1)`,
   *  then times the recipe's fireball scale when `scale_from` is `fireball`. */
  scale: { base: number; per_power?: number; per_index_power?: number; rand?: number };
  /** The fireball scale is layer 0's `base + per_power * power`. */
  scale_from?: 'fireball';
  velocity: {
    /** Horizontal speed away from the origin, at a random heading -- or at
     *  heading `2 pi k / count (+ U(0, ring_jitter_rad))` when `ring`. */
    radial: [number, number];
    up: [number, number];
    /** Speed along the bore (the caller's `dirRad`), added to the radial part. */
    along_bore?: [number, number];
    ring?: boolean;
    ring_jitter_rad?: number;
  };
  offset?: {
    up?: number;
    /** Along the bore, + forward (a backblast is negative). */
    along_bore?: number;
    along_bore_per_index?: number;
    /** A square of this side, centred on the origin, in x and z. */
    scatter?: number;
  };
  /** SMOKE only: 0 soot, 1 dust. */
  tint?: number;
  /** Start at the caller's ground height rather than its origin height. */
  at_ground?: boolean;
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
  /** Three only: the instanced billow recipe that supersedes this emitter's
   *  `mesh_burst`/`mesh_plume`/`smoke_puff` layers when declared. */
  flipbook?: FlipbookLayerSpec[];
}

/**
 * Indexes weapon_fire emitters by weapon class.
 *
 * The app loads the JSON and hands it over — @lions/render must not import
 * @lions/data. Same arrangement as AudioManager.useManifest.
 */
export class EmitterLibrary {
  private byFireClass = new Map<number, EmitterSpec>();
  private byId = new Map<string, EmitterSpec>();

  useEmitters(list: EmitterSpec[]): void {
    this.byFireClass.clear();
    this.byId.clear();
    for (const em of list) {
      this.byId.set(em.id, em);
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

  /**
   * An emitter by id, for the ambient ones the renderer spawns itself.
   *
   * `ambient_idle` emitters have no sim event behind them -- idling is not an
   * event and must not become one, since putting a cigarette in the simulation
   * would widen the state the replay hash covers for something no outcome
   * depends on. So the renderer looks these up by name and fires them off its
   * own clip phase. It reads sim state and writes none, which is the direction
   * invariant 4 allows.
   */
  byName(id: string): EmitterSpec | null {
    return this.byId.get(id) ?? null;
  }
}
