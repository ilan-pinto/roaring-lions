/**
 * Which sim events are bursts and nothing else (N1b follow-up, the quiet
 * catch-up). A seat that rejoins runs the room's whole log in a few seconds;
 * every tick of it is old, and a burst thrown for an old tick -- a muzzle
 * flash, a round in the air, a puff, a pulse -- is a flash of something that
 * happened minutes ago, thousands of them at once. `ThreeRenderer.setQuiet`
 * drops these kinds while it is on.
 *
 * Pure and `three`-free, like `fire-visible.ts`. The list is of kinds whose
 * ENTIRE effect in `onEvents` is a one-shot: nothing the world keeps is
 * written by them, so dropping them changes no later frame. The kinds that
 * leave something standing -- a death, a structure's damage or fall, a
 * route found or collapsed -- are NOT here; `onEvents` keeps their state and
 * quiets only the bursts inside them.
 */
export const BURST_ONLY_EVENT_KINDS: ReadonlySet<string> = new Set([
  'fire',
  'nearMiss',
  'submunition',
  'aps',
  'impact',
  'smokeLaid',
  // Not `strike` (GH-748): a fire-support round stamps a crater and a scorch,
  // which the world keeps, so `onStrike` runs while quiet and drops only its
  // bursts (`spawnSupportImpact`).
]);

export function isBurstOnlyEvent(kind: string): boolean {
  return BURST_ONLY_EVENT_KINDS.has(kind);
}
