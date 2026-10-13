/**
 * The room's one HUD line (N0 task 11): waiting for the other seat, a stall
 * and who it is waiting on, a pause and how long it has left (N1b task 8), or
 * a desync. Hidden in single-player and while the match runs live, so a
 * healthy room shows nothing; a closed room says why. Mounted on
 * `document.body`, so the battlefield that makes it removes it (`dispose`, in
 * its own `onDispose` -- the disposer contract).
 */
import type { ForfeitClock, Seat, TransportStatus } from '@lions/net';
import { TICKS_PER_SECOND } from '@lions/sim';
import { t } from '../i18n/t';

/** The line for a status, or null when there is nothing to say. `nameOf(null)`
 *  is this machine's own seat: a `connecting` stall is our socket, not theirs.
 *  `now` is the wall clock a pause's `untilMs` was stamped on (`WsTransport`'s
 *  own `now`, `Date.now()` in the browser). `code` is the room's code, which a
 *  desync names as its reference (N1b task 11): the room has already written
 *  the evidence to D1 under it (`match_desync`). */
export function netStatusText(
  s: TransportStatus,
  nameOf: (seat: Seat | null) => string,
  now: number = Date.now(),
  code: string = '',
  forfeit: ForfeitClock | null = null,
): string | null {
  // The other seat's socket is gone mid-match: it loses in a minute unless it
  // comes back (the lead's ruling, 2026-10-13), and a pause does not stop that
  // clock, so this line outranks the stall and the pause lines alike.
  if (forfeit !== null && (s.kind === 'stalled' || s.kind === 'paused')) {
    return t('net.forfeit.waiting', { seat: nameOf(forfeit.seat), time: countdown(forfeit.untilMs - now) });
  }
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
      return t('net.desync', { time: matchClock(s.tick), code });
    case 'paused':
      // Either seat's pause: the room holds both, so the seat that did not
      // pause sees who did and when the room resumes by itself (3 x 90 s).
      return t('net.paused', { seat: nameOf(s.seat), time: countdown(s.untilMs - now) });
  }
}

/** Whether the line still speaks once a versus match's result is on screen
 *  (N1b task 10): only for a desync, which voids that result -- the room's
 *  verdict on the deciding hash window can arrive after this seat stopped
 *  stepping, and two diverged seats must not both be left reading "Victory".
 *  The rest (the stall the stopped seats now make, the room closing) is the
 *  panel's own story and says nothing. */
export function lineOverMatchEnd(s: TransportStatus): boolean {
  return s.kind === 'desync';
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

export interface NetStatusOptions {
  /** The room's code, named on a desync line (N1b task 11). */
  code?: string;
  /** Report on a desync line: a `data-act="report"` button beside the text,
   *  called with the desync's tick. Absent, there is no button -- the
   *  battlefield passes it only when the feedback form is offered at all. */
  onReport?: (tick: number) => void;
}

export class NetStatusLine {
  private readonly el: HTMLDivElement;
  /** The aria-live line: the text alone, so the button is not read with it. */
  private readonly text: HTMLSpanElement;
  private readonly report: HTMLButtonElement | null = null;
  private readonly code: string;
  private shown: string | null = null;
  /** The tick of the desync on the line, for Report. */
  private desyncTick = 0;

  constructor(
    parent: HTMLElement,
    private readonly nameOf: (seat: Seat | null) => string,
    opts: NetStatusOptions = {},
  ) {
    this.code = opts.code ?? '';
    this.el = document.createElement('div');
    this.el.className = 'rl-net-status';
    this.el.hidden = true;
    this.text = document.createElement('span');
    this.text.className = 'rl-net-status__text';
    this.text.setAttribute('role', 'status');
    this.text.setAttribute('aria-live', 'polite');
    this.el.appendChild(this.text);
    const onReport = opts.onReport;
    if (onReport !== undefined) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rl-btn rl-net-status__report';
      b.dataset.act = 'report';
      b.textContent = t('net.desync.report');
      b.hidden = true;
      b.addEventListener('click', () => onReport(this.desyncTick));
      this.el.appendChild(b);
      this.report = b;
    }
    parent.appendChild(this.el);
  }

  /** Called every frame; touches the DOM only when the line changes (a
   *  pause's countdown, once a second). */
  paint(status: TransportStatus, now: number = Date.now(), forfeit: ForfeitClock | null = null): void {
    const text = netStatusText(status, this.nameOf, now, this.code, forfeit);
    if (text === this.shown) return;
    this.shown = text;
    this.el.dataset.net = status.kind;
    this.text.textContent = text ?? '';
    this.el.hidden = text === null;
    if (status.kind === 'desync') this.desyncTick = status.tick;
    if (this.report !== null) this.report.hidden = status.kind !== 'desync';
  }

  /** Hides the line until the next paint that has something new to say. */
  hide(): void {
    this.shown = null;
    this.el.hidden = true;
  }

  dispose(): void {
    this.el.remove();
  }
}
