// @lions/sim — deterministic simulation core.
// Q16.16 fixed-point, 20 Hz tick, seeded per-entity PRNG, commands in / events out.
// This package imports NOTHING (enforced by lint).

export const SIM_VERSION = 1;

export { fx, ONE, HALF, HALF_TURN, QUARTER_TURN, FX_MAX, FX_MIN, type Fx } from './fixed';
export { Rng } from './rng';
export { FlowField } from './flowfield';
export {
  MissionRuntime,
  MISSION_EVENT_KINDS,
  FIRE_SUPPORT_KINDS,
  type SupportKind,
  zoneContains,
  type MissionJson,
  type MissionContext,
  type MissionEvent,
  type ObjectiveStatus,
  type PlacementJson,
  type SayJson,
  type LedgerData,
  type LedgerRosterEntry,
  type MissionEventKindsAreExhaustive,
  type ZoneIncome,
  type ConvoyRoute,
  type DefeatCause,
  type WorksOffer,
  type WorksRefusal,
  worksRefund,
} from './mission';
export type { PlacementRefusal } from './sim';
export { DOMAIN_FOOT, DOMAIN_VEHICLE } from './sim';
export { REGEN_FRAC } from './tuning';
export type { StructureType } from './structures';
// The civilian flight rule, shared by `MissionRuntime` and the `&civ` sandbox.
// Exported because a sandbox has no mission and therefore no runtime, and the
// alternative to sharing it was a second copy of a game rule in `packages/app`.
export {
  CivilianFlight,
  CIV_FLEE_AT,
  SHEPHERD_RADIUS_SQ,
  missionShepherds,
  type CivilianFlightOptions,
} from './civilians';
// Held-ground income (F2, D3): who holds a zone, from a narrow view of unit state.
export { zoneHolder, zoneState, ZONE_CONTESTED, ZONE_EMPTY, type Holder, type HoldView, type ZoneState } from './income';
// The tiles a supply convoy drives (F2, D5): the road where one joins the ends, else the wheeled field.
export {
  corridorRoute,
  corridorCut,
  makeRouteSource,
  type CutCause,
  type RouteSource,
  type TileXY,
  type VentView,
} from './corridor';
export { unlockReason, isBoughtOnly, starsEarned, conductAtLeast, resolveUpgrades, loanedPlacements, type UnlockGate } from './unlock';
export {
  starsFor,
  starRoeFloor,
  betterResult,
  STAR_ROE_MARGIN,
  STAR_ROE_DEFAULT,
  type Stars,
  type MissionResult,
  type GradedObjective,
} from './grade';
export { creditsFor, creditInputFrom, CREDIT_WEIGHTS, type CreditInput } from './credits';
// The mosque threshold. The sim keeps units from levelling a protected site on
// their own initiative; the app needs the same number to keep an ambiguous
// right-click from manufacturing the explicit order that bypasses that rule.
export { PROTECTED_ROE } from './structures';
export {
  routeLength,
  pointAtDistance,
  TRAIL_MAX,
  type TunnelRouteJson,
} from './tunnels';
export {
  Sim,
  TICKS_PER_SECOND,
  DT,
  WEAPON_CLASS,
  unitTypeFromJson,
  SIM_EVENT_KINDS,
  BRACE_NONE,
  BRACE_DROPPING,
  BRACE_KNEELING,
  BRACE_RISING,
  type SimConfig,
  type Command,
  type RuntimeCommand,
  type SimEvent,
  type UnitTypeJson,
  type WeaponJson,
  type UnitType,
  type WeaponStats,
  type HitFactors,
  type HitProjection,
  type SimEventKindsAreExhaustive,
} from './sim';
// Halt-to-fire clip timing for the renderer (spec 2026-10-05-infantry-halt-to-fire §5).
export { KNEEL_DROP_TICKS, KNEEL_RISE_TICKS } from './tuning';
export { AMBUSH_RADIUS_DEFAULT, AMBUSH_RADIUS_MAX } from './tuning';
// The fire-support profile table (F1 Task 6): `callStrike.profile` indexes it.
export { FIRE_SUPPORT, FS_AIR_STRIKE, FS_MORTAR_BARRAGE, FS_SMOKE_SCREEN, type FireSupportProfile } from './tuning';
// The production line types, the contest test and the two bounds (R-F4-4). The state machine
// (advance, enqueue, cancel, spendDown) is the runtime's own; nothing outside the sim imports it.
export { lineContested, type LineItem, type ProductionLine } from './production';
export { MAX_PRODUCTION_LINES, MAX_LINE_QUEUE } from './tuning';
