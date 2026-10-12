/** What `/api/match` and the room's `/create` both read from a create body:
 *  one default map and one cap, so the route and the room cannot disagree. */
export const DEFAULT_MAP = 'beit_sahwan_outskirts';
/** `map` and `build` are ids, not prose; this bounds what a client can make the room store. */
export const MAX_FIELD_CHARS = 64;

/** A string field, capped; `fallback` when absent or not a string. */
export function textField(v: unknown, fallback: string): string {
  return (typeof v === 'string' ? v : fallback).slice(0, MAX_FIELD_CHARS);
}

/** A callsign is a label a player typed, shown in the lobby and the HUD; the
 *  room and the route both cap it the same way. Absent or empty is 'Lion'. */
export const MAX_CALLSIGN_CHARS = 24;
export function callsignField(v: unknown): string {
  return typeof v === 'string' && v !== '' ? v.slice(0, MAX_CALLSIGN_CHARS) : 'Lion';
}
