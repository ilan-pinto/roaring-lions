/**
 * The patrol verb from input (Lane A mock, approved 22 Oct, Q6-Q14). Oracles
 * are literals; the world is a fake (`groundAt`, `flies`, `garrisoned`), and
 * the sim half is a real `Sim` taking the command `applyIntent` queues.
 */
import { describe, expect, it } from 'vitest';
import { Sim, fx, type Command, type UnitTypeJson } from '@lions/sim';
import { applyIntent, type IntentWorld } from './intents';
import { beginPatrol, patrolClick, patrolIds, patrolPointOk, patrolStart, type PatrolDraft } from './patrol';
import { cursorFor, cursorKey } from './cursor';
import { cursorAt, simIntentWorld, type PointerPoint } from './pointer';
import { bindingsFrom, resolveKey } from './keymap';

type W = Pick<IntentWorld, 'groundAt' | 'flies' | 'garrisoned'>;
/** Open ground everywhere inside 0..20, a rock at x 10, off the map outside. */
const world = (over: Partial<W> = {}): W => ({
  groundAt: (x, y) => (x < 0 || y < 0 || x >= 20 || y >= 20 ? 'offmap' : Math.floor(x) === 10 ? 'blocked' : 'open'),
  flies: () => false,
  garrisoned: () => false,
  ...over,
});
const POS: Record<number, { x: number; y: number }> = { 1: { x: 2.2, y: 3.9 }, 2: { x: 4.4, y: 3.1 }, 3: { x: 9.6, y: 5.5 }, 4: { x: 11.4, y: 5.5 } };
const posOf = (i: number) => POS[i];
const never = () => false;

describe('who patrols, and from where', () => {
  it('leaves out a unit inside a building or a carrier (Q11)', () => {
    expect(patrolIds([1, 2, 3], (i) => i === 2, (i) => i === 3)).toEqual([1]);
  });
  it('point 1 is the tile centre under the walkers\' mean position', () => {
    // mean (3.3, 3.5) -> tile (3, 3) -> centre (3.5, 3.5)
    expect(patrolStart([1, 2], posOf, world())).toEqual({ x: 3.5, y: 3.5 });
  });
  it('a centre on rock falls back to the tile of the walker nearest it', () => {
    // mean (10.5, 5.5) is the rock column; unit 3 at 9.6 is 0.9 away, unit 4 at 11.4 is 0.9
    // away too -- the first wins the tie.
    expect(patrolStart([3, 4], posOf, world())).toEqual({ x: 9.5, y: 5.5 });
  });
  it('refuses to arm with nothing selected, or with nobody free to walk', () => {
    expect(beginPatrol([], posOf, world(), never)).toBe('noSelection');
    expect(beginPatrol([1, 2], posOf, world({ garrisoned: () => true }), never)).toBe('nobodyFree');
    expect(beginPatrol([1, 2], posOf, world(), () => true)).toBe('nobodyFree');
  });
  it('arms with point 1 placed', () => {
    expect(beginPatrol([1, 2], posOf, world(), never)).toEqual({ ids: [1, 2], points: [{ x: 3.5, y: 3.5 }] });
  });
});

describe('where a point may go (Q9)', () => {
  it('open ground only, for a ground force', () => {
    expect(patrolPointOk(world(), [1], 5.5, 5.5)).toBe(true);
    expect(patrolPointOk(world(), [1], 10.5, 5.5)).toBe(false);
    expect(patrolPointOk(world(), [1], 25, 5)).toBe(false);
  });
  it('rock too when a flyer walks it (K-08), but never off the map', () => {
    const air = world({ flies: (i) => i === 9 });
    expect(patrolPointOk(air, [1, 9], 10.5, 5.5)).toBe(true);
    expect(patrolPointOk(air, [1, 9], -1, 5)).toBe(false);
  });
});

describe('the clicks (Q7)', () => {
  const draft: PatrolDraft = { ids: [1, 2], points: [{ x: 3.5, y: 3.5 }] };
  it('a plain click sends here-and-there: two points, one intent', () => {
    expect(patrolClick(draft, world(), 15.5, 3.5, false)).toEqual({
      kind: 'send',
      intent: { kind: 'patrol', ids: [1, 2], points: [{ x: 3.5, y: 3.5 }, { x: 15.5, y: 3.5 }] },
    });
  });
  it('a Shift-click adds a point and stays armed; the 4th point sends by itself', () => {
    const a = patrolClick(draft, world(), 5.5, 8.5, true);
    expect(a).toEqual({ kind: 'added', draft: { ids: [1, 2], points: [{ x: 3.5, y: 3.5 }, { x: 5.5, y: 8.5 }] } });
    if (a.kind !== 'added') throw new Error('not added');
    const b = patrolClick(a.draft, world(), 15.5, 8.5, true);
    if (b.kind !== 'added') throw new Error('not added');
    const c = patrolClick(b.draft, world(), 15.5, 3.5, true);
    expect(c.kind).toBe('send');
    expect(c.kind === 'send' ? c.intent.points : []).toEqual([
      { x: 3.5, y: 3.5 },
      { x: 5.5, y: 8.5 },
      { x: 15.5, y: 8.5 },
      { x: 15.5, y: 3.5 },
    ]);
  });
  it('rock refuses the click and keeps nothing', () => {
    expect(patrolClick(draft, world(), 10.5, 3.5, false)).toEqual({ kind: 'refused' });
    expect(patrolClick(draft, world(), 10.5, 3.5, true)).toEqual({ kind: 'refused' });
  });
});

describe('the intent queues one setStance patrol', () => {
  it('as Q16.16 points, clamped into the map', () => {
    const sent: Command[] = [];
    applyIntent(
      { queueCommand: (c) => sent.push(c) },
      { kind: 'patrol', ids: [4, 5], points: [{ x: 3.5, y: 3.5 }, { x: 40, y: 2.25 }] },
      { width: 20, height: 20 }
    );
    expect(sent).toEqual([
      { kind: 'setStance', ids: [4, 5], stance: 'patrol', waypoints: [[fx.from(3.5), fx.from(3.5)], [20 * 65536 - 1, fx.from(2.25)]] },
    ]);
  });
  it('and a real sim takes it: the unit is on patrol, with a beat of 3', () => {
    const RIFLE: UnitTypeJson = {
      id: 'pt_rifles', name: 'Rifles', role: 'infantry',
      hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
      mobility: { speed_tiles_s: 0.9 },
      sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
      weapons: [],
    };
    const s = new Sim({ seed: 0x9a7, width: 20, height: 20, capacity: 8 });
    const id = s.spawn(s.addUnitType(RIFLE), 0, fx.from(3.5), fx.from(3.5));
    const queued: Command[] = [];
    applyIntent(
      { queueCommand: (c) => queued.push(c) },
      { kind: 'patrol', ids: [id], points: [{ x: 3.5, y: 3.5 }, { x: 8.5, y: 3.5 }, { x: 8.5, y: 8.5 }] },
      { width: 20, height: 20 }
    );
    for (const c of queued) s.queueCommand(c);
    s.tick();
    expect(s.isPatrolling(id)).toBe(true);
    expect(s.patrolCountOf(id)).toBe(3);
  });
});

describe('the armed patrol cursor (Q9, Q10)', () => {
  const none = { intents: [], roe: 'free' as const, marker: false };
  it('reads patrol where a point may go, blocked where it may not, whatever is underneath', () => {
    expect(cursorFor(none, { hostile: true, blocked: false, armedPatrol: 'ok' })).toBe('patrol');
    expect(cursorFor(none, { hostile: false, blocked: true, armedPatrol: 'refused' })).toBe('blocked');
  });
  it('wears no role badge: a mode, not an actor', () => {
    expect(cursorKey('patrol', 'soft')).toBe('patrol');
  });
  it('cursorAt resolves an armed patrol with no ids and reads the point test', () => {
    const s = new Sim({ seed: 0x9a7, width: 20, height: 20, capacity: 8 });
    // Through `unknown`: main's PointerPoint also carries the GH-707 `wounded`/`woundedAt`
    // fields, which this branch (stacked on net-n3) does not have yet; both read -1/null here.
    const p = { ground: { x: 5.5, y: 5.5 }, x: 5.5, y: 5.5, hostile: -1, hostileAt: null, facade: -1, wounded: -1, woundedAt: null } as unknown as PointerPoint;
    const w = simIntentWorld(s, () => false);
    const ctx = { ids: [1, 2], armed: null, confirm: false, armedSmoke: false };
    expect(cursorAt(s, w, p, { ...ctx, patrolAt: () => true }).key).toBe('patrol');
    expect(cursorAt(s, w, p, { ...ctx, patrolAt: () => false }).key).toBe('blocked');
    expect(cursorAt(s, w, p, { ...ctx, patrolAt: () => true }).res.intents).toEqual([]);
  });
});

describe('the key (Q6)', () => {
  it('P arms the patrol, and it is rebindable like Move', () => {
    const b = bindingsFrom({});
    expect(resolveKey(b, { key: 'p', ctrlKey: false, metaKey: false })).toBe('patrol');
    expect(resolveKey(bindingsFrom({ patrol: 'j' }), { key: 'j', ctrlKey: false, metaKey: false })).toBe('patrol');
  });
});
