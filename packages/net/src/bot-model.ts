/**
 * A bot seat's DECLARED model (GH-1075 A3, §0.16): a label, never identity. It does not make a seat a bot, a member
 * or a guest, and it moves no W-L. A listed id, or `other` plus a typed name that is cleaned by `cleanCallsign`
 * (control and format characters, NFKC, whitespace, the 24 code-point cap) on the client and again on the Worker.
 * Never part of `MatchConfig`: typed text must not reach the desync log, a replay or a feedback report.
 */
import { cleanCallsign } from './callsign';

/** Append-only: stored rows name these ids. Each id's label is the catalogue key `bot.model.<id>`. */
export const BOT_MODELS = ['scripted', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'] as const;
export const BOT_MODEL_OTHER = 'other';

export type BotModelId = (typeof BOT_MODELS)[number];
export type BotModel = { id: BotModelId } | { id: 'other'; name: string };

const isListed = (v: unknown): v is BotModelId => typeof v === 'string' && (BOT_MODELS as readonly string[]).includes(v);

/** Absent is an unlabelled bot (`model: null`); a listed id or `other` with a usable name is that model, built field
 *  by field (no other key survives); anything else is refused. */
export function botModelField(v: unknown): { ok: true; model: BotModel | null } | { ok: false } {
  if (v === undefined) return { ok: true, model: null };
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false };
  const o = v as Record<string, unknown>;
  if (o.id === BOT_MODEL_OTHER) {
    const name = cleanCallsign(o.name);
    return name === '' ? { ok: false } : { ok: true, model: { id: BOT_MODEL_OTHER, name } };
  }
  return isListed(o.id) ? { ok: true, model: { id: o.id } } : { ok: false };
}

/** `id:<listed id>` or `other:<cleaned name>`: a typed name equal to a listed id can never pass as the listed label. */
export function encodeBotModel(m: BotModel): string {
  return m.id === BOT_MODEL_OTHER ? `${BOT_MODEL_OTHER}:${m.name}` : `id:${m.id}`;
}

/** Null for NULL, an unknown prefix, an `id:` not in `BOT_MODELS`, or an `other:` whose name re-cleans differently. */
export function decodeBotModel(s: string | null): BotModel | null {
  if (s === null) return null;
  if (s.startsWith('id:')) {
    const id = s.slice(3);
    return isListed(id) ? { id } : null;
  }
  if (s.startsWith('other:')) {
    const name = s.slice('other:'.length);
    return name !== '' && cleanCallsign(name) === name ? { id: BOT_MODEL_OTHER, name } : null;
  }
  return null;
}
