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
  type MissionJson,
  type MissionContext,
  type MissionEvent,
  type ObjectiveStatus,
  type PlacementJson,
  type LedgerData,
  type LedgerRosterEntry,
  type MissionEventKindsAreExhaustive,
} from './mission';
export { unlockReason, type UnlockGate } from './unlock';
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
  type SimConfig,
  type Command,
  type SimEvent,
  type UnitTypeJson,
  type WeaponJson,
  type UnitType,
  type WeaponStats,
  type HitFactors,
  type HitProjection,
  type SimEventKindsAreExhaustive,
} from './sim';
