// packages/app/src/ui/saves.ts
/**
 * The saves screen (Task 7): every slot under `lions.saves`, a form that
 * snapshots the ACTIVE campaign into a new one, and an import button. Pure
 * DOM over `profile.ts` -- this module owns no storage of its own and reads
 * nothing off `window` directly, so a test drives it with the memory-backed
 * `LedgerStore` double the same way `profile.test.ts` does.
 *
 * `deps.download`/`deps.pickFile` are the one place this module reaches past
 * `profile.ts`: `main.ts` supplies the real Blob/`<a download>` and
 * `<input type=file>` implementations, so this file needs no DOM API beyond
 * building elements and no browser feature test of its own.
 */
import { t } from '../i18n/t';
import { footBack, screenFoot } from './foot';
import type { Disposer } from '../shell/router';
import type { LedgerStore } from '../ledger-store';
import { SAVE_ERROR_LOAD_MIXED, SAVE_ERROR_NOT_A_SAVE, damagedRaw, deleteSlot, exportSlot, importSlot, listDamaged, listSlots, loadSlot, readActive, saveSlot, writeActive, type DamagedMeta, type SlotMeta } from '../profile';
import { confirmDialog } from './confirm';
import type { HeldItem } from '../account/local-held';
import type { ReleaseOutcome } from '../account/sync';
import { panel } from './panel';
import { stagger } from './motion';
import { markConfirm } from './confirm-cue';

export interface SavesDeps {
  /** The app's one door to the save (`ledger-store.ts`). This screen owns no
   *  storage of its own and names no key: a test drives it with
   *  `memoryLedgerStore()` the same way `profile.test.ts` does. */
  store: LedgerStore;
  /** `__APP_BUILD__`, stamped on every new slot. */
  build: string;
  now(): number;
  /** Where the back link goes -- `routes.menu()` from `main.ts`. */
  back: string;
  /** A Blob + `<a download>` click, in `main.ts`; nothing here touches the DOM
   *  download machinery directly. */
  download(name: string, json: string): void;
  /** An `<input type=file accept=".json">` read through `File.text()`, in
   *  `main.ts`. Null means the player cancelled the picker. */
  pickFile(): Promise<string | null>;
  /** Fires after every mutation (save, load, delete, import) -- today a no-op
   *  in `main.ts` (the menu re-reads the ledger when IT mounts), kept for
   *  whichever future screen needs to react to a slot changing under it
   *  without polling. */
  onChanged(): void;
  /** Signed in (GH-1075 A2, §0.39): a coupon or a reset is in flight. Saving a slot and loading one write or read the campaign
   *  the server is about to replace, so both are off with `stores.pending` until it answers. Absent for a guest. */
  frozen?: () => boolean;
  /** The work this device holds that the server did not take (`account/local-held.ts`), re-read on every draw. Absent for a guest. */
  heldItems?: () => readonly HeldItem[];
  /** Signed in: asks the sync loop to try again (its `release`, which queues a held campaign's upload when a system slot is free) and answers
   *  the ids of the held items now waiting in the outbox. An id missing from the answer was not queued (no system slot is free). Absent for a guest. */
  releaseHeld?: () => Promise<ReleaseOutcome>;
  /** The held ids whose upload is still waiting in the outbox; a queued line for any other id is dropped. Absent: only the reason prunes. */
  queuedHeldIds?: () => readonly string[];
  /** Whether `releaseHeld` could ever upload this item (same member as the cache, has a digest). Defaults to true when absent. */
  canReleaseHeld?: (item: HeldItem) => boolean;
  /** Told when `frozen` may have changed; returns the unsubscribe. */
  subscribe?: (cb: () => void) => () => void;
}

function randomId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Every error this screen can show, as catalogue text.
 *
 * I8: `profile.ts` throws a catalogue KEY for the one refusal it can name
 * (`SAVE_ERROR_NOT_A_SAVE`); anything else -- a `QuotaExceededError`, a Safari
 * private-window refusal, a `SecurityError` from a blocked `localStorage` --
 * arrives as a browser-authored English sentence that no locale covers and no
 * player can act on, so it is replaced by one generic line rather than printed
 * raw. The console still gets the original, because the generic line is for
 * the player and the stack is for whoever is debugging.
 *
 * Matched against a SET rather than by `instanceof` on a custom class so the
 * thrown value stays a plain `Error` and `profile.ts` needs no dependency on
 * this file.
 */
const CODED = new Set<string>([SAVE_ERROR_NOT_A_SAVE, SAVE_ERROR_LOAD_MIXED]);

/** Pass K: which action failed decides what the line can honestly say -- a
 *  refused LOAD was undone (`writeActive` puts the campaign back; only its
 *  coded `SAVE_ERROR_LOAD_MIXED` says otherwise), a refused DELETE left the
 *  slot where it was, and only a refused SAVE "may be incomplete". */
export type SaveAction = 'save' | 'load' | 'delete' | 'import';

export function errorText(err: unknown, action: SaveAction): string {
  if (err instanceof Error && CODED.has(err.message)) return t(err.message);
  console.error('saves:', err);
  return t(`saves.error.storage.${action}`);
}

/** Which of a row's buttons a refocus aims at. */
type SlotAction = 'load' | 'export' | 'delete';

function slotRow(
  meta: SlotMeta,
  actions: { onLoad(): void; onExport(): void; onDelete(): void },
  frozen = false
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'rl-saves__row';
  row.dataset.slot = meta.id;

  const info = document.createElement('div');
  info.className = 'rl-saves__info';
  const name = document.createElement('div');
  name.className = 'rl-saves__name';
  name.textContent = meta.name;
  const sub = document.createElement('div');
  sub.className = 'rl-saves__sub';
  sub.textContent = t('saves.slot.meta', {
    date: DATE.format(new Date(meta.savedAt)),
    n: meta.missions,
    credits: meta.credits,
    build: meta.build,
  });
  info.append(name, sub);
  row.appendChild(info);

  const btnRow = document.createElement('div');
  btnRow.className = 'rl-saves__actions';
  const button = (label: string, onClick: () => void, action: SlotAction): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rl-btn';
    b.dataset.action = action;
    b.textContent = label;
    if (action === 'load' && frozen) {
      b.disabled = true;
      b.title = t('stores.pending');
    }
    b.addEventListener('click', onClick);
    btnRow.appendChild(b);
  };
  button(t('saves.slot.load'), actions.onLoad, 'load');
  button(t('saves.slot.export'), actions.onExport, 'export');
  button(t('saves.slot.delete'), actions.onDelete, 'delete');
  row.appendChild(btnRow);

  return row;
}

/**
 * K-12: a stored slot that cannot be read. It is kept verbatim by `profile.ts`
 * (no save or delete ever drops it) and shown here as damaged, with the two
 * things a player can do: export the kept text, so it can be repaired or sent
 * on, or delete it for good.
 */
function damagedRow(meta: DamagedMeta, n: number, actions: { onExport(): void; onDelete(): void }): HTMLElement {
  const row = document.createElement('div');
  row.className = 'rl-saves__row rl-saves__row--damaged';
  row.dataset.slot = meta.id;
  const info = document.createElement('div');
  info.className = 'rl-saves__info';
  const name = document.createElement('div');
  name.className = 'rl-saves__name';
  name.textContent = t('saves.damaged.name', { n });
  const sub = document.createElement('div');
  sub.className = 'rl-saves__sub rl-saves__sub--damaged';
  sub.textContent = t('saves.damaged.sub', { chars: meta.bytes });
  info.append(name, sub);
  row.appendChild(info);
  const btnRow = document.createElement('div');
  btnRow.className = 'rl-saves__actions';
  const button = (label: string, onClick: () => void, action: SlotAction): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rl-btn';
    b.dataset.action = action;
    b.textContent = label;
    b.addEventListener('click', onClick);
    btnRow.appendChild(b);
  };
  button(t('saves.slot.export'), actions.onExport, 'export');
  button(t('saves.slot.delete'), actions.onDelete, 'delete');
  row.appendChild(btnRow);
  return row;
}

export function showSaves(stage: HTMLElement, deps: SavesDeps): Disposer {
  const wrap = document.createElement('div');
  wrap.className = 'rl-menu rl-menu--saves';

  const p = panel({ rank: 'inspect', title: t('saves.title') });
  wrap.appendChild(p.el);

  const list = document.createElement('div');
  list.className = 'rl-saves__list';
  p.body.appendChild(list);

  const heldBox = document.createElement('section');
  heldBox.className = 'rl-saves__held';

  const empty = document.createElement('p');
  empty.className = 'rl-dim';
  empty.textContent = t('saves.empty');

  const msg = document.createElement('p');
  msg.className = 'rl-saves__msg';
  msg.setAttribute('role', 'status');
  msg.setAttribute('aria-live', 'polite');

  const say = (text: string): void => {
    msg.textContent = text;
  };

  /** Where a row sits in the list right now, for `refocus` after a re-render. */
  const rowIndex = (id: string): number => [...list.querySelectorAll<HTMLElement>('.rl-saves__row')].findIndex((r) => r.dataset.slot === id);

  /**
   * Keyboard walk (polish/keyboard-and-saves): a confirmed load or delete
   * re-renders the list, and the confirm dialog had just handed focus back to
   * a button the re-render then threw away, so the next Tab started from
   * <body>. Focus goes to the row now at `index` (the same slot after a load;
   * the one that took a deleted slot's place, or the last), on its `action`
   * button -- or to the name field when the list is empty.
   */
  const refocus = (index: number, action: SlotAction): void => {
    const rows = list.querySelectorAll<HTMLElement>('.rl-saves__row');
    const row = rows.length > 0 ? rows[Math.min(index, rows.length - 1)] : undefined;
    const target = row?.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`) ?? row?.querySelector<HTMLButtonElement>('button');
    (target ?? nameInput).focus();
  };

  const frozenNow = (): boolean => deps.frozen?.() ?? false;
  // The "On this device only" list: each item with the reason it is here and an Export. Its text is shown to nobody and parsed
  // by nothing: a filed victory op is a `campaign` item whose text is the whole op, so only a `held` campaign (a campaign body
  // the sync loop uploads) is offered "Save to my account", and that goes through the sync loop's own release.
  // id -> the reason it was queued under; forgotten when the item's reason changes (a refused put), so the line never sticks.
  const queuedHeld = new Map<string, string>();
  const renderHeld = (): void => {
    heldBox.replaceChildren();
    const items = deps.heldItems?.() ?? [];
    if (items.length === 0) {
      heldBox.remove();
      return;
    }
    if (!heldBox.isConnected) list.after(heldBox);
    const h = document.createElement('h3');
    h.className = 'rl-saves__held-title';
    h.textContent = t('saves.held.title');
    const lead = document.createElement('p');
    lead.className = 'rl-dim';
    lead.textContent = t('saves.held.lead');
    heldBox.append(h, lead);
    const waiting = deps.queuedHeldIds?.();
    for (const id of [...queuedHeld.keys()]) {
      const live = items.find((i) => i.id === id);
      if (live === undefined || live.reason !== queuedHeld.get(id) || (waiting !== undefined && !waiting.includes(id))) queuedHeld.delete(id);
    }
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'rl-saves__row rl-saves__held-row';
      row.dataset.held = item.id;
      const info = document.createElement('div');
      info.className = 'rl-saves__info';
      const name = document.createElement('div');
      name.className = 'rl-saves__name';
      name.textContent = t('saves.held.item', { date: DATE.format(new Date(item.at)) });
      const sub = document.createElement('div');
      sub.className = 'rl-saves__sub';
      sub.textContent = t(`saves.held.${item.reason}`);
      info.append(name, sub);
      const actions = document.createElement('div');
      actions.className = 'rl-saves__actions';
      const button = (label: string, action: string, onClick: () => void): void => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rl-btn';
        b.dataset.action = action;
        b.textContent = label;
        b.addEventListener('click', onClick);
        actions.appendChild(b);
      };
      button(t('saves.slot.export'), 'export', () => deps.download(`held-${item.id.replace(/[^\w.-]/g, '_')}.json`, item.text));
      if (queuedHeld.has(item.id)) {
        sub.textContent = t('saves.held.queued');
      } else if (deps.releaseHeld !== undefined && item.kind === 'campaign' && item.reason === 'held' && (deps.canReleaseHeld?.(item) ?? true)) {
        const release = deps.releaseHeld;
        button(t('saves.held.save'), 'release', () => {
          void release().then(
            (outcome) => {
              // "Full" is said only when the refresh ran and nothing could be queued; a refresh that did not complete says so.
              // The item leaves the list when its upload is acked (the sync loop's change).
              if (!outcome.ok) say(t('saves.held.unreached'));
              else if (outcome.queued.includes(item.id)) {
                queuedHeld.set(item.id, item.reason);
                say(t('saves.held.queued'));
              } else say(t('saves.held.stillFull'));
              renderHeld();
            },
            () => say(t('saves.held.unreached')),
          );
        });
      }
      row.append(info, actions);
      heldBox.appendChild(row);
    }
  };
  const renderList = (): void => {
    renderHeld();
    list.replaceChildren();
    const slots = listSlots(deps.store);
    const damaged = listDamaged(deps.store);
    if (slots.length === 0 && damaged.length === 0) {
      list.appendChild(empty);
      return;
    }
    for (const meta of slots) {
      list.appendChild(
        slotRow(meta, {
          onLoad: () => {
            if (frozenNow()) return;
            void confirmDialog(stage, {
              title: t('saves.load.confirm.title'),
              body: t('saves.load.confirm.body'),
              confirm: t('saves.load.confirm.action'),
            }).answer.then((ok) => {
              if (!ok || frozenNow()) return;
              const slot = loadSlot(deps.store, meta.id);
              if (!slot) return;
              // I2: `writeActive` writes three keys in sequence with no
              // transaction available to it, so a refusal on the second leaves
              // the loaded ledger married to the OLD brigade account. Before
              // this the throw became an unhandled rejection inside the
              // `.then()`, the list re-rendered as if the load had worked, and
              // the `role="status"` line stayed empty -- the player's campaign
              // was half replaced and nothing said so.
              try {
                writeActive(deps.store, slot);
              } catch (err) {
                say(errorText(err, 'load'));
                return;
              }
              say(t('saves.done.load', { name: slot.name }));
              const at = rowIndex(meta.id);
              renderList();
              refocus(at, 'load');
              deps.onChanged();
            });
          },
          onExport: () => {
            const slot = loadSlot(deps.store, meta.id);
            if (!slot) return;
            deps.download(`${slot.name}.lions-save.json`, exportSlot(slot));
          },
          onDelete: () => {
            void confirmDialog(stage, {
              title: t('saves.delete.confirm.title'),
              body: t('saves.delete.confirm.body', { name: meta.name }),
              confirm: t('saves.delete.confirm.action'),
              danger: true,
            }).answer.then((ok) => {
              if (!ok) return;
              try {
                deleteSlot(deps.store, meta.id);
              } catch (err) {
                say(errorText(err, 'delete'));
                return;
              }
              say(t('saves.done.delete', { name: meta.name }));
              const at = rowIndex(meta.id);
              renderList();
              refocus(at, 'delete');
              syncDefaultName();
              deps.onChanged();
            });
          },
        }, frozenNow())
      );
    }
    damaged.forEach((meta, i) => {
      list.appendChild(
        damagedRow(meta, i + 1, {
          onExport: () => {
            const text = damagedRaw(deps.store, meta.id);
            if (text === null) return;
            deps.download(t('saves.damaged.file', { n: i + 1 }), text);
          },
          onDelete: () => {
            void confirmDialog(stage, {
              title: t('saves.damaged.delete.confirm.title'),
              body: t('saves.damaged.delete.confirm.body'),
              confirm: t('saves.delete.confirm.action'),
              danger: true,
            }).answer.then((ok) => {
              if (!ok) return;
              try {
                deleteSlot(deps.store, meta.id);
              } catch (err) {
                say(errorText(err, 'delete'));
                return;
              }
              say(t('saves.done.deleteDamaged'));
              const at = rowIndex(meta.id);
              renderList();
              refocus(at, 'delete');
              syncDefaultName();
              deps.onChanged();
            });
          },
        })
      );
    });
  };

  // --- save the active campaign as a new slot -------------------------------
  const form = document.createElement('form');
  form.className = 'rl-saves__form';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.name = 'saveName';
  nameInput.setAttribute('aria-label', t('saves.form.nameLabel'));
  const defaultName = (): string => t('saves.form.defaultName', { n: listSlots(deps.store).length + 1 });
  // KS-13 (keyboard-and-saves): the name last OFFERED, so a delete can move
  // the offer on ("Save 3" with one slot listed read as a slot missing) without
  // touching a name the player typed.
  let offered = defaultName();
  nameInput.value = offered;
  const syncDefaultName = (): void => {
    if (nameInput.value !== offered) return;
    offered = defaultName();
    nameInput.value = offered;
  };
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'rl-btn';
  saveBtn.textContent = t('saves.form.save');
  markConfirm(saveBtn);
  form.append(nameInput, saveBtn);
  const syncFrozen = (): void => {
    saveBtn.disabled = frozenNow();
    if (frozenNow()) saveBtn.title = t('stores.pending');
    else saveBtn.removeAttribute('title');
  };
  syncFrozen();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (frozenNow()) return;
    const name = nameInput.value.trim() || defaultName();
    // Same hole as `onLoad` above, one level down: `saveSlot` -> `writeAll` ->
    // `setItem`, and the saves blob is the biggest thing this app writes, so
    // it is the likeliest of the three to be refused.
    try {
      saveSlot(deps.store, randomId(), name, readActive(deps.store), deps.build, deps.now());
    } catch (err) {
      say(errorText(err, 'save'));
      return;
    }
    say(t('saves.done.save', { name }));
    renderList();
    offered = defaultName();
    nameInput.value = offered;
    deps.onChanged();
  });
  p.body.appendChild(form);

  // --- import a save file ---------------------------------------------------
  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'rl-btn rl-saves__import';
  importBtn.textContent = t('saves.import');
  importBtn.addEventListener('click', () => {
    void deps.pickFile().then((text) => {
      if (text === null) return;
      try {
        const imported = importSlot(text);
        saveSlot(
          deps.store,
          randomId(),
          imported.name,
          { ledger: imported.ledger, account: imported.account, tutorialDone: imported.tutorialDone },
          imported.build,
          deps.now()
        );
        say(t('saves.done.import', { name: imported.name }));
        renderList();
        deps.onChanged();
      } catch (err) {
        say(errorText(err, 'import'));
      }
    });
  });
  p.body.appendChild(importBtn);
  p.body.appendChild(msg);

  // The one footer row (`foot.ts`, GH-498), outside the body and sticky, so
  // the way back stays on screen however long the page above it runs.
  const foot = screenFoot({ sticky: true });
  foot.start.appendChild(footBack(t('nav.backToMenu'), deps.back, 'rl-btn rl-saves__back'));
  p.el.appendChild(foot.el);

  renderList();
  const unsubscribe = deps.subscribe?.(() => {
    syncFrozen();
    renderList();
  });

  stagger(wrap);
  stage.appendChild(wrap);
  return () => {
    unsubscribe?.();
    wrap.remove();
  };
}
