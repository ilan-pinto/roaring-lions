import { callsignOrDefault, type Pace, type SeatConfig } from '@lions/net';
import { isShippedMap } from './map-ids';

/** What `/api/match` and the room's `/create` both read from a create body:
 *  one default map and one cap, so the route and the room cannot disagree. */
export const DEFAULT_MAP = 'beit_sahwan_outskirts';
/** `map` and `build` are ids, not prose; this bounds what a client can make the room store. */
export const MAX_FIELD_CHARS = 64;

/** A string field, capped; `fallback` when absent or not a string. */
export function textField(v: unknown, fallback: string): string {
  return (typeof v === 'string' ? v : fallback).slice(0, MAX_FIELD_CHARS);
}

/** A room's map (#559 F5): `DEFAULT_MAP` when the body names none, the id
 *  when it is a map the game ships, and null -- refused -- for anything else. */
export function mapField(v: unknown): string | null {
  if (v === undefined || v === null) return DEFAULT_MAP;
  return typeof v === 'string' && isShippedMap(v) ? v : null;
}

/** A callsign is a label a player typed, shown in the lobby and the HUD; the
 *  route and the room clean it the same way as the client does, by the one
 *  function in `@lions/net` (`callsign.ts`). Absent, empty or nothing-but-
 *  control-characters is 'Lion'. */
export { MAX_CALLSIGN_CHARS } from '@lions/net';
export function callsignField(v: unknown): string {
  return callsignOrDefault(v);
}

export type SeatKind = SeatConfig['kind'];
/** A seat's kind (N4a): `bot` only when the body says exactly that; anything else is a human. */
export function seatKindField(v: unknown): SeatKind {
  return v === 'bot' ? 'bot' : 'human';
}

/** Decision D5: a paced round is 1 s to 1 min of ticks, and a bot is waited for 1 s to 10 min. */
export const ROUND_TICKS_RANGE = { min: 20, max: 1200 } as const;
export const ROUND_WALL_MS_RANGE = { min: 1000, max: 600_000 } as const;
const clamp = (v: number, r: { min: number; max: number }): number => Math.min(r.max, Math.max(r.min, Math.trunc(v)));
/** A room's pace (N4a, D5): `paced` with both numbers finite, clamped into
 *  the D5 ranges; anything else is realtime. Whether a paced room really
 *  paces is decided at start (`mintConfig`): only when a seat is a bot. */
export function paceField(v: unknown): Pace {
  if (typeof v !== 'object' || v === null) return { kind: 'realtime' };
  const p = v as Record<string, unknown>;
  if (p.kind !== 'paced' || typeof p.roundTicks !== 'number' || typeof p.roundWallMs !== 'number') return { kind: 'realtime' };
  if (!Number.isFinite(p.roundTicks) || !Number.isFinite(p.roundWallMs)) return { kind: 'realtime' };
  return { kind: 'paced', roundTicks: clamp(p.roundTicks, ROUND_TICKS_RANGE), roundWallMs: clamp(p.roundWallMs, ROUND_WALL_MS_RANGE) };
}
