/**
 * What a spectator is, as pure rules (GH-954 W1): the battlefield that watches a bot-vs-bot arena game
 * reads this module and nothing else to know what it may not do and what it shows.
 *
 * Invariant 4 (commands in, state out) holds here by having NO path in: `spectatorSink` is the only
 * `CommandSink` a spectating battlefield is given, it drops every command, and the transport under it
 * (`WsTransport` role `watch`) would drop the message anyway. Units may be SELECTED -- selection is the
 * renderer's, not a command -- but never ordered. There is no pause, no surrender and no chat.
 *
 * The strip (`ui/arena-strip.ts`) is drawn from `stripText`, one place, so every string goes through `t()`
 * and one test can run it under the pseudo-locale.
 */
import type { Command } from '@lions/sim';
import type { MatchConfig } from '@lions/net';
import { t } from '../i18n/t';
import type { CommandSink } from '../input/intents';
import type { HudElement } from '../ui/hud-elements';
import { matchClock } from '../ui/net-status';
import type { MatchScore } from './scoreboard';

/** The commands a spectator issued, ever: for a test to read; the app never does. */
export const spectatorSink: CommandSink = {
  queueCommand: (cmd: Command): void => void cmd,   // a spectator has no command path: dropped, kept nowhere
};

/** The HUD a spectator gets: the map, the unit card, the event feed, fire and status lines, the clock, mute.
 *  No orders row, dock, groups, conduct, logistics, intel, speed, radio, objectives or hint: they are for
 *  playing. "Hidden" means inert (`hud-elements.ts`), so none of those can be reached either. */
export const SPECTATOR_SHOWN: ReadonlySet<HudElement> = new Set<HudElement>(['minimap', 'card', 'feed', 'fire', 'status', 'clock', 'mute']);

/** Whose eyes the page draws with. `a` is seat 0's, `b` is seat 1's (the labels the strip prints). */
export type ViewChoice = 'all' | 'a' | 'b';
export const VIEW_CHOICES: readonly ViewChoice[] = ['all', 'a', 'b'];

/** The renderer's `setViewer` argument for a choice: a seat's view is its SIDE's. */
export function viewerFor(choice: ViewChoice, seats: MatchConfig['seats']): 0 | 1 | 'all' {
  if (choice === 'all') return 'all';
  return seats[choice === 'a' ? 0 : 1].side;
}

/** How long a round tick may pass with no new frame before the strip says the room is waiting. */
export const WAIT_MS = 300;

/** The round the room is in or is about to run: 1-based. */
export const roundOf = (tick: number, roundTicks: number): number => Math.floor(tick / roundTicks) + 1;

/**
 * Whether to say "waiting on the players": the page has run every frame it was sent (nothing `behind`), it
 * stands on a round's first tick (a paced room mints nothing past a round until both bots say `done`), and no
 * frame has moved it for `WAIT_MS`. Mid-round, or while the page is still catching up, it is never waiting.
 */
export function waitingOnPlayers(i: { tick: number; roundTicks: number; behind: number; sinceMovedMs: number; over: boolean }): boolean {
  return !i.over && i.roundTicks > 0 && i.behind === 0 && i.tick % i.roundTicks === 0 && i.sinceMovedMs >= WAIT_MS;
}

/** What the battlefield hands the watch screen once it is up (`SpectateHooks.onReady`): the two things the
 *  screen is allowed to do to it (look through other eyes) and the one read it needs. Nothing here orders a unit. */
export interface SpectatorHandle {
  setViewer(v: 0 | 1 | 'all'): void;
  /** What the strip prints, read from the page's own sim and transport. */
  read(): SpectatorReading;
}
export interface SpectatorReading {
  config: MatchConfig;
  tick: number;
  /** Frames received and not yet run: nonzero while the page is catching up. */
  behind: number;
  score: MatchScore;
  /** The game is over on this page (a result, the cap, or the room's end). */
  over: boolean;
}
/** How a spectated game ended on the page: the sim's own result, the arena's cap tick, or the room closing. */
export type SpectateEnd = 'result' | 'cap' | 'ended';
export interface SpectateHooks {
  onReady(h: SpectatorHandle): void;
  onEnd(how: SpectateEnd): void;
}

/** What the strip shows between and after games. */
export type WatchPhase = 'connecting' | 'playing' | 'finished' | 'between' | 'done' | 'no-run' | 'refused';

export interface StripInput {
  phase: WatchPhase;
  /** The game on screen (or the last one), 1-based, and the run's total. */
  n: number;
  of: number;
  /** The two players, by seat. */
  labels: readonly [string, string];
  /** The board by SIDE, and which side each seat plays. Null before the first frame. */
  score: MatchScore | null;
  sides: readonly [0 | 1, 0 | 1];
  tick: number;
  roundTicks: number;
  waiting: boolean;
  /** The finished game's verdict, from the arena: the winning seat, or `draw` / `void`. */
  verdict: { outcome: string; by: string } | null;
  view: ViewChoice;
}

export interface StripText {
  game: string;
  players: string;
  score: string | null;
  force: string | null;
  clock: string | null;
  status: string | null;
  verdict: string | null;
  views: readonly { choice: ViewChoice; label: string; on: boolean }[];
}

const viewLabel = (c: ViewChoice): string => t(c === 'all' ? 'arena.view.all' : c === 'a' ? 'arena.view.a' : 'arena.view.b');

/** Every string the strip shows, through `t()`. A callsign or label is data and is passed as an argument. */
export function stripText(i: StripInput): StripText {
  const seatLine = (seat: 0 | 1): { destroyed: number; remaining: number } | null => {
    const line = i.score?.[i.sides[seat]];
    return line === undefined ? null : { destroyed: line.destroyed, remaining: line.remaining };
  };
  const a = seatLine(0);
  const b = seatLine(1);
  const live = i.phase === 'playing' || i.phase === 'finished';
  const round = roundOf(i.tick, Math.max(1, i.roundTicks));
  let status: string | null = null;
  if (i.phase === 'playing' && i.waiting) status = t('arena.strip.waiting', { round });
  else if (i.phase === 'connecting') status = t('arena.strip.connecting');
  else if (i.phase === 'between') status = t('arena.strip.between');
  else if (i.phase === 'done') status = t('arena.strip.done');
  else if (i.phase === 'no-run') status = t('arena.strip.noRun');
  else if (i.phase === 'refused') status = t('arena.strip.refused');
  let verdict: string | null = null;
  if (i.verdict !== null && (i.phase === 'finished' || i.phase === 'between' || i.phase === 'done')) {
    const v = i.verdict.outcome;
    verdict = v === 'seat0' || v === 'seat1'
      ? t('arena.verdict.won', { n: i.n, name: i.labels[v === 'seat0' ? 0 : 1] })
      : v === 'draw' ? t('arena.verdict.draw', { n: i.n }) : t('arena.verdict.void', { n: i.n });
  }
  return {
    game: t('arena.strip.game', { n: i.n, of: i.of }),
    players: t('arena.strip.players', { a: i.labels[0], b: i.labels[1] }),
    score: live && a !== null && b !== null ? t('arena.strip.score', { a: a.destroyed, b: b.destroyed }) : null,
    force: live && a !== null && b !== null ? t('arena.strip.force', { a: a.remaining, b: b.remaining }) : null,
    clock: live ? t('arena.strip.clock', { round, time: matchClock(i.tick), tick: i.tick }) : null,
    status,
    verdict,
    views: VIEW_CHOICES.map((c) => ({ choice: c, label: viewLabel(c), on: c === i.view })),
  };
}
