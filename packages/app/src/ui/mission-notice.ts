/**
 * How the narrative `MissionEvent` kinds (GDD §11 -- `removed`, `evacuated`)
 * are worded for the HUD notice feed, plus `triggerLabel`, which
 * `describeMissionEvent` shares with them, and `alertNotice`, the feed
 * wording for `alertsForTick`'s lines. `escapeHtml` used to live here too; it
 * is `escape-html.ts`'s now, the one copy for the whole UI (shell upgrade
 * Phase 3, Task 10).
 *
 * Split out of `describeMissionEvent` for the same reason `roe-notice.ts`
 * is (that file's own top comment): the interesting part is a wording
 * decision, not the switch that dispatches to it, so it belongs somewhere it
 * can be tested without a DOM, a sim, or a mission -- and, this time,
 * without importing `main.ts` at all, which would run its own top-level
 * `main().catch(...)` boot sequence the instant the module loaded.
 *
 * `say` used to be worded here too (`sayNotice`), echoing every commander
 * line into the feed a second time with its own attribution and its own 9s
 * clock, independent of the bar's beat-dwell timer. Task 5 (shell upgrade
 * Phase 0) made the commander bar the one surface for it --
 * `describeMissionEvent`'s `case 'say'` in `main.ts` now returns null, and
 * `sayNotice` is gone rather than left unreachable.
 *
 * No DOM, no Pixi, no sim state.
 */
import { t } from '../i18n/t';
import { distinctPlaces, type Place } from './alert-place';
import type { MissionEvent } from '@lions/sim';
import type { AlertLine, AlertTier } from './alerts';
import { escapeHtml } from './escape-html';
import type { Tone } from './hud';

/**
 * `removed`: a mission `remove` trigger took this entity off the board --
 * the enemy's act (an abduction), never a death, and the wording must never
 * suggest one (`Sim.removeFromPlay`'s own doc comment). `side` 2 is a
 * civilian (`MissionRuntime.spawnPlacement`'s own convention; pinned by the
 * sim's own doc comment on the `removed` MissionEvent, which names exactly
 * these two cases); anything else is a player unit. `unit` is the type id
 * verbatim -- the identical no-lookup convention the existing `built` case
 * already uses for the same field, not a display name.
 *
 * `n` is how many people the civilian line stands for. One by default; the
 * feed's own caller passes the count `CivilianFeed` folded (E4, below), so a
 * `remove` of a group of twelve reads as one "taken (12)" and not twelve
 * lines. A player unit is never folded: each is a different unit, named.
 */
export function removedNotice(side: number, unit: string, n = 1): [string, Tone] {
  return side === 2
    ? [t('notice.removed.civilian', { n }), 'bad']
    : [t('notice.removed.unit', { unit }), 'bad'];
}

/**
 * `evacuated`: a civilian reached the refuge and is off the board alive --
 * the exact mirror of `removedNotice`'s civilian case, and worded as one
 * deliberately. A rescue and an abduction are the two ways a civilian leaves
 * the field, the runtime distinguishes them on the way out rather than
 * making the renderer infer it (the sim's own doc comment on this event
 * says so), and the feed should read the same way: one line, a count,
 * opposite tone.
 *
 * Added 2026-09-07, and the gap it closes is not cosmetic. `evacuate_before`
 * is scored on every civilian who arrives, `describeMissionEvent` had no
 * case for this kind at all, and the `objective` case fires only on complete
 * or failed -- so a player watching an evacuation had NO feedback between
 * "the clock is running" and "the count landed". The arc that made it
 * unignorable is Khan Rafid, where `evacuate_before` is a primary in all
 * three missions on rising counts (`docs/campaign/khan_rafid/`): twelve
 * arrivals across the town with nothing said for any of them.
 *
 * The event carries `{ tick, entity }` and nothing else, because only a
 * civilian can evacuate -- there is no side to branch on the way
 * `removedNotice` must. `n` is the count `CivilianFeed` folded (E4).
 */
export function evacuatedNotice(n = 1): [string, Tone] {
  return [t('notice.evacuated', { n }), 'good'];
}

/**
 * Civilian drama E4 (GH-1438, `docs/campaign/civilian-drama.md` section 10.2,
 * N6): the merged feed line.
 *
 * A crowd mission moves 55 to 100 people through a refuge in a minute or
 * two, and the runtime says each one: an `evacuated` per arrival, a
 * `removed` side 2 per person a `remove` trigger takes. Worded one per event,
 * that is up to a hundred lines through a four-line feed. Here the two
 * civilian tallies -- "clear" (`evacuated`) and "taken" (`removed`, side 2)
 * -- are folded into one line per WINDOW (a second of the sim clock, 20
 * ticks): the window opens on the first event of its tally and closes
 * `windowTicks` later, and its line says how many people it held.
 *
 * Two refinements the bare window would miss, both measured against the
 * HUD as it stands (`hud.ts`'s `note`, `feed-model.ts`):
 *
 * - ONE STREAK, ONE SLOT. The feed already merges an IDENTICAL line into its
 *   twin with a count (WP-P5, PA-06), which is why "clear (1)" a hundred
 *   times reads today as one row, "clear (1) ×100". A per-second count
 *   differs from second to second ("clear (3)", "clear (2)", ...), so those
 *   lines would NOT merge, and a steady run would hold two or three of the
 *   four slots instead of one. So a line carries the STREAK's total -- every
 *   person of this tally since the streak began -- and names the total of
 *   the line it supersedes (`replaces`), which the caller takes back off the
 *   feed (`Hud.retireNote`). A streak ends when its tally is silent for
 *   `streakTicks` (8 s, the feed's own merge window, `FEED_MERGE_WINDOW_MS`):
 *   after that the old line has left or is about to, and a fresh arrival
 *   starts again at its own count, never at a stale total.
 * - THE FEED STAYS IN ORDER. Any other mission line (`describeMissionEvent`)
 *   closes every open window first, so "clear (12)" lands before the
 *   "OBJECTIVE COMPLETE" those twelve arrivals earned, and before the
 *   mission's end line.
 *
 * A `removed` of a PLAYER unit (any side but 2) is never folded: each names
 * its own unit, and it reaches `describeMissionEvent` as before.
 *
 * Presentation only: it reads the events the runtime already emitted and
 * writes nothing anywhere but its own fields (invariant 4). No DOM, no sim.
 */
export type CivilianTally = 'evacuated' | 'taken';

/** One folded line: what the feed says for one window of one tally. */
export interface CivilianLine {
  readonly tally: CivilianTally;
  /** People in this window. */
  readonly n: number;
  /** People in the whole streak, this window included: the count the line says. */
  readonly total: number;
  /** The total the streak's previous line said, which this one supersedes; 0
   *  when this line opens its streak (there is nothing to take back). */
  readonly replaces: number;
  /** The tick of the window's first event. */
  readonly tick: number;
}

/** A window is a second of the sim clock (invariant 1: 20 ticks a second). */
export const CIVILIAN_FEED_WINDOW_TICKS = 20;

/** A streak survives this long without an event of its tally: 8 s, which is
 *  `FEED_MERGE_WINDOW_MS` (`feed-model.ts`) on the sim clock. A test pins the two. */
export const CIVILIAN_STREAK_TICKS = 160;

/** The tally a mission event folds into, or null when it is not a civilian
 *  leaving the field. `removed` folds only for side 2. */
export function civilianTallyOf(e: MissionEvent): CivilianTally | null {
  if (e.kind === 'evacuated') return 'evacuated';
  if (e.kind === 'removed' && e.side === 2) return 'taken';
  return null;
}

interface OpenWindow {
  start: number;
  n: number;
  seq: number;
}

interface Streak {
  total: number;
  last: number;
}

export class CivilianFeed {
  private readonly open = new Map<CivilianTally, OpenWindow>();
  private readonly streaks = new Map<CivilianTally, Streak>();
  /** Windows already closed (an event of the same tally arrived after their
   *  end), waiting for the next `due` or `flush`. */
  private closed: { line: CivilianLine; seq: number }[] = [];
  private seq = 0;

  constructor(
    private readonly windowTicks: number = CIVILIAN_FEED_WINDOW_TICKS,
    private readonly streakTicks: number = CIVILIAN_STREAK_TICKS
  ) {}

  /** Folds a civilian event into its tally's window and returns true; returns
   *  false, and keeps nothing, for every other event. */
  take(e: MissionEvent): boolean {
    const tally = civilianTallyOf(e);
    if (tally === null) return false;
    let w = this.open.get(tally);
    if (w !== undefined && e.tick >= w.start + this.windowTicks) {
      this.close(tally, w);
      w = undefined;
    }
    if (w === undefined) {
      w = { start: e.tick, n: 0, seq: this.seq++ };
      this.open.set(tally, w);
    }
    w.n += 1;
    const streak = this.streaks.get(tally);
    if (streak !== undefined && e.tick - streak.last > this.streakTicks) streak.total = 0;
    if (streak === undefined) this.streaks.set(tally, { total: 0, last: e.tick });
    else streak.last = e.tick;
    return true;
  }

  /** The lines whose window has closed by `tick`, in the order the windows opened. */
  due(tick: number): CivilianLine[] {
    for (const [tally, w] of [...this.open]) {
      if (tick >= w.start + this.windowTicks) this.close(tally, w);
    }
    return this.drain();
  }

  /** Every window, open or closed, as a line now, in the order they opened. */
  flush(): CivilianLine[] {
    for (const [tally, w] of [...this.open]) this.close(tally, w);
    return this.drain();
  }

  private close(tally: CivilianTally, w: OpenWindow): void {
    this.open.delete(tally);
    // `take` made the streak before it could open a window, so it is there.
    const streak = this.streaks.get(tally) ?? { total: 0, last: w.start };
    const replaces = streak.total;
    streak.total += w.n;
    this.closed.push({ line: { tally, n: w.n, total: streak.total, replaces, tick: w.start }, seq: w.seq });
  }

  private drain(): CivilianLine[] {
    const out = this.closed.sort((a, b) => a.seq - b.seq).map((c) => c.line);
    this.closed = [];
    return out;
  }
}

/** One entry of the feed a run of mission events writes: a folded civilian
 *  line, or another event's own line. */
export type CivilianFeedEntry<L> = { civilian: CivilianLine } | { event: MissionEvent; line: L };

/**
 * The feed a run of mission events writes, as `main.ts`'s mission loop
 * writes it -- the one definition both follow, so the order and the counts
 * can be tested without the app. Per event: a civilian folds into its window
 * (`CivilianFeed.take`); any other is worded by `word` (`describeMissionEvent`
 * there), and a line it returns flushes every open window first. Between
 * ticks, the windows due by then are written; at the end of the run,
 * whatever is still open. `events` are in tick order, as the runtime emits
 * them.
 */
export function coalesceCivilianEvents<L>(
  events: readonly MissionEvent[],
  windowTicks: number = CIVILIAN_FEED_WINDOW_TICKS,
  word: (e: MissionEvent) => L | null = () => null,
  streakTicks: number = CIVILIAN_STREAK_TICKS
): CivilianFeedEntry<L>[] {
  const feed = new CivilianFeed(windowTicks, streakTicks);
  const out: CivilianFeedEntry<L>[] = [];
  const civilians = (lines: readonly CivilianLine[]): void => {
    for (const civilian of lines) out.push({ civilian });
  };
  let prev: number | null = null;
  for (const e of events) {
    // `main.ts` calls `due` at the end of every tick; one call for the ticks
    // since the last event writes the same lines, in the same order.
    if (prev !== null && e.tick !== prev) civilians(feed.due(e.tick - 1));
    prev = e.tick;
    const line = feed.take(e) ? null : word(e);
    if (line !== null) {
      civilians(feed.flush());
      out.push({ event: e, line });
    }
  }
  civilians(feed.flush());
  return out;
}

/** A folded line, worded: the same catalogue strings as one event's, with
 *  the streak's total, and the tier `missionEventTier` gives the event kind
 *  (`alerts.ts`: a taken civilian is `important`, an arrival is untiered). */
export function civilianLineNotice(line: CivilianLine): { html: string; tone: Tone; tier?: AlertTier } {
  return civilianNoticeOf(line.tally, line.total);
}

/** The line a streak's previous window put up, which `line` supersedes, or
 *  null when `line` opens its streak. Worded exactly as that line was, so the
 *  caller can take it back with `Hud.retireNote`. */
export function civilianLineReplaces(line: CivilianLine): { html: string; tone: Tone; tier?: AlertTier } | null {
  return line.replaces > 0 ? civilianNoticeOf(line.tally, line.replaces) : null;
}

/** What `writeCivilianLines` writes to: `Hud`'s `note` and `retireNote`. */
export interface CivilianFeedSink {
  note(html: string, tone: Tone, opts: { tier?: AlertTier }): void;
  retireNote(html: string, tone: Tone, opts: { tier?: AlertTier; fade?: boolean }): void;
}

/** Puts each folded line up, taking back first the line its streak put up
 *  before it (`civilianLineReplaces`): a steady run of arrivals is one feed
 *  row whose count climbs, never a column of rows. */
export function writeCivilianLines(sink: CivilianFeedSink, lines: readonly CivilianLine[]): void {
  for (const line of lines) {
    const old = civilianLineReplaces(line);
    // At once, not faded: the successor goes up in the same breath, and a
    // fading row would still hold a slot and push a live line off the feed.
    if (old) sink.retireNote(old.html, old.tone, { tier: old.tier, fade: false });
    const now = civilianLineNotice(line);
    sink.note(now.html, now.tone, { tier: now.tier });
  }
}

function civilianNoticeOf(tally: CivilianTally, n: number): { html: string; tone: Tone; tier?: AlertTier } {
  if (tally === 'evacuated') {
    const [html, tone] = evacuatedNotice(n);
    return { html, tone };
  }
  const [html, tone] = removedNotice(2, 'civilians', n);
  return { html, tone, tier: 'important' };
}

/** The label a mission authored for the trigger that just fired, or null when
 *  it authored none -- and then the player sees NOTHING, never an id. `id` is
 *  what the runtime emitted: the trigger's own id, or `trigger_<index>` when it
 *  has none (mission.ts's fallback). */
export function triggerLabel(
  mission: { triggers?: readonly { id?: string; label?: string }[] } | undefined,
  id: string
): string | null {
  const triggers = mission?.triggers ?? [];
  const byId = triggers.find((t) => t.id === id);
  if (byId) return byId.label ?? null;
  const m = /^trigger_(\d+)$/.exec(id);
  if (!m) return null;
  return triggers[Number(m[1])]?.label ?? null;
}

/**
 * An `alertsForTick` line (`alerts.ts`), worded for the feed. That model hands
 * back a catalogue key and its params and never calls `t()` -- its own header
 * says why -- so this is where the key is resolved, and where the authored
 * value it carries is escaped on its way into `hud.note`'s `innerHTML`.
 *
 * `alert.unitLost`'s `{name}` is a unit's display NAME from
 * `data/units/*.json`, free text the schema does not constrain. Every string
 * param is therefore treated as data and escaped, while the catalogue string
 * around it stays trusted markup -- its `<b>` is the point. Numbers pass
 * through untouched: a plural selects on them.
 *
 * Shell upgrade Phase 3, Task 10. This was `t(a.line.key, a.line.params)`
 * inline in `main.ts`'s tick loop, raw, where no test could reach it --
 * importing `main.ts` boots the app.
 */
export function alertNotice(line: AlertLine): [string, Tone] {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(line.params)) {
    params[key] = typeof value === 'string' ? escapeHtml(value) : value;
  }
  // WP-P5: the place, worded here and never by the model. `where` lets the
  // catalogue drop its own " · " when there is nowhere to name -- a line
  // with no place reads as it did, rather than ending on a dangling dot.
  if (line.place !== undefined) {
    const place = placePhrase(line.place);
    params.place = place;
    params.where = place === '' ? 'no' : 'yes';
  }
  return [t(line.key, params), line.tone];
}

/** Catalogue keys per place, spelled out so each one is a literal a grep
 *  (and `validate_i18n.mjs`) can find. */
const PLACE_KEY: Readonly<Record<Place, string>> = {
  here: 'alert.place.here',
  n: 'alert.place.n',
  ne: 'alert.place.ne',
  e: 'alert.place.e',
  se: 'alert.place.se',
  s: 'alert.place.s',
  sw: 'alert.place.sw',
  w: 'alert.place.w',
  nw: 'alert.place.nw',
};

/**
 * WP-P5: a list of places as one phrase -- "in view", "north-east",
 * "north-west and north-east", or "from several sides" once there are
 * three or more, which is what a wave entering on every face of the
 * compound is (First Light's first wave enters from five markers). Empty for
 * no place at all.
 */
export function placePhrase(places: readonly Place[]): string {
  const ps = distinctPlaces(places);
  if (ps.length === 0) return '';
  if (ps.length === 1) return t(PLACE_KEY[ps[0]]);
  if (ps.length === 2) return t('alert.place.two', { a: t(PLACE_KEY[ps[0]]), b: t(PLACE_KEY[ps[1]]) });
  return t('alert.place.many');
}

/**
 * WP-P5: a LABELLED `reinforce` trigger -- the player's own scripted
 * reinforcement (the tutorial's second squad, jeep and mortar). The alert
 * layer words these with where they arrive, so `describeMissionEvent` stands
 * down for exactly this set and the label is said once. An unlabelled one is
 * null here too: it shows nothing anywhere, as every unlabelled trigger does.
 */
export function reinforceTrigger<P>(
  mission: { triggers?: readonly { id?: string; label?: string; do: { kind: string; units?: readonly P[] } }[] } | undefined,
  id: string
): { label: string; units: readonly P[] } | null {
  const triggers = mission?.triggers ?? [];
  let def = triggers.find((tr) => tr.id === id);
  if (def === undefined) {
    const m = /^trigger_(\d+)$/.exec(id);
    if (m) def = triggers[Number(m[1])];
  }
  if (def === undefined || def.do.kind !== 'reinforce' || def.label === undefined) return null;
  return { label: def.label, units: def.do.units ?? [] };
}

/** Pass K: the note a free-play link earns when it names no shipped map --
 *  the boot still falls back to the default ground, and this says so, names
 *  the map shown instead, and says how to pick another. Null when the map exists (or the
 *  link named none). */
export function unknownSandboxMapNotice(
  requested: string | null,
  known: Readonly<Record<string, unknown>>,
  shownName: string,
): [string, Tone] | null {
  if (!requested || Object.hasOwn(known, requested)) return null;
  // The requested id is NOT echoed: it is a data id (PA-01's wording gate),
  // and the player gains nothing from reading their own typo back.
  return [t('main.note.sandboxMapUnknown', { name: escapeHtml(shownName) }), 'warn'];
}

/** Pass K: the victory line about the campaign save. "Saved" only when the
 *  write really landed -- a browser with no storage, or one that refused the
 *  write, says so and says how to keep the next one. */
export function ledgerSavedNotice(saved: boolean): [string, Tone] {
  return saved ? [t('main.note.ledgerUpdated'), 'info'] : [t('main.note.ledgerNotSaved'), 'bad'];
}
