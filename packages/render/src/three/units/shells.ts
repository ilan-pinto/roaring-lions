/**
 * GH-145: the travelling projectile indirect fire never had -- and, since
 * GH-149, the one DIRECT fire never had either.
 *
 * ## What was already there, and what was not
 *
 * Every `fire` event -- direct or indirect -- already reaches
 * `ThreeRenderer.onFire`, which pushed a `TracerModel` (`./tracers.ts`)
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
 * ## GH-149: the flat tracer was never a PROJECTILE, and a tank duel showed it
 *
 * The complaint that opened GH-149 was "direct fire has no visible
 * projectile", and the first thing to say is that the literal reading of it
 * is wrong: a `mbt_lavi` firing `gun_120` DOES draw something, and it always
 * has. What it draws is the problem, in the mirror image of the mortar's.
 * Photographed at HEAD over eight consecutive frames of a real tank
 * engagement (`?sandbox=beit_sahwan_outskirts`, zoom 1.6, a 6.7-tile shot):
 * two dead-straight `vfx.tracer`-green lines span the WHOLE gap on the very
 * first frame, do not move by one pixel over the next seven, and fade
 * uniformly to nothing. Nothing travels. It reads as a laser that dims, not
 * as a shell that arrives -- the lead's "two models flashing at each other
 * across a gap with nothing crossing it", which is a fair description of a
 * static full-span line even though the line is not literally absent.
 *
 * The fix reuses this module rather than growing a second one, because a
 * direct-fire round IS an arc with no arc: a `ShellModel` whose profile has
 * `apexPxPerTile: 0` is a streak of fixed length sliding along a straight
 * path, which is exactly the "short bright tracer segment stretched along
 * the flight path" the design constraint asks for -- and it arrives with
 * `shellSegmentQuad`'s taper, alpha ramp and per-end ground interpolation
 * already built and already tested. Two new kinds:
 *
 *  - **`bolt`** -- a tank round or an autocannon shell. Flat, fast, thin,
 *    and lifted clear of the ground by `baseLiftPx` so it flies at about
 *    turret height instead of skidding.
 *  - **`missile`** -- an ATGM or an RPG. The same shape, a third the speed,
 *    with a shallow arc so it reads as guided rather than shot.
 *
 * `small_arms` and `hmg` deliberately KEEP the flat tracer. A rifle burst
 * and a `.50` stream are the one case the full-span ribbon is right for:
 * the rounds really do arrive within a frame, the shots come 5-7 a second,
 * and replacing that with a queue of discrete travelling streaks would turn
 * the most common effect on the field into visual noise.
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
 * `missile` copies the same table (`atgm` 4 tiles/s, `rpg` 6) and lands on 5
 * between them, so a Hellfire crosses its own 10.5-tile reach in about two
 * seconds and terminates near its own resolution just as the mortar does.
 * `bolt` CANNOT copy it, and that is the one place this module invents a
 * number rather than borrowing one: `PROJ_SPEED` is **0** for `apfsds`,
 * `autocannon`, `small_arms` and `hmg` -- the sim models those as arriving
 * within the tick they are fired, with no projectile at all. Zero is not a
 * speed a streak can fly at, so `bolt` is tuned by eye against the one thing
 * that matters here, which is whether it reads as travelling; see
 * `SHELL_PROFILES`' own comment for what was walked and rejected.
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

/**
 * How a round flies.
 *
 *  - `mortar` climbs steeply and loafs; `rocket` is flatter and quicker.
 *    Those two names are the two `WEAPON_CLASS` entries the sim's own
 *    `INDIRECT_MASK` is built from, and they are the two kinds whose
 *    `indirect` flag is set.
 *  - `bolt` is a tank round or an autocannon shell: no arc at all, fast, and
 *    flying at turret height rather than on the deck.
 *  - `missile` is an ATGM or an RPG: slow, with a shallow arc.
 */
export type ShellKind = 'mortar' | 'rocket' | 'bolt' | 'missile';

/** One round in flight: a parabola over the straight line from launch to
 *  impact, tagged by side for colour lookup. Which colour PAIR is the
 *  caller's business and differs by kind -- an arcing round is drawn from
 *  `RendererOptions.shellColors` (fire/ember, GH-149's recolour) and a
 *  direct round from `tracerColors`, so a bolt still reads as the same
 *  side's fire as the tracers around it. */
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
  /**
   * Lift pixels added along the WHOLE flight, on top of the parabola.
   *
   * Zero for the two arcing kinds, which genuinely leave the ground and come
   * back to it. Non-zero for a direct round, whose parabola is flat: without
   * it a tank shell would run along the deck at `SHELL_LIFT_PX` (4) and read
   * as skidding rather than flying. 9 is about a turret's height at this
   * camera, so the streak leaves the barrel and arrives at the hull it is
   * aimed at.
   */
  baseLiftPx: number;
  /** How much of the recent flight the streak behind the round covers, in
   *  seconds. See `SHELL_TRAIL_S` for how the arcing value was arrived at;
   *  a direct round's is much shorter because it is much faster, and the
   *  product (seconds x tiles/s) is what the eye actually reads. */
  trailS: number;
  /** Width in screen pixels of the streak AT THE ROUND -- the tail tapers to
   *  `SHELL_TAIL_WIDTH_RATIO` of it. A bomb is fatter than a bolt. */
  widthPx: number;
  /** Floor on the cosmetic flight time. A point-blank shot must still be
   *  visible for long enough to register as a projectile rather than a
   *  flicker; how long that is differs by kind, since a bolt is meant to be
   *  brief and a bomb is not. */
  minDurationS: number;
  /**
   * True for a round that ARCS -- which is one authored fact with three
   * readers, rather than three places that each re-derive "is this a mortar
   * or a rocket": it selects the batch (`ShellBatch`, no depth test, band 3
   * -- see `fx.ts`), the colour pair (`shellColors` rather than
   * `tracerColors`), and whether landing throws an explosion.
   */
  indirect: boolean;
  /** Burst size (0..1, `ExplosionBurstManager.spawn`'s own scale) thrown
   *  where this round lands. Only read when `indirect`; a direct round's
   *  impact is already covered by the sim's own `impact`/`nearMiss` events. */
  impactPower: number;
}

/**
 * The four profiles, by kind.
 *
 * The mortar numbers are the ones a browser walk settled on (GH-145's own
 * report): at `mortar_60`'s 4-tile minimum range the bomb still clears 56
 * lift pixels, and at its 18-tile maximum it tops out at the 150 clamp
 * rather than climbing off-screen. The rocket is deliberately about a third
 * as steep -- a Grad leaves the rail nearly flat -- and a touch quicker, so
 * the two read as different weapons and not as one arc scaled twice.
 *
 * ## `bolt`, and the one design constraint that was argued down
 *
 * GH-149's brief carried an explicit number: the streak should live "~4
 * frames", on the reasoning that a literally-simulated tank shell would be
 * on screen for about three. The four-frame version was built and walked
 * first, and it is NOT what shipped, because at 4 frames the streak's own
 * length is most of the shot and its travel is less than its length -- the
 * eye reads one shape that appears, jumps once and vanishes, which is the
 * same "flash, no travel" failure the flat tracer already had, only shorter.
 * What the frames buy is the READ, and the read needs the streak to be
 * clearly shorter than the gap it crosses and to occupy several distinct
 * positions inside it.
 *
 * 30 tiles/s with a 0.08 s trail is what that costs: a 6.7-tile shot (the
 * engagement range measured on `beit_sahwan_outskirts`) flies for 0.22 s --
 * **13 frames, not 4** -- behind a streak 2.4 tiles long, so the round is
 * visibly a third of the way across, then two thirds, then home. It is still
 * three times faster than the slowest thing on screen and reads as a shell
 * rather than a rocket. The rejected 4-frame version and the shipped one
 * were captured frame-for-frame at one camera; see this task's report.
 *
 * `missile` is deliberately six times slower again, which is the sim's own
 * `PROJ_SPEED` for `atgm`/`rpg` rather than a taste call, with just enough
 * arc (2.2 px/tile, capped at 26) to bend visibly without reading as
 * indirect fire.
 */
export const SHELL_PROFILES: Record<ShellKind, ShellProfile> = {
  mortar: {
    speedTilesS: 4, apexPxPerTile: 14, apexMinPx: 40, apexMaxPx: 150,
    baseLiftPx: 0, trailS: 0.45, widthPx: 5, minDurationS: 0.35,
    indirect: true, impactPower: 0.3,
  },
  rocket: {
    speedTilesS: 5, apexPxPerTile: 5, apexMinPx: 14, apexMaxPx: 55,
    baseLiftPx: 0, trailS: 0.45, widthPx: 5, minDurationS: 0.35,
    indirect: true, impactPower: 0.45,
  },
  bolt: {
    speedTilesS: 30, apexPxPerTile: 0, apexMinPx: 0, apexMaxPx: 0,
    baseLiftPx: 9, trailS: 0.08, widthPx: 3.5, minDurationS: 0.1,
    indirect: false, impactPower: 0,
  },
  missile: {
    speedTilesS: 5, apexPxPerTile: 2.2, apexMinPx: 8, apexMaxPx: 26,
    baseLiftPx: 9, trailS: 0.3, widthPx: 4.5, minDurationS: 0.2,
    indirect: false, impactPower: 0,
  },
};

/** A point-blank shot (a mortar at its own 4-tile minimum, or a shot whose
 *  target is standing on the shooter) must still be visible for long enough
 *  to register as a projectile rather than a flicker. The ARCING kinds' own
 *  `minDurationS`; `SHELL_PROFILES` is what `spawnShell` actually reads, and
 *  a `shells.test.ts` case pins the two together so they cannot drift. */
export const SHELL_MIN_DURATION_S = 0.35;
/** Nothing hangs in the air longer than this, whatever the range -- the
 *  longest shot on the roster (`grad_122`, 20 tiles) is 4 s at its own
 *  speed, so this only ever bites on a map larger than any shipped one.
 *  Shared by every kind: it is a runaway guard, not a look. */
export const SHELL_MAX_DURATION_S = 6;

/**
 * How much of the recent flight the streak behind the round covers, for the
 * ARCING kinds. (`SHELL_PROFILES[kind].trailS` is what `shellTrailSpan`
 * reads; this is where the mortar/rocket value came from, and a
 * `shells.test.ts` case pins the two together.)
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
 * Which projectile a weapon class flies, or `null` for every class that keeps
 * the flat full-span tracer.
 *
 * The `mortar`/`rocket` half is the render-side mirror of `sim.ts`'s
 * `INDIRECT_MASK` -- `(1 << WEAPON_CLASS.mortar) | (1 <<
 * WEAPON_CLASS.rocket)`, the mask that decides a weapon needs no line of
 * sight. That constant is module-private in `sim.ts` and not exported, and
 * this feature is not a reason to export it; `WEAPON_CLASS` itself IS
 * exported and is what both halves are built from, so the two cannot
 * disagree about which integer means "mortar". A new indirect class added to
 * the sim would need adding here too, which is why this function names the
 * classes explicitly instead of testing a bit pattern that would silently
 * claim to be authoritative.
 *
 * GH-149 added the direct half, and it mirrors NOTHING in the sim -- there
 * is no "fires one big round" mask there, because the sim does not care.
 * The split is a presentation judgement about what a shot looks like, and
 * the line is drawn at ONE ROUND PER SHOT versus A STREAM:
 *
 *  - `apfsds` (the Lavi's `gun_120`) and `autocannon` (the Apache's
 *    `chain_gun_30`, the Namer's `cannon_30`, the gun truck's `zu23_twin`)
 *    fly a `bolt`. The autocannon is in this list on purpose even at 625
 *    rounds a minute: ten discrete streaks a second strung along the line
 *    is what a chain gun looks like, and it is the half of "the
 *    helicopter's weapons" that is not the Hellfire.
 *  - `atgm` (`hellfire`, `kornet`, `spike_atgm`, `manpad`), `rpg` and
 *    `heat` fly a `missile`.
 *  - `small_arms` and `hmg` keep the tracer -- see this module's top
 *    comment, "GH-149", for why a rifle burst is the one case the full-span
 *    ribbon is right for.
 *  - `interceptor` and `demolition` keep it too, for the duller reason that
 *    neither travels anywhere: no shipped unit fires an interceptor, and a
 *    satchel charge is placed at arm's length.
 */
export function shellKindFor(cls: number): ShellKind | null {
  if (cls === WEAPON_CLASS.mortar) return 'mortar';
  if (cls === WEAPON_CLASS.rocket) return 'rocket';
  if (cls === WEAPON_CLASS.apfsds || cls === WEAPON_CLASS.autocannon) return 'bolt';
  if (cls === WEAPON_CLASS.atgm || cls === WEAPON_CLASS.rpg || cls === WEAPON_CLASS.heat) {
    return 'missile';
  }
  return null;
}

/** True for a round that arcs -- `mortar` and `rocket`. The one place the
 *  `indirect` flag is read as a question rather than as a field, so a caller
 *  routing a shell to its batch/colour/impact does not have to know that the
 *  fact lives on the profile. */
export function isIndirectShell(kind: ShellKind): boolean {
  return SHELL_PROFILES[kind].indirect;
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
    duration: clamp(dist / profile.speedTilesS, profile.minDurationS, SHELL_MAX_DURATION_S),
    t: 0,
  };
}

/**
 * Whether stepping this shell by `dt` REAL seconds ends its flight.
 *
 * Exported so a caller that needs to DO something on impact (GH-149's
 * landing explosion, `ThreeRenderer.updateFx`) asks the same question
 * `stepShells` answers internally, rather than re-deriving `s.t + dt >=
 * s.duration` beside it and drifting from it later.
 */
export function shellHasLanded(s: ShellModel, dt: number): boolean {
  return s.t + dt >= s.duration;
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
    if (!shellHasLanded(s, dt)) next.push({ ...s, t: s.t + dt });
  }
  return next;
}

/** How far through its own flight a shell is, clamped to 0..1. `duration` is
 *  never zero (`SHELL_MIN_DURATION_S`), so this never divides by zero. */
export function shellProgress(s: ShellModel): number {
  return clamp(s.t / s.duration, 0, 1);
}

/** A point on the arc: ground track interpolated linearly, height a
 *  parabola peaking at `apexPx` halfway along plus this kind's flat
 *  `baseLiftPx`. `u` is clamped, so a caller that reaches past either end of
 *  the flight gets the endpoint rather than a round that dives underground
 *  or overshoots its own aim point. */
export function shellPointAt(s: ShellModel, u: number): { x: number; y: number; liftPx: number } {
  const p = clamp(u, 0, 1);
  return {
    x: s.sx + (s.tx - s.sx) * p,
    y: s.sy + (s.ty - s.sy) * p,
    // 4u(1-u) is 0 at both ends and exactly 1 at u = 0.5. `baseLiftPx` is 0
    // for the two arcing kinds, so a mortar's height is unchanged by it and
    // still meets its own ground at both ends; a `bolt`'s parabola is
    // identically 0 and the base lift is the whole of its height.
    liftPx: s.apexPx * 4 * p * (1 - p) + SHELL_PROFILES[s.kind].baseLiftPx,
  };
}

/**
 * The stretch of the arc the streak covers, as a pair of `u` fractions:
 * `head` is where the round is now, `tail` is where it was this kind's own
 * `trailS` ago.
 *
 * The tail is clamped to the launch point, so a shell that has been in the
 * air for less than `trailS` grows its streak out of the tube instead of
 * trailing one that starts before it was fired.
 */
export function shellTrailSpan(s: ShellModel): { tail: number; head: number } {
  const trailS = SHELL_PROFILES[s.kind].trailS;
  return { tail: clamp((s.t - trailS) / s.duration, 0, 1), head: shellProgress(s) };
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
