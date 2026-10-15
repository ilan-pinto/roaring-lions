// Chromium, Firefox and WebKit boot the same sandbox, receive the same order
// script at the same ticks through `__lions.sim.queueCommand`, step to the
// same tick with the frame loop frozen, and must report the same
// `__lions.sim.hash()` (network design §12, "two-engine determinism") -- and
// the same `__lions.contentDigest()` as Node computes here (L4). Every
// determinism run before this was V8; this is the first cross-engine reading.
//
// Run by CI's `visual` job (`pnpm net:engines -- --port=5183`), never locally:
// it boots a dev server and three browsers. What it decides lives in
// `two-engine-verdict.ts`, which `two-engine.test.ts` falsifies in `pnpm test`.
//
// Exit codes (Ruling R39, decided in `two-engine-verdict.ts`'s `decide`):
// 0 every engine booted and they agree; 1 the engines that booted disagree,
// missed the tick, or booted incomparable forces; 2 an engine started and then
// broke (a boot-failure card, a boot or script timeout, a lost context) or the
// tool itself failed; 3 an engine could not LAUNCH or create a WebGL2 context
// on this runner -- an environment finding, printed as a `::warning::` per
// engine, with the engines that did boot still compared. CI passes exit 3.
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { BOOT_FREEZE_INIT_SCRIPT, FREEZE_FRAME_LOOP_STATEMENTS } from '../golden-diff/capture-protocol';
import { claimPort } from '../ui-review/port';
import { musicOffInitScript } from '../ui-review/music-off';
import { decide, type EngineOutcome, type EngineReading } from './two-engine-verdict';
import { shippedContentDigest } from '../../../packages/app/src/net/content-digest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const MAP = 'beit_sahwan_outskirts';
const TARGET_TICK = 600;
const TAG = 'two-engine';
const BOOT_TIMEOUT_MS = 180_000;
/** Per-engine guards, so a software-GL hang fails NAMING the engine instead of
 *  holding the job until the step's own timeout. The order script is four
 *  `step` calls and four paints; at the 0.5-0.9 s a SwiftShader frame costs
 *  (CLAUDE.md) that is seconds, so two minutes is a hang guard, not a budget. */
const PROBE_TIMEOUT_MS = 30_000;
const SCRIPT_TIMEOUT_MS = 120_000;
const CLOSE_TIMEOUT_MS = 30_000;

/** Orders by absolute tick, over the living side-0 units (ids read live, so
 *  every engine names the same entities). The same shape as `two-client.test.ts`. */
const PLAN = `{
  10: [{ kind: 'move', ids: a, x: fx(20.5), y: fx(20.5) }, { kind: 'move', ids: b, x: fx(26.5), y: fx(18.5) }],
  300: [{ kind: 'attackMove', ids: b, x: fx(30.5), y: fx(24.5) }, { kind: 'halt', ids: a }],
  450: [{ kind: 'attackMove', ids: a, x: fx(32.5), y: fx(22.5) }],
}`;
const FIRST_ORDER_TICK = 10;

/** Freezes the app's own loop (a no-op when the boot freeze already did) and
 *  reads the boot FORCES (KDF and hostile unit counts) for the verdict's
 *  "boot not comparable" check. Its tick is only logged: the verdict's boot
 *  tick is `ORDER_SCRIPT`'s own `start`, read in the same evaluate that steps. */
const BOOT_SCRIPT = `(async () => {
${FREEZE_FRAME_LOOP_STATEMENTS}
const L = window.__lions;
return JSON.stringify({ tick: L.sim.tickCount, units: L.units(0).length, hostiles: L.units(1).length });
})()`;

/** Reads the tick it STARTS at -- the verdict's boot tick, so a boot freeze
 *  that failed in one engine reads as "boot not comparable", not as a hash
 *  disagreement. Steps in CHUNKS -- one `__lions.step(n)` up to each planned tick, then that
 *  tick's orders -- because every `step` paints a frame, and a frame on a
 *  software-GL runner costs most of a second. A command queued at tick t runs
 *  inside the tick t -> t+1, exactly as a per-tick loop would queue it. */
const ORDER_SCRIPT = `(async () => {
const L = window.__lions;
const start = L.sim.tickCount;
const fx = (v) => Math.round(v * 65536);
const ids = L.units(0).map((u) => u.id);
const half = Math.ceil(ids.length / 2);
const a = ids.slice(0, half), b = ids.slice(half);
const plan = ${PLAN};
const ticks = Object.keys(plan).map(Number).sort((p, q) => p - q);
for (const t of ticks) {
  if (L.sim.tickCount < t) L.step(t - L.sim.tickCount);
  for (const c of plan[t]) L.sim.queueCommand(c);
}
if (L.sim.tickCount < ${TARGET_TICK}) L.step(${TARGET_TICK} - L.sim.tickCount);
return JSON.stringify({ start, tick: L.sim.tickCount, hash: L.sim.hash(), contentDigest: L.contentDigest() });
})()`;

/** An engine that could not launch, or cannot create WebGL2 here: an
 *  environment finding (exit 3, a warning), never a hash. */
class EngineUnbootable extends Error {}
/** An engine that started and then failed to produce a reading (exit 2). */
class EngineBroken extends Error {}
/** A guarded call that hung: broken, and the page's errors are appended. */
class EngineTimeout extends EngineBroken {}

/** Settles with `p`, or rejects with an `EngineTimeout` naming `what` after `ms`. */
async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  // The abandoned call still settles later (a hung evaluate rejects when its
  // browser is closed); handled here, or Node ends the process on it.
  p.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EngineTimeout(`${what} did not return within ${ms / 1000} s`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForBattlefield(page: Page, name: string, pageErrors: readonly string[]): Promise<void> {
  // Asked first and on its own, so "this engine has no WebGL2 here" is said in
  // those words rather than as a timeout or a boot card.
  const webgl2 = (await within(
    page.evaluate(`!!document.createElement('canvas').getContext('webgl2')`),
    PROBE_TIMEOUT_MS,
    `${name}: the WebGL2 probe`,
  )) as boolean;
  if (!webgl2) {
    throw new EngineUnbootable(
      `${name}: headless ${name} on this runner cannot create a WebGL2 context, so the battlefield cannot boot and there is no hash to compare. ` +
        `That is a finding about ${name} on this runner, not a determinism result.`
    );
  }
  try {
    await page.waitForFunction(
      `typeof window.__lions !== 'undefined' || document.querySelector('.rl-boot-error') !== null`,
      undefined,
      { timeout: BOOT_TIMEOUT_MS }
    );
  } catch {
    throw new EngineBroken(`${name}: the battlefield did not boot within ${BOOT_TIMEOUT_MS / 1000} s.${errorsTail(pageErrors)}`);
  }
  const card = (await within(
    page.evaluate(`document.querySelector('.rl-boot-error')?.textContent ?? null`),
    PROBE_TIMEOUT_MS,
    `${name}: the boot-card read`,
  )) as string | null;
  if (card !== null) throw new EngineBroken(`${name}: the app showed its boot-failure card: "${card.trim()}".${errorsTail(pageErrors)}`);
}

function errorsTail(errors: readonly string[]): string {
  return errors.length > 0 ? `\n  page errors:\n  ${errors.slice(-10).join('\n  ')}` : ' (no page errors)';
}

async function reading(launch: () => Promise<Browser>, name: string, port: number): Promise<EngineReading> {
  let browser: Browser;
  try {
    browser = await launch();
  } catch (err) {
    throw new EngineUnbootable(`${name}: the browser did not launch: ${err instanceof Error ? err.message : String(err)}`);
  }
  const pageErrors: string[] = [];
  try {
    console.log(`[${TAG}] ${name} ${browser.version()}`);
    const page = await browser.newPage();
    page.on('pageerror', (err) => pageErrors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(`console.error: ${msg.text()}`);
    });
    await page.addInitScript(musicOffInitScript());
    // Drops the loop's first arm, so nothing ticks before the script does and
    // every engine starts from tick 0 (`capture-protocol.ts`).
    await page.addInitScript(BOOT_FREEZE_INIT_SCRIPT);
    await page.goto(`http://localhost:${port}/free-play/${MAP}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await waitForBattlefield(page, name, pageErrors);
    const boot = JSON.parse((await within(page.evaluate(BOOT_SCRIPT), PROBE_TIMEOUT_MS, `${name}: the boot read`)) as string) as {
      tick: number; units: number; hostiles: number;
    };
    console.log(`[${TAG}] ${name}: boot tick ${boot.tick}, ${boot.units} KDF unit(s), ${boot.hostiles} hostile`);
    const end = JSON.parse((await within(page.evaluate(ORDER_SCRIPT), SCRIPT_TIMEOUT_MS, `${name}: the order script`)) as string) as {
      start: number; tick: number; hash: number; contentDigest: number;
    };
    console.log(`[${TAG}] ${name}: orders from tick ${end.start}; tick ${end.tick} hash ${end.hash}; content digest ${end.contentDigest}`);
    return { bootTick: end.start, bootUnits: boot.units, bootHostiles: boot.hostiles, tick: end.tick, hash: end.hash, contentDigest: end.contentDigest };
  } catch (err) {
    // Whatever broke (a lost context mid-step, a navigation timeout), it is
    // this engine's, and the message says which.
    if (err instanceof EngineTimeout) throw new EngineBroken(`${err.message}.${errorsTail(pageErrors)}`);
    if (err instanceof EngineUnbootable || err instanceof EngineBroken) throw err;
    throw new EngineBroken(`${name}: ${err instanceof Error ? err.message : String(err)}${errorsTail(pageErrors)}`);
  } finally {
    // A close that hangs is reported and abandoned, never awaited forever:
    // the reading (or the failure) above stands, and `exitWith` ends the
    // process whatever the browser still holds.
    try {
      await within(browser.close(), CLOSE_TIMEOUT_MS, `${name}: browser.close()`);
    } catch (err) {
      console.error(`[${TAG}] ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function main(): Promise<number> {
  const port = await claimPort(TAG, 'NET_ENGINES_PORT', 5183);
  const server = await ensureDevServer(port, REPO, TAG);
  try {
    const engines: [string, () => Promise<Browser>][] = [
      ['chromium', () => chromium.launch()],
      // Headless Firefox may blocklist WebGL on a GPU-less Linux runner; the
      // pref lifts that. This check is about the sim's arithmetic, not about
      // which GPUs Firefox trusts.
      ['firefox', () => firefox.launch({ firefoxUserPrefs: { 'webgl.force-enabled': true } })],
      ['webkit', () => webkit.launch()],
    ];
    const outcomes: Record<string, EngineOutcome> = {};
    // Every engine is tried even after one fails to boot: a first run on a
    // new runner should say which of the three cannot draw, not just the first.
    for (const [name, launch] of engines) {
      try {
        outcomes[name] = { kind: 'reading', reading: await reading(launch, name, port) };
      } catch (err) {
        if (err instanceof EngineUnbootable) outcomes[name] = { kind: 'unbootable', reason: err.message };
        else if (err instanceof EngineBroken) outcomes[name] = { kind: 'broken', reason: err.message };
        else throw err;
      }
    }
    // L4: the digest of this checkout's content as NODE computes it, which
    // every engine's `__lions.contentDigest()` must equal.
    const nodeContent = shippedContentDigest();
    console.log(`[${TAG}] node ${process.version}: content digest ${nodeContent}`);
    const d = decide(outcomes, TARGET_TICK, FIRST_ORDER_TICK, nodeContent);
    // A `::warning::` line must START the line for the runner to read it, so
    // it is printed bare; everything else carries the tag.
    for (const { level, text } of d.lines) {
      const line = text.startsWith('::') ? text : `[${TAG}] ${text}`;
      if (level === 'error') console.error(line);
      else console.log(line);
    }
    return d.exit;
  } finally {
    stopDevServer(server, TAG);
  }
}

/** The script must EXIT: a live handle left by a browser or the dev server's
 *  pipes would hold the event loop open and bill CI for the wait. Flushes
 *  stdout first (piped on CI), as `ci/three-baseline-gate.ts`'s own does. */
function exitWith(code: number): void {
  process.exitCode = code;
  const timer = setTimeout(() => process.exit(code), 2_000);
  timer.unref();
  process.stdout.write('', () => process.exit(code));
}

main().then(exitWith, (err: unknown) => {
  console.error(`[${TAG}]`, err);
  exitWith(2);
});
