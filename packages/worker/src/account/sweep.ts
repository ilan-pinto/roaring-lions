/** The daily account cron (GH-1075 A1): expiries, 36-month idle deletion, and tombstone reconciliation. */
import type { D1Like } from '../d1';
import { dayOf, purgeRateDays } from '../rate-day';
import { OP_TTL_MS, PENDING_TTL_MS, TOMB_TTL_S } from './config';
import { deleteMember } from './delete';
import type { KVLike } from './kv';

/** A member with no sign-in for this many days is deleted (spec A4-4: "36 months"). */
export const MEMBER_IDLE_DAYS = 1095;
/** Members deleted per run, so one invocation stays inside the Worker's subrequest budget; the rest wait a day. */
export const SWEEP_MEMBERS_PER_RUN = 20;

export async function sweepAccounts(db: D1Like, now: number, kv: KVLike): Promise<void> {
  await db.prepare('DELETE FROM session WHERE expires_at <= ?1 OR absolute_at <= ?1').bind(now).run();
  await db.prepare('DELETE FROM auth_challenge WHERE expires_at <= ?1').bind(now).run();
  await db.prepare("DELETE FROM member_identity WHERE state = 'pending' AND created_at < ?1").bind(now - PENDING_TTL_MS).run();
  await db.prepare('DELETE FROM account_op WHERE at < ?1').bind(now - OP_TTL_MS).run();
  await purgeRateDays(db, now);
  const cutoff = dayOf(now) - MEMBER_IDLE_DAYS - 1;
  const idle = await db
    .prepare('SELECT id, id_hash FROM member WHERE last_seen_day <= ?1 ORDER BY last_seen_day LIMIT ?2')
    .bind(cutoff, SWEEP_MEMBERS_PER_RUN)
    .all<{ id: string; id_hash: string }>();
  let failure: unknown;
  for (const m of idle.results) {
    try {
      // Tombstone first (a restore re-applies it); the guard re-checks eligibility inside the batch, so a later sign-in wins.
      await kv.put('tomb:' + m.id_hash, JSON.stringify({ deletedAt: now, lastSeenDay: cutoff }), { expirationTtl: TOMB_TTL_S });
      await deleteMember(db, m.id, { lastSeenAtMost: cutoff });
    } catch (err) {
      // One member's failure must not keep the next one's deletion; the tombstone (if written) is reconciled tomorrow.
      failure ??= err;
    }
  }
  if (failure !== undefined) throw failure;
}

/** Finishes every deletion a tombstone records. Returns how many members it deleted. */
export async function reconcileTombstones(db: D1Like, kv: KVLike): Promise<number> {
  let done = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await kv.list({ prefix: 'tomb:', cursor });
    for (const { name } of page.keys) {
      const raw = await kv.get(name);
      if (raw === null) continue;
      let day: unknown;
      try {
        day = (JSON.parse(raw) as { lastSeenDay?: unknown }).lastSeenDay;
      } catch {
        continue;
      }
      if (typeof day !== 'number') continue;
      const m = await db.prepare('SELECT id FROM member WHERE id_hash = ?1').bind(name.slice('tomb:'.length)).first<{ id: string }>();
      if (m === null) continue;
      if (await deleteMember(db, m.id, { lastSeenAtMost: day })) done++;
    }
    if (page.list_complete || page.cursor === undefined) return done;
    cursor = page.cursor;
  }
}
