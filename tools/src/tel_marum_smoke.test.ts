// A smoke screen has a height, demonstrated on the only shipped map that has
// relief to demonstrate it on.
//
// `raySmoke` summed every smoked tile a sight line crossed and never looked at
// elevation — one of the three things the elevation milestone left inert while
// every shipped map was flat. Tel Marum authored an elevation grid and shipped
// three missions, so it stopped being dormant. This file walks the real map
// through `parseMap` + `applyTerrain` and lays every screen with the real
// `smoke` command, because a fixture the loader cannot produce and a player
// cannot lay proves nothing about the game (a hand-written `sim.smoke` grid
// passed a test on map data the decoder can never emit once already).
//
// The three tiles this file stands on, read off `data/maps/tel_marum.json`:
//
//   (20,16) and (20,17)  elevation 3   the west shoulder of the saddle
//   (18..28, 22)         elevation 0   the basin floor south of the wall
//   (22,21)              elevation 0   basin floor, where the screen goes
//   (24,26)              elevation 2   the mid-basin bench, rows 25-26, x 18-30
//
// That bench is worth reading off the file rather than off the eye: it looks
// like open basin and it is two levels up, which is most of the difference
// between the two sight lines below. Three levels is all the relief this map
// offers to open ground, and it is enough. A plume stands SMOKE_RISE = 2 above
// its own tile, so a line from the shoulder down to the bench passes more than
// a level over a plume pooled on the floor between them, while a line drawn
// along the floor itself sits a level under the same plume.
//
// Every negative is paired with the same geometry unscreened. "Cannot see" on
// its own passes for a broken spawn, a screen that never got laid, or a sight
// range too short for the distance — so each case asserts the screen really
// landed and that the pair really sees each other without it.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { Sim, TICKS_PER_SECOND, type UnitTypeJson } from '../../packages/sim/src/sim';

/** Sight range past every distance exercised here — the longest is 10.8 tiles,
 *  shoulder to basin. Terrain and smoke are then the only things that can hide
 *  anything. If a future case reaches further than 32 this has to grow with
 *  it, or range becomes indistinguishable from obscuration again. */
const OBSERVER: UnitTypeJson = {
  id: 'tms_observer',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 32, signature: 0.6 },
};

/** A sapper, present only to lay the screen through the command a player uses. */
const SAPPER: UnitTypeJson = {
  id: 'tms_sapper',
  role: 'engineer',
  hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.0 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.5 },
  abilities: ['smoke'],
};

type Pt = readonly [number, number];

interface Look {
  visible: boolean;
  laid: boolean;
  /** Density left on the screen's centre when the reading was taken. */
  density: number;
  /** Density on one further tile of the caller's choosing, so a test can show
   *  that a tile it claims was IGNORED was really there to be ignored. */
  probeDensity: number;
}

/** Does `a` see `b` on the real Tel Marum, with an optional screen at `screen`
 *  laid by a sapper standing at `from`? */
function look(a: Pt, b: Pt, screen: Pt | null, from: Pt, probe?: Pt): Look {
  const map = parseMap(maps.tel_marum as MapJson);
  const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 8 });
  applyTerrain(map, sim);
  const obs = sim.addUnitType(OBSERVER);
  const eng = sim.addUnitType(SAPPER);
  const watcher = sim.spawn(obs, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
  const target = sim.spawn(obs, 1, fx.from(b[0] + 0.5), fx.from(b[1] + 0.5));
  const sapper = sim.spawn(eng, 0, fx.from(from[0] + 0.5), fx.from(from[1] + 0.5));
  for (let i = 0; i < 4 * TICKS_PER_SECOND; i++) sim.tick();
  let laid = false;
  if (screen) {
    sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(screen[0] + 0.5), y: fx.from(screen[1] + 0.5) });
    for (let i = 0; i < 1 * TICKS_PER_SECOND; i++) {
      for (const e of sim.tick()) if (e.kind === 'smokeLaid') laid = true;
    }
  }
  const detection = sim.debugDetection(watcher, target);
  // A missing record is not the same claim as "obscured" — it means the pair
  // was never evaluated at all. Fold that into `false` and a dead test reads
  // as a passing negative.
  if (!detection) throw new Error(`no detection record between ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  return {
    visible: detection.visible,
    laid,
    density: screen ? sim.smokeAt(screen[0], screen[1]) : 0,
    probeDensity: probe ? sim.smokeAt(probe[0], probe[1]) : 0,
  };
}

const SHOULDER_W = [20, 16] as const; // elevation 3, the `overwatch_west` marker
const SHOULDER_LIP = [20, 17] as const; // elevation 3
const BASIN_FAR = [24, 26] as const; // elevation 2 — the mid-basin bench
const BASIN_W = [18, 22] as const; // elevation 0
const BASIN_E = [28, 22] as const; // elevation 0
const BASIN_UNDER = [20, 22] as const; // elevation 0, directly below the shoulder
const SCREEN_BASIN = [22, 21] as const; // elevation 0
const SAPPER_BASIN = [20, 25] as const;
const SAPPER_LIP = [21, 22] as const;

describe('Tel Marum: the ground these cases stand on', () => {
  it('is the relief the map file actually authors', () => {
    // Every assertion below is an argument about heights, so the heights
    // themselves are pinned. Flatten the bench at (24,26) or lower the western
    // shoulder and these cases stop meaning what their comments say — they
    // would keep passing, for the wrong reason, which is the failure mode this
    // file exists to avoid. (24,26) in particular reads as plain basin by eye
    // and is two levels up; it was drawn wrong by hand first.
    const map = parseMap(maps.tel_marum as MapJson);
    const at = (x: number, y: number) => map.elevation[y * map.width + x];
    expect(at(20, 16)).toBe(3); // west shoulder
    expect(at(20, 17)).toBe(3); // its lip
    expect(at(24, 26)).toBe(2); // the mid-basin bench
    expect(at(22, 21)).toBe(0); // the screen point, basin floor
    for (const x of [18, 20, 22, 24, 26, 28]) expect(at(x, 22)).toBe(0); // the floor line
    // And the five tiles the shoulder line crosses are all floor, so the plume
    // on them tops out at 0 + SMOKE_RISE.
    for (const [x, y] of [[21, 19], [22, 20], [22, 21], [22, 22], [23, 23]]) expect(at(x, y)).toBe(0);
  });
});

describe('Tel Marum: a screen on the basin floor does not blind the shoulder above it', () => {
  it('sees the basin from the west shoulder with nothing in the way — the control', () => {
    expect(look(SHOULDER_W, BASIN_FAR, null, SAPPER_BASIN).visible).toBe(true);
  });

  it('still sees it through a screen laid on the floor below', () => {
    // (20,16) elevation 3 -> (24,26) elevation 2. Ten steps, the line running
    // from 3 + EYE_HEIGHT = 4 down to 2 + EYE_HEIGHT = 3. It crosses five
    // tiles of the screen — (21,19) (22,20) (22,21) (22,22) (23,23) — at
    // heights 3.70, 3.60, 3.50, 3.40 and 3.30, every one of them well clear of
    // a plume topping out at 0 + SMOKE_RISE = 2.
    //
    // Height-blind this read `false`: five tiles at 255 is 1,275 against a
    // SMOKE_BLOCKS_AT of 320, so the line simply stopped. That is the bug, on
    // the shipped map, with a screen a player can actually lay.
    const r = look(SHOULDER_W, BASIN_FAR, SCREEN_BASIN, SAPPER_BASIN);
    expect(r.laid).toBe(true);
    expect(r.density).toBeGreaterThan(200); // the screen is thick, not a wisp
    expect(r.visible).toBe(true);
  });

  it('but the same screen still blinds two men on the floor with it', () => {
    // (18,22) -> (28,22), both elevation 0: the line sits at 1.00 the whole
    // way and crosses five tiles of the same screen, every one of them topping
    // out above it. The screen has not become weaker — it is exactly as opaque
    // as it ever was to anyone level with it. Without this pairing, the test
    // above passes just as well for a fix that deleted smoke entirely.
    const clear = look(BASIN_W, BASIN_E, null, SAPPER_BASIN);
    expect(clear.visible).toBe(true);
    const screened = look(BASIN_W, BASIN_E, SCREEN_BASIN, SAPPER_BASIN);
    expect(screened.laid).toBe(true);
    expect(screened.visible).toBe(false);
  });
});

describe('Tel Marum: a screen standing on the shoulder still blankets the basin below', () => {
  it('sees the shoulder from the basin with nothing in the way — the control', () => {
    expect(look(BASIN_UNDER, SHOULDER_W, null, SAPPER_LIP).visible).toBe(true);
  });

  it('and cannot once a screen is laid on the lip', () => {
    // (20,22) elevation 0 -> (20,16) elevation 3, looking up. Six steps, the
    // line rising 1.00 -> 4.00. The screen centred on (20,17) spreads across
    // both heights, and the accounting splits: its three tiles on the basin
    // floor — (20,20) (20,19) (20,18), lines 2.00, 2.50, 3.00 against a top of
    // 2 — contribute NOTHING, while its two tiles standing on the shoulder —
    // (20,17) and (20,16), lines 3.50 and 4.00 against a top of 3 + 2 = 5 —
    // contribute everything. One cloud, transparent where it lies under the
    // line and opaque where it stands across it. That is the whole model in
    // one sight line.
    const r = look(BASIN_UNDER, SHOULDER_W, SHOULDER_LIP, SAPPER_LIP, [20, 19]);
    expect(r.laid).toBe(true);
    expect(r.visible).toBe(false);
    expect(r.density).toBeGreaterThan(200); // thick on the lip
    // (20,19) is one of the three basin tiles of that same cloud, sitting
    // squarely on the line and contributing nothing to it. Assert it is really
    // there, so "the shoulder tiles did the work" is a claim about accounting
    // rather than about an empty grid.
    expect(r.probeDensity).toBeGreaterThan(200);
  });
});
