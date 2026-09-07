/**
 * How the two new narrative `MissionEvent` kinds (GDD §11 -- `say`,
 * `removed`) are worded for the HUD notice feed.
 *
 * Split out of `describeMissionEvent` for the same reason `roe-notice.ts`
 * is (that file's own top comment): the interesting part is a wording
 * decision, not the switch that dispatches to it, so it belongs somewhere it
 * can be tested without a DOM, a sim, or a mission -- and, this time,
 * without importing `main.ts` at all, which would run its own top-level
 * `main().catch(...)` boot sequence the instant the module loaded.
 *
 * No DOM, no Pixi, no sim state.
 */
import type { Tone } from './hud';

/**
 * `say`: a radio line. Attributed by initials in the feed -- the bar shows
 * the fuller plate instead (`hud-model.ts`'s `speakerPlate`), which is the
 * one place a lookup into `commander.json` happens at all. `shai`/`idit`/
 * `net` are named literally, uppercased, straight off the event's own
 * `speaker` field: a `<b>SHAI</b>` in a fast-scrolling feed is exactly as
 * legible as a full name and needs no data this function does not already
 * have. `enemy` gets no name at all -- an intercepted transmission from an
 * unidentified source reads as more unsettling than a label would, and it is
 * the one case that reads as a warning rather than plain narration.
 */
export function sayNotice(speaker: string, text: string): [string, Tone] {
  if (speaker === 'enemy') return [`<b>—</b> ${text}`, 'warn'];
  return [`<b>${speaker.toUpperCase()}</b> — ${text}`, 'info'];
}

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
  return side === 2 ? ['<b>taken</b> (1)', 'bad'] : [`${unit} <b>taken</b>`, 'bad'];
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
  return ['<b>clear</b> (1)', 'good'];
}
