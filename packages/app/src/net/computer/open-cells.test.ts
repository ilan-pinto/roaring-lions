import { afterEach, describe, expect, it } from 'vitest';
import { factionsOfMatchup, flagSetupFor, type Frame, type MatchTransport } from '@lions/net';
import { buildMatchWorld, matchTick } from '../match-world';
import { runFrames, seatWorldFor } from '../frame-step';
import { dropOffline } from '../offline-slot';
import { HUMAN_SEAT, COMPUTER_SEAT, offlineConfig, offlineMatch, type OfflineRequest } from '../offline-match';
import { CLOSED_COMPUTER_CELLS, OPEN_COMPUTER_CELLS, allComputerCells, computerSeatOpen } from './open-cells';

afterEach(() => dropOffline());

const REQ = (c: { map: string; matchup: 'mirror' | 'kdf' | 'sarim'; winMode: 'points' | 'camp' | 'flag' | null }): OfflineRequest => ({
  map: c.map, matchup: c.matchup, ...(c.winMode === null ? {} : { winMode: c.winMode }), callsign: 'Ari', computerName: 'Basic computer', build: 'test+0', seed: 4321,
});

describe('where the lobby seats the computer (GH-1390)', () => {
  it('the cells are the ones a room can play: 31 of them (seven grounds, the pairings each allows, annihilation and the modes read fair)', () => {
    // 31 is the number of (ground, pairing, mode) triples the coverage probe plays: a literal, not a recount of the same tables.
    expect(allComputerCells().length).toBe(31);
  });

  it('the mirror annihilation is open on every ground, as it was before', () => {
    for (const map of ['beit_sahwan_outskirts', 'tel_marum', 'wadi_tarfan', 'milh_flats', 'rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l']) expect(computerSeatOpen(map, 'mirror', null), map).toBe(true);
  });

  it('a cell that is not a room is never open: an unknown ground, a pairing the ground does not play, a mode not offered there', () => {
    expect(computerSeatOpen('nowhere', 'mirror', null)).toBe(false);
    expect(computerSeatOpen('beit_sahwan_outskirts', 'kdf', null)).toBe(false);
    expect(computerSeatOpen('beit_sahwan_outskirts', 'mirror', 'flag')).toBe(false);
  });

  it('the table partitions the cells: every cell a room can play is open or closed, never both and never neither (a new ground or mode fails here until the probe has read it)', () => {
    const open = (c: { map: string; matchup: string; winMode: string | null }): boolean => OPEN_COMPUTER_CELLS.some((o) => o.map === c.map && o.matchup === c.matchup && o.winModes.includes(c.winMode as never));
    const closed = (c: { map: string; matchup: string; winMode: string | null }): boolean => CLOSED_COMPUTER_CELLS.some((o) => o.map === c.map && o.matchup === c.matchup && o.winMode === c.winMode);
    const cells = allComputerCells();
    for (const c of cells) expect(open(c) !== closed(c), `${c.map} ${c.matchup} ${c.winMode}`).toBe(true);
    // And nothing in the table is a cell that does not exist.
    for (const o of OPEN_COMPUTER_CELLS) for (const w of o.winModes) expect(cells.some((c) => c.map === o.map && c.matchup === o.matchup && c.winMode === w), `${o.map} ${o.matchup} ${w}`).toBe(true);
    // The lead's ruling of 20 Nov: a guard held at home is not a stall, so the six skirmish-economy annihilation cells open. All 31 are open, none closed.
    expect(cells.filter(open).length).toBe(31);
    expect(cells.filter(closed).length).toBe(0);
  });

  it('the six cells the idle-at-home reading had closed are open, for the KDF and the Sarim human alike', () => {
    for (const map of ['tel_marum', 'wadi_tarfan', 'wadi_tarfan_l']) for (const matchup of ['kdf', 'sarim'] as const) expect(computerSeatOpen(map, matchup, null), `${map} ${matchup}`).toBe(true);
  });

  it('with no cell closed, a cell the table does not list is still refused, and arming it throws (a new ground stays closed until the probe has read it)', () => {
    expect(CLOSED_COMPUTER_CELLS).toEqual([]);
    expect(computerSeatOpen('nowhere', 'mirror', null)).toBe(false);
    expect(() => offlineConfig(REQ({ map: 'nowhere', matchup: 'mirror', winMode: null }))).toThrow(/not open/);
    // A real ground with a mode the table does not list is refused the same way.
    expect(computerSeatOpen('tel_marum', 'kdf', 'points')).toBe(false);
  });

  it('every closed cell, if any is ever listed, has its reason, is refused, and arming it throws', () => {
    for (const c of CLOSED_COMPUTER_CELLS) {
      const key = `${c.map}|${c.matchup}|${c.winMode}`;
      expect(c.why.length, key).toBeGreaterThan(10);
      expect(computerSeatOpen(c.map, c.matchup, c.winMode), key).toBe(false);
      expect(() => offlineConfig(REQ(c)), key).toThrow(/not open/);
    }
  });

  it('every open cell arms a valid match: the human takes the pairing at seat 0, the computer the other faction at seat 1, the win mode is the cell\'s', () => {
    for (const c of allComputerCells().filter((x) => computerSeatOpen(x.map, x.matchup, x.winMode))) {
      const cfg = offlineConfig(REQ(c));
      const key = `${c.map} ${c.matchup} ${c.winMode}`;
      expect(cfg.seats[HUMAN_SEAT].faction, key).toBe(factionsOfMatchup(c.matchup)[0]);
      expect(cfg.seats[COMPUTER_SEAT].faction, key).toBe(factionsOfMatchup(c.matchup)[1]);
      expect(cfg.seats[COMPUTER_SEAT].kind, key).toBe('bot');
      expect(cfg.winMode ?? null, key).toBe(c.winMode);
    }
  });

  it('a flag room carries the set-up rules a room mints (the probe measured the flag cells with them); no other room does', () => {
    for (const c of allComputerCells().filter((x) => computerSeatOpen(x.map, x.matchup, x.winMode))) {
      const cfg = offlineConfig(REQ(c));
      expect(cfg.flagSetup === true, `${c.map} ${c.matchup} ${c.winMode}`).toBe(c.winMode === 'flag' && flagSetupFor(c.map, 'flag') === true);
    }
    // Four flag cells are open and each is a set-up map: a literal, so a mutation that drops the field cannot hide behind the same helper.
    const flagCells = allComputerCells().filter((x) => x.winMode === 'flag' && computerSeatOpen(x.map, x.matchup, x.winMode));
    expect(flagCells.length).toBe(4);
    for (const c of flagCells) expect(offlineConfig(REQ(c)).flagSetup, c.map).toBe(true);
  });

  it('the seat the lobby arms is the commander (slice 1: defend, zones, production, guard), not the bare rush script; the caller may still name another', () => {
    const seat = (m: ReturnType<typeof offlineMatch>): { o: { commander?: unknown; policy?: unknown } } => m.computer as unknown as { o: { commander?: unknown; policy?: unknown } };
    const req = REQ({ map: 'tel_marum', matchup: 'mirror', winMode: null });
    expect(typeof seat(offlineMatch(req)).o.commander).toBe('function');
    expect(seat(offlineMatch(req, { policy: () => [] })).o.commander).toBeUndefined();
  });

  it('the seat plays in every open cell: through the battlefield\'s own frame loop, with a human who orders nothing, it gives orders inside 90 s', () => {
    for (const c of allComputerCells().filter((x) => computerSeatOpen(x.map, x.matchup, x.winMode))) {
      const { transport, config } = offlineMatch(REQ(c));
      const world = buildMatchWorld(config);
      transport.attach(world);
      let computerOrders = 0;
      const seen = transport as MatchTransport;
      const original = seen.take.bind(seen);
      seen.take = (max: number): Frame[] => {
        const frames = original(max);
        for (const f of frames) for (const s of f.cmds) if (s.seat === COMPUTER_SEAT) computerOrders++;
        return frames;
      };
      const step = { transport, sim: world.sim, seatWorld: seatWorldFor(config, world.sim), config, runTick: () => { matchTick(world); }, runtimeDigest: () => world.runtime?.digest() ?? 0, stopAfter: () => false };
      while (world.sim.tickCount < 1800) if (runFrames(step, 4).ran === 0) break;
      expect(computerOrders, `${c.map} ${c.matchup} ${c.winMode}`).toBeGreaterThan(0);
    }
  }, 600_000);
});
