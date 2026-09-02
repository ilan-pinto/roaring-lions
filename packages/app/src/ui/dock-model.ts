// The reinforcements dock's arithmetic, with no DOM in it (GH-153 slice 3).
//
// Every rule the dock draws lives here so it can be falsified without a
// browser: what makes a tile affordable, what a lock says in sixty pixels,
// which two words describe a unit's doctrine, and how a queue entry becomes a
// bar and a countdown. `production.ts` does the DOM and nothing else.
//
// The split matters more here than it looks. Four of the five tile states are
// decided from numbers that change every 250 ms, and a state that is wrong for
// one frame of a live mission is invisible; the same wrongness in a pure
// function is one assertion.

import { TICKS_PER_SECOND } from '@lions/sim';
import type { RoleBucket } from './role';

/** A type the player may build, as the dock needs it. Assembled in `main.ts`,
 *  which is the only place that can see the unit JSON, the sim's own unit type
 *  and the sprite catalogue at once. */
export interface DockUnit {
  id: string;
  name: string;
  /** The cost badge, and what affordability is judged against. */
  logistics: number;
  /** Seconds from `requestBuild` to deployment — the tooltip's second figure. */
  buildTimeS: number;
  /** The same bucket the selection chip badges the unit with, computed from the
   *  same `roleBucket` call, so the dock and the cluster cannot disagree about
   *  what a unit IS while both are on screen. */
  bucket: RoleBucket;
  /** The portrait frame, or null when the sheet never loaded. Null is a real
   *  runtime state and not a theoretical one: the manifest fetch that produces
   *  these has its own failure path in `main.ts` and deliberately does not hold
   *  up the art gate, so a 404 costs the HUD a picture and nothing else. */
  sprite: string | null;
  /** `doctrineTags` output, computed once at construction. */
  tags: readonly string[];
  /** The one-line description, from the unit JSON's optional `blurb`. */
  blurb?: string;
}

/** The live numbers a tile is judged against. A narrow view of
 *  `ProductionRuntime` so a test can supply four fields instead of a
 *  `MissionRuntime`. */
export interface DockView {
  readonly logistics: number;
  readonly production: readonly {
    unit: string;
    ticksLeft: number;
    doneTicks: number;
    totalTicks: number;
  }[];
  buildBlockedReason(unitId: string): string | null;
}

export interface QueueState {
  /** Whole seconds until the next one of these deploys. */
  secs: number;
  /** 0-100, for the bar along the bottom of the tile. */
  percent: number;
  /** How many of this type are in the queue — the bar only shows the nearest. */
  count: number;
}

export interface TileState {
  /** Enough logistics right now. Affordability is not a lock: a price the
   *  player is saving towards reads as dim, not as refused. */
  affordable: boolean;
  /** A campaign gate refusing this type, or null. `short` is what fits in the
   *  tile; `full` is the runtime's own sentence, kept for the `title`. */
  lock: { short: string; full: string } | null;
  queue: QueueState | null;
}

/**
 * What a lock says inside a 60px tile.
 *
 * `buildBlockedReason` answers in a full sentence — "requires campaign ROE 55
 * (no missions rated yet)", "field camp destroyed — no production" — because
 * its other caller is the campaign menu, which has a paragraph to spend. A
 * tile has about eleven characters, so the ROE gate becomes its number and
 * everything else becomes the word `locked`. The sentence is not thrown away:
 * it goes on the tile's `title`, and the click's own note repeats it in the
 * feed.
 *
 * Deliberately a match on the one gate that has a NUMBER worth showing rather
 * than a table of every reason. A reason this does not recognise degrades to
 * `locked`, which is honest; a table would degrade to a missing case.
 */
export function lockLabel(reason: string): string {
  const roe = /^requires campaign ROE (\d+)/.exec(reason);
  return roe === null ? 'locked' : `ROE ≥ ${roe[1]}`;
}

/**
 * Abilities that change how a unit is USED, in the order they earn a tag.
 *
 * The order is a priority, not the JSON's order, and that is the whole point:
 * `yahalom_squad` declares `tunnel_charge, mark_tunnel, garrison, smoke` and
 * the spec draws `soft · demolition · garrisons`. Taking the first two as
 * authored would have said "finds tunnels" instead of "garrisons", which is
 * true and much less useful — every engineer marks tunnels, and only this one
 * can bring one down.
 *
 * `kamikaze` is deliberately absent: `roleBucket` already returns that word, so
 * an entry here would make `attack_drone` read `kamikaze · one-way`.
 */
const ABILITY_TAGS: readonly (readonly [string, string])[] = [
  ['demolish', 'demolition'],
  ['tunnel_charge', 'demolition'],
  ['breach', 'breach'],
  ['garrison', 'garrisons'],
  ['hidden_setup', 'sets up hidden'],
  ['mark_tunnel', 'finds tunnels'],
  ['mark_target', 'spots'],
  ['smoke', 'smoke'],
];

/** Three fits the tooltip's line at 230px. The bucket is always one of them, so
 *  a unit contributes at most two abilities. */
export const MAX_TAGS = 3;

/**
 * The doctrine line: what this unit is, then the most decisive things it does.
 *
 * The bucket leads because it is the one tag every unit has and the one the
 * badge beside it draws. Two abilities follow because a third crowds the line
 * and because past the second the tags stop distinguishing units — `garrison`
 * and `mark_target` are held by most of the infantry.
 */
export function doctrineTags(bucket: RoleBucket, abilities: readonly string[]): string[] {
  const out: string[] = [bucket];
  const have = new Set(abilities);
  for (const [ability, tag] of ABILITY_TAGS) {
    if (out.length >= MAX_TAGS) break;
    // Two abilities map to `demolition`; a unit holding both earns it once.
    if (have.has(ability) && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * The queue entry a tile draws, or null when nothing of this type is building.
 *
 * The NEAREST to done, not the first in the array. In practice the two are the
 * same — the queue is push-ordered and every entry of one type has the same
 * total — but the countdown on the tile is a promise about when the next one
 * arrives, and reading it off array order would make that promise depend on an
 * implementation detail of `MissionRuntime.buildQueue`.
 */
export function queueFor(view: DockView, unitId: string): QueueState | null {
  let best: DockView['production'][number] | null = null;
  let count = 0;
  for (const item of view.production) {
    if (item.unit !== unitId) continue;
    count++;
    if (best === null || item.ticksLeft < best.ticksLeft) best = item;
  }
  if (best === null) return null;
  return {
    secs: Math.ceil(best.ticksLeft / TICKS_PER_SECOND),
    // A zero-length build is instant, so it is finished, not un-started.
    percent: best.totalTicks > 0 ? (best.doneTicks / best.totalTicks) * 100 : 100,
    count,
  };
}

/** Every state one unit tile is in, this frame. */
export function tileState(unit: DockUnit, view: DockView): TileState {
  const reason = view.buildBlockedReason(unit.id);
  return {
    affordable: view.logistics >= unit.logistics,
    lock: reason === null ? null : { short: lockLabel(reason), full: reason },
    queue: queueFor(view, unit.id),
  };
}
