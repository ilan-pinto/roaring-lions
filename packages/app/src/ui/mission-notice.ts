/**
 * How the narrative `MissionEvent` kinds (GDD §11 -- `removed`, `evacuated`)
 * are worded for the HUD notice feed, plus the two small string utilities
 * `describeMissionEvent` shares with them (`triggerLabel`, `escapeHtml`).
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

/** `describeMissionEvent` builds `innerHTML`, so any authored string landing
 *  as TEXT CONTENT between tags -- a trigger's `label` included -- must be
 *  escaped first. The same five-entity replace as the HTML spec's own
 *  minimal set, kept local to this module: `hud.ts` has its own escapers for
 *  its own two contexts (an attribute value, a callsign as text content) and
 *  neither is exported for a second module to share. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
