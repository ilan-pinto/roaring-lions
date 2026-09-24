/**
 * The campaign board's `dispose()` gives its WebGL context back -- the same
 * fix, for the same reason, as `ThreeRenderer.dispose` (`../context-release.ts`
 * has the measurement). The board is left on every soft navigation away from
 * `/campaign`, and `WebGLRenderer.dispose()` alone keeps the context until the
 * canvas is collected.
 *
 * Headless, so two things are stood in for and nothing else:
 *
 * - `THREE.WebGLRenderer`, which cannot construct without a GPU. The stand-in
 *   records `dispose`/`forceContextLoss` in order and reports its context lost
 *   only once `forceContextLoss` has been called on it.
 * - The GLB fetch. `gltfLoader().loadAsync` hands back the SHIPPED diorama's
 *   scene graph, rebuilt from its own bytes by `glb-fixture.ts` -- so
 *   `readWorldScene`, the materials and the camera fit all run for real.
 *
 * `requestAnimationFrame` does not exist under `environment: 'node'`; it is
 * stubbed to QUEUE callbacks, so a test can fire one that was already
 * scheduled when the board was left -- the case a real browser produces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { mountWorldView, type WorldView, type WorldViewOptions } from './world-view';

interface FakeRenderer {
  context: { lost: boolean };
  calls: string[];
  renderCalls: number;
  domElement: { removed: boolean };
}

const made = vi.hoisted(() => ({
  renderers: [] as unknown[],
  scene: 'shipped' as 'shipped' | 'broken',
  /** The last scene graph handed out, so a test can reach one of its meshes. */
  lastScene: null as unknown,
  /** Make the fake's `render` throw -- a first `draw()` that fails. */
  renderThrows: false,
  /** Resolves the next GLB load; set by a test that wants to leave mid-load. */
  gate: null as Promise<void> | null,
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    readonly domElement = {
      style: {} as Record<string, string>,
      tabIndex: -1,
      removed: false,
      addEventListener(): void {},
      removeEventListener(): void {},
      remove(): void {
        this.removed = true;
      },
    };
    readonly context = {
      lost: false,
      isContextLost(): boolean {
        return this.lost;
      },
    };
    calls: string[] = [];
    renderCalls = 0;
    outputColorSpace = '';
    constructor() {
      made.renderers.push(this);
    }
    setPixelRatio(): void {}
    setClearAlpha(): void {}
    setSize(): void {}
    render(): void {
      this.renderCalls += 1;
      if (made.renderThrows) throw new Error('first draw failed');
    }
    getContext(): { isContextLost(): boolean } {
      return this.context;
    }
    forceContextLoss(): void {
      this.calls.push('forceContextLoss');
      this.context.lost = true;
    }
    dispose(): void {
      this.calls.push('dispose');
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

vi.mock('../units/gltf-loader', () => ({
  setDracoDecoderPath: (): void => {},
  gltfLoader: () => ({
    loadAsync: async (): Promise<{ scene: THREE.Object3D }> => {
      if (made.gate) await made.gate;
      if (made.scene === 'broken') return { scene: new THREE.Group() };
      const { glbFixture } = await import('./glb-fixture');
      const root = glbFixture('art/meshes/campaign/sahar_basin.glb').root;
      made.lastScene = root;
      return { scene: root };
    },
  }),
}));

let frames: Array<() => void> = [];

beforeEach(() => {
  made.renderers.length = 0;
  made.scene = 'shipped';
  made.lastScene = null;
  made.renderThrows = false;
  made.gate = null;
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void): number => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (): void => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const host = { appendChild: (): void => {}, clientWidth: 800, clientHeight: 600 } as unknown as HTMLElement;

const options = (over: Partial<WorldViewOptions> = {}): WorldViewOptions => ({
  meshUrl: 'sahar_basin.glb',
  dracoDecoderPath: 'draco/',
  statuses: {},
  clickable: new Set<string>(),
  onPick: () => {},
  onFrame: () => {},
  ...over,
});

async function mount(): Promise<{ view: WorldView; gl: FakeRenderer }> {
  const view = await mountWorldView(host, options());
  const gl = made.renderers[0] as FakeRenderer | undefined;
  if (!gl) throw new Error('premise: mountWorldView built no WebGLRenderer');
  return { view, gl };
}

describe('the campaign view releases its WebGL context', () => {
  it('dispose loses the context, after three has freed its own caches', async () => {
    const { view, gl } = await mount();
    expect(gl.context.lost).toBe(false);

    view.dispose();

    expect(gl.context.lost).toBe(true);
    expect(gl.calls).toEqual(['dispose', 'forceContextLoss']);
    expect(gl.domElement.removed).toBe(true);
  });

  it('is idempotent: a second dispose does not throw and loses nothing twice', async () => {
    const { view, gl } = await mount();
    view.dispose();

    expect(() => view.dispose()).not.toThrow();
    expect(gl.calls).toEqual(['dispose', 'forceContextLoss']);
  });

  it('a frame already scheduled when the board was left draws nothing', async () => {
    const { view, gl } = await mount();
    // The premise: mounting draws once, synchronously, and schedules a tick.
    expect(gl.renderCalls).toBe(1);
    expect(frames.length).toBeGreaterThan(0);
    view.nudge(30); // so a live tick WOULD have something to draw

    view.dispose();
    for (const f of frames.splice(0)) f();

    expect(gl.renderCalls).toBe(1);
  });

  it('a scene that fails the campaign contract still loses the context it built', async () => {
    made.scene = 'broken';
    await expect(mountWorldView(host, options({ meshUrl: 'broken.glb' }))).rejects.toThrow();

    const gl = made.renderers[0] as FakeRenderer | undefined;
    if (!gl) throw new Error('premise: mountWorldView built no WebGLRenderer');
    expect(gl.calls).toEqual(['dispose', 'forceContextLoss']);
    expect(gl.domElement.removed).toBe(true);
  });
});

describe('no way out of the campaign view strands a context', () => {
  const firstMesh = (): THREE.Mesh => {
    let found: THREE.Mesh | null = null;
    (made.lastScene as THREE.Object3D).traverse((o) => {
      if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
    });
    if (!found) throw new Error('premise: the fixture scene has a mesh');
    return found;
  };

  it('dispose still loses the context when a free on the way throws', async () => {
    const { view, gl } = await mount();
    vi.spyOn(firstMesh().geometry, 'dispose').mockImplementation(() => {
      throw new Error('free failed');
    });

    expect(() => view.dispose()).toThrow('free failed');

    expect(gl.calls).toEqual(['dispose', 'forceContextLoss']);
    expect(gl.domElement.removed).toBe(true);
  });

  it('a first draw that throws loses the context, takes the canvas off, and starts no frame loop', async () => {
    made.renderThrows = true;

    await expect(mountWorldView(host, options())).rejects.toThrow('first draw failed');

    const gl = made.renderers[0] as FakeRenderer | undefined;
    if (!gl) throw new Error('premise: mountWorldView built no WebGLRenderer');
    expect(gl.calls).toEqual(['dispose', 'forceContextLoss']);
    expect(gl.domElement.removed).toBe(true);
    expect(frames).toHaveLength(0);
  });

  it("an app onFrame that throws on the first draw loses the context too", async () => {
    await expect(
      mountWorldView(
        host,
        options({
          onFrame: () => {
            throw new Error('pins failed');
          },
        })
      )
    ).rejects.toThrow('pins failed');

    const gl = made.renderers[0] as FakeRenderer | undefined;
    if (!gl) throw new Error('premise: mountWorldView built no WebGLRenderer');
    expect(gl.calls).toEqual(['dispose', 'forceContextLoss']);
  });
});

/**
 * Leaving the board while the diorama is still downloading. The app passes
 * the router's own signal; aborted, the view must make no WebGL context at
 * all -- not make one and lose it. Before, the app's disconnect observer
 * was attached too late to hear of the leave, and the context stayed alive
 * on an idle menu through a forced GC: GPU process 127-146 MB against the
 * menu's own 37-38 MB (headless Chromium, ANGLE/Metal, GLB held back 4 s).
 */
describe('a board left before it mounts makes no context', () => {
  it('an already-aborted signal rejects before the GLB is even asked for', async () => {
    const leave = new AbortController();
    leave.abort();

    await expect(mountWorldView(host, options({ signal: leave.signal }))).rejects.toMatchObject({ name: 'AbortError' });

    expect(made.renderers).toHaveLength(0);
    expect(made.lastScene).toBeNull();
  });

  it('a signal aborted DURING the GLB load rejects before any context exists', async () => {
    const leave = new AbortController();
    let release = (): void => {};
    made.gate = new Promise<void>((r) => {
      release = r;
    });

    const mounting = mountWorldView(host, options({ signal: leave.signal }));
    leave.abort();
    release();

    await expect(mounting).rejects.toMatchObject({ name: 'AbortError' });
    // The GLB did arrive -- the leave landed mid-download, as it does for a
    // player -- and still no renderer was built.
    expect(made.lastScene).not.toBeNull();
    expect(made.renderers).toHaveLength(0);
  });
});
