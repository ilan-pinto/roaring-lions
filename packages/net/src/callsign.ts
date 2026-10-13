/**
 * What a callsign may be (N1b follow-up). A callsign is typed by a player,
 * shown to the other one in the lobby, on the HUD and in the chat feed, and
 * stored in the room. It is cleaned the SAME way on both sides of the wire --
 * the client before it sends (so the field shows what will be used) and the
 * Worker on receipt (it trusts nothing) -- by this one function, so the two
 * cannot disagree about what a name is.
 *
 *  - control characters (C0, DEL, C1, line and paragraph separators) become a
 *    space; format characters (bidi overrides and isolates, zero-width
 *    joiners and spaces, the BOM, soft hyphens) are dropped, because a
 *    right-to-left override reorders the text AFTER it and a zero-width space
 *    makes two different names look alike;
 *  - private-use and lone surrogate code points are dropped;
 *  - compatibility forms are normalised (NFKC), so a fullwidth or ligature
 *    spelling is the plain one;
 *  - runs of whitespace collapse to one space and the ends are trimmed;
 *  - the result is capped at `MAX_CALLSIGN_CHARS` CODE POINTS (not UTF-16
 *    units), so a cap never splits an astral character in half.
 *
 * Idempotent: cleaning a clean callsign returns it. It may return '' -- the
 * caller picks the fallback (`callsignOrDefault`: 'Lion').
 */
import { CHAT_MAX_CHARS } from './protocol';

export const MAX_CALLSIGN_CHARS = 24;
export const DEFAULT_CALLSIGN = 'Lion';

const TO_SPACE = /[\p{Cc}\u2028\u2029]/gu;
const DROP = /[\p{Cf}\p{Co}\p{Cs}]/gu;

function strip(s: string): string {
  return s.replace(TO_SPACE, ' ').replace(DROP, '');
}

export function cleanCallsign(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Stripped, normalised, stripped again: normalising can expose a control or
  // format character, and stripping first keeps a dropped character from
  // changing what composes with its neighbour (idempotence).
  const s = strip(strip(raw).normalize('NFKC')).replace(/\s+/gu, ' ').trim();
  return Array.from(s).slice(0, MAX_CALLSIGN_CHARS).join('').trim();
}

/** A cleaned callsign, or 'Lion' when nothing usable is left. */
export function callsignOrDefault(raw: unknown): string {
  return cleanCallsign(raw) || DEFAULT_CALLSIGN;
}

/**
 * A chat line, cleaned by the callsign's own rule (#559 L-3): control
 * characters become spaces, format characters (bidi overrides and isolates,
 * zero-width spaces and joiners), private-use and lone surrogates are dropped,
 * NFKC, whitespace collapsed and trimmed, then capped at `CHAT_MAX_CHARS`
 * UTF-16 units without splitting a character. A right-to-left override in
 * chat reorders what the OTHER player reads, so the room strips it as it does
 * for a name. '' means nothing is left to send.
 */
export function cleanChat(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = strip(strip(raw).normalize('NFKC')).replace(/\s+/gu, ' ').trim();
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > CHAT_MAX_CHARS) break;
    out += ch;
  }
  return out.trim();
}
