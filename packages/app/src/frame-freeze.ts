/**
 * The app-level frame-loop freeze (GH-943 P0, design section 4).
 *
 * The visual gate used to stop the loop by REPLACING the global `window.requestAnimationFrame` with a stub
 * (`capture-protocol.ts`'s `FREEZE_FRAME_LOOP_STATEMENTS`). On the node backend that is suspect: WebGPURenderer and the browser's
 * presentation path both expect a native rAF, and the L5 trial's invalid rows (CPU render 0) ran with the stub. This flag does the
 * same job without touching the global: the loop still re-arms through the NATIVE rAF every frame, but while the flag is up it
 * runs no tick and draws no frame, and holds the accumulator so nothing is owed when it comes down.
 *
 * Capture-only. Set by the harness (`window.__lionsFreezeLoop = true`, or `__lions.freezeLoop(true)`); nothing in the game sets it.
 * The sim is untouched: this gates when `loop()` runs the per-frame body, exactly as `paused` does, and ticks only advance
 * through `__lions.step`.
 */
export interface FreezeHost {
  __lionsFreezeLoop?: boolean;
}

/** True while a harness has frozen the frame loop. */
export function frameLoopFrozen(host: FreezeHost = globalThis as unknown as FreezeHost): boolean {
  return host.__lionsFreezeLoop === true;
}

/** Raises or lowers the freeze. Returns the new state. */
export function setFrameLoopFrozen(on: boolean, host: FreezeHost = globalThis as unknown as FreezeHost): boolean {
  host.__lionsFreezeLoop = on;
  return on;
}
