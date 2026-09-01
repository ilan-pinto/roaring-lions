/**
 * GH-145: the travelling projectile indirect fire never had.
 *
 * ## What was already there, and what was not
 *
 * Every `fire` event -- direct or indirect -- already reaches
 * `ThreeRenderer.onFire`, which pushes a `TracerModel` (`./tracers.ts`)
 * unconditionally. So indirect fire was NOT deliberately excluded from the
 * tracer path: it has always drawn one. What it drew was the problem. A
 * tracer is a flat ribbon lying on the ground from the shooter's tile to the
 * target's, alive for `TRACER_LIFETIME_S` (150 ms) -- correct for a rifle
 * round, which really does arrive that fast along that line, and actively
 * wrong for a mortar bomb, which leaves the tube at 85 degrees, spends two
 * and a half seconds in the air, and arrives from above. A player watching
 * a 150 ms straight line could not tell a mortar from a rifle, and had no
 * way at all to read where the incoming came from.
 *
 * This module is the arc. It is presentation only, and it is derived
 * entirely from what the `fire` event already carries -- see the "what the
 * sim gives us" section below.
 *
 * ## Nothing was added to the sim, and nothing needed to be
 *
 * The event carries `shooter`, `target` (or `structure`), `weaponId` and
 * `tick`. `weaponId` plus the shooter's own `UnitType.weapons` gives the
 * `WeaponStats.cls`, and `WEAPON_CLASS` is already exported from `@lions/sim`
 * and already read here for muzzle-flash and audio selection. Origin and
 * destination come from the renderer's own interpolated `curX`/`curY` (or a
 * structure centre), exactly as the tracer's endpoints always have. That is
 * the whole input set: launch point, impact point, side, weapon class.
 *
 * The sim DOES model a real projectile internally -- `prActive`/`prTicksLeft`
 * /`prOriginX`/`prAimX` in `sim.ts`, with a per-class `PROJ_SPEED` -- but
 * none of it is exposed on `Sim`'s public surface, and this feature is not a
 * reason to expose it. Nothing here reads sim state beyond what the renderer
 * already reads, and nothing here can influence a sim outcome (invariant 4).
 *
 * ## The flight time is cosmetic, and chosen to be nearly right anyway
 *
 * `SHELL_PROFILES[kind].speedTilesS` deliberately carries the same numbers
 * `tuning.ts`'s own `PROJ_SPEED` holds for those two classes (mortar 4
 * tiles/s, rocket 5) -- redeclared here rather than imported, since
 * `PROJ_SPEED` is not part of `@lions/sim`'s exported surface and widening
 * that surface for a visual would be exactly the tuck-in this feature must
 * not make. The consequence of that copy is a happy one and not a
 * requirement: the bomb tends to land about when the sim's own round
 * resolves, so the arc terminates into its own impact effect. If the two
 * ever drift apart the arc is still correct -- a cosmetic flight time that
 * does not match the sim's is acceptable and normal, and this module is
 * stepped by REAL FRAME SECONDS (`stepShells(shells, dt)`), never by sim
 * ticks.
 *
 * Pure data in, pure data out: no three.js, no Pixi, no DOM, no `Sim`. A
 * caller owns storage, calls `spawnShell` on an indirect `fire` event and
 * `stepShells` once a render frame, and reads `shellTrailPoints` to draw.
 * Heights come out in LIFT PIXELS -- the same unit `AIR_LIFT_PX` and
 * `TRACER_LIFT_PX` are in, which the caller converts through
 * `WORLD_Y_PER_LIFT_PIXEL` -- so this file never needs to know the world
 * scale either.
 */
import { WEAPON_CLASS } from '@lions/sim';

/** How a round flies. `mortar` climbs steeply and loafs; `rocket` is flatter
 *  and quicker. The two names are the two `WEAPON_CLASS` entries the sim's
 *  own `INDIRECT_MASK` is built from. */
export type ShellKind = 'mortar' | 'rocket';

/** One round in flight: a parabola over the straight line from launch to
 *  impact, tagged by side for colour lookup (the same `tracerColors` pair a
 *  `TracerModel` is drawn with -- indirect fire from your own side should
 *  read the same as direct fire from your own side). */
export interface ShellModel {
  /** Launch point, tile space -- the muzzle, not the unit centre. */
  sx: number;
  sy: number;
  /** Impact point, tile space. */
  tx: number;
  ty: number;
  side: number;
  kind: ShellKind;
  /** Peak height above the ground track, in LIFT PIXELS (see this module's
   *  top comment). Fixed at spawn from the shot's own length. */
  apexPx: number;
  /** Total cosmetic flight time, seconds. Never zero -- clamped below. */
  duration: number;
  /** Elapsed seconds. A shell is live while this is `< duration`. */
  t: number;
}

export interface ShellProfile {
  /** Tiles per second. Mirrors `tuning.ts`'s `PROJ_SPEED` for this class --
   *  see this module's top comment for why it is copied, not imported. */
  speedTilesS: number;
  /** Lift pixels of apex per tile of range: how steeply this kind arcs. */
  apexPxPerTile: number;
  /** A minimum-range shot still has to look like it went up. */
  apexMinPx: number;
  /** A maximum-range shot must not leave the top of the screen. One
   *  elevation level is `ELEV_STEP` = 10 lift pixels, so the mortar's 150
   *  is fifteen levels -- higher than any terrain on any shipped map, and
   *  about four and a half tile-heights on screen at 1x. */
  apexMaxPx: number;
}

/**
 * The two profiles, by kind.
 *
 * The mortar numbers are the ones a browser walk settled on (GH-145's own
 * report): at `mortar_60`'s 4-tile minimum range the bomb still clears 56
 * lift pixels, and at its 18-tile maximum it tops out at the 150 clamp
 * rather than climbing off-screen. The rocket is deliberately about a third
 * as steep -- a Grad leaves the rail nearly flat -- and a touch quicker, so
 * the two read as different weapons and not as one arc scaled twice.
 */
export const SHELL_PROFILES: Record<ShellKind, ShellProfile> = {
  mortar: { speedTilesS: 4, apexPxPerTile: 14, apexMinPx: 40, apexMaxPx: 150 },
  rocket: { speedTilesS: 5, apexPxPerTile: 5, apexMinPx: 14, apexMaxPx: 55 },
};

/** A point-blank shot (a mortar at its own 4-tile minimum, or a shot whose
 *  target is standing on the shooter) must still be visible for long enough
 *  to register as a projectile rather than a flicker. */
export const SHELL_MIN_DURATION_S = 0.35;
/** Nothing hangs in the air longer than this, whatever the range -- the
 *  longest shot on the roster (`grad_122`, 20 tiles) is 4 s at its own
 *  speed, so this only ever bites on a map larger than any shipped one. */
export const SHELL_MAX_DURATION_S = 6;

/**
 * How much of the recent flight the streak behind the round covers.
 *
 * Set by the browser walk, not by taste. At 0.25 s the mortar's streak
 * measured about 27 screen pixels at zoom 1 -- present, correct, and easy
 * to miss against the ground texture, which for a feature whose whole point
 * is READABILITY is a failure. 0.45 s puts it near 50, which is a length
 * the eye catches without the round reading as a laser.
 */
export const SHELL_TRAIL_S = 0.45;
/** Segments the streak is built from. One would be a straight chord across
 *  the whole trail; six follow the curve closely enough that the streak
 *  visibly BENDS over the apex, which is the single cue that says "this is
 *  arcing" rather than "this is a tracer". Raised from four with
 *  `SHELL_TRAIL_S`: a longer wake across the same segment count is a
 *  coarser polyline, and the bend is the thing being bought. */
export const SHELL_TRAIL_SEGMENTS = 6;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Which arc a weapon class flies, or `null` for every class that keeps its
 * flat tracer.
 *
 * This is the render-side mirror of `sim.ts`'s `INDIRECT_MASK` -- `(1 <<
 * WEAPON_CLASS.mortar) | (1 << WEAPON_CLASS.rocket)`, the mask that decides
 * a weapon needs no line of sight. That constant is module-private in
 * `sim.ts` and not exported, and this feature is not a reason to export it;
 * `WEAPON_CLASS` itself IS exported and is what both halves are built from,
 * so the two cannot disagree about which integer means "mortar". A new
 * indirect class added to the sim would need adding here too, which is why
 * this function names the classes explicitly instead of testing a bit
 * pattern that would silently claim to be authoritative.
 */
export function shellKindFor(cls: number): ShellKind | null {
  if (cls === WEAPON_CLASS.mortar) return 'mortar';
  if (cls === WEAPON_CLASS.rocket) return 'rocket';
  return null;
}

/** A round leaving the tube, at zero elapsed time. Flight time and apex are
 *  both fixed here from the shot's own length, so nothing downstream has to
 *  re-measure the distance every frame. */
export function spawnShell(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  side: number,
  kind: ShellKind
): ShellModel {
  const profile = SHELL_PROFILES[kind];
  const dist = Math.hypot(tx - sx, ty - sy);
  return {
    sx,
    sy,
    tx,
    ty,
    side,
    kind,
    apexPx: clamp(dist * profile.apexPxPerTile, profile.apexMinPx, profile.apexMaxPx),
    duration: clamp(dist / profile.speedTilesS, SHELL_MIN_DURATION_S, SHELL_MAX_DURATION_S),
    t: 0,
  };
}

/**
 * Ages every shell by `dt` REAL seconds and drops the ones that have
 * landed. Pure in the same shape `stepTracers` is: the input array and its
 * elements are never mutated, a fresh array of fresh objects comes back
 * instead.
 */
export function stepShells(shells: readonly ShellModel[], dt: number): ShellModel[] {
  const next: ShellModel[] = [];
  for (const s of shells) {
    const t = s.t + dt;
    if (t < s.duration) next.push({ ...s, t });
  }
  return next;
}

/** How far through its own flight a shell is, clamped to 0..1. `duration` is
 *  never zero (`SHELL_MIN_DURATION_S`), so this never divides by zero. */
export function shellProgress(s: ShellModel): number {
  return clamp(s.t / s.duration, 0, 1);
}

/** A point on the arc: ground track interpolated linearly, height a
 *  parabola peaking at `apexPx` halfway along. `u` is clamped, so a caller
 *  that reaches past either end of the flight gets the endpoint rather than
 *  a round that dives underground or overshoots its own aim point. */
export function shellPointAt(s: ShellModel, u: number): { x: number; y: number; liftPx: number } {
  const p = clamp(u, 0, 1);
  return {
    x: s.sx + (s.tx - s.sx) * p,
    y: s.sy + (s.ty - s.sy) * p,
    // 4u(1-u) is 0 at both ends and exactly 1 at u = 0.5.
    liftPx: s.apexPx * 4 * p * (1 - p),
  };
}

/**
 * The stretch of the arc the streak covers, as a pair of `u` fractions:
 * `head` is where the round is now, `tail` is where it was `SHELL_TRAIL_S`
 * ago.
 *
 * The tail is clamped to the launch point, so a shell that has been in the
 * air for less than `SHELL_TRAIL_S` grows its streak out of the tube
 * instead of trailing one that starts before it was fired.
 */
export function shellTrailSpan(s: ShellModel): { tail: number; head: number } {
  return { tail: clamp((s.t - SHELL_TRAIL_S) / s.duration, 0, 1), head: shellProgress(s) };
}

/**
 * The streak behind the round: `SHELL_TRAIL_SEGMENTS + 1` points along the
 * arc, ordered tail first, head last, spanning `shellTrailSpan`. Sampling
 * the parabola rather than drawing one chord is what makes the streak bend
 * over the apex.
 *
 * Each point carries the `u` it was sampled at as well as its position: the
 * draw side needs it to interpolate the launch tile's ground height toward
 * the impact tile's, which a bare position cannot recover.
 */
export function shellTrailPoints(s: ShellModel): { x: number; y: number; liftPx: number; u: number }[] {
  const { tail, head } = shellTrailSpan(s);
  const points: { x: number; y: number; liftPx: number; u: number }[] = [];
  for (let i = 0; i <= SHELL_TRAIL_SEGMENTS; i++) {
    const u = tail + ((head - tail) * i) / SHELL_TRAIL_SEGMENTS;
    points.push({ ...shellPointAt(s, u), u });
  }
  return points;
}
