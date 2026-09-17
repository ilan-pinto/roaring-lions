// The route walk: one JS realm, two missions, no reload, nothing left behind.
//
// Usage: pnpm ui:routes     (starts its own dev server on :5177, like ui:shots,
//                            and stops the one it started)
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
// Plus: any console error or page error at all fails the run. That is what
// catches the specific defect this task closes -- a frame loop that survives
// its own renderer keeps drawing into a disposed context and says so, loudly,
// in the console.
//
// Seen red: with `onDispose(() => cancelAnimationFrame(rafId))` commented out
// of `bootBattlefield`, this exits 1. The output of both runs is in this
// task's report.

import { chromium, type ConsoleMessage, type Page } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dismissDeployGate, ensureDevServer, stopDevServer } from '../golden-diff/browser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Its own port, so a run never fights `ui:shots` (5176) or the golden gate. */
const PORT = 5177;
const TAG = 'ui-routes';

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
}

const BODY_CHROME = ['.rl-strip', '.rl-minimap', '.rl-marquee', '.rl-bigbanner', '.rl-titlecard'];

async function probe(page: Page): Promise<Probe> {
  return page.evaluate((chrome: string[]) => {
    const w = window as unknown as { __lions?: { sim: { tickCount: number } } };
    return {
      boots: performance.getEntriesByName('rl:boot').length,
      lions: w.__lions !== undefined,
      tick: w.__lions ? w.__lions.sim.tickCount : null,
      bodyChildren: document.body.children.length,
      leftovers: chrome.filter((sel) => document.querySelector(sel) !== null),
    };
  }, BODY_CHROME);
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
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  // --- the menu, and the rest position everything else is measured against --
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForSelector('a[href="/campaign"]');
  const menu = await probe(page);
  expect(menu.boots === 1, `menu: boots=${menu.boots}, expected exactly 1`);
  expect(!menu.lions, 'window.__lions exists on the menu, which defines no battlefield');
  const idleBody = menu.bodyChildren;
  console.log(`[${TAG}] menu: ${idleBody} body children, boots=${menu.boots}`);

  // --- an in-app click to the campaign board -------------------------------
  await page.click('a[href="/campaign"]');
  await page.waitForSelector('.rl-world');
  const board = await probe(page);
  expect(board.boots === 1, `clicking Campaign reloaded the page: boots=${board.boots}`);

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

  const back = await probe(page);
  expect(back.boots === 1, `leaving mission A reloaded the page: boots=${back.boots}`);
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
  expect(b1.lions, 'the soft mission boot defined no window.__lions');
  expect(
    b1.tick !== null && b2.tick !== null && b2.tick > b1.tick,
    `the soft-booted mission did not tick: ${b1.tick} -> ${b2.tick}`
  );
  console.log(`[${TAG}] soft mission ticked ${b1.tick} -> ${b2.tick}, boots=${b1.boots}`);

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
