import type { Plan } from '../playtest-run';
import { M } from './bir_tarsha_util';

/**
 * III: Two Houses. The two tagged guards stand inside apartment blocks, and a man in a building cannot be shot without
 * levelling it (14 Conduct, one block is the whole budget). Each block's zone trigger commits the OTHER block's garrison out of
 * its walls, so the plan never fires on a block: the Namer, which the militia rifles cannot hurt, steps into the west zone and
 * back out, the east garrison walks out to meet the force waiting north of the lane and is shot in the open; then the Namer goes
 * round by the east edge into the east zone and the west garrison comes out the same way. Missile teams (range 14, a vehicle
 * or an unscreened squad dies to one hit) are met by closing on them the moment they are identified, inside their twenty-second
 * reload. The taken run for the refuge by themselves under the first rounds, so the plan only keeps clear of them.
 */
export const bt3Plan: Plan = (sim, _rt, ids, at) => {
  const ID = (i: number) => sim.unitTypes[sim.state.typeIdx[i]].id;
  const live = (l: number[]) => l.filter((i) => sim.state.alive[i] === 1 && !ID(i).startsWith('wounded'));
  const at2 = (i: number) => ({ x: Number(sim.state.posX[i]) / 65536, y: Number(sim.state.posY[i]) / 65536 });
  const feet = [...ids('inf_squad'), ...ids('breach_team'), ...ids('yahalom_squad')];
  const snip = ids('sniper_team');
  const bait = ids('ifv_namer');
  // The two garrisons, found by where the mission stands them (the apartments at (33, 14.5) and (43, 23.5)).
  const around = (cx: number, cy: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < sim.entityCount; i++) {
      if (sim.state.side[i] !== 1) continue;
      const p = at2(i);
      if ((p.x - cx) ** 2 + (p.y - cy) ** 2 <= 6.25) out.push(i);
    }
    return out;
  };
  const isMilitia = (i: number) => ID(i) === 'militia_cell';
  const west = around(33.5, 15.5);
  const east = around(43.5, 22.5);
  const westMilitia = west.filter(isMilitia);
  const eastMilitia = east.filter(isMilitia);
  const blockW = [29, 12, 8, 7];
  const blockE = [39, 20, 8, 8];
  const inside = (l: number[], z: readonly number[]) =>
    live(l).some((i) => {
      const { x, y } = at2(i);
      return x >= z[0] && x < z[0] + z[2] && y >= z[1] && y < z[1] + z[3];
    });
  const nearPt = (i: number, c: readonly number[], r: number) => Math.hypot(at2(i).x - c[0], at2(i).y - c[1]) <= r;
  // A guard still inside its block stands on the block's centre; one that came out is in the open.
  const garrisoned = (i: number) => (eastMilitia.includes(i) && nearPt(i, [43, 23.5], 1.8)) || (westMilitia.includes(i) && nearPt(i, [33, 14.5], 1.8));
  const POSTS = [[37, 20], [46.5, 24.5]]; // the two firing positions on the lane
  let lure: number[] = [];
  const spare = (): number[] => {
    const pool = [...live(ids('yahalom_squad')), ...live(ids('breach_team')), ...live(ids('inf_squad'))].filter((i) => !lure.includes(i));
    return pool.slice(0, 1);
  };
  const force = () => [...live(feet), ...live(bait)];

  // Stage north of both blocks, out of the west garrison's nine tiles; the sniper along the top edge.
  at(0, () => {
    sim.queueCommand({ kind: 'move', ids: [...feet, ...snip], ...M(32, 1.5) });
    sim.queueCommand({ kind: 'move', ids: bait, ...M(37, 4) });
  });
  at(14, () => {
    sim.queueCommand({ kind: 'move', ids: live(feet), ...M(39, 4) });
    sim.queueCommand({ kind: 'move', ids: live(snip), ...M(41, 3) });
  });

  // The lure: block by block.
  let phase = 0;
  let since = 0;
  let nowS = 0;
  for (let s = 20; s < 600; s += 1)
    at(s, () => {
      nowS = s;
      if (phase === 0) {
        phase = 1;
        sim.queueCommand({ kind: 'move', ids: live(bait), ...M(36.5, 12.4) });
      } else if (phase === 1 && inside(bait, blockW)) {
        phase = 2;
        since = s;
        sim.queueCommand({ kind: 'move', ids: live(bait), ...M(40, 3) });
      } else if (phase === 2 && (live(eastMilitia).length === 0 || s - since > 30)) {
        // The second block: round by the east edge, into its zone from the north.
        phase = 3;
        since = s;
        sim.queueCommand({ kind: 'move', ids: live(bait), ...M(46.5, 9) });
      } else if (phase === 3 && (inside(bait, [44, 6, 6, 8]) || s - since > 25)) {
        phase = 4;
        since = s;
        lure = live(bait).length > 0 ? live(bait) : spare();
        sim.queueCommand({ kind: 'move', ids: lure, ...M(46.5, 21.8) });
      } else if (phase === 4 && inside(force(), blockE)) {
        phase = 5;
        since = s;
        // Out of everyone's sight: the rifles wait north of the east yard for the second team; the sniper stays behind them.
        sim.queueCommand({ kind: 'move', ids: [...live(lure), ...live(bait)], ...M(46, 5.5) });
        sim.queueCommand({ kind: 'move', ids: live(feet).filter((i) => !lure.includes(i)), ...M(46, 5) });
        sim.queueCommand({ kind: 'move', ids: live(snip), ...M(47.5, 3) });
      } else if (phase === 4 && s - since >= 8 && s % 4 === 0) {
        // A missile hit can stop the Namer short of the zone, or the lure is dead: the next unit in the line goes.
        if (lure.every((i) => sim.state.alive[i] === 0 || sim.state.moving[i] === 0)) {
          lure = spare();
          if (lure.length > 0) sim.queueCommand({ kind: 'move', ids: lure, ...M(46.5, 21.8) });
        }
      }
    });

  // Only if nothing comes: the force goes and gets the nearest guard or missile team standing in the open.
  const hunt = () => phase === 5 && (live(snip).length === 0 ? nowS - since > 20 : nowS - since > 120);
  let aim = -1;
  for (let s = 24; s < 600; s += 4)
    at(s, () => {
      if (!hunt()) return;
      const fs = live(feet);
      const foes = [...live(eastMilitia), ...live(westMilitia)].filter((i) => !garrisoned(i)).concat(live(east.concat(west).filter((i) => !isMilitia(i))));
      if (foes.length === 0 || fs.length === 0) return;
      let cx = 0;
      let cy = 0;
      for (const i of fs) { cx += at2(i).x; cy += at2(i).y; }
      cx /= fs.length;
      cy /= fs.length;
      const dist = (i: number) => Math.hypot(at2(i).x - cx, at2(i).y - cy);
      foes.sort((a, b) => dist(a) - dist(b));
      const t = foes[0];
      const p = at2(t);
      const d = dist(t) || 1;
      const px = cx + ((p.x - cx) / d) * Math.max(0, d - 6.5);
      let py = cy + ((p.y - cy) / d) * Math.max(0, d - 6.5);
      // Never stop inside the reach of the two firing positions on the lane.
      while (py > 2 && POSTS.some((c) => Math.hypot(px - c[0], py - c[1]) < 7.6)) py -= 0.5;
      if (t !== aim || s % 16 === 0) {
        aim = t;
        sim.queueCommand({ kind: 'attackMove', ids: force(), ...M(px, py) });
        const sx = cx + ((p.x - cx) / d) * Math.max(0, d - 11);
        let sy = cy + ((p.y - cy) / d) * Math.max(0, d - 11);
        while (sy > 2 && POSTS.some((c) => Math.hypot(sx - c[0], sy - c[1]) < 7.6)) sy -= 0.5;
        sim.queueCommand({ kind: 'move', ids: live(snip), ...M(sx, sy) });
      }
    });
};
