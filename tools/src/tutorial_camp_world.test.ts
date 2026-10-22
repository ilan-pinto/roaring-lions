// GH-184 (WP-S-F item 4), the world half of the tutorial's three camp beats:
// call_them_up, rally_point and clear_the_gate can be COMPLETED by a player who
// does what each beat says, in the real `beit_sahwan_0_tutorial`, through the
// real step reducer and the same `productionInputs` read `main.ts` makes.
//
// The beats lean on three pieces of authored geometry, none of which a unit
// test of the reducer can see: the camp's exit tile, the 6-tile contest radius
// around it, and the `z_muster` zone the rally sends the first squad into,
// whose `digger_at_the_camp` trigger puts a man inside that radius while the
// SECOND squad is still on the line. So this walks the mission headlessly from
// a realistic prelude (the first squad has gone east through the wall and into
// the rocks, which delivers the second squad at `rp_west` and the jeep), does
// what each beat's text asks, and requires each beat to clear on the lesson --
// not on clear_the_gate's 90 s patience clock. The controls each remove one
// piece and are required to fail.
//
// Known and accepted (review, 22 Oct): the man by the gate pauses the camp
// only if the second squad is still on the line when the first reaches the
// muster. A player who sets the rally more than ~15 s after the second click
// finds the camp idle when he appears, sees no pause, and clear_the_gate ends
// on its 90 s clock -- the lesson is missed, nothing stalls. The same happens
// if anyone walks into z_muster before beat 9 and spawns him early.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, missions, parseMap, structures as structureCatalogue, units } from '@lions/data';
import { tutorials } from '@lions/data';
import { fx, type Fx } from '../../packages/sim/src/fixed';
import { Sim, TICKS_PER_SECOND } from '../../packages/sim/src/sim';
import { MissionRuntime, type MissionJson } from '../../packages/sim/src/mission';
import {
  advance,
  initTutorial,
  productionInputs,
  type StepJson,
  type TutorialState,
} from '../../packages/app/src/tutorial/runtime';

const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
const steps = (tutorials as Record<string, { steps: StepJson[] }>).beit_sahwan_0.steps;
const CONTEST_TILES = 6;

type UnitJson = { id: string; faction?: string; cost: { logistics: number; build_time_s?: number; population?: number } };

interface World {
  sim: Sim;
  rt: MissionRuntime;
  ids: (type: string, side?: number) => number[];
  /** What `main.ts` keeps between calls to `productionInputs`. */
  contested: boolean[];
  /** Every edge the tutorial was told about, with its tick. */
  edges: { edge: string; tick: number }[];
  /** Side-0 `built` events seen, as main.ts counts them. */
  deployed: number;
}

function world(edit?: (m: MissionJson) => void, seed = 424242): World {
  const mission = structuredClone(missions.beit_sahwan_0_tutorial) as unknown as MissionJson;
  edit?.(mission);
  const map = parseMap(maps[mission.map.file as keyof typeof maps]);
  const sim = new Sim({ seed, width: map.width, height: map.height, capacity: 256 });
  applyTerrain(map, sim);
  const structIdx = new Map<string, number>();
  for (const [id, spec] of Object.entries(structureCatalogue)) {
    structIdx.set(id, sim.addStructureType(spec as Parameters<typeof sim.addStructureType>[0]));
  }
  for (const b of map.structures) sim.addStructure(structIdx.get(b.type) as number, b.tiles);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as Parameters<typeof sim.addUnitType>[0]));
  const rt = new MissionRuntime(sim, mission, {
    typeIdOf: (u) => typeOf.get(u) as number,
    markers: map.markers,
    zones: map.zones,
    tunnels: [],
    ledger: {},
    // The KDF menu priced from its own JSON, as `main.ts` does. No gate: the
    // walk buys rifle squads, which a fresh campaign has open.
    unitInfo: (id, side) => {
      const u = (units as Record<string, UnitJson | undefined>)[id];
      if (side !== 0 || u === undefined || u.faction !== 'kdf') return null;
      return { logistics: u.cost.logistics, buildTimeS: u.cost.build_time_s ?? 20, population: u.cost.population ?? 1 };
    },
  });
  rt.start();
  const ids = (type: string, side = 0): number[] => {
    const out: number[] = [];
    for (let i = 0; i < sim.entityCount; i++) {
      if (sim.state.side[i] === side && sim.state.alive[i] === 1 && sim.unitTypes[sim.state.typeIdx[i]].id === type) out.push(i);
    }
    return out;
  };
  return { sim, rt, ids, contested: [], edges: [], deployed: 0 };
}

function openAt(id: string, nowMs: number): TutorialState {
  const index = steps.findIndex((s) => s.id === id);
  if (index < 0) throw new Error(`no step ${id}`);
  return { ...initTutorial(steps, nowMs), index };
}

/** One tick, the production read handed to the reducer exactly as `main.ts` does. */
function step(w: World, tut: TutorialState): TutorialState {
  // main.ts's order: the set-aside purchases and rallies run first, then the tick.
  w.rt.applyQueued();
  const evs = w.sim.tick();
  const missionEvents = w.rt.step(evs);
  const now = w.sim.tickCount * MS_PER_TICK;
  for (const me of missionEvents) {
    tut = advance(tut, { kind: 'mission', event: me }, now);
    if (me.kind === 'built' && me.side === 0) w.deployed++;
  }
  const read = productionInputs(w.contested, w.rt.productionLines(0), w.deployed);
  w.contested = read.contested;
  for (const input of read.inputs) {
    if (input.kind === 'production' && input.edge !== null) w.edges.push({ edge: input.edge, tick: w.sim.tickCount });
    tut = advance(tut, input, now);
  }
  return advance(tut, { kind: 'tick' }, now);
}

/** Run until the beat clears or `seconds` pass; returns the seconds it took, or null. */
function runBeat(w: World, tut: TutorialState, id: string, seconds: number, each?: (t: TutorialState) => TutorialState) {
  const start = w.sim.tickCount;
  for (let k = 0; k < seconds * TICKS_PER_SECOND; k++) {
    tut = step(w, tut);
    if (each) tut = each(tut);
    if (tut.done || tut.steps[tut.index].id !== id) return { took: (w.sim.tickCount - start) / TICKS_PER_SECOND, tut };
  }
  return { took: null, tut };
}

function until(w: World, ok: () => boolean, seconds: number, what: string): void {
  for (let k = 0; k < seconds * TICKS_PER_SECOND && !ok(); k++) {
    w.rt.applyQueued();
    w.rt.step(w.sim.tick());
  }
  if (!ok()) throw new Error(`world never reached: ${what}`);
}

function inZone(w: World, id: number, zone: readonly number[]): boolean {
  const x = fx.toNumber(w.sim.state.posX[id]);
  const y = fx.toNumber(w.sim.state.posY[id]);
  return x >= zone[0] && x < zone[0] + zone[2] && y >= zone[1] && y < zone[1] + zone[3];
}

/** The prelude: the first squad goes east through the wall and into the rocks,
 *  as use_the_ground leaves it -- the second squad arrives at `rp_west` and
 *  stays there, idle, which is the realistic eye nearest the camp. */
function prelude(edit?: (m: MissionJson) => void, seed?: number): World {
  const w = world(edit, seed);
  const map = parseMap(maps.tutorial_ground);
  const first = w.ids('inf_squad')[0];
  w.sim.queueCommand({ kind: 'move', ids: [first], x: fx.from(18), y: fx.from(22) });
  until(w, () => w.ids('inf_squad').length > 1, 90, 'the second squad');
  w.sim.queueCommand({ kind: 'move', ids: [first], x: fx.from(21), y: fx.from(13) });
  until(w, () => inZone(w, first, map.zones.z_rocks) && w.ids('jeep_shoded').length > 0, 120, 'the rocks and the jeep');
  return w;
}

const buildSquad = (w: World): void => w.sim.queueCommand({ kind: 'build', side: 0, unit: 'inf_squad' });
const rallyAt = (w: World, x: number, y: number): void =>
  w.sim.queueCommand({ kind: 'setRally', side: 0, line: 0, x: fx.from(x) as Fx, y: fx.from(y) as Fx });

/** The three beats, walked as their text says. Returns what each took. */
function walkCamp(
  w: World,
  opts: { builds?: number; secondAfterS?: number; rally?: [number, number]; send?: boolean } = {}
): { beat8: number | null; beat9: number | null; beat10: number | null; pausedFor: number | null } {
  let tut = openAt('call_them_up', w.sim.tickCount * MS_PER_TICK);
  const builds = opts.builds ?? 2;
  // The first click now; the rest at once, or `secondAfterS` later (the slow player).
  buildSquad(w);
  const clickAt = w.sim.tickCount + Math.round((opts.secondAfterS ?? 0) * TICKS_PER_SECOND);
  if (clickAt === w.sim.tickCount) for (let n = 1; n < builds; n++) buildSquad(w);
  const b8 = runBeat(w, tut, 'call_them_up', 60, (t) => {
    if (clickAt > 0 && w.sim.tickCount === clickAt && opts.secondAfterS) for (let n = 1; n < builds; n++) buildSquad(w);
    return t;
  });
  if (b8.took === null) return { beat8: null, beat9: null, beat10: null, pausedFor: null };
  tut = b8.tut;
  const [rx, ry] = opts.rally ?? [10.5, 30.5];
  rallyAt(w, rx, ry);
  const b9 = runBeat(w, tut, 'rally_point', 30);
  if (b9.took === null) return { beat8: b8.took, beat9: null, beat10: null, pausedFor: null };
  tut = b9.tut;
  // Beat 10: once the camp reads paused and the player has watched it for
  // five seconds, the nearest squad is sent at the man by the gate.
  let pausedAt = -1;
  let sent = false;
  const b10 = runBeat(w, tut, 'clear_the_gate', 120, (t) => {
    if (pausedAt < 0 && w.edges.some((e) => e.edge === 'paused')) pausedAt = w.sim.tickCount;
    if (opts.send !== false && !sent && pausedAt >= 0 && w.sim.tickCount - pausedAt >= 5 * TICKS_PER_SECOND) {
      const digger = w.ids('digger_crew', 1).find((d) => fx.toNumber(w.sim.state.posX[d]) < 6);
      if (digger !== undefined) {
        w.sim.queueCommand({
          kind: 'attackMove',
          ids: w.ids('inf_squad'),
          x: w.sim.state.posX[digger],
          y: w.sim.state.posY[digger],
        });
        sent = true;
      }
    }
    return t;
  });
  const paused = w.edges.find((e) => e.edge === 'paused');
  const resumed = w.edges.find((e) => e.edge === 'resumed' && paused !== undefined && e.tick > paused.tick);
  const pausedFor = paused && resumed ? (resumed.tick - paused.tick) / TICKS_PER_SECOND : null;
  return { beat8: b8.took, beat9: b9.took, beat10: b10.took, pausedFor };
}

describe('the tutorial camp beats in the world (GH-184)', () => {
  it('the camp exit is inside the contest radius of the man the muster spawns, and the muster is not', () => {
    const w = world();
    const line = w.rt.productionLines(0)[0];
    expect(line, 'the tutorial has no production line').toBeDefined();
    expect(line.anchor, 'the line stands on player_start, not the camp').toBeGreaterThanOrEqual(0);
    const ex = fx.toNumber(line.exit[0]);
    const ey = fx.toNumber(line.exit[1]);
    const mission = missions.beit_sahwan_0_tutorial as unknown as MissionJson;
    const spawn = mission.triggers?.find((t) => t.id === 'digger_at_the_camp')?.do.units?.[0]?.at;
    expect(spawn).toBeDefined();
    const [sx, sy] = spawn as number[];
    expect(Math.hypot(sx - ex, sy - ey)).toBeLessThan(CONTEST_TILES);
    const muster = parseMap(maps.tutorial_ground).markers.muster;
    expect(Math.hypot(muster[0] + 0.5 - ex, muster[1] + 0.5 - ey)).toBeGreaterThan(CONTEST_TILES);
  });

  it.each([424242, 1, 12, 20])('seed %i: two squads, a rally on the muster, a pause, a clear -- each beat on its lesson', (seed) => {
    const w = prelude(undefined, seed);
    const r = walkCamp(w);
    if (process.env.CAMP_WALK_REPORT) console.log(`seed ${seed}`, JSON.stringify(r));
    expect(r.beat8, 'call_them_up never cleared on two builds').not.toBeNull();
    expect(r.beat9, 'rally_point never cleared on a rally').not.toBeNull();
    expect(r.beat10, 'clear_the_gate never cleared').not.toBeNull();
    // On the lesson, not on the 90 s patience clock.
    expect(r.beat10 as number).toBeLessThan(90);
    // The line really paused and resumed (red with the man moved out of the
    // radius, or the trigger on another zone). How long it stood paused is
    // printed under CAMP_WALK_REPORT (22-23 s on these seeds) and NOT gated:
    // a bound of "at least the five seconds the walk waits" could not be made
    // to fail -- even spawned 1.5 tiles from the idle second squad, the man was
    // not cleared inside five seconds -- so it would guard nothing.
    expect(r.pausedFor, 'the line never paused and resumed').not.toBeNull();
  });

  it('a slow second click, after the first squad has walked out, still clears call_them_up and the lesson goes on', () => {
    const w = prelude();
    const r = walkCamp(w, { secondAfterS: 20 });
    expect(r.beat8, 'call_them_up stalled on a second click 20 s after the first').not.toBeNull();
    expect(r.beat8 as number).toBeGreaterThanOrEqual(20);
    expect(r.beat9).not.toBeNull();
  });

  it('control: one build only never clears call_them_up', () => {
    const w = prelude();
    const r = walkCamp(w, { builds: 1 });
    expect(r.beat8).toBeNull();
  });

  it('control: a rally outside the muster never pauses the camp; the beat ends on its clock', () => {
    const w = prelude();
    const r = walkCamp(w, { rally: [2.5, 30.5] });
    expect(r.beat9).not.toBeNull();
    expect(w.edges.some((e) => e.edge === 'paused')).toBe(false);
    expect(r.beat10 as number).toBeGreaterThanOrEqual(90);
  });

  it('control: the same man seven tiles further out never pauses the camp', () => {
    const w = prelude((m) => {
      const u = m.triggers?.find((t) => t.id === 'digger_at_the_camp')?.do.units?.[0];
      if (!u?.at) throw new Error('digger_at_the_camp moved');
      u.at = [u.at[0], u.at[1] - 7];
    });
    const r = walkCamp(w);
    expect(w.edges.some((e) => e.edge === 'paused')).toBe(false);
    expect(r.beat10 as number).toBeGreaterThanOrEqual(90);
  });
});
