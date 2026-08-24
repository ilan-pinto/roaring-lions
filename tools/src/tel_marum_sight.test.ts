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

/** Sight range far past anything on this map, so only terrain can hide.
 *  This bound only does its job while every distance exercised in this file
 *  stays under it -- the longest ray here is the start line to the pass, 32
 *  tiles, well inside 48. If a future case reaches out further than that,
 *  this constant has to grow with it or range becomes indistinguishable from
 *  terrain again. */
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
  // A missing detection record is not the same claim as "blocked by terrain"
  // -- it means the pair was never evaluated at all (a broken spawn, a
  // detection system that never ran). Folding that into `false` let a dead
  // test read as a passing negative. Assert the record exists, then read
  // what it says.
  const detection = sim.debugDetection(watcher, target);
  if (!detection) throw new Error(`no detection record between ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  return detection.visible;
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
    // (24,44) -> (24,12): 32 steps, sight line rises 1 -> 3. The outcrop now
    // sits at rows 20-21 (moved north from 21-22, and back to its full
    // 3-wide footprint -- see the commit message for why), so its nearest
    // face to the start line is (24,21): 23 steps in. Standing at
    // 1 + BLOCK_RISE = 3: 3 * 32 = 96 > 32 + 2 * 23 = 78. Blocked.
    expect(sees(START, PASS)).toBe(false);
  });

  it('shows it from well off the outcrop’s shadow — the control', () => {
    // (15,44) -> (24,12): same target, off-axis enough to clear the outcrop's
    // shadow entirely. That shadow is now 11 tiles wide along the start line
    // (x 19-29 measured empirically, matching the doctrine's own recon
    // premise -- see the report), so (20,44) -- the control used in the
    // previous round, only 4 tiles off axis -- now falls INSIDE it and would
    // wrongly read as blocked. (15,44) sits outside the shadow with margin
    // and never touches the wide saddle's plateau edge either, so this
    // isolates the outcrop as the blocker in the case above rather than
    // re-testing the saddle or accidentally re-entering the shadow it casts.
    expect(sees([15, 44], PASS)).toBe(true);
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

  it('does NOT hide the approach from the western shoulder either', () => {
    // The mirror of the case above. This is the doctrine's central claim --
    // the killing ground is covered from both shoulders, not just one -- and
    // round 1 shipped only the eastern half of it: the western shoulder was
    // exactly where the centre outcrop's old footprint blocked this same
    // approach, before it was narrowed and then repositioned. Asserted
    // directly rather than left implied by symmetry.
    expect(sees(OVERWATCH_W, APPROACH)).toBe(true);
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
  // author this map wrong, so it gets a test rather than a comment. The
  // baseline (the lip at its authored two levels hides the hollow from the
  // eastern shoulder) is already asserted above ("hides the hollow from the
  // eastern shoulder") -- restating it here as its own case would just be
  // the same call with the same expectation, so only the shallower variant
  // is asserted, against that same baseline.
  const lowerTheLip = (m: MapJson): MapJson => {
    const rows = [...(m.elevation ?? [])];
    for (const y of [25, 26]) {
      const r = rows[y].split('');
      for (let x = 18; x <= 30; x++) r[x] = '1';
      rows[y] = r.join('');
    }
    return { ...m, elevation: rows };
  };

  it('hides nothing at one level — the same map, one digit shallower', () => {
    expect(sees(OVERWATCH_E, HOLLOW, lowerTheLip)).toBe(true);
  });
});

describe('the ridge line seals the space between the two saddles', () => {
  it('keeps the narrow saddle out of the eastern shoulder’s arc', () => {
    // (28,16) -> (10,14): 18 steps. Blocked at (18,15) -- plain ridge line
    // (elevation 4, rock), not the spur. The spur's footprint is
    // (13,10)-(17,16); x=18 is outside it. Deleting the spur entirely does
    // not change this result (checked directly): the ridge alone already
    // seals every column between the two saddle gaps, so this case proves
    // the ridge separates them, not the spur. Any rock tile at elevation 4
    // blocks unconditionally here regardless -- both endpoints have
    // elevation <= 4, so a blocked tile's effective height (4 + BLOCK_RISE
    // = 6) always exceeds the interpolated sight line's height (at most 5).
    expect(sees(OVERWATCH_E, SADDLE_NARROW)).toBe(false);
  });

  it('while the wide saddle is covered from it — the control', () => {
    expect(sees(OVERWATCH_E, SADDLE_WIDE)).toBe(true);
  });
});

describe('the spur, isolated from the ridge it sits beside', () => {
  // The case above does not exercise the spur -- it blocks on the ridge
  // before the ray ever reaches the spur's footprint. This pair lives
  // entirely inside the north band (y <= 11), straddling the spur's
  // east-west extent (x 13-17) at y=10, so the ray never touches the ridge
  // at all (the ridge only occupies rows 12-17). Without the spur this
  // stretch of the north band is open ground at elevation 1, same as either
  // side of it.
  const SPUR_WEST = [12, 10] as const;
  const SPUR_EAST = [18, 10] as const;
  const removeSpur = (m: MapJson): MapJson => {
    const rows = [...m.rows];
    const elevation = [...(m.elevation ?? [])];
    for (const y of [10, 11]) {
      const r = rows[y].split('');
      const e = elevation[y].split('');
      for (let x = 13; x <= 17; x++) {
        r[x] = '.';
        e[x] = '1';
      }
      rows[y] = r.join('');
      elevation[y] = e.join('');
    }
    return { ...m, rows, elevation };
  };

  it('blocks a ray that never touches the ridge at all', () => {
    // (12,10) -> (18,10): 6 steps, flat (both ends elevation 1). Blocked by
    // the spur at (13,10), elevation 4 rock, well before the ridge's own
    // rows begin.
    expect(sees(SPUR_WEST, SPUR_EAST)).toBe(false);
  });

  it('and the same ray sees straight through once the spur is gone — the control', () => {
    expect(sees(SPUR_WEST, SPUR_EAST, removeSpur)).toBe(true);
  });
});

describe('the battery is behind the pass, which is the point of taking it', () => {
  it('is not visible from the hollow', () => {
    // Over-determined, not the saddle plateau alone as originally credited:
    // the lip (blocks first, at (24,26)), the centre outcrop (at (24,21)),
    // and the wide saddle's own plateau edge each independently block this
    // ray. Removing any single one of the three still leaves it blocked by
    // whichever of the other two is nearest the hollow -- checked directly
    // for all three individually and all three pairs. Only removing all
    // three at once makes the battery visible from the hollow.
    expect(sees(HOLLOW, BATTERY)).toBe(false);
  });

  it('is visible from the crest of the wide saddle', () => {
    expect(sees(PASS, BATTERY)).toBe(true);
  });
});
