/**
 * IV: The Blade Line. The blades are the escort and the works are the job, so the plan keeps them out of the one thing that can hurt them
 * (missile teams: militia rifles do not mark a D9's plate) until it is dead, then lets them level the belt order by order.
 *  1. At once every vehicle leaves the lee missile teams' sight and the hamlet's line of fire (a gun round that misses a team at the lee's edge
 *     lands in the flagged houses, and a D9 halted beside a house levels it), and the weak teams keep out of the firing positions' seven tiles.
 *     The squads and the sniper (rifle-calibre fire costs the hamlet nothing) hunt the two lee teams.
 *  2. Lee teams down: the Lavi, the Namers and the sniper advance along the Fence Road in bounds, each taking the first barrier target the sim
 *     lets it focus; the sniper never stands within nine tiles of a garrison. The last missile team stands behind the T-wall and is taken
 *     through the boulder gap from the south.
 *  3. The blades take the nearest unclaimed work with an explicit `demolish` each (berms included; a garrison inside a firing position dies
 *     with it), at most to x 26 while the barrier lives and to x 33 while only the team behind the wall does.
 *  4. The Yahalom teams charge the west and centre routes once nothing hostile stands within nine tiles, the east route once the barrier is down.
 *  5. When the belt is level the blades drive through the cut wall to the far gate.
 *  The camp buys with what it has (a squad at once, a recon dog when the income allows); they stay at the camp, and the purse is spent rather than banked
 *  (`BANKING_OVER_30_MAX` in playtest.ts counts a plan that ends holding most of its logistics).
 */
import type { Plan } from '../playtest-run';
import { M, foesIn } from './bir_tarsha_util';

export const bt4Plan: Plan = (sim, rt, ids, at) => {
  const ID = (i: number) => sim.unitTypes[sim.state.typeIdx[i]].id;
  const live = (l: number[]) => l.filter((i) => sim.state.alive[i] === 1 && !ID(i).startsWith('wounded'));
  const px = (i: number) => Number(sim.state.posX[i]) / 65536;
  const py = (i: number) => Number(sim.state.posY[i]) / 65536;
  // A squad costs 292 of the 300 the camp starts with; the income that follows buys a recon dog (190) around two minutes in. Both stay at the camp.
  let squadBought = false;
  for (let s = 5; s < 400; s += 5) at(s, () => { if (!squadBought) squadBought = rt.requestBuild('inf_squad'); else rt.requestBuild('ugv_recon_dog'); });
  const blades = ids('dozer_d9');
  const namers = ids('ifv_namer');
  const lavis = ids('mbt_lavi');
  const squads = ids('inf_squad');
  const yah = ids('yahalom_squad');
  const snip = ids('sniper_team');
  const S = sim.structures;
  const stType = (s: number) => sim.structureTypes[S.typeIdx[s]].id;
  const works: number[] = [];
  let last = new Map<number, number>();
  /** Each shooter takes the first target the sim lets it focus (re-ordered only when it changes). */
  const focus = (shooters: number[], targets: number[]): boolean => {
    let any = false;
    for (const sh of live(shooters)) {
      const t = targets.find((x) => sim.canFocus(sh, x));
      if (t === undefined) continue;
      any = true;
      if (last.get(sh) !== t) { last.set(sh, t); sim.queueCommand({ kind: 'attack', ids: [sh], target: t }); }
    }
    return any;
  };

  at(0, () => {
    for (let s = 0; s < sim.structureCount; s++) {
      const x = S.minX[s];
      const y = S.minY[s];
      if (x >= 10 && x < 37 && y >= 20 && y < 30 && stType(s) !== 'fence') works.push(s);
    }
    // The vehicles leave the lee missile teams' sight and the hamlet's line of fire (a gun round that misses them lands in the flagged houses) at once.
    sim.queueCommand({ kind: 'move', ids: [blades[0]], ...M(5.5, 21.5) });
    sim.queueCommand({ kind: 'move', ids: [blades[1]], ...M(5.5, 24.5) });
    sim.queueCommand({ kind: 'move', ids: [blades[2]], ...M(7.5, 22.5) });
    sim.queueCommand({ kind: 'move', ids: [blades[3]], ...M(7.5, 25.5) });
    sim.queueCommand({ kind: 'move', ids: [lavis[0]], ...M(4.5, 14) });
    sim.queueCommand({ kind: 'move', ids: [lavis[1]], ...M(10, 23) });
    sim.queueCommand({ kind: 'move', ids: [namers[0]], ...M(6.5, 19.5) });
    sim.queueCommand({ kind: 'move', ids: [namers[1]], ...M(9.5, 26.5) });
    sim.queueCommand({ kind: 'move', ids: [yah[0]], ...M(3.5, 21.5) });
    sim.queueCommand({ kind: 'move', ids: [yah[1]], ...M(3.5, 23.5) });
    sim.queueCommand({ kind: 'move', ids: ids('inf_medic_squad'), ...M(4.5, 24.5) });
    sim.queueCommand({ kind: 'move', ids: ids('mortar_team'), ...M(3.5, 26.5) });
    sim.queueCommand({ kind: 'move', ids: ids('ugv_recon_dog'), ...M(6.5, 16.5) });
    sim.queueCommand({ kind: 'attackMove', ids: squads, ...M(16.5, 14.5) });
  });

  const lee = () => foesIn(sim, [8, 2, 34, 17], ['atgm_cell']).filter((i) => ID(i) === 'atgm_cell');
  const barrier = () => foesIn(sim, [28, 16, 20, 16], ['rpg_team', 'atgm_cell']).filter((i) => ['rpg_team', 'atgm_cell'].includes(ID(i)));
  let leeDead = false;
  let through = false;
  let stageX = 20;
  const claimed = new Map<number, number>(); // blade -> structure
  const mid = (st: number) => ({ x: (S.minX[st] + S.maxX[st] + 1) / 2, y: (S.minY[st] + S.maxY[st] + 1) / 2 });
  const dist2 = (i: number, st: number) => (px(i) - mid(st).x) ** 2 + (py(i) - mid(st).y) ** 2;
  const tunnelOrdered = new Set<number>();
  // The sniper keeps nine tiles from any garrison (a cell in a firing position reaches seven) and only follows the line as the blades clear them.
  const sniperSpot = (x: number): number => {
    let sx = x;
    while (sx > 8 && foesIn(sim, [sx - 9, 19, 18, 12]).length > 0) sx -= 1;
    return sx;
  };

  for (let s = 1; s < 840; s += 1) at(s, () => {
    const lk = lee();
    if (!leeDead && s >= 3 && lk.length === 0) {
      leeDead = true;
      sim.queueCommand({ kind: 'move', ids: live(squads), ...M(8.5, 24.5) });
    }
    if (!leeDead) {
      // The squads and the sniper hunt the lee missile teams (rifles and the rifle-calibre round cost the hamlet nothing); a team that is out of sight is walked towards.
      const shooters = [...squads, ...snip];
      if (!focus(shooters, lk) && s % 3 === 0 && lk.length > 0) {
        const t = lk[0];
        sim.queueCommand({ kind: 'move', ids: live(shooters), ...M(Math.max(12.5, px(t) - 6), 14.5) });
        last = new Map();
      }
    }
    const bar = barrier();
    const eastK = bar.filter((i) => px(i) > 37);
    const westBar = bar.filter((i) => px(i) <= 37);
    if (leeDead) {
      const strike = [...lavis, ...namers, ...snip];
      focus(strike, bar);
      const anyTarget = live(strike).some((sh) => bar.some((t) => sim.canFocus(sh, t)));
      if (!anyTarget && s % 3 === 0 && stageX < 29) stageX += 1;
      if (s % 3 === 0 && !anyTarget) {
        if (stageX >= 29 && westBar.length === 0) {
          // only the missile team behind the wall is left: look at it through the boulder gap from the south
          sim.queueCommand({ kind: 'move', ids: live(lavis).slice(0, 1), ...M(31, 28.5) });
          sim.queueCommand({ kind: 'move', ids: live(lavis).slice(1), ...M(30, 27.5) });
          sim.queueCommand({ kind: 'move', ids: live(snip), ...M(sniperSpot(29.5), 28.5) });
          sim.queueCommand({ kind: 'move', ids: live(namers), ...M(27, 27.5) });
        } else {
          sim.queueCommand({ kind: 'move', ids: live(lavis).slice(0, 1), ...M(stageX, 26.5) });
          sim.queueCommand({ kind: 'move', ids: live(lavis).slice(1), ...M(stageX - 1, 25.5) });
          sim.queueCommand({ kind: 'move', ids: live(namers), ...M(stageX - 3, 26.5) });
          sim.queueCommand({ kind: 'move', ids: live(snip), ...M(sniperSpot(stageX - 6), 27.5) });
        }
        last = new Map();
      }
      // the shafts: the Yahalom teams, west and centre first, the east mouth once the near end of the barrier is down
      // (a team that stands still far from its route is re-sent every few seconds: the first order can be given before the way is open)
      const MOUTH = [[14, 24, 14, 20], [24, 25, 24, 21], [31, 26, 32, 21]];
      for (const [k, y] of [[0, 0], [1, 1], [2, 0]] as const) {
        if (k === 2 && (westBar.length > 0 || sim.tnAlive[0] + sim.tnAlive[1] > 0)) continue;
        if (sim.tnAlive[k] === 0) continue;
        if (foesIn(sim, [MOUTH[k][0] - 9, 19, 18, 12]).length > 0) continue;
        const team = live(yah)[y] ?? live(yah)[0];
        if (team === undefined) continue;
        const [mx, my, wx, wy] = MOUTH[k];
        const near = Math.min(Math.hypot(px(team) - mx, py(team) - my), Math.hypot(px(team) - wx, py(team) - wy));
        if (!tunnelOrdered.has(k) || (s % 4 === 0 && sim.state.moving[team] === 0 && near > 5)) {
          tunnelOrdered.add(k);
          sim.queueCommand({ kind: 'chargeTunnel', ids: [team], tunnel: k });
        }
      }
      // blades: nearest unclaimed work, gated by the barrier
      for (const b of live(blades)) {
        const cur = claimed.get(b);
        if (cur !== undefined && S.alive[cur] === 1) continue;
        const limit = bar.length === 0 ? 99 : westBar.length === 0 && eastK.length > 0 ? 33 : 26;
        const cand = works.filter((w) => S.alive[w] === 1 && ![...claimed.entries()].some(([k, v]) => v === w && k !== b && sim.state.alive[k] === 1 && S.alive[v] === 1) && S.minX[w] <= limit);
        cand.sort((a, c) => dist2(b, a) - dist2(b, c));
        if (cand.length > 0) { claimed.set(b, cand[0]); sim.queueCommand({ kind: 'demolish', ids: [b], structure: cand[0] }); }
      }
    }
    if (leeDead && !through && works.every((w) => S.alive[w] === 0)) {
      through = true;
      live(blades).forEach((b, k) => sim.queueCommand({ kind: 'move', ids: [b], ...M(41.5 + 2 * (k % 2), 24.5 + 2 * ((k >> 1) % 2)) }));
    }
  });
};
