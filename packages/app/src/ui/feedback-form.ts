/**
 * The feedback form (GH-464, spec §2, mocks 02-04): the pause menu's third tab,
 * and the same form in the main menu's modal without the picture or the
 * replay.
 *
 * What it asks: a kind (required, no default, so the lead's filter means
 * something), what happened (required, up to 2000 characters, with a live
 * count), and -- from the pause menu -- whether to attach the picture taken
 * when the tab opened and, for a Bug, the replay of the mission so far. A
 * contact line appears only for a player with no tester label (D16). One
 * line says who it is sent as; a `<details>` says what else goes with it.
 *
 * States: the form (Send disabled until a kind and some text), sending,
 * sent (with the reference), a dry run (a build that never sends), failed
 * and busy (Retry, the note kept), and closed (the server's kill switch:
 * calm, never an error).
 *
 * Keys. The pause menu's capture guard stops every key a focused text field
 * receives (D18), so this form's own two shortcuts listen on `window` in the
 * CAPTURE phase, registered after the guard -- a same-node listener still
 * runs after an earlier one stops propagation: Ctrl/Cmd+Enter sends from
 * anywhere in the form, and the arrow keys move the kind. Both stop the key
 * there, so neither reaches a game binding.
 *
 * Disposer contract: everything this mounts it takes down -- the two window
 * listeners, the in-flight send (aborted), the thumbnail's object URL, the
 * pending draft write -- and nothing completes into the DOM afterwards.
 */
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import type { StorageLike } from '../telemetry/identity';
import type { SendResult } from '../feedback/client';
import { DRAFT_DEBOUNCE_MS, clearDraft, holdDraft, persistDraft, readDraft, type Draft } from '../feedback/draft';
import { CONTACT_MAX, FEEDBACK_KINDS, TEXT_MAX, type FeedbackKind } from '../feedback/meta';
import type { Picture } from '../feedback/picture';
import { markConfirm } from './confirm-cue';

export interface FormSubmission {
  kind: FeedbackKind;
  text: string;
  contact?: string;
  shot: Blob | null;
  replay: string | null;
}

export interface FeedbackFormDeps {
  source: 'pause' | 'menu';
  /** Who it is sent as. `tester` absent and `anonymous` false is an untagged
   *  player: sent anonymously, with a session id when there is one. */
  who: { tester?: string; anonymous: boolean };
  build: string;
  /** The mission and its clock, on the pause form. */
  where?: { mission: string; clock: string };
  /** The pause form's picture, asked for once at mount. */
  picture?: () => Promise<Picture | null>;
  /** The pause form's replay log. */
  replay?: { available(): boolean; approxBytes(): number; log(): string | null };
  send(s: FormSubmission, signal: AbortSignal): Promise<SendResult>;
  storage: StorageLike | null;
  /** "Back to the game" (pause: Resume) / "Close" (menu). */
  onBack(): void;
  /** Cancel: back to the pause menu's first tab, or close the menu modal. */
  onCancel(): void;
  /** `URL.createObjectURL`/`revokeObjectURL`, injectable for tests. */
  objectUrl?: { create(b: Blob): string; revoke(u: string): void };
}

export interface FeedbackForm {
  el: HTMLElement;
  /** Focus the first thing to do: the kind group, or the primary button of
   *  a result state. */
  focus(): void;
  dispose: Disposer;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const button = (cls: string, label: string): HTMLButtonElement => {
  const b = el('button', cls, label);
  b.type = 'button';
  return b;
};

const kb = (bytes: number): number => Math.max(1, Math.round(bytes / 1024));

export function feedbackForm(host: HTMLElement, deps: FeedbackFormDeps): FeedbackForm {
  const objectUrl = deps.objectUrl ?? { create: (b: Blob) => URL.createObjectURL(b), revoke: (u: string) => URL.revokeObjectURL(u) };
  const root = el('div', 'rl-feedback');
  root.dataset.source = deps.source;
  host.appendChild(root);

  let disposed = false;
  let draft: Draft = readDraft(deps.storage);
  let picture: Picture | null = null;
  let pictureUrl: string | null = null;
  let pictureState: 'none' | 'taking' | 'ready' | 'missing' = deps.picture ? 'taking' : 'none';
  let attachPicture = true;
  let attachReplay = true;
  let inflight: AbortController | null = null;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleDraftWrite = (): void => {
    holdDraft(draft);
    if (writeTimer !== null) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = null;
      persistDraft(deps.storage, draft);
    }, DRAFT_DEBOUNCE_MS);
  };

  // --- the form -------------------------------------------------------------
  const form = el('div', 'rl-feedback__form');
  form.appendChild(el('p', 'rl-feedback__lede', t(deps.source === 'pause' ? 'feedback.lede' : 'feedback.lede.menu')));

  const kindLabelId = `rl-feedback-kind-${Math.random().toString(36).slice(2, 8)}`;
  const kindLabel = el('p', 'rl-feedback__label', t('feedback.kind.label'));
  kindLabel.id = kindLabelId;
  const kinds = el('div', 'rl-feedback__kinds');
  kinds.setAttribute('role', 'radiogroup');
  kinds.setAttribute('aria-labelledby', kindLabelId);
  const kindBtns = FEEDBACK_KINDS.map((k) => {
    const b = button('rl-feedback__kind', t(`feedback.kind.${k}`));
    b.setAttribute('role', 'radio');
    b.dataset.kind = k;
    kinds.appendChild(b);
    return b;
  });
  form.append(kindLabel, kinds);

  const textLabelRow = el('p', 'rl-feedback__label');
  const textLabel = el('label', '', t('feedback.text.label'));
  const textId = `rl-feedback-text-${Math.random().toString(36).slice(2, 8)}`;
  textLabel.htmlFor = textId;
  const count = el('span', 'rl-feedback__count');
  count.setAttribute('aria-live', 'polite');
  textLabelRow.append(textLabel, count);
  const text = el('textarea', 'rl-feedback__text');
  text.id = textId;
  text.maxLength = TEXT_MAX;
  text.rows = 5;
  text.placeholder = t('feedback.text.placeholder');
  text.value = draft.text;
  form.append(textLabelRow, text);

  // Picture + replay (pause only).
  let pictureBox: HTMLInputElement | null = null;
  let pictureSub: HTMLElement | null = null;
  let thumb: HTMLImageElement | null = null;
  let replayBox: HTMLInputElement | null = null;
  let replaySub: HTMLElement | null = null;
  if (deps.source === 'pause') {
    const attach = el('div', 'rl-feedback__attach');
    thumb = el('img', 'rl-feedback__thumb');
    thumb.alt = t('feedback.attach.thumbAlt');
    thumb.hidden = true;
    const checks = el('div', 'rl-feedback__checks');
    const check = (label: string): { row: HTMLLabelElement; box: HTMLInputElement; sub: HTMLElement } => {
      const row = el('label', 'rl-feedback__check');
      const box = el('input', '');
      box.type = 'checkbox';
      const sub = el('small', 'rl-feedback__sub');
      row.append(box, document.createTextNode(` ${label} `), sub);
      return { row, box, sub };
    };
    const p = check(t('feedback.attach.picture'));
    pictureBox = p.box;
    pictureSub = p.sub;
    const r = check(t('feedback.attach.replay'));
    replayBox = r.box;
    replaySub = r.sub;
    checks.append(p.row, r.row);
    attach.append(thumb, checks);
    form.appendChild(attach);
    pictureBox.addEventListener('change', () => (attachPicture = pictureBox?.checked ?? false));
    replayBox.addEventListener('change', () => (attachReplay = replayBox?.checked ?? false));
  }

  // Contact (D16): only for a player with no tester label.
  let contact: HTMLInputElement | null = null;
  if (deps.who.tester === undefined) {
    const row = el('p', 'rl-feedback__label');
    const lab = el('label', '', t('feedback.contact.label'));
    const id = `rl-feedback-contact-${Math.random().toString(36).slice(2, 8)}`;
    lab.htmlFor = id;
    row.appendChild(lab);
    contact = el('input', 'rl-feedback__contact');
    contact.type = 'text';
    contact.id = id;
    contact.maxLength = CONTACT_MAX;
    contact.autocomplete = 'off';
    contact.placeholder = t('feedback.contact.placeholder');
    contact.value = draft.contact;
    form.append(row, contact);
  }

  // Sent as ...
  const who = el('p', 'rl-feedback__who');
  const parts: string[] = [];
  if (deps.who.tester !== undefined && !deps.who.anonymous) {
    who.append(t('feedback.who.tester') + ' ');
    who.appendChild(el('b', '', deps.who.tester));
  } else {
    who.append(t('feedback.who.anonymous'));
  }
  parts.push(t('feedback.who.build', { build: deps.build }));
  if (deps.where) {
    parts.push(deps.where.mission);
    parts.push(t('feedback.who.clock', { clock: deps.where.clock }));
  }
  who.append(` · ${parts.join(' · ')}`);
  form.appendChild(who);

  const details = el('details', 'rl-feedback__details');
  details.appendChild(el('summary', '', t('feedback.details.summary')));
  details.appendChild(el('p', '', t(deps.source === 'pause' ? 'feedback.details.body' : 'feedback.details.body.menu')));
  form.appendChild(details);

  const row = el('div', 'rl-feedback__row');
  const sendBtn = button('rl-btn rl-feedback__send', t('feedback.send'));
  markConfirm(sendBtn);
  const cancelBtn = button('rl-btn rl-feedback__cancel', t('feedback.cancel'));
  const hint = el('span', 'rl-feedback__hint', t('feedback.hint.send'));
  row.append(sendBtn, cancelBtn, hint);
  form.appendChild(row);
  form.appendChild(el('p', 'rl-feedback__consent', t('feedback.consent')));

  // --- the result pane -------------------------------------------------------
  const result = el('div', 'rl-feedback__result');
  result.setAttribute('role', 'status');
  result.hidden = true;
  root.append(form, result);

  // --- painting ---------------------------------------------------------------
  const ready = (): boolean => draft.kind !== null && draft.text.trim().length > 0;
  const paintKinds = (): void => {
    for (const b of kindBtns) {
      const on = b.dataset.kind === draft.kind;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on || (draft.kind === null && b === kindBtns[0]) ? 0 : -1;
    }
  };
  const paint = (): void => {
    paintKinds();
    count.textContent = t('feedback.count', { n: [...draft.text].length, max: TEXT_MAX });
    sendBtn.disabled = !ready();
    root.dataset.state = ready() ? 'filled' : 'empty';
    if (pictureBox && pictureSub) {
      const has = pictureState === 'ready' && picture !== null;
      pictureBox.disabled = !has;
      pictureBox.checked = has && attachPicture;
      pictureSub.textContent =
        pictureState === 'taking'
          ? t('feedback.attach.pictureTaking')
          : has && picture
            ? t('feedback.attach.pictureSub', { w: picture.width, h: picture.height, kb: kb(picture.blob.size) })
            : t('feedback.attach.pictureNone');
    }
    if (replayBox && replaySub) {
      const can = draft.kind === 'bug' && deps.replay?.available() === true;
      replayBox.disabled = !can;
      replayBox.checked = can && attachReplay;
      replaySub.textContent =
        draft.kind === 'bug' && deps.replay && !deps.replay.available()
          ? t('feedback.attach.replayNone')
          : can && deps.replay
            ? t('feedback.attach.replaySize', { kb: kb(deps.replay.approxBytes()) })
            : t('feedback.attach.replaySub');
    }
  };

  const chooseKind = (k: FeedbackKind, focus: boolean): void => {
    draft = { ...draft, kind: k };
    scheduleDraftWrite();
    paint();
    if (focus) kindBtns.find((b) => b.dataset.kind === k)?.focus();
  };
  for (const b of kindBtns) b.addEventListener('click', () => chooseKind(b.dataset.kind as FeedbackKind, false));
  text.addEventListener('input', () => {
    draft = { ...draft, text: text.value };
    scheduleDraftWrite();
    paint();
  });
  contact?.addEventListener('input', () => {
    draft = { ...draft, contact: contact?.value ?? '' };
    scheduleDraftWrite();
  });

  // --- results -----------------------------------------------------------------
  const showForm = (): void => {
    result.hidden = true;
    result.replaceChildren();
    form.hidden = false;
    paint();
  };
  const showResult = (r: SendResult): void => {
    form.hidden = true;
    result.hidden = false;
    result.replaceChildren();
    root.dataset.state = r.kind;
    const title = (key: string, tone: string): void => {
      const h = el('h3', 'rl-feedback__title', t(key));
      h.dataset.tone = tone;
      result.appendChild(h);
    };
    const line = (cls: string, s: string): void => {
      result.appendChild(el('p', cls, s));
    };
    const actions = el('div', 'rl-feedback__row');
    const back = button('rl-btn rl-feedback__back', t(deps.source === 'pause' ? 'feedback.sent.back' : 'feedback.sent.close'));
    back.addEventListener('click', () => deps.onBack());
    let primary: HTMLButtonElement = back;
    if (r.kind === 'sent' || r.kind === 'dry-run') {
      title(r.kind === 'sent' ? 'feedback.sent.title' : 'feedback.dryRun.title', 'good');
      line('rl-feedback__thanks', t('feedback.sent.body'));
      if (r.kind === 'sent' && r.ref !== '') line('rl-feedback__ref', t('feedback.sent.ref', { ref: r.ref }));
      // Stored without an attachment (spec §12.2): said plainly, never as an
      // error -- the note itself landed.
      if (r.kind === 'sent' && r.dropped?.picture !== undefined) {
        line('rl-feedback__dropped', t(r.dropped.picture === 'too_large' ? 'feedback.sent.noPicture.large' : 'feedback.sent.noPicture.full'));
      }
      if (r.kind === 'sent' && r.dropped?.replay !== undefined) {
        line('rl-feedback__dropped', t(r.dropped.replay === 'too_large' ? 'feedback.sent.noReplay.large' : 'feedback.sent.noReplay.full'));
      }
      if (r.kind === 'dry-run') line('rl-feedback__ref', t('feedback.dryRun'));
      const another = button('rl-btn rl-feedback__another', t('feedback.sent.another'));
      another.addEventListener('click', () => {
        showForm();
        focus();
      });
      actions.append(back, another);
    } else if (r.kind === 'closed') {
      title('feedback.closed.title', 'mute');
      line('rl-feedback__thanks', t('feedback.closed.body'));
      actions.append(back);
    } else {
      // failed / busy: the note is kept, and Retry is the primary. A rate
      // limit is not a failure, so it reads calm (spec §12.2's limits).
      if (r.kind === 'busy') title('feedback.busy.title', 'mute');
      else title('feedback.failed.title', 'bad');
      line(
        'rl-feedback__thanks',
        r.kind === 'busy' ? t('feedback.busy', { s: r.retryAfter }) : t('feedback.failed')
      );
      const retry = button('rl-btn rl-feedback__retry', t('feedback.retry'));
      retry.addEventListener('click', () => void submit());
      const edit = button('rl-btn rl-feedback__edit', t('feedback.edit'));
      edit.addEventListener('click', () => {
        showForm();
        text.focus();
      });
      actions.append(retry, edit);
      primary = retry;
    }
    result.appendChild(actions);
    primary.focus();
  };

  // --- send ----------------------------------------------------------------------
  const submit = async (): Promise<void> => {
    if (disposed || inflight !== null || !ready() || draft.kind === null) return;
    const ac = new AbortController();
    inflight = ac;
    root.dataset.state = 'sending';
    sendBtn.disabled = true;
    sendBtn.textContent = t('feedback.sending');
    const kind = draft.kind;
    const replayLog = kind === 'bug' && attachReplay && deps.replay?.available() ? deps.replay.log() : null;
    let r: SendResult;
    try {
      r = await deps.send(
        {
          kind,
          text: draft.text,
          ...(contact && draft.contact.trim() !== '' ? { contact: draft.contact } : {}),
          shot: attachPicture && picture ? picture.blob : null,
          replay: replayLog,
        },
        ac.signal
      );
    } catch {
      r = { kind: 'failed', status: null };
    }
    // Left mid-send: the disposer aborted, and nothing here may touch a
    // DOM that is no longer anyone's.
    if (disposed) return;
    inflight = null;
    sendBtn.textContent = t('feedback.send');
    if (r.kind === 'aborted') {
      showForm();
      return;
    }
    if (r.kind === 'sent' || r.kind === 'dry-run') {
      draft = { kind: null, text: '', contact: draft.contact };
      text.value = '';
      clearDraft(deps.storage);
      if (writeTimer !== null) {
        clearTimeout(writeTimer);
        writeTimer = null;
      }
    }
    showResult(r);
  };
  sendBtn.addEventListener('click', () => void submit());
  cancelBtn.addEventListener('click', () => deps.onCancel());

  // --- keys (see the header) ----------------------------------------------------
  const onKey = (e: KeyboardEvent): void => {
    if (!(e.target instanceof Node) || !root.contains(e.target)) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      if (!form.hidden) void submit();
      return;
    }
    const idx = kindBtns.indexOf(e.target as HTMLButtonElement);
    if (idx < 0) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const next = kindBtns[(idx + step + kindBtns.length) % kindBtns.length];
    chooseKind(next.dataset.kind as FeedbackKind, true);
  };
  window.addEventListener('keydown', onKey, true);

  // --- the picture ----------------------------------------------------------------
  if (deps.picture) {
    void deps
      .picture()
      .catch(() => null)
      .then((p) => {
        if (disposed) return;
        picture = p;
        pictureState = p ? 'ready' : 'missing';
        if (p && thumb) {
          pictureUrl = objectUrl.create(p.blob);
          thumb.src = pictureUrl;
          thumb.hidden = false;
        }
        paint();
      });
  }

  paint();

  const focus = (): void => {
    if (!result.hidden) {
      result.querySelector<HTMLElement>('button')?.focus();
      return;
    }
    (kindBtns.find((b) => b.tabIndex === 0) ?? kindBtns[0]).focus();
  };

  return {
    el: root,
    focus,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('keydown', onKey, true);
      inflight?.abort();
      inflight = null;
      if (writeTimer !== null) {
        clearTimeout(writeTimer);
        writeTimer = null;
        persistDraft(deps.storage, draft);
      }
      if (pictureUrl !== null) objectUrl.revoke(pictureUrl);
      pictureUrl = null;
      root.remove();
    },
  };
}
