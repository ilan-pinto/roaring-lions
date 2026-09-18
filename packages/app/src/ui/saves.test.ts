// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { showSaves, type SavesDeps } from './saves';
import { Router } from '../shell/router';
import { ACCOUNT_KEY, emptyAccount } from '../brigade-account';
import { LEDGER_KEY } from '../main-keys';
import { listSlots, saveSlot, type ActiveState } from '../profile';

/** Map-backed, the shape a browser hands over -- not a spy. Same fake
 *  `profile.test.ts`/`brigade-account.test.ts` use. */
function memStore() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
}

/**
 * A store that refuses its Nth write, the way a browser at its quota does.
 *
 * `QuotaExceededError` is a `DOMException` in a real browser; a plain `Error`
 * carrying the same name is enough here, because nothing in the code under test
 * inspects the type -- and that is the point: it must not have to.
 */
function quotaStore(failOnWrite: number) {
  const base = memStore();
  let writes = 0;
  return {
    ...base,
    setItem: (k: string, v: string): undefined => {
      writes += 1;
      if (writes === failOnWrite) throw new Error('QuotaExceededError: the quota has been exceeded.');
      return base.setItem(k, v);
    },
  };
}

const active: ActiveState = { ledger: { 'campaign.completed_missions': ['beit_sahwan_1_recon'] }, account: emptyAccount(), tutorialDone: true };

function deps(store: ReturnType<typeof memStore>, overrides: Partial<SavesDeps> = {}): SavesDeps {
  return {
    store,
    build: '0.68.0',
    now: () => 1_700_000_000_000,
    back: '/',
    download: () => {},
    pickFile: async () => null,
    onChanged: () => {},
    ...overrides,
  };
}

describe('showSaves', () => {
  it('renders the slot list newest first', () => {
    const store = memStore();
    saveSlot(store, 'a', 'Old', active, '0.68.0', 1);
    saveSlot(store, 'b', 'New', active, '0.68.0', 2);
    const stage = document.createElement('div');
    showSaves(stage, deps(store));
    const names = [...stage.querySelectorAll('.rl-saves__name')].map((n) => n.textContent);
    expect(names).toEqual(['New', 'Old']);
  });

  it('shows "no saves yet" with an empty store', () => {
    const store = memStore();
    const stage = document.createElement('div');
    showSaves(stage, deps(store));
    expect(stage.querySelector('.rl-saves__row')).toBeNull();
    expect(stage.textContent).toContain('No saves yet.');
  });

  it('the save form adds a slot under a fresh id, and re-renders the list', () => {
    const store = memStore();
    const stage = document.createElement('div');
    showSaves(stage, deps(store));
    expect(listSlots(store)).toHaveLength(0);
    const form = stage.querySelector<HTMLFormElement>('.rl-saves__form')!;
    const input = form.querySelector<HTMLInputElement>('input[name="saveName"]')!;
    input.value = 'My save';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(listSlots(store)).toHaveLength(1);
    expect(listSlots(store)[0]!.name).toBe('My save');
    expect(stage.querySelectorAll('.rl-saves__row')).toHaveLength(1);
  });

  it('load confirms, then writes the slot back over the active keys', async () => {
    const store = memStore();
    saveSlot(store, 'a', 'Checkpoint', active, '0.68.0', 1);
    // Loading a slot must overwrite the CURRENT active state -- put something
    // different there first, so "writeActive ran" is distinguishable from
    // "nothing changed to begin with".
    store.setItem(LEDGER_KEY, JSON.stringify({}));
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    showSaves(stage, deps(store));
    const row = stage.querySelector<HTMLElement>('.rl-saves__row')!;
    const loadBtn = [...row.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Load')!;
    loadBtn.click();
    const dialog = document.querySelector<HTMLElement>('.rl-confirm')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('Replace your current campaign and brigade with this save?');
    dialog.querySelector<HTMLButtonElement>('.rl-confirm__yes')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.map.get(LEDGER_KEY)).toBe(JSON.stringify(active.ledger));
    expect(store.map.get(ACCOUNT_KEY)).toBe(JSON.stringify(active.account));
    stage.remove();
  });

  it('import of a bad file shows the refusal message and adds no slot', async () => {
    const store = memStore();
    const stage = document.createElement('div');
    showSaves(stage, deps(store, { pickFile: async () => '{"hello":1}' }));
    const importBtn = [...stage.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Import a save file')!;
    importBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(stage.querySelector('.rl-saves__msg')?.textContent).toBe('That file is not a Roaring Lions save.');
    expect(listSlots(store)).toHaveLength(0);
  });

  // C1 (final review): `confirmDialog` used to register two `window` keydown
  // listeners and take them off only from `done()`, which runs only when the
  // player ANSWERS. A confirm open when the router unmounts its screen was
  // stripped from the DOM by `stage.replaceChildren()` with `done()` never
  // called, so its CAPTURE-phase guard -- which `stopPropagation()`s every key
  // that is not Escape/Enter/Tab -- stayed on `window` for the life of the
  // page. Every game verb (h halt, f smoke, o overlay, the group digits, all
  // four pan keys) was dead from then on, on every mission booted afterwards,
  // with nothing on screen to say why and no recovery short of a reload.
  //
  // Driven through a real `Router` rather than by calling the disposer by
  // hand, because the fix lives in `Router.unmount()` (and in
  // `bootBattlefield`'s teardown) -- a screen's own disposer cannot know about
  // a scrim `confirmDialog` appended to the stage as its sibling, which is
  // exactly why the hole existed. `document.body` is the dispatch target for
  // the same reason `confirm.test.ts` gives: `window` must be a true ANCESTOR
  // for capture-before-bubble ordering to mean anything.
  it('a confirm still open when the router leaves the screen stops swallowing game keys', async () => {
    const store = memStore();
    saveSlot(store, 'a', 'Checkpoint', active, '0.68.0', 1);
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    window.history.replaceState(null, '', '/saves');
    const router = new Router({
      base: '/',
      stage,
      transitionMs: 0,
      routes: [
        { name: 'saves', pattern: '/saves', mount: (host) => showSaves(host, deps(store)) },
        {
          name: 'menu',
          pattern: '/',
          mount: (host) => {
            const el = document.createElement('div');
            host.appendChild(el);
            return () => el.remove();
          },
        },
      ],
      notFound: () => () => {},
    });
    const seen: string[] = [];
    const gameVerbListener = (e: KeyboardEvent): void => void seen.push(e.key);
    try {
      await router.start();
      const row = stage.querySelector<HTMLElement>('.rl-saves__row')!;
      [...row.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Delete')!.click();
      expect(document.querySelector('.rl-confirm')).not.toBeNull();

      // The browser Back button, in one call: popstate -> mountLocation -> unmount.
      await router.navigate('/');
      expect(document.querySelector('.rl-confirm')).toBeNull();

      window.addEventListener('keydown', gameVerbListener);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
      expect(seen).toEqual(['h']);
    } finally {
      window.removeEventListener('keydown', gameVerbListener);
      router.dispose();
      stage.remove();
      window.history.replaceState(null, '', '/');
    }
  });

  it('a cancelled file pick leaves the message and the list untouched', async () => {
    const store = memStore();
    const stage = document.createElement('div');
    showSaves(stage, deps(store, { pickFile: async () => null }));
    const importBtn = [...stage.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Import a save file')!;
    importBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(stage.querySelector('.rl-saves__msg')?.textContent).toBe('');
    expect(listSlots(store)).toHaveLength(0);
  });

  // I2 (final review). `writeActive` writes three keys in sequence with no
  // transaction, and `onLoad` called it inside a `.then()` with no `.catch()`:
  // a refusal on the SECOND key left the loaded ledger married to the previous
  // brigade account, the throw became an unhandled rejection, the list
  // re-rendered as if the load had worked and the `role="status"` line stayed
  // empty. "A save slot round-trips the ledger byte-for-byte" is a Phase 1
  // acceptance item, and this was the one path where it could silently not.
  //
  // The second write is the ACCOUNT (`saveLedger`, then `saveAccount`, then
  // the tutorial flag -- the order `writeActive`'s doc comment now names), so
  // failing write 2 is exactly the half-written state that matters.
  it('a storage refusal partway through a load is named in the status line, and the load is not reported as done', async () => {
    const store = quotaStore(2);
    saveSlot(store, 'a', 'Checkpoint', active, '0.68.0', 1);
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    let changed = 0;
    showSaves(stage, deps(store, { onChanged: () => void (changed += 1) }));
    const row = stage.querySelector<HTMLElement>('.rl-saves__row')!;
    [...row.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Load')!.click();
    document.querySelector<HTMLButtonElement>('.rl-confirm__yes')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(stage.querySelector('.rl-saves__msg')?.textContent).toBe(
      'Could not write to browser storage \u2014 the save may be incomplete. Free some space and try again.'
    );
    expect(changed).toBe(0);
    stage.remove();
  });

  it('a storage refusal on the save form is named in the status line, and adds no slot', () => {
    const store = quotaStore(1);
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    let changed = 0;
    showSaves(stage, deps(store, { onChanged: () => void (changed += 1) }));
    const form = stage.querySelector<HTMLFormElement>('.rl-saves__form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(stage.querySelector('.rl-saves__msg')?.textContent).toContain('Could not write to browser storage');
    expect(stage.querySelectorAll('.rl-saves__row')).toHaveLength(0);
    expect(changed).toBe(0);
    stage.remove();
  });
});