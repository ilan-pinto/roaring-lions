/**
 * GH-85: the pure half of the effect triggers `vfx_emitter.schema.json`
 * declared and nothing dispatched until now. `ThreeRenderer` owns the
 * dispatch; everything here is arithmetic and bookkeeping it can be tested
 * without a scene for.
 *
 * Six emitters, one trigger each, and the clock each one runs on is the
 * design decision that matters (CLAUDE.md, "frame-vs-sim"):
 *
 *  - `armor_ricochet` (`impact_armor`) and `armor_penetration`
 *    (`penetration`): a DIRECT-FIRE round meeting a hull. The sim resolves a
 *    hitscan round on its fire tick (`PROJ_SPEED` 0 for `apfsds`,
 *    `autocannon`, `small_arms`, `hmg`), but the round on screen is a bolt
 *    or a burst of streaks flying at 22-30 tiles/s on the FRAME clock
 *    (`shells.ts`). So the outcome is latched onto the bolt that carries it
 *    (`claimStrikeBolt`) and the sparks fly where that bolt visibly lands --
 *    the `shellHasLanded` rule a mortar bomb already follows. A missile is
 *    not this path: `missile_impact` already lands it (GH-250).
 *  - `wreck_smoulder` (`catastrophic_kill`): persistent, so it is dated off
 *    the SIM clock in slots (`exhaust-slots.ts`, GH-391), exactly like idle
 *    exhaust and damage smoke. A frozen gate frame repaints the same puffs,
 *    and the repaint control stays at zero.
 *  - `aps_launch` (`interceptor_launch`), `demolition_blast` (`eod_breach`)
 *    and `smoke_discharge` (`smoke_screen`): one-shot bursts on the sim event
 *    that IS the moment -- the APS fires when the round arrives (the missile's
 *    flight is the sim's own, to the tick), a charge detonates when its
 *    projectile resolves, and a screen is laid on the tick the order lands.
 *
 * None of these author `light`, `screen_shake` or `hit_stop_ms`: those belong
 * to the four blasts the event ladder ranks (`fx-ladder.test.ts`, polish
 * VR-22), and a seventh source of shake would be a seventh rung nobody ranked.
 */
import type { ShellKind, ShellModel } from './shells';

export const ARMOR_RICOCHET_EMITTER_ID = 'armor_ricochet';
export const ARMOR_PENETRATION_EMITTER_ID = 'armor_penetration';
export const WRECK_SMOULDER_EMITTER_ID = 'wreck_smoulder';
export const APS_LAUNCH_EMITTER_ID = 'aps_launch';
export const DEMOLITION_BLAST_EMITTER_ID = 'demolition_blast';
export const SMOKE_DISCHARGE_EMITTER_ID = 'smoke_discharge';

/** The kinds a `fire` event turns into a direct-fire round on the frame
 *  clock: the tank/cannon bolt and the rifle/MG burst streaks. The arcing
 *  kinds land through `spawnShellImpactFx`, missiles through `MissileFx`. */
export function isDirectFireShell(kind: ShellKind | 'missile' | null): kind is 'bolt' | 'rifle' | 'mg' {
  return kind === 'bolt' || kind === 'rifle' || kind === 'mg';
}

/** What a direct-fire round does when it reaches the hull it was aimed at,
 *  latched onto the bolt by the sim's `impact` event. `magnitude` is the
 *  weapon's own `firePower` (0..1), so a 120 mm round sparks bigger than a
 *  rifle round off the same plate without an emitter of its own. */
export interface ArmourStrike {
  penetrated: boolean;
  magnitude: number;
}

/**
 * The bolt an `impact` event's outcome belongs to: the FIRST live round from
 * `shooter` at `target` that does not already carry one. First, because a
 * burst's streaks are pushed in launch order and the one that left first is
 * the one that arrives first. -1 when there is none -- the round has already
 * landed, or the shooter's class draws no bolt at all -- and the caller then
 * throws the effect at once, at the target.
 */
export function claimStrikeBolt(bolts: readonly ShellModel[], shooter: number, target: number): number {
  for (let i = 0; i < bolts.length; i++) {
    const b = bolts[i];
    if (b.shooter === shooter && b.target === target && b.strike === undefined) return i;
  }
  return -1;
}

/** Heading of a round from its launch point to its impact, in turns. */
export function strikeHeadingTurns(s: Pick<ShellModel, 'sx' | 'sy' | 'tx' | 'ty'>): number {
  const a = Math.atan2(s.ty - s.sy, s.tx - s.sx) / (Math.PI * 2);
  return ((a % 1) + 1) % 1;
}

/**
 * How long a burnt-out hull keeps smoking, in SIM seconds. Three times a
 * building wreck's 20 (`WRECK_BURN_SECONDS`): the blast column above it is
 * itself 20 s (`BLAST_SMOKE_DURATION_MS`), and a wisp that stopped with the
 * column would add nothing the column does not already say.
 */
export const WRECK_SMOULDER_SECONDS = 60;
/** One puff (and one ember) per slot. 450 ms, one and a half times the damage
 *  smoke's 300: a wreck smoulders, a hurt engine pours. */
export const WRECK_SMOULDER_INTERVAL_MS = 450;
/** `ParticleSystem.spawn`'s magnitude at the kill; tapers to 40% of it by the
 *  end of the window (`wreckSmoulderMagnitude`). */
export const WRECK_SMOULDER_MAGNITUDE = 0.5;
/** Salts the presentation stream so a wreck's puffs never share rolls with
 *  the exhaust (+0x10000) or the damage smoke (+0x20000) of the same id. */
export const WRECK_SMOULDER_SALT = 0x30000;

/** The smoulder's magnitude `ageMs` into its window -- a linear taper, so the
 *  wreck dies down rather than switching off. 0 outside the window. */
export function wreckSmoulderMagnitude(ageMs: number): number {
  const life = WRECK_SMOULDER_SECONDS * 1000;
  if (ageMs < 0 || ageMs >= life) return 0;
  return WRECK_SMOULDER_MAGNITUDE * (1 - 0.6 * (ageMs / life));
}

/**
 * `PROJ_SPEED[demolition]` from `@lions/sim`'s `tuning.ts`, in tiles/s.
 * COPIED, the way `missiles.ts` copies the missile speeds, and pinned
 * against that file's text by `trigger-fx.test.ts` so the copy cannot drift.
 */
export const SIM_DEMOLITION_SPEED_TILES_S = 2;
const SIM_TICK_S = 0.05;

/**
 * The tick a demolition charge thrown on `fireTick` resolves on.
 * `stepCombat` runs before `stepProjectiles` in the same tick, so a round of
 * `n` whole ticks (`prTicksLeft`) resolves `n - 1` ticks after the tick that
 * fired it -- the same quantisation `missiles.ts` documents. The epsilon is
 * that file's, for the same float artefact.
 */
export function demolitionResolveTick(fireTick: number, distTiles: number): number {
  const perTick = SIM_DEMOLITION_SPEED_TILES_S * SIM_TICK_S;
  const n = Math.max(1, Math.ceil(distTiles / perTick - 1e-9));
  return fireTick + n - 1;
}

/** A demolition charge in the air. Resolved by whichever comes first: a
 *  `nearMiss` from its thrower with a demolition weapon (exact, it carries
 *  the point), a `structureHit` by its thrower on its structure, or its own
 *  resolve tick passing (a hit on a soft unit emits no event at all). */
export interface PendingCharge {
  shooter: number;
  /** -1 when the charge was thrown at a unit. */
  structure: number;
  /** -1 when the charge was thrown at a building. */
  target: number;
  resolveTick: number;
}

/** Index of the earliest pending charge thrown by `shooter` (and, when
 *  `structure` is given, at that building), or -1. */
export function findPendingCharge(list: readonly PendingCharge[], shooter: number, structure?: number): number {
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.shooter !== shooter) continue;
    if (structure !== undefined && c.structure !== structure) continue;
    return i;
  }
  return -1;
}

/** The point on a building's footprint nearest the thrower: where a charge
 *  placed against its wall goes off, rather than the middle of its roof. */
export function nearestFootprintPoint(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  fromX: number,
  fromY: number
): [number, number] {
  const x = Math.min(Math.max(fromX, minX), maxX + 1);
  const y = Math.min(Math.max(fromY, minY), maxY + 1);
  return [x, y];
}

/** `ParticleSystem.spawn` magnitudes for the three one-shot bursts, and the
 *  explosion-burst power a demolition charge goes off at -- between a mortar
 *  bomb's 0.3 and a Grad rocket's 0.45 (`SHELL_PROFILES[kind].impactPower`):
 *  a 250-damage satchel is a bigger bang than a 60 mm bomb and smaller than a
 *  122 mm rocket. */
export const APS_LAUNCH_MAGNITUDE = 0.5;
export const SMOKE_DISCHARGE_MAGNITUDE = 0.4;
export const DEMOLITION_BLAST_POWER = 0.35;
