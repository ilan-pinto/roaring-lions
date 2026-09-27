import {
  UNIT_ID_PATTERN,
  TIER_PATTERN,
  ITEM_PATTERN,
  MISSION_PATTERN as MISSION_RE,
  TELEMETRY_ORDER_VERBS,
  type AccountReason,
  type CountMap,
  type TelemetryEnvelope,
  type TelemetryEvent,
  type TelemetryOrderVerb,
  type TelemetryScreen,
} from '@lions/data/telemetry';
import type { DefeatCause } from '@lions/sim';
import type { PlayerIntent } from '../input/intents';

/** What the builders read from a live mission. Built by the caller from
 *  `MissionRuntime` and `sim.tickCount` -- a read, never a write (invariant 4). */
export interface RuntimeView {
  tick: number;
  result: 'ongoing' | 'victory' | 'defeat';
  defeatCause: DefeatCause | undefined;
  roe: number;
  fielded: number;
  lost: number;
  objectives: readonly { id: string; type: string; primary: boolean; status: 'active' | 'complete' | 'failed' }[];
}

const int = (n: number): number => Math.max(0, Math.round(n));

/** What the account builders read from the brigade account. A read, never a
 *  write (invariant 4) -- the caller owns the real account shape. */
export interface AccountLike {
  readonly balance: number;
  readonly earned_total: number;
  readonly unlocks: readonly string[];
  readonly upgrades: Readonly<Record<string, Readonly<Record<string, number>>>>;
}
export interface AccountSnapshot {
  credits: number;
  earned: number;
  unlocks: string[];
  tiers: string[];
}
export interface AccountExtra {
  mission?: string;
  item?: string;
  price?: number;
  paid?: number;
}
export interface Loadout {
  deployed: CountMap;
  fromRoster: CountMap;
}
export interface MissionCounts {
  bought: CountMap;
  orders: Partial<Record<TelemetryOrderVerb, number>>;
}

const MAX_UNLOCKS = 64;
const MAX_TIERS = 256;
const COUNT_MAX = 100_000;
const ORDER_VERB_SET = new Set<string>(TELEMETRY_ORDER_VERBS);

/** Which `AccountExtra` fields a reason may carry through at all -- anything
 *  else supplied is dropped rather than emitted (T2 fix round 2, item 1). */
const REASON_ALLOWED: Record<AccountReason, readonly (keyof AccountExtra)[]> = {
  mission_start: ['mission'],
  payout: ['mission', 'paid'],
  purchase: ['mission', 'item', 'price'],
  reset: [],
};

export function accountSnapshot(a: AccountLike): AccountSnapshot {
  const unlocks = [...new Set(a.unlocks)].filter((u) => UNIT_ID_PATTERN.test(u)).sort().slice(0, MAX_UNLOCKS);
  const tiers: string[] = [];
  for (const [unit, tracks] of Object.entries(a.upgrades)) {
    for (const [track, tier] of Object.entries(tracks)) {
      const s = `${unit}.${track}.${tier}`;
      if (TIER_PATTERN.test(s)) tiers.push(s); // tier 0, junk ids and tier >= 10 all fail the pattern
    }
  }
  tiers.sort();
  return { credits: int(a.balance), earned: int(a.earned_total), unlocks, tiers: tiers.slice(0, MAX_TIERS) };
}

/**
 * A purchase with no `item`, or no `price`, and a payout with no `paid`, are
 * caller bugs, not data the contract merely declines to send -- the schema
 * makes them optional (T1), but a reason that names its own required fields
 * and silently omits them would ship an `account` event that LOOKS like a
 * purchase and records no purchase at all. Throwing keeps `accountEvent`'s
 * return type `TelemetryEvent` (not `| null`), which Tasks 3 and 5 already
 * build against, and surfaces the mistake at the call site instead of in
 * `/stats` weeks later (T2 fix round 2, item 1).
 */
export function accountEvent(
  env: TelemetryEnvelope,
  reason: AccountReason,
  s: AccountSnapshot,
  extra: AccountExtra = {}
): TelemetryEvent {
  if (reason === 'purchase' && (extra.item === undefined || extra.price === undefined)) {
    throw new Error("accountEvent: reason 'purchase' requires both item and price");
  }
  if (reason === 'payout' && extra.paid === undefined) {
    throw new Error("accountEvent: reason 'payout' requires paid");
  }
  const allowed = new Set<keyof AccountExtra>(REASON_ALLOWED[reason]);
  const mission = allowed.has('mission') ? extra.mission : undefined;
  const item = allowed.has('item') ? extra.item : undefined;
  const price = allowed.has('price') ? extra.price : undefined;
  const paid = allowed.has('paid') ? extra.paid : undefined;
  return {
    ...env,
    type: 'account',
    reason,
    credits: Math.min(COUNT_MAX, s.credits),
    earned: Math.min(COUNT_MAX, s.earned),
    unlocks: s.unlocks,
    tiers: s.tiers,
    ...(mission !== undefined && MISSION_RE.test(mission) ? { mission } : {}),
    ...(item !== undefined && ITEM_PATTERN.test(item) ? { item } : {}),
    ...(price !== undefined ? { price: Math.min(COUNT_MAX, int(price)) } : {}),
    ...(paid !== undefined ? { paid: Math.min(COUNT_MAX, int(paid)) } : {}),
  };
}

export function orderVerbOf(i: PlayerIntent): TelemetryOrderVerb | null {
  switch (i.kind) {
    case 'order':
      return i.verb;
    case 'garrison':
    case 'demolish':
    case 'chargeTunnel':
    case 'mount':
    case 'dismount':
    case 'smoke':
    case 'halt':
      return i.kind;
    case 'support':
      return i.accepted ? i.call : null;
    case 'select':
    case 'group':
    case 'overlay':
      return null;
  }
}

/** `orders` counts one of the eleven `TelemetryOrderVerb`s; `bought` counts a
 *  unit id. Anything else is refused rather than silently tallied under a key
 *  the contract (or a real order verb) would never recognise. */
export function tally(m: CountMap, key: string): void {
  if (!UNIT_ID_PATTERN.test(key) && !ORDER_VERB_SET.has(key)) return;
  m[key] = Math.min(COUNT_MAX, (m[key] ?? 0) + 1);
}

const nonZero = <K extends string>(m: Partial<Record<K, number>>): Record<K, number> =>
  Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === 'number' && v > 0)) as Record<K, number>;

export function causeString(c: DefeatCause | undefined): string | undefined {
  if (c === undefined) return undefined;
  return typeof c === 'string' ? c : `objective:${c.objective}`;
}

export function screenFor(pathname: string, base: string, tutorialId: string): TelemetryScreen {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '');
  const [head, id] = rest.split('/');
  switch (head) {
    case '':
      return 'menu';
    case 'campaign':
      return 'campaign';
    case 'brigade':
      return 'brigade';
    case 'free-play':
      return 'sandbox';
    case 'mission':
      return id === tutorialId ? 'tutorial' : 'mission';
    default:
      return 'other';
  }
}

export const sessionStart = (
  env: TelemetryEnvelope,
  screen: TelemetryScreen,
  renderer: 'three' | 'pixi',
  viewport: [number, number],
  returning: boolean
): TelemetryEvent => ({ ...env, type: 'session_start', screen, renderer, viewport: [int(viewport[0]), int(viewport[1])], returning });

export const heartbeat = (env: TelemetryEnvelope, mission: string, tick: number): TelemetryEvent => ({
  ...env, type: 'heartbeat', mission, tick: int(tick),
});

export const tutorialStep = (env: TelemetryEnvelope, step: number, steps: number, prevMs: number): TelemetryEvent => ({
  ...env, type: 'tutorial_step', step: int(step), steps: int(steps), prevMs: int(prevMs),
});

export const missionStart = (
  env: TelemetryEnvelope,
  mission: string,
  replay: boolean,
  loadout?: Loadout
): TelemetryEvent => ({
  ...env,
  type: 'mission_start',
  mission,
  replay,
  ...(loadout ? { deployed: nonZero(loadout.deployed), fromRoster: nonZero(loadout.fromRoster) } : {}),
});

export function objectiveEvent(
  env: TelemetryEnvelope,
  mission: string,
  view: RuntimeView,
  objectiveId: string,
  status: 'complete' | 'failed',
  tick: number
): TelemetryEvent | null {
  const o = view.objectives.find((x) => x.id === objectiveId);
  if (!o) return null;
  return { ...env, type: 'objective', mission, objective: o.id, objectiveType: o.type, primary: o.primary, status, tick: int(tick) };
}

export function missionEnd(
  env: TelemetryEnvelope,
  mission: string,
  view: RuntimeView,
  abandoned: boolean,
  counts?: MissionCounts
): TelemetryEvent {
  const result = abandoned || view.result === 'ongoing' ? 'abandoned' : view.result;
  const cause = result === 'defeat' ? causeString(view.defeatCause) : undefined;
  return {
    ...env,
    type: 'mission_end',
    mission,
    result,
    ...(cause === undefined ? {} : { cause }),
    tick: int(view.tick),
    roe: Math.min(100, int(view.roe)),
    fielded: int(view.fielded),
    lost: int(view.lost),
    objectivesDone: view.objectives.filter((o) => o.status === 'complete').length,
    objectivesTotal: view.objectives.length,
    ...(counts ? { bought: nonZero(counts.bought), orders: nonZero(counts.orders) } : {}),
  };
}

export const campaignProgress = (env: TelemetryEnvelope, mission: string, missionsWon: number): TelemetryEvent => ({
  ...env, type: 'campaign_progress', mission, missionsWon: int(missionsWon),
});
