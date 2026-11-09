import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildMatchWorld, matchTick } from '../../../packages/app/src/net/match-world';
import { roomEconomyView } from '../../../packages/app/src/net/room-economy';
import { FogTracker } from './fog-tracker';
import { sideView } from './view';
import { versusConfig } from './test-config';

describe('sideView', () => {
  it('never names an enemy on a tile the side cannot see (spec §12, harness)', () => {
    const w = buildMatchWorld(versusConfig('tel_marum'));
    const fog = new FogTracker(w.sim, 0);
    for (let i = 0; i < 40; i++) { w.sim.tick(); fog.step(); }
    const v = sideView(w, 0, fog, null);
    // At t=2 s the two camps are ~30 tiles apart: side 0 sees none of side 1.
    expect(v.contacts).toEqual([]);
    expect(v.units.length).toBe(w.bySide[0].length);
  });
  it('names an enemy once it stands in sight, by id, type and tile', () => {
    const w = buildMatchWorld(versusConfig('tel_marum'));
    const enemy = w.bySide[1][0];
    // Move it next to a side-0 unit by the sim's own command path, then tick until it arrives.
    const [fx0, fy0] = [w.sim.state.posX[w.bySide[0][0]], w.sim.state.posY[w.bySide[0][0]]];
    w.sim.queueCommand({ kind: 'move', ids: [enemy], x: fx0 + (2 << 16), y: fy0, exact: true });
    const fog = new FogTracker(w.sim, 0);
    for (let i = 0; i < 1200 && !sideView(w, 0, fog, null).contacts.some((c) => c.id === enemy); i++) { w.sim.tick(); fog.step(); }
    expect(sideView(w, 0, fog, null).contacts.map((c) => c.id)).toContain(enemy);
  });
  it('GH-954: an own unit reads its stance; a contact in sight reads none, whatever stance the enemy keeps', () => {
    const w = buildMatchWorld(versusConfig('tel_marum'));
    const enemy = w.bySide[1][0];
    const mine = w.bySide[0][0];
    const [fx0, fy0] = [w.sim.state.posX[mine], w.sim.state.posY[mine]];
    // The enemy walks up to side 0's unit, then keeps an ambush stance there; side 0's unit patrols.
    w.sim.queueCommand({ kind: 'move', ids: [enemy], x: fx0 + (2 << 16), y: fy0, exact: true });
    const fog = new FogTracker(w.sim, 0);
    for (let i = 0; i < 1200 && !sideView(w, 0, fog, null).contacts.some((c) => c.id === enemy); i++) { w.sim.tick(); fog.step(); }
    w.sim.queueCommand({ kind: 'setStance', ids: [enemy], stance: 'ambush', radius: 5 << 16 });
    w.sim.queueCommand({ kind: 'setStance', ids: [mine], stance: 'patrol', waypoints: [[fx0, fy0], [fx0 + (4 << 16), fy0]] });
    w.sim.tick(); fog.step();
    const v = sideView(w, 0, fog, null);
    expect(v.units.find((u) => u.id === mine)).toMatchObject({ stance: 'patrol', points: 2 });
    expect(v.units.find((u) => u.id !== mine)).toMatchObject({ stance: 'free' });
    const seen = v.contacts.find((c) => c.id === enemy);
    expect(seen, 'the enemy is in sight').toBeDefined();
    expect(Object.keys(seen as object).sort()).toEqual(['hp', 'id', 'inSight', 'seenTick', 'tile', 'type']);
    expect(v.stances).toEqual(['hold', 'ambush', 'patrol']);
    // Its own side's view reads the ambush.
    const theirs = sideView(w, 1, new FogTracker(w.sim, 1), null).units.find((u) => u.id === enemy);
    expect(theirs).toMatchObject({ stance: 'ambush', radius: 5 });
  });
  it('GH-954: the economy is present in an economy room only, and is each side\'s own', () => {
    const mirror = buildMatchWorld(versusConfig('tel_marum'));
    expect(sideView(mirror, 0, new FogTracker(mirror.sim, 0), null)).not.toHaveProperty('economy');
    const w = buildMatchWorld(versusConfig('wadi_tarfan', { factions: ['kdf', 'sarim'] }));
    const v0 = sideView(w, 0, new FogTracker(w.sim, 0), null);
    const v1 = sideView(w, 1, new FogTracker(w.sim, 1), null);
    expect(v0.economy?.purse).toBe(1500);
    expect(v1.economy?.purse).toBe(2400);
    expect(v0.economy?.menu.map((m) => m.unit)).not.toContain('sarim_rifles');
    expect(v1.economy?.menu.map((m) => m.unit)).not.toContain('inf_squad');
    // The runtime's own answers are the view's: nothing recomputed.
    expect(v0.economy?.population).toEqual(w.runtime?.populationView(0));
  });
  it('GH-954: perMin is what the zones THIS side holds pay: 60 for the side in the ford, 20 for the side on its own bluff', () => {
    const w = buildMatchWorld(versusConfig('wadi_tarfan', { factions: ['kdf', 'sarim'] }));
    const rt = w.runtime;
    if (rt === null) throw new Error('an economy room has a runtime');
    const zone = rt.incomeZones.find((z) => z.zone === 'centre_ford');
    if (zone === undefined) throw new Error('wadi_tarfan has the centre ford');
    // One side-0 unit stands in the ford (a test writes the sim's arrays, as the other specs do); the runtime reads who holds it.
    const mine = w.bySide[0][0];
    const [x0, y0, zw, zh] = zone.rect;
    w.sim.state.posX[mine] = (x0 + (zw >> 1)) * 65536;
    w.sim.state.posY[mine] = (y0 + (zh >> 1)) * 65536;
    matchTick(w);
    // Premises, by literal (rates are the rules file's): side 0 holds the ford (60 a minute), side 1's spawn stands on bluff_near_1 (20).
    expect(rt.incomeZones.map((z) => [z.zone, z.holder]).filter(([, h]) => h !== -1)).toEqual([['centre_ford', 0], ['bluff_near_1', 1]]);
    const v0 = sideView(w, 0, new FogTracker(w.sim, 0), null);
    const v1 = sideView(w, 1, new FogTracker(w.sim, 1), null);
    expect(v0.economy?.perMin).toBe(60);
    expect(v1.economy?.perMin).toBe(20);
    // And it is the figure the strip shows.
    expect(v0.economy?.perMin).toBe(roomEconomyView(rt, 0, 'kdf').ratePerMin);
    expect(v1.economy?.perMin).toBe(roomEconomyView(rt, 1, 'sarim').ratePerMin);
  });
  it('is a pure read: viewing changes no sim hash', () => {
    const w = buildMatchWorld(versusConfig('wadi_tarfan'));
    const fog = new FogTracker(w.sim, 1);
    for (let i = 0; i < 20; i++) { w.sim.tick(); fog.step(); }
    const h = w.sim.hash();
    sideView(w, 1, fog, null);
    expect(w.sim.hash()).toBe(h);
  });
  it('lists its own force in full with integer-percent hp and flags, never a world unit', () => {
    const w = buildMatchWorld(versusConfig('tel_marum'));
    const fog = new FogTracker(w.sim, 0);
    const mine = w.bySide[0][0];
    w.sim.queueCommand({ kind: 'move', ids: [mine], x: w.sim.state.posX[mine] + (6 << 16), y: w.sim.state.posY[mine], exact: true });
    for (let i = 0; i < 5; i++) { w.sim.tick(); fog.step(); }
    const v = sideView(w, 0, fog, null);
    const line = v.units.find((u) => u.id === mine);
    expect(line).toBeDefined();
    expect(line?.flags).toContain('moving');
    expect(line?.hp).toBe(100);
    expect(line?.tile).toEqual([w.sim.state.posX[mine] >> 16, w.sim.state.posY[mine] >> 16]);
    expect(v.clock).toBe('00:00');
    expect(v.camp).toEqual([...w.anchors.friendly]);
    expect(v.enemyCamp).toEqual([...w.anchors.hostile]);
    const other = sideView(w, 1, new FogTracker(w.sim, 1), null);
    expect(other.camp).toEqual(v.enemyCamp);
  });
  it('flags an own unit that is shooting `engaging`, and one the idle finder would hand the player `idle` -- own units only', () => {
    const w = buildMatchWorld(versusConfig('tel_marum'));
    const fog = new FogTracker(w.sim, 0);
    const mine = w.bySide[0][0];
    const enemy = w.bySide[1][0];
    // At rest on its spawn, nothing in reach: the idle finder's idle.
    w.sim.tick(); fog.step();
    const line0 = sideView(w, 0, fog, null).units.find((u) => u.id === mine);
    expect(line0?.flags).toContain('idle');
    expect(line0?.flags).not.toContain('engaging');
    // Walk an enemy into its reach, by the sim's own command path.
    w.sim.queueCommand({ kind: 'move', ids: [enemy], x: w.sim.state.posX[mine] + (3 << 16), y: w.sim.state.posY[mine], exact: true });
    let line = line0;
    for (let i = 0; i < 1200 && !(line?.flags.includes('engaging') ?? false); i++) {
      w.sim.tick(); fog.step();
      line = sideView(w, 0, fog, null).units.find((u) => u.id === mine);
    }
    expect(line?.flags).toContain('engaging');
    expect(line?.flags).not.toContain('idle');
    expect(w.sim.state.curTarget[mine]).toBeGreaterThanOrEqual(0);
    // A moving unit is not idle either.
    w.sim.queueCommand({ kind: 'move', ids: [w.bySide[0][1]], x: w.sim.state.posX[w.bySide[0][1]] + (6 << 16), y: w.sim.state.posY[w.bySide[0][1]], exact: true });
    w.sim.tick(); fog.step();
    const mover = sideView(w, 0, fog, null).units.find((u) => u.id === w.bySide[0][1]);
    expect(mover?.flags).toContain('moving');
    expect(mover?.flags).not.toContain('idle');
    // Contacts carry no flags at all: the viewer is never told what an enemy is doing.
    for (const c of sideView(w, 0, fog, null).contacts) expect(Object.keys(c).sort()).toEqual(['hp', 'id', 'inSight', 'seenTick', 'tile', 'type']);
  });
  it('steps fog on the renderer cadence: a reveal holds for three more calls, then decays on the fourth', () => {
    const w = buildMatchWorld(versusConfig('tel_marum'));
    const fog = new FogTracker(w.sim, 0);
    const probe = w.bySide[0][0];
    const [px, py] = [w.sim.state.posX[probe] / 65536, w.sim.state.posY[probe] / 65536];
    w.sim.tick();
    fog.step(); // call 0: computes
    expect(fog.visibleTile(px, py)).toBe(true);
    for (const id of w.bySide[0]) w.sim.debugKill(id); // nobody left to see with
    for (let i = 0; i < 3; i++) { w.sim.tick(); fog.step(); } // calls 1-3: no recompute
    expect(fog.visibleTile(px, py)).toBe(true);
    w.sim.tick();
    fog.step(); // call 4: recompute, nobody reveals, the tile decays to explored
    expect(fog.visibleTile(px, py)).toBe(false);
  });
  it('render fog.ts stays importable headlessly: it imports nothing', () => {
    const src = readFileSync(new URL('../../../packages/render/src/three/fog.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^import /m);
  });
});

describe('casualties (GH-973)', () => {
  const woundedIdx = (w: ReturnType<typeof buildMatchWorld>): number => w.sim.unitTypes.findIndex((t) => t.id === 'wounded_kdf');
  it('lists a wounded man of its own side apart from the units: not a unit, not orderable', () => {
    const w = buildMatchWorld(versusConfig('tel_marum'));
    const fog = new FogTracker(w.sim, 0);
    const mine = w.bySide[0][0];
    expect(woundedIdx(w)).toBeGreaterThanOrEqual(0);   // a versus room registers the wounded bodies
    const before = sideView(w, 0, fog, null);
    const id = w.sim.spawn(woundedIdx(w), 0, w.sim.state.posX[mine], w.sim.state.posY[mine]);
    const v = sideView(w, 0, fog, null);
    expect(v.units.map((u) => u.id)).not.toContain(id);
    expect(v.units).toHaveLength(before.units.length);
    expect(v.casualties.mine).toEqual([expect.objectContaining({ id, type: 'wounded_kdf', state: 'down' })]);
    expect(typeof v.casualties.mine[0].bleeding).toBe('number');
    expect(v.casualties.theirs).toEqual([]);
    expect(before.casualties).toEqual({ mine: [], theirs: [] });
  });
  it('lists an enemy wounded man in sight under theirs, not as a contact, and one out of sight not at all', () => {
    const w = buildMatchWorld(versusConfig('tel_marum'));
    const fog = new FogTracker(w.sim, 0);
    const mine = w.bySide[0][0];
    const near = w.sim.spawn(woundedIdx(w), 1, w.sim.state.posX[mine] + (2 << 16), w.sim.state.posY[mine]);
    const far = w.sim.spawn(woundedIdx(w), 1, w.sim.state.posX[w.bySide[1][0]], w.sim.state.posY[w.bySide[1][0]]);
    w.sim.tick(); fog.step();
    const v = sideView(w, 0, fog, null);
    expect(v.contacts.map((c) => c.id)).not.toContain(near);
    expect(v.casualties.theirs.map((c) => c.id)).toContain(near);
    expect(v.casualties.theirs.map((c) => c.id)).not.toContain(far);
    expect(v.casualties.mine).toEqual([]);
  });
});
