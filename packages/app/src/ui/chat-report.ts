/**
 * The report dialog (GH-1417 S3, the lead's D6, D7 and D9): "Report this player's chat". A `.rl-confirm`-family modal like the main
 * menu's feedback dialog, built on the same skeleton (`focusTrap`, `trackOpenDialog`, Escape and a scrim click to close, a capture-phase
 * key guard that keeps game keys out).
 *
 * What it shows is what it sends, so the reporter can see it: the reason, an optional note, and the last lines they received. That copy is
 * the evidence and it is labelled unverified on the receiving side (D6). It names no account, no contact and no tester label, and says
 * so. A report takes no automated action (D9): the result copy says a person reads it and nothing happens to the other player by itself.
 *
 * Disposer contract: `close` is idempotent, aborts a send in flight, removes both window listeners and the focus trap, and nothing
 * completes into the DOM afterwards (`closed` is consulted where the send resolves). It registers with `closeOpenDialog()`.
 */
import type { Seat } from '@lions/net';
import { t } from '../i18n/t';
import { isTextEntry } from '../input/keymap';
import type { Disposer } from '../shell/router';
import type { SendResult } from '../feedback/client';
import type { FeedbackSession } from '../feedback/session';
import { REPORT_REASONS, fitReportLines, type ReportLine, type ReportReason } from '../feedback/report';
import type { ChatInbox } from './chat-inbox';
import { markConfirm } from './confirm-cue';
import { trackOpenDialog } from './confirm';
import { focusTrap } from './focus-trap';
import { panel } from './panel';

/** The optional note's cap in the box; the Worker allows more (`TEXT_MAX`), a report needs little. */
export const REPORT_NOTE_MAX = 300;

export interface ReportDialogDeps {
  /** Who is reported, as the chat names them. Shown as text. */
  reportedName: string;
  /** The reporter's copy of the lines that will be sent, oldest first, and how to name a seat. These are the snapshot taken when the
   *  dialog opened: what is shown is exactly what every send and retry carries. */
  lines: readonly ReportLine[];
  /** How each line may be shown, same length: its text, or null where the player's own filter hid it (the raw line is still sent). */
  shown?: readonly (string | null)[];
  /** How many of the oldest lines were left out so the report fits the server's size cap; said in the dialog when above zero. */
  dropped?: number;
  nameOf(seat: 0 | 1): string;
  submit(reason: ReportReason, note: string, signal: AbortSignal): Promise<SendResult>;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function reportDialog(host: HTMLElement, deps: ReportDialogDeps): { close: Disposer } {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scrim = el('div', 'rl-confirm rl-report-dialog');
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-modal', 'true');
  const p = panel({ rank: 'inspect', title: t('report.title') });
  p.el.classList.add('rl-confirm__panel', 'rl-report-dialog__panel');
  const disposeTrap = focusTrap(p.el);

  let closed = false;
  let inflight: AbortController | null = null;
  const close = (): void => {
    if (closed) return;
    closed = true;
    inflight?.abort();
    release();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keydown', onCaptureKey, true);
    disposeTrap();
    scrim.remove();
    opener?.focus();
  };
  const release = trackOpenDialog(close);

  let reason: ReportReason | null = null;
  const form = el('div', 'rl-report');
  form.appendChild(el('p', 'rl-report__lede', t('report.lede', { name: deps.reportedName })));

  const group = el('fieldset', 'rl-report__reasons');
  group.appendChild(el('legend', 'rl-report__label', t('report.reason.label')));
  const radios = REPORT_REASONS.map((r) => {
    const row = el('label', 'rl-report__reason');
    const box = el('input', '');
    box.type = 'radio';
    box.name = 'rl-report-reason';
    box.value = r;
    box.addEventListener('change', () => {
      if (box.checked) {
        reason = r;
        paint();
      }
    });
    row.append(box, document.createTextNode(` ${t(`report.reason.${r}`)}`));
    group.appendChild(row);
    return box;
  });
  form.appendChild(group);

  const noteId = `rl-report-note-${Math.random().toString(36).slice(2, 8)}`;
  const noteLabel = el('label', 'rl-report__label', t('report.note.label'));
  noteLabel.htmlFor = noteId;
  const note = el('textarea', 'rl-report__note');
  note.id = noteId;
  note.maxLength = REPORT_NOTE_MAX;
  note.rows = 2;
  form.append(noteLabel, note);

  const sends = el('details', 'rl-report__sends');
  sends.appendChild(el('summary', '', t('report.sends.summary', { n: deps.lines.length })));
  const list = el('ol', 'rl-report__lines');
  // Typed by players: text nodes only.
  deps.lines.forEach((l, i) => {
    const shown = deps.shown?.[i] === undefined ? l.text : deps.shown[i];
    list.appendChild(el('li', 'rl-report__line', shown === null ? t('report.line.hidden', { name: deps.nameOf(l.seat) }) : t('net.chat.line', { name: deps.nameOf(l.seat), text: shown })));
  });
  sends.append(list);
  if ((deps.dropped ?? 0) > 0) sends.appendChild(el('p', 'rl-report__fine rl-report__trimmed', t('report.sends.trimmed', { n: deps.dropped ?? 0 })));
  sends.appendChild(el('p', 'rl-report__fine', t('report.sends.body')));
  form.appendChild(sends);

  const row = el('div', 'rl-report__row');
  const sendBtn = el('button', 'rl-btn rl-report__send', t('report.send'));
  sendBtn.type = 'button';
  markConfirm(sendBtn);
  const cancelBtn = el('button', 'rl-btn rl-report__cancel', t('report.cancel'));
  cancelBtn.type = 'button';
  row.append(sendBtn, cancelBtn);
  form.append(row, el('p', 'rl-report__fine', t('report.consent')));

  const result = el('div', 'rl-report__result');
  result.setAttribute('role', 'status');
  result.hidden = true;
  p.body.append(form, result);

  const paint = (): void => {
    sendBtn.disabled = reason === null || inflight !== null;
  };

  const showResult = (title: string, body: string, retry: boolean): void => {
    form.hidden = true;
    result.hidden = false;
    result.replaceChildren(el('h3', 'rl-report__result-title', title), el('p', 'rl-report__result-body', body));
    const actions = el('div', 'rl-report__row');
    if (retry) {
      const again = el('button', 'rl-btn', t('report.retry'));
      again.type = 'button';
      again.addEventListener('click', () => {
        result.hidden = true;
        form.hidden = false;
        paint();
        sendBtn.focus();
      });
      actions.appendChild(again);
    }
    const done = el('button', 'rl-btn', t('report.close'));
    done.type = 'button';
    done.addEventListener('click', close);
    actions.appendChild(done);
    result.appendChild(actions);
    (actions.firstElementChild as HTMLElement | null)?.focus();
  };

  const send = (): void => {
    if (reason === null || inflight !== null || closed) return;
    const ctl = new AbortController();
    inflight = ctl;
    sendBtn.textContent = t('report.sending');
    paint();
    deps.submit(reason, note.value, ctl.signal).then(
      (r) => {
        if (closed || ctl.signal.aborted) return;
        inflight = null;
        sendBtn.textContent = t('report.send');
        paint();
        switch (r.kind) {
          case 'sent':
            return showResult(t('report.sent.title'), t('report.sent.body'), false);
          case 'dry-run':
            return showResult(t('report.dryRun.title'), t('report.dryRun'), false);
          case 'closed':
            return showResult(t('report.closed.title'), t('report.closed.body'), false);
          case 'busy':
            return showResult(t('report.busy.title'), t('report.busy', { s: r.retryAfter }), true);
          case 'aborted':
            return;
          case 'failed':
            return showResult(t('report.failed.title'), t('report.failed'), true);
        }
      },
      () => {
        if (closed || ctl.signal.aborted) return;
        inflight = null;
        sendBtn.textContent = t('report.send');
        paint();
        showResult(t('report.failed.title'), t('report.failed'), true);
      },
    );
  };
  sendBtn.addEventListener('click', send);
  cancelBtn.addEventListener('click', close);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const onCaptureKey = (e: KeyboardEvent): void => {
    if (isTextEntry(e.target) && e.key !== 'Escape' && e.key !== 'Tab') {
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') return;
    e.stopPropagation();
  };
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onCaptureKey, true);

  scrim.appendChild(p.el);
  host.appendChild(scrim);
  paint();
  radios[0]?.focus();
  return { close };
}

/** What a screen needs to offer reports: whether this build offers them at all, and the send. `main.ts` builds one from the feedback
 *  session, so a build that does not show feedback (dev, tests, CI) shows no Report button and sends nothing. */
export interface ChatReportPort {
  offered(): boolean;
  send(report: Parameters<FeedbackSession['sendReport']>[0], opts?: { signal?: AbortSignal }): Promise<SendResult>;
}

export interface OpenChatReport {
  host: HTMLElement;
  port: ChatReportPort;
  inbox: ChatInbox;
  /** This player's seat and the one reported. */
  seat: Seat;
  peer: Seat;
  nameOf(seat: Seat): string;
  /** The room's map id, when known. */
  map?: string;
}

/** Opens the dialog for the other seat, sending the inbox's copy of the room's recent lines. A member's public id is named; a guest's never is. */
export function openChatReport(o: OpenChatReport): { close: Disposer } {
  // ONE snapshot, taken now. The preview shows it and every send and retry sends it: a line that arrives while the dialog is open is not
  // in the report, and cannot push out a line the reporter chose to report.
  const snap = o.inbox.snapshot();
  const fit = fitReportLines(snap.lines);
  const reportedPublicId = o.inbox.publicIdOf(o.peer);
  return reportDialog(o.host, {
    reportedName: o.nameOf(o.peer),
    lines: fit.lines,
    shown: snap.shown.slice(snap.shown.length - fit.lines.length),
    dropped: fit.dropped,
    nameOf: o.nameOf,
    submit: async (reason, note, signal) => {
      const result = await o.port.send(
        { seat: o.seat, reportedSeat: o.peer, reason, note, lines: fit.lines, reportedPublicId, map: o.map },
        { signal },
      );
      // The reporter's client stops showing the reported seat for the rest of the room (the design's automatic mute). Only a report the
      // server stored counts: a dry run, a closed switch and a failure leave the room as it was.
      if (result.kind === 'sent') o.inbox.setMuted(o.peer, true);
      return result;
    },
  });
}
