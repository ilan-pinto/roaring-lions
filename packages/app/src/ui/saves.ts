// packages/app/src/ui/saves.ts
/**
 * The saves screen (Task 7): every slot under `lions.saves`, a form that
 * snapshots the ACTIVE campaign into a new one, and an import button. Pure
 * DOM over `profile.ts` -- this module owns no storage of its own and reads
 * nothing off `window` directly, so a test drives it with a `Map`-backed
 * `StorageLike` fake the same way `profile.test.ts` does.
 *
 * `deps.download`/`deps.pickFile` are the one place this module reaches past
 * `profile.ts`: `main.ts` supplies the real Blob/`<a download>` and
 * `<input type=file>` implementations, so this file needs no DOM API beyond
 * building elements and no browser feature test of its own.
 */
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import type { StorageLike } from '../brigade-account';
import { deleteSlot, exportSlot, importSlot, listSlots, loadSlot, readActive, saveSlot, writeActive, type SlotMeta } from '../profile';
import { confirmDialog } from './confirm';
import { panel } from './panel';
import { stagger } from './motion';

export interface SavesDeps {
  store: StorageLike;
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
}

function randomId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function slotRow(
  meta: SlotMeta,
  actions: { onLoad(): void; onExport(): void; onDelete(): void }
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'rl-saves__row';

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
  const button = (label: string, onClick: () => void): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rl-btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    btnRow.appendChild(b);
  };
  button(t('saves.slot.load'), actions.onLoad);
  button(t('saves.slot.export'), actions.onExport);
  button(t('saves.slot.delete'), actions.onDelete);
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

  const renderList = (): void => {
    list.replaceChildren();
    const slots = listSlots(deps.store);
    if (slots.length === 0) {
      list.appendChild(empty);
      return;
    }
    for (const meta of slots) {
      list.appendChild(
        slotRow(meta, {
          onLoad: () => {
            void confirmDialog(stage, {
              title: t('saves.load.confirm.title'),
              body: t('saves.load.confirm.body'),
              confirm: t('saves.load.confirm.action'),
            }).then((ok) => {
              if (!ok) return;
              const slot = loadSlot(deps.store, meta.id);
              if (!slot) return;
              writeActive(deps.store, slot);
              say('');
              renderList();
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
            }).then((ok) => {
              if (!ok) return;
              deleteSlot(deps.store, meta.id);
              say('');
              renderList();
              deps.onChanged();
            });
          },
        })
      );
    }
  };

  // --- save the active campaign as a new slot -------------------------------
  const form = document.createElement('form');
  form.className = 'rl-saves__form';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.name = 'saveName';
  nameInput.setAttribute('aria-label', t('saves.form.nameLabel'));
  const defaultName = (): string => t('saves.form.defaultName', { n: listSlots(deps.store).length + 1 });
  nameInput.value = defaultName();
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'rl-btn';
  saveBtn.textContent = t('saves.form.save');
  form.append(nameInput, saveBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim() || defaultName();
    saveSlot(deps.store, randomId(), name, readActive(deps.store), deps.build, deps.now());
    say('');
    renderList();
    nameInput.value = defaultName();
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
        say('');
        renderList();
        deps.onChanged();
      } catch (err) {
        say(err instanceof Error ? err.message : String(err));
      }
    });
  });
  p.body.appendChild(importBtn);
  p.body.appendChild(msg);

  const back = document.createElement('a');
  back.className = 'rl-btn rl-menu__item rl-saves__back';
  back.dataset.kind = 'back';
  back.href = deps.back;
  back.textContent = t('nav.backToMenu');
  p.body.appendChild(back);

  renderList();

  stagger(wrap);
  stage.appendChild(wrap);
  return () => wrap.remove();
}
