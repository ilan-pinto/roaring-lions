/**
 * Reference-free checks for whole SCREENS the scenario harness cannot frame.
 *
 * ## Why this exists, and it is one bug rather than a principle
 *
 * On 2026-09-08 Draco compression (level load time, step 4) made every
 * shipped GLB need a decoder, and the decoder path was set in exactly one
 * place -- `ThreeRenderer`'s constructor. The campaign board constructs no
 * `ThreeRenderer`, so `?campaign` fetched its diorama, threw
 * `No DRACOLoader instance provided`, and drew the flat PNG board. **CI was
 * green.** The visual gate's five scenarios are all `sandbox=` or `mission=`
 * URLs; nothing loads `?campaign` at all, so a whole screen broke and no gate
 * had an opinion.
 *
 * **And it failed SOFTLY, which is the part worth designing against.**
 * Falling back to the flat board is CORRECT behaviour for a browser with no
 * WebGL2, for a GLB that will not load, and for a scene graph failing the
 * campaign contract. So the screen did what it was built to do, looked
 * plausible, and the only evidence was one console warning. A pixel baseline
 * would not have helped either: the flat board is a legitimate picture.
 *
 * The check is therefore not "does it look right" but **"did it take the path
 * it should have taken"** -- on a browser that CAN do WebGL2, the diorama is
 * the only acceptable outcome, and a fallback is a failure whatever it draws.
 * Same family as the layer toggles: never ask what the frame looks like, ask
 * whether the thing that should have happened did.
 *
 * ## Why it is not a `Scenario`
 *
 * `Scenario` requires exactly one of `sandboxMap`/`mission`, a camera marker
 * or tile, and a tick to step to -- it is built around `window.__lions` and a
 * running sim. The campaign board has no sim, no camera and no `__lions`.
 * Loosening those invariants to fit one screen would weaken a harness whose
 * strictness is load-bearing, so this runs beside the scenarios instead,
 * sharing the same dev server and browser.
 */
import type { Browser, Page } from 'playwright';
import { PNG } from 'pngjs';
import { waitForHostCrossfade } from './browser';
import {
  FREEZE_FRAME_LOOP_SCRIPT,
  FREEZE_FRAME_LOOP_STATEMENTS,
  REPAINT_SCRIPT,
  hideHudExceptCanvas,
} from './capture-protocol';
import { colourRegister, registerDelta, withinRegister, type Register } from './register';

export interface ScreenCheckResult {
  readonly id: string;
  readonly ok: boolean;
  /** What the screen itself says it drew -- `wrap.dataset.board`, written by
   *  `worldmap3d.ts` on both paths. Read back off the DOM rather than
   *  recomputed, deliberately: the failure worth catching is a screen whose
   *  logic is right and whose wiring is not (the same reasoning
   *  `__lions.cursorKey()` carries). */
  readonly board: string | null;
  readonly hasCanvas: boolean;
  /** Console errors and warnings seen during the load, so a soft failure
   *  reports its own cause instead of leaving it to be re-derived. */
  readonly messages: readonly string[];
  readonly detail: string;
}

/**
 * Loads `?campaign` and requires the 3D diorama.
 *
 * `page` must be a fresh page on a browser with WebGL2 -- which SwiftShader
 * provides, and which every other scenario in this gate already depends on
 * (they draw three.js scenes). If that ever stops being true this check
 * fails, and it SHOULD: a runner that cannot draw the board cannot judge the
 * other five either.
 */
export async function checkCampaignBoard(page: Page, baseUrl: string): Promise<ScreenCheckResult> {
  const messages: string[] = [];
  const onConsole = (m: { type(): string; text(): string }): void => {
    const type = m.type();
    if (type === 'error' || type === 'warning') messages.push(`${type}: ${m.text().slice(0, 300)}`);
  };
  const onError = (e: Error): void => {
    messages.push(`pageerror: ${String(e).slice(0, 300)}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onError);
  try {
    await page.goto(`${baseUrl}?campaign`, { waitUntil: 'load' });
    // The board mounts behind a dynamic import and a ~3.8 MiB GLB, so the
    // overlay is in the DOM long before the canvas is. Wait for the screen's
    // own verdict rather than for a fixed delay.
    await page
      .waitForFunction(
        () => {
          const wrap = document.querySelector('.rl-world');
          return wrap instanceof HTMLElement && wrap.dataset.board === 'flat'
            ? true
            : !!document.querySelector('.rl-world__canvas canvas');
        },
        null,
        { timeout: 60_000 }
      )
      .catch(() => undefined);
    const seen = await page.evaluate(() => {
      const wrap = document.querySelector('.rl-world');
      return {
        board: wrap instanceof HTMLElement ? (wrap.dataset.board ?? null) : null,
        hasCanvas: !!document.querySelector('.rl-world__canvas canvas'),
      };
    });
    const ok = seen.board === 'diorama' && seen.hasCanvas;
    return {
      id: 'campaign-board',
      ok,
      board: seen.board,
      hasCanvas: seen.hasCanvas,
      messages,
      detail: ok
        ? 'the 3D diorama drew'
        : seen.board === 'flat'
          ? 'FELL BACK to the flat PNG board on a WebGL2-capable browser -- the diorama did not draw'
          : `no campaign board in the DOM at all (data-board=${String(seen.board)}, canvas=${seen.hasCanvas})`,
    };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onError);
  }
}

/**
 * `checkMenuSceneHost` -- the menu's own screen check (scene-host plan Task
 * 8, spec §3.6 "The screens check gains the menu"). Same family as
 * `checkCampaignBoard` and for the same reason: the host's fallback paths are
 * each individually CORRECT behaviour (a plate under `?renderer=pixi`, under
 * reduced motion, on a load failure...), so a stored pixel baseline cannot
 * tell a legitimate plate from a host that silently stopped drawing. This
 * asks which PATH the menu took, whether the canvas it drew is actually
 * contributing pixels, and whether the picture it drew is the same COLOUR as
 * the mission it is a diorama of -- three questions a byte-for-byte diff
 * cannot answer on its own.
 *
 * Three votes, all folded into one result so the gate's `screensOk` composes
 * with `checkCampaignBoard`'s exactly the way that file's own comment
 * demands (a later PASS must never overwrite an earlier FAIL):
 *
 *   1. PATH -- `data-host` must reach `live` within `MENU_HOST_WAIT_MS` on a
 *      WebGL2-capable runner (every runner this gate uses already is one --
 *      see `checkCampaignBoard`'s own header). Anything else (`plate`,
 *      `off`, or still `pending` at the deadline) is a path meant for a
 *      narrower/reduced-motion/no-WebGL2/failed-load player, none of which
 *      describes this browser.
 *   2. CONTRIBUTION -- the visible-toggle A/B `debug-layers.ts` and
 *      `baseline.ts`'s `layerChecks` already use for every OTHER layer,
 *      applied to the host's own canvas: freeze, photograph, hide the
 *      canvas, photograph again, and require the two FLANKS (outside
 *      `.rl-menu`'s own box, where the host is the only thing drawing) to
 *      differ by more than a measured floor. Reference-free and
 *      texture-proof for the same reason every other toggle here is: it
 *      never asks what the frame looks like, only whether the canvas
 *      contributes pixels a poster left in place, a lost context, or a
 *      black canvas all fail identically.
 *   3. REGISTER -- spec §3.7's acceptance, made runnable by `register.ts`:
 *      the host's own frame and a same-camera capture of the mission it is
 *      a diorama of must agree on mean luminance and mean saturation within
 *      `MENU_HOST_REGISTER_TOLERANCE`. Camera-for-camera on purpose (that
 *      file's own header) -- a different framing or a different fog state
 *      moves this by more than the tolerance for reasons that have nothing
 *      to do with a real regression (spec M17).
 *
 * Votes 2 and 3 are skipped (not merely failed) when vote 1 does not reach
 * "live": there is no host canvas to hide and no host frame to register
 * against, so running them would just restate vote 1's own failure in a
 * more confusing shape.
 */

/** 4x the spec's own 15 s reveal deadline (§3.3 (8)) -- headroom for a cold
 *  SwiftShader boot sharing the machine with the gate's other scenarios,
 *  the same margin `pnpm plate:host` gives itself. */
const MENU_HOST_WAIT_MS = 60_000;

/**
 * Vote 2's floor: the mean absolute channel delta (`diff.ts`'s own metric,
 * restricted to the two flanks outside `.rl-menu`) between a frame with the
 * host's canvas drawing and the same frame with that canvas hidden. Set by
 * the gate's own convention for a layer-check floor (`baseline.ts`'s
 * `layerChecks`): one third of the smallest of several measured runs, so
 * ordinary run-to-run noise cannot clear it by accident while a genuinely
 * blank, lost, or poster-stuck canvas still reads at or under it.
 *
 * Measured on this machine (SwiftShader, headless Chromium, the gate's own
 * `launchCaptureBrowser` launch path, 1920x1080, three independent runs of
 * `checkMenuSceneHost` against a freshly booted dev server, 2026-09-24):
 *   run 1: 91.3279
 *   run 2: 91.3279
 *   run 3: 91.3279
 * All three identical -- the host's first frame is deterministic under a
 * frozen loop on this GPU path, the same reason `baseline.ts`'s own layer
 * checks read bit-identical across repeated runs. Floor = min(...) / 3 =
 * 30.4426.
 */
export const MENU_HOST_CONTRIBUTION_FLOOR = 30.4426;

/** Spec §3.7's own pass band: within 10% of the mission's mean Y and S. */
const MENU_HOST_REGISTER_TOLERANCE = 0.1;

/** The map the diorama draws (`data/front/menu_diorama.json`) -- vote 3's
 *  "mission" half frames this SAME ground, never a copy of its rows. */
const MENU_HOST_MISSION_MAP = 'beit_sahwan_outskirts';

interface MenuHostDomState {
  readonly host: string | null;
  readonly reason: string | null;
  readonly ms: string | null;
  readonly motion: string | null;
  readonly camera: string | null;
  readonly zoom: string | null;
}

async function readMenuHostState(page: Page): Promise<MenuHostDomState> {
  return page.evaluate(() => {
    const el = document.querySelector('.rl-scene-host');
    return {
      host: el?.getAttribute('data-host') ?? null,
      reason: el?.getAttribute('data-host-reason') ?? null,
      ms: el?.getAttribute('data-host-ms') ?? null,
      motion: el?.getAttribute('data-host-motion') ?? null,
      camera: el?.getAttribute('data-host-camera') ?? null,
      zoom: el?.getAttribute('data-host-zoom') ?? null,
    };
  });
}

/** `data-host` starts `pending` and never returns to it (`scene-host.ts`'s
 *  own state machine) -- waiting for it to leave that state is waiting for
 *  the host to be DONE, whichever way it went. Never throws: a host that is
 *  still `pending` at the deadline is a result (vote 1 reports it), not a
 *  harness failure. */
async function waitForTerminalHost(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => document.querySelector('.rl-scene-host')?.getAttribute('data-host') !== 'pending',
      null,
      { timeout: MENU_HOST_WAIT_MS }
    )
    .catch(() => undefined);
}

interface MenuHostVote {
  readonly ok: boolean;
  readonly detail: string;
}

async function voteMenuHostPath(page: Page, messages: readonly string[]): Promise<MenuHostVote & { state: MenuHostDomState }> {
  await waitForTerminalHost(page);
  const state = await readMenuHostState(page);
  const ok = state.host === 'live';
  console.log(
    `[menu-scene-host] path: data-host=${String(state.host)} in ${String(state.ms)} ms` +
      `${state.motion !== null ? `, data-host-motion=${state.motion}` : ''}` +
      `${state.reason !== null ? `, data-host-reason=${state.reason}` : ''} -> ${ok ? 'PASS' : 'FAIL'}`
  );
  if (!ok) {
    for (const m of messages.slice(0, 5)) console.error(`[menu-scene-host]   ${m}`);
  }
  return {
    ok,
    state,
    detail: ok
      ? `reached "live" in ${String(state.ms)} ms`
      : `did not reach "live": data-host=${String(state.host)}, data-host-reason=${String(state.reason)}`,
  };
}

/** `diff.ts`'s `meanAbsChannelDelta`, restricted to the columns outside
 *  `menuBox` (full height): the two flanks the host's canvas is the only
 *  thing drawing into, since the middle third sits under `.rl-menu` itself
 *  (spec §3.2, "Composition around the column"). */
function flankMeanAbsChannelDelta(
  a: Buffer,
  b: Buffer,
  width: number,
  height: number,
  menuBox: { readonly x: number; readonly width: number }
): number {
  const left = Math.max(0, Math.round(menuBox.x));
  const right = Math.min(width, Math.round(menuBox.x + menuBox.width));
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= left && x < right) continue;
      const i = (y * width + x) * 4;
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      count += 1;
    }
  }
  return count > 0 ? sum / (count * 3) : 0;
}

async function voteMenuHostContribution(page: Page): Promise<MenuHostVote> {
  const menuBox = await page.evaluate(() => {
    const menu = document.querySelector('.rl-menu');
    if (!(menu instanceof HTMLElement)) return null;
    const r = menu.getBoundingClientRect();
    return { x: r.x, width: r.width };
  });
  if (menuBox === null) {
    return { ok: false, detail: 'no .rl-menu in the DOM to flank -- cannot measure the host\'s contribution' };
  }
  // The poster must be OFF before "shown" is taken: `live` is stamped at the
  // start of the 400 ms crossfade, and a poster still on screen reads as the
  // host's own contribution (`waitForHostCrossfade`). A poster that never
  // comes off still fails this vote -- the wait is bounded and falls through.
  await waitForHostCrossfade(page);
  // Its own IIFE, never `FREEZE_FRAME_LOOP_SCRIPT`: that variant's return
  // statement reads `window.__lions.sim.tickCount`, and the menu route never
  // assigns `window.__lions` (`ui:routes` asserts exactly that), so it would
  // throw here.
  await page.evaluate(`(async () => {\n${FREEZE_FRAME_LOOP_STATEMENTS}\n})()`);
  const shown = PNG.sync.read(await page.screenshot());
  await page.evaluate(() => {
    const canvas = document.querySelector('.rl-scene-host__stage canvas');
    if (canvas instanceof HTMLElement) canvas.style.visibility = 'hidden';
  });
  const hidden = PNG.sync.read(await page.screenshot());
  const delta = flankMeanAbsChannelDelta(shown.data, hidden.data, shown.width, shown.height, menuBox);
  const ok = delta > MENU_HOST_CONTRIBUTION_FLOOR;
  console.log(
    `[menu-scene-host] contribution: meanAbsChannelDelta ${delta.toFixed(4)} over the flanks ` +
      `(floor ${MENU_HOST_CONTRIBUTION_FLOOR.toFixed(4)}) -> ${ok ? 'PASS' : 'FAIL'}`
  );
  return {
    ok,
    detail: ok
      ? `hiding the host's canvas moved the flanks by ${delta.toFixed(4)}`
      : `hiding the host's canvas moved the flanks by only ${delta.toFixed(4)}, at or under the ` +
        `${MENU_HOST_CONTRIBUTION_FLOOR.toFixed(4)} floor -- it is not contributing pixels`,
  };
}

interface MenuHostRegisterVote extends MenuHostVote {
  readonly host: Register;
  readonly mission: Register;
  readonly delta: { readonly dY: number; readonly dS: number };
}

const ZERO_REGISTER: Register = { meanY: 0, meanS: 0, samples: 0 };

async function voteMenuHostRegister(browser: Browser, baseUrl: string): Promise<MenuHostRegisterVote> {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const messages: string[] = [];
  const onConsole = (m: { type(): string; text(): string }): void => {
    const type = m.type();
    if (type === 'error' || type === 'warning') messages.push(`${type}: ${m.text().slice(0, 300)}`);
  };
  const onError = (e: Error): void => {
    messages.push(`pageerror: ${String(e).slice(0, 300)}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onError);
  try {
    await page.goto(baseUrl, { waitUntil: 'load' });
    await waitForTerminalHost(page);
    const state = await readMenuHostState(page);
    if (state.host !== 'live' || state.camera === null || state.zoom === null) {
      const detail =
        `register vote skipped: data-host=${String(state.host)}, ` +
        `data-host-camera=${String(state.camera)}, data-host-zoom=${String(state.zoom)}`;
      console.log(`[menu-scene-host] register: ${detail} -> FAIL`);
      return { ok: false, host: ZERO_REGISTER, mission: ZERO_REGISTER, delta: { dY: 0, dS: 0 }, detail };
    }
    const [xRaw, yRaw] = state.camera.split(',');
    const camera = { x: Number(xRaw), y: Number(yRaw), zoom: Number(state.zoom) };
    // The host's LIVE frame is what is registered, never the poster fading
    // off it (`waitForHostCrossfade`).
    await waitForHostCrossfade(page);

    // The menu at 1920x1080 with `.rl-menu` hidden and the host live (spec
    // §3.7). Hiding it does not resize `.rl-scene-host` -- that element is
    // `position: absolute; inset: 0` on its own stage, independent of the
    // menu's own layout (`theme.css`) -- so no resize/re-zoom follows the
    // way one does after `plate:host`'s `--host-bleed` change.
    await page.evaluate(() => {
      const menu = document.querySelector('.rl-menu');
      if (menu instanceof HTMLElement) menu.style.display = 'none';
    });
    await page.evaluate(`(async () => {\n${FREEZE_FRAME_LOOP_STATEMENTS}\n})()`);
    const hostPng = PNG.sync.read(await page.screenshot());
    const host = colourRegister(hostPng.data, hostPng.width, hostPng.height);

    // Then the sandbox of the diorama's own map, at the host's own camera
    // and zoom, overlays off, fog revealed, HUD stripped -- camera-for-camera
    // is the whole point (register.ts's own header, spec M17).
    const missionUrl = new URL(`free-play/${MENU_HOST_MISSION_MAP}`, baseUrl).toString();
    await page.goto(missionUrl, { waitUntil: 'load' });
    await page
      .waitForFunction(
        () => (window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer !== undefined,
        null,
        { timeout: MENU_HOST_WAIT_MS }
      )
      .catch(() => undefined);
    // The wait above swallows its own timeout (`.catch(() => undefined)`), so
    // a mission page that never boots -- a bad map id, a broken sandbox route
    // -- falls through silently unless this is checked explicitly. Without
    // it the very next line's `w.__lions.renderer.setDebugLayerVisible(...)`
    // throws a bare TypeError that nothing here catches, which used to abort
    // the whole gate (`EXIT_USAGE`, a stack trace) instead of failing one
    // vote with a named cause -- the same mistake `checkCampaignBoard`'s own
    // header describes for a screen that fails softly. Mirrors the host-side
    // guard just above (`state.host !== 'live'`).
    const rendererReady = await page.evaluate(
      () => (window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer !== undefined
    );
    if (!rendererReady) {
      const detail = 'the mission page never exposed __lions.renderer within 60 s';
      console.log(`[menu-scene-host] register: ${detail} -> FAIL`);
      for (const m of messages.slice(0, 5)) console.error(`[menu-scene-host]   ${m}`);
      return { ok: false, host, mission: ZERO_REGISTER, delta: { dY: 0, dS: 0 }, detail };
    }
    await page.evaluate((c: { x: number; y: number; zoom: number }) => {
      const w = window as unknown as {
        __lions: {
          renderer: {
            setDebugLayerVisible: (layer: string, visible: boolean) => unknown;
            camera: { x: number; y: number; zoom: number };
          };
        };
      };
      w.__lions.renderer.setDebugLayerVisible('overlays', false);
      w.__lions.renderer.setDebugLayerVisible('fog', false);
      w.__lions.renderer.camera.x = c.x;
      w.__lions.renderer.camera.y = c.y;
      w.__lions.renderer.camera.zoom = c.zoom;
    }, camera);
    await page.evaluate(hideHudExceptCanvas);
    // Freeze the app's frame loop first, so the repaint below is the frame
    // the screenshot sees rather than whichever one the still-running rAF
    // loop left on the compositor (CLAUDE.md, the visual gate: the tick the
    // script steps to is not the tick the screenshot sees). The full script,
    // not the bare statements: `__lions` exists on this page, and it is what
    // the script's return reads.
    await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
    await page.evaluate(REPAINT_SCRIPT);
    const missionPng = PNG.sync.read(await page.screenshot());
    const mission = colourRegister(missionPng.data, missionPng.width, missionPng.height);

    const delta = registerDelta(host, mission);
    const ok = withinRegister(host, mission, MENU_HOST_REGISTER_TOLERANCE);
    console.log(
      `[menu-scene-host] register: host Y=${host.meanY.toFixed(4)} S=${host.meanS.toFixed(4)} (n=${host.samples}); ` +
        `mission Y=${mission.meanY.toFixed(4)} S=${mission.meanS.toFixed(4)} (n=${mission.samples}); ` +
        `dY=${(delta.dY * 100).toFixed(1)}% dS=${(delta.dS * 100).toFixed(1)}% ` +
        `(tolerance ${(MENU_HOST_REGISTER_TOLERANCE * 100).toFixed(0)}%) -> ${ok ? 'PASS' : 'FAIL'}`
    );
    return {
      ok,
      host,
      mission,
      delta,
      detail: ok
        ? `within ${(MENU_HOST_REGISTER_TOLERANCE * 100).toFixed(0)}% of the mission (dY=${(delta.dY * 100).toFixed(1)}%, dS=${(delta.dS * 100).toFixed(1)}%)`
        : `dY=${(delta.dY * 100).toFixed(1)}%, dS=${(delta.dS * 100).toFixed(1)}% -- outside the ` +
          `${(MENU_HOST_REGISTER_TOLERANCE * 100).toFixed(0)}% band`,
    };
  } catch (err) {
    // Any OTHER unexpected throw -- a navigation error, a PNG decode failure,
    // a page crash -- becomes this vote's own FAIL naming the error, rather
    // than an uncaught exception that aborts the whole gate (the same defect
    // class the explicit `rendererReady` guard above closes for the one case
    // that was actually observed).
    const detail = err instanceof Error ? err.message : String(err);
    console.log(`[menu-scene-host] register: ${detail} -> FAIL`);
    for (const m of messages.slice(0, 5)) console.error(`[menu-scene-host]   ${m}`);
    return { ok: false, host: ZERO_REGISTER, mission: ZERO_REGISTER, delta: { dY: 0, dS: 0 }, detail };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onError);
    await page.close();
  }
}

export interface MenuHostCheckResult {
  readonly id: string;
  readonly ok: boolean;
  /** Console errors/warnings seen while vote 1 was waiting on the path, so a
   *  path failure reports its own cause instead of leaving it to be
   *  re-derived (`checkCampaignBoard`'s own reasoning). */
  readonly messages: readonly string[];
  readonly detail: string;
}

/**
 * Loads `baseUrl` (the menu) on a fresh 1920x1080 page from `browser` and
 * runs the three votes this file's header describes. See that comment for
 * what each one catches and why votes 2/3 are skipped rather than failed
 * when vote 1 does not reach `live`.
 */
export async function checkMenuSceneHost(browser: Browser, baseUrl: string): Promise<MenuHostCheckResult> {
  const messages: string[] = [];
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const onConsole = (m: { type(): string; text(): string }): void => {
    const type = m.type();
    if (type === 'error' || type === 'warning') messages.push(`${type}: ${m.text().slice(0, 300)}`);
  };
  const onError = (e: Error): void => {
    messages.push(`pageerror: ${String(e).slice(0, 300)}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onError);
  let path: MenuHostVote;
  let contribution: MenuHostVote;
  try {
    await page.goto(baseUrl, { waitUntil: 'load' });
    path = await voteMenuHostPath(page, messages);
    contribution = path.ok
      ? await voteMenuHostContribution(page)
      : { ok: false, detail: 'skipped: the path vote did not reach "live"' };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onError);
    await page.close();
  }

  const register: MenuHostVote = path.ok
    ? await voteMenuHostRegister(browser, baseUrl)
    : { ok: false, detail: 'skipped: the path vote did not reach "live"' };

  const ok = path.ok && contribution.ok && register.ok;
  return {
    id: 'menu-scene-host',
    ok,
    messages,
    detail: `path: ${path.detail}; contribution: ${contribution.detail}; register: ${register.detail}`,
  };
}
