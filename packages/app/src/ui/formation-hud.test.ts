// @vitest-environment jsdom
//
// GH-859 P1a Task 8: the formation row, its tooltip, the armed state, the cursor, the card and chip
// lines and the alert, in the DOM and over a real `Sim`. Oracles are literals; the Hud is the real
// class, the sim is real, and the only fakes are the sink that records what the click queued and
// the key bindings' event shape.
//
// `main.ts` is not importable here, so "the keys arm nothing in a versus room" is seen where it can
// be: `resolveKey` turns the event into the action the keydown `case` receives, and
// `FormationArming.press` is the call that `case` makes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formations, units } from '@lions/data';
import { Sim, fx, type Command, type UnitTypeJson } from '@lions/sim';
import { Hud, type HudCommanderInfo, type HudDeps } from './hud';
import { closeTip } from './tooltip';
import { formationRow } from './formation-model';
import { formationUnitFacts } from './formation-sim';
import { anyArmed, bindingsFrom, escapeTarget, resolveKey } from '../input/keymap';
import { createFormationArming, type FormationArming } from '../input/formation-arming';
import { formationIds } from '../input/formation';
import { applyIntent, type OrderSink, type PlayerIntent } from '../input/intents';
import { cursorAt, simIntentWorld, type PointerPoint } from '../input/pointer';
import { pseudo } from '../i18n/pseudo';
import { setCatalogue } from '../i18n/t';
import en from '../i18n/en.json';

const COMMANDER: HudCommanderInfo = {
  shai: { name: 'Shai Hammai', plate: 'Hammai', rank: 'Captain', stars: 2 },
  idit: { name: 'Idit Zohar', plate: 'Zohar' },
};

const madeHuds: Hud[] = [];
afterEach(() => {
  closeTip();
  for (const h of madeHuds.splice(0)) h.destroy();
  setCatalogue('en', en);
});

const KEY = (action: string): string => ({ formationColumn: 'R', formationAttack: 'T', formationAmbush: 'Y' })[action] ?? action;

interface Force {
  sim: Sim;
  squads: number[];
  namer: number;
  medic: number;
  types: { inf: number; ifv: number; foe: number };
}

/** Three rifle squads, an IFV and a medic squad on one 48 x 48 field, formations registered as `main.ts` does. */
function makeForce(): Force {
  const sim = new Sim({ seed: 0x859, width: 48, height: 48, capacity: 64 });
  const inf = sim.addUnitType(units.inf_squad as unknown as UnitTypeJson);
  const ifv = sim.addUnitType(units.ifv_namer as unknown as UnitTypeJson);
  const med = sim.addUnitType(units.inf_medic_squad as unknown as UnitTypeJson);
  // An unarmed enemy: it springs a trap and draws fire, and shoots at nobody.
  const foe = sim.addUnitType({ ...(units.inf_squad as unknown as UnitTypeJson), id: 'fh_dummy', weapons: [], abilities: [] });
  for (const f of formations) sim.addFormationType(f);
  const at = (n: number): number => fx.from(n + 0.5);
  const squads = [0, 1, 2].map((k) => sim.spawn(inf, 0, at(22 + k), at(40)));
  const namer = sim.spawn(ifv, 0, at(26), at(40));
  const medic = sim.spawn(med, 0, at(27), at(40));
  return { sim, squads, namer, medic, types: { inf, ifv, foe } };
}

interface Rig {
  hud: Hud;
  host: HTMLElement;
  paint: () => void;
  row: HTMLElement | null;
  btn: (id: string) => HTMLButtonElement;
  tip: () => HTMLElement | null;
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
    keyFor: KEY,
    portrait: () => null,
    ...over,
  });
  madeHuds.push(hud);
  const paint = (): void => {
    for (let i = 0; i < 5; i++) hud.onTick();
  };
  paint();
  return {
    hud,
    host,
    paint,
    get row() {
      return host.querySelector<HTMLElement>('.rl-orders--formation');
    },
    btn: (id) => {
      const b = host.querySelector<HTMLButtonElement>(`[data-formation="${id}"]`);
      if (b === null) throw new Error(`no ${id} button`);
      return b;
    },
    tip: () => host.querySelector<HTMLElement>('.rl-tip'),
  };
}

const hover = (el: HTMLElement): void => {
  el.dispatchEvent(new MouseEvent('mouseenter'));
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

describe('the formation row', () => {
  it('renders for a mixed selection: the tag, three buttons, glyphs carrying their family', () => {
    const f = makeForce();
    const r = rigFor(f.sim, () => [...f.squads, f.namer]);
    expect(r.row).not.toBeNull();
    expect(r.row?.style.display).toBe('');
    expect(r.row?.querySelector('.rl-orders__tag')?.textContent).toBe('Formation');
    expect([...r.row!.querySelectorAll('button')].map((b) => b.dataset.formation)).toEqual(['column', 'attack', 'ambush']);
    for (const [id, family] of [['column', 'manoeuvre'], ['attack', 'offensive'], ['ambush', 'control']] as const) {
      const glyph = r.btn(id).querySelector<HTMLElement>('.rl-order__glyph');
      expect(glyph?.dataset.family).toBe(family);
      expect(glyph?.querySelector(`svg[data-symbol="formation-${id}"]`)).not.toBeNull();
    }
    expect(r.btn('column').textContent).toBe('Column R');
    expect(r.btn('attack').textContent).toBe('Attack T');
    expect(r.btn('ambush').textContent).toBe('Ambush Y');
    expect(['column', 'attack', 'ambush'].map((id) => r.btn(id).dataset.inert)).toEqual(['0', '0', '0']);
    // The row sits above the order row.
    const sel = r.row!.parentElement!;
    expect([...sel.children].indexOf(r.row!)).toBeLessThan([...sel.children].indexOf(sel.querySelector('.rl-orders:not(.rl-orders--formation)')!));
  });

  it('is absent for one unit, and for nobody', () => {
    const f = makeForce();
    expect(rigFor(f.sim, () => [f.squads[0]]).row?.style.display).toBe('none');
    expect(rigFor(f.sim, () => []).row?.style.display).toBe('none');
  });

  it('goes away when the selection empties or shrinks to one, and comes back', () => {
    const f = makeForce();
    let sel = [...f.squads];
    const r = rigFor(f.sim, () => sel);
    expect(r.row?.style.display).toBe('');
    sel = [];
    r.paint();
    expect(r.row?.style.display).toBe('none');
    sel = [...f.squads];
    r.paint();
    expect(r.row?.style.display).toBe('');
    sel = [f.squads[0]];
    r.paint();
    expect(r.row?.style.display).toBe('none');
  });

  it('shows the tooltip on hover: one mark per unit, a legend that reads the counts, the composed lines', () => {
    const f = makeForce();
    const r = rigFor(f.sim, () => [...f.squads, f.namer, f.medic]);
    hover(r.btn('attack'));
    const tip = r.tip()!;
    expect(tip.hidden).toBe(false);
    expect(tip.classList.contains('rl-tip--formation')).toBe(true);
    expect(tip.querySelector('.rl-tip__name')?.textContent).toBe('Attack');
    // 3 rifle squads + 1 IFV + 1 medic squad = 5 marks (the ones scaled 1.3 are the units).
    expect(tip.querySelectorAll('.rl-formtip__svg g[transform$="scale(1.3)"]')).toHaveLength(5);
    const legend = [...tip.querySelectorAll('.rl-formtip__legend li')].map((li) => li.textContent);
    expect(legend).toEqual(['Armour1', 'Infantry3', 'Medic1', 'Your click']);
    expect(tip.textContent).toContain('Faces the approach. Then press on, fighting.');
    // A tooltip of another button replaces it and the formation width goes with it.
    hover(r.btn('ambush'));
    expect(tip.querySelector('.rl-tip__name')?.textContent).toBe('Ambush');
    expect(tip.textContent).toContain('Faces inward. Springs together on contact. Ring radius grows with the force.');
    expect(tip.querySelectorAll('.rl-formtip__legend li')[tip.querySelectorAll('.rl-formtip__legend li').length - 1]?.textContent).toBe('Kill zone');
  });

  it('draws a ground medic vehicle as the Ambulance in the legend, a medic squad as the Medic', () => {
    const f = makeForce();
    const amb = f.sim.addUnitType(units.veh_ambulance as unknown as UnitTypeJson);
    const a = f.sim.spawn(amb, 0, fx.from(28.5), fx.from(40.5));
    const r = rigFor(f.sim, () => [f.squads[0], f.medic, a]);
    hover(r.btn('column'));
    expect([...r.tip()!.querySelectorAll('.rl-formtip__legend li')].map((li) => li.textContent)).toEqual(['Infantry1', 'Medic1', 'Ambulance1']);
  });

  it('marks the armed formation, and only it', () => {
    const f = makeForce();
    let armed: 'column' | 'attack' | 'ambush' | null = 'attack';
    const r = rigFor(f.sim, () => f.squads, { armedFormation: () => armed });
    expect(['column', 'attack', 'ambush'].map((id) => r.btn(id).dataset.armed)).toEqual(['0', '1', '0']);
    armed = null;
    r.paint();
    expect(['column', 'attack', 'ambush'].map((id) => r.btn(id).dataset.armed)).toEqual(['0', '0', '0']);
  });

  it('dims a formation the selection cannot form, with the reason in its tooltip', () => {
    const f = makeForce();
    // Two selected, one of them garrisoned: a single free unit, so every button needs a second.
    f.sim.state.garrisonedIn[f.squads[1]] = 0;
    const r = rigFor(f.sim, () => [f.squads[0], f.squads[1]]);
    expect(['column', 'attack', 'ambush'].map((id) => r.btn(id).dataset.inert)).toEqual(['1', '1', '1']);
    hover(r.btn('column'));
    expect(r.tip()!.textContent).toContain('Needs two free units');
  });

  it('dims the ambush alone when no free unit can ring the zone', () => {
    const f = makeForce();
    const r = rigFor(f.sim, () => [f.medic, f.namer]);
    // medic squad + IFV: the IFV is armour, a ring class -- so ambush stays live here.
    expect(r.btn('ambush').dataset.inert).toBe('0');
    const air = f.sim.addUnitType(units.air_medevac_heli as unknown as UnitTypeJson);
    const h1 = f.sim.spawn(air, 0, fx.from(30.5), fx.from(40.5));
    const h2 = f.sim.spawn(air, 0, fx.from(31.5), fx.from(40.5));
    const r2 = rigFor(f.sim, () => [h1, h2]);
    expect(r2.btn('ambush').dataset.inert).toBe('1');
    expect(r2.btn('column').dataset.inert).toBe('0');
    hover(r2.btn('ambush'));
    expect(r2.tip()!.textContent).toContain('Needs ground units to ring the zone');
  });

  it('versus: the row draws with every button inert and the versus reason, and a click only asks the handler', () => {
    const f = makeForce();
    const calls: string[] = [];
    const r = rigFor(f.sim, () => [...f.squads, f.namer], {
      formationsOpen: () => false,
      formations: { column: () => calls.push('column'), attack: () => calls.push('attack'), ambush: () => calls.push('ambush') },
    });
    expect(r.row?.style.display).toBe('');
    expect(['column', 'attack', 'ambush'].map((id) => r.btn(id).dataset.inert)).toEqual(['1', '1', '1']);
    for (const id of ['column', 'attack', 'ambush']) {
      hover(r.btn(id));
      expect(r.tip()!.textContent).toContain('Formations are not in versus rooms yet');
    }
    r.btn('attack').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls).toEqual(['attack']);
  });

  it('shows no unbracketed word under the pseudo-locale: row, tooltip, card line and chip', () => {
    const f = makeForce();
    setCatalogue('pseudo', en, pseudo);
    // A key cap of digits, so the keys themselves are not words this check should judge.
    const r = rigFor(f.sim, () => [...f.squads, f.namer, f.medic], { keyFor: () => '1' });
    const words = (root: Element): string[] => textsOf(root).filter((t) => /[A-Za-z]/.test(t.replace(/⟦[^⟧]*⟧/g, '')));
    expect(words(r.row!)).toEqual([]);
    expect(textsOf(r.row!).filter((t) => t.includes('⟦')).length).toBeGreaterThanOrEqual(4); // tag + three labels
    for (const id of ['column', 'attack', 'ambush']) {
      hover(r.btn(id));
      expect(words(r.tip()!)).toEqual([]);
      expect(textsOf(r.tip()!).some((t) => t.includes('⟦'))).toBe(true);
    }
    // A card line and a chip line, from a real ambush.
    const w = makeForce();
    w.sim.queueCommand({ kind: 'move', ids: w.squads, x: fx.from(24.5), y: fx.from(24.5), formation: 'ambush' });
    w.sim.tick();
    const card = rigFor(w.sim, () => [w.squads[0]], { keyFor: () => '1' });
    const cond = card.host.querySelector('.rl-card__cond')!;
    expect(cond.textContent).toContain('⟦');
    expect(words(cond)).toEqual([]);
    const chips = rigFor(w.sim, () => w.squads, { keyFor: () => '1' });
    const status = chips.host.querySelector('.rl-chip__status')!;
    expect(status.textContent).toContain('⟦');
    expect(words(status)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the card and the chip', () => {
  /** Three squads ordered into an ambush at (24, 24) from (22..24, 40). */
  function ambushing(): Force {
    const f = makeForce();
    f.sim.queueCommand({ kind: 'move', ids: f.squads, x: fx.from(24.5), y: fx.from(24.5), formation: 'ambush' });
    return f;
  }
  const settle = (f: Force): void => {
    for (let t = 0; t < 600 && f.squads.some((id) => f.sim.state.moving[id] === 1 || t < 2); t++) f.sim.tick();
  };

  it('an ambush member reads "Moving to the ambush" on the march and "Ambush set - springs together" after arrival', () => {
    const f = ambushing();
    f.sim.tick();
    f.sim.tick();
    const r = rigFor(f.sim, () => [f.squads[0]]);
    const cond = (): string => r.host.querySelector('.rl-card__cond')?.textContent ?? '';
    expect(cond()).toContain('Moving to the ambush');
    expect(cond()).not.toContain('springs together');
    settle(f);
    expect(f.sim.state.moving[f.squads[0]]).toBe(0);
    r.paint();
    expect(cond()).toContain('Ambush set — springs together');
    expect(cond()).toContain('Ring radius 3');
    expect(cond()).not.toContain('Moving to the ambush');
  });

  it('a column or attack member says so, and a unit in no formation says nothing of the kind', () => {
    const f = makeForce();
    f.sim.queueCommand({ kind: 'move', ids: f.squads, x: fx.from(24.5), y: fx.from(24.5), formation: 'column' });
    f.sim.tick();
    expect(rigFor(f.sim, () => [f.squads[0]]).host.querySelector('.rl-card__cond')?.textContent).toContain('In column');
    f.sim.queueCommand({ kind: 'attackMove', ids: f.squads, x: fx.from(24.5), y: fx.from(20.5), formation: 'attack' });
    f.sim.tick();
    expect(rigFor(f.sim, () => [f.squads[0]]).host.querySelector('.rl-card__cond')?.textContent).toContain('In attack formation');
    const lone = rigFor(f.sim, () => [f.namer]);
    expect(lone.host.querySelector('.rl-card__cond')?.textContent).not.toMatch(/column|formation|ambush/i);
  });

  it('the chip reads "3 in ambush"', () => {
    const f = ambushing();
    f.sim.tick();
    f.sim.tick();
    const r = rigFor(f.sim, () => [...f.squads, f.namer]);
    const chip = r.host.querySelector<HTMLElement>('.rl-chip[data-type="inf_squad"] .rl-chip__status');
    expect(chip?.textContent).toBe('3 in ambush');
    // The IFV never joined: it keeps its own status.
    expect(r.host.querySelector('.rl-chip[data-type="ifv_namer"] .rl-chip__status')?.textContent).not.toContain('ambush');
  });

  it('a sprung ring reads "Ambush sprung" on the card (the sim state the card copies is really 4)', () => {
    const f = ambushing();
    settle(f);
    const foe = f.sim.spawn(f.types.foe, 1, fx.from(24.5), fx.from(3.5));
    f.sim.queueCommand({ kind: 'move', ids: [foe], x: fx.from(24.5), y: fx.from(19.5) });
    const r = rigFor(f.sim, () => [f.squads[1]]);
    expect(r.host.querySelector('.rl-card__cond')?.textContent).toContain('springs together');
    let sprung = false;
    for (let t = 0; t < 600 && !sprung; t++) {
      for (const e of f.sim.tick()) if (e.kind === 'formationSprung') sprung = true;
    }
    expect(sprung, 'the trap springs').toBe(true);
    f.sim.tick();
    expect(f.sim.formationStateOfGroup(f.sim.formationGroupOf(f.squads[1]))).toBe(4);
    r.paint();
    expect(r.host.querySelector('.rl-card__cond')?.textContent).toContain('Ambush sprung');
    expect(r.host.querySelector('.rl-card__cond')?.textContent).not.toContain('springs together');
  });

  it('a member the ring does not take (an aircraft) has no ambush line on its card', () => {
    const f = makeForce();
    const air = f.sim.addUnitType(units.air_medevac_heli as unknown as UnitTypeJson);
    const hs = [0, 1].map((k) => f.sim.spawn(air, 0, fx.from(30.5 + k), fx.from(40.5)));
    f.sim.queueCommand({ kind: 'move', ids: hs, x: fx.from(30.5), y: fx.from(30.5), formation: 'ambush' });
    for (let t = 0; t < 400 && hs.some((h) => f.sim.state.moving[h] === 1 || t < 2); t++) f.sim.tick();
    expect(f.sim.formationGroupOf(hs[0])).toBeGreaterThanOrEqual(0);
    const r = rigFor(f.sim, () => [hs[0]]);
    expect(r.host.querySelector('.rl-card__cond')?.textContent ?? '').not.toMatch(/ambush/i);
  });

  it('an enemy in a formation is not the viewer\'s to read', () => {
    const f = makeForce();
    const foes = [0, 1].map((k) => f.sim.spawn(f.types.foe, 1, fx.from(30.5 + k), fx.from(40.5)));
    f.sim.queueCommand({ kind: 'move', ids: foes, x: fx.from(30.5), y: fx.from(30.5), formation: 'column' });
    f.sim.tick();
    expect(f.sim.formationGroupOf(foes[0])).toBeGreaterThanOrEqual(0);
    const r = rigFor(f.sim, () => [foes[0]]);
    expect(r.host.querySelector('.rl-card__cond')?.textContent ?? '').not.toContain('In column');
  });
});

// ---------------------------------------------------------------------------------------------
describe('arming, the cursor and the click', () => {
  /** The arming over a real sim, with a sink that records and a HUD wired to it as `main.ts` wires it. */
  function armingRig(open = true, f = makeForce()): {
    f: Force;
    arming: FormationArming;
    r: Rig;
    notes: string[];
    denies: number[];
    intents: PlayerIntent[];
    commands: Command[];
  } {
    const notes: string[] = [];
    const denies: number[] = [];
    const intents: PlayerIntent[] = [];
    const commands: Command[] = [];
    const real = f.sim.queueCommand.bind(f.sim);
    f.sim.queueCommand = (c) => {
      commands.push(c);
      real(c);
    };
    const selection = [...f.squads, f.namer];
    const sink: OrderSink = {
      dispatch: (i) => {
        intents.push(i);
        applyIntent({ queueCommand: (c: Command) => f.sim.queueCommand(c) } as never, i, f.sim);
      },
      note: (text) => notes.push(text),
      marker: () => undefined,
      deny: () => denies.push(1),
    };
    const world = simIntentWorld(f.sim, () => false);
    const arming = createFormationArming({
      row: (armed) => formationRow({ formationsOpen: open, units: formationUnitFacts(f.sim, selection) }, armed),
      ids: () => formationIds(selection, (i) => f.sim.state.garrisonedIn[i] >= 0, (i) => f.sim.state.carriedBy[i] >= 0, (i) => f.sim.state.tunnelIn[i] >= 0),
      world,
      sink,
      open: () => open,
      onArmed: () => undefined,
    });
    const r = rigFor(f.sim, () => selection, {
      formationsOpen: () => open,
      armedFormation: () => arming.armed(),
      formations: { column: () => arming.activate('column'), attack: () => arming.activate('attack'), ambush: () => arming.activate('ambush') },
    });
    return { f, arming, r, notes, denies, intents, commands };
  }
  const key = (k: string): string | null => resolveKey(bindingsFrom({}), { key: k, ctrlKey: false, metaKey: false });
  const point = (x: number, y: number): PointerPoint =>
    ({ ground: { x, y }, x, y, hostile: -1, hostileAt: null, facade: -1, wounded: -1, woundedAt: null }) as unknown as PointerPoint;

  it('T arms the attack: the button lights, the feed note shows, and the cursor is formationAttack', () => {
    const a = armingRig();
    expect(key('t')).toBe('formationAttack');
    expect(a.arming.press('formationAttack' as never)).toBe('attack');
    a.r.paint();
    expect(a.r.btn('attack').dataset.armed).toBe('1');
    expect(a.r.btn('column').dataset.armed).toBe('0');
    expect(a.notes).toEqual(['attack formation — click the objective (Esc cancels)']);
    const world = simIntentWorld(a.f.sim, () => false);
    const read = cursorAt(a.f.sim, world, point(24.5, 24.5), {
      ids: [...a.f.squads, a.f.namer],
      armed: null,
      confirm: false,
      armedSmoke: false,
      armedFormation: { id: 'attack', ids: [...a.f.squads, a.f.namer], open: true },
    });
    expect(read.key).toBe('formationAttack');
    // Over rock: the same refusal the click makes.
    a.f.sim.setBlocked(30, 30, true);
    expect(cursorAt(a.f.sim, world, point(30.5, 30.5), { ids: [...a.f.squads], armed: null, confirm: false, armedSmoke: false, armedFormation: { id: 'attack', ids: [...a.f.squads], open: true } }).key).toBe('blocked');
  });

  it('R and Y arm the column and the ambush; pressing the armed key again puts it down', () => {
    const a = armingRig();
    expect(a.arming.press('formationColumn' as never)).toBe('column');
    expect(a.arming.press('formationAmbush' as never)).toBe('ambush');
    expect(a.arming.armed()).toBe('ambush');
    expect(a.arming.press('formationAmbush' as never)).toBeNull();
    expect(a.arming.armed()).toBeNull();
  });

  it('a map click queues exactly one attackMove carrying formation attack, and disarms', () => {
    const a = armingRig();
    a.arming.press('formationAttack' as never);
    const res = a.arming.spend(24.5, 24.5, false);
    expect(res?.intents).toHaveLength(1);
    expect(a.arming.armed()).toBeNull();
    const queued = a.commands.filter((c) => c.kind === 'attackMove' || c.kind === 'move');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ kind: 'attackMove', formation: 'attack', ids: [...a.f.squads, a.f.namer] });
    // Disarmed: a second click is not an order.
    expect(a.arming.spend(20.5, 20.5, false)).toBeNull();
    expect(a.commands.filter((c) => c.kind === 'attackMove')).toHaveLength(1);
  });

  it('Escape disarms with nothing queued (anyArmed sees it, escapeTarget disarms)', () => {
    const a = armingRig();
    a.arming.press('formationAmbush' as never);
    expect(anyArmed(null, null, null, null, a.arming.armed())).toBe(true);
    expect(escapeTarget(false, false, anyArmed(null, null, null, null, a.arming.armed()))).toBe('disarm');
    expect(a.arming.disarm()).toBe(true);
    expect(anyArmed(null, null, null, null, a.arming.armed())).toBe(false);
    expect(a.commands).toEqual([]);
    expect(a.arming.disarm()).toBe(false);
  });

  it('a click after the force shrank to one degrades to the plain order, says so, and sounds the deny cue', () => {
    const a = armingRig();
    a.arming.press('formationColumn' as never);
    // Two of the three squads and the IFV go inside a building before the click.
    for (const i of [a.f.squads[1], a.f.squads[2], a.f.namer]) a.f.sim.state.garrisonedIn[i] = 0;
    a.arming.spend(24.5, 24.5, false);
    const queued = a.commands.filter((c) => c.kind === 'move');
    expect(queued).toHaveLength(1);
    expect(queued[0]).not.toHaveProperty('formation');
    expect(a.notes.at(-1)).toBe('Too few free units for a formation — the order goes without one');
    expect(a.denies).toHaveLength(1);
  });

  it('VERSUS: the keys arm nothing and no click can queue a formation order', () => {
    const a = armingRig(false);
    for (const k of ['r', 't', 'y']) {
      const action = key(k);
      expect(action).not.toBeNull();
      expect(a.arming.press(action as never)).toBeNull();
      expect(a.arming.armed()).toBeNull();
    }
    expect(a.notes).toEqual(Array(3).fill('Formations are not in versus rooms yet'));
    // The row's buttons go the same way.
    for (const id of ['column', 'attack', 'ambush'] as const) expect(a.arming.activate(id)).toBeNull();
    expect(a.arming.spend(24.5, 24.5, false)).toBeNull();
    expect(a.commands).toEqual([]);
    expect(a.intents).toEqual([]);
    // And the cursor, asked as though one were armed, is the plain pointer: nothing would be sent.
    const world = simIntentWorld(a.f.sim, () => false);
    const read = cursorAt(a.f.sim, world, point(24.5, 24.5), {
      ids: [...a.f.squads],
      armed: null,
      confirm: false,
      armedSmoke: false,
      armedFormation: { id: 'attack', ids: [...a.f.squads], open: false },
    });
    expect(read.res.intents).toEqual([]);
    expect(read.name).toBe('default');
  });

  it('VERSUS, defence in depth: even an armed formation whose room is closed at the click queues nothing', () => {
    const f = makeForce();
    const commands: Command[] = [];
    const sel = [...f.squads];
    const arming = createFormationArming({
      row: (armed) => formationRow({ formationsOpen: true, units: formationUnitFacts(f.sim, sel) }, armed),
      ids: () => sel,
      world: simIntentWorld(f.sim, () => false),
      sink: { dispatch: (i) => commands.push(i as never), note: () => undefined, marker: () => undefined, deny: () => undefined },
      open: () => false,
      onArmed: () => undefined,
    });
    expect(arming.activate('attack')).toBe('attack');
    expect(arming.spend(24.5, 24.5, false)?.intents).toEqual([]);
    expect(commands).toEqual([]);
  });

  it('a box-select drag puts the armed formation down, so the next click is a plain selecting click', () => {
    const a = armingRig();
    expect(a.arming.press('formationColumn' as never)).toBe('column');
    expect(a.arming.drag()).toBe(true);
    expect(a.arming.armed()).toBeNull();
    // The click that follows spends nothing: no formation order is queued with the box's selection.
    expect(a.arming.spend(24.5, 24.5, false)).toBeNull();
    expect(a.commands).toEqual([]);
    // A drag with nothing armed is a no-op and reports it.
    expect(a.arming.drag()).toBe(false);
  });

  it('main.ts calls drag() in the box-select branch, before the selection is replaced', () => {
    const src = readFileSync(resolve(__dirname, '../main.ts'), 'utf8');
    const at = src.indexOf("via: 'box'");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(Math.max(0, at - 700), at)).toContain('formationArming.drag()');
  });

  it('with fewer than two placeable units a key says so and arms nothing', () => {
    const f = makeForce();
    const notes: string[] = [];
    const arming = createFormationArming({
      row: (armed) => formationRow({ formationsOpen: true, units: formationUnitFacts(f.sim, [f.squads[0]]) }, armed),
      ids: () => [f.squads[0]],
      world: simIntentWorld(f.sim, () => false),
      sink: { dispatch: () => undefined, note: (t) => notes.push(t), marker: () => undefined, deny: () => undefined },
      open: () => true,
      onArmed: () => undefined,
    });
    expect(arming.press('formationColumn' as never)).toBeNull();
    expect(notes).toEqual(['Needs two free units']);
  });
});
