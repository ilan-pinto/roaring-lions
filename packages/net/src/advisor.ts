/**
 * The advisor side channel (N4a task 5, spec §11b): a seat may invite one AI
 * advisor whose socket relays text, tile pings and proposed commands to its
 * OWN seat and back, and to nobody else. Nothing here is battle state: a
 * message is text, a tile, or a `Command` that has been through the room's
 * own `cleanCommand`. The room relays it and stores nothing.
 *
 * `cleanAdvisorMsg` is the only way bytes become an `AdvisorMsg`, and it
 * reuses the existing sanitisers (`cleanCommand`, `cleanChat`) rather than a
 * second one, so every cap the room already holds holds here too.
 */
import type { Command } from '@lions/sim';
import { cleanChat } from './callsign';
import { cleanCommand } from './protocol';

/** `advise`: text and pings only. `assist`: it may also propose commands, which the human accepts or vetoes. */
export type AdvisorScope = 'advise' | 'assist';
export const ADVISOR_SCOPES = ['advise', 'assist'] as const satisfies readonly AdvisorScope[];
/** A proposal's note, in UTF-16 code units (never splitting a character). */
export const ADVISOR_NOTE_MAX = 120;
/** A ping is a tile; no shipped map is wider than this. */
const PING_MAX = 255;

export type AdvisorMsg =
  | { kind: 'text'; text: string }
  | { kind: 'ping'; x: number; y: number }
  | { kind: 'proposal'; id: number; cmd: Command; note: string }
  | { kind: 'accept'; id: number }
  | { kind: 'veto'; id: number };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isTile = (v: unknown): v is number => isInt(v) && v >= 0 && v <= PING_MAX;

/** `cleanChat`'s rule, cut at `ADVISOR_NOTE_MAX` without splitting a character. */
function cleanNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let out = '';
  for (const ch of cleanChat(raw)) {
    if (out.length + ch.length > ADVISOR_NOTE_MAX) break;
    out += ch;
  }
  return out.trim();
}

/** An advisor message REBUILT from the fields its kind declares, or null. */
export function cleanAdvisorMsg(v: unknown): AdvisorMsg | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const m = v as Record<string, unknown>;
  switch (m.kind) {
    case 'text': {
      const text = cleanChat(m.text);
      return text === '' ? null : { kind: 'text', text };
    }
    case 'ping':
      return isTile(m.x) && isTile(m.y) ? { kind: 'ping', x: m.x, y: m.y } : null;
    case 'proposal': {
      if (!isInt(m.id)) return null;
      const cmd = cleanCommand(m.cmd);
      const note = cleanNote(m.note);
      return cmd === null || note === null ? null : { kind: 'proposal', id: m.id, cmd, note };
    }
    case 'accept': return isInt(m.id) ? { kind: 'accept', id: m.id } : null;
    case 'veto': return isInt(m.id) ? { kind: 'veto', id: m.id } : null;
    default: return null;
  }
}

/** Who may send what: proposals only from an `assist` advisor; accept/veto only from the human; text and ping both ways. */
export function advisorMayRelay(from: 'human' | 'advisor', scope: AdvisorScope, a: AdvisorMsg): boolean {
  switch (a.kind) {
    case 'text':
    case 'ping':
      return true;
    case 'proposal':
      return from === 'advisor' && scope === 'assist';
    case 'accept':
    case 'veto':
      return from === 'human';
  }
}
