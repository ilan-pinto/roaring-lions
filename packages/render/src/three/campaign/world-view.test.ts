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
import { mountWorldView, type WorldView } from './world-view';

interface FakeRenderer {
  context: { lost: boolean };
  calls: string[];
  renderCalls: number;
  domElement: { removed: boolean };
}

const made = vi.hoisted(() => ({ renderers: [] as unknown[], scene: 'shipped' as 'shipped' | 'broken' }));

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
      if (made.scene === 'broken') return { scene: new THREE.Group() };
      const { glbFixture } = await import('./glb-fixture');
      return { scene: glbFixture('art/meshes/campaign/sahar_basin.glb').root };
    },
  }),
}));

let frames: Array<() => void> = [];

beforeEach(() => {
  made.renderers.length = 0;
  made.scene = 'shipped';
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

async function mount(): Promise<{ view: WorldView; gl: FakeRenderer }> {
  const view = await mountWorldView(host, {
    meshUrl: 'sahar_basin.glb',
    dracoDecoderPath: 'draco/',
    statuses: {},
    clickable: new Set<string>(),
    onPick: () => {},
    onFrame: () => {},
  });
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
    await expect(mountWorldView(host, {
      meshUrl: 'broken.glb',
      dracoDecoderPath: 'draco/',
      statuses: {},
      clickable: new Set<string>(),
      onPick: () => {},
      onFrame: () => {},
    })).rejects.toThrow();

    const gl = made.renderers[0] as FakeRenderer | undefined;
    if (!gl) throw new Error('premise: mountWorldView built no WebGLRenderer');
    expect(gl.calls).toEqual(['dispose', 'forceContextLoss']);
    expect(gl.domElement.removed).toBe(true);
  });
});
