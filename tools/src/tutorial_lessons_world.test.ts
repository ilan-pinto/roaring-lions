// PA-12 and GH-420 T4, the world half: tutorial beats 6 and 9 can be COMPLETED
// by a player who does the lesson, in the real mission, through the real step
// reducer. Beat 6 is walked both ways it can end: the right-click on an
// identified enemy (the `attack` intent, which names the man) and H (a halt).
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
import { Sim, TICKS_PER_SECOND, type SimEvent } from '../../packages/sim/src/sim';
import { MissionRuntime, type MissionEvent, type MissionJson } from '../../packages/sim/src/mission';
import { applyIntent, type PlayerIntent } from '../../packages/app/src/input/intents';
import { fireState, type FireState } from '../../packages/app/src/ui/fire-state';
import { advance, initTutorial, type StepJson, type TutorialState } from '../../packages/app/src/tutorial/runtime';

const MS_PER_TICK = 1000 / TICKS_PER_SECOND;
const steps = (tutorials as Record<string, { steps: StepJson[] }>).beit_sahwan_0.steps;

function openAt(id: string, nowMs: number): TutorialState {
  const index = steps.findIndex((s) => s.id === id);
  if (index < 0) throw new Error(`no step ${id}`);
  return { ...initTutorial(steps, nowMs), index };
}

type FireEvent = Extract<SimEvent, { kind: 'fire' }>;

interface World {
  sim: Sim;
  rt: MissionRuntime;
  ids: (type: string, side?: number) => number[];
  size: { width: number; height: number };
  /** Every `fire` event `step` has seen, in order. */
  fires: FireEvent[];
  /** The tick each entity `step` has seen destroyed died on. */
  deaths: Map<number, number>;
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
  return { sim, rt, ids, size: { width: map.width, height: map.height }, fires: [], deaths: new Map() };
}

const sideOf = (w: World) => (e: number) => w.sim.state.side[e];
const typeIdOf = (w: World) => (e: number) => w.sim.unitTypes[w.sim.state.typeIdx[e]].id;

/** One tick of the sim and the mission runtime, keeping the `fires` / `deaths`
 *  record. Returns what the tick emitted. */
function tickOnly(w: World): { evs: SimEvent[]; missionEvents: MissionEvent[]; now: number } {
  const evs = w.sim.tick();
  const now = w.sim.tickCount * MS_PER_TICK;
  for (const e of evs) {
    if (e.kind === 'fire') w.fires.push(e);
    else if (e.kind === 'destroyed') w.deaths.set(e.entity, e.tick);
  }
  return { evs, missionEvents: w.rt.step(evs), now };
}

/** One tick, everything it emits handed to the reducer the way main.ts does. */
function step(w: World, tut: TutorialState): TutorialState {
  const { evs, missionEvents, now } = tickOnly(w);
  for (const me of missionEvents) tut = advance(tut, { kind: 'mission', event: me }, now);
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

/** What the right-click on an identified enemy does in the app: the `attack`
 *  intent, handed to the sim by `applyIntent` (the same function `dispatch`
 *  calls) and heard by the tutorial the way `main.ts`'s intent listener
 *  hears it. */
function rightClick(w: World, tut: TutorialState, ids: number[], target: number): TutorialState {
  const intent: PlayerIntent = { kind: 'attack', ids, target };
  applyIntent(w.sim, intent, w.size);
  return advance(tut, { kind: 'intent', intent }, w.sim.tickCount * MS_PER_TICK);
}

/** The shots `shooter` fired after tick `since` while `target` still lived:
 *  once the ordered man is dead the order is spent, and what the unit shoots
 *  next is its own choice again. */
function shotsWhileLiving(w: World, shooter: number, target: number, since: number): FireEvent[] {
  const died = w.deaths.get(target) ?? Infinity;
  return w.fires.filter((f) => f.shooter === shooter && f.tick > since && f.tick <= died);
}

/** Tick on with nothing else going on, to see what an ordered unit does next. */
function settle(w: World, seconds: number): void {
  for (let n = 0; n < seconds * TICKS_PER_SECOND; n++) tickOnly(w);
}

function livingEnemies(w: World): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.sim.entityCount; i++) if (w.sim.state.side[i] === 1 && w.sim.state.alive[i] === 1) out.push(i);
  return out;
}

/** The living enemy of `ids` farthest from `from`. */
function farthestFrom(w: World, from: number, ids: number[]): number {
  const dist = (e: number): number => {
    const dx = w.sim.state.posX[e] - w.sim.state.posX[from];
    const dy = w.sim.state.posY[e] - w.sim.state.posY[from];
    return dx * dx + dy * dy;
  };
  return ids.reduce((far, e) => (dist(e) > dist(far) ? e : far));
}

/** Whom the mortar fires on FIRST after `tick`, in a twin of the world a
 *  right-click was given in: same seed, same prelude, nobody clicks. -1 if it
 *  fires on no one in 40 s. */
function firstTargetAfter(seed: number, tick: number): number {
  const { w, mortar } = mortarBeat(undefined, seed);
  while (w.sim.tickCount < tick) tickOnly(w);
  const from = w.fires.length;
  for (let n = 0; n < 40 * TICKS_PER_SECOND; n++) {
    tickOnly(w);
    const f = w.fires.slice(from).find((x) => x.shooter === mortar);
    if (f !== undefined) return f.target;
  }
  return -1;
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

describe('tutorial beat 12 in the world (PA-12)', () => {
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
    expect(took, 'beat 12 never cleared: no Conduct line within two minutes').not.toBeNull();
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

  // GH-420 T4: the beat's order leg also takes the right-click, so a player who
  // picks the mortar's target is not stranded waiting for an H they were never
  // told to press. The drone is dead here too, so the mortar's own sight is the
  // only eye on the diggers and the click has to wait for it.
  //
  // What this proves: the beat clears on an `attack` intent in the real
  // mission, and the order REACHES THE SIM. The click waits until two men pass
  // `canFocus && focusHurts` and takes the FARTHER one, and a twin world with
  // the same seed and no click says whom the mortar fires on unprompted; the
  // test requires that to be the other man, so a click that never reached the
  // sim (`applyIntent` deleted from `rightClick`) leaves the mortar shooting
  // the wrong one and goes red. What it does NOT prove: the order's semantics
  // (reach, release, refusal) -- `packages/sim/src/focus.test.ts` owns those --
  // or that the mortar stays put BECAUSE of the order. The position check below
  // pins the other direction: an ordered mortar is not walked in. It stays
  // green with `applyIntent` deleted (a mortar that was never ordered does not
  // move either) and goes red when `mortar_team`'s effective_range_tiles is cut
  // from 14 to 5: the ordered mortar then closes on its man and ends 0.7 tile
  // from where it stood.
  it.each([424242, 1, 12, 20])('seed %i: a mortar right-clicked onto the farther of two identified enemies fires on that man, not its own pick, and bills a round', (seed) => {
    const { w, mortar } = mortarBeat(undefined, seed);
    const x0 = w.sim.state.posX[mortar];
    const y0 = w.sim.state.posY[mortar];
    let ordered = -1;
    let orderedAtTick = -1;
    const took = runBeat(w, openAt('what_a_shot_costs', w.sim.tickCount * MS_PER_TICK), 'what_a_shot_costs', 120, (t) => {
      if (ordered >= 0) return t;
      const open = livingEnemies(w).filter((x) => w.sim.canFocus(mortar, x) && w.sim.focusHurts(mortar, x));
      if (open.length < 2) return t;
      ordered = farthestFrom(w, mortar, open);
      orderedAtTick = w.sim.tickCount;
      return rightClick(w, t, [mortar], ordered);
    });
    expect(ordered, 'the mortar never identified two enemies it could be ordered onto').toBeGreaterThanOrEqual(0);
    expect(took, 'beat 12 never cleared after the right-click: no Conduct line within two minutes').not.toBeNull();
    // The bill can come from a round fired before the click, so tick on past
    // the mortar's reload (15 s) to see the ordered one.
    settle(w, 20);
    expect(w.sim.state.posX[mortar]).toBe(x0);
    expect(w.sim.state.posY[mortar]).toBe(y0);
    // The control: the same world with no click shoots the other man.
    const unprompted = firstTargetAfter(seed, orderedAtTick);
    expect(unprompted, 'the unordered mortar never fired, so the order proves nothing').toBeGreaterThanOrEqual(0);
    expect(unprompted, 'the mortar would have picked the ordered man anyway: the click is not tested').not.toBe(ordered);
    // And every round it fires after the order is on the man it was told to.
    const after = shotsWhileLiving(w, mortar, ordered, orderedAtTick);
    expect(after.length, 'the ordered mortar never fired').toBeGreaterThan(0);
    for (const f of after) expect(f.target, 'the mortar fired on someone it was not ordered onto').toBe(ordered);
  });
});

/** Beat 6's world: beats 3-5 walked (advance on the field, then up to the
 *  range post), and the squad on the attack-move toward the far post that
 *  beat 6 opens with. */
function rangeBeat(): { w: World; squad: number } {
  const w = world();
  const squad = w.ids('inf_squad')[0];
  w.sim.queueCommand({ kind: 'attackMove', ids: [squad], x: fx.from(26), y: fx.from(24) });
  until(w, () => w.sim.tickCount >= 40 * TICKS_PER_SECOND, 41);
  w.sim.queueCommand({ kind: 'attackMove', ids: [squad], x: fx.from(18), y: fx.from(22) });
  until(w, () => w.sim.tickCount >= 70 * TICKS_PER_SECOND, 31);
  w.sim.queueCommand({ kind: 'attackMove', ids: [squad], x: fx.from(29.5), y: fx.from(18.5) });
  return { w, squad };
}

/** The player sweeps the cursor over each living enemy in turn, once a
 *  second, and the panel answers exactly as main.ts's hover dispatch asks it.
 *  `n` is the frame count, so the same second never hovers twice. */
function hoverNext(
  w: World,
  squad: number,
  tut: TutorialState,
  n: number
): { tut: TutorialState; enemy: number; projection: FireState | null } | null {
  if (n % TICKS_PER_SECOND !== 0) return null;
  const enemies = livingEnemies(w);
  if (enemies.length === 0) return null;
  const enemy = enemies[(n / TICKS_PER_SECOND) % enemies.length];
  const projection = fireState([w.sim.projectHit(squad, enemy)]);
  const next = advance(tut, { kind: 'hover', entity: enemy, structure: -1, sideOf: sideOf(w), projection }, w.sim.tickCount * MS_PER_TICK);
  return { tut: next, enemy, projection };
}

describe('tutorial beat 6 in the world (PA-12, GH-420)', () => {
  const id = 'identify_then_shoot';

  it('a squad halted at the range, with the cursor on an enemy, takes a shot the panel gave odds for', () => {
    const { w, squad } = rangeBeat();
    let tut = openAt(id, w.sim.tickCount * MS_PER_TICK);
    w.sim.queueCommand({ kind: 'halt', ids: [squad] });
    tut = advance(tut, { kind: 'intent', intent: { kind: 'halt', ids: [squad] } }, w.sim.tickCount * MS_PER_TICK);
    let halted: { x: number; y: number } | null = null;
    let k = 0;
    const took = runBeat(w, tut, id, 60, (t) => {
      if (halted === null) halted = { x: w.sim.state.posX[squad], y: w.sim.state.posY[squad] };
      return hoverNext(w, squad, t, ++k)?.tut ?? t;
    });
    expect(took, 'beat 6 never cleared after the halt').not.toBeNull();
    expect(took as number).toBeLessThan(20);
    // And it stood still to do it.
    expect(halted).not.toBeNull();
    expect(w.sim.state.posX[squad]).toBe((halted as unknown as { x: number }).x);
    expect(w.sim.state.posY[squad]).toBe((halted as unknown as { y: number }).y);
  });

  it('a squad right-clicked onto an identified enemy stands still and fires on that man, and the beat clears (GH-420)', () => {
    const { w, squad } = rangeBeat();
    const tut = openAt(id, w.sim.tickCount * MS_PER_TICK);
    // The player holds the cursor on each enemy in turn and right-clicks the
    // first one the panel has given odds for AND the click would accept: the
    // sim's own `canFocus` (identified, an enemy) and `focusHurts` are what
    // the app asks before it issues an `attack`.
    const odds: ReadonlySet<FireState | null> = new Set<FireState | null>(['shot', 'cover', 'moving']);
    let ordered = -1;
    let orderedAtTick = -1;
    let at: { x: number; y: number } | null = null;
    let k = 0;
    const took = runBeat(w, tut, id, 60, (t) => {
      const h = hoverNext(w, squad, t, ++k);
      if (h === null) return t;
      if (ordered >= 0 || !odds.has(h.projection) || !w.sim.canFocus(squad, h.enemy) || !w.sim.focusHurts(squad, h.enemy)) return h.tut;
      ordered = h.enemy;
      orderedAtTick = w.sim.tickCount;
      at = { x: w.sim.state.posX[squad], y: w.sim.state.posY[squad] };
      return rightClick(w, h.tut, [squad], h.enemy);
    });
    expect(ordered, 'the walk never found an enemy the click would accept').toBeGreaterThanOrEqual(0);
    expect(took, 'beat 6 never cleared after the right-click').not.toBeNull();
    expect(took as number).toBeLessThan(20);
    // Then three more seconds, to see what the ordered squad does with the order.
    settle(w, 3);
    const after = shotsWhileLiving(w, squad, ordered, orderedAtTick);
    expect(after.length, 'the ordered squad never fired').toBeGreaterThan(0);
    for (const f of after) expect(f.target, 'the squad fired on someone it was not ordered onto').toBe(ordered);
    // In reach already, it did not walk on: the order stops an attack-move.
    // `moving` CARRIES THE DISCRIMINATION for the click, and it is the only
    // check here seen red: with `applyIntent` deleted from `rightClick` it
    // stays 1 (the attack-move runs on). The shots above do not discriminate
    // (an attack-moving squad is already firing on the man nearest it), and
    // the position checks below were never seen red on their own, so they
    // are not claimed to.
    expect(w.sim.state.moving[squad]).toBe(0);
    expect(w.sim.state.posX[squad]).toBe((at as unknown as { x: number }).x);
    expect(w.sim.state.posY[squad]).toBe((at as unknown as { y: number }).y);
  });

  it('control: a squad left to fire on its own, with the panel read, never clears the beat', () => {
    // The first-session failure, in the world: the attack-moving squad fires
    // by itself and the cursor finds odds -- two legs of three, forever.
    const { w, squad } = rangeBeat();
    const tut = openAt(id, w.sim.tickCount * MS_PER_TICK);
    let k = 0;
    const took = runBeat(w, tut, id, 60, (t) => hoverNext(w, squad, t, ++k)?.tut ?? t);
    expect(w.fires.some((f) => f.shooter === squad), 'the control squad never fired, so it proves nothing').toBe(true);
    expect(took).toBeNull();
  });
});
