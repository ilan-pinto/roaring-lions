import { describe, expect, it } from 'vitest';
import { fx } from '@lions/sim';
import { maps, menuDiorama, parseMap, units, type DioramaJson } from '@lions/data';
// Test-only, like terrain-parity.test.ts:91: production app code asks the
// renderer for projection, but a test may hold data to project.ts's own maths.
import { screenToWorldFlat, worldToScreen } from '@lions/render/project';
import { hasUnitMesh } from '../mesh-catalogue';
import { buildDioramaWorld, dioramaSceneOptions, facingFromDeg } from './diorama';
import { REF_LAYER, hostZoom } from './framing';

const tiny: DioramaJson = {
  id: 't',
  map: 'beit_sahwan_outskirts',
  camera: { at: [27, 22], zoom_at_1080p: 1.6 },
  units: [{ unit: 'mbt_lavi', at: [17, 21], facing_deg: 180 }],
  plate: 'ui/x.jpg',
};

describe('facingFromDeg', () => {
  // mission.ts's placement conversion: a turn is 1.0 in Q16.16, masked to it.
  it('is the mission placement conversion', () => {
    expect(facingFromDeg(0)).toBe(0);
    expect(facingFromDeg(90)).toBe(16384);
    expect(facingFromDeg(180)).toBe(32768);
    expect(facingFromDeg(360)).toBe(0);
  });
});

describe('buildDioramaWorld', () => {
  it('stands the map and spawns each unit on side 0 at its tile centre, facing as authored', () => {
    const w = buildDioramaWorld(tiny);
    expect(w.sim.structureCount).toBe(w.map.structures.length);
    const living = [...w.sim.state.alive.keys()].filter((i) => w.sim.state.alive[i] === 1);
    expect(living).toHaveLength(1);
    const id = living[0];
    expect(w.sim.state.side[id]).toBe(0);
    expect(w.sim.state.posX[id]).toBe(fx.from(17.5));
    expect(w.sim.state.posY[id]).toBe(fx.from(21.5));
    expect(w.sim.state.facing[id]).toBe(32768);
  });

  it('plans meshes for its own units and the buildings its map stands', () => {
    const w = buildDioramaWorld(tiny);
    expect([...w.plan.vehicles]).toEqual(['mbt_lavi']);
    expect([...w.plan.buildings].sort()).toEqual(['apartment', 'clinic', 'hall', 'house', 'shanty']);
  });

  // Invariant 1 has nothing to say about a sim that never runs, and that is
  // the point: no tick, no RNG draw, no determinism surface, and no event
  // reaches a subscriber (Sim.spawn still queues one; nothing drains it).
  it('is never ticked', () => {
    expect(buildDioramaWorld(tiny).sim.tickCount).toBe(0);
  });

  it('throws by name for a map or a unit the data does not have', () => {
    expect(() => buildDioramaWorld({ ...tiny, map: 'nowhere' })).toThrow(/nowhere/);
    expect(() => buildDioramaWorld({ ...tiny, units: [{ unit: 'tank_x', at: [17, 21] }] })).toThrow(/tank_x/);
  });
});

describe('the shipped menu diorama', () => {
  const mapJson = (maps as Record<string, Parameters<typeof parseMap>[0] | undefined>)[menuDiorama.map];
  if (mapJson === undefined) throw new Error(`menu diorama names map "${menuDiorama.map}", which data/maps does not have`);
  const map = parseMap(mapJson);

  it('names shipped units, each with a mesh to draw', () => {
    for (const u of menuDiorama.units) {
      expect(u.unit in units, `${u.unit} is not a unit`).toBe(true);
      expect(hasUnitMesh(u.unit), `${u.unit} has no mesh -- the host would draw a billboard`).toBe(true);
    }
  });

  // "Placements spread across tiles" is a count>1 trap; every placement here
  // is one body on one tile, so a blocked tile is the whole of the check.
  it('stands every unit on an open tile', () => {
    for (const u of menuDiorama.units) {
      expect(map.blocked[u.at[1] * map.width + u.at[0]], `${u.unit} at ${u.at.join(',')}`).toBe(0);
    }
  });

  // Spec M19: (28,22) left 0.17 tiles here, and the off-map fade (D-1) would
  // have shown in a corner. 20 px is more than --host-bleed at any UI scale.
  const BLEED = 20;
  const VIEWPORTS: readonly (readonly [number, number])[] = [
    [1280, 800], [1366, 768], [1920, 1080], [2560, 1440], [3440, 1440], [1600, 1200], [2560, 1600],
  ];
  it.each(VIEWPORTS)('keeps the frame a whole tile inside the map at %ix%i', (w, h) => {
    const W = w + 2 * BLEED;
    const H = h + 2 * BLEED;
    const cam = { x: menuDiorama.camera.at[0], y: menuDiorama.camera.at[1], zoom: hostZoom(W, H, menuDiorama.camera.zoom_at_1080p) };
    for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H]] as const) {
      const p = screenToWorldFlat(px, py, cam, { width: W, height: H });
      expect(Math.min(p.x, p.y, map.width - p.x, map.height - p.y), `corner ${px},${py}`).toBeGreaterThanOrEqual(1);
    }
  });

  // D-46: --menu-col-wide is 34rem at --ui-scale 1.15, 625.6 px of 1920,
  // centred. If spec Q2 moves the column, this number moves with it.
  it('puts every unit on screen and clear of the column at the 1920x1080 reference', () => {
    const W = REF_LAYER.width;
    const H = REF_LAYER.height;
    const cam = { x: menuDiorama.camera.at[0], y: menuDiorama.camera.at[1], zoom: hostZoom(W, H, menuDiorama.camera.zoom_at_1080p) };
    const colL = (W - 625.6) / 2;
    const colR = colL + 625.6;
    for (const u of menuDiorama.units) {
      const s = worldToScreen(u.at[0] + 0.5, u.at[1] + 0.5, cam, { width: W, height: H });
      expect(s.x > 0.05 * W && s.x < 0.95 * W && s.y > 0.05 * H && s.y < 0.95 * H, `${u.unit} off frame at ${s.x},${s.y}`).toBe(true);
      expect(s.x < colL || s.x > colR, `${u.unit} under the column at x=${s.x.toFixed(0)}`).toBe(true);
    }
  });
});

describe('dioramaSceneOptions', () => {
  it('hands the door the mission’s own options and a zoom that follows the cover law', () => {
    const o = dioramaSceneOptions(menuDiorama, { colorVision: 'default', quality: 'high' }, '/');
    expect(o.renderer.groundTextureUrl).toBe('/textures/desert_sand_tile.jpg');
    expect(o.camera).toEqual({ x: 27, y: 22 });
    expect(o.zoomFor(1920, 1080)).toBeCloseTo(1.6, 10);
    expect(o.meshes.vehicles.map((v) => v.id).sort()).toEqual(['apc_eitan', 'mbt_lavi']);
  });
});
