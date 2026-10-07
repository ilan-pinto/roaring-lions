// What happened, where and when -- kept by the app for the after-action report
// (GH-417, ruling L-6). The sim already says everything this needs on its way
// out (`MissionEvent`s, `SimEvent`s); this only remembers it, with the one
// thing the events do not carry: WHERE, read off sim state at the tick the
// event arrived (invariant 4: read, never written).
//
// Pure: a log value and functions that add to it, so the report's rules are
// proved without a battlefield. `main.ts` feeds it from the loop that already
// handles every event; nothing else writes it.

import { classifyReason } from './ui/conduct-invoice';

export interface LoggedLoss {
  tick: number;
  entity: number;
  type: string;
  /** The roster name, when the body had one. */
  name?: string;
  veterancy: number;
  x: number;
  y: number;
}

export interface LoggedDeduction {
  tick: number;
  reason: string;
  penalty: number;
  /** Where, when the reason names a zone (fire into protected ground). A
   *  civilian casualty or a razed structure says no place, and gets no pin. */
  x?: number;
  y?: number;
}

export interface LoggedObjective {
  tick: number;
  id: string;
  status: 'complete' | 'failed';
}

export interface MissionLog {
  losses: LoggedLoss[];
  deductions: LoggedDeduction[];
  objectives: LoggedObjective[];
  /** Hostile units killed, by anyone. */
  kills: number;
}

export function newMissionLog(): MissionLog {
  return { losses: [], deductions: [], objectives: [], kills: 0 };
}

export interface LogContext {
  /** A unit's position in tiles, read off sim state. */
  positionOf(entity: number): { x: number; y: number };
  /** The roster entry a player unit was spawned from, if any. */
  rosterOf(entity: number): { name?: string; veterancy: number } | undefined;
  /** A zone's rect `[x, y, w, h]`, if the map declares it. */
  zone(id: string): readonly number[] | undefined;
}

/** One `MissionEvent`, remembered if the report needs it. */
export function logMissionEvent(
  log: MissionLog,
  ev:
    | { kind: 'unitLost'; tick: number; entity: number; unit: string }
    | { kind: 'roe'; tick: number; penalty: number; reason: string }
    | { kind: 'objective'; tick: number; id: string; status: string }
    | { kind: string; tick: number },
  ctx: LogContext
): void {
  if (ev.kind === 'unitLost' && 'entity' in ev && 'unit' in ev) {
    const p = ctx.positionOf(ev.entity);
    const r = ctx.rosterOf(ev.entity);
    log.losses.push({
      tick: ev.tick,
      entity: ev.entity,
      type: ev.unit,
      ...(r?.name !== undefined ? { name: r.name } : {}),
      veterancy: r?.veterancy ?? 0,
      x: p.x,
      y: p.y,
    });
  } else if (ev.kind === 'roe' && 'reason' in ev && 'penalty' in ev) {
    const place = classifyReason(ev.reason).place;
    const z = place !== undefined ? ctx.zone(place) : undefined;
    const at = z && z.length >= 4 ? { x: z[0] + z[2] / 2 - 0.5, y: z[1] + z[3] / 2 - 0.5 } : {};
    log.deductions.push({ tick: ev.tick, reason: ev.reason, penalty: ev.penalty, ...at });
  } else if (ev.kind === 'objective' && 'status' in ev && (ev.status === 'complete' || ev.status === 'failed')) {
    log.objectives.push({ tick: ev.tick, id: ev.id, status: ev.status });
  }
}

/** One `SimEvent` `destroyed`: counts a hostile kill. */
export function logDestroyed(log: MissionLog, side: number): void {
  if (side === 1) log.kills++;
}
