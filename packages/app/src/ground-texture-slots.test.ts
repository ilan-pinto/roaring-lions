/**
 * `ThreeRenderer.loadGroundTexture`'s boot-cost fix (2026-09-06, "Ground
 * tiles load unconditionally"): it now skips fetching a ground-albedo image
 * no tile on the CURRENT map can ever sample, decided by
 * `groundAlbedoSlotsUsed` (`@lions/render/terrain`, `terrain/ground.ts`).
 *
 * That function cannot be exercised against real shipped map data from
 * inside `packages/render` at all -- `eslint.config.mjs` bans that package
 * from importing `@lions/data`, which is what turns `data/maps/*.json` into
 * the `Sim` + `TerrainInput` this needs. This suite (a `packages/app` test
 * file, therefore exempt from the production-app `@lions/render/terrain`
 * import restriction the same rule adds) is where the real-map pin has to
 * live, the same reason `terrain-parity.test.ts` lives here rather than
 * alongside the builders it tests.
 *
 * Ground plan Task 7 retired `buildGround`'s seven per-vertex albedo masks
 * (`sandMask`/`rockMask`/`roadMask`/`roadAxis`/`scrubMask`/`groveMask`/
 * `knollMask`) along with `albedoFor`, the private per-tile decision that
 * filled them -- Tasks 5 and 6 had already moved the fragment's own surface
 * decision to the control map and the road's distance field, so those seven
 * arrays had stopped reaching the GPU. This file's guard rail used to walk
 * `buildGround`'s own masks independently of `groundAlbedoSlotsUsed`; now
 * that there is no vertex-level copy of the decision left to walk, it reads
 * the CONTROL MAP instead -- the data `GroundMaterial` actually samples at
 * render time -- which is the same shift `groundAlbedoSlotsUsed` itself made
 * (`ground.ts`'s `tileSurface` walk, not a re-derivation of the map symbols).
 *
 * The guard rail this task must not fail: "if a map's tiles can sample a
 * slot the loader would skip, that is the bug this task must not
 * introduce."
 */
import { describe, it, expect } from 'vitest';
import { Sim } from '@lions/sim';
import { maps, parseMap, applyTerrain, structures as structureCatalogue, type MapId } from '@lions/data';
import {
  buildControlMap,
  groundAlbedoSlotsUsed,
  tileSurface,
  CONTROL_TEXELS_PER_TILE as N,
  type TerrainInput,
  type GroundAlbedoSlot,
} from '@lions/render/terrain';

const MAP_IDS = Object.keys(maps) as MapId[];

/**
 * Builds the same `TerrainInput` `ThreeRenderer.loadGroundTexture` now
 * builds -- `sim.width`/`height`/`blocked`/`cover` (populated by
 * `applyTerrain`/`addStructure`, exactly `main.ts`'s own boot sequence) and
 * the map's own `decor`/`elevation` arrays. Not imported from
 * `terrain-parity.test.ts`'s own `loadMap`: that file is under active review
 * elsewhere in this branch, and duplicating a dozen lines of `Sim` bring-up
 * is cheaper than coupling two independent test suites together.
 */
function loadInput(id: MapId): { input: TerrainInput } {
  const parsedMap = parseMap(maps[id]);
  const sim = new Sim({ seed: 20260727, width: parsedMap.width, height: parsedMap.height, capacity: 256 });
  applyTerrain(parsedMap, sim);
  const structTypeIdx = new Map<string, number>();
  for (const [structId, spec] of Object.entries(structureCatalogue)) {
    structTypeIdx.set(structId, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of parsedMap.structures) {
    const t = structTypeIdx.get(b.type);
    if (t === undefined) throw new Error(`map ${id} references unknown structure type ${b.type}`);
    sim.addStructure(t, b.tiles);
  }
  return {
    input: {
      width: parsedMap.width,
      height: parsedMap.height,
      decor: parsedMap.decor,
      elevation: parsedMap.elevation,
      blocked: sim.blocked,
      cover: sim.cover,
    },
  };
}

/**
 * Which ground-albedo slots the real CONTROL MAP carries a non-zero weight
 * for, anywhere on the map -- an INDEPENDENT walk of the texture
 * `GroundMaterial` actually samples, not the private per-tile decision
 * (`tileSurface`) that produced it.
 *
 * Control A is `open, rock, scrub, grove` and control B is `knoll, road
 * distance, junction distance, road-edge bend` (`control-map.ts`'s own
 * `ControlMap` doc). A texel's road-distance channel reading under 255 means
 * a road is within range there -- which pulls the KNOLL image in for the
 * road's own grain (R-7), even on a texel with no knoll weight of its own --
 * so it counts toward `knoll` exactly the way `groundAlbedoSlotsUsed` itself
 * folds a `road` tile's derivation into `sand` + `knoll`.
 */
function slotsInControlMap(input: TerrainInput): Set<GroundAlbedoSlot> {
  const cm = buildControlMap(input);
  const used = new Set<GroundAlbedoSlot>();
  for (let o = 0; o < cm.a.length; o += 4) {
    if (cm.a[o] > 0) used.add('sand');
    if (cm.a[o + 1] > 0) used.add('rock');
    if (cm.a[o + 2] > 0) used.add('scrub');
    if (cm.a[o + 3] > 0) used.add('grove');
    if (cm.b[o] > 0) used.add('knoll');
    if (cm.b[o + 1] < 255) used.add('knoll');
  }
  return used;
}

describe.each(MAP_IDS)('ground albedo slot derivation: %s', (id) => {
  it("groundAlbedoSlotsUsed is a superset of every non-zero channel the control map actually carries", () => {
    const { input } = loadInput(id);
    const controlSlots = slotsInControlMap(input);
    const derived = groundAlbedoSlotsUsed(input);

    // The superset the task exists to guarantee: every slot the control map
    // ever carries a weight for must be in the derived set, on every shipped
    // map, or the corresponding texture would silently never be fetched.
    for (const slot of controlSlots) {
      expect(derived.has(slot), `${id}: the control map carries ${slot} but groundAlbedoSlotsUsed omits it`).toBe(
        true
      );
    }
  });
});

describe('the control map on every shipped map', () => {
  it.each(MAP_IDS)('%s: 8 texels a tile, and every tile core carries its own surface', (id) => {
    const { input } = loadInput(id);
    const cm = buildControlMap(input);
    expect([cm.width, cm.height]).toEqual([input.width * N, input.height * N]);
    const channel = { open: ['a', 0], road: ['a', 0], rock: ['a', 1], scrub: ['a', 2], grove: ['a', 3], knoll: ['b', 0] } as const;
    for (let y = 0; y < input.height; y++)
      for (let x = 0; x < input.width; x++) {
        const s = tileSurface(input, x, y);
        const o = ((y * N + 3) * cm.width + (x * N + 3)) * 4;
        if (s.kind === 'pad') {
          expect(cm.a[o] + cm.a[o + 1] + cm.a[o + 2] + cm.a[o + 3] + cm.b[o], `${id} (${x},${y}) pad`).toBe(0);
          continue;
        }
        const [t, c] = channel[s.kind];
        const want = Math.floor(0.9 * s.strength * 255);
        // Controller ruling F-1: the brief's own bound ("own channel alone
        // >= 0.9 * strength * 255") fails on the 10 of 26 maps with ridges,
        // because the approved ridge apron (APRON_TILES) deliberately walks
        // up to 0.5 tile of rock onto the open ground beside it -- see
        // `control-map.ts`'s `surfaceWeightsAt` doc, step 5. For every kind
        // but rock itself, count that borrowed rock weight back in rather
        // than weakening the apron to pass a test.
        if (s.kind === 'rock') {
          expect(cm[t][o + c], `${id} (${x},${y}) ${s.kind}`).toBeGreaterThanOrEqual(want);
        } else {
          const rockBleed = cm.a[o + 1];
          expect(cm[t][o + c] + rockBleed, `${id} (${x},${y}) ${s.kind}`).toBeGreaterThanOrEqual(want);
        }
      }
  });

  // G2 on real data: qarn_hadid's road runs diagonally from (29,28) to (24,33).
  // Every texel along that segment is within a texel's diagonal of the centreline.
  it('joins qarn_hadid\'s diagonal road into one line (G2)', () => {
    const { input } = loadInput('qarn_hadid');
    const cm = buildControlMap(input);
    for (let k = 0; k <= 40; k++) {
      const x = 29.5 - (5 * k) / 40;
      const z = 28.5 + (5 * k) / 40;
      const o = (Math.floor(z * N) * cm.width + Math.floor(x * N)) * 4;
      expect(cm.b[o + 1], `(${x.toFixed(3)}, ${z.toFixed(3)})`).toBeLessThanOrEqual(23);
    }
  });
});
