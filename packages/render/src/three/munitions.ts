/**
 * GH-1197 Phase 1: a weapon's DRAWN blast from its own reach.
 *
 * `data/vfx/munitions.json` (`vfx_munitions.schema.json`) maps every weapon that
 * has a reach to a munition CLASS, and each class row carries the multipliers
 * the design's rule applies to the weapon's own splash `S`:
 *
 *  - inner shock ring = S exactly (the sim's damage reach, `1 - d/S` falloff);
 *  - outer pressure wave = `outer_k x S`, faint, and NOT damage;
 *  - fireball radius `f x S`, crater `c x S`, scorch `s x S`, light radius
 *    `radius_per_splash x S`, debris counts by `(S / reference)^2`.
 *
 * `S` is never copied into the table: the caller reads it off the weapon the
 * sim loaded from the unit JSON (`WeaponStats.splash`, or the bomblets'
 * `submunitions.splash` for a cluster round), or off the sim's own
 * `FIRE_SUPPORT` row for a support call, so the two cannot disagree.
 *
 * Phase 1 draws the ring for every class with a reach. A class whose
 * `blast_from` is `'class'` (today only `heavy_artillery`: `howitzer_155` and
 * `grad_122`) also takes the rest of its row -- fireball, dust, dirt, crater,
 * scorch, light, shake and hit-stop; the others keep their emitter's look.
 *
 * Presentation only, in both directions: the sim reads none of this, and
 * nothing here reads sim state beyond the weapon numbers it was handed.
 */
import table from '../../../../data/vfx/munitions.json';
import type { FlipbookLayerSpec } from '../vfx/emitters';
import { FLIPBOOK_FIT, FLIPBOOK_SMOKE_ALPHA } from './units/flipbook-fx';

export type MunitionClassId = 'grenade' | 'mortar' | 'direct_he' | 'heavy_artillery' | 'air_strike' | 'demolition' | 'blade';

export interface MunitionRingRow {
  inner_ms: number;
  outer_k: number;
  outer_end_ms?: number;
  inner_color: string;
  outer_color: string;
  inner_additive: boolean;
  edge: boolean;
}

export interface MunitionClassRow {
  blast_from: 'class' | 'emitter';
  fireball_f?: number;
  nominal_fireball_tiles?: number;
  crater_c?: number;
  scorch_s?: number;
  reference_splash_tiles: number;
  ring?: MunitionRingRow;
  lobes?: { count: number; throw_tiles: number; scale_of_fireball: number };
  debris: { clods: number; chunks: number; throw_tiles: number; apex_tiles: number };
  dust?: { column_tiles: number; billows?: number; life_ms: [number, number]; alpha?: number };
  skirt?: { billows: number; radius_tiles: [number, number]; life_ms: [number, number]; alpha: number };
  flipbook_cap?: number;
  light?: { color: string; intensity: number; radius_per_splash?: number; radius_tiles?: number; decay_ms: number };
  shake: { amplitude_px: number; duration_ms: number; falloff_tiles?: number };
  hit_stop_ms: number;
}

export type SupportMunitionKind = 'air_strike' | 'mortar_barrage';

export interface MunitionsTable {
  classes: Partial<Record<MunitionClassId, MunitionClassRow>>;
  weapons: Record<string, MunitionClassId>;
  support: Partial<Record<SupportMunitionKind, MunitionClassId>>;
  charge: Partial<Record<'placed_charge', MunitionClassId>>;
}

export const MUNITIONS: MunitionsTable = table as unknown as MunitionsTable;

/** A resolved munition: its class and its reach, tiles (0 for none). */
export interface Munition {
  readonly cls: MunitionClassId;
  readonly splash: number;
}

/** The class row. Throws on a class the table does not carry: every id in
 *  `weapons`/`support` must name a row (`munitions.test.ts` holds it). */
export function munitionRow(cls: MunitionClassId, t: MunitionsTable = MUNITIONS): MunitionClassRow {
  const row = t.classes[cls];
  if (row === undefined) throw new Error(`munitions.json: no class "${cls}"`);
  return row;
}

/**
 * The munition a weapon fires, or null for a weapon the table does not map
 * (every weapon with no reach). `splashTiles` is the weapon's own splash; a
 * cluster round has none of its own and is sized by its bomblets'.
 */
export function munitionForWeapon(
  weaponId: string,
  splashTiles: number,
  submunitionSplashTiles = 0,
  t: MunitionsTable = MUNITIONS
): Munition | null {
  const cls = t.weapons[weaponId];
  if (cls === undefined) return null;
  const splash = splashTiles > 0 ? splashTiles : submunitionSplashTiles > 0 ? submunitionSplashTiles : 0;
  return { cls, splash };
}

/** A fire-support call's munition, at the sim's own splash for its profile. */
export function munitionForSupport(kind: SupportMunitionKind, splashTiles: number, t: MunitionsTable = MUNITIONS): Munition | null {
  const cls = t.support[kind];
  return cls === undefined ? null : { cls, splash: Math.max(0, splashTiles) };
}

/** True when this munition draws its class row rather than its emitter's look. */
export function drawsClassBlast(m: Munition, t: MunitionsTable = MUNITIONS): boolean {
  return m.splash > 0 && munitionRow(m.cls, t).blast_from === 'class';
}

/** Fireball radius, tiles, at `FIREBALL_MEASURE_MS`: `f x S`, or the class's nominal size. */
export function munitionFireballTiles(row: MunitionClassRow, splash: number): number {
  if (row.fireball_f !== undefined && splash > 0) return row.fireball_f * splash;
  return row.nominal_fireball_tiles ?? 0;
}

/** Crater radius, tiles: `c x S`. 0 when the class has no `c`. */
export function munitionCraterTiles(row: MunitionClassRow, splash: number): number {
  return row.crater_c !== undefined && splash > 0 ? row.crater_c * splash : 0;
}

/** Scorch radius, tiles: `s x S`. 0 when the class has no `s`. */
export function munitionScorchTiles(row: MunitionClassRow, splash: number): number {
  return row.scorch_s !== undefined && splash > 0 ? row.scorch_s * splash : 0;
}

// ---------------------------------------------------------------------------
// The two-part ring's timing, from the class row.
// ---------------------------------------------------------------------------

/** One ring as the pool draws it: the reach, the timing and the two palette keys. */
export interface RingSpec {
  /** The inner shock's full radius, tiles: the weapon's splash, exactly. */
  readonly splash: number;
  readonly innerMs: number;
  /** The outer wave's full radius is `outerK x splash`; 1 draws no outer wave. */
  readonly outerK: number;
  /** The outer wave grows from `innerMs` (the inner ring's peak) to this. */
  readonly outerEndMs: number;
  readonly innerColor: string;
  readonly outerColor: string;
  readonly innerAdditive: boolean;
  readonly edge: boolean;
}

/** The ring a munition draws where it lands, or null for one with no reach or no ring. */
export function ringSpecFor(m: Munition, t: MunitionsTable = MUNITIONS): RingSpec | null {
  if (!(m.splash > 0)) return null;
  const ring = munitionRow(m.cls, t).ring;
  if (ring === undefined) return null;
  const outerK = ring.outer_k > 1 && ring.outer_end_ms !== undefined && ring.outer_end_ms > ring.inner_ms ? ring.outer_k : 1;
  return {
    splash: m.splash,
    innerMs: ring.inner_ms,
    outerK,
    outerEndMs: outerK > 1 ? (ring.outer_end_ms as number) : ring.inner_ms,
    innerColor: ring.inner_color,
    outerColor: ring.outer_color,
    innerAdditive: ring.inner_additive,
    edge: ring.edge && ring.inner_additive,
  };
}

// ---------------------------------------------------------------------------
// The class blast as a flipbook recipe (heavy artillery in Phase 1).
// ---------------------------------------------------------------------------

/** When the fireball's radius is claimed: the design's "fireball radius at 200 ms". */
export const FIREBALL_MEASURE_MS = 200;
/** The class fireball's life, the mortar recipe's own 700 ms. */
export const FIREBALL_DURATION_MS = 700;
/**
 * The fraction of a flipbook quad's half-width a billow fills. The baked billow
 * fills about half its frame's half-width (`flipbook-fx.ts`, "matched to the
 * mock"), and a quad's half-width samples `zoom` frame half-widths, so the
 * visible edge is at `0.5 / zoom` of the quad's half-width. A MODEL of the
 * drawn radius, to be read against `blast:capture`'s measured one.
 */
export const FIRE_BILLOW_FILL = 0.5 / FLIPBOOK_FIT.fire.zoom;
export const SMOKE_BILLOW_FILL = 0.5 / FLIPBOOK_FIT.smoke.zoom;
/** `flipbook-fx.ts`'s vertex shader, transcribed: fire drags at 4/s, smoke at 1.2/s, dirt falls at 9.8 wu/s^2,
 *  and smoke drifts up 0.22 wu/s. */
const FIRE_DRAG = 4;
const SMOKE_DRAG = 1.2;
const DIRT_GRAVITY = 9.8;
const SMOKE_RISE = 0.22;

/** A fire billow's drawn radius (world units = tiles) at `ageMs` of `durationMs`, at quad scale `scale`:
 *  the vertex shader's fire size, times `FIRE_BILLOW_FILL`, over the half-width. */
export function flipbookFireRadius(scale: number, ageMs: number, durationMs: number): number {
  const t = Math.min(Math.max(ageMs / durationMs, 0), 1);
  const grow = 1 - Math.pow(1 - Math.min(t * 4, 1), 3);
  return 0.5 * scale * (0.6 + 0.6 * grow + 0.5 * t) * FIRE_BILLOW_FILL;
}

/** A smoke billow's drawn radius at life fraction `t`, at quad scale `scale`. */
export function flipbookSmokeRadius(scale: number, t: number): number {
  return 0.5 * scale * (0.55 + 1.3 * Math.sqrt(Math.min(Math.max(t, 0), 1))) * SMOKE_BILLOW_FILL;
}

/** The fire quad scale whose billow is `radiusTiles` across at `FIREBALL_MEASURE_MS`. */
export function fireballScaleFor(radiusTiles: number): number {
  return radiusTiles / flipbookFireRadius(1, FIREBALL_MEASURE_MS, FIREBALL_DURATION_MS);
}

/** How fast a smoke billow must leave to stand `heightTiles` up at `atS` seconds (drag and drift included). */
function smokeUpFor(heightTiles: number, atS: number): number {
  const reached = (1 - Math.exp(-SMOKE_DRAG * atS)) / SMOKE_DRAG;
  return Math.max(0, (heightTiles - SMOKE_RISE * atS) / reached);
}

/** The age the column's top is read at, seconds (the mock's 3 s frame). */
const COLUMN_READ_S = 3;
/** Column billows: quad scale `base + rand`, a little radial spread, a soot-dust tint (the mock's 0.4 toward gunmetal). */
const COLUMN_SCALE = { base: 1.1, rand: 1.2 } as const;
const COLUMN_TINT = 0.6;
/** The skirt starts at this fraction of the outer wave's reach (the mock's 2.5 of 3.84 t). */
const SKIRT_FROM = 0.65;
/** The skirt's billows are read at mid-life when sized. */
const SKIRT_SIZE_AT = 0.5;

/** The flipbook recipe of a class blast at splash `S`, built from the class row. Layer 0 is the fireball (the
 *  `scale_from` rule); then the lobes, the thrown dirt, the dust column and the dust skirt. The dirt gives way
 *  first to `flipbook_cap`. Spawned at power 0: every scale here is absolute. */
export function classBlastRecipe(row: MunitionClassRow, splash: number): FlipbookLayerSpec[] {
  const ratio = splash / row.reference_splash_tiles;
  const layers: FlipbookLayerSpec[] = [
    {
      type: 'fire', count: 1, delay_ms: [0, 0], duration_ms: [FIREBALL_DURATION_MS, FIREBALL_DURATION_MS],
      scale: { base: fireballScaleFor(munitionFireballTiles(row, splash)) },
      velocity: { radial: [0, 0], up: [0.3, 0.3] },
    },
  ];
  const lobes = row.lobes;
  if (lobes && lobes.count > 0) {
    const radial = lobes.throw_tiles * ratio * FIRE_DRAG;
    layers.push({
      type: 'fire', count: lobes.count, delay_ms: [0, 20], duration_ms: [600, 800],
      scale: { base: lobes.scale_of_fireball }, scale_from: 'fireball',
      velocity: { radial: [radial, radial], up: [0.6, 1.6], ring: true, ring_jitter_rad: 0.4 },
    });
  }
  const dust = row.dust;
  const skirt = row.skirt;
  const columnCount = dust?.billows ?? 0;
  const skirtCount = skirt?.billows ?? 0;
  const fireCount = layers.reduce((n, l) => n + l.count, 0);
  const cap = row.flipbook_cap ?? Infinity;
  const clods = Math.min(Math.round(row.debris.clods * ratio * ratio), Math.max(0, cap - fireCount - columnCount - skirtCount));
  if (clods > 0) {
    const upMax = Math.sqrt(2 * DIRT_GRAVITY * row.debris.apex_tiles);
    const flightS = (2 * upMax) / DIRT_GRAVITY;
    const radialMax = (row.debris.throw_tiles * ratio) / flightS;
    const lifeMs = flightS * 1000;
    layers.push({
      type: 'dirt', count: clods, delay_ms: [0, 10], duration_ms: [lifeMs + 300, lifeMs + 700],
      scale: { base: 0.4, rand: 0.3 },
      velocity: { radial: [0.3 * radialMax, radialMax], up: [0.5 * upMax, upMax] },
      low_fraction: 0.5,
    });
  }
  if (dust && columnCount > 0) {
    layers.push({
      type: 'smoke', count: columnCount, delay_ms: [120, 40], duration_ms: [dust.life_ms[0], dust.life_ms[1]],
      scale: { base: COLUMN_SCALE.base, rand: COLUMN_SCALE.rand },
      velocity: { radial: [0.1, 0.4], up: [0.2, smokeUpFor(dust.column_tiles, COLUMN_READ_S)] },
      tint: COLUMN_TINT,
      ...(dust.alpha !== undefined ? { alpha: dust.alpha / FLIPBOOK_SMOKE_ALPHA } : {}),
    });
  }
  const ring = row.ring;
  if (skirt && skirtCount > 0 && ring) {
    const reach = ring.outer_k * splash;
    const unit = flipbookSmokeRadius(1, SKIRT_SIZE_AT);
    const [r0, r1] = skirt.radius_tiles;
    const far = Math.max(SKIRT_FROM * reach, reach - r1);
    layers.push({
      type: 'smoke', count: skirtCount, delay_ms: [ring.inner_ms, 6], duration_ms: [skirt.life_ms[0], skirt.life_ms[1]],
      scale: { base: r0 / unit, rand: (r1 - r0) / unit },
      velocity: { radial: [SKIRT_FROM * reach * SMOKE_DRAG, far * SMOKE_DRAG], up: [0, 0.1], ring: true, ring_jitter_rad: 0.3 },
      at_ground: true,
      tint: 1,
      alpha: skirt.alpha / FLIPBOOK_SMOKE_ALPHA,
    });
  }
  return layers;
}

/** Instances a recipe spawns at full detail. */
export function recipeCount(layers: readonly FlipbookLayerSpec[]): number {
  return layers.reduce((n, l) => n + l.count, 0);
}
