/**
 * The app's own bookkeeping of a running mission, as the `shell` of a save (GH-1393 slice 2; design section 1, "Shell record").
 *
 * No snapshot can hold it: the mission log, the Conduct deductions, the fallen, which ROE advice was already narrated, which
 * deadlines were warned. The debrief and the victory write are built from them, so a resumed mission that lost them would end with a
 * wrong memorial and an empty after-action report. Plain JSON in, plain JSON out; `parseShell` validates every field and returns null
 * for anything that is not exactly this shape (the resume is then refused as damaged, never half-applied).
 *
 * Deliberately NOT here: the stall hint (sim-time state, restarted at the resumed tick), the replay log of the Bug note (it cannot
 * be rebuilt from the middle: the note says no replay is attached), and every presentation state (camera, selection), which is
 * best-effort and not an outcome.
 */
import type { LostRecord } from './ledger-store';
import type { JsonValue } from './mission-save';
import type { LoggedDeduction, LoggedLoss, LoggedObjective, MissionLog } from './mission-log';
import type { Deduction } from './ui/conduct-invoice';

export interface ShellRecord {
  v: 1;
  log: MissionLog;
  deductions: Deduction[];
  lost: LostRecord[];
  narratedRoe: string[];
  evacuated: number;
  deadlinesWarned: string[];
  limitWarned: boolean;
}

export interface ShellState {
  log: MissionLog;
  deductions: readonly Deduction[];
  lost: readonly LostRecord[];
  narratedRoe: ReadonlySet<string>;
  evacuated: number;
  deadlinesWarned: ReadonlySet<string>;
  limitWarned: boolean;
}

/** A copy, so the record cannot change under the running mission, nor the mission under the record. */
export function captureShell(s: ShellState): ShellRecord {
  return {
    v: 1,
    log: structuredClone(s.log),
    deductions: s.deductions.map((d) => ({ ...d })),
    lost: s.lost.map((l) => ({ ...l })),
    narratedRoe: [...s.narratedRoe].sort(),
    evacuated: s.evacuated,
    deadlinesWarned: [...s.deadlinesWarned].sort(),
    limitWarned: s.limitWarned,
  };
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const arrayOf = <T>(v: unknown, ok: (x: unknown) => x is T): T[] | null => (Array.isArray(v) && v.every(ok) ? (v as T[]) : null);

const isLoss = (v: unknown): v is LoggedLoss => isRec(v) && isInt(v.tick) && isInt(v.entity) && isStr(v.type) && isNum(v.x) && isNum(v.y) && (v.name === undefined || isStr(v.name));
const isLoggedDeduction = (v: unknown): v is LoggedDeduction =>
  isRec(v) && isInt(v.tick) && isStr(v.reason) && isNum(v.penalty) && (v.x === undefined || isNum(v.x)) && (v.y === undefined || isNum(v.y));
const isLoggedObjective = (v: unknown): v is LoggedObjective => isRec(v) && isInt(v.tick) && isStr(v.id) && (v.status === 'complete' || v.status === 'failed');
const isDeduction = (v: unknown): v is Deduction => isRec(v) && isNum(v.penalty) && isStr(v.reason) && (v.tick === undefined || isInt(v.tick));
const isLost = (v: unknown): v is LostRecord =>
  isRec(v) && isInt(v.slot) && isStr(v.type) && isNum(v.veterancy) && isInt(v.missions) && isInt(v.kills) && isStr(v.missionId) && isInt(v.tick) && (v.name === undefined || isStr(v.name));

/** The record, or null when anything about it is not what `captureShell` writes. */
export function parseShell(raw: unknown): ShellRecord | null {
  if (!isRec(raw) || raw.v !== 1 || !isRec(raw.log)) return null;
  const losses = arrayOf(raw.log.losses, isLoss);
  const logDeductions = arrayOf(raw.log.deductions, isLoggedDeduction);
  const objectives = arrayOf(raw.log.objectives, isLoggedObjective);
  const deductions = arrayOf(raw.deductions, isDeduction);
  const lost = arrayOf(raw.lost, isLost);
  const narratedRoe = arrayOf(raw.narratedRoe, isStr);
  const deadlinesWarned = arrayOf(raw.deadlinesWarned, isStr);
  if (losses === null || logDeductions === null || objectives === null || deductions === null || lost === null || narratedRoe === null || deadlinesWarned === null) return null;
  if (!isInt(raw.log.kills) || (raw.log.evacuated !== undefined && !isInt(raw.log.evacuated)) || !isInt(raw.evacuated) || typeof raw.limitWarned !== 'boolean') return null;
  const log: MissionLog = { losses, deductions: logDeductions, objectives, kills: raw.log.kills, ...(raw.log.evacuated === undefined ? {} : { evacuated: raw.log.evacuated }) };
  return { v: 1, log, deductions, lost, narratedRoe, evacuated: raw.evacuated, deadlinesWarned, limitWarned: raw.limitWarned };
}

/** The record as the plain JSON a save carries (`MissionSaveInput.shell`). */
export const shellJson = (r: ShellRecord): JsonValue => JSON.parse(JSON.stringify(r)) as JsonValue;
