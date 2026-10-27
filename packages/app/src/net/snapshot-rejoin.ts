/**
 * The post-hello half of a snapshot rejoin (snapshot spec §3.3, S4 task 7).
 *
 * `snapshot-link.ts` checks everything that needs no config before the `hello`
 * (SHA, header, build, content digest, match id). The room's config arrives with
 * the `log`, so the checks that need it -- the mode, the cadence, the snapshot
 * tick, the match id, the restore itself and the digest after it -- are made
 * here, and a failure of any of them is a full replay: a FRESH world and
 * `transport.restartFromZero()`, never a half-restored one (G-2).
 *
 * Invariant 4: snapshot bytes reach the sim only through `restoreSim`, onto a
 * world `buildMatchWorld` made for the purpose, before its first tick. Nothing
 * here writes a column.
 *
 * No DOM, so the AI harness and the tests run the code the browser runs. Nothing
 * here throws on a bad snapshot: every failure is a `PostReason`. The one throw
 * that remains is `settleRejoin` building its FRESH world (`build` throws for a
 * map that is not shipped), which a fresh boot has too; it happens before
 * `restartFromZero`, so the transport is left untouched.
 */
import { isSnapshotTick, matchDigest, readSnapshotHeader, readSnapshotMeta, snapshotEvery, type MatchConfig } from '@lions/net';
import { restoreSim, SnapshotRefused } from '@lions/sim';
import { shippedContentDigest } from './content-digest';
import { buildMatchWorld, type MatchWorld } from './match-world';
import type { FallbackReason, Prepared, PostReason, Verified } from './snapshot-link';

export interface RestoreDeps {
  /** Default `buildMatchWorld`. */
  build?: (config: MatchConfig) => MatchWorld;
  /** Default `restoreSim`. */
  restore?: typeof restoreSim;
  /** Milliseconds; default `performance.now()`. */
  now?: () => number;
}

export type RestoreResult = { ok: true; world: MatchWorld; restoreMs: number } | { ok: false; reason: PostReason };

/**
 * Contract step 8: the checks that need the config, then the restore, then the digest. Never throws.
 * `restoreMs` is the restore and the digest after it; the world build is outside it.
 *
 * Before anything is built, the bytes are checked against what the pre-hello step handed over (`verified`)
 * and the room's own build: a caller that mixes two snapshots up is refused before `restoreSim` has written a
 * column. Those checks, and a header that will not read, are `refused`.
 */
export function restoreForRejoin(config: MatchConfig, verified: Verified, deps: RestoreDeps = {}): RestoreResult {
  const build = deps.build ?? buildMatchWorld;
  const restore = deps.restore ?? restoreSim;
  const now = deps.now ?? (() => performance.now());
  if (config.mode !== 'versus') return { ok: false, reason: 'not_versus' };
  const every = snapshotEvery(config);
  if (every <= 0) return { ok: false, reason: 'cadence_off' };
  if (!isSnapshotTick(verified.frameTick, every)) return { ok: false, reason: 'not_snapshot_tick' };
  const meta = readSnapshotMeta(verified.raw);
  const header = readSnapshotHeader(verified.raw);
  if (meta === null || header === null) return { ok: false, reason: 'refused' };
  if (meta.matchId !== config.matchId) return { ok: false, reason: 'config_match_mismatch' };
  // The bytes are the ones that were verified, and written by the build the room runs.
  if (header.frameTick !== verified.frameTick || header.matchDigest !== verified.matchDigest || meta.build !== config.build) {
    return { ok: false, reason: 'refused' };
  }
  let world: MatchWorld;
  try {
    world = build(config);
  } catch {
    return { ok: false, reason: 'build_failed' };
  }
  // After the build: `restoreMs` is the restore and the digest, not the world build.
  const t0 = now();
  try {
    restore(world.sim, verified.raw, world.runtime ?? undefined);
  } catch (e) {
    // The target may be half-written: the caller builds another (restoreSim's contract).
    return { ok: false, reason: e instanceof SnapshotRefused ? 'refused' : 'restore_threw' };
  }
  let digest: number;
  try {
    // The same number the frame loop reports at a hash tick (`runFrames`), compared as the u32 the header holds.
    digest = matchDigest(world.sim.hash(), world.runtime?.digest() ?? 0, shippedContentDigest()) >>> 0;
  } catch {
    // The bytes came from a seat's upload: a restore that passed validation can still leave a world that will not hash.
    return { ok: false, reason: 'restore_threw' };
  }
  if (digest !== verified.matchDigest) return { ok: false, reason: 'digest_after_restore' };
  return { ok: true, world, restoreMs: now() - t0 };
}

/** What `__lions.net().rejoin` reports (plan Ruling 14). */
export type RejoinOutcome =
  | { path: 'snapshot'; from: number; restoreMs: number }
  | { path: 'full'; reason: FallbackReason };

export interface Settled {
  /** The world the battlefield boots on: restored, or fresh at tick 0; null for a config that is not versus. */
  world: MatchWorld | null;
  /** Null when this tab did not reload (`prepared` absent): there was no rejoin to report. */
  rejoin: RejoinOutcome | null;
}

/**
 * What the battlefield boots on after the `hello`. `prepared` is `Connected.rejoin`, the pre-hello result.
 * A snapshot that restores is the restored world. One that does not gives a FRESH world (the touched one is
 * dropped, never returned) and restarts the transport from zero, so the room sends the whole log. A pre-hello
 * fallback already sent a `hello` with no `from`, so only the world is built.
 *
 * Call this after the `log` handler has returned (`restartFromZero` must not run inside `onStart`).
 */
export function settleRejoin(
  config: MatchConfig,
  prepared: Prepared | undefined,
  transport: { restartFromZero(): void },
  deps: RestoreDeps = {},
): Settled {
  const build = deps.build ?? buildMatchWorld;
  const fresh = (): MatchWorld | null => (config.mode === 'versus' ? build(config) : null);
  if (prepared === undefined) return { world: fresh(), rejoin: null };
  if (prepared.path === 'full') return { world: fresh(), rejoin: { path: 'full', reason: prepared.reason } };
  const r = restoreForRejoin(config, prepared.verified, deps);
  if (r.ok) return { world: r.world, rejoin: { path: 'snapshot', from: prepared.verified.frameTick + 1, restoreMs: r.restoreMs } };
  const world = fresh();
  transport.restartFromZero();
  return { world, rejoin: { path: 'full', reason: r.reason } };
}
