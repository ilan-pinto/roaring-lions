/**
 * The snapshot upload's acceptance rules, pure (snapshot S3, spec §5.1). Like
 * `room-core.ts` it touches no storage and no clock: the Durable Object feeds
 * it the numbers and acts on the answer. Three small pieces:
 *
 *  - `admitTick` says whether a declared snapshot tick may be uploaded at all;
 *  - `PendingBook` holds, in memory only, what each seat has uploaded and not
 *    yet been matched (never more than two ticks, so 256 KiB at the 64 KiB cap);
 *  - `decide` turns a tick's pending uploads and the agreed match digest into
 *    one of three outcomes: hold, refuse as a mismatch, or accept.
 */
import { isSnapshotTick } from '@lions/net';

export interface AdmitInput {
  /** The room's snapshot cadence in frame ticks (> 0 here: a room with 0 never reaches this). */
  every: number;
  /** The room's current minted tick (`st.tick`). */
  roomTick: number;
  /** The tick of the snapshot already stored, or -1 for none. */
  storedTick: number;
}

/** The newest snapshot tick strictly below `roomTick`, or -1 when none exists yet. */
export function newestSnapshotTickBelow(roomTick: number, every: number): number {
  if (!(every > 0)) return -1;
  return Math.floor(roomTick / every) * every - 1;
}

/**
 * A snapshot tick is admissible iff it is on the cadence, already minted
 * (`< roomTick`), newer than the stored one, and one of the two newest
 * snapshot ticks below the room's tick. Older than that is `stale`, which also
 * refuses a client that is still catching up.
 */
export function admitTick(tick: number, o: AdmitInput): 'ok' | 'stale' {
  if (!isSnapshotTick(tick, o.every)) return 'stale';
  if (tick >= o.roomTick) return 'stale';
  if (tick <= o.storedTick) return 'stale';
  if (tick < newestSnapshotTickBelow(o.roomTick, o.every) - o.every) return 'stale';
  return 'ok';
}

export type Seat = 0 | 1;

/** What one seat uploaded for one tick: the SHA-256 of the inflated bytes, the header's match digest (u32), and the compressed body. */
export interface Pending {
  sha: string;
  digest: number;
  body: Uint8Array;
}

/** At most this many distinct snapshot ticks are held at once. */
export const PENDING_TICKS_MAX = 2;

/** Uploads waiting for their pair. Memory only: an eviction forgets them. */
export class PendingBook {
  private readonly byTick = new Map<number, [Pending | undefined, Pending | undefined]>();

  has(seat: Seat, tick: number): boolean {
    return this.byTick.get(tick)?.[seat] !== undefined;
  }

  get(seat: Seat, tick: number): Pending | undefined {
    return this.byTick.get(tick)?.[seat];
  }

  /** The distinct ticks held, ascending. */
  ticks(): number[] {
    return [...this.byTick.keys()].sort((a, b) => a - b);
  }

  /** Record an upload. A third distinct tick drops the oldest held one (possibly this one). */
  put(seat: Seat, tick: number, p: Pending): void {
    const slot = this.byTick.get(tick) ?? [undefined, undefined];
    slot[seat] = p;
    this.byTick.set(tick, slot);
    while (this.byTick.size > PENDING_TICKS_MAX) this.byTick.delete(this.ticks()[0]);
  }

  drop(tick: number): void {
    this.byTick.delete(tick);
  }

  /** Drop every pending tick up to and including `tick`. */
  dropThrough(tick: number): void {
    for (const t of this.ticks()) if (t <= tick) this.byTick.delete(t);
  }

  clear(): void {
    this.byTick.clear();
  }
}

export type Decision =
  | { kind: 'held' }
  | { kind: 'mismatch'; why: 'sha' | 'digest'; shas: [string, string]; digest: number }
  | { kind: 'accept'; sha: string; digest: number; body: Uint8Array };

/**
 * What to do with `tick`'s pending uploads, given the digest both seats agreed
 * for that tick (`agreed`, a signed int32 as the room hashes, or undefined when
 * the pair has not agreed yet).
 *
 * Two different SHAs are a mismatch at once: waiting would change nothing. Equal
 * SHAs wait for the agreed digest; once known, the header's digest (a u32) must
 * equal it (compared as `agreed >>> 0`), else it is a mismatch of kind `digest`.
 * The body kept is seat 0's: both inflate to the same SHA, and the choice is
 * arbitrary but fixed.
 */
export function decide(pending: PendingBook, tick: number, agreed: number | undefined): Decision {
  const a = pending.get(0, tick);
  const b = pending.get(1, tick);
  if (a === undefined || b === undefined) return { kind: 'held' };
  if (a.sha !== b.sha) return { kind: 'mismatch', why: 'sha', shas: [a.sha, b.sha], digest: a.digest };
  if (agreed === undefined) return { kind: 'held' };
  if (agreed >>> 0 !== a.digest) return { kind: 'mismatch', why: 'digest', shas: [a.sha, b.sha], digest: a.digest };
  return { kind: 'accept', sha: a.sha, digest: a.digest, body: a.body };
}
