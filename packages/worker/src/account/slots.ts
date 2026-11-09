/** Save slots (GH-1075 A2): the counts the caps read, the metadata `GET state` answers, and `GET slots/:id`. */
import type { SaveSlot, SlotMetaView } from '@lions/economy';
import type { D1Like } from '../d1';
import { accountJson } from './http';
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
