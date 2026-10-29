// The Ein Qasab greybox (GH-871 P2 T7), measured on the world it builds.
//
// Two halves. The MARSH half is S-4 on the real map: the water inside the `~`
// tiles is 25-35% by area, and no reed stands on it. The water field is
// world-anchored, not marsh-scaled (Task 6b), so the share is a property of this
// ONE realisation, and the lever when it misses is the marsh's shape. The
// GREYBOX half holds the map-gate facts that no other test reads for this map:
// every building on one level, no open step over one level a tile, a built share
// of at most 3%, and a sandbox force that can leave its verge.
//
// Oracles are literals. `marshWaterAt` is the only import from the code under
// test, because the water share IS its output.
import { describe, expect, it } from 'vitest';
import { Sim } from '../../packages/sim/src/sim';
import { applyTerrain, maps, parseMap, structures as structureCatalogue, type MapJson } from '@lions/data';
import { decorPlacements, type TerrainInput } from '../../packages/render/src/three/terrain/index';
import { terrainTonesFor } from '../../packages/app/src/terrain-themes';
import { marshWaterAt } from '../../packages/render/src/three/terrain/shared';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';

const json = maps.ein_qasab as MapJson;
const map = parseMap(json);
const W = map.width;
const H = map.height;
const rows = json.rows;
const symbolAt = (x: number, y: number): string => rows[y]?.[x] ?? '?';

function build(): { sim: Sim; input: TerrainInput } {
  const sim = new Sim({ seed: 20260727, width: W, height: H, capacity: 256 });
  applyTerrain(map, sim);
  const idx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    idx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) {
    const t = idx.get(b.type);
    if (t === undefined) throw new Error(`unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  const tones = terrainTonesFor(map);
  return {
    sim,
    input: {
      width: W,
      height: H,
      decor: map.decor,
      elevation: map.elevation,
      blocked: sim.blocked,
      cover: sim.cover,
      boulder: sim.boulder,
      groveFamily: tones.groveFamily,
      openScatter: tones.openScatter,
      familyRemap: tones.familyRemap,
      waterside: tones.waterside,
    },
  };
}

/** Tiles that are walls, not ground: a ridge crag and the hamlet's house and yard wall. */
const WALLS = new Set(['^', 'h', '=']);

const marshTiles: [number, number][] = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (symbolAt(x, y) === '~') marshTiles.push([x, y]);

describe('Ein Qasab: the marsh (S-4)', () => {
  it('is a wetland map with 250-350 marsh tiles, about 300 (R-12)', () => {
    expect(json.terrain).toBe('wetland');
    expect(marshTiles.length).toBeGreaterThanOrEqual(250);
    expect(marshTiles.length).toBeLessThanOrEqual(350);
  });

  it('holds 25-35% open water by area inside its marsh tiles', () => {
    const S = 8;
    let water = 0;
    for (const [x, y] of marshTiles) {
      for (let b = 0; b < S; b++) {
        for (let a = 0; a < S; a++) {
          if (marshWaterAt(map.decor, W, H, x + (a + 0.5) / S, y + (b + 0.5) / S) >= 0.5) water++;
        }
      }
    }
    const share = water / (marshTiles.length * S * S);
    console.info(`ein_qasab water share: ${share.toFixed(4)} (${water}/${marshTiles.length * S * S}), ${marshTiles.length} marsh tiles`);
    expect(share).toBeGreaterThanOrEqual(0.25);
    expect(share).toBeLessThanOrEqual(0.35);
  });

  it('puts no reed centre on the open water, and does place reeds', () => {
    const reeds = decorPlacements(build().input).filter((p) => p.family === 'reed');
    // Not vacuous: the wetland path ran and the marsh carries a real mat.
    expect(reeds.length).toBeGreaterThan(200);
    for (const r of reeds) expect(marshWaterAt(map.decor, W, H, r.x, r.z), `${r.x},${r.z}`).toBeLessThan(0.5);
  });
});

describe('Ein Qasab: the greybox facts (R-12, spec 5.3)', () => {
  it('is 48x48 and declares the five markers at their literal tiles', () => {
    expect([json.width, json.height, json.name]).toEqual([48, 48, 'Ein Qasab']);
    expect(json.markers).toMatchObject({
      kdf_start: [4, 44],
      causeway_n: [22, 12],
      causeway_s: [22, 34],
      hamlet: [42, 22],
      east_crest: [39, 10],
    });
  });

  it('raises both causeways to level 1 across the whole marsh, and the marsh is open ground between them', () => {
    for (const y of [12, 34]) {
      for (let x = 13; x <= 37; x++) {
        expect(symbolAt(x, y), `(${x},${y})`).toBe('r');
        expect(map.elevation[y * W + x], `(${x},${y}) level`).toBe(1);
      }
    }
    // Not vacuous: marsh stands on both sides of each causeway.
    for (const y of [11, 13, 33, 35]) expect(rows[y]?.includes('~'), `row ${y}`).toBe(true);
  });

  it('keeps built share at or under 3%, and every building on a single level', () => {
    const built = map.structures.reduce((n, st) => n + st.tiles.length, 0);
    expect(built).toBeGreaterThan(0);
    expect(built / (W * H)).toBeLessThanOrEqual(0.03);
    // 4 houses and the yard's wall, which parseMap makes one structure a tile: 23 of them.
    expect(map.structures.filter((s) => s.type === 'wall')).toHaveLength(23);
    expect(map.structures).toHaveLength(27);
    for (const s of map.structures) {
      const levels = new Set(s.tiles.map((t) => map.elevation[t]));
      expect([...levels], `${s.type} at tile ${s.tiles[0]}`).toHaveLength(1);
    }
    expect(map.structures.filter((s) => s.type === 'house')).toHaveLength(4);
  });

  it('has no open step over one level between orthogonal neighbours', () => {
    let steps = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = y * W + x;
        for (const u of [x + 1 < W ? t + 1 : -1, y + 1 < H ? t + W : -1]) {
          if (u < 0) continue;
          const a = map.elevation[t] ?? 0;
          const b = map.elevation[u] ?? 0;
          if (Math.abs(a - b) > 0) steps++;
          // Open on both sides: a ridge or building tile is a wall and may stand on any ground.
          const open = (i: number) => !WALLS.has(symbolAt(i % W, Math.floor(i / W)));
          if (open(t) && open(u)) expect(Math.abs(a - b), `(${x},${y}) -> tile ${u}`).toBeLessThanOrEqual(1);
        }
      }
    }
    // Not vacuous: the map does have relief to step over.
    expect(steps).toBeGreaterThan(100);
  });

  it('gives the sandbox force a verge: open ground at kdf_start with the west track beside it', () => {
    expect(symbolAt(4, 44)).toBe('.');
    expect(symbolAt(4, 43)).toBe('r');
    expect(symbolAt(13, 43)).toBe('r');
  });
});

describe('Ein Qasab: a vehicle can leave the verge and reach the hamlet, over a causeway', () => {
  function route(blocked: Uint8Array, elevation: Uint8Array, from: [number, number], to: [number, number]): [number, number][] | null {
    const field = new FlowField(W, H);
    field.compute(blocked, elevation, to[0], to[1]);
    const path: [number, number][] = [];
    let [x, y] = from;
    for (let steps = 0; steps <= W * H; steps++) {
      path.push([x, y]);
      if (x === to[0] && y === to[1]) return path;
      const d = field.dirs[y * W + x];
      if (d === undefined || d === DIR_NONE) return null;
      x += DIR_DX[d] ?? 0;
      y += DIR_DY[d] ?? 0;
    }
    return null;
  }

  it('crosses a causeway tile and never touches a building tile', () => {
    const { sim } = build();
    const path = route(sim.blockedVehicle, sim.elevation, [4, 44], [42, 22]);
    expect(path).not.toBeNull();
    const p = path ?? [];
    expect(p.length).toBeGreaterThan(40);
    expect(p.some(([x, y]) => (y === 12 || y === 34) && x >= 13 && x <= 37)).toBe(true);
    for (const [x, y] of p) expect(WALLS.has(symbolAt(x, y)) && symbolAt(x, y) !== '^', `(${x},${y})`).toBe(false);
  });
});
