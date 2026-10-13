/**
 * What Escape does to a room (N1b task 8, spec §3.2.5). There is no local
 * pause in a match: the room is the clock (R33), and a pause is a room
 * message, 3 x 90 s a seat. Escape still opens the pause menu every time --
 * its settings tab is wanted mid-match whatever the room is doing -- and this
 * decides, from what this seat can see, whether opening it also asks the room
 * to pause.
 *
 * R-B17: the room SILENTLY ignores a pause it refuses (none left, one already
 * in force), so the client keeps its own count of this seat's pauses left --
 * from the last `paused` message it saw, starting at `PAUSES_PER_SEAT` -- and
 * with none left it does not ask, and says so instead (`note`).
 */
import type { Seat, TransportStatus } from '@lions/net';
import { t } from '../i18n/t';
import type { CommandSink } from '../input/intents';
import { leaveHref } from '../ui/leave-copy';
import { routes } from '../shell/links';

export interface RoomPauseCall {
  /** Send `pause` to the room. */
  send: boolean;
  /** Show "No pauses left: the match keeps running" in the menu. */
  note: boolean;
}

export function roomPauseCall(status: TransportStatus, pausesLeft: number): RoomPauseCall {
  // Already paused (by either seat), or not running at all (waiting, closed,
  // desync): the room would refuse, and the match is not running either, so
  // "keeps running" would be untrue. The menu opens on its own.
  if (status.kind !== 'live' && status.kind !== 'stalled') return { send: false, note: false };
  return pausesLeft > 0 ? { send: true, note: false } : { send: false, note: true };
}

/** Whether the pause menu offers Surrender (N1b task 10): only while the match
 *  runs or is paused. Once the room has ended it (a leave, a surrender, a
 *  void) or a desync has voided it, the room would ignore a surrender, and the
 *  menu offers Quit -- which leaves -- in its place. */
export function surrenderOffered(status: TransportStatus): boolean {
  return status.kind === 'live' || status.kind === 'stalled' || status.kind === 'paused';
}

/** Whether a bare Escape that reached the battlefield opens the pause menu:
 *  not while it is already open, and not once the mission is over or a
 *  match's result is on screen (R-B11) -- there is nothing left to pause, and
 *  the end panel has no use for a menu behind it. */
export function escapeOpensPause(s: { paused: boolean; missionEnded: boolean; matchOver: boolean }): boolean {
  return !s.paused && !s.missionEnded && !s.matchOver;
}

/** Whether the pause menu closes by itself as the room's pause ends (N1b
 *  final fix wave, the T8 follow-up): when the pause that ended was THIS
 *  seat's own and the match runs again -- the room's 90 s auto-resume (only
 *  the pauser can end a pause early, and its Resume closes the menu itself).
 *  Left open, the match ran on under the modal. A menu open over the OTHER
 *  seat's pause was opened for itself (its settings) and stays; a pause that
 *  ends in the match ending is the end panel's or the desync line's to answer. */
export function pauseEndClosesMenu(prev: TransportStatus, next: TransportStatus, seat: Seat, menuOpen: boolean): boolean {
  return menuOpen && prev.kind === 'paused' && prev.seat === seat && (next.kind === 'live' || next.kind === 'stalled');
}

/** What the HUD's exit asks (N1b final fix wave, M-1). Single-player keeps
 *  the HUD's own leave confirm (`'hud'`). In a room the way out is the pause
 *  menu's: a confirmed Surrender while the match can still be given up, and
 *  once it cannot (ended, voided, not yet started) the menu's Quit -- never
 *  the HUD's own free-play leave, whose copy says nothing of the match it
 *  ends.
 *  Browser Back is not this: it leaves (a `bye`; the other seat wins). */
export function hudExit(inRoom: boolean, status: TransportStatus): 'hud' | 'surrender' | 'quit' {
  if (!inRoom) return 'hud';
  return surrenderOffered(status) ? 'surrender' : 'quit';
}

/** What a room's exit says (N1b lead ruling L-3): the tooltip and the confirm
 *  dialog in ONE place, so the two cannot disagree (R-B24 was a "surrender the
 *  match" tooltip over a "Leave free play?" dialog). While the match can be
 *  given up it is the surrender wording; once it cannot (ended, voided, not
 *  started) it is leave-the-match wording. No status of a room reaches the
 *  free-play sandbox's `leaveCopy`, whose words describe a run that is not a
 *  match. Single-player never calls this. */
export interface RoomExitCopy {
  tip: string;
  title: string;
  body: string;
  confirm: string;
}

export function surrenderCopy(): RoomExitCopy {
  return {
    tip: t('versus.exit.tip'),
    title: t('versus.surrender.confirm.title'),
    body: t('versus.surrender.confirm.body'),
    confirm: t('versus.surrender.confirm.action'),
  };
}

/** A room that has not started yet is not "over": its body says only that the
 *  seat leaves the room. */
export function matchLeaveCopy(status: TransportStatus): RoomExitCopy {
  return {
    tip: t('versus.exit.leaveTip'),
    title: t('versus.leave.confirm.title'),
    body: t(status.kind === 'waiting' ? 'versus.leave.confirm.body.waiting' : 'versus.leave.confirm.body'),
    confirm: t('versus.leave.confirm.action'),
  };
}

export function roomExitCopy(status: TransportStatus): RoomExitCopy {
  return surrenderOffered(status) ? surrenderCopy() : matchLeaveCopy(status);
}

/** Where a confirmed Leave lands (N1b L-3 fix): a room's players go to Play
 *  with a friend, as the match-end panel's own button does -- not the free-play
 *  picker, whose screen is not where a match came from. Single-player is
 *  `leaveHref`, unchanged. */
export function quitHref(inRoom: boolean, freePlay: boolean): string {
  return inRoom ? routes.versus() : leaveHref(freePlay);
}

/** Orders wait while the room is paused, for both seats (N1b lead ruling M-4,
 *  R-B27): the room refuses a `cmd` under a pause, so the client does not
 *  send one -- and says why, rather than letting a click do nothing. */
export function ordersWait(status: TransportStatus): boolean {
  return status.kind === 'paused';
}

/** What a blocked order says, and how often (N1b follow-up). An order the
 *  client itself withholds (`blocked`) is noted every time -- the feed merges
 *  identical lines. An order the ROOM refused (`refused`: it was in flight
 *  when the pause began, so the client had already sent it) arrives once per
 *  order, and says its piece once per PAUSE: the first one is noted, the rest
 *  are not, and a note `blocked` already made for the pause counts. A pause is
 *  identified by who called it and when it ends, both fixed for its life. */
export function blockedOrderNotes(status: () => TransportStatus, note: () => void): { blocked(): void; refused(): void } {
  let noted: string | null = null;
  const pauseKey = (): string => {
    const s = status();
    return s.kind === 'paused' ? `${s.seat}:${s.untilMs}` : 'none';
  };
  return {
    blocked() {
      noted = pauseKey();
      note();
    },
    refused() {
      const key = pauseKey();
      if (key === noted) return;
      noted = key;
      note();
    },
  };
}

/** The sink a room's intents are applied to: commands go on to the transport
 *  unless the room is paused, when each is dropped (never buffered, so nothing
 *  waits to be sent at the resume) and `onBlocked` hears of it. The status is
 *  read per command, so the answer is the one the moment of the click had. */
export function roomOrderSink(status: () => TransportStatus, sink: CommandSink, onBlocked: () => void): CommandSink {
  return {
    queueCommand(cmd) {
      if (ordersWait(status())) onBlocked();
      else sink.queueCommand(cmd);
    },
  };
}
