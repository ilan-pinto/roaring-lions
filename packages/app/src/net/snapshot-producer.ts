/**
 * The snapshot producer (snapshot spec §3.3, S4 task 4): each versus seat cuts
 * the sim at the frame boundary of a snapshot tick, gzips it and uploads it
 * ONCE. The frame log stays the authority; a snapshot is only a shortcut, so
 * every failure here is a skipped cadence and never an error the player sees
 * or a throw into the tick loop.
 *
 * No DOM, so the AI harness and the tests run the code the browser runs.
 *
 * Rules, from the plan's "Produce" contract:
 * - one attempt per snapshot tick, never retried (the lead's ruling of 26 Oct):
 *   `lastAttempt` is set BEFORE anything can fail;
 * - at most one upload in flight;
 * - off while far behind (`behind() > every`): a rejoiner replaying a long log
 *   would encode snapshots the room refuses as stale anyway;
 * - the encode runs synchronously inside the loop, so it sees the state after
 *   frame `tick` and before frame `tick + 1`; a throw is caught and logged.
 */
import { SNAPSHOT_MAX_COMPRESSED_BYTES, gzipBytes, isSnapshotTick, snapshotEvery, type MatchConfig } from '@lions/net';
import { encodeSim, type MissionRuntime, type Sim } from '@lions/sim';
import { shippedContentDigest } from './content-digest';

/** What one upload came to. `duplicate` (a 409 whose body is `duplicate`) means "the room already recorded it" (§14.4);
 *  `mismatch` (a 409 `mismatch`) is the two seats disagreeing on the same tick; `stale` and `not_running` are `refused`. */
export type UploadOutcome = 'stored' | 'held' | 'duplicate' | 'mismatch' | 'refused' | 'failed';

/** Why a cadence made no upload. `encode` and `gzip` are faults of our own; the rest are rules. */
export type SkipReason = 'noDigest' | 'repeat' | 'behind' | 'inFlight' | 'encode' | 'gzip' | 'tooLarge';

export interface ProducerStats {
  encodes: number;
  lastEncodeMs: number;
  stored: number;
  held: number;
  /** 409 `duplicate`: the room had already recorded this tick's snapshot (§14.4). */
  recorded: number;
  /** 409 `mismatch`: the seats disagree on this tick's SHA or digest (a desync signal). */
  mismatch: number;
  refused: number;
  failed: number;
  skipped: Record<string, number>;
}

export interface SnapshotProducerOptions {
  config: MatchConfig;
  build: string;
  sim: Sim;
  /** The mission runtime built over `sim` (a KDF v Sarim room), else null. */
  runtime: MissionRuntime | null;
  /** Frames the transport holds that this seat has not run yet. */
  behind: () => number;
  upload: (tick: number, gz: Uint8Array) => Promise<UploadOutcome>;
  log: (line: string) => void;
  /** This client's own content digest; default `shippedContentDigest()`, read at the first encode. */
  contentDigest?: number;
  encode?: typeof encodeSim;
  gzip?: (raw: Uint8Array) => Promise<Uint8Array>;
  now?: () => number;
}

export class SnapshotProducer {
  private readonly every: number;
  private readonly enabled: boolean;
  private readonly encode: typeof encodeSim;
  private readonly gzip: (raw: Uint8Array) => Promise<Uint8Array>;
  private readonly now: () => number;
  private lastAttempt = -1;
  private inFlight: Promise<void> | null = null;
  private readonly logged = new Set<string>();
  private readonly s: ProducerStats = { encodes: 0, lastEncodeMs: 0, stored: 0, held: 0, recorded: 0, mismatch: 0, refused: 0, failed: 0, skipped: {} };

  constructor(private readonly o: SnapshotProducerOptions) {
    this.every = snapshotEvery(o.config);
    // A sandbox room is not restorable (plan Ruling 2), and cadence 0 is off: both produce nothing, silently.
    this.enabled = o.config.mode === 'versus' && this.every > 0;
    this.encode = o.encode ?? encodeSim;
    this.gzip = o.gzip ?? gzipBytes;
    this.now = o.now ?? (() => Date.now());
  }

  /** Called by `runFrames` (`FrameStep.afterFrame`) after frame `tick` ran and was reported. Never throws. */
  onFrame(tick: number, digest: number | null): void {
    if (!this.enabled || !isSnapshotTick(tick, this.every)) return;
    if (digest === null) return this.skip('noDigest', tick);
    if (tick <= this.lastAttempt) return this.skip('repeat', tick);
    if (this.o.behind() > this.every) return this.skip('behind', tick);
    if (this.inFlight !== null) return this.skip('inFlight', tick);
    // One attempt per tick: set before anything below can fail, so no failure is ever retried.
    this.lastAttempt = tick;
    const t0 = this.now();
    let raw: Uint8Array;
    try {
      raw = this.encode(
        this.o.sim,
        { build: this.o.build, contentDigest: (this.o.contentDigest ?? shippedContentDigest()) >>> 0, matchId: this.o.config.matchId, frameTick: tick, matchDigest: digest >>> 0 },
        this.o.runtime ?? undefined,
      );
    } catch (e) {
      return this.skip('encode', tick, e instanceof Error ? e.message : String(e));
    }
    this.s.encodes++;
    this.s.lastEncodeMs = this.now() - t0;
    this.inFlight = this.finish(tick, raw).finally(() => { this.inFlight = null; });
  }

  stats(): ProducerStats {
    return { ...this.s, skipped: { ...this.s.skipped } };
  }

  /** Settles when the upload in flight (if any) has. For tests and teardown; the loop never awaits it. */
  idle(): Promise<void> {
    return this.inFlight ?? Promise.resolve();
  }

  private async finish(tick: number, raw: Uint8Array): Promise<void> {
    let gz: Uint8Array;
    try {
      gz = await this.gzip(raw);
    } catch (e) {
      return this.skip('gzip', tick, e instanceof Error ? e.message : String(e));
    }
    if (gz.byteLength > SNAPSHOT_MAX_COMPRESSED_BYTES) return this.skip('tooLarge', tick, `${gz.byteLength} bytes`);
    let outcome: UploadOutcome;
    try {
      outcome = await this.o.upload(tick, gz);
    } catch {
      outcome = 'failed';
    }
    if (outcome === 'stored') this.s.stored++;
    else if (outcome === 'held') this.s.held++;
    else if (outcome === 'duplicate') this.s.recorded++;
    else if (outcome === 'mismatch') this.s.mismatch++;
    else if (outcome === 'refused') this.s.refused++;
    else this.s.failed++;
  }

  /** Counts the skip; the reason is logged once per kind, never per cadence. */
  private skip(reason: SkipReason, tick: number, detail?: string): void {
    this.s.skipped[reason] = (this.s.skipped[reason] ?? 0) + 1;
    if (this.logged.has(reason)) return;
    this.logged.add(reason);
    this.o.log(`snapshot: skipped tick ${tick} (${reason})${detail === undefined ? '' : `: ${detail}`}`);
  }
}
