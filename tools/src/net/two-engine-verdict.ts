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

/**
 * How one engine's attempt ended. `unbootable` is an ENVIRONMENT finding --
 * the browser would not launch, or it launched and cannot create a WebGL2
 * context on this runner -- and says nothing about the sim's arithmetic.
 * `broken` is everything else that stopped an engine short of a reading (a
 * boot-failure card, a boot or script timeout, a context lost mid-step): the
 * engine did start, so what stopped it is a failure, named.
 */
export type EngineOutcome =
  | { kind: 'reading'; reading: EngineReading }
  | { kind: 'unbootable'; reason: string }
  | { kind: 'broken'; reason: string };

/**
 * The tool's exit code and what it prints (Ruling R39):
 * - 1: the engines that booted disagree, missed the tick, or booted forces
 *   that are not comparable. Always a hard failure, whatever else happened.
 * - 2: an engine started and then broke (a boot card, a timeout, a lost
 *   context): a failure, with the engine named.
 * - 3: an engine could not launch or create WebGL2. Each one gets a GitHub
 *   `::warning::` line; the engines that DID boot are still compared, and a
 *   run left with fewer than two says, in a warning, that it took no
 *   cross-engine reading at all. CI treats 3 as a pass with a warning.
 * - 0: every engine booted and they agree.
 */
export interface Decision {
  exit: 0 | 1 | 2 | 3;
  /** In order; `error` lines go to stderr, the rest (warnings included) to stdout. */
  lines: { level: 'log' | 'error'; text: string }[];
}

/** A GitHub workflow command's message must be one line: `%`, CR and LF are
 *  escaped as the runner expects, so a multi-line launch error stays one
 *  annotation instead of being cut at its first newline. */
export function annotationText(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function decide(
  outcomes: Readonly<Record<string, EngineOutcome>>, targetTick: number, firstOrderTick: number,
): Decision {
  const lines: Decision['lines'] = [];
  const results: Record<string, EngineReading> = {};
  const unbootable: string[] = [];
  const broken: string[] = [];
  for (const [name, o] of Object.entries(outcomes)) {
    if (o.kind === 'reading') results[name] = o.reading;
    else if (o.kind === 'unbootable') {
      unbootable.push(name);
      lines.push({
        level: 'log',
        text: `::warning title=${name} could not boot (three-engine check)::${annotationText(o.reason)}`,
      });
    } else {
      broken.push(name);
      lines.push({ level: 'error', text: `FAIL (no reading): ${o.reason}` });
    }
  }
  const booted = Object.keys(results).length;
  if (booted >= 2) {
    const v = verdict(results, targetTick, firstOrderTick);
    if (!v.ok) return { exit: 1, lines: [...lines, { level: 'error', text: v.message }] };
    lines.push({ level: 'log', text: `${v.message} (${Object.keys(results).join(', ')})` });
  }
  if (broken.length > 0) {
    lines.push({ level: 'error', text: `FAIL: ${broken.join(', ')} started and did not produce a reading.` });
    return { exit: 2, lines };
  }
  if (unbootable.length > 0) {
    if (booted < 2) {
      lines.push({
        level: 'log',
        text: `::warning title=No cross-engine reading::${annotationText(
          `Only ${booted} engine(s) booted (${unbootable.join(', ')} could not), so no cross-engine hash was compared on this run.`,
        )}`,
      });
    }
    return { exit: 3, lines };
  }
  if (booted < 2) {
    // Unreachable from the tool (every engine is a reading, unbootable or
    // broken), and refused rather than passed: one engine agrees with itself.
    return { exit: 1, lines: [...lines, { level: 'error', text: verdict(results, targetTick, firstOrderTick).message }] };
  }
  return { exit: 0, lines };
}
