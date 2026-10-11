// The decision half of `two-engine.ts`, kept apart so vitest can import it
// without pulling in playwright or booting a dev server. Nothing here touches
// a browser: it reads what each engine reported and says pass or fail.
//
// The check is network design §12's "two-engine determinism": Chromium,
// Firefox and WebKit boot the same sandbox, get the same orders at the same
// ticks, and must report the same `__lions.sim.hash()`.

/** What one engine reported, read back off its page. */
export interface EngineReading {
  /** `__lions.sim.tickCount` before the order script stepped anything. */
  bootTick: number;
  /** `__lions.units().length` at boot: the KDF force the sandbox spawned. */
  bootUnits: number;
  /** `__lions.units(1).length` at boot: the hostile force. */
  bootHostiles: number;
  /** `__lions.sim.tickCount` after the script, and the hash read there. */
  tick: number;
  hash: number;
}

export interface Verdict {
  ok: boolean;
  message: string;
}

/**
 * Pass only when at least two engines reported, every one booted the same
 * forces no later than the first planned order, every one reached
 * `targetTick` exactly, and every hash is the same.
 *
 * Fewer than two readings FAIL rather than pass: one engine agrees with
 * itself whatever it computes, so a run that lost two of its three engines
 * would otherwise print PASS over a comparison that never happened.
 */
export function verdict(results: Readonly<Record<string, EngineReading>>, targetTick: number, firstOrderTick: number): Verdict {
  const all = JSON.stringify(results);
  const readings = Object.values(results);
  if (readings.length < 2) {
    return { ok: false, message: `FAIL: ${readings.length} engine(s) reported; a comparison needs at least two: ${all}` };
  }
  const late = Object.entries(results).filter(([, r]) => r.bootTick > firstOrderTick).map(([name]) => name);
  if (late.length > 0) {
    return {
      ok: false,
      message: `FAIL: boot not comparable: ${late.join(', ')} had already passed tick ${firstOrderTick} (the first order) before the script ran: ${all}`,
    };
  }
  const forces = new Set(readings.map((r) => `${r.bootUnits}/${r.bootHostiles}`));
  if (forces.size !== 1) {
    return { ok: false, message: `FAIL: boot not comparable: the engines spawned different forces (KDF/hostile): ${all}` };
  }
  if (readings.some((r) => r.tick !== targetTick)) {
    return { ok: false, message: `FAIL: an engine missed the target tick ${targetTick}: ${all}` };
  }
  const hashes = new Set(readings.map((r) => r.hash));
  if (hashes.size !== 1) {
    return { ok: false, message: `FAIL: engines disagree: ${all}` };
  }
  return { ok: true, message: `PASS: ${readings.length} engines, tick ${targetTick}, hash ${readings[0].hash}` };
}
