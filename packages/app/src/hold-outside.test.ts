import { describe, expect, it } from 'vitest';
import { MissionRuntime, Sim, TICKS_PER_SECOND, fx, type MissionJson } from '@lions/sim';
import { applyTerrain, maps, missions, parseMap, units } from '@lions/data';
import { standMapStructures } from './map-sim';
import { JUST_OUTSIDE_TILES, unitsJustOutside, withOutsideCounts } from './hold-outside';
import { holdClock, type ObjectiveView } from './ui/hud-model';

/** A state slice with one unit per entry, side 0 unless given. */
function state(units: { x: number; y: number; side?: number; alive?: number; tunnel?: number }[]) {
  return {
    alive: units.map((u) => u.alive ?? 1),
    side: units.map((u) => u.side ?? 0),
    posX: units.map((u) => fx.fromInt(u.x) + (1 << 15)),
    posY: units.map((u) => fx.fromInt(u.y) + (1 << 15)),
    tunnelIn: units.map((u) => u.tunnel ?? -1),
  };
}

const CREST = [18, 40, 13, 2] as const;

describe('unitsJustOutside', () => {
  it('counts your units in the ring around the zone and none inside it', () => {
    const s = state([
      { x: 20, y: 42 }, // one row in front of the crest: outside, counted
      { x: 20, y: 39 }, // one row behind it: outside, counted
      { x: 20, y: 41 }, // on the crest: inside, never counted
      { x: 31, y: 41 }, // one column past the east end: counted
    ]);
    expect(unitsJustOutside(s, 4, CREST)).toBe(3);
  });

  it('uses the sim tile rule at the edge: y = 42.0 is the first row OUTSIDE', () => {
    // The zone is [40, 42): pos 41.99 is inside, 42.0 is not.
    const s = {
      alive: [1, 1],
      side: [0, 0],
      posX: [fx.fromInt(20), fx.fromInt(20)],
      posY: [fx.fromInt(42) - 1, fx.fromInt(42)],
      tunnelIn: [-1, -1],
    };
    expect(unitsJustOutside(s, 2, CREST)).toBe(1);
  });

  it('ignores the dead, the enemy, the buried and anyone past the margin', () => {
    const far = CREST[1] + CREST[3] + JUST_OUTSIDE_TILES; // first row past the ring
    const s = state([
      { x: 20, y: 42, alive: 0 },
      { x: 20, y: 42, side: 1 },
      { x: 20, y: 42, tunnel: 0 },
      { x: 20, y: far },
    ]);
    expect(unitsJustOutside(s, 4, CREST)).toBe(0);
  });
});

describe('withOutsideCounts', () => {
  const zones = { crest_line: CREST };
  const row = (over: Partial<ObjectiveView & { zone: string }>) => ({
    id: 'hold',
    text: 'Hold',
    primary: true,
    status: 'active',
    zone: 'crest_line',
    ...over,
  });

  it('stamps only an active, unheld zone objective', () => {
    const out = withOutsideCounts(
      [row({ paused: 'unheld' }), row({ id: 'c', paused: 'contested' }), row({ id: 'h' }), row({ id: 'd', status: 'complete', paused: 'unheld' })],
      zones,
      () => 4
    );
    expect(out.map((r) => r.outside)).toEqual([4, undefined, undefined, undefined]);
  });

  it('leaves the row alone when nobody is near', () => {
    expect(withOutsideCounts([row({ paused: 'unheld' })], zones, () => 0)[0].outside).toBeUndefined();
  });
});

describe('holdClock, with units just outside', () => {
  it('says who does not count instead of "nobody holding"', () => {
    const c = holdClock({
      name: 'UZ II',
      result: 'ongoing',
      objectives: [{ id: 'o', text: 'Hold', primary: true, status: 'active', ticksLeft: 52 * TICKS_PER_SECOND, paused: 'unheld', outside: 6 }],
    });
    expect(c?.text).toBe('0:52  NOBODY INSIDE · 6 UNITS JUST OUTSIDE');
    expect(c?.tone).toBe('warn');
  });

  it('keeps "nobody holding" when nobody is near', () => {
    const c = holdClock({
      name: 'UZ II',
      result: 'ongoing',
      objectives: [{ id: 'o', text: 'Hold', primary: true, status: 'active', ticksLeft: 52 * TICKS_PER_SECOND, paused: 'unheld' }],
    });
    expect(c?.text).toBe('0:52  NOBODY HOLDING');
  });
});

/** Umm Zeitoun II's runtime with the screenshot's force (both APCs, three
 *  rifle squads) walked one per tile along row `row`, 40 s in. */
function parkedOn(row: number) {
  const mission = missions.umm_zeitoun_2_buildup as unknown as MissionJson;
  const map = parseMap(maps[mission.map.file as keyof typeof maps]);
  const sim = new Sim({ seed: 424242, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  standMapStructures(sim, map);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as never));
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => typeOf.get(u) as number,
    markers: map.markers,
    zones: map.zones,
    tunnels: [],
    ledger: {},
    unitInfo: () => null,
  });
  rt.start();
  const parked: number[] = [];
  for (let i = 0; i < sim.entityCount; i++) {
    const id = sim.unitTypes[sim.state.typeIdx[i]].id;
    if (sim.state.side[i] === 0 && (id === 'apc_eitan' || id === 'inf_squad')) parked.push(i);
  }
  expect(parked.length).toBe(5);
  parked.forEach((id, k) =>
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.fromInt(19 + k) + (1 << 15), y: fx.fromInt(row) + (1 << 15) })
  );
  for (let t = 0; t < 40 * TICKS_PER_SECOND; t++) rt.step(sim.tick());
  const rowsStood = parked.map((id) => sim.state.posY[id] >> 16);
  const hold = rt.objectiveList.find((o) => o.id === 'hold_the_crest_line');
  const rows = withOutsideCounts(rt.objectiveList, map.zones, (z) => unitsJustOutside(sim.state, sim.entityCount, z));
  return { map, hold, rowsStood, clock: holdClock({ name: 'UZ II', result: 'ongoing', objectives: rows }) };
}

/**
 * The lead's report (3 Oct 2026), replayed through the real runtime. His
 * force parked on y = 42, in front of what was then a two-row crest line
 * ([18,40,13,2]); at gameplay zoom an APC hull there draws squarely inside
 * the yellow band, and the clock said "nobody holding". Two fixes, one test
 * each: the zone took in that row, and a force short of the zone is named.
 */
describe('Umm Zeitoun II: the crest line', () => {
  it('counts the row an APC parks on in front of the crest (y = 42)', () => {
    const { map, hold, clock, rowsStood } = parkedOn(42);
    expect(map.zones.crest_line).toEqual([18, 40, 13, 3]);
    expect(rowsStood).toEqual([42, 42, 42, 42, 42]);
    expect(hold?.paused).toBeUndefined();
    expect(clock?.text).not.toMatch(/NOBODY/);
  });

  it('two rows short (y = 44) reads unheld, and the clock names the units just outside', () => {
    const { hold, clock, rowsStood } = parkedOn(44);
    // Every one of them short of the zone (a crowded tile can shove one
    // a row either way; what matters is that none stands inside).
    for (const r of rowsStood) expect(r).toBeGreaterThanOrEqual(43);
    expect(hold?.paused).toBe('unheld');
    expect(clock?.id).toBe('hold_the_crest_line');
    expect(clock?.text).toMatch(/NOBODY INSIDE · [5-9] UNITS JUST OUTSIDE$/);
  });
});
