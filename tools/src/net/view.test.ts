import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildMatchWorld } from '../../../packages/app/src/net/match-world';
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
    for (const c of sideView(w, 0, fog, null).contacts) expect(Object.keys(c).sort()).toEqual(['hp', 'id', 'tile', 'type']);
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
