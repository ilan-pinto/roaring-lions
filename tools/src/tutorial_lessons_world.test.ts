// PA-12, the world half: tutorial beats 6 and 9 can be COMPLETED by a player
// who does the lesson, in the real mission, through the real step reducer.
//
// `packages/app/src/tutorial/lessons.test.ts` proves the step data ends each
// beat on the lesson and never on a clock. That is only half a fix: a beat
// with no timer that the world cannot satisfy is a stalled tutorial, which is
// worse than a beat that ends early. So this walks `beit_sahwan_0_tutorial`
// headlessly to the moment each beat opens, does what the beat's text tells
// the player to do, translates what the world then emits into the reducer's
// inputs exactly as `main.ts` does (sim events, mission events, the hover
// panel's own `fireState` over `projectHit`), and requires the beat to clear.
//
// Beat 9 is walked at its WORST case: the drone is dead, so nobody but the
// mortar itself can identify the diggers by the clinic. Before this change the
// mortar arrived at `rp_mortar` (20,31), 14 tiles out and twice its sight, and
// halted there it never fired at all; ordered toward the clinic, as the old
// nudge said, it walked onto the diggers before it saw them and stood inside
// its own 4-tile minimum range for the rest of the mission. Both are pinned
// here as the controls.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, missions, parseMap, structures as structureCatalogue, tutorials, units } from '@lions/data';
import { fx } from '../../packages/sim/src/fixed';
import { Sim, TICKS_PER_SECOND } from '../../packages/sim/src/sim';
import { MissionRuntime, type MissionJson } from '../../packages/sim/src/mission';
import { fireState } from '../../packages/app/src/ui/fire-state';
import { advance, initTutorial, type StepJson, type TutorialState } from '../../packages/app/src/tutorial/runtime';

const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
const steps = (tutorials as Record<string, { steps: StepJson[] }>).beit_sahwan_0.steps;

function openAt(id: string, nowMs: number): TutorialState {
  const index = steps.findIndex((s) => s.id === id);
  if (index < 0) throw new Error(`no step ${id}`);
  return { ...initTutorial(steps, nowMs), index };
}

interface World {
  sim: Sim;
  rt: MissionRuntime;
  ids: (type: string, side?: number) => number[];
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
    unitInfo: () => null,
  });
  rt.start();
  const ids = (type: string, side = 0): number[] => {
    const out: number[] = [];
    for (let i = 0; i < sim.entityCount; i++) {
      if (sim.state.side[i] === side && sim.state.alive[i] === 1 && sim.unitTypes[sim.state.typeIdx[i]].id === type) {
        out.push(i);
      }
    }
    return out;
  };
  return { sim, rt, ids };
}

const sideOf = (w: World) => (e: number) => w.sim.state.side[e];
const typeIdOf = (w: World) => (e: number) => w.sim.unitTypes[w.sim.state.typeIdx[e]].id;

/** One tick, everything it emits handed to the reducer the way main.ts does. */
function step(w: World, tut: TutorialState): TutorialState {
  const evs = w.sim.tick();
  const now = w.sim.tickCount * MS_PER_TICK;
  for (const me of w.rt.step(evs)) tut = advance(tut, { kind: 'mission', event: me }, now);
  for (const e of evs) tut = advance(tut, { kind: 'sim', event: e, sideOf: sideOf(w), typeIdOf: typeIdOf(w) }, now);
  return advance(tut, { kind: 'tick' }, now);
}

/** Run until the beat clears or `seconds` pass; returns the seconds it took, or null. */
function runBeat(w: World, tut: TutorialState, id: string, seconds: number, each?: (t: TutorialState) => TutorialState) {
  const start = w.sim.tickCount;
  for (let k = 0; k < seconds * TICKS_PER_SECOND; k++) {
    tut = step(w, tut);
    if (each) tut = each(tut);
    if (tut.done || tut.steps[tut.index].id !== id) return (w.sim.tickCount - start) / TICKS_PER_SECOND;
  }
  return null;
}

/** Walk until a predicate holds, ticking the sim and runtime only. */
function until(w: World, ok: () => boolean, seconds: number): void {
  for (let k = 0; k < seconds * TICKS_PER_SECOND && !ok(); k++) w.rt.step(w.sim.tick());
  if (!ok()) throw new Error('world never reached the beat');
}

/** Beat 9's world: the jeep has brought the civilians home (the refuge entry
 *  that delivers the mortar and spawns the clinic diggers), the range is
 *  clear, and the drone is gone. */
function mortarBeat(edit?: (m: MissionJson) => void, seed?: number): { w: World; mortar: number } {
  const w = world(edit, seed);
  w.sim.queueCommand({ kind: 'move', ids: w.ids('inf_squad'), x: fx.from(23), y: fx.from(39) });
  until(w, () => w.ids('mortar_team').length > 0, 120);
  for (const d of w.ids('digger_crew', 1)) if (w.sim.state.posY[d] < fx.from(33)) w.sim.debugKill(d);
  for (const c of w.ids('civilians', 2)) w.sim.debugKill(c);
  for (const d of w.ids('recon_drone')) w.sim.debugKill(d);
  return { w, mortar: w.ids('mortar_team')[0] };
}

describe('tutorial beat 9 in the world (PA-12)', () => {
  // Seeds 12 and 20 are the slowest of thirty measured (58 s); most clear on
  // the beat's own 12 s floor. The two-minute bound is the old timer's.
  it.each([424242, 1, 12, 20])('seed %i: a mortar held where it arrives bills a round into the flagged zone, with no one else spotting', (seed) => {
    const { w, mortar } = mortarBeat(undefined, seed);
    const x0 = w.sim.state.posX[mortar];
    const y0 = w.sim.state.posY[mortar];
    let tut = openAt('what_a_shot_costs', w.sim.tickCount * MS_PER_TICK);
    w.sim.queueCommand({ kind: 'halt', ids: [mortar] });
    tut = advance(tut, { kind: 'intent', intent: { kind: 'halt', ids: [mortar] } }, w.sim.tickCount * MS_PER_TICK);
    const took = runBeat(w, tut, 'what_a_shot_costs', 120);
    expect(took, 'beat 9 never cleared: no Conduct line within two minutes').not.toBeNull();
    // Fired from where it stood: the lesson is "from the road", not "walk in".
    expect(w.sim.state.posX[mortar]).toBe(x0);
    expect(w.sim.state.posY[mortar]).toBe(y0);
  });

  it('control: at the old rally point the same held mortar never fires', () => {
    const { w, mortar } = mortarBeat((m) => {
      const t = m.triggers?.find((x) => x.id === 'deliver_mortar');
      const u = t?.do.units?.[0];
      if (!u) throw new Error('deliver_mortar moved');
      delete u.at;
      u.marker = 'rp_mortar';
    });
    let tut = openAt('what_a_shot_costs', w.sim.tickCount * MS_PER_TICK);
    w.sim.queueCommand({ kind: 'halt', ids: [mortar] });
    tut = advance(tut, { kind: 'intent', intent: { kind: 'halt', ids: [mortar] } }, w.sim.tickCount * MS_PER_TICK);
    expect(runBeat(w, tut, 'what_a_shot_costs', 120)).toBeNull();
  });
});

describe('tutorial beat 6 in the world (PA-12)', () => {
  it('a squad halted at the range, with the cursor on an enemy, takes a shot the panel gave odds for', () => {
    const w = world();
    const squad = w.ids('inf_squad')[0];
    // Beats 3-5: advance on the field, then up to the range post.
    w.sim.queueCommand({ kind: 'attackMove', ids: [squad], x: fx.from(26), y: fx.from(24) });
    until(w, () => w.sim.tickCount >= 40 * TICKS_PER_SECOND, 41);
    w.sim.queueCommand({ kind: 'attackMove', ids: [squad], x: fx.from(18), y: fx.from(22) });
    until(w, () => w.sim.tickCount >= 70 * TICKS_PER_SECOND, 31);
    // Beat 6 opens with the squad on an attack-move toward the far one.
    w.sim.queueCommand({ kind: 'attackMove', ids: [squad], x: fx.from(29.5), y: fx.from(18.5) });
    let tut = openAt('identify_then_shoot', w.sim.tickCount * MS_PER_TICK);
    w.sim.queueCommand({ kind: 'halt', ids: [squad] });
    tut = advance(tut, { kind: 'intent', intent: { kind: 'halt', ids: [squad] } }, w.sim.tickCount * MS_PER_TICK);
    let halted: { x: number; y: number } | null = null;
    // The player sweeps the cursor over each enemy in turn, once a second,
    // and the panel answers exactly as main.ts's hover dispatch asks it.
    let k = 0;
    const took = runBeat(w, tut, 'identify_then_shoot', 60, (t) => {
      if (halted === null) halted = { x: w.sim.state.posX[squad], y: w.sim.state.posY[squad] };
      if (++k % TICKS_PER_SECOND !== 0) return t;
      const enemies: number[] = [];
      for (let i = 0; i < w.sim.entityCount; i++) if (w.sim.state.side[i] === 1 && w.sim.state.alive[i] === 1) enemies.push(i);
      if (enemies.length === 0) return t;
      const e = enemies[(k / TICKS_PER_SECOND) % enemies.length];
      const projection = fireState([w.sim.projectHit(squad, e)]);
      return advance(t, { kind: 'hover', entity: e, structure: -1, sideOf: sideOf(w), projection }, w.sim.tickCount * MS_PER_TICK);
    });
    expect(took, 'beat 6 never cleared after the halt').not.toBeNull();
    expect(took as number).toBeLessThan(20);
    // And it stood still to do it.
    expect(halted).not.toBeNull();
    expect(w.sim.state.posX[squad]).toBe((halted as unknown as { x: number }).x);
    expect(w.sim.state.posY[squad]).toBe((halted as unknown as { y: number }).y);
  });
});
