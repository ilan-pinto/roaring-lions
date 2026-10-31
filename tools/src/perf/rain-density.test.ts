/**
 * The rain's on-screen density is steady across zoom (GH-871 P4 S-L2, ruling 2).
 *
 * The lead's ruling: "hold the drop density steady across zoom ... about 1,400 on screen at high,
 * within +-20% from z0.35 to z2.5, with a test that fails on the old snapped-period behaviour".
 * The S-L2 capture had measured 1,417 (z1), 645 (z1.6) and 1,200 (z2.5) on one map and a count that
 * nearly doubled at the lattice step 64 -> 32.
 *
 * What is counted: `onScreenDropCount`, the CPU mirror of the vertex shader (the tool's per-frame
 * density label), driven through the PRODUCTION path -- a real `RainBatch.update` at a real view
 * and DPR, the uniforms it wrote (`uLow`, `uPeriod`, `uKeep`) read back the way the capture tool
 * reads them off the page -- and projected through the real dimetric camera. Oracles are LITERALS:
 * the targets below are the preset total times 0.2 (6000 -> 1200, 3500 -> 700, 900 -> 180), written
 * out, not computed from `RAIN_DENSITY_FRACTION`.
 *
 * What the count is NOT, and why the corner tests are different: a rain drop that lands off the
 * map is removed (the map-edge cull), so a view whose screen is half black void shows half the
 * drops. That is the density per visible tile being held, not the count. The edge tests therefore
 * hold the density PER TILE of map on screen (the tiles counted by a forward projection of a
 * 0.25-tile grid of the map, an oracle that shares no code with the maths under test).
 */
import { describe, expect, it } from 'vitest';
import { dimetricCamera } from '../../../packages/render/src/three/camera';
import { RainBatch } from '../../../packages/render/src/three/units/rain-batch';
import { onScreenDropCount } from './ground-captures-plan';

const W = 1400;
const H = 900;
const MAP = 48;
/** The preset totals and the literal target a frame must hold (total x 0.2). */
const PRESETS = [
  { id: 'high', drops: 6000, target: 1200 },
  { id: 'medium', drops: 3500, target: 700 },
  { id: 'low', drops: 900, target: 180 },
] as const;
const ZOOMS = [0.35, 0.5, 0.75, 1, 1.25, 1.6, 2, 2.5];
const BAND = 0.2;

interface Frame {
  readonly period: number;
  readonly keep: number;
  readonly count: number;
}

/** One frame through the production batch, then the mirror's count of heads on screen. */
function frame(
  batch: RainBatch,
  x: number,
  y: number,
  zoom: number,
  dpr: number,
  ground: number,
  mapW = MAP,
  mapH = MAP
): Frame {
  const view = { x, y, zoom, width: W, height: H };
  batch.update({ simSec: 0, view, dpr });
  const u = batch.mesh.material.uniforms;
  const lo = u.uLow.value as { x: number; y: number };
  const period = u.uPeriod.value as number;
  // `?? 1`: the old code has no uKeep, and the density test is run against it first (watched red).
  const keep = (u.uKeep?.value as number | undefined) ?? 1;
  const count = onScreenDropCount({
    drops: batch.drops,
    low: { x: lo.x, z: lo.y },
    period,
    keep,
    fall: u.uFall.value as number,
    mapW,
    mapH,
    view,
    ground: () => ground,
  });
  return { period, keep, count };
}

function batchOf(drops: number, ground: number, mapW = MAP, mapH = MAP): RainBatch {
  // `tools/` declares no `three`: the batch only needs something to `add` its mesh to.
  const scene = { add: (): void => undefined } as unknown as ConstructorParameters<typeof RainBatch>[0];
  const b = new RainBatch(scene, { drops, mapWidth: mapW, mapHeight: mapH });
  if (ground > 0) b.bakeHeights(() => ground);
  return b;
}

describe('the density is steady across zoom (the ruling)', () => {
  // The map centre, DPR 1 and 2, on flat ground and on the highest drawn ground (2.3 wu, which
  // widens the lattice and so lowers what a zoom can reach).
  for (const ground of [0, 2.3]) {
    for (const dpr of [1, 2]) {
      for (const p of PRESETS) {
        it(`${p.id} (${p.drops}), DPR ${dpr}, ground ${ground}: every zoom 0.35..2.5 is within +-20% of ${p.target}`, () => {
          const batch = batchOf(p.drops, ground);
          const lines: string[] = [];
          const outside: string[] = [];
          for (const z of ZOOMS) {
            const f = frame(batch, 24, 24, z, dpr, ground);
            const line = `z${z}: ${f.count}`;
            lines.push(line);
            if (f.count < p.target * (1 - BAND) || f.count > p.target * (1 + BAND)) outside.push(line);
          }
          expect(lines).toHaveLength(ZOOMS.length);
          expect(outside, `outside ${p.target * (1 - BAND)}..${p.target * (1 + BAND)} of [${lines.join(', ')}]`).toEqual([]);
        });
      }
    }
  }

  it('a focus deep inside a 200 x 200 map (no edge anywhere near) holds the same target at every zoom', () => {
    for (const p of PRESETS) {
      const batch = batchOf(p.drops, 0, 200, 200);
      for (const [fx, fy] of [[60, 60], [140, 100]] as const) {
        const lines = ZOOMS.map((z) => `z${z}: ${frame(batch, fx, fy, z, 1, 0, 200, 200).count}`);
        const outside = lines.filter((l) => {
          const n = Number(l.split(': ')[1]);
          return n < p.target * (1 - BAND) || n > p.target * (1 + BAND);
        });
        expect(outside, `${p.id} focus ${fx},${fy}: outside ${p.target * (1 - BAND)}..${p.target * (1 + BAND)} of [${lines.join(', ')}]`).toEqual([]);
      }
    }
  });

  it('one count per tile of map, not one count per screen: the corners and edges of the 48 map hold the centre`s density', () => {
    /** Map tiles on screen: a 0.25-tile grid of the map projected through the real camera. */
    function mapTilesOnScreen(x: number, y: number, zoom: number): number {
      const cam = dimetricCamera({ x, y, zoom }, { width: W, height: H });
      const v = cam.matrixWorldInverse.elements;
      const pr = cam.projectionMatrix.elements;
      let n = 0;
      for (let i = 0; i < MAP * 4; i++) {
        for (let j = 0; j < MAP * 4; j++) {
          const wx = (i + 0.5) / 4;
          const wz = (j + 0.5) / 4;
          const ex = v[0] * wx + v[8] * wz + v[12];
          const ey = v[1] * wx + v[9] * wz + v[13];
          const ndcX = pr[0] * ex + pr[4] * ey + pr[12];
          const ndcY = pr[1] * ex + pr[5] * ey + pr[13];
          if (ndcX >= -1 && ndcX <= 1 && ndcY >= -1 && ndcY <= 1) n++;
        }
      }
      return n / 16;
    }
    const edges: ReadonlyArray<readonly [number, number]> = [[4, 4], [44, 4], [4, 44], [44, 44], [24, 4], [24, 44], [4, 24], [44, 24]];
    for (const p of PRESETS) {
      const batch = batchOf(p.drops, 0);
      for (const z of ZOOMS) {
        const centre = frame(batch, 24, 24, z, 1, 0).count / mapTilesOnScreen(24, 24, z);
        let drops = 0;
        let tiles = 0;
        for (const [fx, fy] of edges) {
          drops += frame(batch, fx, fy, z, 1, 0).count;
          tiles += mapTilesOnScreen(fx, fy, z);
        }
        const edge = drops / tiles;
        expect(edge / centre, `${p.id} z${z}: edge ${edge.toFixed(3)} a tile, centre ${centre.toFixed(3)}`).toBeGreaterThan(1 - BAND);
        expect(edge / centre, `${p.id} z${z}: edge ${edge.toFixed(3)} a tile, centre ${centre.toFixed(3)}`).toBeLessThan(1 + BAND);
      }
    }
  });
});

describe('the count is continuous in zoom (no pop at a lattice step)', () => {
  for (const ground of [0, 2.3]) {
    for (const p of PRESETS) {
      it(`${p.id}, ground ${ground}: a 60-step zoom sweep 0.35 -> 2.5 never moves the count by more than 15% of ${p.target} between neighbours, and stays in the band`, () => {
        const batch = batchOf(p.drops, ground);
        let prev = -1;
        let worst = 0;
        let at = 0;
        const counts: number[] = [];
        for (let k = 0; k <= 60; k++) {
          const z = 0.35 + (k * (2.5 - 0.35)) / 60;
          const c = frame(batch, 24, 24, z, 1, ground).count;
          counts.push(c);
          if (prev >= 0 && Math.abs(c - prev) > worst) {
            worst = Math.abs(c - prev);
            at = z;
          }
          prev = c;
        }
        expect(worst, `largest step ${worst} at z${at.toFixed(2)} of target ${p.target}`).toBeLessThanOrEqual(0.15 * p.target);
        // Not vacuous: the sweep visited the whole range, and all of it sits in the band.
        expect(counts.length).toBe(61);
        expect(Math.min(...counts), `lowest of the sweep`).toBeGreaterThanOrEqual(p.target * (1 - BAND));
        expect(Math.max(...counts), `highest of the sweep`).toBeLessThanOrEqual(p.target * (1 + BAND));
      });
    }
  }
});

describe('the keep fraction and the period depend only on the zoom, the viewport and the ground (never the pan)', () => {
  it('a one-tile pan sweep from the centre to a corner, both ways, leaves uKeep and uPeriod unchanged', () => {
    for (const zoom of [0.35, 0.75, 1, 1.6, 2.5]) {
      const batch = batchOf(3500, 0);
      const uniformsAt = (x: number, y: number): readonly [number, number] => {
        batch.update({ simSec: 0, view: { x, y, zoom, width: W, height: H }, dpr: 1 });
        const u = batch.mesh.material.uniforms;
        expect(u.uKeep, 'the batch carries a uKeep uniform').toBeDefined();
        return [u.uKeep.value as number, u.uPeriod.value as number];
      };
      const centre = uniformsAt(24, 24);
      for (let t = 0; t <= 48; t++) {
        expect(uniformsAt(24 - t / 2, 24 - t / 2), `zoom ${zoom} t=${t}`).toEqual(centre);
        expect(uniformsAt(24 + t / 2, 24 - t / 2), `zoom ${zoom} t=${t}`).toEqual(centre);
      }
    }
  });

  it('nor the DPR: a retina canvas shows the same density', () => {
    const batch = batchOf(6000, 0);
    for (const zoom of ZOOMS) {
      const a = frame(batch, 24, 24, zoom, 1, 0);
      const b = frame(batch, 24, 24, zoom, 2, 0);
      expect(b.keep).toBe(a.keep);
      expect(b.period).toBe(a.period);
    }
  });
});
