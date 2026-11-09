/**
 * The pure parts of main.ts's mission glue (GH-1075 A2, §0.10, Task 2.12 fix round 1, RULING R21): whether a mission asks the
 * server for its start nonce and what a missing answer means, which queued op is the victory a settle just wrote, and the
 * debrief's coin line for it. main.ts only calls these.
 */
import type { CoinLineState, DebriefCoins } from '../ui/debrief';
import type { AccountClient } from './client';
import type { OutboxOp } from './outbox';
import { provisionalLine, type SpendFlow } from './spend-flow';

/** What the victory handler reads: `start` is what reaches `settleVictory`; `failed` is the briefing's offline note. */
export interface MissionStartHandle {
  readonly start: string | null;
  readonly failed: boolean;
}

export interface MissionStartOptions {
  /** `mission.ledger.produces.length > 0`: the tutorial and sandboxes never ask. */
  campaign: boolean;
  missionId: string | undefined;
  /** The device is signed in (an account store). With no `client` (a cached device whose client failed to load) the mission cannot
   *  ask for a nonce, so the briefing says coins are not promised. Absent/false for a guest: nothing is said. */
  signedIn?: boolean;
  /** Null for a guest (no account session), or a signed-in device whose client failed to load: nothing is asked. */
  client: Pick<AccountClient, 'missionStart'> | null;
  /** The answer did not come (a refusal, a thrown request): the briefing says coins are not promised. */
  onFailed: () => void;
}

/** Calls `mission/start` for a signed-in campaign mission only. Not awaited by the caller: the handle fills in when it lands. */
export function requestMissionStart(o: MissionStartOptions): MissionStartHandle {
  const h = { start: null as string | null, failed: false };
  if (!o.campaign || o.missionId === undefined) return h;
  const failed = (): void => {
    h.failed = true;
    o.onFailed();
  };
  if (o.client === null) {
    if (o.signedIn === true) failed();
    return h;
  }
  o.client.missionStart(o.missionId).then((r) => {
    if (r.ok) h.start = r.body.start;
    else failed();
  }, failed);
  return h;
}

/** The ids of the ops queued right now: take it BEFORE the settle, so the victory it queues is found by id, not by position. */
export const opIdsOf = (ops: readonly OutboxOp[]): ReadonlySet<string> => new Set(ops.map((op) => op.opId));

/** The victory op queued since `before` (the settle's own), or undefined. */
export function victoryOpSince(before: ReadonlySet<string>, ops: readonly OutboxOp[]): string | undefined {
  return ops.find((op) => op.kind === 'victory' && !before.has(op.opId))?.opId;
}

export interface VictoryCoinLineOptions {
  flow: Pick<SpendFlow, 'coinLine'> | null;
  /** Account store with a `saved` settle of a campaign mission; else there is nothing to show. */
  eligible: boolean;
  before: ReadonlySet<string>;
  ops: readonly OutboxOp[];
  start: string | null;
  total: number;
  balance: number;
}

/**
 * The debrief's coin line, or undefined (a guest, or no nonce so no provisional award). An eligible win with no spend flow is a
 * signed-in device running offline from its cache: the local award is NOT final, so the line is the static `willSync` one and
 * the caller must not draw the guest's final table. With a flow it is live: provisional, corrected in place on the answer.
 */
export function victoryCoinLine(o: VictoryCoinLineOptions): DebriefCoins | undefined {
  if (!o.eligible) return undefined;
  if (o.flow === null) {
    const initial = provisionalLine(o.start, o.total, o.balance);
    return initial === null ? undefined : { initial: { ...initial, phase: 'willSync' }, subscribe: () => () => undefined };
  }
  const opId = victoryOpSince(o.before, o.ops);
  const initial: CoinLineState | null = provisionalLine(o.start, o.total, o.balance);
  return opId !== undefined && initial !== null ? o.flow.coinLine(opId, initial) : undefined;
}
