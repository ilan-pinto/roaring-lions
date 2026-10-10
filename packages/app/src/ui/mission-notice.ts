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
import type { AlertLine } from './alerts';
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
 * No count is coalesced across entities here: each call describes exactly
 * one `removed` event, so a `civilians.groups` abduction of three reads as
 * three lines, each "taken (1)". Accepted per this task's own brief
 * ("otherwise one per entity") rather than threading tick-scoped state
 * through `main.ts`'s event loop for a rarer, cosmetic win.
 */
export function removedNotice(side: number, unit: string): [string, Tone] {
  return side === 2
    ? [t('notice.removed.civilian', { n: 1 }), 'bad']
    : [t('notice.removed.unit', { unit }), 'bad'];
}

/**
 * `evacuated`: a civilian reached the refuge and is off the board alive --
 * the exact mirror of `removedNotice`'s civilian case, and worded as one
 * deliberately. A rescue and an abduction are the two ways a civilian leaves
 * the field, the runtime distinguishes them on the way out rather than
 * making the renderer infer it (the sim's own doc comment on this event
 * says so), and the feed should read the same way: one line, a count of
 * one, opposite tone.
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
 * Takes no arguments on purpose. The event carries `{ tick, entity }` and
 * nothing else, because only a civilian can evacuate -- there is no side to
 * branch on the way `removedNotice` must. One line per civilian, not
 * coalesced across a tick, for the reason `removedNotice` gives at length:
 * threading tick-scoped state through `main.ts`'s event loop is not worth a
 * cosmetic win, and here the per-arrival beat is the point.
 */
export function evacuatedNotice(): [string, Tone] {
  return [t('notice.evacuated', { n: 1 }), 'good'];
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
  if (!requested || requested in known) return null;
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
