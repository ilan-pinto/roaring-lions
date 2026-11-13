/** Member helpers (GH-1075 A1): the switch, identity lookup, and member creation. */
import { emptyRoar } from '@lions/economy';
import type { D1Like, D1Stmt } from '../d1';
import { dayOf } from '../rate-day';
import { crockford, randomB64url, sha256Hex } from './crypto';
import { createSession } from './session';

/** True only for `flags.accounts` = 'open'. A missing row, or any other value, is CLOSED. */
export async function accountsOpen(db: D1Like): Promise<boolean> {
  const row = await db.prepare(`SELECT value FROM flags WHERE name = 'accounts'`).first<{ value: string }>();
  return row !== null && row.value === 'open';
}

/** The member behind an active identity, or null. A hit also stamps the identity's `last_used_day`. */
export async function memberForIdentity(db: D1Like, provider: string, subject: string, now: number = Date.now(), stamp = true): Promise<string | null> {
  const row = await db
    .prepare(`SELECT id, member_id FROM member_identity WHERE provider = ?1 AND subject = ?2 AND state = 'active'`)
    .bind(provider, subject)
    .first<{ id: string; member_id: string }>();
  if (row === null) return null;
  if (stamp) await db.prepare('UPDATE member_identity SET last_used_day = ?2 WHERE id = ?1').bind(row.id, dayOf(now)).run();
  return row.member_id;
}

const MAX_PUBLIC_ID_TRIES = 5;

/** A signed-in session for a member who already exists: its statements run in a batch of their own. */
export async function sessionFor(db: D1Like, memberId: string, now: number): Promise<string> {
  const s = await createSession(db, memberId, now);
  await db.batch(s.statements);
  return s.setCookie;
}

/**
 * Makes a member with its identity, profile, wallet and first session in ONE batch. On a lost race for the same
 * `(provider, subject)` the whole batch has rolled back, so the existing member gets a session of its own.
 * A `public_id` collision retries with a new id, up to 5 times.
 */
export async function createMember(
  db: D1Like,
  now: number,
  identity: { provider: 'steam' | 'google'; subject: string },
): Promise<{ memberId: string; publicId: string; setCookie: string }> {
  const earn = JSON.stringify(emptyRoar().earn);
  const entitlements = JSON.stringify(emptyRoar().entitlements);
  const day = dayOf(now);
  for (let attempt = 1; ; attempt++) {
    const memberId = randomB64url(16);
    const publicId = crockford(8);
    const session = await createSession(db, memberId, now);
    const statements: D1Stmt[] = [
      db.prepare('INSERT INTO member (id, public_id, id_hash, user_handle, created_at, last_seen_day) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
        .bind(memberId, publicId, await sha256Hex(publicId), randomB64url(16), now, day),
      db.prepare(`INSERT INTO member_identity (id, member_id, provider, subject, state, created_at, last_used_day) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6)`)
        .bind(randomB64url(16), memberId, identity.provider, identity.subject, now, day),
      db.prepare('INSERT INTO profile (member_id, display_name, show_record, updated_at) VALUES (?1, ?2, 0, ?3)').bind(memberId, publicId, now),
      db.prepare('INSERT INTO wallet (member_id, free, paid, earn, earn_lifetime, entitlements, revision, updated_at) VALUES (?1, 0, 0, ?2, ?2, ?3, 0, ?4)')
        .bind(memberId, earn, entitlements, now),
      ...session.statements,
    ];
    try {
      await db.batch(statements);
      return { memberId, publicId, setCookie: session.setCookie };
    } catch (err) {
      const existing = await memberForIdentity(db, identity.provider, identity.subject, now);
      if (existing !== null) return { memberId: existing, publicId: await publicIdOf(db, existing), setCookie: await sessionFor(db, existing, now) };
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_PUBLIC_ID_TRIES && /member\.(public_id|id_hash)/.test(msg)) continue;
      throw err;
    }
  }
}

async function publicIdOf(db: D1Like, memberId: string): Promise<string> {
  const row = await db.prepare('SELECT public_id FROM member WHERE id = ?1').bind(memberId).first<{ public_id: string }>();
  return row?.public_id ?? '';
}
