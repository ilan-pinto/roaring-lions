// GH-1112: a unit ordered to garrison walks to a structure centroid, a blocked tile BY DESIGN; the bell re-snap must leave that goal alone.
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { RIFLES } from './golden-worlds.test-helper';
import { Sim } from './sim';

const W = 32;
const UNTIL = 200;
function vert(): Int8Array {
  const r = new Int8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) r[y * W + x] = x <= 15 ? 0 : x <= 19 ? -1 : 1;
  return r;
}
const POST = { id: 'k_post', name: 'Post', hp_per_tile: 120, garrison_slots: 1, garrison_cover: 1, floors: 1, rubble_cover: 1, low_profile: true, standing_cover: 2 };
interface Priv { moving: Uint8Array; goalX: Int32Array; goalY: Int32Array; garrisonGoal: Int16Array; garrisonedIn: Int16Array; blocked: Uint8Array }
const priv = (s: Sim): Priv => s as unknown as Priv;

describe('GH-1112: a unit walking to garrison at the bell', () => {
  it('keeps its goal and garrison order across the bell, and gets in', () => {
    const sim = new Sim({ seed: 1112, width: W, height: W, capacity: 64 });
    sim.beginSetup({ untilTick: UNTIL, region: vert() });
    const rifles = sim.addUnitType(RIFLES);
    const post = sim.addStructureType(POST);
    sim.setSetupKit([{ structType: post, allowance: 2 }], []);
    const u = sim.spawn(rifles, 0, fx.from(2.5), fx.from(28.5));
    sim.queueCommand({ kind: 'fortify', side: 0, kit: 0, x: 10, y: 10 });
    for (let i = 0; i < 190; i++) sim.tick();
    expect(priv(sim).blocked[10 * W + 10]).not.toBe(0);
    sim.queueCommand({ kind: 'garrison', ids: [u], structure: 0 });
    for (let i = 0; i < UNTIL - 190; i++) sim.tick();
    expect(sim.tickCount).toBe(UNTIL);
    expect(priv(sim).moving[u]).toBe(1);
    expect(priv(sim).garrisonGoal[u]).toBe(0);
    const before = [priv(sim).goalX[u], priv(sim).goalY[u]];
    expect(priv(sim).blocked[(before[1] >> 16) * W + (before[0] >> 16)]).not.toBe(0); // the goal IS a blocked centroid
    sim.tick(); // the bell
    expect([priv(sim).goalX[u], priv(sim).goalY[u]]).toEqual(before); // the garrison skip leaves the goal alone
    for (let i = 0; i < 800; i++) sim.tick();
    expect(priv(sim).garrisonedIn[u]).toBe(0);
  });
});
