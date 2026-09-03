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
