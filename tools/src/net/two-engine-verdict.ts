// The decision half of `two-engine.ts`, kept apart so vitest can import it
// without pulling in playwright or booting a dev server. Nothing here touches
// a browser: it reads what each engine reported and says pass or fail.
//
// The check is network design §12's "two-engine determinism": Chromium,
// Firefox and WebKit boot the same sandbox, get the same orders at the same
// ticks, and must report the same `__lions.sim.hash()`. Since N2-P3 each
// engine also reports `__lions.contentDigest()` (ruling L4), and every one
// must equal the digest Node computes from the same checkout: the browser
// half of "the data digest is equal in browser and Node".

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
  /** `__lions.contentDigest()`: this engine's digest of the shipped content (L4). */
  contentDigest: number;
  /** N3 Task 8: the economy-room stream (`economy-stream.test-helper.ts`) played in
   *  this engine. Absent when the engine did not report one. */
  economy?: EconomyReading;
}

/** What one client of the economy-room stream reports: every hash-tick digest
 *  (sim, runtime and content folded), `built` per side, the dropped commands'
 *  ticks and the runtime commands accepted. The same fields Node computes. */
export interface EconomyReading {
  digests: [number, number][];
  built: [number, number];
  droppedTicks: number[];
  accepted: number;
}

/** The first hash tick at which `got` reports a different digest from `want`
 *  (or -1 when one ran more hash ticks than the other), or null when every one agrees. */
function firstDigestOff(want: readonly [number, number][], got: readonly [number, number][]): number | null {
  for (let i = 0; i < want.length; i++) {
    if (i >= got.length || got[i][0] !== want[i][0] || got[i][1] !== want[i][1]) return want[i][0];
  }
  return got.length === want.length ? null : -1;
}

/** N3 Task 8 (engine == Node): the first reading whose economy stream is absent
 *  or differs from the one Node played, as a FAIL message, or null. Per engine,
 *  like `contentMismatch`, so a lone booted engine is still held to Node. */
export function economyMismatch(
  results: Readonly<Record<string, EngineReading>>, nodeEconomy: EconomyReading,
): string | null {
  for (const [name, r] of Object.entries(results)) {
    const e = r.economy;
    if (e === undefined) return `FAIL: economy stream: ${name} reported no reading of it`;
    const off = firstDigestOff(nodeEconomy.digests, e.digests);
    if (off !== null) {
      return `FAIL: economy stream: ${name} reported a different digest from Node at hash tick ${off}` +
        ` (${name} ${JSON.stringify(e.digests.find(([t]) => t === off) ?? null)}, Node ${JSON.stringify(nodeEconomy.digests.find(([t]) => t === off) ?? null)})`;
    }
    if (e.built[0] !== nodeEconomy.built[0] || e.built[1] !== nodeEconomy.built[1]) {
      return `FAIL: economy stream: ${name} built ${JSON.stringify(e.built)} per side, Node ${JSON.stringify(nodeEconomy.built)}`;
    }
    if (JSON.stringify(e.droppedTicks) !== JSON.stringify(nodeEconomy.droppedTicks) || e.accepted !== nodeEconomy.accepted) {
      return `FAIL: economy stream: ${name} dropped ${JSON.stringify(e.droppedTicks)} and accepted ${e.accepted}, ` +
        `Node dropped ${JSON.stringify(nodeEconomy.droppedTicks)} and accepted ${nodeEconomy.accepted}`;
    }
  }
  return null;
}

export interface Verdict {
  ok: boolean;
  message: string;
}

/** L4 (browser == Node): the first reading whose content digest is not Node's,
 *  as a FAIL message, or null. `decide` calls it on every reading BEFORE its
 *  two-engine gate, so a lone booted engine is still held to Node's digest. */
export function contentMismatch(
  results: Readonly<Record<string, EngineReading>>, nodeContentDigest: number,
): string | null {
  const off = Object.entries(results).find(([, r]) => r.contentDigest !== nodeContentDigest);
  if (off === undefined) return null;
  return `FAIL: content digest: ${off[0]} computed ${off[1].contentDigest}, Node computed ${nodeContentDigest}: ${JSON.stringify(results)}`;
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
export function verdict(
  results: Readonly<Record<string, EngineReading>>, targetTick: number, firstOrderTick: number, nodeContentDigest: number,
  nodeEconomy?: EconomyReading,
): Verdict {
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
  // L4: every engine's content digest is Node's -- checked before the sim
  // hash, because two engines on different data have no hash worth comparing.
  const offContent = contentMismatch(results, nodeContentDigest);
  if (offContent !== null) return { ok: false, message: offContent };
  const hashes = new Set(readings.map((r) => r.hash));
  if (hashes.size !== 1) {
    return { ok: false, message: `FAIL: engines disagree: ${all}` };
  }
  // N3 Task 8: the economy stream, every engine against Node (so against each other too).
  if (nodeEconomy !== undefined) {
    const offEconomy = economyMismatch(results, nodeEconomy);
    if (offEconomy !== null) return { ok: false, message: offEconomy };
  }
  const last = nodeEconomy?.digests[nodeEconomy.digests.length - 1];
  const economy = nodeEconomy === undefined || last === undefined
    ? ''
    : `; economy stream: ${nodeEconomy.digests.length} hash ticks equal to Node's, final digest ${last[1]} at tick ${last[0]}, built ${JSON.stringify(nodeEconomy.built)}`;
  return {
    ok: true,
    message: `PASS: ${readings.length} engines, tick ${targetTick}, hash ${readings[0].hash}, content digest ${nodeContentDigest} (equal to Node's)${economy}`,
  };
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

/**
 * `required` names engines this runner is expected to boot (the tool's
 * `--require=`): for one of those, "could not launch / no WebGL2" is no longer
 * an environment finding but a FAILURE (exit 2), because the runner was set up
 * to provide it and a check that silently loses an engine judges less than it
 * says. An engine named in `required` that is missing from `outcomes`
 * altogether fails the same way. Engines not named keep R39's exit 3.
 */
export function decide(
  outcomes: Readonly<Record<string, EngineOutcome>>, targetTick: number, firstOrderTick: number, nodeContentDigest: number,
  required: readonly string[] = [], nodeEconomy?: EconomyReading,
): Decision {
  const lines: Decision['lines'] = [];
  const results: Record<string, EngineReading> = {};
  const unbootable: string[] = [];
  const broken: string[] = [];
  /** Required engines with no reading because they could not boot (or were never tried). */
  const missing: string[] = [];
  for (const name of required) {
    if (!(name in outcomes)) {
      missing.push(name);
      lines.push({ level: 'error', text: `FAIL (no reading): ${name} is required on this runner and was never tried.` });
    }
  }
  for (const [name, o] of Object.entries(outcomes)) {
    if (o.kind === 'reading') results[name] = o.reading;
    else if (o.kind === 'unbootable' && required.includes(name)) {
      missing.push(name);
      lines.push({ level: 'error', text: `FAIL (no reading): ${name} is required on this runner and could not boot: ${o.reason}` });
    } else if (o.kind === 'unbootable') {
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
  // The digest is per-engine, not per-pair: check it before the pair gate.
  const offContent = contentMismatch(results, nodeContentDigest);
  if (offContent !== null) return { exit: 1, lines: [...lines, { level: 'error', text: offContent }] };
  // N3 Task 8: likewise per engine -- the economy stream is held to Node's, not to a peer.
  const offEconomy = nodeEconomy === undefined ? null : economyMismatch(results, nodeEconomy);
  if (offEconomy !== null) return { exit: 1, lines: [...lines, { level: 'error', text: offEconomy }] };
  if (booted >= 2) {
    const v = verdict(results, targetTick, firstOrderTick, nodeContentDigest, nodeEconomy);
    if (!v.ok) return { exit: 1, lines: [...lines, { level: 'error', text: v.message }] };
    lines.push({ level: 'log', text: `${v.message} (${Object.keys(results).join(', ')})` });
  }
  if (broken.length > 0 || missing.length > 0) {
    if (broken.length > 0) lines.push({ level: 'error', text: `FAIL: ${broken.join(', ')} started and did not produce a reading.` });
    if (missing.length > 0) lines.push({ level: 'error', text: `FAIL: ${missing.join(', ')} required on this runner and produced no reading.` });
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
    return { exit: 1, lines: [...lines, { level: 'error', text: verdict(results, targetTick, firstOrderTick, nodeContentDigest).message }] };
  }
  return { exit: 0, lines };
}

/** The engines the tool knows, in the order it tries them. */
export const ENGINES = ['chromium', 'firefox', 'webkit'] as const;

export interface EngineArgs {
  /** `--require=a,b`: engines whose failure to boot is exit 2, not exit 3. */
  require: string[];
  /**
   * `--firefox-headed`: launch Firefox with a window. Firefox on a GPU-less
   * Linux runner with no X display creates no WebGL2 context at all, whatever
   * its prefs (measured 15 Oct 2026 in `mcr.microsoft.com/playwright:v1.64.0-noble`:
   * `null` with and without `webgl.force-enabled`). Under `xvfb-run` it gets
   * `llvmpipe` -- headed in that image and on CI, and headless too on CI: the
   * display is what matters. CI runs the tool under `xvfb-run` with this flag.
   */
  firefoxHeaded: boolean;
}

/** Reads the tool's own flags; `--port` and anything else belong to others. Throws on an unknown engine name. */
export function parseEngineArgs(argv: readonly string[]): EngineArgs {
  const out: EngineArgs = { require: [], firefoxHeaded: false };
  for (const a of argv) {
    if (a === '--firefox-headed') out.firefoxHeaded = true;
    else if (a.startsWith('--require=')) {
      const names = a.slice('--require='.length).split(',').map((n) => n.trim()).filter((n) => n !== '');
      const unknown = names.filter((n) => !(ENGINES as readonly string[]).includes(n));
      if (unknown.length > 0) throw new Error(`--require: unknown engine(s) ${unknown.join(', ')} (known: ${ENGINES.join(', ')})`);
      out.require.push(...names);
    }
  }
  return out;
}
