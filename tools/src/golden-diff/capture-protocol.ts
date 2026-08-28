// The capture half of the golden-image diff harness. Unlike diff.ts, this
// half CANNOT run as a plain Node script -- exactly the constraint
// `2026-08-26-three-renderer-design.md`'s Testing section amendment states
// for anything touching a real `ThreeRenderer`: it constructs a real
// `WebGLRenderer` in its constructor and needs real WebGL2, which neither
// `node` nor `jsdom` provide. `tools/src/perf/three-units.ts` hit the same
// wall and answers it the same way this file does: run inside a real
// browser tab pointed at the app's own Vite dev server, not a synthetic DOM.
//
// This file is NOT a script you execute -- `PIXI_URL`/`THREE_URL` build the
// two URLs and `CAPTURE_SCRIPT` is the exact JS to run in-page, so the
// browser-driving half (a human in devtools, or an agent with browser
// automation tools -- this harness was built and run once using
// claude-in-chrome) has one source of truth for "what counts as an
// identical scenario" rather than two copies that can drift. Read this file
// top to bottom before capturing; the protocol below is what was actually
// run to produce `.superpowers/d-golden-diff-report.md`'s numbers.
//
// ============================================================================
// Protocol
// ============================================================================
//
// 1. Have a Vite dev server for THIS worktree running (check with `lsof` or
//    similar that its cwd is this checkout -- CLAUDE.md's hard constraint:
//    never kill someone else's `pnpm dev`, never assume port 5173 is yours).
//    If none is running, start your own on a different port
//    (`pnpm --filter @lions/app dev -- --port 5174`).
//
// 2. Open ONE browser tab (real Chrome, via any automation surface that can
//    navigate, eval JS, and screenshot a CSS-pixel region -- e.g.
//    claude-in-chrome's `navigate` / `javascript_tool` / `computer{zoom}`).
//    Resize its window ONCE to a fixed size (this run used 1400x900 window
//    -> reported canvas rect 1568x543 CSS px; the window chrome/DPR math is
//    automation-surface-specific, so record whatever rect you actually get,
//    do not assume a number) and reuse the SAME tab/window for both
//    captures, so window chrome and any DPR quirks cancel out identically.
//
// 3. For EACH backend (pixi first, then three), in the SAME tab:
//    a. navigate to that backend's URL (see PIXI_URL/THREE_URL below)
//    b. wait for boot (~2-3s is enough on a warm dev-server cache; poll
//       `typeof window.__lions !== 'undefined'` if you want a real gate
//       rather than a fixed sleep)
//    c. run CAPTURE_SCRIPT and keep its returned `{camera, rect}` -- diff it
//       against the OTHER backend's returned value before trusting the
//       screenshots. They must match exactly (this harness's own run
//       produced camera {x:31,y:22,zoom:1} and rect {0,0,1568,543} for BOTH
//       backends, unprompted -- the app computes camera state identically
//       regardless of which Renderer is behind the interface, so this is a
//       sanity check, not something you need to force by hand beyond calling
//       `goto` with the same marker).
//    d. screenshot exactly `rect` (not the whole viewport -- HUD chrome
//       outside the canvas is identical DOM/CSS on both backends and only
//       adds noise) and save it to disk.
//
// 4. Run `diff.ts` on the two saved PNGs.
//
// Why a real compositor screenshot, not `canvas.toDataURL()`/`readPixels`:
// CLAUDE.md is explicit that `preserveDrawingBuffer` stays OFF in shipping
// ThreeRenderer code and this harness must not touch the renderer to make
// itself easier to measure (task's hard constraint). A JS-side canvas
// readback taken any time after the triggering `frame()` call returns is
// therefore unreliable by design -- CLAUDE.md calls the black readback
// "correct, not a broken renderer". A real screenshot (OS/CDP-level
// compositor capture) sidesteps this entirely: it captures what the
// browser actually painted, the same bytes a player sees, regardless of
// `preserveDrawingBuffer`. This is also why `three-units.ts`'s browser mode
// never attempts a screenshot at all -- it only times, never captures --
// and why this harness had to add its own capture step rather than reuse
// one.
//
// ============================================================================

/** Change these two to change map/flags for a run. Keep them in sync except
 *  for `renderer` -- that is the one axis this harness exists to diff. */
export const SANDBOX_MAP = 'beit_sahwan_outskirts';
export const CAMERA_MARKER = 'town_center';
/** Sim ticks to fast-forward before capturing, via `__lions.step(n)`. 100
 *  ticks = 5 sim-seconds at the fixed 20 Hz tick (invariant 1) -- enough for
 *  units to have oriented/animated past their spawn pose and fog to have
 *  resolved around the camera's framing, on a map where the sandbox force
 *  has not been given a move order and so has not left its assembly point
 *  (see main.ts: sandbox mode sets no `player_start`/orders, only a mission
 *  does). A scenario that needs actual combat (to exercise
 *  `structureLastAlpha`, tracers in flight, etc.) needs either a mission URL
 *  (`?mission=<id>`) in place of `?sandbox=`, or manual orders issued before
 *  stepping -- this harness supports both URLs but this file's own
 *  recorded run used the plain sandbox, and says so in the report rather
 *  than implying combat was exercised when it was not. */
export const CAPTURE_TICKS = 100;

function baseUrl(port = 5173): string {
  return `http://localhost:${port}`;
}

export function pixiUrl(port = 5173): string {
  return `${baseUrl(port)}/?sandbox=${SANDBOX_MAP}`;
}

export function threeUrl(port = 5173): string {
  return `${baseUrl(port)}/?sandbox=${SANDBOX_MAP}&renderer=three`;
}

/** Evaluated in-page (browser console / javascript_tool). Returns JSON so
 *  the two backends' results can be diffed textually before trusting the
 *  screenshots -- see protocol step 3c. */
export const CAPTURE_SCRIPT = `
window.__lions.goto(${JSON.stringify(CAMERA_MARKER)});
const tick = window.__lions.step(${CAPTURE_TICKS});
const c = window.__lions.renderer.camera;
const canvas = window.__lions.renderer.canvas;
const r = canvas.getBoundingClientRect();
JSON.stringify({
  tick,
  camera: { x: c.x, y: c.y, zoom: c.zoom },
  rect: { x: r.x, y: r.y, w: r.width, h: r.height },
  dpr: window.devicePixelRatio,
});
`.trim();
