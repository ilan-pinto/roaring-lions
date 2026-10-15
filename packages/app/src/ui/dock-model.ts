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

import { TICKS_PER_SECOND, conductAtLeast, isBoughtOnly, starsEarned, type LedgerData, type UnlockGate } from '@lions/sim';
import type { KitLevel } from '@lions/data';
import { gateSentence } from '../gate-sentence';
import { t } from '../i18n/t';
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
  /** True when `sprite` above is a cropped `unitIcon` rather than a whole
   *  sheet frame -- `main.ts` sets this beside `sprite` from the same
   *  resolution, and the tile uses it only to pick `image-rendering`
   *  (`data-icon="1"`): a smooth Lanczos crop must not be nearest-neighboured
   *  the way a palette-quantised sheet frame is. Absent/false for a sheet
   *  frame or no sprite at all. */
  spriteIsIcon?: boolean;
  /** `doctrineTags` output, computed once at construction. */
  tags: readonly string[];
  /** The one-line description, from the unit JSON's optional `blurb`. */
  blurb?: string;
  /** The type's kit level this mission (plan 2b) -- main.ts's kitLevelOf, the same read the chips and the card make. Absent or 0: no sign. */
  kit?: KitLevel;
  /** The campaign gate, structured -- the same `kdfUnlockGate(u)` `main.ts` already
   *  hands `MissionRuntime`'s own `unitInfo`. `lockLabel`/`tileState` read this
   *  directly through `gateSentence` rather than parsing the runtime's own
   *  `buildBlockedReason` sentence, so the tile can never show the sim's own
   *  bare wording -- a floor with a parenthetical, or an id verbatim. */
  unlock?: UnlockGate;
  /** What one of these takes of the side's population cap -- the unit JSON's
   *  `cost.population`, schema default 1 (a drone is 0). Absent reads as 1, so
   *  a caller that never heard of the cap is judged as the runtime judges it.
   *  Used only to word the capped tile's "needs N" line; WHETHER it is capped
   *  is the runtime's call (`DockView.popCapped`), never recomputed here. */
  population?: number;
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
  /** MissionRuntime's own question: is the population cap the FIRST thing
   *  refusing this build (after the unlock gate and the camp)? Optional so a
   *  view that predates the cap reads as never capped. */
  popCapped?(unitId: string): boolean;
  /** Side 0's population against its cap, or null when uncapped (every
   *  campaign mission today, where the dock shows no readout). */
  populationView?(): { used: number; cap: number } | null;
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
   *  tile; `full` goes on the `title` -- `gateSentence`'s human sentence when a
   *  structured gate is what is blocking, the runtime's own (already plain
   *  English) text for a non-gate block such as a destroyed field camp. */
  lock: { short: string; full: string } | null;
  /** The population cap is what refuses this build, or null. Exclusive with
   *  `lock`: a campaign lock outranks it (`popCapped` only speaks when the gate
   *  and the camp did not), so a locked tile reads its lock, never "pop full".
   *  `short` fits the tile; `full` is the numbers sentence (`title`, the rich
   *  tip, the click's note); `title` is the same sentence WITHOUT the unit's
   *  name, for the tile's `title`/`aria-label`, which already open with it. */
  capped: { short: string; full: string; title: string } | null;
  queue: QueueState | null;
}

/**
 * What a lock says inside a 60px tile.
 *
 * Reads the unit's own STRUCTURED gate through `conductAtLeast`/`starsEarned`
 * -- the same predicates `gateSentence` and the brigade's `bindingGate` use --
 * rather than parsing `buildBlockedReason`'s sentence with a regex. A tile has
 * about eleven characters, so the Conduct gate becomes its number and
 * everything else becomes the word `locked`; the full sentence is not thrown
 * away, it goes on the tile's `title` via `tileState`, and the click's own
 * note repeats it in the feed.
 *
 * Deliberately a match on the gates that have a NUMBER worth showing rather
 * than a table of every reason: a unit with no `unlock` at all, an
 * `afterMission`-only gate (no number to show), or a gate that is not
 * actually what is blocking right now (the runtime may still report a
 * non-gate reason, e.g. a destroyed field camp) all degrade to `locked`,
 * which is honest; a table would degrade to a missing case.
 */
export function lockLabel(unlock: UnlockGate | undefined, ledger: LedgerData | undefined): string {
  if (unlock?.roeMin !== undefined && !conductAtLeast(ledger, unlock.roeMin)) {
    return t('dock.lock.conduct', { n: unlock.roeMin });
  }
  if (unlock?.starsMin !== undefined && starsEarned(ledger) < unlock.starsMin) {
    return t('dock.lock.stars', { n: unlock.starsMin });
  }
  // No earned field failed above. A gate with no earned field at all is bought-only
  // (D1, the special forces shape): the tile's number is the price, same as `bindingGate`.
  if (unlock !== undefined && isBoughtOnly(unlock) && unlock.price !== undefined) {
    return t('dock.lock.price', { n: unlock.price });
  }
  return t('dock.lock.locked');
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
 *
 * Values are catalogue KEYS, not English text — `doctrineTags` below calls
 * `t()` on each one it selects. This table is module-level (lesson from
 * `selection-model.ts`'s `ORDERS` and `input/keymap.ts`'s `ACTIONS`): if the
 * VALUES here were resolved text instead of keys, they would have to be
 * either frozen at import time (wrong locale under `?pseudo=1`, the bug
 * `role.ts`'s `ROLE_LABEL` fix round 1 closed) or translated a second time
 * by every caller. Keeping them as keys and translating once, inside
 * `doctrineTags`, avoids both.
 */
const ABILITY_TAGS: readonly (readonly [string, string])[] = [
  ['demolish', 'dock.tag.demolition'],
  ['tunnel_charge', 'dock.tag.demolition'],
  ['breach', 'dock.tag.breach'],
  ['garrison', 'dock.tag.garrisons'],
  ['hidden_setup', 'dock.tag.hiddenSetup'],
  ['mark_tunnel', 'dock.tag.findsTunnels'],
  ['mark_target', 'dock.tag.spots'],
  ['smoke', 'dock.tag.smoke'],
];

/** `RoleBucket` id -> catalogue key, the same table shape `role.ts`'s
 *  `ROLE_KEYS` uses for the unit `role` field. */
const BUCKET_KEYS: Readonly<Record<RoleBucket, string>> = {
  kamikaze: 'dock.bucket.kamikaze',
  drone: 'dock.bucket.drone',
  gunship: 'dock.bucket.gunship',
  sniper: 'dock.bucket.sniper',
  transport: 'dock.bucket.transport',
  soft: 'dock.bucket.soft',
  armour: 'dock.bucket.armour',
};

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
  // Collected as KEYS first, deduplicated by key, and translated only at the
  // very end -- so two abilities that map to the same catalogue entry
  // dedupe correctly regardless of locale, rather than comparing already-
  // translated text (which two different keys could coincidentally share).
  const keys: string[] = [BUCKET_KEYS[bucket]];
  const have = new Set(abilities);
  for (const [ability, tagKey] of ABILITY_TAGS) {
    if (keys.length >= MAX_TAGS) break;
    // Two abilities map to `demolition`; a unit holding both earns it once.
    if (have.has(ability) && !keys.includes(tagKey)) keys.push(tagKey);
  }
  return keys.map((key) => t(key));
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

/**
 * Every state one unit tile is in, this frame.
 *
 * `view.buildBlockedReason` is still asked FIRST, and still decides whether the
 * tile is locked at all -- it is the only thing that knows about a destroyed
 * field camp, and invariant 4 forbids recomputing sim state on this side. But
 * the SENTENCE a locked tile shows never comes from that string: when the
 * unit's own `unlock` gate is what is closed, `gateSentence` (the same
 * app-side helper the campaign map and brigade use) recomputes it from the
 * gate and the ledger, independently of the sim's wording. Only a reason with
 * no gate behind it at all -- "field camp destroyed", "no field camp", "not
 * available in the field" -- falls back to the runtime's own text, and none of
 * those three are ever the sim's `requires ...` phrasing.
 */
export function tileState(
  unit: DockUnit,
  view: DockView,
  ledger?: LedgerData,
  missionName: (id: string) => string | undefined = () => undefined
): TileState {
  const reason = view.buildBlockedReason(unit.id);
  const affordable = view.logistics >= unit.logistics;
  if (reason === null) {
    return { affordable, lock: null, capped: null, queue: queueFor(view, unit.id) };
  }
  const sentence = unit.unlock ? gateSentence(unit.unlock, ledger, missionName) : null;
  // The cap is the runtime's call (`popCapped` already puts the gate and the
  // camp first), but a gate that is still closed on this side of the wire wins
  // too: a lock is the more useful thing to read, and "pop full" on a unit the
  // campaign has not opened would be a second, wrong reason.
  if (sentence === null && view.popCapped?.(unit.id) === true) {
    return { affordable, lock: null, capped: { short: t('dock.cap.short'), full: capSentence(unit, view, true), title: capSentence(unit, view, false) }, queue: queueFor(view, unit.id) };
  }
  return {
    affordable,
    lock: { short: lockLabel(unit.unlock, ledger), full: sentence ?? reason },
    capped: null,
    queue: queueFor(view, unit.id),
  };
}

/**
 * The capped tile's full line, with the numbers (Q6). At the cap it is "A unit
 * must fall first."; with room left but not enough for THIS unit (11/12 and a
 * 2-population Eitan) it names what the unit needs. A view that says capped
 * without saying how full gets the short label's own words: the sim's English
 * (`population cap reached (...)`) never reaches the player by construction.
 */
function capSentence(unit: DockUnit, view: DockView, named: boolean): string {
  const pop = view.populationView?.() ?? null;
  if (pop === null) return t('dock.cap.short');
  if (pop.used < pop.cap) {
    const need = unit.population ?? 1;
    return named
      ? t('dock.cap.need', { used: pop.used, cap: pop.cap, name: unit.name, need })
      : t('dock.cap.needTitle', { used: pop.used, cap: pop.cap, need });
  }
  return t('dock.cap.full', { used: pop.used, cap: pop.cap });
}
