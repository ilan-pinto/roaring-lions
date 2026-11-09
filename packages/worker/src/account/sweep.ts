/** The daily account cron (GH-1075 A1): expiries, 36-month idle deletion, and tombstone reconciliation. */
import type { D1Like } from '../d1';
import { dayOf, purgeRateDays } from '../rate-day';
import { OP_TTL_MS, PENDING_TTL_MS, TOMB_TTL_S } from './config';
import { deleteMember, dropCancelled } from './delete';
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
      if (!(await deleteMember(db, m.id, { lastSeenAtMost: cutoff }))) await dropCancelled(db, kv, m.id_hash, cutoff);
    } catch (err) {
      // One member's failure must not keep the next one's deletion; the tombstone (if written) is reconciled tomorrow.
      failure ??= err;
    }
  }
  if (failure !== undefined) throw failure;
}

/** Most tombstones acted on (deleted or pruned) per run, and most listing pages read: a run stays inside the subrequest budget. */
export const RECONCILE_PER_RUN = 40;
export const RECONCILE_MAX_PAGES = 10;
const IN_CHUNK = 50;

/** Finishes every deletion a tombstone records, and prunes a tombstone whose deletion a later sign-in cancelled.
 *  A listing page costs one D1 query per chunk of keys; only a key whose member still exists is read. Returns how many
 *  members it deleted. A failure on one key does not stop the others and is rethrown at the end. */
export async function reconcileTombstones(db: D1Like, kv: KVLike): Promise<number> {
  let done = 0;
  let acted = 0;
  let failure: unknown;
  let cursor: string | undefined;
  for (let pages = 0; pages < RECONCILE_MAX_PAGES && acted < RECONCILE_PER_RUN; pages++) {
    const page = await kv.list({ prefix: 'tomb:', cursor });
    const hashes = page.keys.map((k) => k.name.slice('tomb:'.length));
    for (let i = 0; i < hashes.length && acted < RECONCILE_PER_RUN; i += IN_CHUNK) {
      const chunk = hashes.slice(i, i + IN_CHUNK);
      const found = await db
        .prepare(`SELECT id, id_hash, last_seen_day FROM member WHERE id_hash IN (${chunk.map((_, j) => `?${j + 1}`).join(',')})`)
        .bind(...chunk)
        .all<{ id: string; id_hash: string; last_seen_day: number }>();
      for (const m of found.results) {
        if (acted >= RECONCILE_PER_RUN) break;
        acted++;
        try {
          const raw = await kv.get('tomb:' + m.id_hash);
          if (raw === null) continue;
          const day = (JSON.parse(raw) as { lastSeenDay?: unknown }).lastSeenDay;
          if (typeof day !== 'number') continue;
          if (m.last_seen_day > day) await kv.delete('tomb:' + m.id_hash);
          else if (await deleteMember(db, m.id, { lastSeenAtMost: day })) done++;
        } catch (err) {
          failure ??= err;
        }
      }
    }
    if (page.list_complete || page.cursor === undefined) break;
    cursor = page.cursor;
  }
  if (failure !== undefined) throw failure;
  return done;
}
