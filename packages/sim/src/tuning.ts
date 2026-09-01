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
 *  rifle rounds cracking off an MBT. Noise, not a threat. */
export const HARMLESS_SUPP = 6554; // 0.1
/** Non-penetrating hits shake the crew this many times harder than a near miss. */
export const BOUNCE_SUPP_MULT = 2;
export const CREW_SHAKEN_SUPP = 52429; // 0.8
/** Weapon suppression stat divided by this = suppression per near miss.
 *  Calibrated by the urban-ratio backtest: smaller means shots pin harder.
 *  Below ~600 mutual pinning stalls attackers and inverts the ratio curve. */
export const SUPP_STAT_DIVISOR = 700;

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
