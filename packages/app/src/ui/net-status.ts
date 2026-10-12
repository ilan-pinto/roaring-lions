/**
 * The room's one HUD line (N0 task 11): waiting for the other seat, a stall
 * and who it is waiting on, a pause and how long it has left (N1b task 8), or
 * a desync. Hidden in single-player and while the match runs live, so a
 * healthy room shows nothing; a closed room says why. Mounted on
 * `document.body`, so the battlefield that makes it removes it (`dispose`, in
 * its own `onDispose` -- the disposer contract).
 */
import type { Seat, TransportStatus } from '@lions/net';
import { TICKS_PER_SECOND } from '@lions/sim';
import { t } from '../i18n/t';

/** The line for a status, or null when there is nothing to say. `nameOf(null)`
 *  is this machine's own seat: a `connecting` stall is our socket, not theirs.
 *  `now` is the wall clock a pause's `untilMs` was stamped on (`WsTransport`'s
 *  own `now`, `Date.now()` in the browser). */
export function netStatusText(s: TransportStatus, nameOf: (seat: Seat | null) => string, now: number = Date.now()): string | null {
  switch (s.kind) {
    case 'local':
    case 'live':
      return null;
    case 'closed':
      // After the start, a closed room has frozen the battlefield for good:
      // the other seat left, the room voided or expired, or this seat was
      // opened in another tab (R35). Silence there reads as a hang.
      return t('net.closed', { reason: s.reason });
    case 'waiting':
      return t('net.waiting');
    case 'stalled':
      return s.reason === 'behind'
        ? t('net.stall.behind', { seat: nameOf(s.seat) })
        : t('net.stall.gone', { seat: nameOf(s.reason === 'connecting' ? null : s.seat) });
    case 'desync':
      return t('net.desync', { time: matchClock(s.tick) });
    case 'paused':
      // Either seat's pause: the room holds both, so the seat that did not
      // pause sees who did and when the room resumes by itself (3 x 90 s).
      return t('net.paused', { seat: nameOf(s.seat), time: countdown(s.untilMs - now) });
  }
}

/** Time left as m:ss, a part second rounded UP: a pause reads 1:30 when it
 *  begins and 0:00 only once it is over, never below. */
function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The match time a desync was found at, as m:ss. A hash closes a window of
 *  20 ticks -- one second -- so the end of the window the bad hash covered is
 *  a whole second and the clock loses nothing the tick number carried; and a
 *  player reads a time where "tick" is developer language (PA-01). */
export function matchClock(tick: number): string {
  const s = Math.floor((tick + 1) / TICKS_PER_SECOND);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class NetStatusLine {
  private readonly el: HTMLDivElement;
  private shown: string | null = null;

  constructor(parent: HTMLElement, private readonly nameOf: (seat: Seat | null) => string) {
    this.el = document.createElement('div');
    this.el.className = 'rl-net-status';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  /** Called every frame; touches the DOM only when the line changes (a
   *  pause's countdown, once a second). */
  paint(status: TransportStatus, now: number = Date.now()): void {
    const text = netStatusText(status, this.nameOf, now);
    if (text === this.shown) return;
    this.shown = text;
    this.el.dataset.net = status.kind;
    this.el.textContent = text ?? '';
    this.el.hidden = text === null;
  }

  dispose(): void {
    this.el.remove();
  }
}
