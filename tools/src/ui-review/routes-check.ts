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
// Seen red: with `onDispose(() => cancelAnimationFrame(rafId))` commented out
// of `bootBattlefield`, this exits 1. The output of both runs is in this
// task's report.

import { chromium, type ConsoleMessage, type Page } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dismissDeployGate, ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { boardCanvasVerdict } from './board-canvases';
import { claimPort } from './port';

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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
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

  // GH-229: the dock's tooltip, opened on a tile below the first row, used to
  // land on top of the row above it (`tooltip.ts`'s `computeTipPosition`,
  // `production.ts`'s `clear: this.el`). The soft-booted mission above is
  // already a `resources` one (the comment below explains why), so its dock
  // is on the body right now -- reused rather than booting a fourth mission
  // just to hover a tile.
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
  expect(dockTip !== null, 'the soft-booted mission has no dock to test the tooltip on');
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

  // And leave THAT one too, which is not belt-and-braces: the board's first
  // card is a `resources` mission, and a mission with resources fields a
  // `ReinforcementDock` on the body that the two recon missions above do not.
  // Leaving only MISSION_A and MISSION_B left that dock unexamined, and it was
  // leaking -- found by reading the body-mount list rather than by this walk,
  // which is why the walk now covers it.
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
