/**
 * GH-871 P4 T3: control C, the marsh water and puddle masks, on the shipped
 * maps.
 *
 * Three claims, each with its input that makes it fail (the commit message
 * names them):
 *
 *  1. NO SHIPPED MAP ALLOCATES C. `buildControlMap` is given every non-wetland
 *     map's real input AND its real surface, with `wet` absent, and answers
 *     `c: null`. The surface is passed on purpose: without it `c` would be
 *     null for the wrong reason (the casebook's empty array). The gate is
 *     `wet`, not "the map has a `~`": no shipped map has a `~` but Ein Qasab,
 *     so a gate on the marsh would pass this test while allocating C for
 *     nothing. The control is Ein Qasab with `wet: true`.
 *  2. THE SHARES, measured over C's texels on Ein Qasab (the brief's bands).
 *  3. THE REEDS AND THE WATER AGREE: at every reed the real placer puts down,
 *     the C.R texel under its centre reads under 0.5.
 *
 * The oracles are LITERALS (the bands, the tile symbols, `DECOR_MARSH` = 6 is
 * restated), never read back from the code under test.
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain, structures as structureCatalogue, paletteColor, type MapId, type MapJson } from '@lions/data';
import { composeTerrainFrom, type ComposedTerrainBuild } from '@lions/render/three';
import { buildControlMap, CONTROL_TEXELS_PER_TILE as N, marshWaterAt } from '@lions/render/terrain';
import { rendererOptionsFor } from './renderer-options';

const HIGH = { colorVision: 'default', quality: 'high' } as const;
const BACKGROUND = paletteColor('shadow.1');

/** The real composed terrain of a shipped map: the input and the surface the
 *  renderer would bake from. */
function compose(id: MapId, wet: boolean): ComposedTerrainBuild {
  const parsed = parseMap(maps[id]);
  const sim = new Sim({ seed: 20261030, width: parsed.width, height: parsed.height, capacity: 64 });
  applyTerrain(parsed, sim);
  const typeIdx = new Map<string, number>();
  for (const [sid, spec] of Object.entries(structureCatalogue)) {
    typeIdx.set(sid, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of parsed.structures) {
    const t = typeIdx.get(b.type);
    if (t === undefined) throw new Error(`map ${id}: unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  const tones = rendererOptionsFor(parsed, HIGH, '/').terrainTones;
  return composeTerrainFrom(null, sim, parsed.decor, parsed.elevation, () => true, tones, paletteColor, BACKGROUND, null, wet);
}

const terrainOf = (id: MapId): string | undefined => (maps[id] as MapJson).terrain;
const shipped = (Object.keys(maps) as MapId[]).filter((id) => terrainOf(id) !== 'wetland');

describe('no shipped map allocates control C', () => {
  it('there are 35 non-wetland maps, and Ein Qasab is the only wetland one', () => {
    expect(shipped.length).toBe(35);
    expect((Object.keys(maps) as MapId[]).filter((id) => terrainOf(id) === 'wetland')).toEqual(['ein_qasab']);
  });

  it('buildControlMap gives c: null for every one of them, with its real surface and `wet` absent', () => {
    for (const id of shipped) {
      const build = compose(id, false);
      expect('wet' in build.composed.input, `${id}: a dry input has no wet key`).toBe(false);
      expect(buildControlMap(build.composed.input, build.state.surface).c, `${id}: c`).toBeNull();
    }
  }, 120_000);

  it('the control is not vacuous: Ein Qasab under rain allocates it, and without `wet` it does not', () => {
    const wet = compose('ein_qasab', true);
    expect(wet.composed.input.wet).toBe(true);
    const c = buildControlMap(wet.composed.input, wet.state.surface).c;
    expect(c).not.toBeNull();
    expect((c as Uint8Array).length).toBe(48 * N * 48 * N * 4);
    const dry = compose('ein_qasab', false);
    expect(buildControlMap(dry.composed.input, dry.state.surface).c).toBeNull();
  });
});

describe('control C on ein_qasab', () => {
  const build = compose('ein_qasab', true);
  const input = build.composed.input;
  const cm = buildControlMap(input, build.state.surface);
  const c = cm.c as Uint8Array;

  /** Shares over C's texels. `byte >= 128` is a channel at or over 0.5. */
  function shares() {
    let marshN = 0, marshWater = 0, roadN = 0, roadPuddle = 0, openN = 0, openPuddle = 0, elsewherePuddle = 0;
    for (let j = 0; j < cm.height; j++) {
      for (let i = 0; i < cm.width; i++) {
        const o = (j * cm.width + i) * 4;
        const t = Math.floor(j / N) * input.width + Math.floor(i / N);
        const puddle = c[o + 1] >= 128;
        const onRoad = cm.b[o + 1] < 92; // B's road distance under 0.36 tile (ROAD_HALF_WIDTH), the road surface
        if (input.decor !== null && input.decor[t] === 6) {
          marshN++;
          if (c[o] >= 128) marshWater++;
        }
        if (onRoad) {
          roadN++;
          if (puddle) roadPuddle++;
        } else if (input.blocked[t] === 0 && input.decor !== null && input.decor[t] === 0 && input.cover[t] === 0) {
          openN++;
          if (puddle) openPuddle++;
        } else if (puddle) elsewherePuddle++;
      }
    }
    return { marsh: marshWater / marshN, road: roadPuddle / roadN, open: openPuddle / openN, elsewherePuddle, marshN, roadN, openN };
  }

  it('measures a real map: tens of thousands of marsh and open texels, thousands of road texels', () => {
    const s = shares();
    expect(s.marshN).toBe(311 * 64);
    expect(s.roadN).toBeGreaterThan(4000);
    expect(s.openN).toBeGreaterThan(90000);
  });

  it('marsh water covers 0.25-0.35 of the ~ texels (P2 read 0.3119 from the function)', () => {
    const s = shares();
    expect(s.marsh).toBeGreaterThanOrEqual(0.25);
    expect(s.marsh).toBeLessThanOrEqual(0.35);
    expect(s.marsh).toBeCloseTo(0.3119, 2);
  });

  it('road puddles cover 0.25-0.35 of the road texels', () => {
    const s = shares();
    expect(s.road, `road ${s.road}`).toBeGreaterThanOrEqual(0.25);
    expect(s.road).toBeLessThanOrEqual(0.35);
  });

  it('open-ground puddles cover 0.04-0.08 of the open texels', () => {
    const s = shares();
    expect(s.open, `open ${s.open}`).toBeGreaterThanOrEqual(0.04);
    expect(s.open).toBeLessThanOrEqual(0.08);
  });

  it('puts no puddle on a marsh, cover, grove or pad tile', () => {
    expect(shares().elsewherePuddle).toBe(0);
  });

  it('agrees with the reeds, to the texel: the placer keeps every clump centre off the water, and a texel under a reed that still reads water has a dry neighbour', () => {
    const reeds = build.composed.decorPlacements.filter((p) => p.family === 'reed');
    expect(reeds.length, 'P2 counts 447 reeds').toBe(447);
    const byteAt = (i: number, j: number): number =>
      c[(Math.min(cm.height - 1, Math.max(0, j)) * cm.width + Math.min(cm.width - 1, Math.max(0, i))) * 4];
    const inWater: Array<[number, number]> = [];
    for (const r of reeds) {
      // The placer's own contract, on the POINT: this is the by-construction half.
      expect(marshWaterAt(input.decor, input.width, input.height, r.x, r.z), `reed (${r.x}, ${r.z})`).toBeLessThan(0.5);
      const i = Math.floor(r.x * N);
      const j = Math.floor(r.z * N);
      if (byteAt(i, j) >= 128) inWater.push([i, j]);
    }
    // The texel is 0.125 tile and the water edge is steep, so a reed a hair from
    // the edge can stand in a texel whose CENTRE is water. Measured: 27 of 447.
    // The bound keeps that from growing; the neighbour check keeps it an EDGE
    // effect: every such reed is within one texel of dry.
    expect(inWater.length, 'reeds on a water texel').toBeLessThanOrEqual(30);
    expect(inWater.length, 'the check bites: some reed does stand on a water texel').toBeGreaterThan(0);
    for (const [i, j] of inWater) {
      let dry = false;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (byteAt(i + di, j + dj) < 128) dry = true;
      expect(dry, `texel (${i}, ${j}) has no dry neighbour`).toBe(true);
    }
  });
});
