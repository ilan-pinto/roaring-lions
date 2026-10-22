// Combat model tuning constants (GDD §5). Every knob the backtest harness
// calibrates against the §5.7 targets lives HERE, expressed as raw Q16.16
// integers (float literals are banned in the sim; the decimal value is in
// the comment). Change a value → rerun `pnpm balance`.

// --- detection (5.1) -------------------------------------------------------
/** Rate constant k in P(detect,dt) = 1 - exp(-k * strength * dt). */
export const K_DETECT = 1310720; // 20.0
/** Per-tick confidence decay when no observer holds LOS. e^(-0.1 * 0.05). */
export const CONTACT_DECAY = 65209; // 0.99501
export const SUSPECTED_AT = 16384; // 0.25
export const IDENTIFIED_AT = 45875; // 0.70
export const LOST_AT = 13107; // 0.20 (hysteresis below SUSPECTED_AT)
/** Targeted fire (GH-420, ruling R-4): how many CONSECUTIVE ticks an ordered
 *  focus may sit below IDENTIFIED_AT -- the confidence selectTarget itself
 *  stops shooting at -- before the order is dropped. The unit spends them
 *  walking to where its side last saw the target; re-identification resets
 *  the count. 100 ticks is 5 s, the same order as the contact decay it
 *  follows: from ONE, CONTACT_DECAY takes ln(0.70)/ln(0.99501) ~ 71 ticks
 *  (3.6 s) unobserved to fall below 0.70, so the grace from the LAST
 *  SIGHTING is ~171 ticks, about 8.6 s, not 5 s. Change this, not the decay,
 *  to move it. Integer ticks, not Q16.16. */
export const FOCUS_LOST_TICKS = 100; // 5 s
/** Targeted fire (GH-420, ruling R-22): the hysteresis band at the edge of a
 *  focused unit's reach. A unit that has STOPPED (`moving` 0) keeps its
 *  stance until the target is more than `effectiveRange + FOCUS_REACH_SLACK`
 *  away; one that is still walking stops at the plain effective range. So a
 *  target sitting on the edge cannot make a halt-to-fire man kneel, rise,
 *  kneel and rise again: it takes a clear half tile of retreat to stand him
 *  up, and he has to walk back to the plain edge to sit down again.
 *
 *  A DESIGN constant, not a measured one. The reasoning: one drop plus one
 *  rise is KNEEL_DROP_TICKS + KNEEL_RISE_TICKS = 8 ticks = 0.4 s, and 0.5
 *  tile is more than a target crosses in that time at up to 1.25 tiles/s,
 *  which covers every foot unit that walks (0.85-0.95; `charge_squad` at 1.9
 *  does not fit) and the Lavi (1.1), while staying small enough that a unit
 *  never holds visibly far beyond its weapon's effective range. It moves
 *  only the stop/close decision (`focusInReach`): what a slot may FIRE at is
 *  still `rangeSq`, via selectTarget. */
export const FOCUS_REACH_SLACK = 32768; // 0.5 tile
/** Signature multiplier while moving. */
export const MOTION_SIG = 98304; // 1.5
/** Signature multipliers by cover level 0-3 (concealment). */
export const COVER_SIG = new Int32Array([65536, 49152, 32768, 22938]); // 1, .75, .5, .35
/** Extra occlusion per cover tile crossed by the sight line. */
export const OCCL_PER_COVER = 22938; // 0.35
/** Ticks after firing during which firing_signature_mult applies. */
export const FIRING_SIG_TICKS = 60; // 3 s
/** Detection distance² floor — point blank is never division by zero. */
export const MIN_DETECT_DIST_SQ = 65536; // 1 tile²

// --- hit (5.2) -------------------------------------------------------------
/** Range-falloff sharpness by weapon class: falloff = exp(-scale*(r/r_eff)²).
 *  Guided weapons (ATGM) barely decay inside their envelope — accuracy is
 *  launch-condition-dominated, which is what makes ATGM Pk ≈ 0.7 real. */
export const FALLOFF_SCALE = new Int32Array([
  65536, // apfsds
  65536, // heat
  65536, // he
  16384, // atgm — guided, 0.25
  65536, // rpg
  65536, // small_arms
  65536, // hmg
  65536, // autocannon
  65536, // mortar
  65536, // rocket
  65536, // interceptor
  65536, // demolition
]);
/** Hit-chance cover modifiers by cover level 0-3 (GDD: 0.2 … 1.0). */
/** Hit-chance cover modifiers by cover level 0-3 (GDD: 0.2 … 1.0).
 *  Retuned when attack-move learned to sweep: the old numbers passed 3:1
 *  partly because stalled attackers ran out the mission clock, so part of
 *  the defensive advantage was an artefact rather than the model. With
 *  attackers pressing properly, cover has to carry it. */
export const COVER_HIT = new Int32Array([65536, 24576, 9011, 5898]); // 1, .375, .1375, .09
/** Weapon range a unit gains from inside a building, Q16.16 tiles, on top of
 *  measuring from the window (lead ruling 2026-10-14, GH-34). Maximum and
 *  effective range both; not sight, not minimum range. +1 by the lead's ruling
 *  of 2026-10-14 (L-2), from a measured +1/+2 table
 *  (docs/superpowers/plans/2026-10-14-garrison-overhaul.md): §5.7 identical for
 *  both; +2 broke two more missions and two unlock gates. */
export const GARRISON_RANGE_BONUS = 65536; // 1 tile
export const TARGET_MOTION_MOD = 45875; // 0.7
export const MOVING_STANCE_MOD = 36045; // 0.55
/** k in accuracy_mult = 1 / (1 + k * S). */
export const SUPP_K = 98304; // 1.5

// --- penetration (5.3) -----------------------------------------------------
/** sigma = PEN_SIGMA_MULT * penetration (dispersion of the pen curve). */
export const PEN_SIGMA_MULT = 7864; // 0.12
export const SIGMA_MIN = 65536; // 1 mm RHA
/** Max obliquity armor bonus at the edge of a facing arc. */
export const OBLIQ_MAX = 13107; // 0.2
/** ERA multiplier vs shaped charge (heat/rpg/atgm). */
export const ERA_SHAPED_MULT = 98304; // 1.5
/** Facing arcs, Q16.16 turns: front/rear are ±60° from axis. */
export const ARC_60 = 10923; // 60°
export const ARC_120 = 21845; // 120°
/** Below this frontal armor a unit is "soft": no component table, direct damage. */
export const SOFT_ARMOR_LIMIT = 1966080; // 30 mm

// --- target selection (5.3 applied to the gunner's choice) -----------------
/** An ARMOURED target counts as one a weapon can hurt only when the weapon's
 *  real P(penetration) against the face it presents to the shooter -- the
 *  same curve resolveHit rolls -- reaches this. Below it a shot is a clang on
 *  the hull: still taken as a last resort (bounce suppression), never in
 *  preference to a target the weapon can hurt. 0.05 separates a 30 mm on an
 *  Eitan's side (0.08) from the same gun on a Lavi's rear (0.02). */
export const PEN_HURTS_MIN = 3277; // 0.05
/** Anti-armour weapons (apfsds, heat, atgm, rpg) rank a soft or unarmed
 *  target -- infantry, a jeep, a D9, a firepower-killed hull -- as if it stood
 *  further away, so a hurtable armed vehicle at similar range wins the shot.
 *  A plain integer multiplier on squared distance: 4 = twice the distance. */
export const ANTI_ARMOR_SOFT_RANK_SQ = 4; // 2x distance

// --- component table (5.4), integer percent weights ------------------------
export const COMP_CREW_SHAKEN = 45;
export const COMP_MOBILITY = 20;
export const COMP_FIREPOWER = 15;
export const COMP_BOTH = 12;
export const COMP_CATASTROPHIC = 8;
/** Overmatch shift: bonus = clamp((z - 1) * 10, 0, 30) percentage points moved
 *  from crew_shaken to catastrophic as penetration overmatch grows. */
export const OVERMATCH_SHIFT_PER_Z = 10;
export const OVERMATCH_SHIFT_MAX = 30;

// --- suppression (5.5) -----------------------------------------------------
/** Per-tick decay: e^(-lambda * dt), lambda = 0.15/s. */
export const SUPP_DECAY = 65046; // 0.99253
export const PIN_AT = 45875; // 0.70 — go to ground
export const UNPIN_AT = 29491; // 0.45 (hysteresis)
export const SUPP_CAP = 131072; // 2.0
export const NEAR_MISS_RADIUS_SQ = 94372; // 1.2 tiles squared
/** Incoming-suppression multiplier by cover level: entrenched troops keep
 *  their nerve. This is the asymmetry that makes clearing cost 3:1. */
/** Incoming-suppression multiplier by cover level: entrenched troops keep
 *  their nerve. This is the asymmetry that makes clearing cost 3:1. */
export const COVER_SUPP = new Int32Array([65536, 31130, 9011, 5898]); // 1, .475, .1375, .09
/** Suppression multiplier for fire that cannot hurt the target at all —
 *  rifle rounds cracking off an MBT. Noise, not a threat. Applies to a near
 *  miss and, since 2026-10-13, to a bounce off armour the round could never
 *  have penetrated. */
export const HARMLESS_SUPP = 6554; // 0.1
/** Hits, non-penetrating hits and blasts shake the crew this many times
 *  harder than a near miss. Q16.16 like every multiplier here: it goes through
 *  fx.mul, and as a plain 2 (the value from the first sim commit until
 *  2026-10-13) it meant 2/65536, so none of those paths suppressed at all.
 *  Its users: a hit on a soft target, a bounce off armour, a blast's splash
 *  (`splashAt`, and `splashDirect` for kamikaze and tunnel-collapse blasts),
 *  and a kamikaze's own bounce. */
export const BOUNCE_SUPP_MULT = 131072; // 2.0
export const CREW_SHAKEN_SUPP = 52429; // 0.8
/** Weapon suppression stat divided by this = suppression per near miss.
 *  Calibrated by the urban-ratio backtest: smaller means shots pin harder.
 *  Below ~600 mutual pinning stalls attackers and inverts the ratio curve.
 *  700 -> 730 on 2026-10-13 (lead ruling on #584), when hits, bounces and
 *  splash began to suppress: at 700 the max-tier smoke step read 88% (target
 *  >= 90%). Swept 700/710/720/725/730/740/750/800 -> max-tier 2:1+smoke
 *  88/85/88/88/98/95/93/98%; 730 is the smallest that passes every §5.7
 *  target at both tiers. */
export const SUPP_STAT_DIVISOR = 730;

// --- protective systems (5.6) ----------------------------------------------
/** Which weapon classes an APS can engage at all (shaped charge family). */
export const APS_INTERCEPTABLE_MASK = (1 << 1) | (1 << 3) | (1 << 4); // heat|atgm|rpg
/** P(intercept) velocity factor by weapon class index (0 where N/A). */
export const APS_VEL_F = new Int32Array([0, 49152, 0, 65536, 62259, 0, 0, 0, 0, 0, 0, 0]); // heat .75, atgm 1.0, rpg .95
export const APS_SAT_WINDOW = 40; // 2 s
export const APS_SAT_PENALTY = 16384; // 0.25 per recent engagement
export const APS_SAT_CAP = 49152; // 0.75

// --- projectiles -----------------------------------------------------------
/** Flight speed by weapon class, Q16.16 tiles/s. 0 = hitscan (impact next tick). */
export const PROJ_SPEED = new Int32Array([
  0, // apfsds
  655360, // heat 10
  655360, // he 10
  262144, // atgm 4
  393216, // rpg 6
  0, // small_arms
  0, // hmg
  0, // autocannon
  262144, // mortar 4
  327680, // rocket 5
  0, // interceptor
  131072, // demolition 2
]);
/** Miss scatter: radius = 0.5 + u tiles, u uniform in [0,1). */
export const SCATTER_BASE = 32768; // 0.5

// --- veterancy (campaign ledger carry-over) --------------------------------
/** Effective-accuracy bonus per veterancy level (0-3). */
export const VET_ACC_BONUS = 3932; // +6% per level
/** Incoming-suppression reduction per veterancy level. */
export const VET_SUPP_BONUS = 5243; // -8% per level

// --- stances / movement ----------------------------------------------------
/** Signature multiplier for an unsprung ambusher: weapons cold, heads down,
 *  minimum profile (GDD §6 behaviour vocabulary). */
export const AMBUSH_SIG = 32768; // 0.5
export const DEFAULT_TURN_DEG_S = 360;
/** How far a WALKING hull may point away from its line of march to aim at
 *  what it is shooting at, in Q16.16 turns.
 *
 *  This is an ANIMATION floor, not a combat knob, and it is the reason it may
 *  not be "simplified" away. There is exactly one movement clip and it is a
 *  forward walk, so a hull pointing further off its direction of travel than
 *  this slides its feet — the moonwalk that turning fully onto the target
 *  while moving produced. One eighth of a turn is also exactly one flow-field
 *  octant (`DIR_VX`/`DIR_VY`), so the aim may swing as far as the adjacent
 *  movement direction and no further; without a cap, a target abeam or behind
 *  puts the body up to 180° off the walk. Stationary hulls are unaffected —
 *  they have no walk cycle to contradict and turn onto the target freely.
 *
 *  `pnpm balance` cannot move it: the only hulls it applies to are
 *  `UnitType.bodyAimed` ones (soft AND isotropic), and `resolveHit` returns
 *  before it ever reads a soft target's facing. */
export const AIM_OFF_HEADING_MAX = 8192; // 0.125 turns = 45°
/** Ticks a unit that halts to fire (`UnitType.haltsToFire`: the foot units
 *  that shoot) spends getting down before its first shot: 0.2 s. The first
 *  shot is fired exactly this many ticks after the tick the unit first wanted
 *  to be down, and it does not move in between (spec
 *  `2026-10-05-infantry-halt-to-fire.md` §2).
 *
 *  Measured, not just reasoned (spec §6). In this model whoever shoots first
 *  at close range pins the other, and the attacker coming into sight is
 *  always the one getting down, so every tick here is paid by the assault.
 *  Max-tier 2:1 urban assault with smoke, shipped design: 6 (0.3 s, accepted
 *  by the lead 6 Oct) reads 88% on the gate's 60 seeds against a 90% floor
 *  (94% over 240); 4 (0.2 s) reads 97% (96% over 240). The realism-only
 *  first pick, 12 (0.6 s), read 68% under the first design. Kneeling adds no
 *  cover, accuracy or signature of its own (see `Sim.isEffectivelyMoving`). */
export const KNEEL_DROP_TICKS = 4;
/** Ticks a kneeling unit spends getting up before it moves again: 0.2 s. The
 *  unit moves again exactly this many ticks after the tick it started to
 *  rise. Same measurement and direction as the drop: a man getting up neither
 *  fires nor moves, and the rise is paid every time a target dies or a halt
 *  ends. */
export const KNEEL_RISE_TICKS = 4;
/** Attack-move with a target only in the band between effective and maximum
 *  range, and that target IN THE OPEN (cover level 0): a unit that halts to
 *  fire advances by bounds -- down and firing for BOUND_FIRE_TICKS, then up
 *  and moving for BOUND_MOVE_TICKS -- so the rear ranks of a larger force
 *  bring their rifles to bear (without it the Lanchester target failed: 16v8
 *  left 10.4 survivors against a 13.9 square law, the fight broke up into
 *  routs that lost contact). A band target IN COVER is not worth stopping
 *  short for: the squad closes to effective range instead. That half is the
 *  sight-upgrade fix -- 13 tiles of sight let a max-tier squad identify
 *  covered defenders in the band and bound against them under their fire
 *  (max-tier 2:1 + smoke 86% over 240 seeds; 96% with the split).
 *  Halting for good at maximum range was measured too: a 2:1 urban assault
 *  carried ~95%, two ratio steps. 2 s each; 60/20, 20/40 and 30/30 moved
 *  nothing outside noise. */
export const BOUND_FIRE_TICKS = 40;
export const BOUND_MOVE_TICKS = 40;
/** Speed right-shift while pinned. Calibrated to 6 (÷64 — effectively
 *  halted): together with pinned-units-hold-fire this is what makes fire
 *  superiority decisive and the urban 3:1 ratio emerge in the backtest.
 *  GDD 5.5's "movement halved" (shift 1) let assaults creep through
 *  defensive fire and flattened the ratio curve. */
export const PIN_SPEED_SHIFT = 6;
/** Soft units pinned continuously this long rout (GDD 5.5a): 10 s. */
export const ROUT_AFTER_TICKS = 200;
/** Routed units flee at half speed, this far from the nearest known threat. */
export const ROUT_SPEED_SHIFT = 1;
export const ROUT_DISTANCE = 393216; // 6 tiles

/** Extra flow-field cost per elevation level CLIMBED, in the same tenths-of-a-
 *  tile units the field already uses (COST_ORTH 10, COST_DIAG 14). One level of
 *  climb therefore costs what one extra tile of flat ground costs.
 *
 *  Descending is FREE, and the asymmetry is the design rather than an omission:
 *  high ground is expensive to attack and cheap to withdraw from. A symmetric
 *  cost would price a retreat downhill exactly like the assault that took the
 *  hill, and the withdraw-downhill option would stop existing.
 *
 *  A plain integer, added straight to an Int32Array of costs -- no Q16.16
 *  anywhere near the flow field, which is what keeps invariant 2 intact on the
 *  one code path every unit runs every tick.
 *
 *  `pnpm balance` cannot move it. All five GDD 5.7 scenarios are built directly
 *  by the harness on flat ground and never call `setElevation`, so every climb
 *  in them is 0. What this number is calibrated against is the ladder: only Tel
 *  Marum has relief, and only its three missions re-time when it changes. */
export const UPHILL_PER_LEVEL = 10;

// --- smoke (GDD ability vocabulary) -----------------------------------------
/** Density a fresh screen puts on each covered tile, and the per-tick burn
 *  that lifts it. 255 at 1 per tick ≈ 13 s of concealment, thinning at the
 *  edges sooner — long enough to cross a street, not a whole assault. */
export const SMOKE_MAX = 255;
export const SMOKE_DECAY = 1;
/** Radius of a laid screen, in tiles. */
export const SMOKE_RADIUS = 3;
/** Total density along a sight line that stops it entirely. */
export const SMOKE_BLOCKS_AT = 320;
/** Each smoky tile crossed multiplies hit chance by this (0.55). */
export const SMOKE_HIT_MULT = 36045;
/** Floor on the smoke hit penalty: firing blind still occasionally connects. */
export const SMOKE_HIT_FLOOR = 6554; // 0.1
/** Ticks before a unit can lay smoke again: 45 s. */
export const SMOKE_COOLDOWN = 900;
/** How far from itself a unit can place a screen, squared tiles. */
export const SMOKE_RANGE_SQ = 5242880; // 80 tile^2 ≈ 9 tiles

// --- sweeping (attack-move without a contact) -------------------------------
/** A swept position counts as searched inside this radius: squared tiles. */
export const SWEEP_ARRIVE_SQ = 147456; // 2.25 tile^2 = 1.5 tiles

// --- fire support bought with intel (GDD §3) --------------------------------
/** Precision strike: accurate, and heavy enough that using it near people
 *  is a decision rather than a reflex. */
export const STRIKE_DAMAGE = 39321600; // 600
export const STRIKE_SPLASH = 131072; // 2.0 tiles
export const STRIKE_SUPPRESSION = 78643; // 1.2
export const STRIKE_DELAY_TICKS = 60; // 3 s from call to impact
/** Miss scatter for a guided munition: tight, but not zero. */
export const STRIKE_SCATTER = 19661; // 0.3 tiles
/** Satellite sweep: everything hostile inside this radius is identified. */
export const SWEEP_RADIUS_SQ = 3932160; // 60 tile^2 ≈ 7.7 tiles

// --- the fire-support profile table (F1 Task 6; GH-183) ------------------------
/** One fire-support round pattern. `callStrike` queues `rounds` entries, the
 *  i-th at `tickCount + delayTicks + i * spacingTicks`, each with its own
 *  scatter pair from the CALLER's rng stream (invariant 3). `damage`, `splash`
 *  and `suppression` are read per entry at impact. */
export interface FireSupportProfile {
  readonly rounds: number;
  readonly spacingTicks: number;
  readonly delayTicks: number;
  readonly scatter: number; // Q16.16, tiles
  readonly damage: number; // Q16.16
  readonly splash: number; // Q16.16, tiles
  readonly suppression: number; // Q16.16
  /** `'smoke'` rounds lay a screen instead of exploding (Task 7 stamps it). */
  readonly payload: 'he' | 'smoke';
  /** Scatter draw width. `false` is today's air strike, byte for byte: the top
   *  16 bits of one draw, so it tops out at 65535 (1 tile). `true` uses the full
   *  32-bit draw, which is the only way a 1.5-tile scatter is reachable. Both
   *  take exactly two caller-stream draws a round. */
  readonly wideScatter: boolean;
  /** Does `garrison_cover`/tile cover muffle this round's suppression? F-Q13
   *  (lead, 14 Oct): false for the air strike (byte for byte as before), true
   *  for the barrage, so it pins a garrison like a mortar team's own round. */
  readonly coverProtects: boolean;
}
export const FS_AIR_STRIKE = 0;
export const FS_MORTAR_BARRAGE = 1;
export const FS_SMOKE_SCREEN = 2;
/** Indexed by `callStrike.profile` (absent = FS_AIR_STRIKE). Rows 1 and 2 are
 *  `docs/campaign/economy/fire-support-numbers.md` §Profiles, PROVISIONAL until
 *  the lead confirms the G-NUM table. */
export const FIRE_SUPPORT: readonly FireSupportProfile[] = [
  {
    // air_strike: today's constants, by reference (F-R4).
    rounds: 1,
    spacingTicks: 0,
    delayTicks: STRIKE_DELAY_TICKS,
    scatter: STRIKE_SCATTER,
    damage: STRIKE_DAMAGE,
    splash: STRIKE_SPLASH,
    suppression: STRIKE_SUPPRESSION,
    payload: 'he',
    wideScatter: false,
    coverProtects: false,
  },
  {
    // mortar_barrage: 6 rounds 1.8 s apart, first lands 6 s after the call.
    rounds: 6,
    spacingTicks: 36, // 1.8 s
    delayTicks: 120, // 6 s
    scatter: 98304, // 1.5 tiles
    damage: 7864320, // 120
    splash: 65536, // 1.0 tile
    suppression: 39322, // 0.6
    payload: 'he',
    wideScatter: true,
    coverProtects: true, // F-Q13
  },
  {
    // smoke_screen: 3 rounds 2 s apart, first lands 4 s after the call. No
    // damage and no suppression; Task 7 stamps a SMOKE_RADIUS disc per round.
    rounds: 3,
    spacingTicks: 40, // 2 s
    delayTicks: 80, // 4 s
    scatter: 98304, // 1.5 tiles (the barrage's own; the doc's flagged choice)
    damage: 0,
    splash: 0,
    suppression: 0,
    payload: 'smoke',
    wideScatter: true,
    coverProtects: true, // moot: a smoke round suppresses nothing
  },
];

/** The fire-support menu (F1, GH-183): four calls, one entry point. Here rather
 *  than in `mission.ts` (N2, R-4) so `sim.ts` can name the kinds on its
 *  `support` command without importing the runtime; `mission.ts` re-exports both.
 *  Declared AFTER `FIRE_SUPPORT`: `ui/support-kinds.test.ts` finds that table
 *  as the first `export const FIRE_SUPPORT` in this file's text. */
export type SupportKind = 'smoke_screen' | 'mortar_barrage' | 'drone_sweep' | 'air_strike';
export const FIRE_SUPPORT_KINDS: readonly SupportKind[] = [
  'smoke_screen',
  'mortar_barrage',
  'drone_sweep',
  'air_strike',
];

// --- intel earned by doing (F1; GDD §3) --------------------------------------
/** Intel for the first identification of an enemy by a real observer (once per
 *  enemy per mission, D3). Whole intel points, not Q16.16. The 8/40/30 row is the
 *  lead's ruling of 15 Oct (8/40/30; smoke 100): see
 *  docs/campaign/economy/fire-support-numbers.md. */
export const INTEL_PER_IDENTIFIED = 8;
/** High ground (F1, D4): how many levels above the map's median open-tile level a
 *  tile must stand to belong to a rise. Two, because a one-level rise sits exactly
 *  at eye level (`EYE_HEIGHT`, 1) and grants no sight. Whole levels, not Q16.16. */
export const HIGH_GROUND_LEVELS = 2;
/** High ground (F1, D4): how long one surface unit must stand on a rise, with no
 *  enemy inside the hold rule's contest radius, before the rise pays. 200 ticks
 *  = 10 s at 20 Hz. */
export const HIGH_GROUND_HOLD_TICKS = 200;
/** Intel for holding a high-ground rise, once per rise per mission (D4). Whole
 *  intel points. The same 8/40/30 row as above (lead ruling 15 Oct; unchanged at 30):
 *  see docs/campaign/economy/fire-support-numbers.md. */
export const INTEL_PER_RISE = 30;
/** Intel for completing an objective, primary or secondary (never for a failure, D5).
 *  Same ruled row as above (lead ruling 15 Oct: 40 here, up from the provisional 30
 *  and the plan's first-draft 25). */
export const INTEL_PER_OBJECTIVE = 40;

// --- carriers and munitions -------------------------------------------------
/** How close a passenger must be to climb aboard: squared tiles, Q16.16. */
export const LOAD_RANGE_SQ = 147456; // 2.25 tile^2 = 1.5 tiles
/** A bailing squad loses this share of its strength when the vehicle brews
 *  up: riding is fast, and being caught in the open inside it is the price. */
export const BAILOUT_DAMAGE_FRAC = 26214; // 0.4
/** And comes out shaken. */
export const BAILOUT_SHOCK = 58982; // 0.9
/** A loitering munition detonates inside this radius: squared tiles. */
export const KAMIKAZE_STRIKE_SQ = 98304; // 1.5 tile^2 = 1.22 tiles

// --- field recovery ---------------------------------------------------------
/** Ticks without taking damage before a unit starts patching up (10 s). */
export const REGEN_DELAY_TICKS = 200;
/** Recovery per tick as a fraction of max hp (~0.5%/s). */
export const REGEN_FRAC = 16; // 0.00024
/** Field recovery ceiling: walking wounded mend, serious damage does not. */
export const REGEN_CAP = 45875; // 0.7

// --- held ground and supply corridors (F2, GH-183) ---------------------------
// Squared distances, in the mission.ts convention: per axis d = (fx.sub(a, b) >> 8) | 0
// (1/256 tile), compared as dx*dx + dy*dy <= SQ.
/** How close an enemy must be to your troops to be contesting the ground
 *  rather than merely standing somewhere inside a large rectangle: 6 tiles,
 *  squared, in Q16.16. Objective zones are big — 'no enemy anywhere in the
 *  zone' let one routed survivor in a far corner freeze a hold forever.
 *  Also the corridor's contest radius: a friendly this near an interdictor
 *  makes the line contested, not cut (moved here from mission.ts, value unchanged). */
export const CONTEST_RADIUS_SQ = 2359296; // 36 tile^2 = 6 tiles
/** A surface ground enemy this near a supply-route tile interdicts the corridor (D4 b). */
export const CORRIDOR_INTERDICT_SQ = 262144; // 4 tile^2 = 2 tiles
/** An open vent of a hostile-stocked tunnel this near a supply-route tile cuts the corridor (D4 c). */
export const CORRIDOR_VENT_SQ = 589824; // 9 tile^2 = 3 tiles
/** How often the mission runtime recomputes every supply route and what cuts it (F2, D4/D5),
 *  in ticks: once a second. A structure's death and a zone's change of holder recheck at once. */
export const CORRIDOR_RECHECK_TICKS = 20; // 1 s at 20 Hz

/** N2 (R-1): the ambush radius `setStance{ambush}` uses when it names none --
 *  3 tiles, mission JSON's own default (Q16.16) -- and the most the wire accepts,
 *  10 tiles, the largest `tiles` any shipped mission authors. */
export const AMBUSH_RADIUS_DEFAULT = 196608;
export const AMBUSH_RADIUS_MAX = 655360;

/** Production lines one side may stand (F4, R-F4-4): `validate:data` and `start()` refuse more. */
export const MAX_PRODUCTION_LINES = 4;
/** Items waiting on one production line, not counting the one in progress (F4, R-F4-4). */
export const MAX_LINE_QUEUE = 16;

/** Field works (#277): construction sites one sim holds at once (Task 4 writes the table). */
export const MAX_SITES = 8;
/** Field works (#277, N13): auras refresh every this many ticks, `tickCount % AURA_CADENCE_TICKS`
 *  -- twice a second at 20 Hz. Read by Task 6's `stepAuras`. */
export const AURA_CADENCE_TICKS = 10; // 0.5 s
/** Field works (#277, Task 4): how close a builder must stand to a footprint tile centre to
 *  stake the site and to add progress. Squared tiles, Q16.16 -- the demolition reach
 *  (`DEMO_RANGE_SQ`, structures.ts), written out because this module imports nothing. */
export const BUILD_RANGE_SQ = 262144; // 4.0 tile^2 = 2 tiles
/** Field works: builders that add progress to one site in one tick, lowest id first. */
export const MAX_BUILDERS = 2;
/** Field works: a staked site's HP, as a fraction of its maximum. */
export const STAKE_HP_FRAC = 6554; // 0.1
/** Field works: the HP a site gains over the whole build, as a fraction of its maximum,
 *  `ONE - STAKE_HP_FRAC`: added in proportion to progress, so a site never damaged ends at
 *  (very nearly) full. */
export const BUILD_HP_FRAC = 58982; // 0.9

/** Air carriers (GH-698): ticks an air carrier spends settling onto an LZ, AIRBORNE -> LANDED
 *  through AIR_LANDING. Integer ticks at 20 Hz. Proposal (Q4), provisional until the probe reads. */
export const AIR_LAND_TICKS = 40; // 2 s
/** Air carriers: ticks from LANDED back to AIRBORNE through AIR_LIFTING. */
export const AIR_LIFT_TICKS = 20; // 1 s
/** Air carrier flight state (`airState`). AIRBORNE is the spawn default; only LANDING and LANDED
 *  are ground targets (Q-C, 21 Oct). */
export const AIR_AIRBORNE = 0;
export const AIR_LANDING = 1;
export const AIR_LANDED = 2;
export const AIR_LIFTING = 3;
/** Air carrier intent (`airWant`): why it is landing or what it does once landed. */
export const AIR_WANT_NONE = 0;
export const AIR_WANT_LOAD = 1;
export const AIR_WANT_UNLOAD = 2;
export const AIR_WANT_DEPART = 3;

// --- wounded and rescue (GH-707, P1 engine) ---------------------------------
// Engine only until P3 (lead rulings, 22 Oct): nothing shipped carries `hull.wounds`, so none
// of these is reached by any replay. Every reader is gated by `Sim.woundLive`.
/** Wounded men one side may have alive at once; the next one to fall dies instead. */
export const MAX_WOUNDED_PER_SIDE = 24;
/** A DOWN wounded crawls toward better cover every this many ticks. */
export const WOUND_CRAWL_PERIOD_TICKS = 40; // 2 s
/** Half-width of the crawl scan, tiles: a 5x5 window. */
export const WOUND_CRAWL_SCAN = 2;
/** A crawler on cover at or above this level stops. */
export const WOUND_COVER_STOP = 2;
/** A medic this near a wounded treats him, and his bleed pauses. Squared tiles, Q16.16. */
export const MEDIC_TREAT_REACH_SQ = 262144; // 4 tile^2 = 2 tiles
/** Each rejoin returns this much less of a man's hp share (`scarredShare`). */
export const WOUND_SCAR_STEP = 13107; // 0.2
/** ...but never less than this fraction of it. */
export const WOUND_SCAR_FLOOR = 26214; // 0.4
/** Conduct points for rescuing an enemy wounded (admitted or evacuated), ruling 3. */
export const CONDUCT_GAIN_ENEMY = 2;
/** Conduct points for rescuing a civilian wounded, ruling 3. */
export const CONDUCT_GAIN_CIVILIAN = 3;
/** Most Conduct one mission's rescues can earn, ruling 3. */
export const CONDUCT_GAIN_CAP = 10;
/** Conduct deducted when the player kills an enemy wounded. */
export const CONDUCT_KILL_WOUNDED_ENEMY = 3;
/** Longest authored wound/rescue/aid duration, seconds: secondsToTicks' fx.mul wraps at
 *  1638.4 s (32768 ticks x 65536 = 2^31), so the schema and the loader stop at 1600. */
export const WOUND_MAX_SECONDS = 1600;
/** Largest authored wound/rescue/aid radius, tiles: squared in Q16.16 it stays far from 2^31. */
export const WOUND_MAX_RADIUS_TILES = 64;
/** Evacuation points one sim holds (D4, `addEvacPoint`). */
export const MAX_EVAC_POINTS = 8;
/** `woundState`: NONE for every unit that is not down. */
export const WOUND_NONE = 0;
export const WOUND_DOWN = 1;
export const WOUND_STABILISED = 2;
export const WOUND_ADMITTED = 3;
export const WOUND_GONE = 4;
/** `medState`: what a medic is doing. */
export const MED_IDLE = 0;
export const MED_TO_WOUNDED = 1;
export const MED_TREATING = 2;
export const MED_CARRYING = 3;
export const MED_DELIVERING = 4;
