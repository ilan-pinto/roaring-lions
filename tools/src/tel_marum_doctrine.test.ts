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
//
// The narrow corridor is a BOULDER FIELD since the `b` tiles were authored into
// the map (T1-B/T1-C). Nothing in the sight half of this file moved by one bit
// when they landed: a boulder is deliberately not sight-blocking, so every
// `sees()` assertion below is the same terrain fact it was on open ground. What
// the boulders changed is passability, and only for wheels and tracks -- pinned
// in its own describe block at the end, where the shortest ROUTE either domain
// can take is measured rather than asserted.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, parseMap, units, type MapJson } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { DIR_DX, DIR_DY, DIR_NONE, FlowField } from '../../packages/sim/src/flowfield';
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

// The corridor is a boulder field, and that is what finally prices the flank.
//
// The debt this closes: the flank route was +10 tiles and crossed nothing
// either Kornet pocket could both see and reach, so a player who committed the
// WHOLE force to it paid nothing at all. Force-splitting was supposed to be the
// price and nobody was made to pay it. `b` makes the corridor open ground on
// foot and a wall to wheels and tracks, so the split is now structural: armour
// has exactly one way through the wall and it is the guarded one.
//
// Measured, not asserted, and every number here is paired with the same map
// with the boulders turned back into '.' -- without that control, "the vehicle
// went round" also passes when the corridor was never a vehicle route to begin
// with, or when the goal was unreachable for an unrelated reason.
describe('the narrow corridor is infantry-only', () => {
  /** Open ground either side of the wall at the corridor: the valley floor
   *  south of its mouth, and the northern plain past its exit. Both are '.'
   *  in the shipped map, so a flow field can take either as a goal. */
  const CORRIDOR_SOUTH: Pt = [10, 19];
  const CORRIDOR_NORTH: Pt = [10, 11];

  /** Tel Marum with every `b` back to '.': the same ground, minus the field. */
  function control(): MapJson {
    const src = maps.tel_marum as MapJson;
    return { ...src, rows: src.rows.map((r) => r.split('b').join('.')) };
  }

  function load(json: MapJson): { map: ReturnType<typeof parseMap>; sim: Sim } {
    const map = parseMap(json);
    const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 16 });
    applyTerrain(map, sim);
    return { map, sim };
  }

  /** Shortest route in tiles between two open tiles for one domain, walked off
   *  the real `FlowField` the sim would hand a unit — slope priced in. `null`
   *  means the mask offers no route at all. */
  function route(json: MapJson, domain: 'foot' | 'vehicle', from: Pt, to: Pt): number | null {
    const { map, sim } = load(json);
    const mask = domain === 'foot' ? sim.blocked : sim.blockedVehicle;
    const field = new FlowField(map.width, map.height);
    field.compute(mask, sim.elevation, to[0], to[1]);
    let x = from[0];
    let y = from[1];
    for (let steps = 0; steps <= map.width * map.height; steps++) {
      if (x === to[0] && y === to[1]) return steps;
      const d = field.dirs[y * map.width + x];
      if (d === undefined || d === DIR_NONE) return null;
      x += DIR_DX[d] ?? 0;
      y += DIR_DY[d] ?? 0;
    }
    return null;
  }

  it('costs a rifleman nothing and shuts a vehicle out entirely', () => {
    // Eight tiles across the wall on foot, boulders or not.
    expect(route(maps.tel_marum as MapJson, 'foot', CORRIDOR_SOUTH, CORRIDOR_NORTH)).toBe(8);
    expect(route(control(), 'foot', CORRIDOR_SOUTH, CORRIDOR_NORTH)).toBe(8);
    // A vehicle used to cross on the same eight. Now the only way north is the
    // wide saddle and back west: 28 tiles, every one of them under the pass.
    expect(route(control(), 'vehicle', CORRIDOR_SOUTH, CORRIDOR_NORTH)).toBe(8);
    expect(route(maps.tel_marum as MapJson, 'vehicle', CORRIDOR_SOUTH, CORRIDOR_NORTH)).toBe(28);
  });

  it('leaves the wide saddle exactly as it was — the field prices one route, not both', () => {
    // If this moves, the boulders have leaked onto the mission's own axis and
    // every playtest plan above is measuring different ground.
    for (const domain of ['foot', 'vehicle'] as const) {
      expect(route(maps.tel_marum as MapJson, domain, START, BATTERY)).toBe(38);
      expect(route(control(), domain, START, BATTERY)).toBe(38);
    }
  });

  it('makes the whole flank route unavailable to armour, not merely longer', () => {
    // Through the middle of the corridor, which is the flank as a player walks
    // it. Foot pays the +10 it always paid; armour has no route at all, because
    // the corridor is the only gap in the wall west of the pass.
    const mid: Pt = [11, 15];
    const foot =
      (route(maps.tel_marum as MapJson, 'foot', START, mid) ?? NaN) +
      (route(maps.tel_marum as MapJson, 'foot', mid, BATTERY) ?? NaN);
    expect(foot).toBe(48);
    expect(route(maps.tel_marum as MapJson, 'vehicle', START, mid)).toBe(null);
    // The control: on the same ground without the field, armour walked it.
    const veh =
      (route(control(), 'vehicle', START, mid) ?? NaN) +
      (route(control(), 'vehicle', mid, BATTERY) ?? NaN);
    expect(veh).toBe(48);
  });

  it('is a boulder field and not a second ridge — sight through it is unchanged', () => {
    // `b` blocks wheels, and deliberately nothing else. The corridor tiles the
    // northern valley can see (asserted above on the shipped map) are boulder
    // tiles now, so that block is already the proof; this pins the reason.
    const { map } = load(maps.tel_marum as MapJson);
    const t = SADDLE_NARROW[1] * map.width + SADDLE_NARROW[0];
    expect(map.boulder[t]).toBe(1);
    expect(map.blocked[t]).toBe(0);
    expect(sees(SPOTTER_NARROW, SADDLE_NARROW)).toBe(true);
  });

  it('splits the shipped task force when both are ordered through it', () => {
    // The route arithmetic above is the mask's answer. This is the sim's: the
    // two unit types Tel Marum III actually fields, one order, two outcomes.
    for (const [json, label] of [
      [maps.tel_marum as MapJson, 'boulders'],
      [control(), 'control'],
    ] as const) {
      const { map, sim } = load(json);
      const foot = sim.spawn(
        sim.addUnitType(units.inf_squad as UnitTypeJson),
        0,
        fx.from(10.5),
        fx.from(19.5)
      );
      const tank = sim.spawn(
        sim.addUnitType(units.mbt_lavi as UnitTypeJson),
        0,
        fx.from(11.5),
        fx.from(19.5)
      );
      sim.queueCommand({
        kind: 'move',
        ids: [foot, tank],
        x: fx.from(CORRIDOR_NORTH[0] + 0.5),
        y: fx.from(CORRIDOR_NORTH[1] + 0.5),
      });
      const onCorridor = (id: number): boolean => {
        const x = sim.state.posX[id] ?? 0;
        const y = sim.state.posY[id] ?? 0;
        return (x >> 16) >= 10 && (x >> 16) <= 11 && (y >> 16) >= 12 && (y >> 16) <= 17;
      };
      let footEntered = false;
      let tankEntered = false;
      for (let i = 0; i < 40 * TICKS_PER_SECOND; i++) {
        sim.tick();
        footEntered ||= onCorridor(foot);
        tankEntered ||= onCorridor(tank);
      }
      expect(footEntered, `${label}: infantry through the corridor`).toBe(true);
      expect(tankEntered, `${label}: armour through the corridor`).toBe(label === 'control');
      // The infantry did not merely enter — it came out the far side.
      expect((sim.state.posY[foot] ?? 0) >> 16, `${label}: infantry north of the wall`).toBeLessThan(
        12
      );
      expect(map.width).toBe(48);
    }
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

// The Grad cannot be given eyes on the corridor, and that is geometry.
//
// The standing plan for pricing the narrow flank was to let the battery shell
// it: `rocket` is in `INDIRECT_MASK` so the Grad needs no sight of its own, and
// `sim.ts` gates each shot on PER-SIDE identification — so one spotter with a
// view down the corridor should be enough. It was authored (`tm_spotter_narrow`
// at [12,4]) and measured not to work, and the recorded explanation was that
// `selectTarget` preferred the holding force over the flankers.
//
// That explanation is WRONG and this block retires it. The gate is candidacy,
// not preference: hand the Sarim side identification and the battery shoots the
// man in the corridor on its next reload, every time. What actually fails is
// the observer — every post that can see the corridor stands inside the
// corridor's own weapons, because the only sightlines into a straight slot in a
// rock wall run along its axis, and distance along that axis IS the standoff.
describe('eyes on the narrow corridor', () => {
  /** The corridor's twelve authored `b` tiles. */
  const CORRIDOR: Pt[] = [];
  for (let y = 12; y <= 17; y++) for (let x = 10; x <= 11; x++) CORRIDOR.push([x, y] as Pt);

  /** `inf_squad` rifles reach 8.0; `at_team`'s spike_atgm reaches 9.0. Anything
   *  standing this close to a tile the flank walks over can be shot off it. */
  const FLANK_REACH = 9;

  const watcher = (sight: number): UnitTypeJson => ({
    ...OBSERVER,
    id: `t_watch_${sight}`,
    sensors: { optics: 1, sight_tiles: sight, signature: 0.6 },
  });

  /** Which of the twelve corridor tiles a post at `a` sees at `sight`. One Sim,
   *  all twelve targets at once — the same `debugDetection` path `sees()` uses.
   *
   *  No tick loop, unlike `sees()` above, and that is deliberate rather than a
   *  shortcut: `detectionPair` computes `visible` from range and `losRay` alone,
   *  with no accumulated contact in it, so ticking cannot change the answer.
   *  Checked rather than assumed — every open tile on the map at sights 9, 12
   *  and 48, 2073 (post, sight) pairs, gave the identical count at 0 ticks and
   *  at 240. These two tests sweep the whole map, and at 240 ticks a post they
   *  ran 25 s under a loaded `pnpm test` and tripped the 5 s per-test timeout. */
  function corridorSeenFrom(a: Pt, sight: number): number {
    const map = parseMap(maps.tel_marum as MapJson);
    const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 32 });
    applyTerrain(map, sim);
    const tw = sim.addUnitType(watcher(sight));
    const tt = sim.addUnitType({ ...OBSERVER, id: 't_corridor_tgt' });
    const w = sim.spawn(tw, 0, fx.from(a[0] + 0.5), fx.from(a[1] + 0.5));
    const ts = CORRIDOR.map((t) => sim.spawn(tt, 1, fx.from(t[0] + 0.5), fx.from(t[1] + 0.5)));
    return ts.filter((t) => sim.debugDetection(w, t)?.visible === true).length;
  }

  /** Nearest corridor tile to a post — the range a flanker shoots back from. */
  const standoff = (a: Pt) => Math.min(...CORRIDOR.map((c) => dist(a, c)));

  /** Every open tile a post of this sight could conceivably watch from. */
  function posts(sight: number): Pt[] {
    const rows = (maps.tel_marum as MapJson).rows;
    const out: Pt[] = [];
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++)
        if (rows[y][x] === '.' && CORRIDOR.some((c) => dist([x, y] as Pt, c) <= sight)) out.push([x, y] as Pt);
    return out;
  }

  it('leaves the shipped spotter seeing two of the corridor’s twelve tiles', () => {
    // Paired with the sight lines proved above: the ground is clear along the
    // whole corridor (OBSERVER, sight 48, sees all of it), so what stops
    // `tm_spotter_narrow` is its own sight_tiles: 9 and nothing else.
    expect(corridorSeenFrom(SPOTTER_NARROW, 48)).toBe(CORRIDOR.length);
    expect(corridorSeenFrom(SPOTTER_NARROW, 9)).toBe(2);
    // The two it does see are the north exit row, at 8.1 and 8.2 tiles; the
    // next row down is already 9.1 away.
    expect(dist(SPOTTER_NARROW, [11, 12] as Pt)).toBeCloseTo(8.06, 2);
    expect(dist(SPOTTER_NARROW, [11, 13] as Pt)).toBeCloseTo(9.06, 2);
    expect(dist(SPOTTER_NARROW, [10, 17] as Pt)).toBeCloseTo(13.15, 2);
  });

  it('offers no sight-9 post outside the corridor’s own weapons', () => {
    // The whole map, every open tile. Not one that sees ANY of the corridor
    // stands further off than a Spike can answer — so an observer good enough
    // to matter is always shootable from the ground it is observing. This is
    // why moving `tm_spotter_narrow` cannot work, and it is terrain, not tuning.
    const seeing = posts(9).filter((p) => corridorSeenFrom(p, 9) > 0);
    expect(seeing.length).toBeGreaterThan(0);
    expect(Math.max(...seeing.map(standoff))).toBeLessThanOrEqual(FLANK_REACH);
    // And the good posts are far worse off than the marginal ones: seeing ten
    // of twelve means standing four tiles from the men you are watching.
    const good = seeing.filter((p) => corridorSeenFrom(p, 9) >= 10);
    expect(good.length).toBeGreaterThan(0);
    expect(Math.max(...good.map(standoff))).toBeCloseTo(4.0, 1);
  });

  it('buys almost no standoff even at the Sarim roster’s longest sight', () => {
    // manpad_team is sight 12, the best set of eyes the faction owns that
    // stands still. Half the corridor still costs it a post inside 10 tiles —
    // 0.2 outside a Spike, which is one step of walking.
    expect(units.manpad_team.sensors.sight_tiles).toBe(12);
    const half = posts(12).filter((p) => corridorSeenFrom(p, 12) >= 6);
    expect(half.length).toBeGreaterThan(0);
    const best = Math.max(...half.map(standoff));
    expect(best).toBeGreaterThan(FLANK_REACH);
    expect(best).toBeLessThan(10);
  });

  it('reloads too slowly for a short-lived observer to matter', () => {
    // One rocket per thirty seconds. An observer must live a minute and a half
    // to buy three rounds onto the corridor, and nothing that can see a
    // two-tile defile lives that long with a rifle company walking up it.
    const grad = units.rocket_battery.weapons[0];
    expect(grad.id).toBe('grad_122');
    expect(grad.rof_per_min).toBe(2);
    expect(60 / grad.rof_per_min).toBe(30);
  });
});

// Candidacy, not preference — the claim the block above rests on, driven
// through the real Sim rather than argued.
describe('what the battery will and will not shoot at in the corridor', () => {
  /** Battery at `battery_position`, one rifle squad on the narrow saddle, and
   *  nothing else alive. `identify` re-asserts Sarim contact every tick, which
   *  is exactly what an observer holding a sight line does. */
  function batteryVsCorridor(
    identify: boolean,
    decoy: Pt | null
  ): { atFlanker: number; atDecoy: number; flankerWhileDecoyLived: number } {
    const map = parseMap(maps.tel_marum as MapJson);
    const sim = new Sim({ seed: 11, width: map.width, height: map.height, capacity: 16 });
    applyTerrain(map, sim);
    const grad = sim.spawn(
      sim.addUnitType(units.rocket_battery as UnitTypeJson), 1,
      fx.from(BATTERY[0] + 0.5), fx.from(BATTERY[1] + 0.5)
    );
    const inf = sim.addUnitType(units.inf_squad as UnitTypeJson);
    const flanker = sim.spawn(inf, 0, fx.from(SADDLE_NARROW[0] + 0.5), fx.from(SADDLE_NARROW[1] + 0.5));
    const near = decoy ? sim.spawn(inf, 0, fx.from(decoy[0] + 0.5), fx.from(decoy[1] + 0.5)) : -1;
    let atFlanker = 0;
    let atDecoy = 0;
    let flankerWhileDecoyLived = 0;
    for (let i = 0; i < 120 * TICKS_PER_SECOND; i++) {
      if (identify) {
        sim.identifyTo(1, flanker);
        if (near >= 0) sim.identifyTo(1, near);
      }
      const decoyLived = near >= 0 && sim.state.alive[near] === 1;
      for (const e of sim.tick()) {
        if (e.kind !== 'fire' || e.shooter !== grad) continue;
        if (e.target === flanker) {
          atFlanker++;
          if (decoyLived) flankerWhileDecoyLived++;
        }
        if (e.target === near) atDecoy++;
      }
    }
    return { atFlanker, atDecoy, flankerWhileDecoyLived };
  }

  it('never fires at a corridor it has not identified', () => {
    // The battery's own sight is 6 tiles and the saddle is 17 away, so with no
    // observer there is no contact and no shot. This is the shipped behaviour.
    expect(dist(BATTERY, SADDLE_NARROW)).toBeCloseTo(17.0, 1);
    expect(units.rocket_battery.sensors.sight_tiles).toBe(6);
    expect(batteryVsCorridor(false, null).atFlanker).toBe(0);
  });

  it('fires at it on the next reload once the side identifies it', () => {
    // The positive half. Two minutes at one round per thirty seconds, and every
    // round goes at the man in the corridor — `selectTarget` is not the
    // obstacle, and a fix that reaches for it is aimed at the wrong thing.
    expect(batteryVsCorridor(true, null).atFlanker).toBeGreaterThanOrEqual(3);
  });

  it('prefers the nearer of two identified targets, which is the rule and not a bug', () => {
    // Both soft, both identified, both in range: `selectTarget` scores `hurts`
    // first and then distance, so the closer one wins. That is why a battery
    // with a live fight on its own doorstep spends nothing on the flank — it is
    // not ignoring the corridor, it has something nearer.
    // It is an ordering, not an exclusion: over two minutes the battery spends
    // three rockets on the decoy, kills it, and only then turns west. So the
    // flank is not immune — it is LAST IN THE QUEUE, and on this mission the
    // battery is dead long before the queue reaches it.
    const decoy: Pt = [24, 13];
    expect(dist(BATTERY, decoy)).toBeLessThan(dist(BATTERY, SADDLE_NARROW));
    const r = batteryVsCorridor(true, decoy);
    expect(r.atDecoy).toBe(3);
    expect(r.atFlanker).toBe(1);
    expect(r.flankerWhileDecoyLived).toBe(0);
  });
});
