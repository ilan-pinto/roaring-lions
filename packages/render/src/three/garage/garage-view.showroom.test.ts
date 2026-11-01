/**
 * The garage VIEW poses a team from its store clip (GH-921). `garage-pose.
 * shipped.test.ts` proves the sniper stands if the store poses from
 * `showroomClip`; this proves the view does, by mounting `sniper_team`
 * through `mountGarageView` and reading which figure roots it drew.
 *
 * Falsified: reverting the view's clip choice to `tpl.clips.get('idle')`
 * puts `snp_a_death_root`/`snp_b_death_root` here and the first test goes red.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as THREE from 'three';
import { parseGlbHeadless } from '../units/headless-gltf';

const loader = vi.hoisted(() => ({ make: null as null | (() => Promise<unknown>) }));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    toneMapping = actual.NoToneMapping;
    toneMappingExposure = 1;
    shadowMap = { enabled: false, type: actual.PCFShadowMap };
    info = { render: { calls: 0, triangles: 0 } };
    domElement = {
      style: {} as Record<string, string>,
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
      remove: (): void => {},
    };
    setPixelRatio(): void {}
    setClearAlpha(): void {}
    setSize(): void {}
    render(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

vi.mock('../units/gltf-loader', () => ({
  setDracoDecoderPath: (): void => {},
  gltfLoader: () => ({ loadAsync: (): Promise<unknown> => loader.make?.() ?? Promise.resolve(undefined) }),
}));

const { mountGarageView } = await import('./garage-view');

const SNIPER = readFileSync(new URL('../../../../../art/meshes/sniper_team.glb', import.meta.url));
const COLORS = { key: '#ffffff', fill: '#ffffff', sky: '#ffffff', bounce: '#ffffff', ground: '#c8b494' };
const host = { clientWidth: 600, clientHeight: 400, appendChild: (): void => {} } as unknown as HTMLElement;

async function mountSniper(dropClip?: string) {
  loader.make = async () => {
    const gltf = await parseGlbHeadless(SNIPER);
    if (dropClip) gltf.animations = gltf.animations.filter((a: THREE.AnimationClip) => a.name !== dropClip);
    return gltf;
  };
  return mountGarageView(host, {
    typeId: 'sniper_team',
    kind: 'rigged',
    meshUrl: '/meshes/sniper_team.glb',
    dracoDecoderPath: '/draco/',
    colors: COLORS,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mountGarageView: the sniper team stands on the turntable (GH-921)', () => {
  it('draws the standing build, not the prone death rig', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = await mountSniper();
    expect([...view.info.figureRoots].sort()).toEqual(['snp_a_root', 'snp_b_root']);
    expect(err).not.toHaveBeenCalled();
    view.dispose();
  });

  it('says so, naming the file, when the store clip is missing -- and still draws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = await mountSniper('move');
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).toContain('/meshes/sniper_team.glb');
    expect(String(err.mock.calls[0][0])).toContain("'move'");
    // The fallback is the prone hide: the very pose GH-921 removed.
    expect([...view.info.figureRoots].sort()).toEqual(['snp_a_death_root', 'snp_b_death_root']);
    view.dispose();
  });
});
