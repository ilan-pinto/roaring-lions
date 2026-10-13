/**
 * A battlefield mounted into a host with no size.
 *
 * Seen on the live build on 2026-10-13: a mission booted in a hidden browser
 * pane, `fitToHost` read the host's 0 x 0 client box, and `width`/`height`
 * -- the viewport every projection is solved from -- reported 0. A frustum
 * solved from zero pixels is NaN, so every screen-to-world ray met no plane
 * and `screenToWorldThree` threw: first from the minimap's constructor, which
 * failed the boot, and then once a frame from the hover read. The renderer
 * now floors that viewport at one CSS pixel, so a hidden host projects (onto
 * a one-pixel view) instead of throwing, and the ResizeObserver's next
 * `fitToHost` gives it its real size back. Any host with a size is untouched.
 */
import { describe, expect, it, vi } from 'vitest';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    sizes: [number, number][] = [];
    setClearColor(): void {}
    setSize(w: number, h: number): void {
      this.sizes.push([w, h]);
    }
    getPixelRatio(): number {
      return 1;
    }
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

interface Priv {
  host: { clientWidth: number; clientHeight: number } | null;
  fitToHost(): void;
}

/** `init`'s own sizing step against a host of the given client box, without
 *  a GL context: `fitToHost` is the whole of what `init` and the
 *  ResizeObserver do with the host's size. */
function sized(w: number, h: number): { renderer: ThreeRenderer; resize(w: number, h: number): void } {
  const sim = new Sim({ seed: 1, width: 48, height: 48, capacity: 4 });
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Priv;
  const host = { clientWidth: w, clientHeight: h };
  priv.host = host;
  priv.fitToHost();
  return {
    renderer,
    resize(nw, nh) {
      host.clientWidth = nw;
      host.clientHeight = nh;
      priv.fitToHost();
    },
  };
}

const corners = (r: ThreeRenderer): [number, number][] => [
  [0, 0],
  [r.width, 0],
  [r.width, r.height],
  [0, r.height],
];

describe('a host with no size', () => {
  it.each([
    [0, 0],
    [1024, 0],
    [0, 768],
  ])('projects every corner of a %ix%i host instead of throwing', (w, h) => {
    const { renderer } = sized(w, h);
    expect(renderer.width).toBeGreaterThan(0);
    expect(renderer.height).toBeGreaterThan(0);
    for (const [px, py] of corners(renderer)) {
      const g = renderer.screenToWorld(px, py);
      expect(Number.isFinite(g.x) && Number.isFinite(g.y)).toBe(true);
    }
  });

  it('takes its real size back when the host gets one', () => {
    const { renderer, resize } = sized(0, 0);
    resize(1024, 768);
    expect([renderer.width, renderer.height]).toEqual([1024, 768]);
  });

  it('leaves a host with a size exactly as it was', () => {
    for (const [w, h] of [
      [1400, 900],
      [1024, 768],
      [1, 1],
    ]) {
      const { renderer } = sized(w, h);
      expect([renderer.width, renderer.height]).toEqual([w, h]);
    }
  });
});
