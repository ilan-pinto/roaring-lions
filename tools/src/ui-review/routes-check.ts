// The route walk: one JS realm, two missions, no reload, nothing left behind.
//
// Usage: pnpm ui:routes [-- --port=<n>]
//                            (starts its own dev server, like ui:shots, and
//                            stops the one it started; the port is --port=<n>,
//                            else UI_ROUTES_PORT, else 5177, and a port that
//                            something else already holds is refused, exit 2)
//
// This is the reference-free half of Task 2. It never asks what the app LOOKS
// like -- the golden gate does that, against a blessed picture -- it asks
// whether leaving a mission actually ends it. Four questions, none of which
// needs a baseline to answer:
//
//   1. Did the page RELOAD? `main()` marks `rl:boot` once per document, so a
//      count above 1 after an in-app click means a navigation went through the
//      network instead of the router. This is the one question a screenshot
//      can never answer: a reloaded app and a routed one draw the same frame.
//   2. Is `window.__lions` gone after a leave? It is defined by the battlefield
//      and by nothing else, so its presence on the campaign screen means a
//      mission is still mounted behind the one the player can see.
//   3. Is `document.body` back to the child count it had at the menu? The HUD's
//      six panes, the minimap, the debug overlay's two panes and the selection
//      marquee all mount on the BODY, not on the stage the router clears, so
//      this counts precisely the things no router could have taken down.
//   4. Does a SECOND mission, booted softly in the same realm, tick? A teardown
//      that is too enthusiastic passes 1-3 and leaves the next mission dead.
//
// Plus: any console error or page error at all fails the run, and so does a
// console WARNING about the WebGL context, the loaders, the decoder worker or
// the scene host itself in the window after any of the three scene-host leaves
// -- live, mid-load and mid-construct (`expectQuietLeave`). A frame loop
// that survives its own renderer is NOT caught that way any more: it used to
// draw into a disposed context and say so in the console, but
// `ThreeRenderer.frame()` now refuses once disposed, so its draws are silent.
// What catches it is the left mission's tick counter, read twice after the
// leave below -- a loop still running is still calling `runTick()`.
//
// Plus (GH-254): any request at all to the telemetry ingest path, `/api/events`,
// from any context the walk opens fails the run. A dev or CI run must send
// nothing; `telemetryEnabled` says so, and this is the run agreeing with it
// end to end. Its own message names the requests, so it does not rest on the
// console rule catching the dev server's 404.
//
// Seen red: with `onDispose(() => cancelAnimationFrame(rafId))` commented out
// of `bootBattlefield`, this exits 1. The output of both runs is in this
// task's report.

import { chromium, type ConsoleMessage, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dismissDeployGate, ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { boardCanvasVerdict } from './board-canvases';
import { ACCOUNT_KEY } from '../../../packages/app/src/brigade-account';
import { garageSeedScript, GARAGE_SEED_ACCOUNT } from './garage-seed';
import { claimPort } from './port';
import { watchTelemetry } from './telemetry-guard';
import { kitIconFailures, type IconRead } from './kit-icons';
import { SANDBOX_KIT_LEVELS } from '../../../packages/app/src/sandbox-force';
import { kitLevel, units, type UpgradableUnit } from '@lions/data';
import { PLACEHOLDER_HZ } from '../../../packages/render/src/audio';
import { VOICE_TIMING } from '../../../packages/app/src/voice/director';
import { musicOffInitScript } from './music-off';
import { BRIEFING_REACH_SCRIPT, briefingReachProblems, type BriefingReach } from './briefing-reach';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

const TAG = 'ui-routes';
/** Its own DEFAULT port, so a run never fights `ui:shots` (5176) or the golden
 *  gate (5175) on CI. Locally 5177 is also the lead's everyday dev server, and
 *  before `claimPort` a walk started while it was up attached to it and walked
 *  THAT checkout, green, with no error; now it is refused and
 *  `--port=`/`UI_ROUTES_PORT` pick another. */
const DEFAULT_PORT = 5177;
const PORT = await claimPort(TAG, 'UI_ROUTES_PORT', DEFAULT_PORT);

/**
 * Per-action hang guard, sized from a measurement and not a threshold: nothing
 * the walk asserts is a duration. Headless Chromium has no GPU, so a live
 * mission draws through SwiftShader -- the soft-booted `beit_sahwan_breach`
 * measured 476-592 ms mean / 820-922 ms max per frame on an M-series Mac
 * (`frameCadence` below prints it every run), and a Playwright click is five
 * round-trips into that thread: resolve, the visible/enabled/stable check (two
 * frames by definition), scroll, hit-test, dispatch. One click cost 4.8-7.5 s
 * here, and the same leave leg took 29-40 s on CI. Playwright's 30 s default
 * therefore failed the FIRST run on main (35317801475: the leave click of the
 * soft-booted mission, 166 s into the walk) and passed the second (35317980642,
 * 132 s), on the same tree a docs-only diff apart. 120 s is ~4x the slowest
 * CI click seen and still bounds a genuine hang to a couple of minutes.
 */
const ACTION_TIMEOUT_MS = 120_000;

/** Two shipped missions on two different maps, so the second boot exercises a
 *  fresh terrain/mesh load rather than re-reading what the first one warmed. */
const MISSION_A = 'beit_sahwan_1_recon';
const MISSION_B = 'tel_marum_1_recon';

interface Probe {
  /** `performance.mark('rl:boot')` count -- 1 per document, ever. */
  boots: number;
  lions: boolean;
  tick: number | null;
  bodyChildren: number;
  /** The body-mounted battlefield chrome, by name, for a readable failure. */
  leftovers: string[];
  /** Every `<canvas>` in the document. A battlefield draws into one and the
   *  campaign diorama into another, so this is how an abandoned renderer that
   *  no DOM count can see gets counted. */
  canvases: number;
  /** `.rl-world`'s own `data-board` -- `'diorama'` or `'flat'` -- or `null`
   *  off the campaign board. Read back, never inferred from `canvases`. */
  board: string | null;
}

/** Everything a battlefield mounts on `document.body` that has a stable class:
 *  the HUD's strip and banner, the minimap, the selection marquee, the
 *  reinforcement dock (`resources` missions only) and a title card still
 *  holding. The debug overlay's two panes are styled inline and have no class,
 *  so they are covered by the body-child COUNT rather than by name -- which is
 *  why both checks are here and neither is redundant. */
const BODY_CHROME = [
  '.rl-strip',
  '.rl-minimap',
  '.rl-marquee',
  '.rl-bigbanner',
  '.rl-titlecard',
  '.rl-dock',
];

async function probe(page: Page): Promise<Probe> {
  return page.evaluate((chrome: string[]) => {
    const w = window as unknown as { __lions?: { sim: { tickCount: number } } };
    const wrap = document.querySelector('.rl-world');
    return {
      boots: performance.getEntriesByName('rl:boot').length,
      lions: w.__lions !== undefined,
      tick: w.__lions ? w.__lions.sim.tickCount : null,
      bodyChildren: document.body.children.length,
      leftovers: chrome.filter((sel) => document.querySelector(sel) !== null),
      canvases: document.querySelectorAll('canvas').length,
      board: wrap instanceof HTMLElement ? (wrap.dataset.board ?? null) : null,
    };
  }, BODY_CHROME);
}

/**
 * Wait for the campaign board to reach its own verdict: the diorama's canvas
 * in `.rl-world__canvas`, or `data-board="flat"`. `true` if it did.
 *
 * `.rl-world` being on the page does NOT mean the board has drawn. The diorama
 * appends its canvas only once `mountWorldView` has taken a dynamic import and
 * a ~3.8 MiB Draco GLB -- 190-363 ms after `.rl-world` landed, measured
 * locally off the deploy screen -- so a canvas count taken on `.rl-world`
 * alone is a count of a board still mounting. This is the golden gate's own
 * `checkCampaignBoard` condition (`golden-diff/screens-check.ts`), for the
 * same reason. See `board-canvases.ts` for what it cost when it was missing.
 */
async function settleBoard(page: Page): Promise<boolean> {
  return page
    .waitForFunction(
      () => {
        const wrap = document.querySelector('.rl-world');
        return (
          wrap instanceof HTMLElement &&
          (wrap.dataset.board === 'flat' || document.querySelector('.rl-world__canvas canvas') !== null)
        );
      },
      null,
      { timeout: 60_000 }
    )
    .then(() => true)
    .catch(() => false);
}

/**
 * How fast the page is drawing, printed rather than gated. This is the number
 * `ACTION_TIMEOUT_MS` is sized from, and a run whose frames suddenly read 3 s
 * says why the walk got slow before anything times out. Two seconds of
 * `requestAnimationFrame` plus the sim ticks that landed inside them. A string
 * script on purpose: tsx compiles a function's inner arrow with a `__name`
 * helper the page does not have, and the walk died on it.
 */
async function frameCadence(page: Page, where: string): Promise<void> {
  const st = await page.evaluate<{ n: number; ms: number; max: number; ticks: number }>(
    '(() => new Promise((res) => {' +
      ' const w = window; const tick0 = w.__lions ? w.__lions.sim.tickCount : 0;' +
      ' let n = 0; let max = 0; const t0 = performance.now(); let last = t0;' +
      ' const f = () => { const now = performance.now(); max = Math.max(max, now - last); last = now; n += 1;' +
      ' if (now - t0 < 2000) requestAnimationFrame(f);' +
      ' else res({ n, ms: now - t0, max, ticks: (w.__lions ? w.__lions.sim.tickCount : 0) - tick0 }); };' +
      ' requestAnimationFrame(f); }))()'
  );
  console.log(
    `[${TAG}] frame cadence in ${where}: ${st.n} frames / ${st.ms.toFixed(0)} ms` +
      ` (mean ${(st.ms / st.n).toFixed(0)} ms, max ${st.max.toFixed(0)} ms), ${st.ticks} sim ticks`
  );
}

/**
 * Escape off the deploy screen, retried until the screen is actually gone.
 *
 * A single press does not work, and the reason is the deploy gate's own trap
 * (CLAUDE.md, the visual gate): the `keydown` listener that Escape needs is
 * registered INSIDE `loading.done()`, and `done()` is not called until the art
 * gate above it has settled -- so `.rl-loading__deploy` being on the page does
 * NOT mean anything is listening yet, and a press before that is silently lost
 * with no second chance. `dismissDeployGate` solved the same problem for the
 * button by clicking every 250 ms; this does it for the key, and REPORTS the
 * count, because a run that needed one press and a run that needed nine are
 * different facts about the boot.
 */
async function pressEscapeUntilGone(page: Page, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  let presses = 0;
  for (;;) {
    if ((await page.$('.rl-loading')) === null) {
      console.log(
        `[${TAG}] deploy screen left by Escape after ${Date.now() - started} ms and ${presses} press(es)` +
          `${presses > 1 ? ` -- ${presses - 1} landed before done() attached its listener and were lost` : ''}`
      );
      return;
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`[${TAG}] the deploy screen did not respond to Escape in ${timeoutMs} ms`);
    }
    await page.keyboard.press('Escape');
    presses += 1;
    await page.waitForTimeout(250);
  }
}

const failures: string[] = [];
const expect = (cond: boolean, msg: string): void => {
  if (!cond) failures.push(msg);
};

const devServer = await ensureDevServer(PORT, REPO_ROOT, TAG);
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  browser = await chromium.launch();
  // GH-254: the off switch, proved by the run. Every context this walk opens
  // is watched for a request to the telemetry ingest path, through ONE wrapper
  // on `newContext` rather than an edit at each of its call sites below, so a
  // context added later is watched without anyone remembering to.
  const telemetryHits: string[] = [];
  const origNewContext = browser.newContext.bind(browser);
  const newContext: typeof browser.newContext = async (...a) => {
    const c = await origNewContext(...a);
    watchTelemetry(c, telemetryHits);
    // music-off: every context -- this wrapper seeds the lead's music-off
    // default (`music-off.ts`) into every context the walk opens.
    await c.addInitScript(musicOffInitScript());
    return c;
  };
  browser.newContext = newContext;
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  // `newPage` makes its own context. Playwright 1.62 builds it through
  // `this.newContext`, so the wrapper already sees it; this line does not rely
  // on that, and `watchTelemetry` is idempotent per context.
  watchTelemetry(page.context(), telemetryHits);
  await page.context().addInitScript(musicOffInitScript());
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  const started = Date.now();
  const at = (): string => `${((Date.now() - started) / 1000).toFixed(1)} s`;

  // Question 1's real oracle. `rl:boot` is a `performance.mark`, and the
  // performance timeline is per DOCUMENT: a page that reloaded reads 1 just
  // like one that did not, so `boots` alone can only catch `main()` running
  // TWICE in one document. The harness counts documents itself -- every
  // `load` event is a new one, and only the four hard `page.goto`s below may
  // make one. Seen red: a `page.reload()` injected after leaving mission A
  // fails "leaving mission A" with 3 documents against the 2 expected.
  let documents = 0;
  page.on('load', () => {
    documents += 1;
  });
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) console.log(`[${TAG}] ${at()} navigated: ${new URL(f.url()).pathname}${new URL(f.url()).search}`);
  });
  const expectDocuments = (n: number, where: string): void =>
    expect(
      documents === n,
      `${where}: ${documents} document(s) loaded, expected ${n} -- a navigation went through the network`
    );
  const errors: string[] = [];
  // Warnings too, but not as failures in themselves: the mission legs warn
  // legitimately (a missing sprite, a plate reason). What a leave of the
  // scene host must not do is warn about the CONTEXT or the loaders it tore
  // down -- a second `loseContext()` logs `WebGL: INVALID_OPERATION:
  // loseContext: context already lost` as a warning, not an error, and the
  // spec's "no warning on leave" (§3.3 (6), §3.6 leg (b)) is the only guard
  // C3 has. `leaveWarnings` below asks that of each leave window.
  const warnings: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  /** Warnings a scene-host leave must never produce: its context, its
   *  loaders, its decoder worker, or its own name. */
  const LEAVE_WARNING = /WebGL|loseContext|scene host|DRACO|Worker/i;
  /** The one matching warning that is not about a leave: SwiftShader's own
   *  performance note, `[.WebGL-0x...]GL Driver Message (OpenGL, Performance,
   *  GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels`, which the
   *  campaign board's first frames print on this runner whichever way the
   *  menu was left. Exempt by its full text, so a different WebGL message
   *  still fails. */
  const NOT_A_LEAVE_WARNING = /GL Driver Message \(OpenGL, Performance, [A-Z_]+, High\): GPU stall due to ReadPixels/;
  /** Assert that no warning since `from` matches `LEAVE_WARNING`, after a
   *  short settle: a decoder worker torn down mid-decode, or a context lost
   *  twice, can log a turn or two after the click that caused it. */
  const expectQuietLeave = async (from: number, where: string): Promise<void> => {
    await page.waitForTimeout(750);
    const bad = warnings.slice(from).filter((w) => LEAVE_WARNING.test(w) && !NOT_A_LEAVE_WARNING.test(w));
    console.log(
      `[${TAG}] ${where}: ${warnings.length - from} console warning(s) in the leave window, ` +
        `${bad.length} matching ${String(LEAVE_WARNING)} (ReadPixels stall notes exempt)`
    );
    for (const w of bad) {
      expect(false, `${where}: the scene host's leave logged a warning: ${w.slice(0, 300)}`);
    }
  };

  // --- the menu, and the rest position everything else is measured against --
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForSelector('a[href="/campaign"]');
  const menu = await probe(page);
  expect(menu.boots === 1, `menu: boots=${menu.boots}, expected exactly 1`);
  expect(!menu.lions, 'window.__lions exists on the menu, which defines no battlefield');
  const idleBody = menu.bodyChildren;
  console.log(`[${TAG}] menu: ${idleBody} body children, boots=${menu.boots}`);

  // --- the scene host: it must leave nothing behind, in DOM or GPU alike ----
  //
  // Leg (a). `data-host` starts `pending` and settles to `live`/`plate`/`off`
  // on its own clock (spec §3.3/§3.6), so this waits for the DOM's own
  // verdict rather than a fixed delay -- `dismissDeployGate`'s own reasoning.
  // This harness sets no reduced-motion/save-data/`?renderer=pixi` override
  // and the runner has WebGL2 (every other leg here draws three.js), so
  // "live" is the only acceptable outcome.
  await page.waitForFunction(
    () => document.querySelector('.rl-scene-host')?.getAttribute('data-host') !== 'pending',
    null,
    { timeout: 60_000 }
  );
  const hostReached = await page.evaluate(() => {
    const el = document.querySelector('.rl-scene-host');
    return {
      host: el?.getAttribute('data-host') ?? null,
      reason: el?.getAttribute('data-host-reason') ?? null,
      ms: el?.getAttribute('data-host-ms') ?? null,
      motion: el?.getAttribute('data-host-motion') ?? null,
    };
  });
  // `data-host-motion` is printed, not gated: `held` is what keeps a tool on
  // a 1 fps SwiftShader menu from clicking through a frame loop (spec §3.3
  // (5)), and whether a runner reaches it is a fact worth one line per run.
  console.log(
    `[${TAG}] scene host: data-host=${hostReached.host} in ${hostReached.ms} ms` +
      `, data-host-motion=${String(hostReached.motion)}` +
      `${hostReached.reason ? ` (data-host-reason=${hostReached.reason})` : ''}`
  );
  expect(
    hostReached.host === 'live',
    `scene host did not reach "live" on a WebGL2 runner: data-host=${hostReached.host}, ` +
      `data-host-reason=${hostReached.reason}`
  );
  // Stashed under our own name for the same reason the mission leave leg
  // below stashes `__rlLeftSim`: the element (and its canvas) is gone once
  // the menu is left, so only a reference taken BEFORE the leave can answer
  // whether the WebGL context it drew through is still alive afterward.
  await page.evaluate(() => {
    (window as unknown as { __rlHostCanvas?: HTMLCanvasElement | null }).__rlHostCanvas = document.querySelector(
      '.rl-scene-host canvas'
    );
  });

  // --- an in-app click to the campaign board -------------------------------
  // Read again at the click: at `live` the loop has not sampled a single
  // interval yet, so it always reads `animate` there; whether it went on to
  // HOLD is only knowable now.
  const motionAtLeave = await page.evaluate(
    () => document.querySelector('.rl-scene-host')?.getAttribute('data-host-motion') ?? null
  );
  const leaveClickStart = Date.now();
  const liveLeaveFrom = warnings.length;
  await page.click('a[href="/campaign"]');
  await page.waitForSelector('.rl-world');
  const board = await probe(page);
  console.log(
    `[${TAG}] leg (a): left the live host with data-host-motion=${String(motionAtLeave)}; ` +
      `the Campaign click reached the board in ${Date.now() - leaveClickStart} ms`
  );
  expect(board.boots === 1, `clicking Campaign reloaded the page: boots=${board.boots}`);
  expectDocuments(1, 'clicking Campaign');

  // Leg (a), continued: the router's disposer must have released both
  // halves of the host -- the DOM element, and (since #219, via
  // `ThreeRenderer.dispose()`) the WebGL context itself. Read off the
  // canvas reference stashed above, because `.rl-scene-host` no longer
  // exists to query directly.
  const hostAfterLeave = await page.evaluate(() => {
    const w = window as unknown as { __rlHostCanvas?: HTMLCanvasElement | null };
    const canvas = w.__rlHostCanvas ?? null;
    const ctx = canvas ? canvas.getContext('webgl2') : null;
    return {
      elementGone: document.querySelector('.rl-scene-host') === null,
      canvasStashed: canvas !== null,
      contextLost: ctx ? ctx.isContextLost() : null,
    };
  });
  expect(hostAfterLeave.elementGone, 'the .rl-scene-host element is still in the DOM after leaving the menu');
  // A null stash and a live context are two different failures and must not
  // share a message: the first means the harness itself never found a canvas
  // to check (the earlier stash ran before the host reached "live", or found
  // none), the second means the canvas WAS found and its context genuinely
  // outlived the menu.
  expect(hostAfterLeave.canvasStashed, 'no host canvas was stashed at the first menu visit');
  expect(hostAfterLeave.contextLost === true, 'the scene host left its WebGL context alive');
  await expectQuietLeave(liveLeaveFrom, 'leg (a), leaving a live host');

  // --- mission A, reached by a LEGACY query URL ----------------------------
  // A hard navigation on purpose: this is the URL every tool and bookmark in
  // the repo still uses, and the redirect that keeps them working is what puts
  // the player on the path.
  await page.goto(`http://localhost:${PORT}/?mission=${MISSION_A}`, { waitUntil: 'load' });
  expect(
    new URL(page.url()).pathname === `/mission/${MISSION_A}`,
    `legacy ?mission= did not redirect onto its path: ${page.url()}`
  );
  await dismissDeployGate(page, `${TAG} A`);
  await page.waitForFunction(() => (window as unknown as { __lions?: unknown }).__lions !== undefined);
  const a1 = await probe(page);
  await page.waitForTimeout(1500);
  const a2 = await probe(page);
  expect(
    a1.tick !== null && a2.tick !== null && a2.tick > a1.tick,
    `mission A did not tick: ${a1.tick} -> ${a2.tick}`
  );
  console.log(`[${TAG}] mission A ticked ${a1.tick} -> ${a2.tick}`);
  await frameCadence(page, `mission A (${MISSION_A})`);

  // --- leave it, in-app, through the control a player would use ------------
  //
  // The sim is stashed under a name of our own FIRST, because `__lions` is
  // deleted on the way out and the question below is about the object it used
  // to point at. Holding a reference does not keep the mission alive -- it
  // keeps it READABLE, which is the only way to ask whether anything is still
  // driving it.
  await page.evaluate(() => {
    const w = window as unknown as { __lions?: { sim: unknown }; __rlLeftSim?: unknown };
    w.__rlLeftSim = w.__lions?.sim;
  });
  await page.click('.rl-hud__leave');
  await page.click('.rl-confirm__yes');
  await page.waitForSelector('.rl-world');

  // THE question this instrument exists for, and the only one here that the
  // frame loop's cancellation changes: is the mission the player just left
  // still being simulated behind the screen they can see?
  //
  // Nothing else in this walk can see that. The HUD comes off the body, the
  // dev hook is deleted and the campaign board draws correctly whether or not
  // `cancelAnimationFrame` ran -- a leaked loop is INVISIBLE to every other
  // assertion here, and to a screenshot. It is not invisible to the tick
  // counter: `runTick()` is called from that loop and from nothing else once
  // the console hook is gone.
  const leftTick = async (): Promise<number | null> =>
    page.evaluate(() => {
      const w = window as unknown as { __rlLeftSim?: { tickCount: number } };
      return w.__rlLeftSim ? w.__rlLeftSim.tickCount : null;
    });
  const t1 = await leftTick();
  await page.waitForTimeout(1200);
  const t2 = await leftTick();
  expect(t1 !== null && t2 !== null, 'could not read the left mission’s sim back');
  expect(
    t1 === t2,
    `the mission the player left is STILL TICKING: ${t1} -> ${t2} over 1200 ms ` +
      `(the frame loop outlived its battlefield)`
  );
  console.log(
    `[${TAG}] the left mission's sim read ${t1} then ${t2} over 1200 ms` +
      `${t1 === t2 ? ' (frozen, as it must be)' : ' -- STILL RUNNING'}`
  );

  // Settled before it is read, because it is the REFERENCE the deploy-screen
  // leg's canvas count is held to. The 1200 ms above happened to be long
  // enough every time; a reference that is right by luck is not one.
  const backSettled = await settleBoard(page);
  const back = await probe(page);
  expect(back.boots === 1, `leaving mission A reloaded the page: boots=${back.boots}`);
  expectDocuments(2, 'leaving mission A');
  expect(!back.lions, 'window.__lions survived leaving mission A -- the battlefield is still mounted');
  expect(
    back.leftovers.length === 0,
    `battlefield chrome left on the body after leaving: ${back.leftovers.join(', ')}`
  );
  expect(
    back.bodyChildren === idleBody,
    `body has ${back.bodyChildren} children after leaving, ${idleBody} at the menu`
  );

  // --- mission B, hard, so the soft leg below starts from a clean document --
  await page.goto(`http://localhost:${PORT}/mission/${MISSION_B}`, { waitUntil: 'load' });
  await dismissDeployGate(page, `${TAG} B-hard`);
  await page.waitForFunction(() => (window as unknown as { __lions?: unknown }).__lions !== undefined);
  await page.click('.rl-hud__leave');
  await page.click('.rl-confirm__yes');
  await page.waitForSelector('.rl-world');
  const afterB = await probe(page);
  expect(!afterB.lions, 'window.__lions survived leaving mission B');
  expectDocuments(3, 'leaving mission B');
  expect(
    afterB.bodyChildren === idleBody,
    `body has ${afterB.bodyChildren} children after leaving B, ${idleBody} at the menu`
  );

  // --- and now a mission booted SOFTLY, in the realm two missions have already
  //     been torn down in. This is the question the other three set up.
  const card = page.locator('a[href^="/mission/"]').first();
  await card.waitFor({ state: 'visible' });
  const softHref = await card.getAttribute('href');
  console.log(`[${TAG}] soft-booting the board's first card: ${softHref ?? '(no href)'}`);
  await card.click();
  await dismissDeployGate(page, `${TAG} B-soft`);
  await page.waitForFunction(() => (window as unknown as { __lions?: unknown }).__lions !== undefined);
  const b1 = await probe(page);
  await page.waitForTimeout(1500);
  const b2 = await probe(page);
  expect(b1.boots === 1, `the soft mission boot reloaded the page: boots=${b1.boots}`);
  expectDocuments(3, 'the soft mission boot');
  expect(b1.lions, 'the soft mission boot defined no window.__lions');
  expect(
    b1.tick !== null && b2.tick !== null && b2.tick > b1.tick,
    `the soft-booted mission did not tick: ${b1.tick} -> ${b2.tick}`
  );
  console.log(`[${TAG}] soft mission ticked ${b1.tick} -> ${b2.tick}, boots=${b1.boots}`);

  await frameCadence(page, 'the soft-booted mission');

  // And leave THAT one too. Until GH-345 the board's first card (First Light)
  // was a `resources` mission and this leave also proved its dock comes off
  // the body; First Light has no dock now, so the dock mission gets its own
  // soft boot and leave below.
  await page.click('.rl-hud__leave');
  await page.click('.rl-confirm__yes');
  await page.waitForSelector('.rl-world');
  const afterSoft = await probe(page);
  expect(!afterSoft.lions, 'window.__lions survived leaving the soft-booted mission');
  expectDocuments(3, 'leaving the soft-booted mission');
  expect(
    afterSoft.leftovers.length === 0,
    `chrome left on the body after leaving the soft-booted mission: ${afterSoft.leftovers.join(', ')}`
  );
  expect(
    afterSoft.bodyChildren === idleBody,
    `body has ${afterSoft.bodyChildren} children after leaving the soft-booted mission, ` +
      `${idleBody} at the menu`
  );
  console.log(
    `[${TAG}] after three missions the body has ${afterSoft.bodyChildren} children` +
      `${afterSoft.bodyChildren === idleBody ? ' -- back to the menu’s own count' : ` -- the menu had ${idleBody}`}`
  );

  // --- a dock-bearing mission, booted softly --------------------------------
  await page.evaluate((href) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = 'dock mission';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, '/mission/beit_sahwan_2_foothold');
  await dismissDeployGate(page, `${TAG} dock-soft`);
  await page.waitForFunction(() => (window as unknown as { __lions?: unknown }).__lions !== undefined);
  const dockBoot = await probe(page);
  expect(dockBoot.boots === 1, `the soft dock-mission boot reloaded the page: boots=${dockBoot.boots}`);
  // GH-229: the dock's tooltip, opened on a tile below the first row, used to
  // land on top of the row above it (`tooltip.ts`'s `computeTipPosition`,
  // `production.ts`'s `clear: this.el`). GH-345 took First Light's dock away,
  // so the first dock-bearing mission, Beit Sahwan II, is booted SOFTLY here
  // -- a same-origin anchor click, the router's own soft navigation -- in the
  // realm three missions have already been torn down in.
  // A plain arrow inline, never a NAMED const holding one: `frameCadence`
  // above already found that tsx/esbuild compiles a function assigned to a
  // const with a `__name` helper the page does not have, and dies on it.
  const dockTip = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll<HTMLElement>('.rl-dock .rl-tile'));
    // A tile past the first row if the roster is deep enough to have one,
    // else whatever there is -- the assertion still holds for a one-row dock
    // (`clear` degrades to the trigger's own rect there), it just cannot
    // exercise the regression this line exists to catch.
    const target = tiles[5] ?? tiles[tiles.length - 1];
    if (!target) return null;
    target.dispatchEvent(new Event('mouseenter'));
    const tip = document.querySelector<HTMLElement>('.rl-dock .rl-tip');
    if (!tip || tip.hidden) return { tileCount: tiles.length, tileIndex: tiles.indexOf(target), tipShown: false };
    const tr = tip.getBoundingClientRect();
    return {
      tileCount: tiles.length,
      tileIndex: tiles.indexOf(target),
      tipShown: true,
      // Every tile's rect, not just the hovered one: the regression this
      // check exists for is the tip landing on top of a DIFFERENT tile (the
      // row above the one under the pointer), not the hovered tile itself.
      tiles: tiles.map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      }),
      tip: { top: tr.top, bottom: tr.bottom, left: tr.left, right: tr.right },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  expect(dockTip !== null, 'the soft-booted dock mission has no dock to test the tooltip on');
  if (dockTip !== null) {
    expect(dockTip.tileCount > 5, `dock has only ${dockTip.tileCount} tile(s) -- the regression needs a second row`);
    expect(dockTip.tipShown === true, `hovering dock tile ${dockTip.tileIndex} showed no tooltip`);
    if (dockTip.tipShown && dockTip.tiles && dockTip.tip && dockTip.viewport) {
      const { tiles, tip, viewport } = dockTip;
      const inside = tip.top >= 0 && tip.left >= 0 && tip.right <= viewport.width && tip.bottom <= viewport.height;
      expect(inside, `dock tooltip left the viewport: ${JSON.stringify(tip)} vs ${JSON.stringify(viewport)}`);
      const covered = tiles.filter(
        (r) => tip.bottom > r.top && tip.top < r.bottom && tip.right > r.left && tip.left < r.right
      );
      expect(
        covered.length === 0,
        `dock tooltip covers ${covered.length} tile(s) it does not describe: tip=${JSON.stringify(tip)} ` +
          `covered=${JSON.stringify(covered)}`
      );
    }
  }
  await page.evaluate(() => {
    document.querySelectorAll('.rl-dock .rl-tile').forEach((t) => t.dispatchEvent(new Event('mouseleave')));
  });

  // A mission with resources fields a `ReinforcementDock` on the body that
  // the recon missions above do not; leaving only those left that dock
  // unexamined, and it was leaking -- found by reading the body-mount list,
  // which is why the walk covers it.
  await page.click('.rl-hud__leave');
  await page.click('.rl-confirm__yes');
  await page.waitForSelector('.rl-world');
  const afterDock = await probe(page);
  expectDocuments(3, 'the soft dock mission, booted and left');
  expect(!afterDock.lions, 'window.__lions survived leaving the dock mission');
  expect(
    afterDock.leftovers.length === 0,
    `chrome left on the body after leaving the dock mission: ${afterDock.leftovers.join(', ')}`
  );
  expect(
    afterDock.bodyChildren === idleBody,
    `body has ${afterDock.bodyChildren} children after leaving the dock mission, ${idleBody} at the menu`
  );

  // --- leaving from the DEPLOY SCREEN, which is the abort path ---------------
  //
  // Every leg above lets the mission finish booting first. This one does not,
  // and it is the only one that drives the machinery built for it: Escape on
  // the briefing calls `onBack` -> `req.navigate(routes.campaign())` while
  // `bootBattlefield` is still parked on `await loading.done()`. The router
  // aborts the in-flight mount's signal, `onAbort` disposes the loading screen,
  // that rejects the parked promise with an `AbortError`, the boot tears itself
  // down and rethrows, and the router swallows it.
  //
  // Without that chain the mount never resolves at all: it sits on the await
  // forever holding a renderer and a WebGL context, and the disposer that would
  // release them is a value the function has not returned. A hang is not a
  // crash, so nothing else here would have reported it.
  await page.goto(`http://localhost:${PORT}/?mission=${MISSION_A}`, { waitUntil: 'load' });
  await page.waitForSelector('.rl-loading__deploy');
  // GH-417 B-01..B-03, on the layout itself (`briefing-reach.ts`): the screen
  // opens at its top with the mission's name on screen, Deploy wholly inside
  // the 1400x900 viewport, and no orders hidden in a nested scroll box.
  // origin/main read red here three ways (see that file's header). Fonts
  // first: a late webfont swap reflows every line this measures.
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  const reach = (await page.evaluate(BRIEFING_REACH_SCRIPT)) as BriefingReach | null;
  const reachProblems = reach ? briefingReachProblems(reach) : ['the briefing did not render'];
  console.log(`[routes] briefing reach: ${reachProblems.length === 0 ? 'OK' : reachProblems.join('; ')} ${JSON.stringify(reach)}`);
  expect(reachProblems.length === 0, `the briefing is not reachable on open: ${reachProblems.join('; ')}`);
  await pressEscapeUntilGone(page);
  await page.waitForSelector('.rl-world');
  const escapeSettled = await settleBoard(page);
  const afterEscape = await probe(page);
  expect(afterEscape.boots === 1, `Escape off the deploy screen reloaded the page: boots=${afterEscape.boots}`);
  expectDocuments(4, 'Escape off the deploy screen');
  expect(!afterEscape.lions, 'window.__lions exists after leaving from the deploy screen');
  expect(
    afterEscape.leftovers.length === 0,
    `chrome left on the body after leaving from the deploy screen: ${afterEscape.leftovers.join(', ')}`
  );
  expect(
    afterEscape.bodyChildren === idleBody,
    `body has ${afterEscape.bodyChildren} children after leaving from the deploy screen, ${idleBody} at the menu`
  );
  expect(
    (await page.$('.rl-loading')) === null,
    'the deploy screen is still on the page after Escape'
  );
  // THE assertion for this leg, and the only one of the five that a hung mount
  // cannot satisfy. Every other question here -- boots, `__lions`, the body
  // count, the console -- is answered identically by a battlefield that tore
  // itself down and by one that is parked on `await loading.done()` forever
  // holding a renderer, because a mount that never resolves never mounted
  // anything to leave behind. Measured: with the abort chain removed this leg
  // passed all four, unchanged.
  //
  // What differs is the canvas. An abandoned boot's renderer is never disposed
  // and its canvas is never removed, so the campaign board draws over it. The
  // reference is `back.canvases` -- the same board, in the same run, reached by
  // leaving a mission the ordinary way -- rather than a hard-coded 1, so this
  // cannot drift when the board's own rendering changes.
  //
  // Both readings are taken only once their board has SETTLED (`settleBoard`).
  // This one used to be read ~300 ms after Escape, against a reference read
  // 1200 ms after its leave, and the diorama's canvas does not exist until its
  // GLB has loaded: on CI that race read 0 against 1 on main (830f86c7) and
  // twice on PR #212, and the message called it an undisposed renderer. A leak
  // ADDS a canvas; `boardCanvasVerdict` names which direction it saw.
  const verdict = boardCanvasVerdict(
    { canvases: afterEscape.canvases, board: afterEscape.board, settled: escapeSettled },
    { canvases: back.canvases, board: back.board, settled: backSettled }
  );
  expect(verdict === null, verdict ?? '');
  console.log(
    `[${TAG}] left from the deploy screen: boots=${afterEscape.boots}, ` +
      `body=${afterEscape.bodyChildren}, __lions=${String(afterEscape.lions)}, ` +
      `canvases=${afterEscape.canvases} on ${escapeSettled ? 'a settled' : 'an UNSETTLED'} ` +
      `${String(afterEscape.board)} board (${back.canvases} on ${backSettled ? 'a settled' : 'an UNSETTLED'} ` +
      `${String(back.board)} board after an ordinary leave)`
  );

  // --- Saves and Credits: the `.rl-menu` column must not collapse ----------
  //
  // GH-223: both screens build a `.rl-menu` column whose only child is a
  // `panel()` (`ui/saves.ts`, `ui/credits.ts`). `.rl-panel` is absolutely
  // positioned by default (theme.css) -- right for a HUD panel pinned over
  // the map, wrong here. Taking it out of flow does NOT shrink the panel
  // itself: `.rl-panel` still sizes to its own content (measured on this
  // exact page, pre-fix: 251px/617px for Saves/Credits). What collapses is
  // the `.rl-menu` WRAPPER -- an absolutely positioned descendant contributes
  // nothing to its containing block's own auto-height, so `.rl-menu`'s
  // rendered box shrinks to its padding alone (`padding: var(--s5)
  // var(--s6)` = 3rem block + 2px border = ~50px at scale 1) regardless of
  // how tall the panel is, and `overflow-y: auto` then reveals that panel
  // through a small scrolling window -- the ~60px strip GH-223 reported. So
  // the oracle here is `.rl-menu`'s own box, not `.rl-panel`'s: measuring the
  // panel (a plausible first instinct) reads a healthy number even on the
  // broken build and would never go red. jsdom has no layout at all, so
  // nothing in `pnpm test` can see this either way -- a rendered box height
  // in a real browser is the only oracle. The floor is a FRACTION of the
  // viewport, not a pixel count, so it survives a --ui-scale change or a
  // different capture resolution: measured on this page's own 900px-tall
  // viewport, the broken wrapper reads 5.6% (the ~50px padding-only box) on
  // BOTH routes -- it does not even vary with the panel's own content height,
  // which is the tell -- and a wrapper restored to flow reads over 30% on the
  // shorter of the two (Saves). 15% sits with wide margin on both sides of
  // that gap. Seen red: with `.rl-menu > .rl-panel`'s position reset removed,
  // this leg fails both routes at 5.6%.
  //
  // 15% is calibrated for THIS walk's fixed 1400x900 viewport (`browser.newPage`
  // above) and is not a universal figure. The broken state stays far under it
  // at any viewport height, since a rem-driven ~50px padding-only box does not
  // grow with the frame. A healthy `.rl-menu` is also rem-sized, though, so
  // its FRACTION of the viewport shrinks as the viewport grows -- Saves' own
  // 301px would only near 15% around a ~1900-2000px-tall viewport. A future
  // caller of this leg at a much taller viewport should re-measure before
  // reusing this constant.
  const MENU_MIN_FRACTION = 0.15;
  for (const [routePath, label] of [
    ['/saves', 'Saves'],
    ['/credits', 'Credits'],
  ] as const) {
    await page.goto(`http://localhost:${PORT}${routePath}`, { waitUntil: 'load' });
    await page.waitForSelector('.rl-menu');
    const { height, viewport } = await page.evaluate(() => {
      const m = document.querySelector('.rl-menu');
      return {
        height: m instanceof HTMLElement ? m.getBoundingClientRect().height : 0,
        viewport: window.innerHeight,
      };
    });
    const fraction = viewport > 0 ? height / viewport : 0;
    console.log(
      `[${TAG}] ${label} .rl-menu: ${height.toFixed(0)}px of a ${viewport}px viewport ` +
        `(${(fraction * 100).toFixed(1)}%)`
    );
    expect(
      fraction >= MENU_MIN_FRACTION,
      `${label} (${routePath}): .rl-menu renders ${height.toFixed(0)}px tall, ` +
        `${(fraction * 100).toFixed(1)}% of a ${viewport}px viewport (floor ${MENU_MIN_FRACTION * 100}%) -- ` +
        `its .rl-panel child is out of flow again (GH-223)`
    );
  }

  // --- leg (b): a fast leave, during the LOAD --------------------------------
  //
  // Every leg above lets the host settle to "live" before leaving. This one
  // leaves while the door is fetching: it waits for the first request the
  // host makes for a mesh or the Draco decoder (the prefetch, spec §3.3 (1)
  // -- the long phase on a slow link), then clicks Campaign. Clicking on
  // `load` alone, as this leg first did, landed ~18 ms in: before the idle
  // callback had even run, so it exercised the CANCELLED SCHEDULE and never
  // the door's abort. The run's "no console error" rule and
  // `expectQuietLeave` cover what an aborted fetch or a torn-down decoder
  // might log.
  //
  // The campaign board's own GLB lives under `/campaign/`; this document has
  // no board, but the predicate says so rather than relying on it.
  // `draco_` and not `draco`: the loader's own MODULE is served as
  // `three_addons_loaders_DRACOLoader__js.js`, a JS import that says nothing
  // about the prefetch having started (the first run matched it).
  const isHostFetch = (u: string): boolean =>
    /\.glb(\?|$)|draco_(wasm_wrapper|decoder)/.test(u) && !u.includes('/campaign/') && !u.includes('/node_modules/');
  const firstHostFetch = page
    .waitForRequest((r) => isHostFetch(r.url()), { timeout: 60_000 })
    .then((r) => r.url())
    .catch(() => null);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'commit' });
  const fastLeaveFrom = warnings.length;
  const fastLeaveStart = Date.now();
  const hostFetch = await firstHostFetch;
  expect(hostFetch !== null, 'leg (b): the menu made no .glb/draco request within 60 s -- nothing to leave during');
  // Read `data-host` and click Campaign in the SAME `page.evaluate` -- one JS
  // turn, no Playwright round-trip between the two -- so the state read is
  // the state the click actually landed on. `link.click()` on an anchor
  // dispatches a real (if untrusted) `MouseEvent`, which `interceptLinks`'s
  // delegated listener does not discriminate against, so this reaches the
  // router exactly as `page.click()` does. The phase is read in the same
  // turn, and only as far as the DOM can say it: a canvas means the door is
  // past `init()`; NO canvas means the prefetch OR the mesh load, because
  // `ThreeRenderer` -- and so the context -- is constructed before the loads
  // and `init()` appends its canvas only after them. Measured: with a second
  // `loseContext()` re-added to the door's `release()`, this leg went red on
  // "context already lost" in a run whose click read "no canvas", so that
  // click had landed in the mesh load, with a context to release.
  const fastAt = await page.evaluate(() => {
    const host = document.querySelector('.rl-scene-host')?.getAttribute('data-host') ?? null;
    const canvas = document.querySelector('.rl-scene-host canvas') !== null;
    const link = document.querySelector('a[href="/campaign"]');
    if (link instanceof HTMLElement) link.click();
    return { host, canvas };
  });
  console.log(
    `[${TAG}] fast leave: clicked Campaign ${Date.now() - fastLeaveStart} ms after navigating, once ` +
      `${hostFetch === null ? '(no request seen)' : new URL(hostFetch).pathname} was requested; ` +
      `data-host was "${String(fastAt.host)}", phase ${fastAt.canvas ? 'past init() (canvas in the DOM)' : 'before init() -- prefetch or mesh load (no canvas in the DOM)'}`
  );
  expect(
    fastAt.host === 'pending',
    `fast leave landed after the host reached ${String(fastAt.host)}; the abort path was not exercised`
  );
  await page.waitForSelector('.rl-world');
  const noHostAfterFastLeave = await page.evaluate(() => document.querySelector('.rl-scene-host') === null);
  expect(noHostAfterFastLeave, 'the scene host left an element behind after a fast leave (mid-load abort)');
  await expectQuietLeave(fastLeaveFrom, 'leg (b), leaving during the load');

  // --- leg (c): a leave the moment the context exists --------------------------
  //
  // The window between `init()` appending the canvas and the reveal: a
  // context now exists, and the abort listener must release it synchronously
  // (spec §3.3 (2)). A MutationObserver installed before the app's own
  // scripts run sees the canvas arrive and clicks Campaign in that same
  // microtask checkpoint, not a Playwright round-trip later -- Playwright's
  // own `waitForFunction` polls per frame or per interval, and one SwiftShader
  // frame is longer than this window. If the host leaves `pending` before any
  // mutation shows the canvas, the observer records that instead of clicking.
  //
  // An init script applies to every LATER document of this page. This is the
  // last hard navigation in the walk (the click below is the router's), so it
  // reaches this document and no other. A string, not a function, for
  // `frameCadence`'s reason: tsx's `__name` helper does not exist in the page.
  await page.addInitScript(
    'new MutationObserver(function (_, mo) {' +
      ' var el = document.querySelector(".rl-scene-host"); if (!el) return;' +
      ' var host = el.getAttribute("data-host"); var canvas = el.querySelector("canvas");' +
      ' if (canvas && host === "pending") {' +
      '   window.__rlCtxCanvas = canvas; window.__rlCtxLeave = { host: host, clicked: true }; mo.disconnect();' +
      '   var link = document.querySelector(\'a[href="/campaign"]\'); if (link) link.click();' +
      ' } else if (host && host !== "pending") {' +
      '   window.__rlCtxLeave = { host: host, clicked: false }; mo.disconnect();' +
      ' }' +
      ' }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-host"] });'
  );
  const ctxLeaveFrom = warnings.length;
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'commit' });
  const ctxAt = await page
    .waitForFunction(
      () => (window as unknown as { __rlCtxLeave?: { host: string; clicked: boolean } }).__rlCtxLeave ?? false,
      null,
      { timeout: 60_000 }
    )
    .then((h) => h.jsonValue())
    .then((v) => (v === false ? null : v))
    .catch(() => null);
  if (ctxAt !== null && ctxAt.clicked) {
    await page.waitForSelector('.rl-world');
    const ctxAfter = await page.evaluate(() => {
      const canvas = (window as unknown as { __rlCtxCanvas?: HTMLCanvasElement }).__rlCtxCanvas ?? null;
      const gl = canvas ? canvas.getContext('webgl2') : null;
      return {
        elementGone: document.querySelector('.rl-scene-host') === null,
        contextLost: gl ? gl.isContextLost() : null,
      };
    });
    console.log(
      `[${TAG}] context leave: clicked Campaign with the canvas present and data-host "pending"; ` +
        `element gone=${String(ctxAfter.elementGone)}, context lost=${String(ctxAfter.contextLost)}`
    );
    expect(ctxAfter.elementGone, 'leg (c): the scene host left an element behind after a leave mid-construct');
    expect(ctxAfter.contextLost === true, 'leg (c): a leave mid-construct left the WebGL context alive');
    await expectQuietLeave(ctxLeaveFrom, 'leg (c), leaving with a context and no reveal');
  } else {
    expect(
      false,
      `leg (c): never saw the host canvas while data-host was "pending" ` +
        `(${ctxAt === null ? 'timed out' : `the host reached "${String(ctxAt.host)}" first`})`
    );
  }

  // --- the garage filter (GH-237): a role tab must actually narrow the roster
  //
  // The reported bug was never in `brigade.ts`: `syncTabs` always set the
  // native `hidden` attribute on the right cards. It never showed on screen
  // because `theme.css`'s `.rl-garage__card` rule sets an unconditional
  // `display: flex`, and a normal AUTHOR declaration beats the UA's own
  // `[hidden] { display: none }` regardless of specificity or source order --
  // the exact trap `.rl-cmd__face-img`'s own comment already names. No unit
  // test can see this: jsdom's `getComputedStyle` answers a hidden element's
  // `display` from the DOM property directly rather than from a real
  // cascade, so it reads `none` whether or not the CSS override exists
  // (checked by hand against this worktree's fixed `theme.css` and the
  // pre-fix version -- identical either way). A real, rendered browser is the
  // only oracle for it, which is why this lives here rather than in a
  // `*.test.ts`. It asserts on the actual painted box, never on `hidden`
  // alone, so a regression back to the old CSS fails this exactly as it
  // failed a player.
  await page.goto(`http://localhost:${PORT}/brigade`, { waitUntil: 'load' });
  await page.waitForSelector('.rl-garage__tab[data-bucket="all"]');
  const paintedCardIds = (): Promise<(string | null)[]> =>
    page.$$eval('.rl-garage__card', (els) =>
      els
        .filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0)
        .map((e) => e.getAttribute('data-unit'))
    );
  const otherBuckets = await page.$$eval('.rl-garage__tab', (els) =>
    els.map((e) => e.getAttribute('data-bucket')).filter((b): b is string => b !== null && b !== 'all')
  );
  expect(otherBuckets.length > 0, 'garage: the starting roster fills only one role bucket, so no tab can be tested');
  if (otherBuckets.length > 0) {
    const bucket = otherBuckets[0];
    const allPainted = await paintedCardIds();
    await page.click(`.rl-garage__tab[data-bucket="${bucket}"]`);
    const filteredPainted = await paintedCardIds();
    const expectedIds = await page.$$eval(
      '.rl-garage__card',
      (els, b) => els.filter((e) => e.getAttribute('data-bucket') === b).map((e) => e.getAttribute('data-unit')),
      bucket
    );
    console.log(
      `[${TAG}] garage filter: "all" paints ${allPainted.length} card(s), "${bucket}" paints ` +
        `${filteredPainted.length} of ${expectedIds.length} expected`
    );
    expect(
      filteredPainted.length < allPainted.length,
      `garage: clicking the "${bucket}" tab left ${filteredPainted.length} of ${allPainted.length} cards ` +
        `painted -- the roster did not narrow at all`
    );
    const same =
      filteredPainted.length === expectedIds.length && expectedIds.every((id) => filteredPainted.includes(id));
    expect(
      same,
      `garage: the "${bucket}" tab paints ${JSON.stringify(filteredPainted)}, expected exactly ` +
        `${JSON.stringify(expectedIds)}`
    );
  }

  // --- the garage's turnable model (GH-316) --------------------------------
  //
  // The bay draws the unit's own GLB through `@lions/render/three-garage`,
  // one WebGL context per unit shown. Three things only a real browser can
  // check: the model reaches `data-model="live"` on a WebGL2 runner (jsdom
  // has no WebGL, so every unit test lands on the plate); paging to another
  // unit gives the FIRST unit's context back; and a soft leave through the
  // garage's own menu link gives the second one back too -- the scene host's
  // rule, read off canvases stashed before each change exactly as leg (a)
  // reads the host's. Plus one real key press on the focused control, since
  // a synthetic event would skip the browser's own focus and key routing.
  //
  // `reducedMotion: 'reduce'`: the auto-turn must not start (5 s after the
  // model goes live) before this leg presses a key on a slow runner, and the
  // idle read below needs a bay with nothing to animate. Every WebGL2
  // context the page makes is recorded by an init script, so the
  // fast-paging step can count the live ones -- including any made for a
  // unit the bay had already left.
  {
    const modelCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await modelCtx.addInitScript(
      '(function () { var orig = HTMLCanvasElement.prototype.getContext; window.__rlGl = [];' +
        ' HTMLCanvasElement.prototype.getContext = function (type) {' +
        '  var ctx = orig.apply(this, arguments);' +
        '  if (type === "webgl2" && ctx && !window.__rlGl.some(function (e) { return e.c === this; }, this))' +
        '   window.__rlGl.push({ c: this, g: ctx });' +
        '  return ctx; }; })()'
    );
    await modelCtx.addInitScript(garageSeedScript());
    const m = await modelCtx.newPage();
    m.setDefaultTimeout(ACTION_TIMEOUT_MS);
    const modelWarnings: string[] = [];
    m.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') errors.push(msg.text());
      else if (msg.type() === 'warning') modelWarnings.push(msg.text());
    });
    m.on('pageerror', (e) => errors.push(String(e)));
    // Strings, not functions: see `GARAGE_ARM` below for the `__name` trap.
    const MODEL_STATE =
      '(() => { var p = document.querySelector(".rl-garage__plate");' +
      ' var c = document.querySelector(".rl-garage__card[aria-selected=\\"true\\"]");' +
      ' return { model: p ? p.getAttribute("data-model") : null, reason: p ? p.getAttribute("data-model-reason") : null,' +
      ' unit: c ? c.getAttribute("data-unit") : null }; })()';
    const SETTLED = (unit: string): string =>
      '(() => { var p = document.querySelector(".rl-garage__plate");' +
      ' var c = document.querySelector(".rl-garage__card[aria-selected=\\"true\\"]");' +
      ' var s = p ? p.getAttribute("data-model") : null;' +
      ` return !!c && c.getAttribute("data-unit") === ${JSON.stringify(unit)} && s !== null && s !== "pending"; })()`;
    type ModelState = { model: string | null; reason: string | null; unit: string | null };
    const settled = async (unit: string): Promise<ModelState> => {
      await m.waitForFunction(SETTLED(unit), null, { timeout: 60_000 });
      return m.evaluate<ModelState>(MODEL_STATE);
    };
    const STASH = (slot: string): string => `window.${slot} = document.querySelector(".rl-garage__model canvas");`;
    const LOST = (slot: string): string =>
      `(() => { var c = window.${slot}; var g = c ? c.getContext("webgl2") : null;` +
      ' return { stashed: !!c, lost: g ? g.isContextLost() : null }; })()';
    type LostRead = { stashed: boolean; lost: boolean | null };

    await m.goto(`http://localhost:${PORT}/brigade`, { waitUntil: 'load' });
    await m.waitForSelector('.rl-garage__card[aria-selected="true"]');
    const first = (await m.getAttribute('.rl-garage__card[aria-selected="true"]', 'data-unit')) ?? '';
    const a = await settled(first);
    console.log(`[${TAG}] garage model: ${first} -> data-model=${a.model}${a.reason ? ` (${a.reason})` : ''}`);
    expect(a.model === 'live', `garage model: ${first} did not reach "live" on a WebGL2 runner: ${JSON.stringify(a)}`);
    await m.evaluate(STASH('__rlModelA'));

    // On demand: the view's own frame count (`stats().frames`, mirrored to
    // `data-frames` after each draw) must not move while nothing happens.
    const frames = (): Promise<number> =>
      m.evaluate<number>('Number(document.querySelector(".rl-garage__model").getAttribute("data-frames"))');
    const idle0 = await frames();
    await m.waitForTimeout(2000);
    const idle1 = await frames();
    console.log(`[${TAG}] garage model: ${idle1 - idle0} frame(s) drawn in 2 s idle (frames ${idle0} -> ${idle1})`);
    expect(idle0 >= 1, `garage model: the view reports ${idle0} frames, so not even its first was counted`);
    expect(idle1 === idle0, `garage model: an idle bay drew ${idle1 - idle0} frame(s) in 2 s; it must draw none`);

    // A real key press on the focused control turns it one step, and draws.
    await m.focus('.rl-garage__model');
    await m.keyboard.press('ArrowRight');
    const turned = await m.getAttribute('.rl-garage__model', 'aria-valuenow');
    expect(turned === '15', `garage model: one ArrowRight read aria-valuenow=${turned}, expected 15`);
    await m.waitForFunction(`Number(document.querySelector(".rl-garage__model").getAttribute("data-frames")) > ${idle1}`);

    // Page to another unit: the first context must be given back.
    const second = first === 'at_team' ? 'mbt_lavi' : 'at_team';
    await m.click(`.rl-garage__card[data-unit="${second}"]`);
    const b = await settled(second);
    expect(b.model === 'live', `garage model: ${second} did not reach "live": ${JSON.stringify(b)}`);
    const aAfter = await m.evaluate<LostRead>(LOST('__rlModelA'));
    console.log(`[${TAG}] garage model: paged ${first} -> ${second}; ${first}'s context lost=${String(aAfter.lost)}`);
    expect(aAfter.stashed, `garage model: no canvas was stashed for ${first}`);
    expect(aAfter.lost === true, `garage model: paging from ${first} to ${second} left ${first}'s WebGL context alive`);

    // Paging FAST: five cards clicked back to back. The bay must end with
    // exactly one live context, and it must be the one on screen; every
    // other context the page made -- any unit that got far enough to make
    // one, and the WebGL2 probe -- must be lost.
    const rail = await m.$$eval('.rl-garage__card', (els) => els.map((e) => e.getAttribute('data-unit') ?? ''));
    const burst = rail.filter((id) => id !== second && id !== '').slice(0, 5);
    for (const id of burst) await m.click(`.rl-garage__card[data-unit="${id}"]`);
    const last = burst[burst.length - 1];
    const c = await settled(last);
    expect(c.model === 'live', `garage model: after paging fast, ${last} did not reach "live": ${JSON.stringify(c)}`);
    await m.waitForTimeout(500);
    const gl = await m.evaluate<{ made: number; live: number; liveIsShown: boolean; shown: number }>(
      '(() => { var shown = document.querySelectorAll(".rl-garage__model canvas");' +
        ' var live = window.__rlGl.filter(function (e) { return !e.g.isContextLost(); });' +
        ' return { made: window.__rlGl.length, live: live.length, shown: shown.length,' +
        '  liveIsShown: live.length === 1 && shown.length === 1 && live[0].c === shown[0] }; })()'
    );
    console.log(
      `[${TAG}] garage model: paged fast through ${burst.join(', ')}; ${gl.made} WebGL2 context(s) made in all, ` +
        `${gl.live} live, ${gl.shown} canvas on screen`
    );
    expect(gl.shown === 1, `garage model: ${gl.shown} model canvases in the bay after paging fast, expected 1`);
    expect(gl.live === 1, `garage model: ${gl.live} WebGL2 contexts still live after paging fast, expected exactly 1`);
    expect(gl.liveIsShown, 'garage model: the one live context after paging fast is not the canvas on screen');
    await m.evaluate(STASH('__rlModelB'));

    // A SOFT leave, through the garage's own link: the router's disposer.
    const leaveFrom = modelWarnings.length;
    await m.click('.rl-menu--garage a[href="/"]');
    await m.waitForSelector('a[href="/campaign"]');
    await m.waitForTimeout(750);
    const bAfter = await m.evaluate<LostRead>(LOST('__rlModelB'));
    const boots = await m.evaluate<number>('performance.getEntriesByName("rl:boot").length');
    console.log(
      `[${TAG}] garage model: soft leave to the menu; ${last}'s context lost=${String(bAfter.lost)}, boots=${boots}`
    );
    expect(boots === 1, `garage model: the menu link reloaded the page (boots=${boots}), so this was not a soft leave`);
    expect(bAfter.stashed, `garage model: no canvas was stashed for ${last}`);
    expect(bAfter.lost === true, `garage model: a soft leave of the garage left ${last}'s WebGL context alive`);
    // The garage's own leave, not the menu it lands on: under this context's
    // reduced motion the menu's scene host warns that it is keeping its
    // plate, which is that screen's correct path and nothing this leave did.
    const GARAGE_LEAVE_WARNING = /WebGL|loseContext|DRACO|Worker|garage model/i;
    const bad = modelWarnings
      .slice(leaveFrom)
      .filter((w) => GARAGE_LEAVE_WARNING.test(w) && !NOT_A_LEAVE_WARNING.test(w));
    for (const w of bad) expect(false, `garage model: the garage's leave logged a warning: ${w.slice(0, 300)}`);
    await modelCtx.close();
  }

  // --- the garage buys in place (WP-S3g F3) ------------------------------
  // The old remount read ONE flat colour for ~210 ms (spec F3, capture
  // `05-buy-upgrade-120ms`), then landed the bay on the first card with focus
  // on <body>. Everything below is a DOM read in the real page -- jsdom
  // cannot clamp a scroller or paint a frame.
  //
  // A fresh account has nothing to upgrade: `mbt_lavi`, the seeded page's own
  // opening bay, is already fully kitted and shows no Buy at all (controller
  // ruling T9/T11). `at_team` is the seed's own part-kitted unit -- firepower
  // tier 1 owned, tier 2's Buy at 175 credits still on the board -- so this
  // leg selects it before it ever looks for a Buy to click.
  //
  // `GARAGE_ARM` and `GARAGE_READ` are plain strings, not functions, for the
  // same reason `frameCadence` above is: tsx/esbuild's `keepNames` transform
  // rewrites a named const's inner arrow with a `__name` helper the page does
  // not have, and `Function.prototype.toString()` -- how Playwright ships a
  // callback into the page -- carries that rewritten text straight into a
  // browser context with no `__name` global.
  //
  // `GARAGE_ARM` stashes the screen's own root node under a name of our own
  // (`__rlGarage`) BEFORE the click, so "did the purchase replace the screen"
  // can be answered by identity afterwards -- the same technique the scene-host
  // legs above use for a canvas that a leave would otherwise remove out from
  // under a later read. It also parks the rail's scroll at 120 (the purchase
  // must not reset it) and starts a 40-frame `requestAnimationFrame` loop that
  // counts every frame `.rl-garage__card` is absent from the DOM -- a remount
  // blanks the screen for a real span of frames, not a single microtask, so a
  // frame-counted window catches it where a single post-click read would not.
  const GARAGE_ARM =
    'window.__rlGarage = document.querySelector(".rl-menu--garage");' +
    'var rail = document.querySelector(".rl-garage__cards");' +
    'if (rail) rail.scrollTop = 120;' +
    'window.__rlBlank = 0;' +
    'window.__rlFrames = 0;' +
    '(function loop() {' +
    '  if (!document.querySelector(".rl-garage__card")) window.__rlBlank += 1;' +
    '  window.__rlFrames += 1;' +
    '  if (window.__rlFrames < 40) requestAnimationFrame(loop);' +
    '})();';
  // Fix round 1 (Task 4 review): the plain purchase above never falsifies the
  // `rail` assertion on its OWN, and that is a real finding, not a mistake in
  // this leg -- `renderCards()` clears `.rl-garage__cards` with a bare
  // `replaceChildren()` and repopulates it synchronously, in one JS task, so
  // Chromium's batched layout never lays the rail out while it is transiently
  // empty and its stored scroll offset is never actually clamped, whichever
  // unit is bought. The OLD full-remount bug (falsification (a) above) forced
  // exactly this for free, because it threw away the whole `.rl-garage__cards`
  // DOM node and built a fresh one (default scrollTop 0) -- this harness has
  // no such node swap to lean on for an in-place purchase, so it manufactures
  // the same forced-empty-layout moment directly, scoped to this one element
  // on this one page, so `rail` is an assertion this leg can actually fail.
  //
  // `GARAGE_FORCE_RAIL_REFLOW` wraps `.rl-garage__cards`'s own
  // `replaceChildren` (an instance property shadowing the prototype method,
  // never touching `brigade.ts`) so that the call `renderCards()` already
  // makes to CLEAR the rail also forces a synchronous layout read
  // (`void cards.offsetHeight`) while it is empty -- the moment a real
  // browser would clamp the stored scroll offset to 0. `renderCards()`'s own
  // subsequent `appendChild` loop (unwrapped, unaffected) then repopulates it
  // exactly as it always does; the restore lines in `answer()` are what put
  // the offset back afterward, and this exists so their absence has
  // somewhere to be seen. `GARAGE_RESTORE_RAIL_REFLOW` puts the original
  // method back once this leg's own assertions are done, so nothing about
  // `.rl-garage__cards` outlives this block (belt and braces over the context
  // close right after).
  const GARAGE_FORCE_RAIL_REFLOW =
    '(() => {' +
    '  var cards = document.querySelector(".rl-garage__cards");' +
    '  if (!cards) return;' +
    '  var orig = cards.replaceChildren.bind(cards);' +
    '  window.__rlRailReplaceChildren = orig;' +
    '  cards.replaceChildren = function (...args) {' +
    '    orig(...args);' +
    '    void cards.offsetHeight;' + // force the layout a real remount used to force for free
    '  };' +
    '})()';
  const GARAGE_RESTORE_RAIL_REFLOW =
    '(() => {' +
    '  var cards = document.querySelector(".rl-garage__cards");' +
    '  if (cards && window.__rlRailReplaceChildren) cards.replaceChildren = window.__rlRailReplaceChildren;' +
    '  delete window.__rlRailReplaceChildren;' +
    '})()';
  const GARAGE_READ =
    '(() => {' +
    '  var wrap = document.querySelector(".rl-menu--garage");' +
    '  var selected = document.querySelector(\'.rl-garage__card[aria-selected="true"]\');' +
    '  var walletN = document.querySelector(".rl-garage__wallet-n");' +
    '  var rail = document.querySelector(".rl-garage__cards");' +
    '  var focused = document.activeElement;' +
    '  return {' +
    '    same: wrap !== null && wrap === window.__rlGarage,' +
    '    blank: window.__rlBlank,' +
    '    selected: selected ? selected.getAttribute("data-unit") : null,' +
    '    focus: focused ? focused.getAttribute("data-focus-key") : null,' +
    '    rail: rail ? rail.scrollTop : null,' +
    '    value: walletN ? walletN.getAttribute("data-value") : null,' +
    '    boots: performance.getEntriesByName("rl:boot").length,' +
    '  };' +
    '})()';
  {
    const garageCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await garageCtx.addInitScript(garageSeedScript());
    const g = await garageCtx.newPage();
    g.setDefaultTimeout(ACTION_TIMEOUT_MS);
    // The same collectors the main `page` carries, attached to this page too:
    // a console error or a leave-shaped warning here must fail the run exactly
    // as it would on the main walk.
    g.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error') errors.push(m.text());
      else if (m.type() === 'warning') warnings.push(m.text());
    });
    g.on('pageerror', (e) => errors.push(String(e)));

    await g.goto(`http://localhost:${PORT}/brigade`, { waitUntil: 'load' });
    await g.waitForSelector('.rl-garage__card[data-unit="at_team"]');
    await g.click('.rl-garage__card[data-unit="at_team"]');
    // Scoped to this page and this one element; see the constant's own
    // comment for why the plain purchase below needs this to falsify `rail`
    // at all.
    await g.evaluate(GARAGE_FORCE_RAIL_REFLOW);
    await g.evaluate(GARAGE_ARM); // string: scroll the rail to 120, remember the screen node, start a 40-frame blank counter
    const railBefore = await g.$eval('.rl-garage__cards', (e) => e.scrollTop);
    // Fix round 1: the board is an accordion now, and `armour` -- at_team's
    // first non-maxed track -- opens by default, not firepower. Fix round 2,
    // issue 2 moved the accordion's own `mouseenter` from the whole track box
    // to its HEAD alone (a raw mouseenter of the box is what let a cursor
    // merely passing over an expanded neighbour on its way here resize the
    // board underneath, which is also what made a genuine `page.hover()` here
    // time out under round 1's own listener) -- a real hover now proves the
    // fix rather than routing around it.
    await g.hover('.rl-garage__track[data-track="firepower"] .rl-garage__track-head');
    await g.click('.rl-garage__track[data-track="firepower"] .rl-garage__buy-tier');
    await g.waitForFunction('window.__rlFrames >= 40');
    const after = await g.evaluate<{
      same: boolean;
      blank: number;
      selected: string | null;
      focus: string | null;
      rail: number | null;
      value: string | null;
      boots: number;
    }>(GARAGE_READ);
    console.log(`[${TAG}] garage buy: ${JSON.stringify(after)} (rail was ${railBefore})`);
    expect(after.same, 'garage: a purchase replaced the screen instead of re-rendering it in place (F3)');
    expect(after.blank === 0, `garage: ${after.blank} frame(s) with no roster on screen while the purchase landed (F3)`);
    expect(after.selected === 'at_team', `garage: the bay moved to "${after.selected}" after an at_team purchase (F3)`);
    expect(after.focus === 'buy:firepower', `garage: focus is on "${after.focus}", not the next firepower Buy (F3/F8)`);
    expect(Math.abs((after.rail ?? 0) - railBefore) <= 1, `garage: the rail scrolled from ${railBefore} to ${after.rail} (F3)`);
    expect(after.value === '2225', `garage: the wallet reads ${after.value}, expected 2400 - 175 = 2225`);
    expect(after.boots === 1, `garage: ${after.boots} boot marks -- the purchase reloaded the page`);
    await g.evaluate(GARAGE_RESTORE_RAIL_REFLOW);

    await garageCtx.close();
  }

  // --- one Enter, one tier (final review C1) --------------------------------
  //
  // The board's own Enter handler clicked the Buy and left the key's default
  // action alone. `answer()` then moves focus to the next tier's Buy (R-4),
  // and Chromium delivers the same press's activation to whatever is focused
  // by then -- so one Enter bought two tiers whenever the second was
  // affordable. jsdom runs no default actions, so only a REAL key press in a
  // real browser can see it: `page.keyboard.press('Enter')`, never a
  // synthetic `dispatchEvent`.
  //
  // Both keyboard paths the spec names, on the seed's part-kitted `at_team`
  // (armour 0, sensors 0, firepower 1; 2400 credits):
  //   A. a focused Buy -- firepower tier 2 (175). Tier 3 (250) is the one a
  //      double press would also take.
  //   B. the digit jump's landing -- '1' focuses armour's tier-1 rung (95);
  //      tier 2 (140) is the one a double press would also take.
  // Read off the ACCOUNT in localStorage, which is the store's own truth, and
  // cross-checked against the wallet the screen prints.
  const ACCOUNT_READ =
    '(() => {' +
    `  var raw = localStorage.getItem(${JSON.stringify(ACCOUNT_KEY)});` +
    '  var a = raw ? JSON.parse(raw) : null;' +
    '  var up = a && a.upgrades && a.upgrades.at_team ? a.upgrades.at_team : {};' +
    '  var w = document.querySelector(".rl-garage__wallet-n");' +
    '  return {' +
    '    balance: a ? a.balance : null,' +
    '    armour: up.armour || 0,' +
    '    firepower: up.firepower || 0,' +
    '    wallet: w ? w.getAttribute("data-value") : null,' +
    '    focus: document.activeElement ? document.activeElement.getAttribute("data-focus-key") : null,' +
    '  };' +
    '})()';
  {
    const enterCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await enterCtx.addInitScript(garageSeedScript());
    const e = await enterCtx.newPage();
    e.setDefaultTimeout(ACTION_TIMEOUT_MS);
    e.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    e.on('pageerror', (err) => errors.push(String(err)));
    await e.goto(`http://localhost:${PORT}/brigade`, { waitUntil: 'load' });
    await e.waitForSelector('.rl-garage__card[data-unit="at_team"]');
    await e.click('.rl-garage__card[data-unit="at_team"]');
    type AccountRead = { balance: number | null; armour: number; firepower: number; wallet: string | null; focus: string | null };
    const start = await e.evaluate<AccountRead>(ACCOUNT_READ);
    expect(
      start.balance === 2400 && start.firepower === 1 && start.armour === 0,
      `garage Enter: the seed is not the one this leg prices against: ${JSON.stringify(start)}`
    );

    // A: a focused Buy.
    await e.hover('.rl-garage__track[data-track="firepower"] .rl-garage__track-head');
    await e.locator('.rl-garage__track[data-track="firepower"] .rl-garage__buy-tier').focus();
    await e.keyboard.press('Enter');
    await e.waitForTimeout(300);
    const a = await e.evaluate<AccountRead>(ACCOUNT_READ);
    console.log(`[${TAG}] garage Enter on a focused Buy: ${JSON.stringify(a)}`);
    expect(
      a.firepower === 2 && a.balance === 2225 && a.wallet === '2225',
      `garage C1: one Enter on the firepower Buy left firepower ${a.firepower}, balance ${a.balance} ` +
        `(wallet ${a.wallet}) -- expected exactly one tier: 2, 2400 - 175 = 2225`
    );

    // B: the digit jump's landing, a focused rung.
    await e.keyboard.press('1');
    const landed = await e.evaluate<AccountRead>(ACCOUNT_READ);
    expect(landed.focus === 'rung:armour:1', `garage C1: '1' landed on "${landed.focus}", not armour's tier-1 rung`);
    await e.keyboard.press('Enter');
    await e.waitForTimeout(300);
    const b = await e.evaluate<AccountRead>(ACCOUNT_READ);
    console.log(`[${TAG}] garage Enter on a focused rung: ${JSON.stringify(b)}`);
    expect(
      b.armour === 1 && b.balance === 2130 && b.wallet === '2130',
      `garage C1: one Enter on armour's rung left armour ${b.armour}, balance ${b.balance} ` +
        `(wallet ${b.wallet}) -- expected exactly one tier: 1, 2225 - 95 = 2130`
    );
    await enterCtx.close();
  }

  // --- the garage's first Buy is heard (WP-S3g T11, spec §9 "First gesture") -
  //
  // Browsers build no sound before a user gesture, and the mixer's context is
  // made inside its own `pointerdown`/`keydown` listener (`audio.ts`'s
  // `attach()`), so the one Buy that could be silent is a session's FIRST.
  // Nothing in this context may therefore reach the page as a gesture before
  // it: `at_team` (the seed's part-kitted unit -- the page opens on `mbt_lavi`,
  // maxed, with no Buy anywhere) is selected with an UNTRUSTED `el.click()`
  // inside the page, which runs the card's click handler and dispatches no
  // `pointerdown` or `keydown` at all. Then the Buy is clicked for real.
  //
  // Two votes on sound, not one: an oscillator or buffer source was created
  // AND the context that made it reads `running` 500 ms later. Counting
  // sources alone passes on a context left `suspended`, which is silence. And
  // the first oscillator must not be 520 Hz -- `playUi`'s fallback, the
  // ALERT's falling tone, which is what a set with no arm of its own plays
  // (R-2). The recorder is an init script so it is in place before `main.ts`
  // can construct anything; `ctx` is whichever context actually made a voice.
  //
  // What "untrusted" buys here, measured: Playwright runs every
  // `page.evaluate` with `userGesture: true`, so the card click DOES hand the
  // page user activation -- a probe's `navigator.userActivation.hasBeenActive`
  // reads true after any evaluate. What it does not do is dispatch the
  // `pointerdown`/`keydown` the mixer listens for, so no AudioContext exists
  // until the real Buy (the `before` vote below). Without an evaluate this
  // shared browser does enforce the autoplay policy -- a context built at
  // load reads `suspended` -- and launching it with
  // `--autoplay-policy=user-gesture-required` measured LOOSER (`running`), so
  // there is no flag here on purpose. One break the `running` vote cannot
  // see: an `attach()` that builds its context eagerly at boot and never
  // resumes it still reads `running` here (measured) -- by inference, because
  // the evaluate's activation lets Chromium start a policy-suspended context
  // once a node starts. The `running` vote's red was shown with a context
  // suspended explicitly (`ctx.suspend()` in the gesture listener). That
  // eager build is what the CONSTRUCTOR count exists for (the final review's
  // parked item (a)): the recorder subclasses `AudioContext` itself, so a
  // context built at boot is counted whether or not it ever makes a voice,
  // and the leg requires zero at boot and zero after the untrusted click.
  const AUDIO_RECORDER =
    '(function () {' +
    '  var w = window; w.__rlAudio = { osc: [], buf: 0, ctx: null, constructed: 0 };' +
    '  var C = w.AudioContext || w.webkitAudioContext; if (!C) return;' +
    // Counted at the constructor, not at the first voice: a context built at
    // boot and never used is exactly what "no context before the first
    // gesture" forbids, and it makes no voice to be counted by.
    '  var Counted = class extends C { constructor(o) { super(o); w.__rlAudio.constructed++; } };' +
    '  w.AudioContext = Counted; if (w.webkitAudioContext) w.webkitAudioContext = Counted;' +
    '  var mk = C.prototype.createOscillator;' +
    '  C.prototype.createOscillator = function () {' +
    '    var o = mk.call(this); var rec = { f: null }; w.__rlAudio.osc.push(rec); w.__rlAudio.ctx = this;' +
    '    setTimeout(function () { rec.f = o.frequency.value; }, 0); return o;' +
    '  };' +
    '  var mb = C.prototype.createBufferSource;' +
    '  C.prototype.createBufferSource = function () { w.__rlAudio.buf++; w.__rlAudio.ctx = this; return mb.call(this); };' +
    '})();';
  const AUDIO_READ =
    '(() => ({' +
    '  osc: window.__rlAudio.osc.map(function (r) { return r.f; }),' +
    '  buf: window.__rlAudio.buf,' +
    '  state: window.__rlAudio.ctx ? window.__rlAudio.ctx.state : null,' +
    '  constructed: window.__rlAudio.constructed,' +
    '}))()';
  {
    const soundCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await soundCtx.addInitScript(garageSeedScript());
    await soundCtx.addInitScript(AUDIO_RECORDER);
    const s = await soundCtx.newPage();
    s.setDefaultTimeout(ACTION_TIMEOUT_MS);
    s.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error') errors.push(m.text());
      else if (m.type() === 'warning') warnings.push(m.text());
    });
    s.on('pageerror', (e) => errors.push(String(e)));

    await s.goto(`http://localhost:${PORT}/brigade`, { waitUntil: 'load' });
    await s.waitForSelector('.rl-garage__card[data-unit="at_team"]');
    // Parked item (a), closing the blind spot recorded above: nothing may have
    // BUILT an AudioContext before the untrusted click, voice or no voice.
    type AudioRead = { osc: (number | null)[]; buf: number; state: string | null; constructed: number };
    const booted = await s.evaluate<AudioRead>(AUDIO_READ);
    console.log(`[${TAG}] garage audio at boot: ${JSON.stringify(booted)}`);
    expect(
      booted.constructed === 0,
      `garage: ${booted.constructed} AudioContext(s) constructed before any gesture -- the mixer must wait for one`
    );
    // Untrusted, in the page: the card's own handler, and no gesture.
    await s.evaluate(
      '(() => { document.querySelector(\'.rl-garage__card[data-unit="at_team"]\').click(); })()'
    );
    await s.waitForSelector('.rl-garage__card[data-unit="at_team"][aria-selected="true"]');
    const before = await s.evaluate<AudioRead>(AUDIO_READ);
    expect(
      before.constructed === 0,
      `garage: ${before.constructed} AudioContext(s) constructed by the untrusted card click -- it is not a gesture`
    );
    expect(
      before.osc.length + before.buf === 0,
      `garage: ${before.osc.length + before.buf} voice(s) before the first Buy -- the leg is not testing a first gesture`
    );
    // The first gesture of the session, for real.
    await s.locator('.rl-garage__board .rl-garage__buy-tier:enabled:visible').first().click();
    await s.waitForTimeout(500);
    const heard = await s.evaluate<AudioRead>(AUDIO_READ);
    console.log(`[${TAG}] garage first Buy: ${JSON.stringify(heard)}`);
    expect(heard.osc.length + heard.buf > 0, "garage: a session's first Buy made no sound (spec §9)");
    expect(
      heard.state === 'running',
      `garage: the first Buy's AudioContext reads "${heard.state}" 500 ms later, not "running" -- nothing was heard (spec §9)`
    );
    if (heard.osc.length > 0) {
      expect(heard.osc[0] !== 520, "garage: the first Buy played the ALERT's falling tone (R-2)");
    }
    await soundCtx.close();
  }

  // Plus (WP-AU1 T12): a voiced order is one event per gesture, a burst is throttled, and Voices at 0 plays nothing.
  // --- unit voices (WP-AU1 T12, spec §2 N1 N2, §7) ---------------------------
  //
  // Driven with `?voicetick`, the dev-only placeholder (R-10): no voice line
  // is recorded yet, so without it every gesture plays nothing and "nothing
  // plays at Voices 0" could not fail. Each placeholder is ONE oscillator at a
  // frequency nothing else here uses, so the recorder can count voices apart
  // from the battle synth. `sel`/`goto` choose WHERE to look; every order is a
  // real input event through the real handler.
  {
    const VOICE_HZ = new Set<number>(Object.values(PLACEHOLDER_HZ));
    type VoiceEntry = { at: number; source: string; trigger: string | null; key: string | null; why: string; status: string | null };
    type VoiceRead = { entries: VoiceEntry[]; placeholder: boolean; osc: (number | null)[]; constructed: number };
    const VOICE_READ =
      '(() => { var log = window.__lions.voiceLog(); return { entries: log.entries,' +
      ' placeholder: log.stats.placeholder, osc: window.__rlAudio.osc.map(function (r) { return r.f; }),' +
      ' constructed: window.__rlAudio.constructed }; })()';
    const tones = (r: VoiceRead): number[] => r.osc.filter((f): f is number => f !== null && VOICE_HZ.has(f));
    // Only ORDER-sourced entries count a gesture (voice-runtime.ts's
    // `VoiceLogEntry.source`, 'order' | 'death'): the sandbox force keeps
    // fighting in the background while these legs run, and a death voiced in
    // the same window as a click would inflate a raw `entries.length` and
    // read as an extra gesture that never happened.
    const orderEntries = (r: VoiceRead): VoiceEntry[] => r.entries.filter((e) => e.source === 'order');
    const orderCount = (r: VoiceRead): number => orderEntries(r).length;
    /** Poll (never a fixed sleep) until the log holds at least `n` order
     *  entries, or fail the run the same way every other `waitForFunction`
     *  here does. Kept as a page function inline rather than a stored named
     *  const, for `frameCadence`'s own `__name` reason. */
    const waitForOrderCount = (n: number): Promise<unknown> =>
      v.waitForFunction(
        (target: number) => {
          const w = window as unknown as { __lions: { voiceLog(): { entries: { source: string }[] } } };
          return w.__lions.voiceLog().entries.filter((e) => e.source === 'order').length >= target;
        },
        n,
        { timeout: ACTION_TIMEOUT_MS }
      );

    const vCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await vCtx.addInitScript(AUDIO_RECORDER);
    const v = await vCtx.newPage();
    v.setDefaultTimeout(ACTION_TIMEOUT_MS);
    v.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    v.on('pageerror', (e) => errors.push(String(e)));
    await v.goto(`http://localhost:${PORT}/free-play/beit_sahwan_outskirts?voicetick`, { waitUntil: 'load' });
    await v.waitForFunction('window.__lions !== undefined', null, { timeout: 90_000 });
    const read = (): Promise<VoiceRead> => v.evaluate<VoiceRead>(VOICE_READ);

    const booted = await read();
    console.log(`[${TAG}] voices at boot: placeholder=${booted.placeholder} contexts=${booted.constructed}`);
    expect(booted.placeholder, 'voices: ?voicetick did not reach the mixer -- the legs below would test nothing (R-10)');
    expect(booted.constructed === 0, `voices: ${booted.constructed} AudioContext(s) on a mission before any gesture`);

    const units = await v.evaluate<{ id: number; type: string; x: number; y: number }[]>('window.__lions.units()');
    const inf = units.find((u) => u.type === 'inf_squad');
    const lavi = units.find((u) => u.type === 'mbt_lavi');
    if (!inf || !lavi) throw new Error(`[${TAG}] voices: the sandbox force has no inf_squad or no mbt_lavi`);
    /** Centre the camera on `at`, select `ids`, and return `at`'s page point. */
    const aim = (ids: number[], at: { x: number; y: number }): Promise<{ x: number; y: number }> =>
      v.evaluate(
        ({ ids, at }) => {
          const L = (window as unknown as {
            __lions: {
              goto(x: number, y: number): unknown;
              sel(i: number[]): number[];
              renderer: { worldToScreen(x: number, y: number): { x: number; y: number } };
            };
          }).__lions;
          L.goto(at.x + 0.5, at.y + 0.5);
          L.sel(ids);
          const p = L.renderer.worldToScreen(at.x + 0.5, at.y + 0.5);
          const c = document.querySelector('#stage canvas');
          if (!c) throw new Error('no battlefield canvas');
          const r = c.getBoundingClientRect();
          return { x: r.left + p.x, y: r.top + p.y };
        },
        { ids, at }
      );

    // (a) One gesture, one voice event: the canvas, the minimap and a key.
    // Each step polls the log for its own order count rather than sleeping a
    // fixed 300ms: the flush this leg is waiting on is a queued microtask, not
    // a scheduled tone, so there is a real condition to wait on and a fixed
    // sleep either races it under load or wastes time that was never needed.
    const p = await aim([inf.id, lavi.id], inf);
    await v.mouse.click(p.x, p.y, { button: 'right' });
    await waitForOrderCount(1);
    const a1 = await read();
    console.log(`[${TAG}] voices (a) canvas: ${JSON.stringify(a1.entries)} tones=${tones(a1).join(',')}`);
    expect(orderCount(a1) === 1, `voices (a): one right-click made ${orderCount(a1)} order voice event(s), not 1 (N1)`);
    expect(
      a1.entries[0]?.key === 'he.infantry.move' && a1.entries[0]?.status === 'placeholder',
      `voices (a): expected he.infantry.move as a placeholder, got ${JSON.stringify(a1.entries[0])}`
    );
    expect(tones(a1).length === 1, `voices (a): ${tones(a1).length} voice tones for one gesture, not 1`);
    const mm = await v.locator('.rl-minimap').boundingBox();
    if (!mm) throw new Error(`[${TAG}] voices: no minimap`);
    await v.mouse.click(mm.x + mm.width / 2, mm.y + mm.height / 2, { button: 'right' });
    await waitForOrderCount(2);
    const a2 = await read();
    expect(
      orderCount(a2) === 2 && tones(a2).length === 2,
      `voices (a): the minimap order made ${orderCount(a2) - 1} events`
    );
    await v.keyboard.press('h');
    await waitForOrderCount(3);
    const a3 = await read();
    expect(
      orderCount(a3) === 3 && tones(a3).length === 3 && orderEntries(a3)[2]?.trigger === 'halt',
      `voices (a): the halt key made ${JSON.stringify(orderEntries(a3).slice(2))}`
    );

    // (b) A quick repeat is throttled (N2). Three right-clicks, each its own
    // gesture but with NO macrotask between them -- a `setTimeout(0)` yields to
    // the frame loop, and under SwiftShader a frame can cost seconds, so the
    // third click landed outside the director's own repeatWindowMs and opened a
    // fresh run instead of being throttled (observed on CI: a burst spanning
    // 7028.6ms, gh run 36301745600 job 108570532068). The runtime flushes a
    // gesture on a queued microtask (`deps.schedule = queueMicrotask`), so
    // waiting on two microtask turns after each dispatch lets that flush run
    // while never yielding to a frame -- three distinct gestures, no window to
    // outrun. Each is dispatched through the canvas's own `contextmenu`
    // listener (R-3).
    const q = await aim([lavi.id], lavi);
    const b0 = await read();
    await v.evaluate(async ({ x, y }) => {
      const c = document.querySelector('#stage canvas');
      if (!c) throw new Error('no battlefield canvas');
      for (let i = 0; i < 3; i++) {
        c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
        await new Promise<void>((r) => queueMicrotask(r));
        await new Promise<void>((r) => queueMicrotask(r));
      }
    }, q);
    await v.waitForTimeout(300);
    const b1 = await read();
    const burst = b1.entries.slice(b0.entries.length);
    console.log(`[${TAG}] voices (b) burst: ${JSON.stringify(burst)}`);
    expect(burst.length === 3, `voices (b): a three-click burst produced ${burst.length} log entries, not 3`);
    const burstSpan = (burst.at(-1)?.at ?? 0) - (burst[0]?.at ?? 0);
    expect(
      burstSpan < VOICE_TIMING.repeatWindowMs,
      `voices (b): the burst itself spanned ${burstSpan}ms, over the ${VOICE_TIMING.repeatWindowMs}ms repeat window -- ` +
        'this leg measures the runner, not the throttle; a slow runner opened a fresh run instead of repeating (N2)'
    );
    expect(
      burst.map((e) => e.why).join() === 'line,ack:repeat,silent:repeat',
      `voices (b): a three-click burst read ${burst.map((e) => e.why).join()} (N2)`
    );
    expect(
      burst.map((e) => e.key ?? '-').join() === 'he.crew.move,he.common.ack,-',
      `voices (b): keys ${burst.map((e) => e.key ?? '-').join()}`
    );
    const heard = tones(b1).slice(tones(b0).length);
    // A recorded line is a real take, not a placeholder tone: once
    // he.common.ack has a shipped variant the ack voice is heard as audio, and
    // only the move (he.crew.move is still empty) is a tone. Read from the
    // manifest so recording more lines does not need this leg edited again.
    const audioManifest = JSON.parse(
      fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data/audio.json'), 'utf8')
    ) as { voices: { lines: Record<string, { variants: unknown[] }> } };
    const ackRecorded = (audioManifest.voices.lines['he.common.ack']?.variants.length ?? 0) > 0;
    expect(
      heard.join() === (ackRecorded ? `${PLACEHOLDER_HZ.move}` : `${PLACEHOLDER_HZ.move},${PLACEHOLDER_HZ.ack}`),
      `voices (b): the burst sounded ${heard.join() || 'nothing'} -- the move as a tone, then the ack ` +
        `(${ackRecorded ? 'a recording, so no tone' : 'a tone'}), and a silence`
    );

    // (c) Voices at 0: nothing plays. The slider is driven through the pause
    // menu's own settings pane; its value is set and its own input/change
    // listeners fire (Playwright cannot fill a range input).
    await v.keyboard.press('Escape');
    await v.waitForSelector('.rl-pause');
    await v.locator('.rl-pause [data-tab="settings"]').click();
    await v.waitForSelector('.rl-pause input[name="voice"]');
    await v.evaluate(
      '(() => { var r = document.querySelector(\'.rl-pause input[name="voice"]\'); r.value = "0";' +
        ' r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); })()'
    );
    await v.locator('.rl-pause [data-act="resume"]').click();
    await v.waitForSelector('.rl-pause', { state: 'hidden' });
    const z = await aim([inf.id], inf);
    const c0 = await read();
    await v.mouse.click(z.x, z.y, { button: 'right' });
    await waitForOrderCount(orderCount(c0) + 1);
    const c1 = await read();
    const lastEntry = orderEntries(c1).at(-1);
    console.log(`[${TAG}] voices (c) at 0: ${JSON.stringify(lastEntry)} tones ${tones(c0).length} -> ${tones(c1).length}`);
    expect(orderCount(c1) === orderCount(c0) + 1, 'voices (c): the order at Voices 0 was not even decided');
    expect(lastEntry?.status === 'volume-zero', `voices (c): at Voices 0 the mixer said ${String(lastEntry?.status)}`);
    expect(tones(c1).length === tones(c0).length, 'voices (c): a voice sounded with Voices at 0');
    await vCtx.close();
  }

  // --- the garage fits the screen, measured (WP-S3g T9, F4, F9, §2 goal 3) --
  //
  // Task 7 shrank the box to the viewport and Task 6 capped the plate so the
  // stat panel stays in the bay; jsdom lays out nothing, so no unit test can
  // see a box bottom past the fold or a scrollbar on the board. Two units,
  // because a box that fits one unit's board can still overflow another's:
  // `mbt_lavi` (the seed's fully-kitted unit -- three tracks, every rung
  // `owned`, no Buy anywhere) and `at_team` (part-kitted -- firepower carries
  // a live `next` rung with its benefits and a Buy expanded). Three sizes,
  // because the board's own overflow budget is only asked of the two widest
  // (`garage-board.ts`'s own header: the wide-screen gist allowance).
  //
  // `FIT_READ`/`FIT_HOVER_READ` are strings, not functions, for the same
  // `__name` reason `GARAGE_ARM`/`GARAGE_READ` above are.
  const FIT_SIZES: readonly { width: number; height: number }[] = [
    { width: 1400, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ];
  const FIT_UNITS = ['mbt_lavi', 'at_team'] as const;
  const FIT_READ =
    '(() => {' +
    '  var wrap = document.querySelector(".rl-menu--garage");' +
    '  var stats = document.querySelector(".rl-garage__stats");' +
    '  var bay = document.querySelector(".rl-garage__bay");' +
    '  var board = document.querySelector(".rl-garage__board");' +
    '  var wr = wrap ? wrap.getBoundingClientRect() : null;' +
    '  var sr = stats ? stats.getBoundingClientRect() : null;' +
    '  var br = bay ? bay.getBoundingClientRect() : null;' +
    '  return {' +
    '    boxBottom: wr ? wr.bottom : null,' +
    '    innerHeight: window.innerHeight,' +
    '    statsBottom: sr ? sr.bottom : null,' +
    '    bayBottom: br ? br.bottom : null,' +
    '    boardOverflow: board ? board.scrollHeight - board.clientHeight : null,' +
    '  };' +
    '})()';
  // The garage's own trick a list cannot do (`brigade.ts`'s header): the
  // panel shows the change before the money is spent. That preview has to
  // land ON SCREEN to be worth anything, so this reads the AT team's
  // firepower `next` rung -- hovered, not clicked -- and its
  // `weapons[0].accuracy` reading, which `garage-stats.ts`'s `statBar` prints
  // as `{before} → {after}` only while a preview is live.
  const FIT_HOVER_READ =
    '(() => {' +
    '  var stat = document.querySelector(\'.rl-garage__stat[data-path="weapons[0].accuracy"] .rl-garage__stat-n\');' +
    '  var r = stat ? stat.getBoundingClientRect() : null;' +
    '  return {' +
    '    text: stat ? stat.textContent : null,' +
    '    top: r ? r.top : null,' +
    '    left: r ? r.left : null,' +
    '    bottom: r ? r.bottom : null,' +
    '    right: r ? r.right : null,' +
    '  };' +
    '})()';
  for (const { width, height } of FIT_SIZES) {
    for (const unit of FIT_UNITS) {
      const fitCtx = await browser.newContext({ viewport: { width, height } });
      await fitCtx.addInitScript(garageSeedScript());
      const f = await fitCtx.newPage();
      f.setDefaultTimeout(ACTION_TIMEOUT_MS);
      f.on('console', (m: ConsoleMessage) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      f.on('pageerror', (e) => errors.push(String(e)));
      await f.goto(`http://localhost:${PORT}/brigade`, { waitUntil: 'load' });
      await f.waitForSelector(`.rl-garage__card[data-unit="${unit}"]`);
      await f.click(`.rl-garage__card[data-unit="${unit}"]`);
      const m = await f.evaluate<{
        boxBottom: number | null;
        innerHeight: number;
        statsBottom: number | null;
        bayBottom: number | null;
        boardOverflow: number | null;
      }>(FIT_READ);
      console.log(
        `[${TAG}] garage fit ${width}x${height} ${unit}: box bottom ${m.boxBottom}/${m.innerHeight}, ` +
          `stats ${m.statsBottom} vs bay ${m.bayBottom}, board overflow ${m.boardOverflow}`
      );
      expect(
        m.boxBottom !== null && m.boxBottom <= m.innerHeight + 0.5,
        `garage ${width}x${height} ${unit}: the screen ends ${((m.boxBottom ?? 0) - m.innerHeight).toFixed(1)}px below the viewport (F9)`
      );
      expect(
        m.statsBottom !== null && m.bayBottom !== null && m.statsBottom <= m.bayBottom + 0.5,
        `garage ${width}x${height} ${unit}: the stat panel is scrolled out of the bay (F4)`
      );
      if (width === 1920 || width === 2560) {
        expect(
          m.boardOverflow !== null && m.boardOverflow <= 1,
          `garage ${width}x${height} ${unit}: the board scrolls ${m.boardOverflow}px: three tracks do not fit (§2 goal 3)`
        );
      }

      if (unit === 'at_team') {
        // Fix round 1: point at firepower first so the accordion expands it
        // -- `armour` (the first non-maxed track) is what opens by default,
        // and a rung under a collapsed track cannot be hovered at all. Real
        // hovers now (fix round 2, issue 2: `mouseenter` moved to the track's
        // HEAD alone, so a cursor crossing armour's box on the way here no
        // longer resizes anything under it).
        await f.hover('.rl-garage__track[data-track="firepower"] .rl-garage__track-head');
        await f.hover('.rl-garage__track[data-track="firepower"] .rl-garage__rung[data-state="next"]');
        const hv = await f.evaluate<{
          text: string | null;
          top: number | null;
          left: number | null;
          bottom: number | null;
          right: number | null;
        }>(FIT_HOVER_READ);
        const onScreen =
          hv.top !== null &&
          hv.left !== null &&
          hv.bottom !== null &&
          hv.right !== null &&
          hv.top >= 0 &&
          hv.left >= 0 &&
          hv.bottom <= height + 0.5 &&
          hv.right <= width + 0.5;
        console.log(`[${TAG}] garage fit ${width}x${height} at_team preview: "${hv.text}" onScreen=${onScreen}`);
        expect(
          hv.text !== null && hv.text.includes('→') && onScreen,
          `garage ${width}x${height}: the preview landed off-screen (F4)`
        );
      }

      await fitCtx.close();
    }
  }

  // --- the garage by keyboard: two Tab stops before the bay/board (F8) -----
  //
  // T9's controller ruling: the seeded screen opens on `mbt_lavi`, fully
  // kitted and Buy-less everywhere on its board, so a Tab walk from there
  // never reaches a real control under `.rl-garage__bay`/`.rl-garage__board`
  // at all -- this leg selects `at_team` first, the seed's own part-kitted
  // unit, so a Buy button actually exists to Tab onto.
  {
    const tabCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await tabCtx.addInitScript(garageSeedScript());
    const tPage = await tabCtx.newPage();
    tPage.setDefaultTimeout(ACTION_TIMEOUT_MS);
    tPage.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    tPage.on('pageerror', (e) => errors.push(String(e)));
    await tPage.goto(`http://localhost:${PORT}/brigade`, { waitUntil: 'load' });
    await tPage.waitForSelector('.rl-garage__card[data-unit="at_team"]');
    await tPage.click('.rl-garage__card[data-unit="at_team"]');
    await tPage.focus('.rl-garage__tab[aria-selected="true"]');
    // A string, not a function -- the same `__name` reason as above.
    const REACHED_BAY_OR_BOARD =
      '(() => document.activeElement !== null && ' +
      'document.activeElement.closest(".rl-garage__bay, .rl-garage__board") !== null)()';
    let presses = 0;
    let reached = false;
    while (presses < 10 && !reached) {
      await tPage.keyboard.press('Tab');
      presses += 1;
      reached = await tPage.evaluate<boolean>(REACHED_BAY_OR_BOARD);
    }
    console.log(`[${TAG}] garage F8: ${presses} Tab press(es) to reach the bay/board (reached=${reached})`);
    expect(reached && presses <= 3, `F8: ${presses} Tab stops before the bay (the audit counted 25)`);

    // I1 (final review): the accordion left ONE track's ladder in the Tab
    // order and nothing at all for the other two -- a collapsed ladder is
    // `display: none`, and the track heads were `tabIndex = -1` divs. Every
    // head is a button now, so the walk through the board must reach all
    // three, whichever is open; and a real Enter (or Space) on a collapsed
    // one must open it and say so through `aria-expanded`.
    const FOCUS_KEY = '(() => document.activeElement ? document.activeElement.getAttribute("data-focus-key") : null)()';
    const walked: (string | null)[] = [await tPage.evaluate<string | null>(FOCUS_KEY)];
    for (let i = 0; i < 15 && (await tPage.evaluate<boolean>(REACHED_BAY_OR_BOARD)); i++) {
      await tPage.keyboard.press('Tab');
      walked.push(await tPage.evaluate<string | null>(FOCUS_KEY));
    }
    const inBoard = walked.slice(0, -1); // the last press left the board
    console.log(`[${TAG}] garage I1: ${inBoard.length} Tab stop(s) in the bay/board: ${JSON.stringify(inBoard)}`);
    for (const track of ['armour', 'sensors', 'firepower']) {
      expect(inBoard.includes(`track:${track}`), `I1: Tab never reaches the ${track} track's head: ${JSON.stringify(inBoard)}`);
    }
    const HEAD_STATE =
      '(() => Array.prototype.map.call(document.querySelectorAll(".rl-garage__track"), function (t) {' +
      '  var h = t.querySelector(".rl-garage__track-head");' +
      '  return t.getAttribute("data-track") + ":" + t.getAttribute("data-expanded") + ":" + (h ? h.getAttribute("aria-expanded") : "-");' +
      '}).join(" "))()';
    for (const [track, key] of [['sensors', 'Enter'], ['firepower', ' ']] as const) {
      await tPage.locator(`.rl-garage__track[data-track="${track}"] .rl-garage__track-head`).focus();
      await tPage.keyboard.press(key === ' ' ? 'Space' : key);
      const heads = await tPage.evaluate<string>(HEAD_STATE);
      console.log(`[${TAG}] garage I1: ${key === ' ' ? 'Space' : key} on ${track}'s head -> ${heads}`);
      expect(heads.includes(`${track}:1:true`), `I1: ${key === ' ' ? 'Space' : key} on the ${track} head left it closed: ${heads}`);
    }

    // GH-243 (the final review's Minor): the accordion's collapsed ladder is
    // `display: none`, so a Shift+Tab walk BACK up the board landed on each
    // earlier track's head and skipped its Buy -- the Buy sits after the
    // head, and was not drawn when the browser picked the stop. Forward Tab
    // reached every one. Both directions must now reach every enabled Buy
    // the board holds (collapsed or not in the DOM, so read off the DOM, not
    // off the screen). The backward walk starts on the footer's first link,
    // which is also the "coming back into the board from below" case.
    const BUYS =
      '(() => Array.prototype.map.call(document.querySelectorAll(".rl-garage__board .rl-garage__buy-tier:not([disabled])"),' +
      ' function (b) { return b.getAttribute("data-focus-key"); }))()';
    const buys = await tPage.evaluate<string[]>(BUYS);
    expect(buys.length >= 2, `GH-243: at_team's board has ${buys.length} enabled Buy(s) -- the walk cannot test skipping`);
    // Forward: the I1 walk above, from the tab, before anything was pressed on a head.
    for (const k of buys) expect(inBoard.includes(k), `GH-243: forward Tab never reaches ${k}: ${JSON.stringify(inBoard)}`);
    await tPage.locator('.rl-endnav a').first().focus();
    const back: (string | null)[] = [];
    let entered = false;
    for (let i = 0; i < 20; i++) {
      await tPage.keyboard.press('Shift+Tab');
      const inside = await tPage.evaluate<boolean>(REACHED_BAY_OR_BOARD);
      if (entered && !inside) break;
      entered ||= inside;
      if (inside) back.push(await tPage.evaluate<string | null>(FOCUS_KEY));
    }
    console.log(`[${TAG}] garage GH-243: Shift+Tab stops in the bay/board: ${JSON.stringify(back)}`);
    for (const k of buys) expect(back.includes(k), `GH-243: Shift+Tab never reaches ${k}: ${JSON.stringify(back)}`);
    // Each Buy is reached right after the head BELOW it in the walk -- i.e.
    // the stop is its own track's Buy, then that track's head.
    for (const k of buys) {
      const at = back.indexOf(k);
      expect(
        at < 0 || back[at + 1] === `track:${k.slice(4)}`,
        `GH-243: Shift+Tab left ${k} for "${back[at + 1]}", not its own track's head: ${JSON.stringify(back)}`
      );
    }
    await tabCtx.close();
  }

  // --- the garage compares (GH-243, spec §4 "Comparison") ---------------
  //
  // Shift over a card ghosts that type's bars against the unit in the bay;
  // Shift+arrow does the same from the keyboard without moving the bay; and
  // the rail sorts by kit level beside the role tabs. Driven through real
  // key and pointer events -- the ghost's whole job is to follow a held key
  // and the pointer, which no console call exercises.
  {
    const cmpCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await cmpCtx.addInitScript(garageSeedScript());
    const c = await cmpCtx.newPage();
    c.setDefaultTimeout(ACTION_TIMEOUT_MS);
    c.on('console', (m: ConsoleMessage) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    c.on('pageerror', (e) => errors.push(String(e)));
    await c.goto(`http://localhost:${PORT}/brigade`, { waitUntil: 'load' });
    await c.waitForSelector('.rl-garage__card[data-unit="at_team"]');
    await c.click('.rl-garage__card[data-unit="at_team"]');
    const CMP_READ =
      '(() => { var g = document.querySelector(\'.rl-garage__stat[data-path="hull.hp"] .rl-garage__stat-ghost\');' +
      ' var n = document.querySelector(\'.rl-garage__stat[data-path="hull.hp"] .rl-garage__stat-n\');' +
      ' var cap = document.querySelector(".rl-garage__compare");' +
      ' var sel = document.querySelector(\'.rl-garage__card[aria-selected="true"]\');' +
      ' var cmp = document.querySelector(\'.rl-garage__card[data-compare="1"]\');' +
      ' var a = document.activeElement;' +
      ' return { ghostPx: g ? g.getBoundingClientRect().width : -1, ghostBorder: g ? getComputedStyle(g).borderTopStyle : null,' +
      '  figure: n ? n.textContent : null, caption: cap ? cap.textContent : null,' +
      '  selected: sel ? sel.getAttribute("data-unit") : null, compared: cmp ? cmp.getAttribute("data-unit") : null,' +
      '  focus: a ? a.getAttribute("data-unit") : null }; })()';
    type CmpRead = {
      ghostPx: number; ghostBorder: string | null; figure: string | null; caption: string | null;
      selected: string | null; compared: string | null; focus: string | null;
    };
    const laviName = await c.$eval('.rl-garage__card[data-unit="mbt_lavi"] .rl-garage__card-name', (e) => e.textContent ?? '');

    // The pointer over the Lavi's card, Shift up: nothing is compared.
    await c.hover('.rl-garage__card[data-unit="mbt_lavi"]');
    const idle = await c.evaluate<CmpRead>(CMP_READ);
    // Shift down, the pointer still there: the Lavi is ghosted over at_team.
    await c.keyboard.down('Shift');
    const held = await c.evaluate<CmpRead>(CMP_READ);
    const shotDir = path.join(REPO_ROOT, '.superpowers', 'gh243');
    if (process.env.UI_ROUTES_SHOTS === '1') {
      fs.mkdirSync(shotDir, { recursive: true });
      await c.screenshot({ path: path.join(shotDir, 'compare-shift-held.png') });
    }
    await c.keyboard.up('Shift');
    const released = await c.evaluate<CmpRead>(CMP_READ);
    console.log(`[${TAG}] garage compare: idle ${JSON.stringify(idle)} held ${JSON.stringify(held)} released ${JSON.stringify(released)}`);
    expect(idle.ghostPx === 0 && idle.caption === '' && idle.compared === null, `GH-243: a ghost with Shift up: ${JSON.stringify(idle)}`);
    expect(held.ghostPx > 0 && held.ghostBorder === 'dashed', `GH-243: Shift over the Lavi drew no ghost: ${JSON.stringify(held)}`);
    expect((held.caption ?? '').includes(laviName), `GH-243: the caption does not name the Lavi ("${laviName}"): ${JSON.stringify(held)}`);
    expect((held.figure ?? '').includes(' vs '), `GH-243: the hp figure does not read both units: ${JSON.stringify(held)}`);
    expect(held.selected === 'at_team' && held.compared === 'mbt_lavi', `GH-243: comparing moved the bay: ${JSON.stringify(held)}`);
    expect(released.ghostPx === 0 && released.caption === '', `GH-243: the ghost outlived Shift: ${JSON.stringify(released)}`);

    // By keyboard: Shift+ArrowDown walks the rail without selecting, and the
    // card it lands on is ghosted; the bay stays at_team.
    await c.mouse.move(0, 0);
    await c.locator('.rl-garage__card[data-unit="at_team"]').focus();
    await c.keyboard.down('Shift');
    await c.keyboard.press('ArrowDown');
    const walked = await c.evaluate<CmpRead>(CMP_READ);
    await c.keyboard.up('Shift');
    const walkedUp = await c.evaluate<CmpRead>(CMP_READ);
    console.log(`[${TAG}] garage compare by keyboard: ${JSON.stringify(walked)} then ${JSON.stringify(walkedUp)}`);
    expect(
      walked.focus !== null && walked.focus !== 'at_team' && walked.selected === 'at_team' && walked.compared === walked.focus,
      `GH-243: Shift+ArrowDown did not compare the next card without selecting it: ${JSON.stringify(walked)}`
    );
    expect(walkedUp.compared === null && walkedUp.selected === 'at_team', `GH-243: releasing Shift left: ${JSON.stringify(walkedUp)}`);

    // Sort by kit level: the seed's Lavi (9/9, L3) leads, and the levels
    // never rise down the rail.
    const KITS =
      '(() => Array.prototype.map.call(document.querySelectorAll(".rl-garage__card"),' +
      ' function (e) { return e.getAttribute("data-unit") + ":" + e.getAttribute("data-kit"); }))()';
    const before = await c.evaluate<string[]>(KITS);
    await c.click('.rl-garage__sort');
    const sorted = await c.evaluate<string[]>(KITS);
    const pressed = await c.getAttribute('.rl-garage__sort', 'aria-pressed');
    if (process.env.UI_ROUTES_SHOTS === '1') await c.screenshot({ path: path.join(shotDir, 'sort-by-kit.png') });
    console.log(`[${TAG}] garage sort by kit: ${JSON.stringify(sorted)} (was ${JSON.stringify(before)})`);
    const levels = sorted.map((e) => Number(e.split(':')[1]));
    expect(pressed === 'true', `GH-243: the sort toggle reads aria-pressed=${pressed}`);
    expect(sorted[0] === 'mbt_lavi:3', `GH-243: sorted by kit, the rail opens on ${sorted[0]}, not the seeded Lavi at L3`);
    expect(levels.every((l, i) => i === 0 || l <= levels[i - 1]), `GH-243: kit levels rise down a kit-sorted rail: ${JSON.stringify(sorted)}`);
    expect(sorted.length === before.length && JSON.stringify(sorted) !== JSON.stringify(before), 'GH-243: sorting by kit changed nothing');
    await cmpCtx.close();
  }

  // --- the HUD card does not jump for kit (final review, parked item (d)) --
  //
  // The kit pips sat in the card's top line at the garage's own size: a
  // content-box 0.375rem square plus a 1px border each side, so a three-tier
  // column stood taller than the line and a kitted card measured 16.7px
  // taller than the same unit's card without kit (162 vs 145.3 at
  // 1920x1080, before the fix) -- the card jumped as the selection moved
  // between a kitted type and an unkitted one. Same unit type, same map, two
  // accounts: the seed (inf_squad armour 2, sensors 1) and a fresh one. The
  // heights must be EQUAL, not merely close.
  const CARD_SELECT =
    '(() => { var L = window.__lions; if (!L) return false;' +
    ' var u = L.units().find(function (x) { return x.type === "inf_squad"; });' +
    ' if (!u) return false; L.sel([u.id]); return true; })()';
  const CARD_READ =
    '(() => { var c = document.querySelector(".rl-card");' +
    ' return { card: c ? c.getBoundingClientRect().height : null, kit: document.querySelector(".rl-card__kit") !== null }; })()';
  const cardHeights: { card: number | null; kit: boolean }[] = [];
  for (const seeded of [false, true]) {
    const cardCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    if (seeded) await cardCtx.addInitScript(garageSeedScript());
    const c = await cardCtx.newPage();
    c.setDefaultTimeout(ACTION_TIMEOUT_MS);
    c.on('pageerror', (err) => errors.push(String(err)));
    await c.goto(`http://localhost:${PORT}/free-play/beit_sahwan_outskirts`, { waitUntil: 'load' });
    await c.waitForFunction('window.__lions !== undefined', null, { timeout: 90_000 });
    expect(await c.evaluate<boolean>(CARD_SELECT), 'HUD card: the sandbox force has no inf_squad to select');
    await c.waitForSelector('.rl-card');
    await c.waitForTimeout(300);
    cardHeights.push(await c.evaluate<{ card: number | null; kit: boolean }>(CARD_READ));
    await cardCtx.close();
  }
  console.log(`[${TAG}] HUD card height, no kit vs kitted: ${JSON.stringify(cardHeights)}`);
  expect(
    cardHeights[0].kit === false && cardHeights[1].kit === true,
    `HUD card: the two accounts did not produce one card without kit and one with: ${JSON.stringify(cardHeights)}`
  );
  expect(
    cardHeights[0].card !== null && cardHeights[0].card === cardHeights[1].card,
    `HUD card (d): ${cardHeights[1].card}px kitted vs ${cardHeights[0].card}px without kit -- the card jumps`
  );

  // --- the kit sign on every icon (WP-S3g plan 2b, T7) ---
  //
  // `kit-icons.ts`'s `kitIconFailures` is the reference-free verdict; every
  // leg below only has to get an honest `IconRead[]` off the live DOM and
  // hand it over. Each leg opens its OWN context, so a seed never leaks into
  // a later leg (the isolation `garageStates` already uses), waits for
  // `window.__lions`, then 400 ms for the 4 Hz HUD rebuild before reading.
  const READ_ICONS =
    '(() => { var out = [];' +
    ' var box = function (e) { if (!e) return null; var r = e.getBoundingClientRect();' +
    '  return r.width > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };' +
    ' var sign = function (host) { var s = host ? host.querySelector(".rl-kit-icon") : null;' +
    '  return s ? { kit: s.getAttribute("data-kit"), rect: box(s) } : { kit: null, rect: null }; };' +
    ' document.querySelectorAll(".rl-chip").forEach(function (c) { var s = sign(c);' +
    '  out.push({ surface: "chip", type: c.getAttribute("data-type"), kit: s.kit, sign: s.rect,' +
    '   icon: box(c.querySelector(".rl-kit-host") || c.querySelector(".rl-chip__art")) }); });' +
    ' document.querySelectorAll(".rl-card").forEach(function (c) { var f = c.querySelector(".rl-card__frame"); var s = sign(f);' +
    '  out.push({ surface: "card", type: c.getAttribute("data-type"), kit: s.kit, sign: s.rect, icon: box(f) }); });' +
    ' document.querySelectorAll(".rl-tile[data-unit]").forEach(function (t) { var s = sign(t);' +
    '  out.push({ surface: "tile", type: t.getAttribute("data-unit"), kit: s.kit, sign: s.rect, icon: box(t),' +
    '   locked: t.getAttribute("data-locked") === "1" }); });' +
    ' return { reads: out, rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize) }; })()';
  const SELECT_ALL_OWN =
    '(() => { var L = window.__lions; if (!L) return 0; var ids = L.units().map(function (u) { return u.id; });' +
    ' L.sel(ids); return ids.length; })()';
  interface IconsPage {
    reads: IconRead[];
    rootPx: number;
  }
  const kitPage = async (
    urlPath: string,
    seed: boolean,
    where: string
  ): Promise<{ ctx: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newContext']>>; page: Page }> => {
    const ctx = await browser!.newContext({ viewport: { width: 1400, height: 900 } });
    if (seed) await ctx.addInitScript(garageSeedScript());
    const kp = await ctx.newPage();
    kp.setDefaultTimeout(ACTION_TIMEOUT_MS);
    kp.on('pageerror', (e) => errors.push(String(e)));
    await kp.goto(`http://localhost:${PORT}${urlPath}`, { waitUntil: 'load' });
    if (urlPath.startsWith('/mission/')) await dismissDeployGate(kp, where);
    await kp.waitForFunction('window.__lions !== undefined', null, { timeout: 90_000 });
    return { ctx, page: kp };
  };

  // --- K1: the ladder on the chips, at two resolutions ----------------------
  for (const viewport of [
    { width: 1400, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    const ctx = await browser.newContext({ viewport });
    const p = await ctx.newPage();
    p.setDefaultTimeout(ACTION_TIMEOUT_MS);
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(`http://localhost:${PORT}/free-play/beit_sahwan_outskirts?kit`, { waitUntil: 'load' });
    await p.waitForFunction('window.__lions !== undefined', null, { timeout: 90_000 });
    await p.waitForTimeout(400);
    const selected = await p.evaluate<number>(SELECT_ALL_OWN);
    await p.waitForTimeout(400);
    const { reads, rootPx } = await p.evaluate<IconsPage>(READ_ICONS);
    const chipReads = reads.filter((r) => r.surface === 'chip');
    const k1Failures = kitIconFailures(chipReads, SANDBOX_KIT_LEVELS, rootPx);
    console.log(
      `[${TAG}] K1 @ ${viewport.width}x${viewport.height}: ${selected} own unit(s) selected, ` +
        `${chipReads.length} chip(s) read at root ${rootPx}px, ${k1Failures.length} failure(s)`
    );
    expect(
      chipReads.length >= 8,
      `K1 @ ${viewport.width}x${viewport.height}: only ${chipReads.length} chip(s) read, need >= 8`
    );
    for (const f of k1Failures) expect(false, `K1 @ ${viewport.width}x${viewport.height}: ${f}`);
    await ctx.close();
  }

  // --- K2: the card, own then enemy ------------------------------------------
  {
    const { ctx, page: p } = await kitPage('/free-play/beit_sahwan_outskirts?kit', false, `${TAG} K2`);
    await p.waitForTimeout(400);
    const SELECT_LAVI =
      '(() => { var L = window.__lions; if (!L) return false;' +
      ' var u = L.units().find(function (x) { return x.type === "mbt_lavi"; }); if (!u) return false;' +
      ' L.sel([u.id]); return true; })()';
    expect(await p.evaluate<boolean>(SELECT_LAVI), 'K2: the sandbox force has no mbt_lavi to select');
    await p.waitForTimeout(400);
    const own = await p.evaluate<IconsPage>(READ_ICONS);
    const ownCard = own.reads.filter((r) => r.surface === 'card');
    const ownFailures = kitIconFailures(ownCard, { mbt_lavi: 3 }, own.rootPx);
    const pips = await p.evaluate<number>('document.querySelectorAll(".rl-kit-pips__pip[data-on=\\"1\\"]").length');
    console.log(
      `[${TAG}] K2 own mbt_lavi: ${ownCard.length} card(s) read, ${pips} lit pip(s), ${ownFailures.length} failure(s)`
    );
    for (const f of ownFailures) expect(false, `K2 (own): ${f}`);
    expect(pips === 9, `K2: the card holds ${pips} lit pip(s), want 9 -- the pips and the sign must agree`);

    const SELECT_ENEMY =
      '(() => { var L = window.__lions; if (!L) return false; var u = L.units(1)[0]; if (!u) return false;' +
      ' L.sel([u.id]); return true; })()';
    expect(await p.evaluate<boolean>(SELECT_ENEMY), 'K2: no enemy unit to select');
    await p.waitForTimeout(400);
    const enemy = await p.evaluate<IconsPage>(READ_ICONS);
    const enemyCard = enemy.reads.filter((r) => r.surface === 'card');
    const enemyFailures = kitIconFailures(enemyCard, {}, enemy.rootPx);
    console.log(`[${TAG}] K2 enemy: ${enemyCard.length} card(s) read, ${enemyFailures.length} failure(s)`);
    for (const f of enemyFailures) expect(false, `K2 (enemy): ${f}`);
    await ctx.close();
  }

  // --- K3: no layout change, chip and card alike -----------------------------
  {
    const READ_CHIP_HEIGHTS =
      '(() => { var out = {}; document.querySelectorAll(".rl-chip").forEach(function (c) {' +
      '  var t = c.getAttribute("data-type"); if (t) out[t] = c.getBoundingClientRect().height; }); return out; })()';
    const chipHeightsFor = async (withKit: boolean): Promise<Record<string, number>> => {
      const { ctx, page: p } = await kitPage(
        `/free-play/beit_sahwan_outskirts${withKit ? '?kit' : ''}`,
        false,
        `${TAG} K3`
      );
      await p.waitForTimeout(400);
      await p.evaluate(SELECT_ALL_OWN);
      await p.waitForTimeout(400);
      const heights = await p.evaluate<Record<string, number>>(READ_CHIP_HEIGHTS);
      await ctx.close();
      return heights;
    };
    const noKit = await chipHeightsFor(false);
    const kitted = await chipHeightsFor(true);
    const types = Object.keys(noKit).filter((t) => t in kitted);
    console.log(
      `[${TAG}] K3 chips: ${types.length} type(s) present with and without &kit: ` +
        `${JSON.stringify(noKit)} vs ${JSON.stringify(kitted)}`
    );
    expect(types.length > 0, 'K3: no chip type present with and without &kit to compare');
    for (const t of types) {
      expect(noKit[t] === kitted[t], `K3: chip ${t} height ${kitted[t]}px kitted vs ${noKit[t]}px without -- the chip jumps`);
    }

    const SELECT_LAVI =
      '(() => { var L = window.__lions; if (!L) return false;' +
      ' var u = L.units().find(function (x) { return x.type === "mbt_lavi"; }); if (!u) return false;' +
      ' L.sel([u.id]); return true; })()';
    const cardHeightFor = async (withKit: boolean): Promise<number | null> => {
      const { ctx, page: p } = await kitPage(
        `/free-play/beit_sahwan_outskirts${withKit ? '?kit' : ''}`,
        false,
        `${TAG} K3-card`
      );
      const ok = await p.evaluate<boolean>(SELECT_LAVI);
      await p.waitForTimeout(400);
      const h = ok
        ? await p.evaluate<number | null>(
            '(() => { var c = document.querySelector(".rl-card"); return c ? c.getBoundingClientRect().height : null; })()'
          )
        : null;
      await ctx.close();
      return h;
    };
    const cardNoKit = await cardHeightFor(false);
    const cardKit = await cardHeightFor(true);
    console.log(`[${TAG}] K3 card (mbt_lavi): ${cardNoKit}px without &kit vs ${cardKit}px with`);
    expect(
      cardNoKit !== null && cardNoKit === cardKit,
      `K3: card height ${cardKit}px kitted vs ${cardNoKit}px without -- the card jumps`
    );
  }

  // --- K4: the account pass, on a mission with a dock ------------------------
  // Beit Sahwan II since GH-345: First Light lost its `resources` (and with
  // them its dock), so the first dock-bearing mission is the foothold.
  {
    const { ctx, page: p } = await kitPage('/mission/beit_sahwan_2_foothold', true, `${TAG} K4`);
    await p.evaluate(() => (window as unknown as { __lions?: { step(n: number): void } }).__lions?.step(40));
    await p.waitForTimeout(400);
    const selected = await p.evaluate<number>(SELECT_ALL_OWN);
    await p.waitForTimeout(400);
    const { reads, rootPx } = await p.evaluate<IconsPage>(READ_ICONS);
    const expected: Record<string, number> = {};
    for (const id of Object.keys(GARAGE_SEED_ACCOUNT.upgrades)) {
      expected[id] = kitLevel(
        units[id as keyof typeof units] as unknown as UpgradableUnit,
        GARAGE_SEED_ACCOUNT.upgrades[id] ?? {}
      );
    }
    const tileReads = reads.filter((r) => r.surface === 'tile');
    const k4Failures = kitIconFailures(reads, expected, rootPx);
    console.log(
      `[${TAG}] K4: expected ${JSON.stringify(expected)}, ${selected} own unit(s) selected, ` +
        `${tileReads.length} tile(s) read, ${k4Failures.length} failure(s)`
    );
    expect(tileReads.length > 0, 'K4: no dock tile was read');
    for (const f of k4Failures) expect(false, `K4: ${f}`);
    await ctx.close();
  }

  // --- K5: a dev flag never changes a mission --------------------------------
  {
    const { ctx, page: p } = await kitPage('/mission/beit_sahwan_1_recon?kit', false, `${TAG} K5`);
    await p.waitForTimeout(400);
    await p.evaluate(SELECT_ALL_OWN);
    await p.waitForTimeout(400);
    const count = await p.evaluate<number>('document.querySelectorAll(".rl-kit-icon").length');
    console.log(`[${TAG}] K5: ${count} .rl-kit-icon element(s) on a mission booted with &kit`);
    expect(count === 0, `K5: &kit drew ${count} kit sign(s) on a mission -- a dev flag must never change one`);
    await ctx.close();
  }

  // --- K6: what the golden gate sees ------------------------------------------
  {
    const { ctx, page: p } = await kitPage('/free-play/beit_sahwan_outskirts', false, `${TAG} K6`);
    await p.waitForTimeout(400);
    await p.evaluate(SELECT_ALL_OWN);
    await p.waitForTimeout(400);
    const count = await p.evaluate<number>('document.querySelectorAll(".rl-kit-icon").length');
    console.log(`[${TAG}] K6: ${count} .rl-kit-icon element(s) on a fresh account with no &kit`);
    expect(count === 0, `K6: ${count} kit sign(s) drawn with no &kit -- this is what the golden gate boots`);
    await ctx.close();
  }

  expect(
    telemetryHits.length === 0,
    `telemetry is on in a dev/CI run (${telemetryHits.length} request(s)): ${telemetryHits.slice(0, 3).join(', ')}`,
  );
  expect(errors.length === 0, `console errors:\n   ${errors.join('\n   ')}`);
} finally {
  if (browser) await browser.close();
  stopDevServer(devServer, TAG);
}

// Explicit, and not decoration. `stopDevServer` kills the server's process
// GROUP and destroys its pipes, but playwright leaves handles of its own and an
// event loop with a live handle never drains -- the same failure that once sat
// in a CI step for 40 minutes after printing its error (CLAUDE.md, the visual
// gate's "And the script must EXIT").
if (failures.length > 0) {
  console.error(`[${TAG}] FAIL\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`[${TAG}] OK: one realm, two missions, no reload, nothing left behind`);
process.exit(0);
