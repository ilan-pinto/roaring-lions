/**
 * The battlefield's per-frame body with the default every Node caller (tests, the AI harness, the arena replay) has always
 * had: a step that carries no `dataDigest` folds `shippedContentDigest()`, this build's digest over the eager registry.
 * The body itself is `frame-run.ts` (B6-6), which the entry chunk takes instead: it imports no content, and `main.ts`
 * passes a room's digest at boot.
 */
import { shippedContentDigest } from './content-digest';
import { runFramesWith, type FrameStep } from './frame-run';

export { formationFielded, isHashTick, runFramesWith, seatWorldFor, type FrameSim, type FrameStep } from './frame-run';

/** `runFramesWith` with `shippedContentDigest()` as the own digest. */
export function runFrames(step: FrameStep, maxTicks: number): { ran: number; dropped: number } {
  return runFramesWith(step, maxTicks, shippedContentDigest);
}
