// The "no graphics acceleration" notice (polish lane; approved by the lead on
// 2026-10-11 from the proposal in the low-end assessment PR).
//
// WHY. `docs/PERFORMANCE.md` ("Low-end") measured a browser that draws WITHOUT
// a graphics card -- software rendering, Chromium's SwiftShader being the usual
// one -- at 0.6-1.9 fps at every quality preset, with frames of 0.5-7.8 s and
// the battle running at 0.15-0.46 of real time. No preset rescues that player,
// and nothing on screen says why, so the card says it and says the cure.
//
// WHAT IS DETECTED. `WEBGL_debug_renderer_info`'s unmasked renderer, the read
// the feedback context already makes (`feedback/gpu.ts`'s `gpuName`, cached and
// released straight away) and `tools/src/golden-diff/browser.ts`'s
// `readUnmaskedRenderer` makes for the capture environment. `isSoftwareRenderer`
// is the one place the strings are matched:
//   software  "Google SwiftShader", "ANGLE (Google, Vulkan 1.3.0 (SwiftShader
//             Device (Subzero)), SwiftShader driver)", "llvmpipe (LLVM 15...)",
//             "Gallium 0.4 on llvmpipe", "Microsoft Basic Render Driver",
//             Mesa's "lavapipe"/"softpipe", anything that says "Software".
//   hardware  "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro...)", NVIDIA,
//             AMD, "Intel(R) UHD Graphics", "Mali-G78", "Adreno (TM) 640".
// A browser with no WebGL at all (`null`) is NOT software rendering: that case
// already has its own words (boot-failure card, K-03) and a flat fallback.
//
// WHERE IT MAY SHOW -- AND WHERE IT MAY NEVER SHOW. CI and every test harness
// (`pnpm ui:routes`, `ui:shots`, the golden gate, `perf:*`, Playwright) run on
// SwiftShader, so a notice that fired for it would put a modal over every one
// of their frames and swallow their keys. It is therefore gated exactly as
// telemetry and feedback are (`feedback/gate.ts`'s `feedbackSends`): a
// PRODUCTION build on a host that is not this machine. `pnpm dev`, every vitest
// run, and a production build served from localhost/127.0.0.1/[::1]/*.local/
// *.localhost/*.test (`vite preview`, which `perf:load` uses) all fail that
// test, and the renderer is not even read there. The one way in on such a host
// is `?gpunotice` (a developer asking to see it, as `?telemetry` is for the
// telemetry switch); no harness passes it.
//
// WHERE IT IS MOUNTED. Once, app-wide, from `main.ts` beside the phone notice,
// with its own disposer (the disposer contract in CLAUDE.md): the card, its two
// listeners and its trap exist only while it is on screen. It is asked at boot
// only -- a renderer does not change under a running page -- and never while
// another dialog is up (the phone notice, which is the louder message on a
// phone), since two modal cards fight for focus (`notice-card.ts`).
//
// DISMISSAL. "Carry on anyway" (and Escape) is remembered for the session in
// `sessionStorage`, in try/catch. A new tab asks again, on purpose: the cure is
// a browser setting the player may not have been able to reach the first time.
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import { feedbackSends } from '../feedback/gate';
import { isDialogOpen } from './confirm';
import { mountNotice, type NoticeHandle } from './notice-card';

/** `sessionStorage` key: present once the player has answered the card. */
export const NO_GPU_DISMISSED_KEY = 'lions.noGpu.dismissed';

/** Renderer strings that mean "drawn on the CPU". Case-insensitive. */
const SOFTWARE = /swiftshader|llvmpipe|lavapipe|softpipe|microsoft basic render|\bsoftware\b/i;

/** True when an unmasked WebGL renderer string names a software rasteriser.
 *  Null, empty and unknown strings are NOT software: the notice only speaks
 *  when it is sure. */
export function isSoftwareRenderer(name: string | null | undefined): boolean {
  return typeof name === 'string' && SOFTWARE.test(name);
}

export interface NoGpuEnv {
  prod: boolean;
  hostname: string;
  query: URLSearchParams;
}

/** May the notice be considered at all here? A production build on a real
 *  host (the telemetry/feedback gate), or `?gpunotice`. */
export function noGpuNoticeAllowed(env: NoGpuEnv): boolean {
  return feedbackSends(env) || env.query.has('gpunotice');
}

export interface NoGpuDeps {
  env: NoGpuEnv;
  /** The unmasked renderer string, or null (`feedback/gpu.ts`'s `gpuName`).
   *  Only called once the gate has passed. */
  renderer: () => string | null;
  win?: Window;
}

function storedDismissed(win: Window): boolean {
  try {
    return win.sessionStorage.getItem(NO_GPU_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function storeDismissed(win: Window): void {
  try {
    win.sessionStorage.setItem(NO_GPU_DISMISSED_KEY, '1');
  } catch {
    // Private mode or blocked site data: the card is asked once per page load
    // by construction, so nothing more is needed.
  }
}

/**
 * Decide once, and show the card if software rendering is detected on a host
 * that may show it and the player has not answered. Returns the disposer.
 */
export function watchNoGpu(deps: NoGpuDeps): Disposer {
  const win = deps.win ?? window;
  if (!noGpuNoticeAllowed(deps.env)) return () => {};
  if (storedDismissed(win)) return () => {};
  let name: string | null = null;
  try {
    name = deps.renderer();
  } catch {
    name = null;
  }
  if (!isSoftwareRenderer(name)) return () => {};
  if (isDialogOpen(win.document)) return () => {};

  let card: NoticeHandle | null = null;
  const close = (): void => {
    const c = card;
    card = null;
    c?.close();
  };
  const answer = (): void => {
    storeDismissed(win);
    close();
  };
  card = mountNotice(win, {
    scrimClass: 'rl-boot-scrim rl-no-gpu',
    idBase: 'rl-no-gpu',
    title: t('noGpu.title'),
    body: t('noGpu.body'),
    next: t('noGpu.next'),
    onEscape: answer,
    buttons: [{ className: 'rl-btn rl-no-gpu__keep', label: t('noGpu.keep'), onClick: answer }],
  });
  return close;
}
