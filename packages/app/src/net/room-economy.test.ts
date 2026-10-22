// @vitest-environment jsdom
//
// N3 Task 6: an economy room's dock, purse and Conduct are the VIEWER's side's.
// A real `buildMatchWorld` room and a real `ReinforcementDock`, so a dock that
// reads side 0, or a click that dispatches side 0, fails here rather than as a
// Sarim host whose buys land on the KDF's line.
import { describe, expect, it } from 'vitest';
import { doctrines, units } from '@lions/data';
import { sidesOfFactions, validateConfig, type MatchConfig } from '@lions/net';
import type { Command } from '@lions/sim';
import { ReinforcementDock } from '../ui/production';
import type { DockUnit } from '../ui/dock-model';
import { buildMatchWorld, matchTick, type MatchWorld } from './match-world';
import { meshPlanFor } from '../mesh-catalogue';
import { roomDockMenu, roomDockRuntime, roomEconomyView, showsConduct } from './room-economy';
import { viewerSideOf } from './viewer';

function config(map: string, factions: ['kdf' | 'sarim', 'kdf' | 'sarim']): MatchConfig {
  const sides = sidesOfFactions(factions);
  const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: 1234, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
  if (c === null) throw new Error('bad fixture');
  return c;
}

const byId = units as Record<string, (typeof units)[keyof typeof units]>;

/** The dock `main.ts` mounts for seat `seat`: the viewer's menu, its side, no support. */
function roomDock(w: MatchWorld, cfg: MatchConfig, seat: 0 | 1): { dock: ReinforcementDock; host: HTMLElement; sent: Command[]; me: 0 | 1 } {
  const rt = w.runtime;
  if (rt === null) throw new Error('not an economy room');
  const me = viewerSideOf(cfg, seat);
  document.body.replaceChildren();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const sent: Command[] = [];
  const list: DockUnit[] = roomDockMenu(w.factions[me]).map((id) => ({
    id,
    name: byId[id].name,
    logistics: byId[id].cost.logistics,
    buildTimeS: 20,
    bucket: 'soft',
    sprite: null,
    tags: [],
  }));
  const dock = new ReinforcementDock(host, {
    units: list,
    runtime: roomDockRuntime(rt, me),
    side: me,
    support: false,
    note: () => {},
    onArm: () => {},
    dispatch: (cmd) => sent.push(cmd),
  });
  return { dock, host, sent, me };
}

const tileIds = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLButtonElement>('.rl-tile[data-unit]')].map((el) => el.dataset.unit ?? '');

describe('an economy room\'s dock is the viewer\'s side (N3 Task 6)', () => {
  // Literals: an oracle that reads its expectation from the doctrine files cannot fail
  // when the dock reads the same file the wrong way round (CLAUDE.md).
  const KDF_MENU = ['mbt_lavi', 'ifv_namer', 'apc_eitan', 'inf_squad', 'at_team', 'mortar_team', 'jeep_shoded', 'recon_drone', 'dozer_d9', 'heli_peten', 'yahalom_squad'];
  const SARIM_MENU = ['sarim_rifles', 'atgm_cell', 'gun_truck', 'manpad_team', 'rocket_battery', 'recoilless_team'];

  it('a Sarim host (seat 0, side 1): the six Sarim menu ids in doctrine order, 4800 in the purse; build, cancelBuild and clearRally carry side 1', () => {
    const cfg = config('wadi_tarfan', ['sarim', 'kdf']);
    const w = buildMatchWorld(cfg);
    const r = roomDock(w, cfg, 0);
    expect(r.me).toBe(1);
    expect(tileIds(r.host)).toEqual(SARIM_MENU);
    const rt = w.runtime!;
    expect(roomEconomyView(rt, r.me, 'sarim').logistics).toBe(4800);
    expect(doctrines.sarim.budget.logistics_start).toBe(4800);
    r.host.querySelector<HTMLButtonElement>('.rl-tile[data-unit="atgm_cell"]')!.click();
    expect(r.sent).toEqual([{ kind: 'build', side: 1, unit: 'atgm_cell' }]);
    // And it lands where it says: on side 1's line, paid from side 1's purse; side 0 untouched.
    w.sim.queueCommand(r.sent[0]);
    matchTick(w);
    expect(rt.productionLines(1)[0].current).toBe('atgm_cell');
    expect(rt.logisticsOf(1)).toBe(4800 - units.atgm_cell.cost.logistics);
    expect(rt.logisticsOf(0)).toBe(3000);
    expect(rt.productionLines(0)[0].current).toBeNull();
    // The row's own controls carry side 1 too: a rally set on side 1's line, the dock
    // repainted, then the line's cancel (the item in progress) and its rally clear.
    const exit = rt.productionLines(1)[0].exit;
    w.sim.queueCommand({ kind: 'setRally', side: 1, line: 0, x: exit[0], y: exit[1] });
    matchTick(w);
    expect(rt.productionLines(1)[0].rally).not.toBeNull();
    r.dock.refresh();
    r.sent.length = 0;
    const row = r.host.querySelector<HTMLElement>('.rl-line')!;
    row.querySelector<HTMLButtonElement>('.rl-line__item')!.click();
    row.querySelector<HTMLButtonElement>('.rl-line__clear')!.click();
    expect(r.sent).toEqual([
      { kind: 'cancelBuild', side: 1, line: 0, index: -1 },
      { kind: 'clearRally', side: 1, line: 0 },
    ]);
  });

  it('the KDF guest (seat 1, side 0): the KDF menu in its order, 3000, a click sends build{side:0}', () => {
    const cfg = config('wadi_tarfan', ['sarim', 'kdf']);
    const w = buildMatchWorld(cfg);
    const r = roomDock(w, cfg, 1);
    expect(r.me).toBe(0);
    expect(tileIds(r.host)).toEqual(KDF_MENU);
    expect(roomEconomyView(w.runtime!, r.me, 'kdf').logistics).toBe(3000);
    r.host.querySelector<HTMLButtonElement>('.rl-tile[data-unit="inf_squad"]')!.click();
    expect(r.sent).toEqual([{ kind: 'build', side: 0, unit: 'inf_squad' }]);
  });

  it('draws no fire-support tile in a room (LD5), and a support hotkey arms nothing', () => {
    const cfg = config('tel_marum', ['kdf', 'sarim']);
    const r = roomDock(buildMatchWorld(cfg), cfg, 0);
    expect(r.host.querySelectorAll('[data-support]')).toHaveLength(0);
    expect(r.dock.press('air_strike')).toBe(false);
  });

  it('a mirror room has no runtime, and so no dock', () => {
    expect(buildMatchWorld(config('tel_marum', ['kdf', 'kdf'])).runtime).toBeNull();
  });
});

describe('Conduct is the KDF seat\'s, never the Sarim seat\'s (LD7)', () => {
  it('the KDF viewer\'s purse carries Conduct; the Sarim viewer\'s does not', () => {
    const w = buildMatchWorld(config('tel_marum', ['kdf', 'sarim']));
    const rt = w.runtime!;
    expect(roomEconomyView(rt, 0, 'kdf').conduct).toBe(rt.roeScore);
    expect('conduct' in roomEconomyView(rt, 1, 'sarim')).toBe(false);
    expect([showsConduct('kdf'), showsConduct('sarim')]).toEqual([true, false]);
  });
});

describe('an economy room loads its camps\' mesh (N3 Task 6)', () => {
  // main.ts hands `meshPlanFor` the mission's structures, and a room has no mission: the
  // camps come from the room's own world (`MatchWorld.structureTypes`), or the camp draws
  // as a proxy slab.
  it('the room\'s mesh plan has the camp in a KDF-v-Sarim room, and not in a mirror room', () => {
    for (const map of ['tel_marum', 'wadi_tarfan']) {
      const eco = buildMatchWorld(config(map, ['sarim', 'kdf']));
      expect(eco.structureTypes).toEqual(['camp']);
      expect(meshPlanFor(eco.map, new Set(), [...eco.structureTypes]).buildings.has('camp')).toBe(true);
      const mirror = buildMatchWorld(config(map, ['kdf', 'kdf']));
      expect(mirror.structureTypes).toEqual([]);
      expect(meshPlanFor(mirror.map, new Set(), [...mirror.structureTypes]).buildings.has('camp')).toBe(false);
    }
  });
});
