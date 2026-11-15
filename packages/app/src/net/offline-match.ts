/**
 * An offline versus match against the computer seat (GH-1388): the config both sides run, the transport that is the whole "room", and
 * the arming the lobby does. Loaded on demand (a dynamic import from `main.ts`) so the script, the view and the fog tracker stay out of
 * the main chunk until a player asks for them.
 *
 * There is no room, no socket and no request. The human is seat 0 and the host end; the computer is seat 1. `OfflineMatchTransport` is a
 * `LocalTransport` with a second seat: a frame per requested tick, the human's queued commands in the first frame of a batch, the
 * computer's in the frame of the tick they were decided for. The battlefield runs it down the same path as a room (`runFrames`,
 * `applyFrame`'s ownership check, the hash-tick outcome), and local pacing, pause and speed apply as in single-player.
 */
import { canonicalOrder, callsignOrDefault, factionsOfMatchup, sidesOfFactions, validateConfig, type Frame, type Matchup, type MatchConfig, type MatchTransport, type Seat, type Stamped, type TransportStatus } from '@lions/net';
import type { Command } from '@lions/sim';
import { ComputerSeat, type ComputerSeatOptions } from './computer/computer-seat';
import type { MatchWorld } from './match-world';
import { OFFLINE_CODE, armOffline, type OfflineHandle } from './offline-slot';

/** The human's seat. The computer takes the other. */
export const HUMAN_SEAT: Seat = 0;
export const COMPUTER_SEAT: Seat = 1;

export class OfflineMatchTransport implements MatchTransport, OfflineHandle {
  readonly local = true;
  readonly offline = true as const;
  private nextTick = 0;
  private seq = 0;
  private pending: Stamped[] = [];
  private closed = false;

  constructor(private readonly computer: ComputerSeat) {}

  attach(world: MatchWorld): void {
    this.computer.attach(world);
  }

  queueCommand(cmd: Command): void {
    if (this.closed) return;
    this.pending.push({ seat: HUMAN_SEAT, seq: this.seq++, cmd });
  }

  take(maxTicks: number): Frame[] {
    const out: Frame[] = [];
    if (this.closed) return out;
    for (let i = 0; i < maxTicks; i++) {
      const tick = this.nextTick;
      // The computer decides from the world as it stands at the start of `tick`, so a decision tick opens a batch: the frames before it
      // have all been run by the caller (the next `take` comes after them).
      if (i > 0 && this.computer.decidesAt(tick)) break;
      const human = i === 0 ? this.pending : [];
      if (i === 0) this.pending = [];
      out.push({ tick, cmds: canonicalOrder([...human, ...this.computer.commandsFor(tick)]) });
      this.nextTick++;
    }
    return out;
  }

  reportTick(): void {}
  status(): TransportStatus { return { kind: 'local' }; }
  close(): void { this.closed = true; }
}

export interface OfflineRequest {
  map: string;
  /** The human's side of the pairing: `kdf` or `sarim` plays the skirmish economy, `mirror` the placed forces. */
  matchup: Matchup;
  /** The human's name; the computer's is `computerName`. */
  callsign: string;
  /** What the computer seat is called wherever a seat is named: the caller passes `t('versus.cpu.callsign')`, so every word is a catalogue key. */
  computerName: string;
  /** The build string; informational offline. */
  build: string;
  seed: number;
}

/** The match both sides run: annihilation, matched kits, real time, the human at the host end. */
export function offlineConfig(r: OfflineRequest): MatchConfig {
  const factions = factionsOfMatchup(r.matchup);
  const sides = sidesOfFactions(factions);
  const seat = (s: Seat, kind: 'human' | 'bot', name: string) => ({
    seat: s, side: sides[s], faction: factions[s], kit: 'matched', tiers: {}, unlocks: [],
    player: kind === 'bot' ? 'computer' : 'you', callsign: name, kind,
  });
  const c = validateConfig({
    matchId: OFFLINE_CODE, code: OFFLINE_CODE, seed: r.seed, map: r.map, mode: 'versus',
    seats: [seat(HUMAN_SEAT, 'human', callsignOrDefault(r.callsign)), seat(COMPUTER_SEAT, 'bot', r.computerName)],
    pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: r.build, dataDigest: 0,
  });
  if (c === null) throw new Error(`offline match: the config for ${r.map} (${r.matchup}) did not validate`);
  return c;
}

/** The transport and config for a request, not yet armed. */
export function offlineMatch(r: OfflineRequest, seat: Partial<ComputerSeatOptions> = {}): { transport: OfflineMatchTransport; config: MatchConfig; computer: ComputerSeat } {
  const config = offlineConfig(r);
  const computer = new ComputerSeat({ seat: COMPUTER_SEAT, side: config.seats[COMPUTER_SEAT].side, ...seat });
  return { transport: new OfflineMatchTransport(computer), config, computer };
}

/** Arms a match for the next `connectMatch` and returns the `?net=` value that opens it. */
export function armOfflineMatch(r: OfflineRequest): string {
  const m = offlineMatch(r);
  armOffline({ transport: m.transport, seat: HUMAN_SEAT, config: m.config });
  return OFFLINE_CODE;
}
