/**
 * Whether this seat should run a `SnapshotProducer` (snapshot S4 final review N2).
 *
 * The room stores a snapshot only once BOTH seats have uploaded matching bytes for the same tick. A bot seat
 * never produces (the lead's ruling), so in a human-versus-bot room the human's upload is answered 202 `held`
 * at every cadence for the whole match: about one 30-60 KiB POST a minute, each counted against the per-IP
 * snapshot rate limit, for a snapshot that can never be stored. The config the room hands every client already
 * names each seat's `kind`, so no protocol change is needed to know.
 *
 * Pure, so the rule is tested without a browser.
 */
import { snapshotEvery, type MatchConfig } from '@lions/net';

/** True only for a versus room with a snapshot cadence whose two seats are both humans. Sandbox is never
 *  produced for (it has no restorable world), and a cadence of 0 is off. */
export function seatShouldProduceSnapshots(config: Pick<MatchConfig, 'mode' | 'seats' | 'snapshotEveryTicks'>): boolean {
  return config.mode === 'versus' && snapshotEvery(config) > 0 && config.seats.every((s) => s.kind === 'human');
}
