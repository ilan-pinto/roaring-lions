/**
 * A headless replay (GH-954 W3): a recorded game's frames run through the SAME `ReplayTransport` the replay page
 * uses, into a fresh sim built by the same `buildMatchWorld` the browser and the AI harness call, stepped by the same
 * `runFrames` body. Its result is the "watcher digest": what an independent sim that was handed only the file ends
 * in. The arena takes it when it writes a game's frames (`arena-frames.ts`) and the results view shows it beside
 * the referee's; the specs run it at several speeds to prove the speed changes nothing.
 *
 * The clock is a counter this function owns, advanced by `frameMs` a step: the transport only reads it to credit its
 * tick budget, so no wall time reaches the sim.
 */
import { denseFrames, type ReplayDigest, type ReplayFile } from '../../../packages/app/src/net/replay-file';
import { ReplayTransport, type ReplaySpeed } from '../../../packages/app/src/net/replay-transport';
import { runFrames, seatWorldFor } from '../../../packages/app/src/net/frame-step';
import { buildMatchWorld, matchTick } from '../../../packages/app/src/net/match-world';

export interface ReplayRunOptions {
  speed?: ReplaySpeed;
  /** The fake animation frame's length in ms; default 16. */
  frameMs?: number;
  /** The most ticks one frame may ask the transport for; default 4 (the battlefield's own floor). */
  perFrame?: number;
  /** Called after each animation frame with the ticks run so far: lets a spec look at the run mid-way. */
  onFrame?: (tick: number) => void;
}

/** The sim's tick and `sim.hash()` once every recorded frame has run. */
export function replayToEnd(file: ReplayFile, o: ReplayRunOptions = {}): ReplayDigest {
  const frameMs = o.frameMs ?? 16;
  const perFrame = o.perFrame ?? 4;
  const config = file.header.config;
  const w = buildMatchWorld(config);
  let clock = 0;
  const transport = new ReplayTransport(denseFrames(file), { now: () => clock, ...(o.speed === undefined ? {} : { speed: o.speed }) });
  const seatWorld = seatWorldFor(config, w.sim);
  // Nothing is hashed or acked: there is no room (`config: null`, as single-player).
  const step = { transport, sim: w.sim, seatWorld, runTick: () => { matchTick(w); }, config: null };
  while (transport.position < transport.total) {
    clock += frameMs;
    runFrames(step, perFrame);
    o.onFrame?.(w.sim.tickCount);
  }
  return { tick: w.sim.tickCount, hash: w.sim.hash() };
}
