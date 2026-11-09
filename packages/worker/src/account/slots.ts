/** Save slots (GH-1075 A2): the counts the caps read, the metadata `GET state` answers, and `GET slots/:id`. */
import { canonicalSlot, parseSlot, type SaveSlot, type SlotMetaView } from '@lions/economy';
import type { D1Like, D1Stmt } from '../d1';
import { budgetedOp } from './budget';
import { capGuard } from './coin';
import { digestOf } from './campaign';
import { CAMPAIGN_BODY_MAX, CAMPAIGN_MAX_BYTES, PLAYER_SLOTS, SLOT_NAME_MAX, SYSTEM_SLOTS } from './config';
import { accountJson, readAccountBody } from './http';
import { OpReject, validOpId } from './op';
import type { AccountCtx } from './routes';
import { requireSession, sessionJson } from './session';

/** `player` slots, and the `claim` and `conflict` ones together (the system slots, apart from them). */
export async function slotCounts(db: D1Like, memberId: string): Promise<{ player: number; system: number }> {
  const r = await db
    .prepare(
      `SELECT COALESCE(SUM(origin = 'player'), 0) AS player, COALESCE(SUM(origin <> 'player'), 0) AS system
       FROM save_slot WHERE member_id = ?1`,
    )
    .bind(memberId)
    .first<{ player: number; system: number }>();
  return { player: r?.player ?? 0, system: r?.system ?? 0 };
}

interface SlotMetaRow {
  slot_id: string;
  name: string;
  saved_at: number;
  build: string;
  origin: SlotMetaView['origin'];
  bytes: number;
}

const toMeta = (r: SlotMetaRow): SlotMetaView => ({ id: r.slot_id, name: r.name, savedAt: r.saved_at, build: r.build, origin: r.origin, bytes: r.bytes });

/** Every slot's metadata: `savedAt` and `bytes` are the change token (§0.44). Never a body, never a digest. */
export async function slotMetas(db: D1Like, memberId: string): Promise<SlotMetaView[]> {
  const rows = await db
    .prepare('SELECT slot_id, name, saved_at, build, origin, bytes FROM save_slot WHERE member_id = ?1 ORDER BY saved_at DESC, slot_id')
    .bind(memberId)
    .all<SlotMetaRow>();
  return rows.results.map(toMeta);
}

export async function getSlot(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const r = await db
    .prepare('SELECT slot_id, name, saved_at, build, origin, bytes, body FROM save_slot WHERE member_id = ?1 AND slot_id = ?2')
    .bind(session.memberId, ctx.params.id ?? '')
    .first<SlotMetaRow & { body: string }>();
  if (r === null) return sessionJson(404, { error: 'not_found' }, setCookie);
  return sessionJson(200, { slot: toMeta(r), body: JSON.parse(r.body) as SaveSlot }, setCookie);
}

const utf8 = new TextEncoder();
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A control, format or surrogate code point has no business in a name. */
const BAD_NAME_CHAR = /[\p{Cc}\p{Cf}\p{Cs}]/u;

/** A slot name: 1 to `SLOT_NAME_MAX` code points, no control or format character. */
export const validSlotName = (v: unknown): v is string => {
  if (typeof v !== 'string' || BAD_NAME_CHAR.test(v)) return false;
  const n = [...v].length;
  return n >= 1 && n <= SLOT_NAME_MAX;
};

/**
 * `PUT slots/:id`. The stored body is the client's slot with the route's `id` and `name` (its own `savedAt` and `build` stay, R18); the
 * digest answered is `digestOf(canonicalSlot(...))` of exactly that, so a client holding a conflict upload clears it
 * when its own canonical digest matches (§0.43). The row's `saved_at` is the server's write time, never the client's,
 * and always moves on a replace (§0.44), so `savedAt` + `bytes` is a change token. The batch ends with the cap guard
 * for the slot's class (§0.36): a new slot past 12 player / 4 system slots answers 409 `cap`; a replace never counts.
 */
export async function putSlot(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const raw = await readAccountBody<unknown>(ctx.req, CAMPAIGN_BODY_MAX);
  if (raw === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  if (!isRec(raw) || !validOpId(raw.op_id)) return sessionJson(400, { error: 'op_id' }, setCookie);
  if (!validSlotName(raw.name)) return sessionJson(400, { error: 'name' }, setCookie);
  const origin = raw.origin === undefined ? 'player' : raw.origin;
  if ((origin !== 'player' && origin !== 'conflict') || typeof raw.savedAt !== 'number' || !Number.isFinite(raw.savedAt) || typeof raw.build !== 'string' || !isRec(raw.body)) {
    return sessionJson(400, { error: 'invalid' }, setCookie);
  }
  const id = ctx.params.id ?? '';
  let slot: SaveSlot;
  try {
    slot = { ...parseSlot(JSON.stringify(raw.body)), id, name: raw.name };
  } catch {
    return sessionJson(400, { error: 'invalid' }, setCookie);
  }
  // R18: the body's own `savedAt` and `build` are stored (the digest covers them), so a top-level pair that differs is a lie.
  if (raw.savedAt !== slot.savedAt || raw.build !== slot.build) return sessionJson(400, { error: 'invalid' }, setCookie);
  const text = JSON.stringify(slot);
  const bytes = utf8.encode(text).length;
  if (bytes > CAMPAIGN_MAX_BYTES) return sessionJson(413, { error: 'too_large' }, setCookie);
  const digest = await digestOf(canonicalSlot(slot));
  const memberId = session.memberId;
  const name = raw.name;
  const build = slot.build;

  const out = await budgetedOp(ctx, { memberId, opId: raw.op_id, kind: 'slot.put' }, async () => {
    const was = await db
      .prepare('SELECT saved_at, origin FROM save_slot WHERE member_id = ?1 AND slot_id = ?2')
      .bind(memberId, id)
      .first<{ saved_at: number; origin: string }>();
    // R18: a replace never changes a slot's origin (a claim or conflict id is not a player slot, nor the reverse).
    if (was !== null && was.origin !== origin) throw new OpReject(400, { error: 'invalid' });
    if (was === null) {
      const counts = await slotCounts(db, memberId);
      if (origin === 'player' ? counts.player >= PLAYER_SLOTS : counts.system >= SYSTEM_SLOTS) {
        return { statements: [], status: 409, response: { error: 'cap' } };
      }
    }
    // The server's write time, and strictly newer than the row it replaces: the SQL is the authority (two replaces
    // that read the same row cannot pick the same value); this copy is what the answer reports.
    const savedAt = was === null ? ctx.now : Math.max(ctx.now, was.saved_at + 1);
    const statements: D1Stmt[] = [
      db
        .prepare(
          `INSERT INTO save_slot (member_id, slot_id, name, saved_at, build, origin, body, bytes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT (member_id, slot_id) DO UPDATE SET name = ?3, saved_at = MAX(?4, save_slot.saved_at + 1), build = ?5, origin = ?6, body = ?7, bytes = ?8`,
        )
        .bind(memberId, id, name, savedAt, build, origin, text, bytes),
      origin === 'player'
        ? capGuard(db, memberId, "SELECT COUNT(*) FROM save_slot WHERE member_id = ?1 AND origin = 'player'", PLAYER_SLOTS)
        : capGuard(db, memberId, "SELECT COUNT(*) FROM save_slot WHERE member_id = ?1 AND origin <> 'player'", SYSTEM_SLOTS),
    ];
    const meta: SlotMetaView = { id, name, savedAt, build, origin, bytes, digest };
    return { statements, status: 200, response: { slot: meta } };
  });
  return sessionJson(out.status, out.body, setCookie);
}

export async function deleteSlot(ctx: AccountCtx): Promise<Response> {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  const db = ctx.env.ACCOUNTS;
  if (db === undefined) return accountJson(503, { error: 'accounts are not configured' });
  const { session, setCookie } = got;
  const raw = await readAccountBody<unknown>(ctx.req);
  if (raw === 'too_large') return sessionJson(413, { error: 'too_large' }, setCookie);
  if (!isRec(raw) || !validOpId(raw.op_id)) return sessionJson(400, { error: 'op_id' }, setCookie);
  const id = ctx.params.id ?? '';
  const memberId = session.memberId;
  const out = await budgetedOp(ctx, { memberId, opId: raw.op_id, kind: 'slot.delete' }, async () => {
    const was = await db.prepare('SELECT 1 AS x FROM save_slot WHERE member_id = ?1 AND slot_id = ?2').bind(memberId, id).first<{ x: number }>();
    if (was === null) throw new OpReject(404, { error: 'not_found' });
    return {
      statements: [db.prepare('DELETE FROM save_slot WHERE member_id = ?1 AND slot_id = ?2').bind(memberId, id)],
      status: 200,
      response: { ok: true },
    };
  });
  return sessionJson(out.status, out.body, setCookie);
}
