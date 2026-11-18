// @vitest-environment jsdom
// The no-graphics-acceleration notice. Every spec here was seen red under a
// one-line mutation of `no-gpu.ts` (listed in the commit that landed it).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDialogOpen } from './confirm';
import { isSoftwareRenderer, noGpuNoticeAllowed, NO_GPU_DISMISSED_KEY, watchNoGpu, type NoGpuEnv } from './no-gpu';
import { watchSmallScreen } from './small-screen';

// Real unmasked-renderer strings, as the browsers report them. Literals, never built from `no-gpu.ts`. Where they come from:
//   SwiftShader: Chromium's software GL/Vulkan, the strings its ANGLE backend reports (chrome://gpu on a machine with hardware
//     acceleration off; this repo's own CI, `tools/src/golden-diff/browser.ts`'s `readUnmaskedRenderer`).
//   llvmpipe / softpipe / lavapipe: Mesa's gallium software drivers (`src/gallium/drivers/llvmpipe/lp_screen.c` names itself
//     "llvmpipe (LLVM x.y, N bits)"; `softpipe/sp_screen.c` "softpipe").
//   "Mesa OffScreen": OSMesa's GL_RENDERER (`src/mesa/drivers/osmesa`), what headless Chrome reported before SwiftShader.
//   "Microsoft Basic Render Driver": Windows's WARP adapter (Microsoft's "Windows Advanced Rasterization Platform" guide), bare
//     and as ANGLE wraps it; "GDI Generic": Windows's built-in OpenGL 1.1.
//   "Apple Software Renderer": macOS's CGL software renderer; "Software Rasterizer": Mesa's classic swrast.
//   Hardware: ANGLE's own "ANGLE (vendor, device, backend)" form on Metal, D3D11 and OpenGL ES; Safari's masked "Apple GPU"; the
//     Android vendors' own names (ARM Mali, Qualcomm Adreno, Imagination PowerVR); Mesa's radeonsi and Intel strings.
const SOFTWARE = [
  'Google SwiftShader',
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)',
  'llvmpipe (LLVM 15.0.7, 256 bits)',
  'Mesa llvmpipe (LLVM 12.0.0, 256 bits)',
  'Gallium 0.4 on llvmpipe (LLVM 13.0.1, 256 bits)',
  'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Microsoft Basic Render Driver',
  'Mesa/X.org softpipe',
  'Software Rasterizer',
  // GH-1413: more recorded strings, ANGLE-wrapped Mesa and the old Windows software GL.
  'ANGLE (Mesa, llvmpipe (LLVM 15.0.7 256 bits), OpenGL 4.5)',
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
  'Mesa Gallium llvmpipe (LLVM 14.0.0, 128 bits)',
  'GDI Generic',
  'Microsoft Corporation GDI Generic',
  // GH-1413 G1: OSMesa, macOS's software renderer, and WARP behind ANGLE with its adapter id.
  'Mesa OffScreen',
  'Apple Software Renderer',
  'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11)',
];
const HARDWARE = [
  'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)',
  'Apple M1',
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'NVIDIA GeForce GTX 1650/PCIe/SSE2',
  'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'Mesa Intel(R) UHD Graphics 630 (CFL GT2)',
  'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 15.0.7, DRM 3.49, 6.1.0)',
  'Mali-G78',
  'Adreno (TM) 640',
  'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)',
  // GH-1413: Safari's masked name, an integrated Intel on Mesa, and a paravirtual GPU (hardware-backed, not a CPU rasteriser).
  'Apple GPU',
  'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)',
  'ANGLE (VMware, VMware SVGA 3D (0x00000405) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'WebKit WebGL',
  // GH-1413 G1: Apple silicon through ANGLE Metal, a PowerVR and a Mali phone.
  'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
  'PowerVR Rogue GE8320',
  'Mali-G52 MC2',
];

describe('isSoftwareRenderer: the tables are not empty', () => {
  // `it.each` over an empty table passes without running anything; counts make that a failure (GH-1413).
  it('18 software strings and 18 hardware strings', () => {
    expect(SOFTWARE).toHaveLength(18);
    expect(HARDWARE).toHaveLength(18);
  });
});

describe('isSoftwareRenderer: real strings', () => {
  it.each(SOFTWARE)('software: %s', (s) => expect(isSoftwareRenderer(s)).toBe(true));
  it.each(HARDWARE)('hardware: %s', (s) => expect(isSoftwareRenderer(s)).toBe(false));
  it('is not sure about nothing: null, undefined and empty are not software', () => {
    expect(isSoftwareRenderer(null)).toBe(false);
    expect(isSoftwareRenderer(undefined)).toBe(false);
    expect(isSoftwareRenderer('')).toBe(false);
  });
});

const prodEnv: NoGpuEnv = { prod: true, hostname: 'roaring-lions.example.workers.dev', query: new URLSearchParams() };

describe('noGpuNoticeAllowed: the same gate as telemetry and feedback', () => {
  it('a production build on a real host', () => expect(noGpuNoticeAllowed(prodEnv)).toBe(true));
  it('never in dev (pnpm dev, ui:routes, ui:shots, the golden gate)', () =>
    expect(noGpuNoticeAllowed({ ...prodEnv, prod: false })).toBe(false));
  it.each(['localhost', '127.0.0.1', '[::1]', 'mac.local', 'app.localhost', 'game.test'])(
    'never on %s, even in a production build (vite preview, perf:load)',
    (hostname) => expect(noGpuNoticeAllowed({ ...prodEnv, hostname })).toBe(false),
  );
  it('?gpunotice asks to see it anywhere', () =>
    expect(noGpuNoticeAllowed({ prod: false, hostname: 'localhost', query: new URLSearchParams('gpunotice') })).toBe(true));
});

// jsdom here may carry a bare `{}` for storage (see CLAUDE.md), so install the
// shape these specs need.
function installSessionStorage(refuse = false): Map<string, string> {
  const m = new Map<string, string>();
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => {
        if (refuse) throw new Error('blocked');
        return m.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (refuse) throw new Error('blocked');
        m.set(k, v);
      },
      removeItem: (k: string) => void m.delete(k),
    },
  });
  return m;
}

const card = (): HTMLElement | null => document.querySelector('.rl-no-gpu');
const buttons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.rl-no-gpu button')];
const key = (k: string): KeyboardEvent => new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
const SWIFT = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)';
const METAL = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)';

let store: Map<string, string>;
beforeEach(() => {
  store = installSessionStorage();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe('watchNoGpu: when it shows', () => {
  it('shows on a production host with a software renderer, as a modal dialog with focus on the button', () => {
    const stop = watchNoGpu({ env: prodEnv, renderer: () => SWIFT });
    const c = card();
    expect(c).not.toBeNull();
    expect(c?.getAttribute('role')).toBe('dialog');
    expect(c?.getAttribute('aria-modal')).toBe('true');
    expect(c?.querySelector('h2')?.textContent).toBe('The game will be very slow');
    expect(c?.textContent).toMatch(/without graphics acceleration/);
    expect(c?.textContent).toMatch(/Use hardware acceleration/);
    expect(c?.textContent).toMatch(/restart the browser/);
    expect(buttons().map((b) => b.textContent)).toEqual(['Carry on anyway']);
    expect(document.activeElement).toBe(buttons()[0]);
    expect(isDialogOpen()).toBe(true);
    stop();
  });

  it('does not show for a hardware renderer, and never reads one it was not asked about', () => {
    const stop = watchNoGpu({ env: prodEnv, renderer: () => METAL });
    expect(card()).toBeNull();
    stop();
  });

  it('does not show when the browser reports nothing', () => {
    const stop = watchNoGpu({ env: prodEnv, renderer: () => null });
    expect(card()).toBeNull();
    stop();
  });

  it.each([
    ['dev', { ...prodEnv, prod: false }],
    ['localhost', { ...prodEnv, hostname: 'localhost' }],
    ['127.0.0.1', { ...prodEnv, hostname: '127.0.0.1' }],
  ])('never shows in %s even on SwiftShader, and does not even read the renderer', (_n, env) => {
    const renderer = vi.fn(() => SWIFT);
    const stop = watchNoGpu({ env, renderer });
    expect(card()).toBeNull();
    expect(renderer).not.toHaveBeenCalled();
    expect(isDialogOpen()).toBe(false);
    stop();
  });

  it('?gpunotice shows it on localhost for a software renderer only', () => {
    const env = { prod: false, hostname: 'localhost', query: new URLSearchParams('gpunotice') };
    const quiet = watchNoGpu({ env, renderer: () => METAL });
    expect(card()).toBeNull();
    quiet();
    const stop = watchNoGpu({ env, renderer: () => SWIFT });
    expect(card()).not.toBeNull();
    stop();
  });

  it('a renderer read that throws shows nothing', () => {
    const stop = watchNoGpu({
      env: prodEnv,
      renderer: () => {
        throw new Error('no gl');
      },
    });
    expect(card()).toBeNull();
    stop();
  });

  it('does not open over another dialog (two modal cards would fight for focus)', () => {
    const other = document.createElement('div');
    other.className = 'rl-small-screen';
    document.body.appendChild(other);
    const stop = watchNoGpu({ env: prodEnv, renderer: () => SWIFT });
    expect(card()).toBeNull();
    stop();
  });
});

describe('watchNoGpu: dismissal', () => {
  it('"Carry on anyway" closes it and remembers for the session', () => {
    const stop = watchNoGpu({ env: prodEnv, renderer: () => SWIFT });
    buttons()[0].click();
    expect(card()).toBeNull();
    expect(isDialogOpen()).toBe(false);
    expect(store.get(NO_GPU_DISMISSED_KEY)).toBe('1');
    stop();
    // a later boot in the same tab (a reload) stays quiet, and never reads the renderer
    const renderer = vi.fn(() => SWIFT);
    const again = watchNoGpu({ env: prodEnv, renderer });
    expect(card()).toBeNull();
    again();
    expect(renderer).not.toHaveBeenCalled();
  });

  it('Escape answers it the same way', () => {
    const stop = watchNoGpu({ env: prodEnv, renderer: () => SWIFT });
    window.dispatchEvent(key('Escape'));
    expect(card()).toBeNull();
    expect(store.get(NO_GPU_DISMISSED_KEY)).toBe('1');
    stop();
  });

  it('another key is swallowed so the game does not answer under the card', () => {
    const stop = watchNoGpu({ env: prodEnv, renderer: () => SWIFT });
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    document.body.dispatchEvent(key('h'));
    expect(seen).not.toHaveBeenCalled();
    expect(card()).not.toBeNull();
    document.removeEventListener('keydown', seen);
    stop();
  });

  it('a browser that refuses storage still dismisses for this page', () => {
    installSessionStorage(true);
    const stop = watchNoGpu({ env: prodEnv, renderer: () => SWIFT });
    expect(card()).not.toBeNull();
    expect(() => buttons()[0].click()).not.toThrow();
    expect(card()).toBeNull();
    stop();
  });

  it('is asked again in a new tab (a fresh session store)', () => {
    watchNoGpu({ env: prodEnv, renderer: () => SWIFT });
    buttons()[0].click();
    store = installSessionStorage();
    const stop = watchNoGpu({ env: prodEnv, renderer: () => SWIFT });
    expect(card()).not.toBeNull();
    stop();
  });
});

describe('watchNoGpu: the disposer contract', () => {
  it('the disposer takes the card and both listeners away, and is safe twice', () => {
    const win = window.addEventListener.bind(window);
    const added: string[] = [];
    const spy = vi.spyOn(window, 'addEventListener').mockImplementation((type: string, ...rest: unknown[]) => {
      added.push(type);
      (win as (t: string, ...r: unknown[]) => void)(type, ...rest);
    });
    const removed = vi.spyOn(window, 'removeEventListener');
    const before = document.body.childElementCount;
    const stop = watchNoGpu({ env: prodEnv, renderer: () => SWIFT });
    expect(document.body.childElementCount).toBe(before + 1);
    expect(added).toContain('keydown');
    stop();
    stop();
    expect(card()).toBeNull();
    expect(document.body.childElementCount).toBe(before);
    // every keydown listener the card put on the window (its guard, and the
    // focus trap's) came off again
    expect(removed.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(added.filter((t) => t === 'keydown').length);
    // the key guard is really gone
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    document.body.dispatchEvent(key('h'));
    expect(seen).toHaveBeenCalled();
    document.removeEventListener('keydown', seen);
    spy.mockRestore();
    removed.mockRestore();
  });

  it('mounts nothing and listens for nothing when it does not apply', () => {
    const spy = vi.spyOn(window, 'addEventListener');
    const before = document.body.childElementCount;
    const stop = watchNoGpu({ env: { ...prodEnv, prod: false }, renderer: () => SWIFT });
    expect(document.body.childElementCount).toBe(before);
    expect(spy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
    stop();
    spy.mockRestore();
  });

  it('on a phone the phone notice wins and the order of mounting matters', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
    });
    const stopPhone = watchSmallScreen({ navigate: () => {}, menuHref: '/' });
    const stop = watchNoGpu({ env: prodEnv, renderer: () => SWIFT });
    expect(document.querySelectorAll('.rl-boot-scrim')).toHaveLength(1);
    expect(document.querySelector('.rl-small-screen')).not.toBeNull();
    stop();
    stopPhone();
  });
});
