// @lions/sim — deterministic simulation core.
// Q16.16 fixed-point, 20 Hz tick, seeded per-entity PRNG, commands in / events out.
// This package imports NOTHING (enforced by lint).

export const SIM_VERSION = 1;

export { fx, ONE, HALF, HALF_TURN, QUARTER_TURN, FX_MAX, FX_MIN, type Fx } from './fixed';
export { Rng } from './rng';
export { FlowField } from './flowfield';
export {
  MissionRuntime,
  type MissionJson,
  type MissionContext,
  type MissionEvent,
  type ObjectiveStatus,
  type PlacementJson,
  type LedgerData,
  type LedgerRosterEntry,
} from './mission';
export {
  Sim,
  TICKS_PER_SECOND,
  DT,
  WEAPON_CLASS,
  unitTypeFromJson,
  type SimConfig,
  type Command,
  type SimEvent,
  type UnitTypeJson,
  type WeaponJson,
  type UnitType,
  type WeaponStats,
  type HitFactors,
} from './sim';
