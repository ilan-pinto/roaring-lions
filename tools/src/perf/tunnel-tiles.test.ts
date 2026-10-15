import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tunnelRouteTiles } from './tunnel-tiles';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('tunnelRouteTiles', () => {
  it('covers every point of a route: mouth, waypoints and vent', () => {
    const tiles = tunnelRouteTiles([{ mouth: [27, 13], waypoints: [[29, 15]], vent: [32, 17] }]);
    const has = (x: number, y: number) => tiles.some(([a, b]) => a === x && b === y);
    expect(has(27, 13)).toBe(true);
    expect(has(29, 15)).toBe(true);
    expect(has(32, 17)).toBe(true);
    // ...and the tiles between them, not just the corners.
    expect(has(28, 14)).toBe(true);
    expect(has(31, 16) || has(30, 16)).toBe(true);
  });

  it('lists each tile once', () => {
    const tiles = tunnelRouteTiles([{ mouth: [0, 0], vent: [5, 0] }]);
    expect(tiles).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);
  });

  it('on beit_sahwan_outskirts (the vehicle-damage sheet\'s map) includes the vent the paramotor was parked over', () => {
    const map = JSON.parse(readFileSync(path.join(REPO, 'data/maps/beit_sahwan_outskirts.json'), 'utf8')) as {
      tunnels: { mouth: [number, number]; waypoints?: [number, number][]; vent: [number, number] }[];
    };
    const tiles = tunnelRouteTiles(map.tunnels);
    expect(tiles.some(([x, y]) => x === 32 && y === 17)).toBe(true);
    expect(map.tunnels.length).toBe(4);
  });
});
