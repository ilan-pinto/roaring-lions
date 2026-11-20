/**
 * The main menu's "What's new" panel (GH-1622; the lead approved the design on 19 Nov 2026): this build's release notes,
 * opened by itself once per new game version, and again on request from the menu's own button.
 *
 * THE VERSION is `__APP_BUILD__`, the root `package.json` version in full (`X.Y.Z`, `vite.config.ts`), which is what the
 * release step names the notes file after (`data/release-notes/v<X.Y.Z>.json`). Not `__GAME_VERSION__`: that is
 * major.minor only, and a patch release has notes of its own.
 *
 * WHEN IT OPENS BY ITSELF. All of these, on a menu mount:
 *   - the gate is open: a player's real host (`playerHost`, the gate the quality hint and the no-graphics notice use: a
 *     production build on a real host, or the desktop build, GH-1418), or `?whatsnew`. `pnpm dev`, tests, CI and every harness stay closed, because a modal over
 *     the menu would sit in `ui:shots`' pictures and in front of `ui:routes`' clicks;
 *   - this browser has not been shown this version's notes (`whats-new-store.ts`, `lions.whatsNew.seen`);
 *   - notes EXIST for this version, with at least one line. A missing file means no auto-open. This is also the
 *     first-visit rule: a browser that has never seen any version is "unseen", and gets the panel only when there are
 *     notes to show, so a first visit to a build without notes opens nothing and marks nothing;
 *   - no other dialog is open by the time the notes arrive (the load is lazy, and the player may have opened one).
 * The version is marked seen when the panel OPENS with notes in it (by itself or from the button), never when it does
 * not: a load that failed, or a version with no notes, is asked about again at the next mount.
 *
 * THE BUTTON always opens the panel: the notes, or one polite line when there are none for this version, or one line
 * when they would not load.
 *
 * THE DIALOG is a `.rl-confirm`-family modal on `confirm.ts`'s skeleton (as `feedback-dialog.ts` is): the scrim,
 * `role=dialog` + `aria-modal`, opener focus captured and restored, the focus trap, Escape and a scrim click to close,
 * a capture-phase guard that stops every key but Escape/Enter/Tab, and `trackOpenDialog`, so `closeOpenDialog()`
 * (which `Router.unmount()` calls) closes it. It counts for `isDialogOpen()` by its `rl-confirm` class.
 *
 * THE DISPOSER CONTRACT. `mountWhatsNew` returns the menu's handle on all of it: idempotent, it closes only the dialog
 * THIS mount opened, takes its own listener off the button, and a load that lands afterwards opens nothing.
 */
import { playerHost } from '../shell/player-host';
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import { browserWhatsNewStore, markVersionSeen, readSeenVersion, type SeenStore } from '../whats-new-store';
import { isDialogOpen, trackOpenDialog } from './confirm';
import { focusTrap } from './focus-trap';
import { panel } from './panel';
import { NOTE_SECTIONS, loadReleaseNotes, type NoteSection, type ReleaseNotes } from './whats-new-notes';

export interface WhatsNewDeps {
  /** This build's game version, `X.Y.Z`. */
  version: string;
  /** This version's notes, or null when there are none. A rejection is "would not load". */
  load(version: string): Promise<ReleaseNotes | null>;
  /** Where the last-seen version lives; null when site data is blocked. */
  store: SeenStore | null;
  /** May the panel open by itself here? (The button works regardless.) */
  autoOpen: boolean;
}

/** What the panel shows. */
export type NotesView = { kind: 'notes'; notes: ReleaseNotes } | { kind: 'none' } | { kind: 'failed' };

/** The query flag that opens the auto-open gate off a production host, for trying the panel in `pnpm dev`. */
export const WHATS_NEW_FLAG = 'whatsnew';

/** The gate for the panel opening by itself: a player's real host (a production build on a real host, or the desktop
 *  build: `playerHost`, GH-1418), or `?whatsnew`. */
export function whatsNewAutoOpenAllowed(env: { prod: boolean; hostname: string; protocol?: string; query: URLSearchParams }): boolean {
  return playerHost(env) || env.query.has(WHATS_NEW_FLAG);
}

/** This build's own version, as the build defines it; '' where nothing defined it (a test that stubs nothing), for
 *  which there are never notes. */
function buildVersion(): string {
  return typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : '';
}

/** The deps a real menu runs with. */
export function browserWhatsNewDeps(): WhatsNewDeps {
  return {
    version: buildVersion(),
    load: (v) => loadReleaseNotes(v),
    store: browserWhatsNewStore(),
    autoOpen: whatsNewAutoOpenAllowed({
      prod: import.meta.env.PROD,
      hostname: location.hostname,
      protocol: location.protocol,
      query: new URLSearchParams(location.search),
    }),
  };
}

/** The heading of one list, resolved when the panel is drawn (never at module load: the catalogue is not set yet). */
function sectionTitle(s: NoteSection): string {
  switch (s) {
    case 'units':
      return t('menu.whatsNew.units');
    case 'rules':
      return t('menu.whatsNew.rules');
    case 'fixes':
      return t('menu.whatsNew.fixes');
  }
}

function drawBody(into: HTMLElement, view: NotesView): void {
  if (view.kind !== 'notes') {
    const p = document.createElement('p');
    p.className = 'rl-whats-new__empty rl-dim';
    p.setAttribute('role', 'status');
    p.textContent = view.kind === 'none' ? t('menu.whatsNew.none') : t('menu.whatsNew.failed');
    into.appendChild(p);
    return;
  }
  for (const s of NOTE_SECTIONS) {
    const entries = view.notes[s];
    if (entries.length === 0) continue;
    const section = document.createElement('section');
    section.className = 'rl-whats-new__section';
    section.dataset.section = s;
    const h = document.createElement('h3');
    h.className = 'rl-whats-new__heading';
    h.textContent = sectionTitle(s);
    const list = document.createElement('ul');
    list.className = 'rl-whats-new__list';
    for (const line of entries) {
      // The notes are DATA, like mission text: drawn as written, never through t().
      const li = document.createElement('li');
      li.textContent = line;
      list.appendChild(li);
    }
    section.append(h, list);
    into.appendChild(section);
  }
}

/** Mount the panel under `host`. `onClosed` runs once, however it closed. */
export function whatsNewDialog(host: HTMLElement, view: NotesView, version: string, onClosed?: () => void): { close: Disposer } {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scrim = document.createElement('div');
  scrim.className = 'rl-confirm rl-whats-new';
  scrim.setAttribute('role', 'dialog');
  scrim.setAttribute('aria-modal', 'true');
  // The version is data (a bare `X.Y.Z`), so it sits in the band's tag as it is.
  const p = panel({ rank: 'inspect', title: t('menu.whatsNew.title'), tag: version });
  p.el.classList.add('rl-confirm__panel', 'rl-whats-new__panel');
  const disposeTrap = focusTrap(p.el);

  const content = document.createElement('div');
  content.className = 'rl-whats-new__content';
  drawBody(content, view);
  p.body.appendChild(content);

  const row = document.createElement('div');
  row.className = 'rl-confirm__row';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'rl-btn rl-whats-new__close';
  done.textContent = t('menu.whatsNew.close');
  row.appendChild(done);
  p.body.appendChild(row);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    release();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keydown', onCaptureKey, true);
    disposeTrap();
    scrim.remove();
    opener?.focus();
    onClosed?.();
  };
  const release = trackOpenDialog(close);

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const onCaptureKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') return;
    e.stopPropagation();
  };
  done.addEventListener('click', close);
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keydown', onCaptureKey, true);

  scrim.appendChild(p.el);
  host.appendChild(scrim);
  done.focus();
  return { close };
}

/**
 * Wire the menu's button and the auto-open. `host` is where the dialog mounts (the menu's stage). Returns the menu's
 * disposer for it all (see the header).
 */
export function mountWhatsNew(host: HTMLElement, button: HTMLButtonElement, deps: WhatsNewDeps): Disposer {
  let disposed = false;
  let dialog: { close: Disposer } | null = null;
  let pending: Promise<NotesView> | null = null;

  const notes = (): Promise<NotesView> => {
    pending ??= deps.load(deps.version).then(
      (n): NotesView => (n === null ? { kind: 'none' } : { kind: 'notes', notes: n }),
      (err: unknown): NotesView => {
        console.error("what's new: the notes did not load", err);
        // Not cached: the next click tries again.
        pending = null;
        return { kind: 'failed' };
      }
    );
    return pending;
  };

  const open = (view: NotesView): void => {
    if (disposed || dialog !== null) return;
    if (view.kind === 'notes') markVersionSeen(deps.store, deps.version);
    dialog = whatsNewDialog(host, view, deps.version, () => {
      dialog = null;
    });
  };

  const onClick = (): void => {
    void notes().then(open);
  };
  button.addEventListener('click', onClick);

  if (deps.autoOpen && readSeenVersion(deps.store) !== deps.version) {
    void notes().then((view) => {
      if (view.kind === 'notes' && !isDialogOpen()) open(view);
    });
  }

  return () => {
    if (disposed) return;
    disposed = true;
    button.removeEventListener('click', onClick);
    dialog?.close();
  };
}
