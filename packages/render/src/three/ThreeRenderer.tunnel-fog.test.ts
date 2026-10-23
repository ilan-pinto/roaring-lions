/**
 * GH-681, the fog audit's witness (versus tunnels spec §4.3): a KDF-viewer
 * renderer over a KDF-v-Sarim world, a Sarim rifleman gone down his own
 * route through the real `enterTunnel`, the route unidentified by the KDF --
 * and a KDF rifleman standing where he can SEE the mouth tile the buried man
 * still holds as his sim position. The KDF screen must give nothing away:
 *
 * - no unit draw: the fog gate alone says that tile is visible, so the body,
 *   its HP bar and its ring rode on `unitIsDrawn`'s earth check alone;
 * - no x-ray occupant and no x-ray draw: the occupant list keeps only routes
 *   the viewer may see in full (`routeLevelFor`);
 * - no mouth or vent piece and no spoil rung for the route.
 *
 * And the Sarim screen, over the same world, sees its own route in full and
 * its own man inside it -- so the KDF's zeros are a filter, not a dead path.
 *
 * Harness copied from `ThreeRenderer.tunnel-xray.test.ts`: a faked
 * `WebGLRenderer`, and the x-ray hooks `frame()` calls, called directly.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { TunnelXray } from './tunnel-xray';
import type { TunnelPropsInput } from './tunnel-props';
import type { TrailInstanceInput } from './trail-mesh';
import { unitIsDrawn } from './units/observed';
import { buildVehicleMeshTemplate, type VehicleMeshEntity, type VehicleMeshTemplate } from './units/mesh-vehicle';
import { buildMeshUnitTemplate, type MeshUnitEntity, type MeshUnitTemplate } from './units/mesh-unit';
import { parseRigidFixture } from './units/rigid-mesh-fixture';
import { parseFixture } from './units/mesh-fixture';
import type { ProxyBoxBatch } from './units/proxy-box';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
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
  crownRatio: 0.52, scatter: 'stone',
  groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

function makeOpts(viewerSide: 0 | 1): RendererOptions {
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
    viewerSide,
  };
}

const RIFLE: UnitTypeJson = {
  id: 'tf_rifle',
  role: 'infantry',
  hull: { hp: 20000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

interface Privates {
  tunnelXray: TunnelXray;
  xrayOccupants: [number, number][];
  xrayRouteState(): void;
  xrayFrame(alpha: number): void;
  buildTunnelPropsInput(): TunnelPropsInput;
  buildTrailInput(): TrailInstanceInput;
  updateOverlays(alpha: number): void;
  selectionRing: { readonly count: number };
}

/** A KDF (side 0) v Sarim (side 1) world: the Sarim route mouth (4,6), vent
 *  (14,6); the Sarim rifleman walks to the mouth and goes below; a KDF
 *  rifleman stands three tiles from the mouth, with no `mark_tunnel`. */
function world(viewerSide: 0 | 1) {
  const sim = new Sim({ seed: 5, width: 30, height: 12, capacity: 16, humanHeld: [true, true] });
  const route = sim.addTunnel({ id: 'tf_s_west', points: [[4, 6], [14, 6]], dig_tiles_per_s: 1, pre_dug: true, side: 1 });
  const rifle = sim.addUnitType(RIFLE);
  const sarim = sim.spawn(rifle, 1, fx.from(2.5), fx.from(6.5));
  sim.spawn(rifle, 0, fx.from(4.5), fx.from(9.5));
  const renderer = new ThreeRenderer(sim, makeOpts(viewerSide));
  const priv = renderer as unknown as Privates;
  const run = (ticks: number): void => {
    for (let t = 0; t < ticks; t++) {
      renderer.onEvents(sim.tick());
      renderer.snapshot();
      priv.xrayRouteState();
      priv.xrayFrame(1);
    }
  };
  sim.queueCommand({ kind: 'enterTunnel', ids: [sarim], tunnel: route });
  run(1);
  for (let t = 0; t < 120 && sim.state.tunnelIn[sarim] < 0; t++) run(1);
  run(60);
  return { sim, route, sarim, renderer, priv };
}

const bodyDrawn = (sim: Sim, r: ThreeRenderer, viewer: number, i: number): boolean => {
  const st = sim.state;
  return unitIsDrawn(st.tunnelIn[i], st.side[i], viewer, fx.toNumber(st.posX[i]), fx.toNumber(st.posY[i]), (x, y) => r.isVisible(x, y));
};

describe('GH-681 fog audit: a buried Sarim unit on an unidentified route gives the KDF screen nothing', () => {
  it('the KDF viewer: zero unit draws, zero x-ray occupants, zero x-ray draws, no route pieces', () => {
    const { sim, route, sarim, renderer, priv } = world(0);
    expect(sim.state.tunnelIn[sarim]).toBe(route);
    expect(sim.tunnelContactLevel(0, route)).toBe(0);
    // The precondition that makes the first zero mean something: the fog gate
    // alone WOULD draw him -- the KDF rifleman sees the tile he went down at.
    expect(renderer.isVisible(fx.toNumber(sim.state.posX[sarim]), fx.toNumber(sim.state.posY[sarim]))).toBe(true);
    const drawn = Array.from({ length: sim.entityCount }, (_, i) => i).filter(
      (i) => sim.state.side[i] === 1 && bodyDrawn(sim, renderer, 0, i)
    );
    expect(drawn).toEqual([]);
    expect(priv.xrayOccupants).toEqual([]);
    expect(priv.tunnelXray.figures.count).toBe(0);
    expect(priv.tunnelXray.drawCalls).toBe(0);
    expect(priv.buildTunnelPropsInput().routes[route].contactLevel).toBe(0);
    expect(priv.buildTrailInput().routeLevel(route)).toBe(0);
  });

  it('the Sarim viewer: its own buried man, even selected, wears no ring on the surface (the control: he did before he went down)', () => {
    const { sim, sarim, renderer, priv } = world(1);
    renderer.selection = [sarim];
    priv.updateOverlays(1);
    expect(priv.selectionRing.count).toBe(0);
    // The control: the same world, the same selection, the man on the surface.
    const sim2 = new Sim({ seed: 5, width: 30, height: 12, capacity: 16, humanHeld: [true, true] });
    const r2 = new ThreeRenderer(sim2, makeOpts(1));
    const up = sim2.spawn(sim2.addUnitType(RIFLE), 1, fx.from(2.5), fx.from(6.5));
    sim2.tick();
    r2.snapshot();
    r2.selection = [up];
    (r2 as unknown as Privates).updateOverlays(1);
    expect((r2 as unknown as Privates).selectionRing.count).toBe(1);
    expect(sim.state.tunnelIn[sarim]).toBeGreaterThanOrEqual(0);
  });

  it('the Sarim viewer, same world: its own route in full and its own man inside it', () => {
    const { route, sarim, priv } = world(1);
    expect(priv.xrayOccupants).toEqual([[route, sarim]]);
    expect(priv.tunnelXray.figures.count).toBe(1);
    expect(priv.tunnelXray.clock.strength[route]).toBeGreaterThan(0.9);
    expect(priv.buildTunnelPropsInput().routes[route].contactLevel).toBe(2);
  });
});

/** The renderer's own three body paths, over a stub template each. */
interface DrawPriv {
  vehicleMeshTemplates: Map<string, VehicleMeshTemplate>;
  vehicleMeshBounds: Map<string, import('three').Vector3>;
  meshUnitTemplates: Map<string, readonly MeshUnitTemplate[]>;
  meshFailures: Map<string, string>;
  meshUnitEntities: Map<number, MeshUnitEntity>;
  vehicleMeshEntities: Map<number, VehicleMeshEntity>;
  proxyBoxes: ProxyBoxBatch | null;
  updateMeshUnits(alpha: number, dtMs: number): void;
  updateVehicleMeshes(alpha: number, dtMs: number): void;
  updateProxyBoxes(alpha: number): void;
}

const TF_FOOT: UnitTypeJson = { ...RIFLE, id: 'tf_mesh_foot' };
const TF_PROXY: UnitTypeJson = { ...RIFLE, id: 'tf_proxy_foot' };
const TF_HULL: UnitTypeJson = { ...RIFLE, id: 'gun_truck', role: 'apc', mobility: { speed_tiles_s: 1, wheeled: true } };

/**
 * The same KDF-v-Sarim ground, read through what the renderer DRAWS: a
 * skinned Sarim team (`updateMeshUnits`), a Sarim hull (`updateVehicleMeshes`)
 * and a Sarim team whose GLB failed (`updateProxyBoxes`), each on the mouth
 * tile a KDF rifleman can see. `buried` puts all three below
 * (`Sim.putInTunnel`, the authored-placement path; a hull has no `enterTunnel`).
 */
async function drawWorld(buried: boolean) {
  const sim = new Sim({ seed: 5, width: 30, height: 12, capacity: 16, humanHeld: [true, true] });
  const route = sim.addTunnel({ id: 'tf_s_west', points: [[4, 6], [14, 6]], dig_tiles_per_s: 1, pre_dug: true, side: 1 });
  const at = (x: number): [number, number] => [fx.from(x), fx.from(6.5)];
  const foot = sim.spawn(sim.addUnitType(TF_FOOT), 1, ...at(3.5));
  const hull = sim.spawn(sim.addUnitType(TF_HULL), 1, ...at(4.5));
  const proxy = sim.spawn(sim.addUnitType(TF_PROXY), 1, ...at(5.5));
  sim.spawn(sim.addUnitType(RIFLE), 0, fx.from(4.5), fx.from(9.5));
  if (buried) for (const id of [foot, hull, proxy]) sim.putInTunnel(id, route);
  const renderer = new ThreeRenderer(sim, makeOpts(0));
  const priv = renderer as unknown as DrawPriv;
  const rigid = await parseRigidFixture({ parts: [{ nodeName: 'hull_hull', extrasRole: 'hull' }] });
  priv.vehicleMeshTemplates.set(TF_HULL.id, buildVehicleMeshTemplate(rigid, TF_HULL.id));
  const THREE = await import('three');
  priv.vehicleMeshBounds.set(TF_HULL.id, new THREE.Vector3(2, 0.8, 1.2));
  const skinned = await parseFixture({ roleName: 'uniform', clipName: ['idle'] });
  priv.meshUnitTemplates.set(TF_FOOT.id, [buildMeshUnitTemplate(skinned, 'kdf')]);
  priv.meshFailures.set(TF_PROXY.id, '/meshes/tf_proxy_foot.glb');
  sim.tick();
  renderer.snapshot();
  renderer.snapshot();
  priv.updateMeshUnits(1, 16);
  priv.updateVehicleMeshes(1, 16);
  priv.updateProxyBoxes(1);
  const pos = (i: number): [number, number] => [fx.toNumber(sim.state.posX[i]), fx.toNumber(sim.state.posY[i])];
  return {
    seen: [foot, hull, proxy].map((i) => renderer.isVisible(...pos(i))),
    foot: priv.meshUnitEntities.get(foot)?.root.visible,
    hull: priv.vehicleMeshEntities.get(hull)?.root.visible,
    proxyBoxes: priv.proxyBoxes?.count ?? 0,
  };
}

describe('GH-681 fog audit, through the renderer\'s own draw paths', () => {
  it('control: on the surface, all three bodies draw where the KDF rifleman sees them', async () => {
    const d = await drawWorld(false);
    expect(d.seen).toEqual([true, true, true]);
    expect(d.foot).toBe(true);
    expect(d.hull).toBe(true);
    expect(d.proxyBoxes).toBe(1);
  });

  it('buried, on tiles the KDF sees: no skinned body, no hull, no proxy box', async () => {
    const d = await drawWorld(true);
    // The fog gate alone would draw every one of them.
    expect(d.seen).toEqual([true, true, true]);
    expect(d.foot).toBe(false);
    expect(d.hull).toBe(false);
    expect(d.proxyBoxes).toBe(0);
  });
});
