/**
 * The arena's players (N4b task 12, decision D8): two scripted, fog-honest
 * baselines -- `passive` and `rush` -- and the in-process player that drives an
 * `AgentClient` on a room with one of them. They are the arena's CONTROLS, not
 * a strong AI: `rush` beating `passive` and `passive` drawing `passive` is
 * what says the arena can tell two players apart at all.
 *
 * A policy sees a `SideView` and nothing else: this seat's own force, the
 * contacts in its fog, and the two camps a human also reads off the map. It
 * is handed no `Sim` and no `MatchWorld`, so it cannot see through the fog.
 * What it returns goes through the client's order desk (decision D4: at most
 * one flush of at most four commands every 20 ticks), by the same path a
 * model's `order` takes.
 */
import type { Command } from '@lions/sim';
import { fx } from '@lions/sim';
import type { Seat } from '@lions/net';
import { AgentClient } from './agent-client';
import type { SideView } from './view';

/** May be async: an external or slow policy is a promise; the in-process
 *  player never awaits past `roundWallMs`. */
export type Policy = (view: SideView) => Command[] | Promise<Command[]>;

/** Orders nothing, ever: the control that must lose to `rush` and draw itself. */
export const passive: Policy = () => [];

/** The room's cap on ids in one command (#566). */
const MAX_IDS_PER_COMMAND = 256;

/** A tile's centre, Q16.16: what a human's click on that tile sends. */
const tileCentre = (t: number): number => fx.from(t + 0.5);

/** How far from its own camp a unit still counts as "at home". */
export const RUSH_HOME_TILES = 10;

/**
 * Attack-move on the centroid of the contacts this seat can see, or, seeing
 * none, on the enemy's camp -- the anchor a human also knows from the map --
 * with every unit that is idle and still at home. Reads only the view.
 *
 * Decision D8, as refined (ruled faithful, review round 1): rush never breaks
 * off an engagement. A fresh order clears a unit's engagement and stance
 * (`sim.ts`, the move/attackMove handler), so a unit that is shooting, or
 * under way, is never re-ordered: only the view's `idle` flag (the player's
 * own idle finder, `isIdle`) is. And a unit already out is not re-sent: the
 * order carries `sweep` (the cursor's sweep, which `cleanCommand` carries),
 * so having arrived it hunts what its OWN side has seen by itself. What is
 * left at home -- the start, a unit that walked back -- is what rush commits.
 *
 * Measured, not assumed (task-12 report, review round 1; pure sim at the
 * relay's latency, tel_marum, pace 60, cap 12,000): on 20 held-out seeds
 * (2..21) x both seat orders rush scores 0.750 (30 won, 10 lost) -- 17-3
 * from the west, 13-7 from the east, where a passive force waiting below
 * the pass is the stronger side. Every fog-honest variant tried read
 * 0.525-0.750 there. It is a control that tells two players apart, not a
 * dominance.
 */
export const rush: Policy = (view) => {
  const ids = view.units
    .filter((u) => u.flags.includes('idle') && Math.hypot(u.tile[0] - view.camp[0], u.tile[1] - view.camp[1]) <= RUSH_HOME_TILES)
    .map((u) => u.id);
  if (ids.length === 0) return [];
  let tx: number;
  let ty: number;
  if (view.contacts.length > 0) {
    let sx = 0;
    let sy = 0;
    for (const c of view.contacts) { sx += c.tile[0]; sy += c.tile[1]; }
    tx = Math.floor(sx / view.contacts.length);
    ty = Math.floor(sy / view.contacts.length);
  } else {
    [tx, ty] = view.enemyCamp;
  }
  const out: Command[] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_COMMAND) {
    out.push({ kind: 'attackMove', ids: ids.slice(i, i + MAX_IDS_PER_COMMAND), x: tileCentre(tx), y: tileCentre(ty), sweep: true });
  }
  return out;
};

/** What the arena hands a player for one seat of one room. */
export interface SeatStart {
  /** The game's origin: the local relay's `url`. */
  server: string;
  /** The `Origin` to send (decision D9: the server's own). */
  origin: string;
  code: string;
  seat: Seat;
  ticket: string;
  build: string;
  /** The arena's cap: the player runs no frame past this tick and stops
   *  there on its own, so seat 0's sim can be read AT the cap (`capOutcome`).
   *  Absent: it plays until the match ends or it is stopped. */
  capTicks?: number;
  /** Where a player that runs a process appends that process's stdout and
   *  stderr (the arena's `<out>/<game>-<seat>.log`). An in-process player
   *  logs through its own `log` and ignores it. */
  logFile?: string;
}

export interface PlayerReport {
  /** Tokens the player spent, when it says; null for a scripted player. */
  tokens: number | null;
  /** Policy calls abandoned for not answering in time: `roundWallMs` in a
   *  paced room, `REALTIME_POLICY_MS` in a realtime one. A realtime turn that
   *  comes round while a call is still pending is skipped, not counted again. */
  timeouts: number;
  errors: string[];
}

export interface RunningPlayer {
  /** The seat's own client, when the player runs in this process. */
  readonly client: AgentClient | null;
  /** Resolves once the player is finished: a result, the room ending, its cap, a failure, or `stop()`. */
  done: Promise<PlayerReport>;
  /** Stops the player and closes its client. Idempotent. */
  stop(): Promise<void>;
}

export interface ArenaPlayer {
  readonly name: string;
  start(seat: SeatStart): Promise<RunningPlayer>;
}

/** A realtime room has no rounds: the policy runs every 100 ticks (5 s). */
export const REALTIME_EVERY_TICKS = 100;
/** ...and a realtime policy slower than its own turn counts a timeout. */
export const REALTIME_POLICY_MS = REALTIME_EVERY_TICKS * 50;
/** The most errors a report keeps: a policy that throws every round says so in the first few. */
const MAX_ERRORS = 32;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * An in-process player: an `AgentClient` on the seat, and `policy(view)` run
 * once per round (paced) or every `REALTIME_EVERY_TICKS` (realtime). In a
 * paced room the player is the "model": it runs the round's frames, asks the
 * policy, hands the answer to the desk, flushes it, and only then says
 * `done(round)` -- for a round whose frames it has all run, never on frame
 * receipt. A policy that does not answer within the room's `roundWallMs` is
 * abandoned and counted in `timeouts`: the room releases that round by wall
 * time (decision D5), no `done` is sent for it, and a late answer is dropped.
 */
export function inProcess(name: string, policy: Policy, o: { log?: (line: string) => void } = {}): ArenaPlayer {
  return {
    name,
    start: (s) => Promise.resolve(runInProcess(policy, s, o.log ?? ((line) => { process.stderr.write(`${line}\n`); }))),
  };
}

function runInProcess(policy: Policy, s: SeatStart, log: (line: string) => void): RunningPlayer {
  const client = new AgentClient({ server: s.server, code: s.code, ticket: s.ticket, build: s.build, role: 'seat', seat: s.seat, log });
  const report: PlayerReport = { tokens: null, timeouts: 0, errors: [] };
  const error = (line: string): void => { if (report.errors.length < MAX_ERRORS) report.errors.push(line); };
  let finished = false;
  let capped = false;
  let loop: ReturnType<typeof setInterval> | null = null;
  /** The policy call in flight, by its token; a stale answer is dropped. */
  let pending: { token: number; timer: ReturnType<typeof setTimeout> } | null = null;
  let tokens = 0;
  let resolveDone: (r: PlayerReport) => void = () => {};
  const done = new Promise<PlayerReport>((res) => { resolveDone = res; });

  const finish = (): void => {
    if (finished) return;
    finished = true;
    if (loop !== null) clearInterval(loop);
    if (pending !== null) clearTimeout(pending.timer);
    pending = null;
    resolveDone(report);
  };

  const begin = (paced: boolean, every: number, waitMs: number): void => {
    let nextMark = every;
    const ask = (mark: number): void => {
      const token = ++tokens;
      const round = paced ? mark / every - 1 : null;
      const view = client.view();
      const timer = setTimeout(() => {
        if (pending?.token !== token) return;
        pending = null;
        report.timeouts++;
        log(`${round === null ? `tick ${mark}` : `round ${round}`}: the policy did not answer in ${waitMs} ms`);
      }, waitMs);
      pending = { token, timer };
      const settle = (cmds: readonly Command[] | null, why: string | null): void => {
        if (finished || pending?.token !== token) return;
        clearTimeout(timer);
        pending = null;
        if (why !== null) error(`${round === null ? `tick ${mark}` : `round ${round}`}: ${why}`);
        const now = client.tick();
        for (const cmd of cmds ?? []) {
          const r = client.desk.submit(cmd, now);
          if ('error' in r) error(`tick ${now}: order refused (${r.error})`);
        }
        // Flush now rather than at the next frame, inside the desk's own
        // cadence (D4: one flush per 20 ticks): the orders reach the room
        // before `done`, so it stamps them into the round's first frame.
        client.desk.onTick(now - 1);
        if (round !== null) client.transport.done(round);
      };
      Promise.resolve()
        .then(() => policy(view))
        .then((cmds) => { settle(cmds, null); }, (e: unknown) => { settle(null, `the policy failed: ${messageOf(e)}`); });
    };
    loop = setInterval(() => {
      if (finished) return;
      if (client.failed() !== null) { error(`failed: ${client.failed() ?? ''}`); finish(); return; }
      // Paced: while the policy thinks, the round stays where it is.
      let starved = false;
      if (!(paced && pending !== null)) {
        const limit = Math.min(nextMark, s.capTicks ?? Infinity);
        const tick = client.tick();
        if (tick < limit) starved = client.pump(limit - tick) === 0;
      }
      if (client.result() !== null) { finish(); return; }
      const st = client.transport.status();
      if (st.kind === 'desync') { error(`desync at tick ${st.tick}`); finish(); return; }
      // Ended with no result and nothing left to run (a void, an expiry): done.
      if (st.kind === 'closed' && starved) { error(`the room ended: ${st.reason}`); finish(); return; }
      const tick = client.tick();
      if (s.capTicks !== undefined && tick >= s.capTicks) { capped = true; finish(); return; }
      if (tick < nextMark) return;
      // A realtime turn that comes while the last call is still pending is
      // skipped; that call's timer counts it once, however many turns it spans.
      if (pending === null) ask(nextMark);
      nextMark += every;
    }, 1);
  };

  client.ready.then(
    (config) => {
      if (finished) return;
      const pace = config.pace;
      if (pace.kind === 'paced') begin(true, pace.roundTicks, pace.roundWallMs);
      else begin(false, REALTIME_EVERY_TICKS, REALTIME_POLICY_MS);
    },
    (e: unknown) => { error(`did not start: ${messageOf(e)}`); finish(); },
  );

  let stopped: Promise<void> | null = null;
  return {
    client,
    done,
    stop: () => {
      stopped ??= (async () => {
        finish();
        // Stopped at the arena's cap, the match is the arena's to decide: the
        // seat leaves without a `bye`, which the room would read as a surrender.
        if (capped) client.transport.detach();
        else client.close();
        await done;
      })();
      return stopped;
    },
  };
}
