/** The daily account cron (GH-1075 A1): expiries, 36-month idle deletion, and tombstone reconciliation. */
import type { D1Like } from '../d1';
import { RATE_DAY_PURGE_SQL, dayOf } from '../rate-day';
import { OP_TTL_MS, PENDING_TTL_MS, TOMB_TTL_S } from './config';
import { deleteMemberCounted, dropCancelled } from './delete';
import type { KVLike } from './kv';

/** A member with no sign-in for this many days is deleted (spec A4-4: "36 months"). */
export const MEMBER_IDLE_DAYS = 1095;
/** Members deleted per run at most, and (GH-1432) D1 queries the member loop may spend: one invocation on the Free plan may make 50 in all,
 *  and `scheduled()` shares them out (the sum is pinned by `cron-budget.test.ts`). A member costs 1 query when the batch
 *  deletes it, 2 when a guard held it back, 3 when the cancelled tombstone is then looked up; the next member starts only if the worst case
 *  (`MEMBER_WORST_QUERIES`) still fits. The members left over wait a day, oldest `last_seen_day` first: nothing is dropped, only deferred. */
export const SWEEP_MEMBERS_PER_RUN = 20;
export const SWEEP_MEMBER_QUERIES = 10;
const MEMBER_WORST_QUERIES = 3;

/** Fixed part of a sweep: ONE batch for the five expiry deletes, ONE select for the idle members. */
export async function sweepAccounts(db: D1Like, now: number, kv: KVLike): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM session WHERE expires_at <= ?1 OR absolute_at <= ?1').bind(now),
    db.prepare('DELETE FROM auth_challenge WHERE expires_at <= ?1').bind(now),
    db.prepare("DELETE FROM member_identity WHERE state = 'pending' AND created_at < ?1").bind(now - PENDING_TTL_MS),
    db.prepare('DELETE FROM account_op WHERE at < ?1').bind(now - OP_TTL_MS),
    db.prepare(RATE_DAY_PURGE_SQL).bind(dayOf(now) - 1),
  ]);
  const cutoff = dayOf(now) - MEMBER_IDLE_DAYS - 1;
  const idle = await db
    .prepare('SELECT id, id_hash FROM member WHERE last_seen_day <= ?1 ORDER BY last_seen_day LIMIT ?2')
    .bind(cutoff, SWEEP_MEMBERS_PER_RUN)
    .all<{ id: string; id_hash: string }>();
  let failure: unknown;
  let spent = 0;
  for (const m of idle.results) {
    if (spent + MEMBER_WORST_QUERIES > SWEEP_MEMBER_QUERIES) break;
    try {
      // Tombstone first (a restore re-applies it); the guard re-checks eligibility inside the batch, so a later sign-in wins.
      await kv.put('tomb:' + m.id_hash, JSON.stringify({ deletedAt: now, lastSeenDay: cutoff }), { expirationTtl: TOMB_TTL_S });
      const r = await deleteMemberCounted(db, m.id, { lastSeenAtMost: cutoff });
      spent += r.queries;
      if (!r.gone) {
        spent++; // dropCancelled's lookup
        await dropCancelled(db, kv, m.id_hash, cutoff);
      }
    } catch (err) {
      // One member's failure must not keep the next one's deletion; the tombstone (if written) is reconciled tomorrow.
      // A failed member is charged the worst case, so a run of failures cannot spend more than the budget either.
      spent += MEMBER_WORST_QUERIES;
      failure ??= err;
    }
  }
  if (failure !== undefined) throw failure;
}

/** Most tombstones acted on (deleted or pruned) per run, and (GH-1432) most D1 queries spent: a run stays inside the Free plan's 50 per
 *  invocation, shared out as `cron-budget.test.ts` pins. A listing page is KV and holds `IN_CHUNK` keys, so it costs ONE D1 query
 *  (D1 allows 100 bound variables a statement); a found member costs 1 (deleted) or 2 (a guard held). Most tombstones are DEAD ones,
 *  kept for `gone` after their member is deleted, so a page can find nothing: the scan is therefore RESUMABLE. The cursor of the next page is
 *  stored in KV under `RECONCILE_CURSOR_KEY` (not under `tomb:`), the next run continues from it, and a finished listing starts over. */
export const RECONCILE_PER_RUN = 40;
export const RECONCILE_D1_QUERIES = 12;
export const RECONCILE_CURSOR_KEY = 'reconcile:cursor';
const RECONCILE_CURSOR_TTL_S = 7 * 86_400;
const IN_CHUNK = 90;
const FOUND_WORST_QUERIES = 2;

/** Finishes every deletion a tombstone records, and prunes a tombstone whose deletion a later sign-in cancelled.
 *  Only a key whose member still exists is read. Returns how many members it deleted. A failure on one key does not stop the others
 *  and is rethrown at the end. When the budget ends a page midway, the saved cursor stays on that page, so its remaining keys are read
 *  again next run: nothing is skipped, and the members already handled are gone from it. */
export async function reconcileTombstones(db: D1Like, kv: KVLike): Promise<number> {
  let done = 0;
  let acted = 0;
  let spent = 0;
  let failure: unknown;
  const saved = await kv.get(RECONCILE_CURSOR_KEY);
  let cursor: string | undefined = saved ?? undefined;
  let finished = false;
  while (acted < RECONCILE_PER_RUN && spent + 1 + FOUND_WORST_QUERIES <= RECONCILE_D1_QUERIES) {
    const page = await kv.list({ prefix: 'tomb:', cursor, limit: IN_CHUNK });
    const hashes = page.keys.map((k) => k.name.slice('tomb:'.length));
    let complete = true;
    if (hashes.length > 0) {
      spent++;
      const found = await db
        .prepare(`SELECT id, id_hash, last_seen_day FROM member WHERE id_hash IN (${hashes.map((_, j) => `?${j + 1}`).join(',')})`)
        .bind(...hashes)
        .all<{ id: string; id_hash: string; last_seen_day: number }>();
      for (const m of found.results) {
        if (acted >= RECONCILE_PER_RUN || spent + FOUND_WORST_QUERIES > RECONCILE_D1_QUERIES) {
          complete = false;
          break;
        }
        acted++;
        try {
          const raw = await kv.get('tomb:' + m.id_hash);
          if (raw === null) continue;
          const day = (JSON.parse(raw) as { lastSeenDay?: unknown }).lastSeenDay;
          if (typeof day !== 'number') continue;
          if (m.last_seen_day > day) await kv.delete('tomb:' + m.id_hash);
          else {
            const r = await deleteMemberCounted(db, m.id, { lastSeenAtMost: day });
            spent += r.queries;
            if (r.gone) done++;
          }
        } catch (err) {
          spent += FOUND_WORST_QUERIES;
          failure ??= err;
        }
      }
    }
    if (!complete) break; // the cursor stays on this page
    if (page.list_complete || page.cursor === undefined) {
      finished = true;
      break;
    }
    cursor = page.cursor;
  }
  try {
    if (finished) await kv.delete(RECONCILE_CURSOR_KEY);
    else if (cursor !== saved && cursor !== undefined) await kv.put(RECONCILE_CURSOR_KEY, cursor, { expirationTtl: RECONCILE_CURSOR_TTL_S });
  } catch (err) {
    failure ??= err; // a lost cursor only restarts the scan from the top tomorrow
  }
  if (failure !== undefined) throw failure;
  return done;
}
