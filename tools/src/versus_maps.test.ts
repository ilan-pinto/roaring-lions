// The two dedicated 1v1 versus maps (2026-10-14): Wadi Tarfan (the three
// fords) and Milh Flats (Bir Milh). A versus map is fair by CONSTRUCTION
// before it is fair by measurement: every tile, height, marker, zone and
// building turns into its twin under a half-turn about the map centre
// (x, y) -> (W-1-x, H-1-y), the two seats are each other's twin, and a
// force spawned on either seat lands exactly where its formation says, in
// every faction pairing a room can host. Everything here is checked from the
// shipped JSON through the real loader, the real `FlowField` and the real
// `versusSpawns` -- not from the generator that wrote the maps.
//
// Falsified when written, each on wadi_tarfan's JSON, seen red, then put back:
// one row character flipped (symmetry); one elevation digit lowered
// (symmetry); `versus_1` moved one tile (seat mirror, marker pairs, the KDF
// mirror's spawn); seat 0's own tile raised to level 9 (symmetry, and the
// seat-to-seat cost, since leaving it is all descent and arriving is a climb);
// a `^` on a formation tile at (11,12) (symmetry, and all three pairings'
// spawn checks). `sandboxAnchors`' by-name read disabled turns the seat
// checks in packages/app/src/sandbox-anchors.test.ts red.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, units, type MapJson } from '@lions/data';
import type { Faction } from '@lions/net';
import { FlowField } from '../../packages/sim/src/flowfield';
import { Sim } from '../../packages/sim/src/sim';
import { standMapStructures } from '../../packages/app/src/map-sim';
import { sandboxAnchors } from '../../packages/app/src/sandbox-anchors';
import { versusForceOf, versusSpawns } from '../../packages/app/src/net/versus-force';

const VERSUS_MAPS = ['wadi_tarfan', 'milh_flats'] as const;

/** Markers with no twin, by name, and why. Milh Flats' `centre` sits on
 *  (23,23), one of the four tiles round the true centre (23.5,23.5): as a
 *  single goal it favours seat 1 by 0.6 tiles, so anything that scores held
 *  ground scores the `bir_milh` zone, which IS its own twin. */
const UNPAIRED: Record<string, readonly string[]> = { wadi_tarfan: [], milh_flats: ['centre'] };

type Pt = readonly [number, number];
const PAIRINGS: readonly (readonly [Faction, Faction])[] = [['kdf', 'kdf'], ['kdf', 'sarim'], ['sarim', 'kdf']];

function world(id: (typeof VERSUS_MAPS)[number]) {
  const json = maps[id] as MapJson;
  const map = parseMap(json);
  const sim = new Sim({ seed: 20261014, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  standMapStructures(sim, map);
  const typeOf = new Map<string, number>();
  for (const [uid, u] of Object.entries(units)) typeOf.set(uid, sim.addUnitType(u as never));
  return { json, map, sim, typeOf };
}

describe.each(VERSUS_MAPS)('versus map %s', (id) => {
  const { json, map } = world(id);
  const W = map.width;
  const H = map.height;
  const mirror = (p: readonly number[]): Pt => [W - 1 - p[0], H - 1 - p[1]];
  const markers = json.markers as Record<string, readonly number[]>;
  const zones = (json.zones ?? {}) as Record<string, readonly number[]>;

  it('is a square 48x48 map with relief', () => {
    expect([W, H]).toEqual([48, 48]);
    expect(json.elevation?.length).toBe(H);
  });

  it('every tile and every height is its own half-turn twin', () => {
    const rows = json.rows;
    const elev = json.elevation ?? [];
    const off: string[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (rows[y][x] !== rows[H - 1 - y][W - 1 - x]) off.push(`row ${x},${y}`);
        if (elev[y][x] !== elev[H - 1 - y][W - 1 - x]) off.push(`elevation ${x},${y}`);
      }
    }
    expect(off).toEqual([]);
  });

  it('names both seats, and each is the other mirrored', () => {
    expect(markers.versus_0).toBeDefined();
    expect(markers.versus_1).toBeDefined();
    expect(mirror(markers.versus_0)).toEqual([...markers.versus_1]);
  });

  it('reads its seats by name: side 0 on versus_0, side 1 on versus_1', () => {
    const a = sandboxAnchors(json);
    expect([[...a.friendly], [...a.hostile]]).toEqual([[...markers.versus_0], [...markers.versus_1]]);
  });

  it('every marker has a twin, and every _0 marker is its _1 marker mirrored', () => {
    const at = new Set(Object.values(markers).map((p) => `${p[0]},${p[1]}`));
    const lonely = Object.entries(markers)
      .filter(([, p]) => !at.has(mirror(p).join(',')))
      .map(([n]) => n)
      .sort();
    expect(lonely).toEqual([...UNPAIRED[id]]);
    const pairs = Object.keys(markers).filter((n) => n.endsWith('_0'));
    expect(pairs.length).toBeGreaterThan(3);
    for (const n of pairs) {
      const twin = markers[`${n.slice(0, -2)}_1`];
      expect(twin, `${n} has no _1`).toBeDefined();
      expect(mirror(markers[n]), n).toEqual([...twin]);
    }
  });

  it('every zone is a zone mirrored', () => {
    const key = (r: readonly number[]) => r.join(',');
    const have = new Set(Object.values(zones).map(key));
    for (const [n, [x, y, w, h]] of Object.entries(zones)) {
      expect(have.has(key([W - x - w, H - y - h, w, h])), n).toBe(true);
      if (n.endsWith('_0')) expect(zones[`${n.slice(0, -2)}_1`], n).toEqual([W - x - w, H - y - h, w, h]);
    }
  });

  it('every building is a building of the same type mirrored', () => {
    // Tiles are row-major indices, and a half-turn sends index t to W*H-1-t.
    const key = (type: string, tiles: readonly number[]) => `${type}:${[...tiles].sort((a, b) => a - b).join(' ')}`;
    const have = new Set(map.structures.map((s) => key(s.type, s.tiles)));
    expect(map.structures.length).toBeGreaterThan(0);
    for (const s of map.structures) {
      expect(have.has(key(s.type, s.tiles.map((t) => W * H - 1 - t))), key(s.type, s.tiles)).toBe(true);
    }
  });

  it('seat to seat costs the same both ways, on foot and on wheels, and armour can make it', () => {
    const { sim } = world(id);
    const cost = (mask: Uint8Array, from: readonly number[], to: readonly number[]) => {
      const f = new FlowField(W, H);
      f.compute(mask, sim.elevation, to[0], to[1]);
      return f.costAt(from[1] * W + from[0]);
    };
    for (const [domain, mask] of [['foot', sim.blocked], ['vehicle', sim.blockedVehicle]] as const) {
      const there = cost(mask, markers.versus_0, markers.versus_1);
      const back = cost(mask, markers.versus_1, markers.versus_0);
      expect(there, domain).toBe(back);
      // A finite route: unreachable reads as the field's own sentinel, far
      // above any real 48x48 cost.
      expect(there, domain).toBeGreaterThan(0);
      expect(there, domain).toBeLessThan(10 * W * H);
    }
  });

  it.each(PAIRINGS)('spawns %s against %s on the map, where the formation says, mirrored', (f0, f1) => {
    const { sim, typeOf } = world(id);
    const anchors = sandboxAnchors(json);
    const force = versusSpawns(sim, typeOf, anchors, [f0, f1]);
    const tileOf = (e: number): Pt => [sim.state.posX[e] / 65536 - 0.5, sim.state.posY[e] / 65536 - 0.5];
    const wrong: string[] = [];
    for (const side of [0, 1] as const) {
      const [ax, ay] = side === 0 ? anchors.friendly : anchors.hostile;
      const sgn = side === 0 ? 1 : -1;
      versusForceOf(side === 0 ? f0 : f1).forEach(([uid, dx, dy], i) => {
        const want: Pt = [ax + sgn * dx, ay + sgn * dy];
        const got = tileOf(force.bySide[side][i]);
        if (got[0] !== want[0] || got[1] !== want[1]) wrong.push(`side ${side} ${uid} #${i}: wanted ${want} got ${got}`);
      });
    }
    // Every unit on its own formation tile: none off the map, none pushed
    // aside by rock or a wall, so the two forces are each other's mirror.
    expect(wrong).toEqual([]);
    if (f0 === f1) {
      force.bySide[0].forEach((e, i) => expect(mirror(tileOf(e)), `#${i}`).toEqual([...tileOf(force.bySide[1][i])]));
    }
  });
});
