// Tel Marum's standoff doctrine, as assertions.
//
// The missions rest on three claims that arithmetic cannot settle: what the
// west pocket can see, what the northern valley can see into the narrow
// corridor, and what the Grad battery can reach. Range is arithmetic; sight is
// not, and a ray drawn by eye got all three wrong during design. Every claim
// here is driven through the real Sim.
//
// Every negative is paired with a positive on the same geometry. A test that
// only asserts "cannot see" passes when the spawn is broken, when sight range
// is too short, or when detection never ran.
//
// What this file proves and what it does not: OBSERVER below has
// sight_tiles: 48, far past anything on this map, so every `sees()` result
// here is a TERRAIN-AND-LOS fact -- "nothing solid blocks this ray" -- not a
// claim about what any unit actually posted on the map can see. The garrison
// unit standing at these positions, `sarim_rifles`, has sight_tiles: 9
// (data/units/enemy/sarim_rifles.json), which is well short of several rays
// this file proves are geometrically clear. Do not read a `sees()` result
// here as "the roster sees this" without checking the poster's own sight.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

/** Sight far past anything on this map, so only terrain can hide. The longest
 *  ray here is the battery to the start line, 38 tiles, inside 48. */
const OBSERVER: UnitTypeJson = {
  id: 't_observer',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 48, signature: 0.6 },
};

type Pt = readonly [number, number];

function sees(a: Pt, b: Pt): boolean {
  const map = parseMap(maps.tel_marum as MapJson);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
  const t = sim.addUnitType(OBSERVER);
  const watcher = sim.spawn(t, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const target = sim.spawn(t, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  const detection = sim.debugDetection(watcher, target);
  if (!detection) throw new Error(`no detection record between ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  return detection.visible;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Look up a named marker on the Tel Marum map, or throw. Mirrors the `zone()`
 *  helper below -- a missing (or malformed) marker should read as a named
 *  error, not a silent `undefined` destructure past `noUncheckedIndexedAccess`. */
function marker(name: string): Pt {
  const raw = (maps.tel_marum as MapJson).markers?.[name];
  if (!raw || raw.length < 2 || raw[0] === undefined || raw[1] === undefined) {
    throw new Error(`map has no "${name}" marker`);
  }
  return [raw[0], raw[1]];
}

/** grad_122, from data/units/enemy/rocket_battery.json. */
const GRAD_RANGE = 20;
const GRAD_MIN_RANGE = 4;

const BATTERY: Pt = [25, 6];
const HOLLOW: Pt = [24, 29];
const APPROACH: Pt = [24, 24];
const START: Pt = [24, 44];
const SADDLE_NARROW: Pt = [10, 14];
const SADDLE_WIDE: Pt = [24, 14];
const PASS: Pt = [24, 12];
const OVERWATCH_W: Pt = [20, 16];
const SPOTTER_NARROW: Pt = [12, 4];

describe("the Grad battery's envelope", () => {
  it('reaches both saddles, the pass and the approach', () => {
    for (const p of [PASS, SADDLE_WIDE, SADDLE_NARROW, APPROACH]) {
      const d = dist(BATTERY, p);
      expect(d).toBeGreaterThan(GRAD_MIN_RANGE);
      expect(d).toBeLessThanOrEqual(GRAD_RANGE);
    }
  });

  it('reaches the narrow saddle that the Kornet pockets cannot', () => {
    // What makes the flank chargeable at all: 17.0 for the battery, and the
    // pocket is both out of range and behind rock (asserted below). Whether
    // the flank is actually priced in the shipped mission is a separate,
    // disproved question -- see the Tel Marum saddle bullet in CLAUDE.md.
    expect(dist(BATTERY, SADDLE_NARROW)).toBeCloseTo(17.0, 1);
    expect(dist(BATTERY, SADDLE_NARROW)).toBeLessThanOrEqual(GRAD_RANGE);
  });

  it('does not reach the hollow or the start line', () => {
    expect(dist(BATTERY, HOLLOW)).toBeGreaterThan(GRAD_RANGE);
    expect(dist(BATTERY, START)).toBeGreaterThan(GRAD_RANGE);
  });
});

describe('the west pocket', () => {
  it('sees the approach, so the battery can be given eyes on it', () => {
    expect(sees(OVERWATCH_W, APPROACH)).toBe(true);
  });

  it('cannot see the hollow, so the hollow is dead ground twice over', () => {
    // Out of the battery's range AND unobservable. This is why foothold holds
    // the approach rather than the hollow.
    expect(sees(OVERWATCH_W, HOLLOW)).toBe(false);
  });

  it('cannot see the narrow saddle — terrain, not a diagnosed fix', () => {
    // Not a near miss on range: x=12..18 at y=15..17 is solid rock between
    // them. Paired with the positive above so a broken spawn cannot pass.
    // This is why the west pocket can never give the battery eyes on the
    // corridor -- it does not re-diagnose why the narrow spotter's own kill
    // fails to price the flank; that is a target-selection question, not a
    // west-pocket one (see the Tel Marum saddle bullet in CLAUDE.md).
    expect(sees(OVERWATCH_W, SADDLE_NARROW)).toBe(false);
  });
});

describe('the narrow corridor', () => {
  it('has an unobstructed line of sight from the northern valley along its whole length', () => {
    // Terrain/LOS fact only, per the header note above: this is what OBSERVER
    // (sight 48) can see, not what `tm_spotter_narrow` can. That unit is
    // sarim_rifles, sight 9 -- it sees only the corridor's north exit row,
    // (11,12) at 8.06 tiles, and none of y=13 (9.22), y=15 (11.18) or y=17
    // (13.15). "Watched along its whole length" describes the ground, not
    // the roster posted on it.
    for (const y of [13, 15, 17]) {
      expect(sees(SPOTTER_NARROW, [10, y] as Pt)).toBe(true);
    }
  });

  it('is not watched from its own mouth', () => {
    // Same-target pair: prove [10,14] is a live, detectable target before
    // asserting that the corridor's own mouth cannot see it.
    expect(sees(SPOTTER_NARROW, SADDLE_NARROW)).toBe(true);
    // [8,9] sits at the corridor's north mouth and sees nothing down it.
    expect(sees([8, 9] as Pt, SADDLE_NARROW)).toBe(false);
  });

  it('leaves its watcher inside the battery envelope', () => {
    // A range fact about the ground, not a claim that killing this spotter
    // prices the flank -- measurement showed it does not (narrow-with-spotter
    // -alive and narrow-with-spotter-dead land the same, per the Tel Marum
    // saddle bullet in CLAUDE.md).
    expect(dist(SPOTTER_NARROW, BATTERY)).toBeLessThanOrEqual(GRAD_RANGE);
  });
});

describe('the approach zone', () => {
  const zone = () => {
    const z = (maps.tel_marum as MapJson).zones?.approach;
    if (!z) throw new Error('map has no "approach" zone');
    return z;
  };

  it('exists, and every tile in it is open ground', () => {
    const [x, y, w, h] = zone();
    const rows = (maps.tel_marum as MapJson).rows;
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) expect(rows[j][i]).toBe('.');
  });

  it('is a gradient, not a kill box', () => {
    // Held ground that is uniformly lethal is an endurance check. Held ground
    // where only part is both spottable and shellable is a decision.
    const [x, y, w, h] = zone();
    const tiles: Pt[] = [];
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) tiles.push([i, j] as Pt);
    const both = tiles.filter((p) => dist(p, BATTERY) <= GRAD_RANGE && sees(OVERWATCH_W, p));
    expect(both.length).toBeGreaterThan(0);
    expect(both.length).toBeLessThan(tiles.length);
  });

  it('contains the approach marker', () => {
    const [x, y, w, h] = zone();
    const [mx, my] = marker('approach');
    expect(mx).toBeGreaterThanOrEqual(x);
    expect(mx).toBeLessThan(x + w);
    expect(my).toBeGreaterThanOrEqual(y);
    expect(my).toBeLessThan(y + h);
  });
});

describe('the western wave source', () => {
  it('stands on open ground behind the narrow saddle', () => {
    const [x, y] = marker('sarim_west');
    expect((maps.tel_marum as MapJson).rows[y][x]).toBe('.');
    expect(y).toBeLessThan(12); // north of the wall
  });
});

describe('the flagged town block', () => {
  it('covers structures and nothing else', () => {
    // ROE has to have something to be about. Tel Marum fields no civilians,
    // so without a flagged zone the score sits at 100 and the HUD teaches
    // nothing. These six tiles are the only structures on the map.
    const z = (maps.tel_marum as MapJson).zones?.town_block;
    if (!z) throw new Error('map has no "town_block" zone');
    const [x, y, w, h] = z;
    const rows = (maps.tel_marum as MapJson).rows;
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) expect(rows[j][i]).toBe('#');
  });

  it('sits inside the battery splash radius, so shelling the Grad is a choice', () => {
    const z = (maps.tel_marum as MapJson).zones?.town_block;
    if (!z) throw new Error('map has no "town_block" zone');
    const [x, y, w, h] = z;
    let nearest = Infinity;
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) nearest = Math.min(nearest, dist([i, j] as Pt, BATTERY));
    expect(nearest).toBeLessThan(4);
  });
});
