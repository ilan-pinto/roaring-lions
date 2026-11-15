/** GH-695 D14.2: the daily cron sweeps `view` rows older than 180 days and nothing else. */
import { describe, expect, it } from 'vitest';
import worker from '../index';
import { accountHarness } from '../account/test-kit';
import type { Env } from '../d1';
import { sweepAdminViews } from './view-sweep';

const DAY = 86_400_000;
const RETENTION = 180 * DAY; // a literal on purpose, not VIEW_RETENTION_MS
const NOW = 20_000 * DAY;

async function seed(h: ReturnType<typeof accountHarness>): Promise<void> {
  await h.db.prepare("INSERT INTO member (id, public_id, id_hash, user_handle, created_at, last_seen_day) VALUES ('m1','PUB1','h1','u1',1,?1)").bind(Math.floor(NOW / DAY)).run();
  const row = (at: number, action: string) =>
    h.db.prepare('INSERT INTO admin_action (at, admin_id, member_id, action, reason) VALUES (?1, NULL, ?2, ?3, ?4)').bind(at, action === 'switch' ? null : 'm1', action, 'v' + at).run();
  await row(NOW - RETENTION - 1, 'view');     // swept
  await row(NOW - RETENTION, 'view');         // exactly 180 days: kept
  await row(NOW - DAY, 'view');               // kept
  await row(NOW - 400 * DAY, 'coins');        // old change row: kept
  await row(NOW - 400 * DAY, 'credits');      // kept
  await row(NOW - 400 * DAY, 'switch');       // kept
}
const left = async (h: ReturnType<typeof accountHarness>): Promise<string[]> =>
  (await h.db.prepare("SELECT action || ':' || CAST(?1 - at AS INTEGER) AS x FROM admin_action ORDER BY id").bind(NOW).all<{ x: string }>()).results.map((r) => r.x);

describe('sweepAdminViews', () => {
  it('deletes a view older than 180 days, keeps one at exactly 180 days or younger, and never touches a change row', async () => {
    const h = accountHarness({ now: NOW });
    await seed(h);
    await sweepAdminViews(h.db, NOW);
    expect(await left(h)).toEqual([`view:${RETENTION}`, `view:${DAY}`, `coins:${400 * DAY}`, `credits:${400 * DAY}`, `switch:${400 * DAY}`]);
    await sweepAdminViews(h.db, NOW); // idempotent
    expect((await left(h)).length).toBe(5);
  });

  it("runs on the Worker's daily cron, with ACCOUNTS bound", async () => {
    const h = accountHarness({ now: NOW });
    await seed(h);
    const realNow = Date.now;
    Date.now = () => NOW;
    try {
      await worker.scheduled(null, h.env as unknown as Env);
    } finally {
      Date.now = realNow;
    }
    expect((await left(h)).filter((x) => x.startsWith('view:'))).toEqual([`view:${RETENTION}`, `view:${DAY}`]);
  });
});
