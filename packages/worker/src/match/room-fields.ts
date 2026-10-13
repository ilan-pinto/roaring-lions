import { callsignOrDefault } from '@lions/net';
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
