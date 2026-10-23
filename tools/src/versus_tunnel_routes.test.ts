// GH-681 T5 (spec §7.5): containment, per authored versus route. For each of the
// eight routes in data/versus/*.json, on a real `buildMatchWorld` room whose Sarim
// seat stands on that route's end, a Sarim foot unit is ordered below by its own
// seat and let arrive at the vent. Then nothing reaches it -- splash over every
// tile of the route, suppression, a smoke screen on its vent, a `move` from the
// KDF seat and one from its own -- and it keeps full HP, stays below and does not
// move; and only then a Yahalom's `chargeTunnel` on the identified route kills it.
//
// Every "nothing reached it" has a CONTROL beside it that the same act does
// reach, so no step passes because it did nothing: the splash wounds a Sarim
// rifleman standing on the vent, the smoke is read back on the vent tile, and
// the KDF seat's move is refused by ownership while the sim is still handed it.
//
// Falsified (the commit message lists the runs): the containment strip in
// `applyCommands` widened to let `move` through (`&& cmd.kind !== 'move'`) turns
// all eight red on `moving`. Fire is guarded twice in the sim, and the test sees
// it only when both go: `splashDirect`'s `tunnelIn` skip deleted ALONE stays green
// (applyDamage's own `tunnelIn` return still holds), and that one dropped too
// turns all eight red on the HP assertion.
import { describe, expect, it } from 'vitest';
import { fx, type Command } from '@lions/sim';
import { versusRules, type VersusRulesJson } from '@lions/data';
import { sidesOfFactions, validateCommand, type Faction } from '@lions/net';
import { buildMatchWorld, matchTick } from '../../packages/app/src/net/match-world';
import { seatWorldFor } from '../../packages/app/src/net/frame-step';
import { versusConfig } from './net/test-config';

const SECOND = 20;

interface RouteCase {
  map: string;
  end: 'friendly' | 'hostile';
  id: string;
}

/** Every route the rules files author, read from the files rather than listed. */
const CASES: RouteCase[] = Object.values(versusRules as Record<string, VersusRulesJson>).flatMap((rules) =>
  (['friendly', 'hostile'] as const).flatMap((end) => (rules.tunnels?.[end] ?? []).map((t) => ({ map: rules.map, end, id: t.id }))),
);

/** A room where the Sarim seat stands on `end`: the host (seat 0) is friendly (LD1). */
function room(c: RouteCase) {
  const factions: [Faction, Faction] = c.end === 'friendly' ? ['sarim', 'kdf'] : ['kdf', 'sarim'];
  const config = versusConfig(c.map, { factions });
  const sides = sidesOfFactions(factions);
  const sarimSeat = (factions[0] === 'sarim' ? 0 : 1) as 0 | 1;
  const kdfSeat = (sarimSeat === 0 ? 1 : 0) as 0 | 1;
  const sarim = sides[sarimSeat];
  const kdf = sides[kdfSeat];
  const w = buildMatchWorld(config);
  const seatWorld = seatWorldFor(config, w.sim);
  const r = w.map.tunnels.findIndex((t) => t.id === c.id);
  return { w, seatWorld, r, sarim, kdf, sarimSeat, kdfSeat };
}

const tile = (p: readonly [number, number]): [number, number] => [fx.from(p[0] + 0.5), fx.from(p[1] + 0.5)];

describe('versus routes: a buried unit is contained on every authored route (GH-681, spec §7.5)', () => {
  it('reads the eight strawman routes from the rules files', () => {
    expect(CASES.map((c) => c.id).sort()).toEqual(['tm_n_east', 'tm_n_west', 'tm_s_east', 'tm_s_west', 'wt_f_north', 'wt_f_west', 'wt_h_east', 'wt_h_south']);
  });

  for (const c of CASES) {
    it(`${c.map} ${c.end} ${c.id}: fire, smoke and orders leave it be; the charge kills it`, () => {
      const { w, seatWorld, r, sarim, kdf, sarimSeat, kdfSeat } = room(c);
      const { sim } = w;
      const st = sim.state;
      expect(r, 'the room registers the route').toBeGreaterThanOrEqual(0);
      expect(sim.tunnelOwner(r)).toBe(sarim);
      const send = (cmd: Command, seat: 0 | 1): boolean => {
        const ok = validateCommand(cmd, seat, seatWorld);
        if (ok) sim.queueCommand(cmd);
        return ok;
      };
      const step = (ticks: number, until?: () => boolean): void => {
        for (let t = 0; t < ticks && !(until?.() ?? false); t++) matchTick(w);
      };

      // One Sarim foot unit, the one nearest the mouth; everyone else is taken off the board,
      // so nothing on the map can fight, spot or interfere.
      const points = w.map.tunnels[r].points;
      const [mx, my] = tile(points[0]);
      const foot = w.bySide[sarim]
        .filter((id) => !sim.unitTypes[st.typeIdx[id]].isAir && !sim.unitTypes[st.typeIdx[id]].wheeled)
        .sort((a, b) => Math.hypot(st.posX[a] - mx, st.posY[a] - my) - Math.hypot(st.posX[b] - mx, st.posY[b] - my));
      const buried = foot[0];
      for (let i = 0; i < sim.entityCount; i++) if (i !== buried) sim.debugKill(i);

      expect(send({ kind: 'enterTunnel', ids: [buried], tunnel: r }, sarimSeat), 'its own seat may send it below').toBe(true);
      step(180 * SECOND, () => st.tunnelIn[buried] === r && st.tunnelEta[buried] === 0);
      expect(st.tunnelIn[buried], 'it went below').toBe(r);
      expect(st.tunnelEta[buried], 'and reached the vent').toBe(0);
      const hp = st.hp[buried];
      const at = [st.posX[buried], st.posY[buried]];

      // FIRE: a heavy splash on every half tile of the route, the vent and the mouth
      // included, and a direct suppression. CONTROL: a Sarim rifleman on the vent's
      // surface takes the same splash.
      const vent = sim.tunnelVent(r);
      const control = sim.spawn(w.typeOf.get('sarim_rifles') ?? -1, sarim, vent[0], vent[1]);
      const controlHp = st.hp[control];
      let len = 0;
      for (let k = 1; k < points.length; k++) len += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
      for (let d = 0; d <= len + 0.5; d += 0.5) {
        const [x, y] = sim.tunnelPointAt(r, fx.from(Math.min(d, len)));
        sim.debugSplash(fx.add(x, fx.from(0.5)), fx.add(y, fx.from(0.5)), fx.from(1.5), fx.from(400), fx.from(1), -1, -1);
      }
      sim.debugSuppress(buried, fx.from(1.5));
      expect(st.hp[control], 'CONTROL: the splash reaches a man on the vent').toBeLessThan(controlHp);
      expect(st.hp[buried], 'the splash does not reach him below').toBe(hp);
      expect(st.suppression[buried]).toBe(0);
      sim.debugKill(control);

      // SMOKE on the vent, from a KDF Yahalom beside it (it is also the charge team below).
      const yahType = w.typeOfBySide[kdf].get('yahalom_squad') ?? -1;
      const yah = sim.spawn(yahType, kdf, vent[0], fx.add(vent[1], fx.from(1)));
      expect(send({ kind: 'smoke', ids: [yah], x: vent[0], y: vent[1] }, kdfSeat)).toBe(true);
      step(2 * SECOND);
      expect(sim.smokeAt(vent[0] >> 16, vent[1] >> 16), 'CONTROL: the screen is on the vent').toBeGreaterThan(0);

      // ORDERS: a move from the KDF seat (refused by ownership; the sim is handed it anyway)
      // and one from its own seat (passes ownership; the sim's containment strips it).
      const away: Command = { kind: 'move', ids: [buried], x: fx.from(2.5), y: fx.from(2.5) };
      expect(send(away, kdfSeat), 'the KDF seat may not order a Sarim unit').toBe(false);
      sim.queueCommand(away);
      expect(send({ ...away }, sarimSeat), 'its own seat may').toBe(true);
      step(1);
      expect(st.moving[buried], 'no order moves a buried unit').toBe(0);
      step(5 * SECOND);
      expect(st.alive[buried]).toBe(1);
      expect(st.tunnelIn[buried], 'still below').toBe(r);
      expect([st.posX[buried], st.posY[buried]], 'still where it went down').toEqual(at);
      expect(st.hp[buried], 'full HP').toBe(hp);

      // THE COLLAPSE: the Yahalom identifies the route and charges it; the earth closes over him.
      step(60 * SECOND, () => sim.tunnelContactLevel(kdf, r) === 2);
      expect(sim.tunnelContactLevel(kdf, r), 'the Yahalom identifies the route').toBe(2);
      expect(send({ kind: 'chargeTunnel', ids: [yah], tunnel: r }, kdfSeat)).toBe(true);
      let collapsed = false;
      for (let t = 0; t < 120 * SECOND && !collapsed; t++) {
        for (const e of matchTick(w).sim) if (e.kind === 'tunnelCollapsed' && e.tunnel === r) collapsed = true;
      }
      expect(collapsed, 'the charge brings the route down').toBe(true);
      expect(st.alive[buried], 'and kills the man below').toBe(0);
    }, 60_000);
  }
});
