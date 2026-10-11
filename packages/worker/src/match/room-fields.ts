/** What `/api/match` and the room's `/create` both read from a create body:
 *  one default map and one cap, so the route and the room cannot disagree. */
export const DEFAULT_MAP = 'beit_sahwan_outskirts';
/** `map` and `build` are ids, not prose; this bounds what a client can make the room store. */
export const MAX_FIELD_CHARS = 64;

/** A string field, capped; `fallback` when absent or not a string. */
export function textField(v: unknown, fallback: string): string {
  return (typeof v === 'string' ? v : fallback).slice(0, MAX_FIELD_CHARS);
}
