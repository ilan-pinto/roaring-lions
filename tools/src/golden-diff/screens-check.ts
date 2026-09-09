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
import type { Page } from 'playwright';

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
