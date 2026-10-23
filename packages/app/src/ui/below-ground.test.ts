// @vitest-environment jsdom
/**
 * GH-681: the "Below ground" strip, over a REAL `Sim`: one chip per own unit
 * inside a route with its arrival time, the two vent orders disabled with the
 * reason while it crawls, and enabled -- through the same `applyIntent` a
 * click uses -- once it is at the vent. It never lists the other side.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { applyIntent } from '../input/intents';
import { belowGroundChips, mountBelowGround, routeLabel, ventOffer, type BelowGroundStrip } from './below-ground';

const RIFLE: UnitTypeJson = {
  id: 'bg_rifle',
  name: 'Rifles',
  role: 'infantry',
  hull: { hp: 20000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};

/** Mouth (4,6), vent (14,6): 10 tiles, 400 ticks (20 s) at 0.5 tiles/s. */
function world() {
  const sim = new Sim({ seed: 5, width: 30, height: 12, capacity: 16, humanHeld: [true, true] });
  const route = sim.addTunnel({ id: 'bg_s_west', points: [[4, 6], [14, 6]], dig_tiles_per_s: 1, pre_dug: true, side: 1 });
  const rifle = sim.addUnitType(RIFLE);
  const mine = sim.spawn(rifle, 1, fx.from(4.5), fx.from(6.5));
  const theirs = sim.spawn(rifle, 0, fx.from(25.5), fx.from(2.5));
  return { sim, route, mine, theirs };
}

let strip: BelowGroundStrip | null = null;
afterEach(() => {
  strip?.dispose();
  strip = null;
  document.body.replaceChildren();
});

function mount(sim: Sim, viewer: number) {
  const s = mountBelowGround(document.body, {
    state: () => sim.state,
    entityCount: () => sim.entityCount,
    viewer,
    routeId: () => 'bg_s_west',
    typeOf: (id) => sim.unitTypes[sim.state.typeIdx[id]].id,
    nameOf: () => 'Rifles',
    iconOf: () => null,
    vent: (ids, mode) => applyIntent(sim, { kind: 'vent', ids, mode }, sim),
  });
  strip = s;
  const q = <T extends Element>(sel: string): T => {
    const el = s.root.querySelector<T>(sel);
    if (!el) throw new Error(`no ${sel}`);
    return el;
  };
  return { s, q };
}

describe('the Below ground strip (GH-681)', () => {
  it('shows nothing, and stays hidden, while nobody is below', () => {
    const { sim } = world();
    const { s } = mount(sim, 1);
    expect(s.root.hidden).toBe(true);
    expect(s.root.querySelectorAll('.rl-below__chip')).toHaveLength(0);
  });

  it('a unit crawling: one chip with its route and arrival time, the vents off with the reason', () => {
    const { sim, route, mine } = world();
    sim.queueCommand({ kind: 'enterTunnel', ids: [mine], tunnel: route });
    for (let t = 0; t < 40 && sim.state.tunnelIn[mine] < 0; t++) sim.tick();
    expect(sim.state.tunnelIn[mine]).toBe(route);
    const { s, q } = mount(sim, 1);
    expect(s.root.hidden).toBe(false);
    const chips = s.root.querySelectorAll<HTMLButtonElement>('.rl-below__chip');
    expect(chips).toHaveLength(1);
    expect(q('.rl-below__route').textContent).toBe('West tunnel');
    expect(q('.rl-below__eta').textContent).toBe('20 s to the vent');
    chips[0].click();
    expect([...s.selected]).toEqual([mine]);
    expect(q<HTMLButtonElement>('.rl-below__raid').disabled).toBe(true);
    expect(q<HTMLButtonElement>('.rl-below__exit').disabled).toBe(true);
    expect(q('.rl-below__why').textContent).toBe('Still crawling: the first arrives in 20 s');
  });

  it('at the vent: Vent: raid brings it up through the order path, and the chip goes', () => {
    const { sim, route, mine } = world();
    sim.queueCommand({ kind: 'enterTunnel', ids: [mine], tunnel: route });
    for (let t = 0; t < 40 && sim.state.tunnelIn[mine] < 0; t++) sim.tick();
    for (let t = 0; t < 400; t++) sim.tick();
    expect(sim.state.tunnelEta[mine]).toBe(0);
    const { s, q } = mount(sim, 1);
    expect(q('.rl-below__eta').textContent).toBe('at the vent');
    q<HTMLButtonElement>('.rl-below__chip').click();
    const raid = q<HTMLButtonElement>('.rl-below__raid');
    expect(raid.disabled).toBe(false);
    raid.click();
    sim.tick();
    expect(sim.state.tunnelIn[mine]).toBe(-1);
    s.update();
    expect(s.root.hidden).toBe(true);
    expect(s.selected.size).toBe(0);
  });

  it('a selected unit that dies below leaves the selection and the strip', () => {
    const { sim, route, mine } = world();
    sim.queueCommand({ kind: 'enterTunnel', ids: [mine], tunnel: route });
    for (let t = 0; t < 40 && sim.state.tunnelIn[mine] < 0; t++) sim.tick();
    const { s, q } = mount(sim, 1);
    q<HTMLButtonElement>('.rl-below__chip').click();
    expect(s.selected.has(mine)).toBe(true);
    sim.debugCollapseTunnel(route);
    sim.tick();
    s.update();
    expect(s.selected.size).toBe(0);
    expect(s.root.hidden).toBe(true);
  });

  it('never lists the other side\'s buried units', () => {
    const { sim, route, mine } = world();
    sim.queueCommand({ kind: 'enterTunnel', ids: [mine], tunnel: route });
    for (let t = 0; t < 40 && sim.state.tunnelIn[mine] < 0; t++) sim.tick();
    expect(belowGroundChips(sim.state, sim.entityCount, 0)).toEqual([]);
    const { s } = mount(sim, 0);
    expect(s.root.hidden).toBe(true);
  });

  it('takes its DOM down on dispose', () => {
    const { sim } = world();
    const { s } = mount(sim, 1);
    expect(document.body.contains(s.root)).toBe(true);
    s.dispose();
    expect(document.body.contains(s.root)).toBe(false);
  });
});

describe('ventOffer and routeLabel', () => {
  it('vents only the arrived among the selected, and says why when none has', () => {
    const chips = [{ id: 1, route: 0, etaS: 0 }, { id: 2, route: 0, etaS: 7 }, { id: 3, route: 1, etaS: 3 }];
    expect(ventOffer(chips, new Set())).toEqual({ ids: [], reason: 'Select a unit below ground to bring it up' });
    expect(ventOffer(chips, new Set([1, 2]))).toEqual({ ids: [1], reason: null });
    expect(ventOffer(chips, new Set([2, 3]))).toEqual({ ids: [], reason: 'Still crawling: the first arrives in 3 s' });
  });

  it('names a route by the compass word its id ends in, else by number', () => {
    expect(routeLabel('tm_s_east', 1)).toBe('East tunnel');
    expect(routeLabel('wt_f_north', 0)).toBe('North tunnel');
    expect(routeLabel('odd', 2)).toBe('Tunnel 3');
    expect(routeLabel(undefined, 0)).toBe('Tunnel 1');
  });
});
