/**
 * The 4 Nov lead report, part 1: "switching a unit's fire from one target to another did not work".
 *
 * Reproduced headlessly, and the cause is the PICK, not the order. A right-click on an enemy is an
 * `attack` order only when `pointerPoint` names the enemy (`ORDER_PICK_RADIUS_TILES` 0.5 from the
 * unit's FEET, plus the 0.6-tile body behind them). A tank's hull is 2.7 tiles long, so a click on
 * its nose, its flank or its tail missed: `hostile` was -1, the click became an attack-move to the
 * ground, and a unit already firing on something else went on firing on it (an engaged attack-mover
 * fights what is nearest). Measured on the shipped footprints before the fix, the share of the drawn
 * body that read as a hit at the order radius: Lavi 40-53%, Namer 24-39%, Eitan 38-55%, D9 34-39%,
 * jeeps and technicals 51-83%.
 *
 * What this file rules out, each by a test:
 *  (a) "not identified": an unidentified second target is an attack-move BY DESIGN (R-1, GH-420);
 *      pinned below so it is a known edge, not a mystery. The cursor already says `advance`.
 *  (b) "an engaged unit keeps its target": it does not. A unit mid-fight on A that is ordered onto
 *      an identified, reachable B fires its next round at B.
 *  (c) the pick: RULED IN, fixed by `units/pick.ts`'s hull test.
 *  (d) the versus command path: `validateCommand` accepts the order and drops a friendly target.
 *  (e) feedback: the hover cursor and the fire panel read the same `pointerPoint`, so they were
 *      wrong in the same way (they said `advance`), and are right with it.
 */
import { describe, expect, it } from 'vitest';
import { Sim, fx, type SimEvent } from '@lions/sim';
import { applyTerrain, maps, parseMap, units } from '@lions/data';
import { validateCommand, type SeatWorld } from '@lions/net';
import { screenToWorldThree, worldToScreenThree } from '@lions/render/three-camera';
import { WORLD_Y_PER_LIFT_PIXEL, type Camera, type Viewport } from '@lions/render/project';
import { hullPickFor, pickUnitAtScreen } from '../../../render/src/three/units/pick';
import { ELLIPSE_BY_TYPE, ELLIPSE_PAD_TILES } from '../../../render/src/three/units/readability';
import { standMapStructures } from '../map-sim';
import { applyIntent, issueOrder } from './intents';
import { ORDER_PICK_RADIUS_TILES, cursorAt, pointerPoint, simIntentWorld, type PointerView } from './pointer';

const VP: Viewport = { width: 1440, height: 900 };

function world() {
  const map = parseMap(maps.tutorial_ground);
  const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 64 });
  applyTerrain(map, sim);
  standMapStructures(sim, map);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as never));
  const spawn = (id: string, side: number, x: number, y: number, facing = 0): number =>
    sim.spawn(typeOf.get(id) as number, side, fx.from(x), fx.from(y), facing);
  return { sim, spawn };
}

/** The renderer's own pick, as `ThreeRenderer.unitAtScreen` calls it: the shipped pure pick with the
 *  shipped hull table, the unit's live heading, every unit pickable. */
function viewOf(sim: Sim, cam: Camera, viewer = 0, hull = true): PointerView {
  const heading = hullPickFor(
    (i) => sim.unitTypes[sim.state.typeIdx[i]].id,
    (i) => fx.toNumber(sim.state.facing[i])
  );
  return {
    screenToWorld: (px, py) => screenToWorldThree(px, py, cam, VP),
    structureAtScreen: () => -1,
    isVisible: () => true,
    unitAtScreen: (px, py, radiusTiles) => {
      const curX = new Float64Array(sim.entityCount);
      const curY = new Float64Array(sim.entityCount);
      for (let i = 0; i < sim.entityCount; i++) {
        curX[i] = fx.toNumber(sim.state.posX[i]);
        curY[i] = fx.toNumber(sim.state.posY[i]);
      }
      return pickUnitAtScreen(
        px, py, curX, curY, sim.state.alive, sim.state.tunnelIn, sim.entityCount, null, sim.width, sim.height,
        cam, VP, () => true, radiusTiles, undefined, hull ? heading : undefined
      );
    },
    viewer,
  };
}

/** A pixel on the hull's drawn body: (u, v) in [-1, 1] across its box, `h` tiles up. */
function bodyPixel(id: string, x: number, y: number, turns: number, u: number, v: number, h: number, cam: Camera) {
  const e = ELLIPSE_BY_TYPE[id];
  const a = turns * Math.PI * 2;
  const lu = e.offsetAlong + u * (e.along - ELLIPSE_PAD_TILES);
  const lv = v * (e.across - ELLIPSE_PAD_TILES);
  const wx = x + lu * Math.cos(a) - lv * Math.sin(a);
  const wy = y + lu * Math.sin(a) + lv * Math.cos(a);
  return worldToScreenThree(wx, wy, cam, VP, h / WORLD_Y_PER_LIFT_PIXEL);
}

const HULLS = ['mbt_lavi', 'ifv_namer', 'apc_eitan', 'jeep_shoded', 'technical', 'gun_truck', 'rocket_battery', 'dozer_d9'] as const;
const HEADINGS = [0, 8192, 16384, 24576, 40000];

describe('c: a right-click anywhere on an enemy hull is an order on it', () => {
  for (const id of HULLS) {
    it(`${id}: every sampled point of the drawn body (all four ends and flanks, low and turret-high) names it`, () => {
      const { sim, spawn } = world();
      const me = spawn('inf_squad', 0, 12.5, 20.5);
      for (const facing of HEADINGS) {
        const tank = spawn(id, 1, 30.5, 30.5, facing);
        sim.identifyTo(0, tank);
        const cam: Camera = { x: 30.5, y: 30.5, zoom: 1 };
        const view = viewOf(sim, cam);
        const misses: string[] = [];
        for (let u = -1; u <= 1.001; u += 0.5) {
          for (let v = -1; v <= 1.001; v += 0.5) {
            for (const h of [0.15, 0.45, 0.8]) {
              const p = bodyPixel(id, 30.5, 30.5, facing / 65536, u, v, h, cam);
              const hit = pointerPoint(view, sim, p.x, p.y).hostile;
              if (hit !== tank) misses.push(`u${u} v${v} h${h}->${hit}`);
            }
          }
        }
        expect(misses, `${id} facing ${facing}`).toEqual([]);
        sim.state.alive[tank] = 0; // out of the next heading's way
      }
      expect(me).toBeGreaterThanOrEqual(0);
    });
  }

  it('still leaves the ground beside a tank alone (R-23): a tile off the flank or past the nose is not an order on it', () => {
    const { sim, spawn } = world();
    const tank = spawn('mbt_lavi', 1, 30.5, 30.5, 0); // facing +x
    sim.identifyTo(0, tank);
    const cam: Camera = { x: 30.5, y: 30.5, zoom: 1 };
    const view = viewOf(sim, cam);
    const e = ELLIPSE_BY_TYPE.mbt_lavi;
    const noseX = 30.5 + e.offsetAlong + (e.along - ELLIPSE_PAD_TILES);
    const flankY = 30.5 + (e.across - ELLIPSE_PAD_TILES);
    const past = (wx: number, wy: number) => {
      const p = worldToScreenThree(wx, wy, cam, VP);
      return pointerPoint(view, sim, p.x, p.y).hostile;
    };
    // On the ground (lift 0), at the hull's edge the pick still has slack; a full tile out it has none.
    // The camera looks from +x,+y, so a body hides the ground behind it, up the screen toward -x,-y:
    // the sides toward the camera (nose and +y flank) are the ones with no such cover.
    expect(past(noseX + 1.0, 30.5)).toBe(-1);
    expect(past(30.5, flankY + 1.0)).toBe(-1);
    expect(past(noseX + 0.7, flankY + 0.7)).toBe(-1);
    // Nor does it reach far behind: three tiles off in any direction is plain ground.
    for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3], [-2.5, -2.5]]) expect(past(30.5 + dx, 30.5 + dy)).toBe(-1);
    // And the slack is small: well under the 0.5 order radius it would be if it stacked on the hull.
    expect(past(noseX + 0.1, 30.5)).toBe(tank);
    expect(past(noseX + 0.35, 30.5)).toBe(-1);
    expect(ORDER_PICK_RADIUS_TILES).toBe(0.5);
  });

  it('a point unit is picked exactly as before (infantry have no hull)', () => {
    const { sim, spawn } = world();
    const foe = spawn('inf_squad', 1, 30.5, 30.5);
    sim.identifyTo(0, foe);
    const cam: Camera = { x: 30.5, y: 30.5, zoom: 1 };
    for (const hull of [true, false]) {
      const view = viewOf(sim, cam, 0, hull);
      const at = (dx: number, dy: number) => {
        const p = worldToScreenThree(30.5 + dx, 30.5 + dy, cam, VP);
        return pointerPoint(view, sim, p.x, p.y).hostile;
      };
      expect(at(0.3, 0)).toBe(foe);
      expect(at(1.0, 1.0)).toBe(-1);
    }
  });
});

/** Whom `by` fires on, tick by tick; `weapon` keeps only that gun (a Lavi's coax answers its own scan). */
function fires(sim: Sim, ticks: number, by: number, weapon?: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < ticks; i++) {
    for (const e of sim.tick() as SimEvent[]) {
      if (e.kind === 'fire' && e.shooter === by && (weapon === undefined || e.weaponId === weapon)) out.push(e.target);
    }
  }
  return out;
}

/** Right-click at a pixel, as `main.ts`'s contextmenu handler: the pointer read, then `issueOrder`. */
function rightClick(sim: Sim, view: PointerView, ids: number[], px: number, py: number) {
  const p = pointerPoint(view, sim, px, py);
  const queue: Parameters<Sim['queueCommand']>[0][] = [];
  const sink = {
    dispatch: (intent: Parameters<typeof applyIntent>[1]) =>
      applyIntent({ queueCommand: (c: Parameters<Sim['queueCommand']>[0]) => queue.push(c) } as never, intent, { width: sim.width, height: sim.height }),
    note: () => undefined,
    marker: () => undefined,
    deny: () => undefined,
  };
  const res = issueOrder(simIntentWorld(sim, () => false), sink as never, ids, p.x, p.y, {
    append: false,
    confirm: false,
    hostile: p.hostile,
    ...(p.hostileAt ? { hostileAt: p.hostileAt } : {}),
  });
  for (const c of queue) sim.queueCommand(c);
  return { p, res, queue };
}

describe('the lead\'s case: a tank mid-fight on A, a click on the nose of B', () => {
  /** Our Lavi fights a Namer (A, near); a gun truck (B) stands behind it, identified. */
  function fight() {
    const { sim, spawn } = world();
    const me = spawn('mbt_lavi', 0, 10.5, 30.5, 0);
    const a = spawn('ifv_namer', 1, 18.5, 30.5, 32768);
    const b = spawn('gun_truck', 1, 22.5, 33.5, 32768); // facing -x, nose toward us; soft, so the Lavi's gun hurts it
    sim.identifyTo(0, a);
    sim.identifyTo(0, b);
    expect(fires(sim, 40, me, 'gun_120').length).toBeGreaterThan(0); // already firing
    return { sim, me, a, b };
  }

  it('the click on B\'s nose is an attack order on B, and the next round goes at B', () => {
    const { sim, me, a, b } = fight();
    expect(sim.state.alive[a]).toBe(1); // A is still the one it is fighting
    const cam: Camera = { x: 22.5, y: 33.5, zoom: 1 };
    const view = viewOf(sim, cam);
    // B faces -x: its nose is at u = -1 (the hull runs along its heading, which points away from +x).
    const px = bodyPixel('gun_truck', 22.5, 33.5, 0.5, 1, 0, 0.4, cam);
    const { p, res } = rightClick(sim, view, [me], px.x, px.y);
    expect(p.hostile).toBe(b);
    expect(res.intents).toEqual([{ kind: 'attack', ids: [me], target: b }]);
    // The Lavi closes on B (12.4 tiles, the gun reaches 12), then its main gun fires: at B, not A.
    const shots = fires(sim, 200, me, 'gun_120');
    expect(shots.length).toBeGreaterThan(0);
    expect(shots[0]).toBe(b);
  });

  it('and the same click without the hull test is the defect: an attack-move, and the unit keeps firing on A', () => {
    const { sim, me, a, b } = fight();
    const cam: Camera = { x: 22.5, y: 33.5, zoom: 1 };
    const view = viewOf(sim, cam, 0, false);
    const px = bodyPixel('gun_truck', 22.5, 33.5, 0.5, 1, 0, 0.4, cam);
    const { p, res } = rightClick(sim, view, [me], px.x, px.y);
    expect(p.hostile).toBe(-1);
    expect(res.intents.map((i) => i.kind)).toEqual(['order']);
    expect(fires(sim, 200, me, 'gun_120')[0]).toBe(a);
    expect(b).toBeGreaterThan(a);
  });

  it('the cursor over the same pixel says attack, not advance (the hover and the click read one pointer)', () => {
    const { sim, me } = fight();
    const cam: Camera = { x: 22.5, y: 33.5, zoom: 1 };
    const view = viewOf(sim, cam);
    const px = bodyPixel('gun_truck', 22.5, 33.5, 0.5, 1, 0, 0.4, cam);
    const p = pointerPoint(view, sim, px.x, px.y);
    const c = cursorAt(sim, simIntentWorld(sim, () => false), p, { ids: [me], armed: null, confirm: false, armedSmoke: false });
    expect(c.name).toBe('attack');
  });
});

describe('hulls only add candidates (the review of PR 1015)', () => {
  it('a man standing in front of a friendly hull is still the man, on a right-click and a left-click', () => {
    const { sim, spawn } = world();
    const tank = spawn('mbt_lavi', 0, 30.5, 30.5, 0); // ours, facing +x
    const cam: Camera = { x: 30.5, y: 30.5, zoom: 1 };
    let lost = 0;
    let tried = 0;
    const foes: number[] = [];
    // An enemy rifle squad at half-tile offsets all round the tank, on the camera's side and off it.
    for (const [dx, dy] of [[0.5, 0.5], [1, 0], [0, 1], [0.5, 1], [-0.5, 0.5], [1, 1], [0, 0.5]]) {
      const foe = spawn('inf_squad', 1, 30.5 + dx, 30.5 + dy);
      sim.identifyTo(0, foe);
      foes.push(foe);
    }
    for (const foe of foes) {
      const fx0 = fx.toNumber(sim.state.posX[foe]);
      const fy0 = fx.toNumber(sim.state.posY[foe]);
      for (const h of [0.3, 0.45]) {
        const px = worldToScreenThree(fx0, fy0, cam, VP, h / WORLD_Y_PER_LIFT_PIXEL);
        const view = viewOf(sim, cam);
        tried++;
        const right = pointerPoint(view, sim, px.x, px.y).hostile;
        const left = view.unitAtScreen(px.x, px.y, 1.2);
        // The pick may land on a neighbouring man in the ring; what it must never be is the tank.
        if (right === tank || left === tank) lost++;
        expect(foes).toContain(right);
      }
    }
    expect(tried).toBeGreaterThan(10);
    expect(lost).toBe(0);
  });
});

describe('a, b, d: the other candidates, ruled out', () => {
  it('(b) an engaged unit does not keep its target: the order replaces it, tank and rifle squad alike', () => {
    for (const shooter of ['mbt_lavi', 'inf_squad']) {
      const { sim, spawn } = world();
      const me = spawn(shooter, 0, 12.5, 24.5);
      const a = spawn('inf_squad', 1, 17.5, 24.5);
      const b = spawn('inf_squad', 1, 17.5, 26.5);
      sim.identifyTo(0, a);
      sim.identifyTo(0, b);
      sim.tick();
      sim.queueCommand({ kind: 'attack', ids: [me], target: b });
      sim.tick();
      expect(sim.state.focusTarget[me], shooter).toBe(b);
      const shots = fires(sim, 60, me);
      expect(shots.length, shooter).toBeGreaterThan(0);
      expect(new Set(shots), shooter).toEqual(new Set([b]));
    }
  });

  it('(a) an enemy the side only suspects is an attack-move by design, and the engaged unit stays on A', () => {
    const { sim, spawn } = world();
    const me = spawn('inf_squad', 0, 12.5, 24.5);
    const a = spawn('inf_squad', 1, 17.5, 24.5);
    const b = spawn('inf_squad', 1, 17.5, 28.5); // never identified
    sim.identifyTo(0, a);
    const cam: Camera = { x: 17.5, y: 28.5, zoom: 1 };
    const view = viewOf(sim, cam);
    const { p, res } = rightClick(sim, view, [me], VP.width / 2, VP.height / 2);
    expect(p.hostile).toBe(b);
    expect(sim.canFocus(me, b)).toBe(false);
    expect(res.intents.map((i) => i.kind)).toEqual(['order']);
    const shots = fires(sim, 60, me);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((t) => t === a)).toBe(true);
  });

  it('(d) a versus seat\'s attack on an enemy passes validateCommand; on its own unit it is dropped', () => {
    const { sim, spawn } = world();
    const mine = spawn('mbt_lavi', 0, 10.5, 30.5);
    const mine2 = spawn('mbt_lavi', 0, 10.5, 32.5);
    const theirs = spawn('mbt_lavi', 1, 22.5, 30.5);
    const seatWorld = {
      sideOfSeat: (seat: number) => seat,
      sideOfEntity: (id: number) => (Number.isInteger(id) && id >= 0 && id < sim.entityCount ? sim.state.side[id] : undefined),
      versus: true,
    } as unknown as SeatWorld;
    expect(validateCommand({ kind: 'attack', ids: [mine], target: theirs }, 0, seatWorld)).toBe(true);
    expect(validateCommand({ kind: 'attack', ids: [mine], target: mine2 }, 0, seatWorld)).toBe(false);
    expect(validateCommand({ kind: 'attack', ids: [theirs], target: mine }, 0, seatWorld)).toBe(false);
  });
});
