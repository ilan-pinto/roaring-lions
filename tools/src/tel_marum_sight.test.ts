// Tel Marum's doctrine, as assertions.
//
// The Sur front design says the map is "half the doctrine": Sarim cannot
// out-range anyone (Kornet 10 tiles against KDF mortars at 18 and snipers at
// 15), so what they have is ambush from ground you cannot see into. That makes
// these sight lines the actual deliverable of the map -- not the picture.
//
// Every negative is paired with a positive on the same geometry. A test that
// only asserts "cannot see" passes when the spawn is broken, when sight range
// is too short, or when detection never ran.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

/** Sight range far past anything on this map, so only terrain can hide. */
const OBSERVER: UnitTypeJson = {
  id: 't_observer',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 48, signature: 0.6 },
};

type Pt = readonly [number, number];

/** Two observers on opposing sides at the given tiles; does the first see the second? */
function sees(a: Pt, b: Pt, override?: (m: MapJson) => MapJson): boolean {
  const json = override ? override(structuredClone(maps.tel_marum) as MapJson) : (maps.tel_marum as MapJson);
  const map = parseMap(json);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
  const t = sim.addUnitType(OBSERVER);
  const watcher = sim.spawn(t, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const target = sim.spawn(t, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) sim.tick();
  return sim.debugDetection(watcher, target)?.visible === true;
}

const START = [24, 44] as const;
const HOLLOW = [24, 29] as const;
const APPROACH = [24, 24] as const;
const SADDLE_WIDE = [24, 14] as const;
const SADDLE_NARROW = [10, 14] as const;
const PASS = [24, 12] as const;
const OVERWATCH_E = [28, 16] as const;
const OVERWATCH_W = [20, 16] as const;
const BATTERY = [25, 6] as const;
const DEEP_VALLEY = [24, 35] as const;

describe('the centre outcrop hides the pass from the start line', () => {
  it('does not show the pass from where the player enters', () => {
    // (24,44) -> (24,12): 32 steps, sight line rises 1 -> 3. The outcrop at
    // y=22 is a `^` on elevation 1, so it stands at 1 + BLOCK_RISE = 3:
    // 3 * 32 = 96 > 32 + 2 * 22 = 76. Blocked.
    expect(sees(START, PASS)).toBe(false);
  });

  it('shows it from the start row, four tiles off the outcrop’s axis — the control', () => {
    // (20,44) -> (24,12): same row as the start line, same target, but four
    // tiles west of the outcrop's axis at x=24. The original control here was
    // (24,20), directly above the outcrop on the same column — its "nothing
    // but open ground between" premise was false: that column also crosses
    // the wide saddle's own southern plateau edge at (24,17), an open-ground
    // two-level cliff (h0=1, h1=3, total=8, k=3: lineH=8+2*3=14, ground
    // 2*8=16 -- blocked, correctly, by terrain the control was never meant to
    // exercise). Moving four tiles off-axis keeps the ray clear of both the
    // outcrop and the plateau edge, so this isolates the outcrop as the
    // blocker in the case above instead of accidentally re-testing the
    // saddle.
    expect(sees([20, 44], PASS)).toBe(true);
  });
});

describe('the lip makes the hollow dead ground', () => {
  it('hides the hollow from the eastern shoulder', () => {
    // (28,16) -> (24,29): 13 steps, sight line falls 4 -> 1. The lip at y=26
    // is open ground at elevation 2: 2 * 13 = 26 > 4 * 13 - 3 * 10 = 22.
    expect(sees(OVERWATCH_E, HOLLOW)).toBe(false);
  });

  it('hides it from the western shoulder too', () => {
    expect(sees(OVERWATCH_W, HOLLOW)).toBe(false);
  });

  it('does NOT hide the approach in front of it — the killing ground', () => {
    // (28,16) -> (24,24) is 8 tiles, inside Kornet's reach of 10, and the lip
    // is not between them. This is the whole point of the hollow: the ground
    // you must cross to leave it is covered.
    expect(sees(OVERWATCH_E, APPROACH)).toBe(true);
  });

  it('does not hide the valley further south either — the shadow is a band', () => {
    // (28,16) -> (24,35) is 19 steps: 2 * 19 = 38 is NOT > 4 * 19 - 3 * 10 = 46.
    // A rise shadows a finite band behind it, not everything beyond it. Stated
    // as a test because it is surprising, and because a map author who assumes
    // otherwise will put a force somewhere it can be seen.
    expect(sees(OVERWATCH_E, DEEP_VALLEY)).toBe(true);
  });
});

describe('the lip has to be two levels', () => {
  // E3 gave observers EYE_HEIGHT = 1, so a one-level rise sits exactly at eye
  // level and hides nothing. A lip authored one level shallow looks identical
  // in the JSON and does nothing at all -- this is the single easiest way to
  // author this map wrong, so it gets a test rather than a comment.
  const lowerTheLip = (m: MapJson): MapJson => {
    const rows = [...(m.elevation ?? [])];
    for (const y of [25, 26]) {
      const r = rows[y].split('');
      for (let x = 18; x <= 30; x++) r[x] = '1';
      rows[y] = r.join('');
    }
    return { ...m, elevation: rows };
  };

  it('hides the hollow at two levels', () => {
    expect(sees(OVERWATCH_E, HOLLOW)).toBe(false);
  });

  it('and hides nothing at one — the same map, one digit shallower', () => {
    expect(sees(OVERWATCH_E, HOLLOW, lowerTheLip)).toBe(true);
  });
});

describe('the spur separates the two saddles', () => {
  it('keeps the narrow saddle out of the eastern shoulder’s arc', () => {
    // (28,16) -> (10,14): 18 steps. The spur is `^` on elevation 4, standing
    // at 6: 6 * 18 = 108 > 4 * 18 = 72. Blocked.
    expect(sees(OVERWATCH_E, SADDLE_NARROW)).toBe(false);
  });

  it('while the wide saddle is covered from it — the control', () => {
    expect(sees(OVERWATCH_E, SADDLE_WIDE)).toBe(true);
  });
});

describe('the battery is behind the pass, which is the point of taking it', () => {
  it('is not visible from the hollow', () => {
    // The wide saddle itself, at elevation 2, screens a ground-level observer
    // 23 tiles back: 2 * 23 = 46 > 23 + 12 = 35.
    expect(sees(HOLLOW, BATTERY)).toBe(false);
  });

  it('is visible from the crest of the wide saddle', () => {
    expect(sees(PASS, BATTERY)).toBe(true);
  });
});
