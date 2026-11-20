// The software-rendering line (GH-1413): when the browser draws on the CPU (SwiftShader, llvmpipe, WARP...), one dismissible line
// on the shell screens SUGGESTS the Low preset. The player answers; nothing here changes a setting except the one button that says
// so, and a preset applies at the NEXT mission's boot (`packages/render/src/quality.ts`).
//
// LAZY. This module is reached only through `quality-hint.ts`, which `main.ts` imports dynamically past the gate below, so neither
// the line nor its renderer read is in the entry chunk (entry budget, GH-1413). The classifier stays where every caller already
// reads it, `no-gpu.ts`'s `isSoftwareRenderer`, so the strings are matched in ONE place (its table: `no-gpu.test.ts`).
//
// WHEN IT MAY SHOW (`softwareHintWanted`, all four):
//   - the gate is open: a production build on a real host or the desktop build (`playerHost`), or `?qualityhint` (`qualityHintAllowed`). CI, every harness, `pnpm dev`
//     and `vite preview` all fail it, and they are all SwiftShader;
//   - the renderer names a software rasteriser (unknown, empty and null never do);
//   - the saved preset is not already Low (nothing lighter to offer);
//   - `settings.hints.software` is false. Either button sets it, through the settings dependency's own `set` (`settings.ts` is the
//     one reader and writer of the stored settings), and it is never cleared. The capture tools seed it true (`music-off.ts`, beside
//     `intro.seen`), which is the second, independent reason a capture never shows the line.
// A blocked store cannot crash it: `settings.ts` swallows the write, the answer holds for this page, and the line may show again
// on the next boot.
//
// WHERE. Once, app-wide, appended to `document.body`, and visible only while the player is on a shell screen (`inShell`, polled at
// SHELL_POLL_MS): a battlefield never shows it. The same poll re-reads the settings, and once the preset is Low or the line is
// answered by any other route (the settings screen, say) it takes itself down through its own disposer. It is a status line, not
// a dialog: no focus trap, no key swallowed, so it never fights the no-graphics card (`no-gpu.ts`, modal) that may be up over it
// on the same boot. The disposer takes away the node, both listeners and the poll, and is idempotent (the disposer contract in
// CLAUDE.md).
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import type { Settings } from '../settings';
import { isSoftwareRenderer } from './no-gpu';

/** The preset the line suggests: Low, the "it must run" preset (`quality.ts`). */
export const SOFTWARE_HINT_QUALITY = 'low';

/** How often the line re-asks whether the player is on a shell screen. */
export const SHELL_POLL_MS = 500;

/** The part of a WebGL context the renderer read needs (a fake in tests). */
export interface GlLike {
  readonly RENDERER: number;
  getExtension(name: 'WEBGL_debug_renderer_info'): { readonly UNMASKED_RENDERER_WEBGL: number } | null;
  getParameter(p: number): unknown;
}

const named = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * The renderer's name: `WEBGL_debug_renderer_info`'s unmasked renderer, and `gl.RENDERER` when that extension is missing, MASKED
 * (an empty string) or throws. Null when neither says anything.
 */
export function rendererName(gl: GlLike): string | null {
  let unmasked: string | null;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    unmasked = ext ? named(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null;
  } catch {
    unmasked = null;
  }
  if (unmasked !== null) return unmasked;
  try {
    return named(gl.getParameter(gl.RENDERER));
  } catch {
    return null;
  }
}

/** Read the renderer from a throwaway context, released straight away (as `webgl-probe.ts` does). Null without WebGL. */
export function probeRendererName(doc: Document = document): string | null {
  try {
    const c = doc.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as (WebGLRenderingContext & GlLike) | null;
    if (gl === null) return null;
    const name = rendererName(gl);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return null;
  }
}

/** The cached name (`feedback/gpu.ts`'s `gpuName`) when it says something; otherwise a fresh read that falls back to gl.RENDERER. */
export function resolveRenderer(cached: () => string | null, probe: () => string | null): string | null {
  let name: string | null;
  try {
    name = named(cached());
  } catch {
    name = null;
  }
  if (name !== null) return name;
  try {
    return named(probe());
  } catch {
    return null;
  }
}

export interface SoftwareHintInputs {
  /** The gate (`qualityHintAllowed`). */
  allowed: boolean;
  renderer: string | null;
  settings: Settings;
}

/** The whole decision, pure: tested directly, and by the capture tools' seed (`tools/src/ui-review/music-off.test.ts`). */
export function softwareHintWanted(i: SoftwareHintInputs): boolean {
  return i.allowed && !i.settings.hints.software && i.settings.video.quality !== SOFTWARE_HINT_QUALITY && isSoftwareRenderer(i.renderer);
}

export interface SettingsAccess {
  get(): Settings;
  set(next: Settings): void;
}

export interface SoftwareHintDeps {
  settings: SettingsAccess;
  /** False while the player is in a mission (the line hides there). */
  inShell: () => boolean;
  win?: Window;
}

/** Mount the line. The caller has already decided (`softwareHintWanted`). Returns the disposer. */
export function mountSoftwareHint(deps: SoftwareHintDeps): Disposer {
  const win = deps.win ?? window;
  const doc = win.document;
  const line = doc.createElement('div');
  line.className = 'rl-software-hint';
  line.setAttribute('role', 'status');
  const text = doc.createElement('p');
  text.className = 'rl-software-hint__text';
  text.textContent = t('softwareHint.text');
  const low = doc.createElement('button');
  low.type = 'button';
  low.className = 'rl-btn rl-software-hint__low';
  low.textContent = t('softwareHint.low');
  const dismiss = doc.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'rl-btn rl-software-hint__dismiss';
  dismiss.textContent = t('softwareHint.dismiss');
  line.append(text, low, dismiss);

  let poll: number | null = null;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (poll !== null) win.clearInterval(poll);
    poll = null;
    low.removeEventListener('click', onLow);
    dismiss.removeEventListener('click', onDismiss);
    line.remove();
  };
  /** Remember the answer through the settings dependency; `quality` is the accept button's one other change. */
  const answer = (quality: Settings['video']['quality'] | null): void => {
    const s = structuredClone(deps.settings.get());
    s.hints.software = true;
    if (quality !== null) s.video.quality = quality;
    deps.settings.set(s);
    close();
  };
  function onLow(): void {
    answer(SOFTWARE_HINT_QUALITY);
  }
  function onDismiss(): void {
    answer(null);
  }
  low.addEventListener('click', onLow);
  dismiss.addEventListener('click', onDismiss);
  /** Still wanted by the CURRENT settings: not on Low and not answered (either can change elsewhere, e.g. the settings screen). */
  const stillWanted = (): boolean => {
    let s: Settings;
    try {
      s = deps.settings.get();
    } catch {
      return true; // nothing new learned: the caller's decision stands
    }
    return !s.hints.software && s.video.quality !== SOFTWARE_HINT_QUALITY;
  };
  const sync = (): void => {
    if (!stillWanted()) {
      close(); // the disposer itself: node, listeners and poll go, and the caller's later call is a no-op
      return;
    }
    let shell: boolean;
    try {
      shell = deps.inShell();
    } catch {
      shell = false;
    }
    line.hidden = !shell;
  };
  doc.body.append(line);
  poll = win.setInterval(sync, SHELL_POLL_MS);
  sync();
  return close;
}
