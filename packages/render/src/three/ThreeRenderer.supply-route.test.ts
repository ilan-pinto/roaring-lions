/**
 * S-F F2 C3, through the REAL `updateOverlays`: the world supply route draws
 * one mesh in band 0.2 while the app hands over routes, nothing while it hands
 * over `null`, replaces its geometry whole (disposing the old), and hides
 * under its own debug layer.
 *
 * Harness copied from `ThreeRenderer.zone-band.test.ts`: a faked
 * `WebGLRenderer`, nothing initialised that the overlay pass does not read.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, SupplyRouteView, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { SupplyRouteMesh } from './supply-route';
import { hexToLinear } from './terrain/shared';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
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
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree', haze: '#E0B87A',
};

const COLORS: Record<string, string> = { 'water.0': '#5A8FA8', 'team.neutral': '#D9A441' };

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
    resolveColor: (key) => COLORS[key] ?? '#000000',
  };
}

interface Privates {
  supplyRoute: SupplyRouteMesh;
  scene: THREE.Scene;
  updateOverlays(alpha: number): void;
}

const W = 24;
const ROUTE: SupplyRouteView = { tiles: [W * 3 + 2, W * 3 + 3, W * 3 + 4, W * 4 + 5, W * 5 + 5], cutSpan: [1, 3] };

function setUp() {
  const sim = new Sim({ seed: 1, width: W, height: W, capacity: 4 });
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Privates;
  return { renderer, priv };
}

function routeMeshes(priv: Privates): THREE.Mesh[] {
  return priv.supplyRoute.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
}

describe('the world supply route (S-F F2 C3)', () => {
  it('null draws no mesh at all', () => {
    const { renderer, priv } = setUp();
    expect(priv.scene.children).toContain(priv.supplyRoute.group);
    renderer.supplyRoutes = null;
    priv.updateOverlays(1);
    expect(routeMeshes(priv)).toHaveLength(0);
    // Nothing drawable (no route, a one-tile route) is no mesh either, not an
    // empty one: three.js submits a mesh whose draw range is empty.
    renderer.supplyRoutes = [{ tiles: [5], cutSpan: null }];
    priv.updateOverlays(1);
    expect(routeMeshes(priv)).toHaveLength(0);
    renderer.dispose();
  });

  it('re-drapes the route when the ground under it changes', () => {
    const { renderer, priv } = setUp();
    renderer.supplyRoutes = [ROUTE];
    priv.updateOverlays(1);
    const before = routeMeshes(priv)[0].geometry;
    const yOf = (g: THREE.BufferGeometry) => (g.getAttribute('position').array as Float32Array)[1];
    const flatY = yOf(before);
    renderer.setElevation(new Uint8Array(W * W).fill(3));
    priv.updateOverlays(1);
    const after = routeMeshes(priv)[0].geometry;
    expect(after).not.toBe(before);
    expect(yOf(after)).toBeGreaterThan(flatY);
    renderer.dispose();
  });

  it('a route set is ONE mesh in band 0.2, depth-tested and not depth-writing', () => {
    const { renderer, priv } = setUp();
    const second: SupplyRouteView = { tiles: [W * 10 + 1, W * 10 + 2, W * 10 + 3], cutSpan: null };
    renderer.supplyRoutes = [ROUTE, second];
    priv.updateOverlays(1);
    const meshes = routeMeshes(priv);
    expect(meshes).toHaveLength(1);
    const [mesh] = meshes;
    expect(mesh.renderOrder).toBe(0.2);
    const mat = mesh.material as THREE.ShaderMaterial;
    expect(mat.depthTest).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
    expect(mesh.geometry.getAttribute('normal')).toBeUndefined();
    renderer.dispose();
  });

  it('marks only the cut stretch dashed: tiles 1..3 of the route, x 3.5..5.5', () => {
    const { renderer, priv } = setUp();
    renderer.supplyRoutes = [ROUTE];
    priv.updateOverlays(1);
    const g = routeMeshes(priv)[0].geometry;
    const pos = g.getAttribute('position').array as Float32Array;
    const cut = g.getAttribute('aCut').array as Float32Array;
    let dashed = 0;
    for (let v = 0; v < cut.length; v++) {
      const x = pos[v * 3];
      const z = pos[v * 3 + 2];
      // Tile 1 is (3.5, 3.5), tile 3 is (5.5, 4.5): the stretch between them.
      const onStretch = x >= 3.5 - 0.11 && x <= 5.5 + 0.11 && z <= 4.5 + 0.11;
      if (cut[v] === 1) {
        dashed++;
        expect(onStretch).toBe(true);
      }
    }
    expect(dashed).toBeGreaterThan(0);
    expect(dashed).toBeLessThan(cut.length);
    renderer.dispose();
  });

  it('wears the open line --info (water.0) and the cut --warn (team.neutral), linear', () => {
    const { renderer, priv } = setUp();
    renderer.supplyRoutes = [ROUTE];
    priv.updateOverlays(1);
    const u = (routeMeshes(priv)[0].material as THREE.ShaderMaterial).uniforms;
    const open = hexToLinear('#5A8FA8');
    const cut = hexToLinear('#D9A441');
    expect((u.uOpen.value as THREE.Vector3).toArray()).toEqual(open);
    expect((u.uCut.value as THREE.Vector3).toArray()).toEqual(cut);
    renderer.dispose();
  });

  it('replacing the routes disposes the old geometry; the same array again rebuilds nothing', () => {
    const { renderer, priv } = setUp();
    const routes = [ROUTE];
    renderer.supplyRoutes = routes;
    priv.updateOverlays(1);
    const first = routeMeshes(priv)[0].geometry;
    const disposed = vi.spyOn(first, 'dispose');
    renderer.supplyRoutes = routes;
    priv.updateOverlays(1);
    expect(disposed).not.toHaveBeenCalled();
    expect(routeMeshes(priv)[0].geometry).toBe(first);
    // A recheck: the runtime recomputed the route round a collapsed building.
    renderer.supplyRoutes = [{ tiles: [W * 3 + 2, W * 2 + 3, W * 2 + 4], cutSpan: null }];
    priv.updateOverlays(1);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(routeMeshes(priv)).toHaveLength(1);
    expect(routeMeshes(priv)[0].geometry).not.toBe(first);
    // And back to nothing: the last geometry goes too.
    const second = routeMeshes(priv)[0].geometry;
    const disposed2 = vi.spyOn(second, 'dispose');
    renderer.supplyRoutes = null;
    priv.updateOverlays(1);
    expect(disposed2).toHaveBeenCalledTimes(1);
    expect(routeMeshes(priv)).toHaveLength(0);
    renderer.dispose();
  });

  it('dispose releases the drawn geometry and the material', () => {
    const { renderer, priv } = setUp();
    renderer.supplyRoutes = [ROUTE];
    priv.updateOverlays(1);
    const mesh = routeMeshes(priv)[0];
    const geo = vi.spyOn(mesh.geometry, 'dispose');
    const mat = vi.spyOn(mesh.material as THREE.Material, 'dispose');
    renderer.dispose();
    expect(geo).toHaveBeenCalledTimes(1);
    expect(mat).toHaveBeenCalledTimes(1);
  });

  it('the supply-route debug layer hides it, and the next frames do not put it back', () => {
    const { renderer, priv } = setUp();
    renderer.supplyRoutes = [ROUTE];
    priv.updateOverlays(1);
    expect(renderer.setDebugLayerVisible('supply-route', false)).toBe(1);
    renderer.supplyRoutes = [{ ...ROUTE }];
    priv.updateOverlays(1);
    expect(priv.supplyRoute.group.visible).toBe(false);
    expect(renderer.setDebugLayerVisible('supply-route', true)).toBe(1);
    expect(priv.supplyRoute.group.visible).toBe(true);
    renderer.dispose();
  });
});
