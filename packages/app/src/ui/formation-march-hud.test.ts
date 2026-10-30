// @vitest-environment jsdom
//
// GH-859 P1b Task 10: what the HUD says of a formation that MARCHES -- the card's checkpoint, pace, call and contact lines,
// the chip's "6 in column · cp 2/4", the alerts, and the P1a minors -- in the DOM and over a real `Sim` stepped to the state
// each line describes. Every expected string is a literal (casebook: "the oracle imported its arguments"); a table of cases
// asserts its own length so an empty table cannot pass.
//
// Worlds use the SHIPPED units and the SHIPPED formations (`@lions/data`), so a retuned file moves these tests on purpose.
// The tick numbers in the comments are the sim's own (`formationReleased` at 213, a contact at 160 ...), read off a run.
import { afterEach, describe, expect, it } from 'vitest';
import { formations, units } from '@lions/data';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import { Hud, type HudCommanderInfo, type HudDeps } from './hud';
import { closeTip } from './tooltip';
import { formationClassOfUnit, formationUnitFacts } from './formation-sim';
import { formationRow } from './formation-model';
import { alertsForTick, initAlertState, type AlertWorld } from './alerts';
import { createFormationArming } from '../input/formation-arming';
import { cursorAt, simIntentWorld, type PointerPoint } from '../input/pointer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OrderSink } from '../input/intents';
import { pseudo } from '../i18n/pseudo';
import { setCatalogue, t } from '../i18n/t';
import en from '../i18n/en.json';

const U = units as unknown as Record<string, UnitTypeJson>;
const COMMANDER: HudCommanderInfo = { shai: { name: 'Shai Hammai', plate: 'Hammai', rank: 'Captain', stars: 2 }, idit: { name: 'Idit Zohar', plate: 'Zohar' } };

const madeHuds: Hud[] = [];
afterEach(() => {
  closeTip();
  for (const h of madeHuds.splice(0)) h.destroy();
  setCatalogue('en', en);
});

// ---------------------------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------------------------
const at = (n: number): number => fx.from(n + 0.5);

interface Types {
  inf: number;
  mbt: number;
  mortar: number;
  heli: number;
  drone: number;
  medic: number;
  squad: number;
  foe: number;
  weak: number;
}
interface World {
  sim: Sim;
  t: Types;
  events: SimEvent[];
}
function world(w = 48, h = 48, capacity = 64): World {
  const sim = new Sim({ seed: 0x8510, width: w, height: h, capacity });
  const squadHull = (U.inf_squad as unknown as { hull: object }).hull;
  const t: Types = {
    inf: sim.addUnitType(U.inf_squad),
    mbt: sim.addUnitType(U.mbt_lavi),
    mortar: sim.addUnitType(U.mortar_team),
    heli: sim.addUnitType(U.heli_peten_gunship),
    drone: sim.addUnitType(U.recon_drone),
    medic: sim.addUnitType(U.inf_medic_squad),
    // A rifle squad whose every fatal hit drops a man alive: a casualty the medic can answer.
    squad: sim.addUnitType({ ...U.inf_squad, id: 'fm10_squad', hull: { ...squadHull, wounds: { wound_chance: 1, bleed_s: 60, type: 'wounded_kdf' } } } as UnitTypeJson),
    // An unarmed enemy: something to fire at, and it fires at nobody.
    foe: sim.addUnitType({ ...U.inf_squad, id: 'fm10_foe', weapons: [], abilities: [] } as UnitTypeJson),
    // An enemy rifleman the lead tank clears, so an Attack presses on.
    weak: sim.addUnitType({ ...U.sarim_rifles, id: 'fm10_weak' } as UnitTypeJson),
  };
  sim.addUnitType(U.wounded_kdf);
  for (const f of formations) sim.addFormationType(f);
  return { sim, t, events: [] };
}
function step(w: World, n = 1): void {
  for (let i = 0; i < n; i++) for (const e of w.sim.tick()) w.events.push(e);
}
const spawn = (w: World, type: number, side: number, x: number, y: number): number => w.sim.spawn(type, side, at(x), at(y), 0);

interface Column {
  w: World;
  /** Three rifle squads, a Lavi, a mortar team and a medic squad. */
  ids: number[];
  squads: number[];
  mbt: number;
  mortar: number;
  medic: number;
}
/** A Column of six from (20..30, 44) to (24, 14): 30 tiles, four checkpoints, paced by the mortar team (0.65 tiles a second). */
function column(): Column {
  const w = world();
  const ids = [w.t.inf, w.t.inf, w.t.inf, w.t.mbt, w.t.mortar, w.t.medic].map((ty, k) => spawn(w, ty, 0, 20 + k * 2, 44));
  w.sim.queueCommand({ kind: 'move', ids, x: at(24), y: at(14), formation: 'column' } as never);
  step(w, 1);
  return { w, ids, squads: ids.slice(0, 3), mbt: ids[3], mortar: ids[4], medic: ids[5] };
}

interface Halt {
  w: World;
  ids: number[];
  inf: number;
  heli: number;
}
/** A Column of three squads, a Lavi, a mortar team and a strike helicopter, (20..30, 44) to (24, 10), with an unarmed enemy at
 *  (30, 30) in its way: the squads fire on it at tick 160 (the contact), the column halts, the helicopter is called at 161. */
function halting(): Halt {
  const w = world();
  const ids = [w.t.inf, w.t.inf, w.t.inf, w.t.mbt, w.t.mortar, w.t.heli].map((ty, k) => spawn(w, ty, 0, 20 + k * 2, 44));
  w.sim.queueCommand({ kind: 'move', ids, x: at(24), y: at(10), formation: 'column' } as never);
  spawn(w, w.t.foe, 1, 30, 30);
  step(w, 1);
  return { w, ids, inf: ids[0], heli: ids[5] };
}

interface Press {
  w: World;
  ids: number[];
  tank: number;
  inf: number;
  heli: number;
  drone: number;
}
/** An Attack of two Lavi, three squads, a gunship and a recon drone from (24, 30) to (24, 4), a weak enemy post at (31, 19): the
 *  lead tank fires on it at tick 113 (the contact); the gunship and the drone are called at 114. */
function pressing(): Press {
  const w = world();
  const ids = [w.t.mbt, w.t.mbt, w.t.inf, w.t.inf, w.t.inf, w.t.heli, w.t.drone].map((ty) => spawn(w, ty, 0, 24, 30));
  w.sim.queueCommand({ kind: 'attackMove', ids, x: at(24), y: at(4), formation: 'attack' } as never);
  spawn(w, w.t.weak, 1, 31, 19);
  step(w, 1);
  return { w, ids, tank: ids[0], inf: ids[2], heli: ids[5], drone: ids[6] };
}

// ---------------------------------------------------------------------------------------------
// The DOM
// ---------------------------------------------------------------------------------------------
interface Rig {
  hud: Hud;
  host: HTMLElement;
  paint: () => void;
}
function rigFor(sim: Sim, sel: () => number[], over: Partial<HudDeps> = {}): Rig {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const hud = new Hud(host, {
    sim,
    getSelection: sel,
    getMission: () => null,
    hoverStructure: () => -1,
    hoverEntity: () => -1,
    gameVersion: '0.1',
    commander: COMMANDER,
    keyFor: () => '1',
    portrait: () => null,
    ...over,
  });
  madeHuds.push(hud);
  const paint = (): void => {
    for (let i = 0; i < 5; i++) hud.onTick();
  };
  paint();
  return { hud, host, paint };
}
/** The card's condition line, split back into the lines the HUD joined with " · ". */
const cardLines = (sim: Sim, id: number): string[] => {
  const r = rigFor(sim, () => [id]);
  return (r.host.querySelector('.rl-card__cond')?.textContent ?? '').split(' · ');
};
const chipStatus = (sim: Sim, ids: number[], type: string): string | undefined => {
  const r = rigFor(sim, () => ids);
  return r.host.querySelector(`.rl-chip[data-type="${type}"] .rl-chip__status`)?.textContent ?? undefined;
};
const textsOf = (root: Element): string[] => {
  const out: string[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
    const v = (n.textContent ?? '').trim();
    if (v !== '') out.push(v);
  }
  return out;
};

// ---------------------------------------------------------------------------------------------
describe('the card: a Column on the march', () => {
  it('a marching Column reads its checkpoint, and the pace with the team that sets it', () => {
    const c = column();
    step(c.w, 99); // tick 100: heading for checkpoint 1 of 4, nobody has reached it
    expect(c.w.sim.formationLegOfGroup(0)).toBe(1);
    expect(c.w.sim.formationLegsOfGroup(0)).toBe(4);
    for (const id of [c.squads[0], c.mbt]) {
      const lines = cardLines(c.w.sim, id);
      expect(lines, `unit ${id}`).toContain('In column — checkpoint 1 of 4');
      expect(lines, `unit ${id}`).toContain('Pace 0.7 t/s, set by 60mm Mortar Team');
    }
    // The setter is the slowest ground team: the mortar team itself reads its own name.
    expect(cardLines(c.w.sim, c.mortar)).toContain('Pace 0.7 t/s, set by 60mm Mortar Team');
    // The plain P1a line is gone while the route has more than one checkpoint.
    expect(cardLines(c.w.sim, c.squads[0])).not.toContain('In column');
  });

  it('a dressing Column holds the checkpoint it is dressing, and moves on when it is released', () => {
    const c = column();
    step(c.w, 189); // tick 190: two members wait at checkpoint 1 (duty 1); the line is not released until tick 213
    expect(c.ids.map((id) => c.w.sim.formationDutyOf(id))).toEqual([0, 0, 1, 0, 1, 0]);
    expect(cardLines(c.w.sim, c.squads[2])).toContain('In column — checkpoint 1 of 4');
    expect(cardLines(c.w.sim, c.mortar)).toContain('In column — checkpoint 1 of 4');
    step(c.w, 51); // tick 241: released at 213
    expect(c.w.sim.formationLegOfGroup(0)).toBe(2);
    expect(c.ids.map((id) => c.w.sim.formationDutyOf(id))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(cardLines(c.w.sim, c.squads[0])).toContain('In column — checkpoint 2 of 4');
    expect(cardLines(c.w.sim, c.squads[0])).not.toContain('In column — checkpoint 1 of 4');
    step(c.w, 280); // tick 521: released again at 519
    expect(cardLines(c.w.sim, c.squads[0])).toContain('In column — checkpoint 3 of 4');
  });

  it('a medic at its station is "On call"; a rifle squad is not', () => {
    const c = column();
    step(c.w, 99);
    expect(cardLines(c.w.sim, c.medic)).toContain('On call');
    expect(cardLines(c.w.sim, c.squads[0])).not.toContain('On call');
    expect(cardLines(c.w.sim, c.squads[0]).join(' | ')).not.toContain('Answering');
  });

  it('the chip reads "6 in column · cp 2/4" once the first checkpoint is released', () => {
    const c = column();
    step(c.w, 99);
    expect(chipStatus(c.w.sim, c.ids, 'inf_squad')).toBe('3 in column · cp 1/4');
    step(c.w, 141); // tick 241
    expect(chipStatus(c.w.sim, c.ids, 'inf_squad')).toBe('3 in column · cp 2/4');
    // All six are in the one column: a chip per type, each with the same checkpoint. (The Lavi's chip says APS, which outranks it.)
    expect(chipStatus(c.w.sim, c.ids, 'mortar_team')).toBe('1 in column · cp 2/4');
    // Selected together on a one-type chip (six squads would be one chip): the count is the chip's whole group.
    const w = world();
    const six = Array.from({ length: 6 }, (_, k) => spawn(w, w.t.inf, 0, 18 + k * 2, 44));
    w.sim.queueCommand({ kind: 'move', ids: six, x: at(24), y: at(14), formation: 'column' } as never);
    step(w, 241);
    expect(w.sim.formationLegOfGroup(0)).toBe(2);
    expect(chipStatus(w.sim, six, 'inf_squad')).toBe('6 in column · cp 2/4');
  });
});

describe('the card: contact', () => {
  it('a halted Column reads "Column in contact", with no pace line, and its helicopter reads "Answering a call"', () => {
    const h = halting();
    step(h.w, 99);
    // Before the contact the helicopter waits at checkpoint 1 (duty 1), at its station: "On call".
    expect(h.w.sim.formationDutyOf(h.heli)).toBe(1);
    expect(cardLines(h.w.sim, h.heli)).toContain('On call');
    step(h.w, 100); // tick 200: contact at 160, the helicopter out since 161
    expect(h.w.sim.formationStateOfGroup(0)).toBe(3);
    expect(h.w.sim.formationDutyOf(h.heli)).toBe(2);
    const squad = cardLines(h.w.sim, h.inf);
    expect(squad).toContain('Column in contact');
    expect(squad.join(' | ')).not.toContain('Pace');
    expect(squad.join(' | ')).not.toContain('checkpoint');
    const heli = cardLines(h.w.sim, h.heli);
    expect(heli).toContain('Answering a call');
    expect(heli).not.toContain('On call');
    // Coming home from the call (duty 3, the quiet return at 364) is still the call's business.
    step(h.w, 190); // tick 390
    expect(h.w.sim.formationDutyOf(h.heli)).toBe(3);
    expect(cardLines(h.w.sim, h.heli)).toContain('Answering a call');
  });

  it('an Attack pressing on reads "In contact — pressing on" and still names its pace; the aircraft are answering', () => {
    const p = pressing();
    step(p.w, 20); // tick 21: marching, checkpoint 1 of 4
    expect(cardLines(p.w.sim, p.tank)).toContain('In attack formation — checkpoint 1 of 4');
    expect(cardLines(p.w.sim, p.tank)).toContain('Pace 0.9 t/s, set by Rifle Squad');
    expect(cardLines(p.w.sim, p.heli)).toContain('On call');
    expect(cardLines(p.w.sim, p.drone)).toContain('On call');
    step(p.w, 100); // tick 121: contact at 113, the aircraft called at 114
    expect(p.w.sim.formationStateOfGroup(0)).toBe(3);
    const tank = cardLines(p.w.sim, p.tank);
    expect(tank).toContain('In contact — pressing on');
    expect(tank).toContain('Pace 0.9 t/s, set by Rifle Squad');
    expect(tank.join(' | ')).not.toContain('checkpoint');
    for (const id of [p.heli, p.drone]) {
      expect(p.w.sim.formationDutyOf(id)).toBe(2);
      expect(cardLines(p.w.sim, id), `aircraft ${id}`).toContain('Answering a call');
      // An aircraft is not held to the ground pace.
      expect(cardLines(p.w.sim, id).join(' | '), `aircraft ${id}`).not.toContain('Pace');
    }
  });
});

describe('the card: a medic answering, and a degraded member', () => {
  it('a medic sent to a man who went down reads "Answering a call"', () => {
    const w = world();
    const ids = [w.t.squad, w.t.squad, w.t.medic, w.t.mortar].map((ty, k) => spawn(w, ty, 0, 20 + k * 2, 44));
    w.sim.queueCommand({ kind: 'move', ids, x: at(24), y: at(10), formation: 'column' } as never);
    step(w, 30);
    const medic = ids[2];
    expect(cardLines(w.sim, medic)).toContain('On call');
    const state = w.sim.state;
    w.sim.debugSplash(state.posX[ids[0]], state.posY[ids[0]], fx.fromInt(1), fx.fromInt(200), 0, -1, -1);
    step(w, 1);
    expect(w.events.filter((e) => e.kind === 'formationCall').map((e) => (e as { call: string }).call)).toEqual(['casualty']);
    expect(w.sim.formationDutyOf(medic)).toBe(2);
    expect(cardLines(w.sim, medic)).toContain('Answering a call');
    expect(cardLines(w.sim, medic)).not.toContain('On call');
    expect(cardLines(w.sim, medic).join(' | ')).not.toContain('Pace');
  });

  it('a member of an order the full table could not seat reads "In formation (no march)"', () => {
    const w = world(64, 64, 128);
    for (let k = 0; k < 16; k++) {
      const ids = [0, 1].map(() => spawn(w, w.t.inf, 0, 4 + 12 * (k % 5), 60));
      w.sim.queueCommand({ kind: 'move', ids, x: at(4 + 12 * (k % 5)), y: at(20 + 8 * ((k - (k % 5)) / 5)), formation: 'column' } as never);
    }
    step(w, 1);
    const extra = [0, 1].map(() => spawn(w, w.t.inf, 0, 56, 50));
    w.sim.queueCommand({ kind: 'move', ids: extra, x: at(56), y: at(12), formation: 'column' } as never);
    step(w, 1);
    expect(extra.map((id) => w.sim.formationGroupOf(id))).toEqual([-1, -1]);
    expect(cardLines(w.sim, extra[0])).toContain('In formation (no march)');
    expect(cardLines(w.sim, extra[0]).join(' | ')).not.toContain('checkpoint');
    // A member of the sixteenth group, seated, reads its march; a plain unit reads neither.
    expect(cardLines(w.sim, 0).join(' | ')).toContain('In column');
    expect(cardLines(w.sim, 0).join(' | ')).not.toContain('no march');
    const lone = spawn(w, w.t.inf, 0, 2, 2);
    expect(cardLines(w.sim, lone).join(' | ')).not.toMatch(/formation|column/i);
  });

  it('an enemy in a Column is not the viewer\'s to read', () => {
    const w = world();
    const foes = [0, 1].map((k) => spawn(w, w.t.foe, 1, 30 + k, 40));
    w.sim.queueCommand({ kind: 'move', ids: foes, x: at(30), y: at(20), formation: 'column' } as never);
    step(w, 5);
    expect(w.sim.formationGroupOf(foes[0])).toBeGreaterThanOrEqual(0);
    expect(cardLines(w.sim, foes[0]).join(' | ')).not.toMatch(/column|pace|checkpoint/i);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the pace line names the slow team', () => {
  it('whoever sets the pace is named, whichever member the card is for (the setter is not the first member)', () => {
    const w = world();
    // The mortar team is the LAST of five: the first member, a rifle squad, is faster.
    const ids = [w.t.inf, w.t.inf, w.t.mbt, w.t.mbt, w.t.mortar].map((ty, k) => spawn(w, ty, 0, 20 + k * 2, 44));
    w.sim.queueCommand({ kind: 'move', ids, x: at(24), y: at(14), formation: 'column' } as never);
    step(w, 5);
    expect(w.sim.formationPaceSetterOf(0)).toBe(ids[4]);
    expect(cardLines(w.sim, ids[0])).toContain('Pace 0.7 t/s, set by 60mm Mortar Team');
    // Without the mortar team the squads set it, and it reads their name: 0.9 tiles a second.
    const v = world();
    const fast = [v.t.mbt, v.t.mbt, v.t.inf].map((ty, k) => spawn(v, ty, 0, 20 + k * 2, 44));
    v.sim.queueCommand({ kind: 'move', ids: fast, x: at(24), y: at(14), formation: 'column' } as never);
    step(v, 5);
    expect(v.sim.formationPaceSetterOf(0)).toBe(fast[2]);
    expect(cardLines(v.sim, fast[0])).toContain('Pace 0.9 t/s, set by Rifle Squad');
  });
});

// ---------------------------------------------------------------------------------------------
// The alerts, from the events a real sim raises
// ---------------------------------------------------------------------------------------------
function alertWorldOf(sim: Sim, viewer = 0): AlertWorld {
  return {
    posOf: (e) => (e < 0 ? null : { x: fx.toNumber(sim.state.posX[e]), y: fx.toNumber(sim.state.posY[e]) }),
    sideOf: (e) => sim.state.side[e],
    typeOf: (e) => sim.unitTypes[sim.state.typeIdx[e]].id,
    unitName: (id) => sim.unitTypes.find((u) => u.id === id)?.name ?? id,
    objectiveAt: () => null,
    placeOf: () => 'here',
    lossTier: () => 'important',
    waves: [],
    objectiveDone: () => false,
    markerAt: () => null,
    arrivedAt: () => null,
    reinforcement: () => null,
    viewer,
    zoneAt: () => null,
    zoneHolder: () => -1,
    supplyCutAt: () => null,
    supplyCut: () => null,
  };
}
/** Every alert the run's events raise, tick by tick, as the game feeds them. */
function alertsOver(w: World, viewer: number): { kind: string; key: string | undefined; params: unknown }[] {
  const out: { kind: string; key: string | undefined; params: unknown }[] = [];
  let state = initAlertState();
  const byTick = new Map<number, SimEvent[]>();
  for (const e of w.events) byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e]);
  for (const [tick, evs] of [...byTick].sort((a, b) => a[0] - b[0])) {
    const r = alertsForTick(state, evs, [], alertWorldOf(w.sim, viewer), tick);
    state = r.state;
    for (const a of r.alerts) if (a.kind === 'formationContact' || a.kind === 'formationCall') out.push({ kind: a.kind, key: a.line?.key, params: a.line?.params });
  }
  return out;
}

describe('the alerts: once per event, own side only', () => {
  it('a halted Column raises "column in contact" once, and its helicopter\'s sortie raises one "answering the call"', () => {
    const h = halting();
    step(h.w, 400);
    const sim = h.w.sim;
    // The run holds exactly one contact, one strike call and (the quiet return) one return: the alerts are those, less the return.
    expect(h.w.events.filter((e) => e.kind === 'formationContact')).toHaveLength(1);
    expect(h.w.events.filter((e) => e.kind === 'formationCall').map((e) => (e as { call: string }).call)).toEqual(['strike', 'return']);
    expect(alertsOver(h.w, 0)).toEqual([
      { kind: 'formationContact', key: 'alert.formationContact', params: {} },
      { kind: 'formationCall', key: 'alert.formationCall', params: { unit: sim.unitTypes[sim.state.typeIdx[h.heli]].name } },
    ]);
    expect(sim.unitTypes[sim.state.typeIdx[h.heli]].name).toBe('Peten Gunship');
  });

  it('the enemy\'s view of the same run raises neither', () => {
    const h = halting();
    step(h.w, 400);
    expect(alertsOver(h.w, 1)).toEqual([]);
  });

  it('an Attack pressing on raises no contact line (it does not halt), but its two aircraft answer the call: one line each', () => {
    const p = pressing();
    step(p.w, 150);
    expect(p.w.events.filter((e) => e.kind === 'formationContact')).toHaveLength(1);
    expect(alertsOver(p.w, 0).map((a) => [a.kind, (a.params as { unit?: string }).unit])).toEqual([
      ['formationCall', 'Peten Gunship'],
      ['formationCall', 'Recon Drone'],
    ]);
  });

  it('a medic\'s answer raises nothing', () => {
    const w = world();
    const ids = [w.t.squad, w.t.squad, w.t.medic, w.t.mortar].map((ty, k) => spawn(w, ty, 0, 20 + k * 2, 44));
    w.sim.queueCommand({ kind: 'move', ids, x: at(24), y: at(10), formation: 'column' } as never);
    step(w, 30);
    w.sim.debugSplash(w.sim.state.posX[ids[0]], w.sim.state.posY[ids[0]], fx.fromInt(1), fx.fromInt(200), 0, -1, -1);
    step(w, 5);
    expect(w.events.filter((e) => e.kind === 'formationCall')).toHaveLength(1);
    expect(alertsOver(w, 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the lines go through t(): bracketed under the pseudo-locale, and read at the moment of asking', () => {
  it('every new text node is bracketed: card (march, contact, call, degraded), chip, tooltip', () => {
    setCatalogue('pseudo', en, pseudo);
    /** What is left of the card's condition line once every bracketed span is cut out: any letter here never went through t().
     *  (The unit name in a pace line is DATA, inside the bracketed line.) */
    const cond = (sim: Sim, id: number): string => cardLines(sim, id).join(' · ');
    const unbracketed = (sim: Sim, id: number): string => cond(sim, id).replace(/⟦[^⟧]*⟧/g, '').replace(/[ ·]/g, '');
    const spans = (sim: Sim, id: number): number => (cond(sim, id).match(/⟦/g) ?? []).length;
    const words = (root: Element): string[] => textsOf(root).filter((t) => /[A-Za-z]/.test(t.replace(/⟦[^⟧]*⟧/g, '')));
    // The medic of a marching Column: the checkpoint, the pace and "On call", and the P1a "moving" flag, every line bracketed.
    const c = column();
    step(c.w, 99);
    expect(spans(c.w.sim, c.medic)).toBeGreaterThanOrEqual(4); // checkpoint, pace, on call, and P1a's moving flag
    expect(unbracketed(c.w.sim, c.medic)).toBe('');
    // Contact and a call away: the squad's "Column in contact", the helicopter's "Answering a call".
    const h = halting();
    step(h.w, 200);
    expect(spans(h.w.sim, h.inf)).toBeGreaterThanOrEqual(1);
    expect(spans(h.w.sim, h.heli)).toBeGreaterThanOrEqual(2);
    expect(unbracketed(h.w.sim, h.inf)).toBe('');
    expect(unbracketed(h.w.sim, h.heli)).toBe('');
    // An Attack pressing on, and its two aircraft on a call.
    const p = pressing();
    step(p.w, 120);
    for (const id of [p.tank, p.inf, p.heli, p.drone]) {
      expect(spans(p.w.sim, id), `unit ${id}`).toBeGreaterThanOrEqual(2);
      expect(unbracketed(p.w.sim, id), `unit ${id}`).toBe('');
    }
    // The chip.
    const chip = rigFor(c.w.sim, () => c.ids).host.querySelector('.rl-chip__status')!;
    expect(chip.textContent).toContain('⟦');
    expect(words(chip)).toEqual([]);
    // The tooltip: the composed lines are bracketed whole (face, drill, pace, calls).
    const rig = rigFor(c.w.sim, () => c.ids);
    rig.host.querySelector<HTMLButtonElement>('[data-formation="column"]')!.dispatchEvent(new MouseEvent('mouseenter'));
    const tip = rig.host.querySelector('.rl-tip')!;
    expect(words(tip)).toEqual([]);
    expect(textsOf(tip).filter((t) => t.includes('⟦')).length).toBeGreaterThanOrEqual(3);
    // A member the full table could not seat.
    const w = world(64, 64, 128);
    for (let k = 0; k < 16; k++) {
      const ids = [0, 1].map(() => spawn(w, w.t.inf, 0, 4 + 12 * (k % 5), 60));
      w.sim.queueCommand({ kind: 'move', ids, x: at(4 + 12 * (k % 5)), y: at(20 + 8 * ((k - (k % 5)) / 5)), formation: 'column' } as never);
    }
    step(w, 1);
    const extra = [0, 1].map(() => spawn(w, w.t.inf, 0, 56, 50));
    w.sim.queueCommand({ kind: 'move', ids: extra, x: at(56), y: at(12), formation: 'column' } as never);
    step(w, 1);
    expect(spans(w.sim, extra[0])).toBeGreaterThanOrEqual(1);
    expect(unbracketed(w.sim, extra[0])).toBe('');
  });

  it('labels are accessors: switching the catalogue between two calls changes the lines', () => {
    const c = column();
    step(c.w, 99);
    const before = cardLines(c.w.sim, c.medic);
    expect(before).toContain('On call');
    setCatalogue('xx', {
      ...en,
      'hud.card.formation.column.cp': 'COL {n}/{m}',
      'hud.card.formation.pace': 'PACE {pace} BY {unit}',
      'hud.card.formation.onCall': 'ONCALL',
      'selection.chip.formation.column.cp': 'CHIP {n} {k}/{m}',
    });
    const after = cardLines(c.w.sim, c.medic);
    expect(after).toContain('COL 1/4');
    expect(after).toContain('PACE 0.7 BY 60mm Mortar Team');
    expect(after).toContain('ONCALL');
    expect(after).not.toContain('On call');
    expect(chipStatus(c.w.sim, c.ids, 'inf_squad')).toBe('CHIP 3 1/4');
    setCatalogue('en', en);
    expect(cardLines(c.w.sim, c.medic)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe('M10: the arming (inert keys, the arm note)', () => {
  /** Two gunships: Column and Attack are open to them, the Ambush is inert (no ground to ring the zone). */
  function airRig(): { arming: ReturnType<typeof createFormationArming>; notes: string[]; retired: string[]; w: World } {
    const w = world();
    const sel = [0, 1].map((k) => spawn(w, w.t.heli, 0, 22 + k * 2, 40));
    const notes: string[] = [];
    const retired: string[] = [];
    const sink: OrderSink = { dispatch: () => undefined, note: (text) => notes.push(text), marker: () => undefined, deny: () => undefined };
    const arming = createFormationArming({
      row: (armed) => formationRow({ formationsOpen: true, units: formationUnitFacts(w.sim, sel) }, armed),
      ids: () => sel,
      world: simIntentWorld(w.sim, () => false),
      sink,
      open: () => true,
      onArmed: () => undefined,
      classOf: (i) => formationClassOfUnit(w.sim, i),
      retire: (text) => retired.push(text),
    });
    return { arming, notes, retired, w };
  }

  it('a press on an inert key says why and leaves the other armed formation armed', () => {
    const a = airRig();
    expect(a.arming.press('formationColumn' as never)).toBe('column');
    expect(a.notes).toEqual(['column — click open ground (Esc cancels)']);
    // Y: the ambush is inert for want of ground units.
    expect(a.arming.press('formationAmbush' as never)).toBeNull();
    expect(a.arming.armed()).toBe('column');
    expect(a.notes.at(-1)).toBe('Needs ground units to ring the zone');
    // The row's own button for it is the same answer.
    expect(a.arming.activate('ambush')).toBeNull();
    expect(a.arming.armed()).toBe('column');
    expect(a.notes).toHaveLength(3);
    // Nothing was taken back: the column's arm note is still the live promise.
    expect(a.retired).toEqual([]);
  });

  it('R, T and Y with no row at all post nothing', () => {
    const w = world();
    const one = [spawn(w, w.t.inf, 0, 22, 40)];
    const notes: string[] = [];
    const arming = createFormationArming({
      row: (armed) => formationRow({ formationsOpen: true, units: formationUnitFacts(w.sim, one) }, armed),
      ids: () => one,
      world: simIntentWorld(w.sim, () => false),
      sink: { dispatch: () => undefined, note: (t) => notes.push(t), marker: () => undefined, deny: () => undefined },
      open: () => true,
      onArmed: () => undefined,
      classOf: (i) => formationClassOfUnit(w.sim, i),
      retire: () => undefined,
    });
    for (const a of ['formationColumn', 'formationAttack', 'formationAmbush']) expect(arming.press(a as never)).toBeNull();
    for (const id of ['column', 'attack', 'ambush'] as const) expect(arming.activate(id)).toBeNull();
    expect(notes).toEqual([]);
  });

  it('the arm note is taken back on a spend, on a disarm, on a drag and when another formation replaces it', () => {
    const cases: { name: string; end: (a: ReturnType<typeof airRig>) => void; retired: string[] }[] = [
      { name: 'spend', end: (a) => void a.arming.spend(24.5, 20.5, false), retired: ['column — click open ground (Esc cancels)'] },
      { name: 'disarm', end: (a) => void a.arming.disarm(), retired: ['column — click open ground (Esc cancels)'] },
      { name: 'drag', end: (a) => void a.arming.drag(), retired: ['column — click open ground (Esc cancels)'] },
      { name: 'replaced', end: (a) => void a.arming.press('formationAttack' as never), retired: ['column — click open ground (Esc cancels)'] },
      { name: 'pressed again', end: (a) => void a.arming.press('formationColumn' as never), retired: ['column — click open ground (Esc cancels)'] },
    ];
    expect(cases).toHaveLength(5);
    for (const c of cases) {
      const a = airRig();
      a.arming.press('formationColumn' as never);
      expect(a.retired, c.name).toEqual([]);
      c.end(a);
      expect(a.retired, c.name).toEqual(c.retired);
    }
    // A disarm with nothing armed takes nothing back.
    const idle = airRig();
    expect(idle.arming.disarm()).toBe(false);
    expect(idle.retired).toEqual([]);
  });

  it('the HUD takes a retired note off the feed: gone from the live lines, and a note that left already is a no-op', () => {
    const w = world();
    const r = rigFor(w.sim, () => []);
    const live = (): string[] => [...r.host.querySelectorAll('.rl-feed .rl-notice:not(.rl-leave)')].map((n) => n.textContent ?? '');
    r.hud.note('column — click open ground (Esc cancels)', 'info');
    r.hud.note('another line', 'info');
    expect(live()).toEqual(['another line', 'column — click open ground (Esc cancels)']);
    r.hud.retireNote('column — click open ground (Esc cancels)', 'info');
    expect(live()).toEqual(['another line']);
    r.hud.retireNote('column — click open ground (Esc cancels)', 'info');
    r.hud.retireNote('never posted', 'info');
    expect(live()).toEqual(['another line']);
    // The tone is part of the line's identity: a different tone is a different line.
    r.hud.note('same words', 'mute');
    r.hud.retireNote('same words', 'info');
    expect(live()).toEqual(['same words', 'another line']);
  });
});

describe('M5: the cursor and the click count classed units alike', () => {
  const point = (x: number, y: number): PointerPoint =>
    ({ ground: { x, y }, x, y, hostile: -1, hostileAt: null, facade: -1, wounded: -1, woundedAt: null }) as unknown as PointerPoint;
  it('a wounded soldier has no formation class, so a squad and a wounded man are too few: the cursor reads the plain move', () => {
    const w = world();
    const wounded = w.sim.addUnitType(U.wounded_kdf);
    const squad = spawn(w, w.t.inf, 0, 22, 40);
    const man = spawn(w, wounded, 0, 24, 40);
    const squad2 = spawn(w, w.t.inf, 0, 26, 40);
    expect([squad, man].map((i) => formationClassOfUnit(w.sim, i))).toEqual([3, 255]);
    const world_ = simIntentWorld(w.sim, () => false);
    const read = (ids: number[]) =>
      cursorAt(w.sim, world_, point(24.5, 20.5), { ids, armed: null, confirm: false, armedSmoke: false, armedFormation: { id: 'column', ids, open: true } }).res.intents[0];
    expect(read([squad, man])).not.toHaveProperty('formation');
    expect(read([squad, squad2])).toHaveProperty('formation', 'column');
  });

  it('main.ts wires the arming to the HUD\'s retireNote, the sim\'s class, and the routed filter', () => {
    const src = readFileSync(resolve(__dirname, '../main.ts'), 'utf8');
    const at = src.indexOf('createFormationArming({');
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, at + 1400);
    expect(block).toContain('classOf: (i) => formationClassOfUnit(sim, i)');
    expect(block).toContain('retire: (text, tone) => hud.retireNote(text, tone)');
    expect(src).toContain('(i) => sim.state.routed[i] === 1');
  });
});

describe('M5: the row counts what the sim will gather', () => {
  it('a routed unit is not free: two squads, one routed, leave every button inert with the minimum named', () => {
    const w = world();
    const a = spawn(w, w.t.inf, 0, 22, 40);
    const b = spawn(w, w.t.inf, 0, 24, 40);
    expect(formationUnitFacts(w.sim, [a, b]).map((f) => f.free)).toEqual([true, true]);
    w.sim.state.routed[b] = 1;
    expect(formationUnitFacts(w.sim, [a, b]).map((f) => f.free)).toEqual([true, false]);
    const row = formationRow({ formationsOpen: true, units: formationUnitFacts(w.sim, [a, b]) }, null);
    expect(row.map((v) => [v.inert, v.reasonKey, v.reasonParams])).toEqual([
      [true, 'hud.formation.inert.needsMin', { n: 2 }],
      [true, 'hud.formation.inert.needsMin', { n: 2 }],
      [true, 'hud.formation.inert.needsMin', { n: 2 }],
    ]);
  });
});

describe('M10: the reason names the formation\'s own minimum', () => {
  it('"Needs 2 free units" in the tooltip of an inert button, and a plural for one', () => {
    const w = world();
    const garrisoned = spawn(w, w.t.inf, 0, 22, 40);
    const free = spawn(w, w.t.inf, 0, 24, 40);
    w.sim.state.garrisonedIn[garrisoned] = 0;
    const r = rigFor(w.sim, () => [garrisoned, free]);
    const btn = r.host.querySelector<HTMLButtonElement>('[data-formation="column"]')!;
    expect(btn.dataset.inert).toBe('1');
    btn.dispatchEvent(new MouseEvent('mouseenter'));
    expect(r.host.querySelector('.rl-tip')?.textContent).toContain('Needs 2 free units');
    // The plural is the catalogue's own (ICU), so one unit reads the singular.
    expect(t('hud.formation.inert.needsMin', { n: 1 })).toBe('Needs 1 free unit');
    expect(t('hud.formation.inert.needsMin', { n: 3 })).toBe('Needs 3 free units');
  });
});
