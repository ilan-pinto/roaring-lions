/**
 * GH-1167 S5: the 3D grass field's cells on the five shipped green maps (design 2026-11-11, sections 3.2 and 6, slice S5), through
 * the very input `ThreeRenderer.rebuildTerrain` hands the field (`composeTerrainFrom(...).composed.input` and its surface):
 *  - at most 108 meshes (36 cells x 3 variants), none over the node builder's per-mesh cap, so no (cell, variant) is split;
 *  - the cells hold exactly S1's clumps (`placeGrassClumps`), each mesh in back-to-front order;
 *  - a building collapse re-places only the cells it touched (`grassSpliceCells`), and the result is BYTE-IDENTICAL to a full
 *    plan of the same world, each splice made from the previous splice, so an error compounds rather than hides.
 * Lives in `app` because `render` cannot import `@lions/data`.
 *
 * Falsified by (run red, then put back; in the commit message): splitting at 128 instead of the cap (the 108 bound, 5 red); a cell
 * that skips its last row of tiles (the clump multiset, 5 red); `grassSpliceCells` re-placing no cell (4 maps red: the felled
 * pad's cells go stale). Disclosed survivor: `GRASS_SPLICE_EXTRA_TILES` at 0 stays green on every collapse walked here (the
 * terrain's dirty set is already 2 tiles wide); the 1 is the decor splice's own 3-tile reach (`DECOR_SPLICE_RADIUS_TILES`), kept
 * as a margin, not a measured need.
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { applyTerrain, maps, parseMap, paletteColor, structures as structureCatalogue, type MapId } from '@lions/data';
import { composeTerrainFrom, type ComposedTerrainBuild } from '@lions/render/three';
import {
  GRASS_CELL_TILES,
  grassCellGrid,
  grassCellMeshes,
  grassSpliceCells,
  placeGrassClumps,
  planGrassField,
  type GrassCellMesh,
} from '@lions/render/terrain';
import { rendererOptionsFor } from './renderer-options';

const HIGH = { colorVision: 'default', quality: 'high' } as const;
const BACKGROUND = paletteColor('shadow.1');
/** The node builder's per-mesh cap (`GRASS_INSTANCES_PER_MESH_MAX` in `grass-field.node.ts`: 16 KiB over a mat4), as a literal. */
const CAP = 256;
const GREEN = ['wadi_halam_basin', 'wadi_halam_2', 'wadi_halam_3', 'wadi_halam_4', 'wadi_halam_5'] as const;

function rig(id: MapId): { sim: Sim; build(prev: ComposedTerrainBuild | null): ComposedTerrainBuild } {
  const parsed = parseMap(maps[id]);
  const sim = new Sim({ seed: 20261111, width: parsed.width, height: parsed.height, capacity: 64 });
  applyTerrain(parsed, sim);
  const typeIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) typeIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  for (const b of parsed.structures) {
    const t = typeIdx.get(b.type);
    if (t === undefined) throw new Error(`map ${id}: unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  const tones = rendererOptionsFor(parsed, HIGH, '/').terrainTones;
  // The node boot's own call: the sward strokes off (they do not change the grass input either way).
  return {
    sim,
    build: (prev) => composeTerrainFrom(prev?.state ?? null, sim, parsed.decor, parsed.elevation, () => true, tones, paletteColor, BACKGROUND, null, false, false),
  };
}

/** The green maps that stand no structure (named, so a map that loses its structures is caught, not skipped). */
const NO_STRUCTURES: ReadonlySet<string> = new Set(['wadi_halam_3']);

const total0 = (list: readonly GrassCellMesh[]): number => list.reduce((n, m) => n + m.count, 0);
const keyOf = (m: GrassCellMesh): string => `${m.cell}|${m.variant}|${m.part}`;

/** The first difference between two mesh lists, or null when they are the same bytes. */
function planDiff(a: readonly GrassCellMesh[], b: readonly GrassCellMesh[]): string | null {
  if (a.length !== b.length) return `mesh count ${a.length} vs ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as GrassCellMesh;
    const y = b[i] as GrassCellMesh;
    if (keyOf(x) !== keyOf(y) || x.count !== y.count) return `mesh ${i}: ${keyOf(x)} x${x.count} vs ${keyOf(y)} x${y.count}`;
    // Each mesh carries 16 floats a clump: a mesh with count but no matrices would compare equal to itself below.
    if (x.matrices.length !== x.count * 16 || y.matrices.length !== y.count * 16) return `mesh ${keyOf(x)}: ${x.matrices.length} / ${y.matrices.length} floats for ${x.count} clumps`;
    for (let k = 0; k < x.matrices.length; k++) if (x.matrices[k] !== y.matrices[k]) return `mesh ${keyOf(x)} [${k}]: ${x.matrices[k]} vs ${y.matrices[k]}`;
    if (x.thin.count !== y.thin.count) return `mesh ${keyOf(x)}: thin ${x.thin.count} vs ${y.thin.count}`;
    for (let k = 0; k < x.thin.matrices.length; k++) if (x.thin.matrices[k] !== y.thin.matrices[k]) return `mesh ${keyOf(x)} thin [${k}]`;
  }
  return null;
}

describe('GH-1167 S5: the grass cells on the five green maps', () => {
  it.each(GREEN)('%s: at most 140 meshes (108 and the splits 12 a tile forces), none over the cap, holding exactly the placed clumps in back-to-front order', (id) => {
    const r = rig(id);
    const b = r.build(null);
    const input = b.composed.input;
    const surface = b.state.surface;
    const plan = planGrassField(input, surface, CAP);
    const { cellsX, cellsY } = grassCellGrid(input.width, input.height);
    expect(cellsX * cellsY).toBe(36);
    expect(plan.meshes.length).toBeLessThanOrEqual(140);
    // Anti-vacuity: the field is real on every map (about 21,000 clumps at 12 a tile) and 12 a tile DOES split some (cell, variant).
    expect(plan.meshes.length).toBeGreaterThan(108);
    expect(plan.meshes.every((m) => m.count <= CAP && m.count > 0)).toBe(true);
    expect(plan.meshes.some((m) => m.part > 0)).toBe(true);
    // The rung (GRASS_RUNG_KEEP 0.5): a subset of this part, about half of the map, at most one drawn mesh per (cell, variant) (108: the rung cuts the splits' draws).
    const thinTotal = plan.meshes.reduce((n, m) => n + m.thin.count, 0);
    expect(thinTotal / total0(plan.meshes)).toBeGreaterThan(0.45);
    expect(thinTotal / total0(plan.meshes)).toBeLessThan(0.55);
    expect(plan.meshes.every((m) => m.thin.count <= m.count && m.thin.matrices.length === m.thin.count * 16)).toBe(true);
    expect(plan.meshes.filter((m) => m.thin.count > 0).length).toBeLessThanOrEqual(108);
    // The clumps: S1's, as a multiset of (x, z, variant) and seat height.
    const placed = placeGrassClumps(input, surface);
    const total = plan.meshes.reduce((n, m) => n + m.count, 0);
    expect(total).toBe(placed.count);
    expect(total).toBeGreaterThan(19000);
    const fromS1 = new Map<string, number>();
    for (let i = 0; i < placed.count; i++) {
      const k = `${placed.x[i]}|${placed.y[i]}|${placed.z[i]}|${placed.variant[i]}`;
      fromS1.set(k, (fromS1.get(k) ?? 0) + 1);
    }
    for (const m of plan.meshes) {
      let lastKey = -Infinity;
      for (let i = 0; i < m.count; i++) {
        const o = i * 16;
        const x = m.matrices[o + 12] as number;
        const y = m.matrices[o + 13] as number;
        const z = m.matrices[o + 14] as number;
        const k = `${x}|${y}|${z}|${m.variant}`;
        const left = fromS1.get(k) ?? 0;
        expect(left, `${id}: a clump S1 did not place, ${k}`).toBeGreaterThan(0);
        fromS1.set(k, left - 1);
        // Back to front: the camera's depth key (x + z, with the seat) never falls inside a mesh.
        const depth = (x + z) * Math.cos(Math.PI / 6) * Math.SQRT1_2 + y * 0.5;
        expect(depth).toBeGreaterThanOrEqual(lastKey - 1e-5);
        lastKey = depth;
        // The cell: the source tile is within 0.1 tile of where the clump stands.
        const cx = m.cell % cellsX;
        const cy = Math.floor(m.cell / cellsX);
        expect(x).toBeGreaterThan(cx * GRASS_CELL_TILES - 0.11);
        expect(x).toBeLessThan((cx + 1) * GRASS_CELL_TILES + 0.11);
        expect(z).toBeGreaterThan(cy * GRASS_CELL_TILES - 0.11);
        expect(z).toBeLessThan((cy + 1) * GRASS_CELL_TILES + 0.11);
      }
    }
    expect([...fromS1.values()].every((n) => n === 0)).toBe(true);
  });

  it('a (cell, variant) over the cap is split into parts, in order', () => {
    const b = rig('wadi_halam_basin').build(null);
    const whole = grassCellMeshes(b.composed.input, b.state.surface, 14, CAP);
    const split = grassCellMeshes(b.composed.input, b.state.surface, 14, 16);
    // Anti-vacuity: cell 14 of the basin holds grass, so the per-variant loop below has parts to compare.
    expect(whole.length).toBeGreaterThan(0);
    expect(split.length).toBeGreaterThan(whole.length);
    for (const w of whole) {
      const parts = split.filter((s) => s.variant === w.variant);
      expect(parts.map((p) => p.part)).toEqual(parts.map((_, i) => i));
      const joined = new Float32Array(parts.reduce((n, p) => n + p.matrices.length, 0));
      let o = 0;
      for (const p of parts) {
        joined.set(p.matrices, o);
        o += p.matrices.length;
      }
      expect(joined).toEqual(w.matrices);
      // The rung's chunks join to the whole's rung list, in order, whatever the cap.
      const jt = new Float32Array(parts.reduce((n, p) => n + p.thin.matrices.length, 0));
      let ot = 0;
      for (const p of parts) {
        jt.set(p.thin.matrices, ot);
        ot += p.thin.matrices.length;
      }
      expect(jt).toEqual(w.thin.matrices);
      expect(jt.length).toBeGreaterThan(0);
    }
  });
});

describe('GH-1167 S5: a collapse re-places only the cells it touched, byte-identical to a full plan', () => {
  // Standing structures felled in turn until three splices re-placed some cells but not all (a low-profile structure's fall
  // changes no draw mask, so it re-places none); each step is two terrain builds and two field plans.
  it.each(GREEN)('%s: structures felled in turn, each splice from the last', (id) => {
    const r = rig(id);
    let build = r.build(null);
    let meshes: GrassCellMesh[] = [...planGrassField(build.composed.input, build.state.surface, CAP).meshes];
    const n = r.sim.structureCount;
    // A named exemption, not a silent skip: wadi_halam_3 stands no structure, so there is nothing to fell. Any other map with none
    // would skip every assertion below and report success; and when wadi_halam_3 gains one, this fails and the entry goes.
    expect(NO_STRUCTURES.has(id), `${id}: ${n} structures`).toBe(n === 0);
    if (n === 0) return;
    let felled = 0;
    let spliced = 0;
    for (let s = 0; s < n && spliced < 3; s++) {
      if (r.sim.structures.alive[s] !== 1) continue;
      r.sim.debugDestroyStructure(s);
      build = r.build(build);
      const dirty = build.dirtyTiles;
      expect(dirty, `${id} s${s}: the terrain spliced`).not.toBeNull();
      if (dirty === null) continue;
      const cells = grassSpliceCells(dirty, build.composed.input.width, build.composed.input.height);
      const touched = new Set(cells);
      const fresh = cells.flatMap((c) => grassCellMeshes(build.composed.input, build.state.surface, c, CAP));
      // The renderer's merge: keep every untouched cell's mesh, replace the touched cells', in plan order.
      meshes = [...meshes.filter((m) => !touched.has(m.cell)), ...fresh].sort((a, b) => a.cell - b.cell || a.variant - b.variant || a.part - b.part);
      const full = planGrassField(build.composed.input, build.state.surface, CAP).meshes;
      expect(planDiff(meshes, full), `${id} s${s}`).toBeNull();
      felled++;
      if (cells.length > 0 && cells.length < 36) spliced++;
    }
    // Anti-vacuity: something fell and the splice was partial.
    expect(felled).toBeGreaterThan(0);
    expect(spliced).toBe(3);
  }, 60_000);
});
