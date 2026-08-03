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
export const COVER_HIT = new Int32Array([65536, 39322, 16384, 13107]); // 1, .6, .25, .2
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
export const COVER_SUPP = new Int32Array([65536, 42598, 16384, 13107]); // 1, .65, .25, .2
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
