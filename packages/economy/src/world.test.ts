import { describe, expect, it } from 'vitest';
import { parseWorld } from './world';

// GH-1385 F6: `parseWorld`'s authoring-to-runtime mapping was read only through the shipped world.json, whose towns
// have x equal to nothing special and whose regions all carry a blurb.

const region = (over: object = {}) => ({
  id: 'r1',
  name: 'R1',
  faction: 'sarim',
  doctrine: 'static',
  towns: [{ id: 't1', name: 'T1', at: [7, 3], missions: ['m1', 'm2'] }],
  ...over,
});
const world = (regions: object[]) => ({ id: 'w', name: 'W', art: 'campaign/w.svg', regions });

describe('parseWorld', () => {
  it('reads a town position as x then y', () => {
    expect(parseWorld(world([region()])).regions[0]?.towns[0]?.at).toEqual([7, 3]);
  });

  it('carries a blurb when the region has one and no blurb key when it has none', () => {
    const p = parseWorld(world([region({ blurb: 'about r1' }), region({ id: 'r2' })]));
    expect(p.regions[0]?.blurb).toBe('about r1');
    expect(p.regions[1]).not.toHaveProperty('blurb');
  });

  it('maps the authored gate names, and leaves an empty gate off', () => {
    const p = parseWorld(
      world([
        region({
          unlock: { after_mission: 'm0', roe_rating_min: 70 },
          towns: [
            { id: 't1', name: 'T1', at: [1, 1], missions: [], unlock: { roe_rating_min: 80 } },
            { id: 't2', name: 'T2', at: [1, 1], missions: [] },
          ],
        }),
      ])
    );
    expect(p.regions[0]?.unlock).toEqual({ afterMission: 'm0', roeMin: 70 });
    expect(p.regions[0]?.towns[0]?.unlock).toEqual({ roeMin: 80 });
    expect(p.regions[0]?.towns[1]).not.toHaveProperty('unlock');
  });

  it('refuses anything that is not an object with a regions array', () => {
    expect(() => parseWorld(null)).toThrow();
    expect(() => parseWorld({})).toThrow('world: expected an object with a regions array');
    expect(() => parseWorld({ regions: 'x' })).toThrow('world: expected an object with a regions array');
  });
});
