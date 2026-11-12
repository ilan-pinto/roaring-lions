/** A versus seat's member (GH-1075 A3 Task 3.3). The ONLY place a seat's identity is read, and it reads the session
 *  cookie and nothing else: no field of a create or join body ever becomes a member, a public id or a record. */
import type { D1Like, Env } from '../d1';
import { resolveSession } from './session';

export interface MemberRecord { won: number; lost: number; drawn: number }

export interface SeatMemberInfo {
  memberId: string;
  publicId: string;
  name: string;
  showRecord: boolean;
  record: MemberRecord;
}

/** W-L over every AGREED record the member sat in (ruling 1): the query never reads the other seat's row, so no
 *  opponent filter can creep in. A NULL winner is a draw. */
export async function memberRecord(db: D1Like, memberId: string): Promise<MemberRecord> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN r.winner_seat = s.seat THEN 1 ELSE 0 END), 0) AS won,
         COALESCE(SUM(CASE WHEN r.winner_seat IS NOT NULL AND r.winner_seat <> s.seat THEN 1 ELSE 0 END), 0) AS lost,
         COALESCE(SUM(CASE WHEN r.winner_seat IS NULL THEN 1 ELSE 0 END), 0) AS drawn
       FROM match_seat s JOIN match_record r ON r.code = s.code AND r.started_at = s.started_at
       WHERE s.member_id = ?1 AND r.agreed = 1`,
    )
    .bind(memberId)
    .first<MemberRecord>();
  return { won: row?.won ?? 0, lost: row?.lost ?? 0, drawn: row?.drawn ?? 0 };
}

/** The member behind the request's cookie, or null: accounts unbound, no cookie, or no live session. */
export async function seatMemberOf(req: Request, env: Env, now: number): Promise<{ member: SeatMemberInfo; setCookie: string | null } | null> {
  // A failing accounts database must never fail a room: the seat is a guest's, and the error is logged once.
  try {
    return await readSeatMember(req, env, now);
  } catch (e) {
    console.error('seatMemberOf: accounts database failed, seating a guest', e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function readSeatMember(req: Request, env: Env, now: number): Promise<{ member: SeatMemberInfo; setCookie: string | null } | null> {
  const db = env.ACCOUNTS;
  if (db === undefined) return null;
  const got = await resolveSession(req, db, now);
  if (got === null) return null;
  const id = got.session.memberId;
  const who = await db
    .prepare(
      `SELECT m.public_id AS public_id, p.display_name AS display_name, p.show_record AS show_record
       FROM member m LEFT JOIN profile p ON p.member_id = m.id WHERE m.id = ?1`,
    )
    .bind(id)
    .first<{ public_id: string; display_name: string | null; show_record: number | null }>();
  if (who === null) return null;
  const record = await memberRecord(db, id);
  return {
    member: { memberId: id, publicId: who.public_id, name: who.display_name ?? '', showRecord: who.show_record === 1, record },
    setCookie: got.setCookie,
  };
}

/** A shape check, never a lookup: the room trusts nothing it is sent. */
export function seatMemberShape(v: unknown): SeatMemberInfo | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const r = o.record;
  if (typeof o.memberId !== 'string' || typeof o.publicId !== 'string' || typeof o.name !== 'string' || typeof o.showRecord !== 'boolean') return null;
  if (typeof r !== 'object' || r === null) return null;
  const rr = r as Record<string, unknown>;
  if (typeof rr.won !== 'number' || typeof rr.lost !== 'number' || typeof rr.drawn !== 'number') return null;
  return { memberId: o.memberId, publicId: o.publicId, name: o.name, showRecord: o.showRecord, record: { won: rr.won, lost: rr.lost, drawn: rr.drawn } };
}
