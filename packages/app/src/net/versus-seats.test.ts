import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapId } from '@lions/data';
import { Sim } from '@lions/sim';
import { VERSUS_FAIR_MAPS } from '@lions/net';
import { standMapStructures } from '../map-sim';
import { sandboxAnchors } from '../sandbox-anchors';
import { VERSUS_SEATS, versusAnchors } from './versus-seats';

const seats = (id: MapId) => {
  const a = versusAnchors(parseMap(maps[id]));
  return [[...a.friendly], [...a.hostile]];
};

describe('versusAnchors: the measured versus seats', () => {
  it('stands each measured map on its table entry (literals)', () => {
    expect(seats('beit_sahwan_outskirts')).toEqual([[4, 23], [40, 24]]);
    expect(seats('tel_marum')).toEqual([[24, 46], [28, 16]]);
    expect(seats('wadi_tarfan')).toEqual([[11, 11], [36, 36]]);
  });

  it('reads a versus map its own named seats, and the raw JSON the same as the parsed map', () => {
    expect(seats('milh_flats')).toEqual([[9, 38], [38, 9]]);
    for (const id of VERSUS_FAIR_MAPS as MapId[]) {
      const raw = versusAnchors(maps[id]);
      expect([[...raw.friendly], [...raw.hostile]]).toEqual(seats(id));
    }
  });

  it('leaves the single-player sandbox on its own pick (the golden gate photographs it)', () => {
    const a = sandboxAnchors(maps.beit_sahwan_outskirts);
    expect([[...a.friendly], [...a.hostile]]).toEqual([[4, 23], [31, 22]]);
    const b = sandboxAnchors(maps.tel_marum);
    expect([[...b.friendly], [...b.hostile]]).toEqual([[24, 44], [28, 16]]);
  });

  it('names only maps a room is offered, and every seat stands on open ground', () => {
    for (const [id, a] of Object.entries(VERSUS_SEATS)) {
      expect(VERSUS_FAIR_MAPS).toContain(id);
      const map = parseMap(maps[id as MapId]);
      const sim = new Sim({ seed: 1, width: map.width, height: map.height, capacity: 8 });
      applyTerrain(map, sim);
      standMapStructures(sim, map);
      for (const [x, y] of [a.friendly, a.hostile]) expect(sim.blocked[y * sim.width + x]).toBe(0);
    }
  });
});
