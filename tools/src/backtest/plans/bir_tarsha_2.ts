import type { Plan } from '../playtest-run';
import { M, foesIn } from './bir_tarsha_util';

/** The roof push is skipped from this second on: a run that has not got the field clear by then is a slow one, and an ungated push cost time and units there (Harder seeds 15 and 22: 549 -> 748 s and 94 -> 64 Conduct). 420 keeps 29 of 30 Standard seeds. */
export const ROOF_PUSH_BY = 420;

/** II: the squads shepherd the cross road's residents west out of the mortar's reach, the camp buys infantry, the Lavi, the sniper and the tube take the missile teams and the mortar crew from the cross road, then the force steps into the gate. */
export const bt2Plan: Plan = (sim, rt, ids, at) => {
  const squads = ids('inf_squad');
  const feet = [...squads, ...ids('inf_medic_squad')];
  const armour = ids('mbt_lavi');
  // The tube stays out of it: its rounds on the west missile team land in the safe quarter (flagged, 5 Conduct a time).
  const guns = [...armour, ...ids('sniper_team')];
  at(0, () => {
    sim.queueCommand({ kind: 'move', ids: feet, ...M(23.5, 17.5) });
    sim.queueCommand({ kind: 'move', ids: guns, ...M(24.5, 21.5) });
    // The tube parks on the camp's side of the cross road, out of reach of the west flank: its rounds there land in the flagged safe quarter.
    sim.queueCommand({ kind: 'move', ids: ids('mortar_team'), ...M(26.5, 13.5) });
  });
  at(25, () => sim.queueCommand({ kind: 'move', ids: feet.filter((i) => sim.state.alive[i] === 1), ...M(14.5, 24.5) }));
  let builtD9 = false;
  const seen = new Set<number>([...squads, ...ids('inf_medic_squad'), ...guns, ...ids('mortar_team')]);
  const alive = (l: number[]): number[] => l.filter((i) => sim.state.alive[i] === 1);
  for (let s = 5; s < 400; s += 10)
    at(s, () => {
      // The camp saves for a D9 first (the terminal's garrison is dug out by the blade, not shelled), then buys squads.
      if (ids('dozer_d9').length === 0 && !builtD9) { if (rt.requestBuild('dozer_d9')) builtD9 = true; } else rt.requestBuild('inf_squad');
      const fresh: number[] = [];
      for (const id of ids('inf_squad')) if (!seen.has(id)) { seen.add(id); fresh.push(id); }
      if (fresh.length) sim.queueCommand({ kind: 'move', ids: fresh, ...M(24.5, 22.5) });
    });
  // The shepherds rejoin the force on the cross road once the residents are on their way.
  at(70, () => sim.queueCommand({ kind: 'move', ids: alive(feet), ...M(24.5, 22.5) }));
  // The Lavi and the sniper step out to the cross road's south edge, where the missile teams on the fence road are inside their sight (the Lavi sees 12, the sniper 16, a Kornet reaches 14).
  at(60, () => sim.queueCommand({ kind: 'move', ids: alive([...armour, ...ids('sniper_team')]), ...M(24.5, 26.5) }));
  let cleared = false;
  for (let s = 75; s < 420; s += 5)
    at(s, () => {
      // (Nothing south of y 38 is shot at: a round there lands in the flagged Badlands.)
      const hostile = foesIn(sim, [0, 22, 48, 16], ['atgm_cell', 'mortar_crew', 'rpg_team', 'charge_squad']);
      if (hostile.length > 0) sim.queueCommand({ kind: 'attack', ids: alive(guns), target: hostile[0] });
      // The D9 waits on the cross road from the moment the camp has built it; the gap is its job once the missile teams are down.
      if (!cleared) sim.queueCommand({ kind: 'move', ids: alive(ids('dozer_d9')), ...M(24.5, 20.5) });
      const posts = foesIn(sim, [0, 28, 48, 10], ['atgm_cell']).filter((i) => ['atgm_cell', 'mortar_crew'].includes(sim.unitTypes[sim.state.typeIdx[i]].id));
      if (!cleared && s > 170 && posts.length === 0 && foesIn(sim, [0, 0, 48, 34]).length === 0) {
        cleared = true;
        // Once the missile teams are down the Lavi and the sniper stand clear of the west observation post at (18,33): a round at it lands in the flagged safe quarter (5 Conduct a time).
        sim.queueCommand({ kind: 'move', ids: alive(armour), ...M(34.5, 29.5) });
        sim.queueCommand({ kind: 'move', ids: alive(ids('sniper_team')), ...M(34.5, 26.5) });
      }
      if (cleared) {
        sim.queueCommand({ kind: 'move', ids: alive(ids('dozer_d9')), ...M(23.5, 35.5) });
        // While anything of theirs stands in the gate zone the force closes on it (a D9 alone at the terminal does not last); otherwise the squads wait on the cross road, east of the
        // safe quarter, and the Lavi and the sniper stand clear of the west post: a round at it lands in the flagged safe quarter (5 Conduct a time).
        // Nothing south of the terminal's far wall (y 38) is engaged: a round there lands in the flagged Badlands.
        const near = foesIn(sim, [15, 30, 18, 8], ['rpg_team', 'atgm_cell', 'charge_squad']);
        if (near.length > 0) {
          // Each shooter takes the first one the sim lets it focus (an RPG team in the rubble kills the D9 if nobody does); with none in view the force closes on the terminal.
          let focused = false;
          for (const group of [ids('inf_squad'), armour, ids('sniper_team')]) {
            const shooters = alive(group);
            if (shooters.length === 0) continue;
            const t = near.find((x) => sim.canFocus(shooters[0], x));
            if (t !== undefined) { sim.queueCommand({ kind: 'attack', ids: shooters, target: t }); focused = true; }
          }
          if (!focused && s % 10 === 0) sim.queueCommand({ kind: 'attackMove', ids: alive([...ids('inf_squad'), ...armour, ...ids('sniper_team')]), ...M(27.5, 29.5) });
        } else if (s % 10 === 0) {
          sim.queueCommand({ kind: 'move', ids: alive([...ids('inf_squad'), ...ids('inf_medic_squad')]), ...M(26.5, 24.5) });
          sim.queueCommand({ kind: 'move', ids: alive(armour), ...M(34.5, 29.5) });
          sim.queueCommand({ kind: 'move', ids: alive(ids('sniper_team')), ...M(34.5, 26.5) });
        }
      }
    });
  // The roof (the secondary `take_the_roof`, GH-1438). The terminal's garrison, one militia cell at (26.5,36.5), stands inside the roof zone and contests it, and on some seeds (18) it is still alive
  // when the mission is won, because nothing in this plan shoots it: so the Lavi and the sniper take it (north of y 38, so no round lands in the Badlands), and once it is down two squads stand
  // in the zone for the 15 s the hold takes and then go back to the plan's own orders (left there one was lost in the second wave).
  let garrison = -1;
  at(0, () => {
    let bd = 1;
    for (let i = 0; i < sim.entityCount; i++) {
      if (sim.state.side[i] !== 1 || sim.state.alive[i] !== 1) continue;
      const d = Math.hypot(Number(sim.state.posX[i]) / 65536 - 26.5, Number(sim.state.posY[i]) / 65536 - 36.5);
      if (d <= bd) { bd = d; garrison = i; }
    }
  });
  for (let s = 100; s <= ROOF_PUSH_BY; s += 5)
    at(s, () => {
      if (rt.objectiveStatus('take_the_roof') === 'complete') return; // held: the squads go back to the plan's own orders
      // Only when the plan has nothing else to fight: the push takes the Lavi and the sniper off the missile teams and the mortar, and on a Harder seed (15) it cost 200 s and two units.
      if (foesIn(sim, [0, 0, 48, 38]).some((i) => i !== garrison)) return;
      if (garrison >= 0 && sim.state.alive[garrison] === 1) {
        sim.queueCommand({ kind: 'attack', ids: alive([...armour, ...ids('sniper_team')]), target: garrison });
        return;
      }
      sim.queueCommand({ kind: 'move', ids: alive(ids('inf_squad')).slice(0, 2), ...M(26.5, 35.5) });
    });
};
