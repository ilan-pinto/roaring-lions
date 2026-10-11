// Chromium, Firefox and WebKit boot the same sandbox, receive the same order
// script at the same ticks through `__lions.sim.queueCommand`, step to the
// same tick with the frame loop frozen, and must report the same
// `__lions.sim.hash()` (network design §12, "two-engine determinism"). Every
// determinism run before this was V8; this is the first cross-engine reading.
//
// Run by CI's `visual` job (`pnpm net:engines -- --port=5183`), never locally:
// it boots a dev server and three browsers. What it decides lives in
// `two-engine-verdict.ts`, which `two-engine.test.ts` falsifies in `pnpm test`.
//
// Exit codes: 0 the engines agree; 1 they do not (or a boot was not
// comparable); 2 an engine could not boot the battlefield at all (no WebGL2,
// a boot-failure card, a timeout) -- named, and never reported as a hash.
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { BOOT_FREEZE_INIT_SCRIPT, FREEZE_FRAME_LOOP_STATEMENTS } from '../golden-diff/capture-protocol';
import { claimPort } from '../ui-review/port';
import { musicOffInitScript } from '../ui-review/music-off';
import { verdict, type EngineReading } from './two-engine-verdict';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const MAP = 'beit_sahwan_outskirts';
const TARGET_TICK = 600;
const TAG = 'two-engine';
const BOOT_TIMEOUT_MS = 180_000;

/** Orders by absolute tick, over the living side-0 units (ids read live, so
 *  every engine names the same entities). The same shape as `two-client.test.ts`. */
const PLAN = `{
  10: [{ kind: 'move', ids: a, x: fx(20.5), y: fx(20.5) }, { kind: 'move', ids: b, x: fx(26.5), y: fx(18.5) }],
  300: [{ kind: 'attackMove', ids: b, x: fx(30.5), y: fx(24.5) }, { kind: 'halt', ids: a }],
  450: [{ kind: 'attackMove', ids: a, x: fx(32.5), y: fx(22.5) }],
}`;
const FIRST_ORDER_TICK = 10;

/** Freezes the app's own loop (a no-op when the boot freeze already did) and
 *  reads the boot back BEFORE anything is stepped. */
const BOOT_SCRIPT = `(async () => {
${FREEZE_FRAME_LOOP_STATEMENTS}
const L = window.__lions;
return JSON.stringify({ tick: L.sim.tickCount, units: L.units(0).length, hostiles: L.units(1).length });
})()`;

/** Steps in CHUNKS -- one `__lions.step(n)` up to each planned tick, then that
 *  tick's orders -- because every `step` paints a frame, and a frame on a
 *  software-GL runner costs most of a second. A command queued at tick t runs
 *  inside the tick t -> t+1, exactly as a per-tick loop would queue it. */
const ORDER_SCRIPT = `(async () => {
const L = window.__lions;
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
return JSON.stringify({ tick: L.sim.tickCount, hash: L.sim.hash() });
})()`;

/** An engine that could not produce a reading. Exit 2, never a hash. */
class EngineBootError extends Error {}

async function waitForBattlefield(page: Page, name: string, pageErrors: readonly string[]): Promise<void> {
  // Asked first and on its own, so "this engine has no WebGL2 here" is said in
  // those words rather than as a timeout or a boot card.
  const webgl2 = (await page.evaluate(`!!document.createElement('canvas').getContext('webgl2')`)) as boolean;
  if (!webgl2) {
    throw new EngineBootError(
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
    throw new EngineBootError(`${name}: the battlefield did not boot within ${BOOT_TIMEOUT_MS / 1000} s.${errorsTail(pageErrors)}`);
  }
  const card = (await page.evaluate(`document.querySelector('.rl-boot-error')?.textContent ?? null`)) as string | null;
  if (card !== null) throw new EngineBootError(`${name}: the app showed its boot-failure card: "${card.trim()}".${errorsTail(pageErrors)}`);
}

function errorsTail(errors: readonly string[]): string {
  return errors.length > 0 ? `\n  page errors:\n  ${errors.slice(-10).join('\n  ')}` : ' (no page errors)';
}

async function reading(launch: () => Promise<Browser>, name: string, port: number): Promise<EngineReading> {
  let browser: Browser;
  try {
    browser = await launch();
  } catch (err) {
    throw new EngineBootError(`${name}: the browser did not launch: ${err instanceof Error ? err.message : String(err)}`);
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
    const boot = JSON.parse((await page.evaluate(BOOT_SCRIPT)) as string) as { tick: number; units: number; hostiles: number };
    console.log(`[${TAG}] ${name}: boot tick ${boot.tick}, ${boot.units} KDF unit(s), ${boot.hostiles} hostile`);
    const end = JSON.parse((await page.evaluate(ORDER_SCRIPT)) as string) as { tick: number; hash: number };
    console.log(`[${TAG}] ${name}: tick ${end.tick} hash ${end.hash}`);
    return { bootTick: boot.tick, bootUnits: boot.units, bootHostiles: boot.hostiles, tick: end.tick, hash: end.hash };
  } catch (err) {
    // Whatever broke (a lost context mid-step, a navigation timeout), it is
    // this engine's, and the message says which.
    if (err instanceof EngineBootError) throw err;
    throw new EngineBootError(`${name}: ${err instanceof Error ? err.message : String(err)}${errorsTail(pageErrors)}`);
  } finally {
    await browser.close();
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
    const results: Record<string, EngineReading> = {};
    for (const [name, launch] of engines) {
      try {
        results[name] = await reading(launch, name, port);
      } catch (err) {
        if (err instanceof EngineBootError) {
          console.error(`[${TAG}] FAIL (no reading): ${err.message}`);
          return 2;
        }
        throw err;
      }
    }
    const v = verdict(results, TARGET_TICK, FIRST_ORDER_TICK);
    (v.ok ? console.log : console.error)(`[${TAG}] ${v.message}`);
    return v.ok ? 0 : 1;
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
