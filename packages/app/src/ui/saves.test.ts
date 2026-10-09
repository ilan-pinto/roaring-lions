// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { showSaves, type SavesDeps } from './saves';
import { Router } from '../shell/router';
import { ACCOUNT_KEY, emptyAccount } from '../brigade-account';
import { LEDGER_KEY } from '../main-keys';
import { memoryLedgerStore, type LedgerStore } from '../ledger-store';
import { listSlots, saveSlot, type ActiveState } from '../profile';

/** The app's own door (`ledger-store.ts`) over a Map instead of
 *  `localStorage` -- the same implementation the browser path runs, not a
 *  second one written for tests. Same double `profile.test.ts` uses. */
const memStore = memoryLedgerStore;

/**
 * A store that ACCEPTS writes and refuses its Nth, the way a browser at its
 * quota does. Deliberately not `memoryLedgerStore.blocked()`, which is the
 * other failure entirely: an unavailable store writes nothing and throws
 * nothing, where this one has already half written the campaign by the time it
 * refuses. That distinction is the whole of I2 below.
 *
 * `QuotaExceededError` is a `DOMException` in a real browser; a plain `Error`
 * carrying the same name is enough here, because nothing in the code under test
 * inspects the type -- and that is the point: it must not have to.
 *
 * Counts every call to one of these four, which includes one kind of event the
 * old `setItem` spy never saw: `setTutorialDone(false)` is a REMOVAL
 * (`removeItem`), so the spy did not count it and this does. Every write this
 * screen can reach goes through exactly one of the four, so an `N` here is the
 * Nth such call, not the Nth `setItem`.
 */
function quotaStore(failOnWrite: number): LedgerStore {
  const base = memoryLedgerStore();
  let writes = 0;
  const refuseOn = <T>(run: () => T): T => {
    writes += 1;
    if (writes === failOnWrite) throw new Error('QuotaExceededError: the quota has been exceeded.');
    return run();
  };
  return {
    ...base,
    writeLedger: (l) => refuseOn(() => base.writeLedger(l)),
    writeAccount: (a) => refuseOn(() => base.writeAccount(a)),
    setTutorialDone: (d) => refuseOn(() => base.setTutorialDone(d)),
    writeSlotsRaw: (j) => refuseOn(() => base.writeSlotsRaw(j)),
  };
}

const active: ActiveState = { ledger: { 'campaign.completed_missions': ['beit_sahwan_1_recon'] }, account: emptyAccount(), tutorialDone: true };

function deps(store: LedgerStore, overrides: Partial<SavesDeps> = {}): SavesDeps {
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
  it('draws its back link with the GH-261 arrow, words beside it', () => {
    const stage = document.createElement('div');
    showSaves(stage, deps(memStore()));
    const back = stage.querySelector('.rl-saves__back');
    expect(back?.querySelector('svg')?.getAttribute('data-symbol')).toBe('back');
    expect(back?.textContent?.trim()).toBe('Main menu');
  });

  // GH-498: the one footer row, after the body and sticky in the column's
  // scroller. Falsified by hand: appending the foot to `p.body` turns this red.
  it('keeps the way back in a sticky footer row outside the body', () => {
    const stage = document.createElement('div');
    showSaves(stage, deps(memStore()));
    const foot = stage.querySelector('.rl-panel > .rl-foot.rl-foot--sticky');
    expect(foot).not.toBeNull();
    expect(foot?.closest('.rl-panel__body')).toBeNull();
    expect(foot?.querySelector('.rl-foot__start > [data-kind="back"]')).toBe(stage.querySelector('.rl-saves__back'));
  });

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
    // Pass K: a save that worked says so.
    expect(stage.querySelector('.rl-saves__msg')?.textContent).toBe('Saved as \u201cMy save\u201d.');
  });

  it('load confirms, then writes the slot back over the active keys', async () => {
    const store = memStore();
    saveSlot(store, 'a', 'Checkpoint', active, '0.68.0', 1);
    // Loading a slot must overwrite the CURRENT active state -- put something
    // different there first, so "writeActive ran" is distinguishable from
    // "nothing changed to begin with".
    store.writeLedger({});
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
    expect(store.raw(LEDGER_KEY)).toBe(JSON.stringify(active.ledger));
    expect(store.raw(ACCOUNT_KEY)).toBe(JSON.stringify(active.account));
    // Pass K: and the load says the campaign was replaced.
    expect(stage.querySelector('.rl-saves__msg')?.textContent).toBe('Loaded \u201cCheckpoint\u201d \u2014 it is now your campaign.');
    expect(dialog.textContent).toContain('Progress that is not in a save is lost.');
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
    // `saves.ts` logs the refusal (`console.error('saves:', err)`): expected
    // here, so it is captured and asserted rather than printed into CI logs.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    // Pass K: a refused LOAD says what it may have done to the ACTIVE
    // campaign and how to recover -- not "the save may be incomplete", which
    // is the save form's line and was wrong here.
    expect(stage.querySelector('.rl-saves__msg')?.textContent).toBe(
      'Browser storage refused the load part-way \u2014 your current campaign may be mixed with this save. Load the save again, or start a new campaign.'
    );
    expect(changed).toBe(0);
    expect(error).toHaveBeenCalledWith('saves:', expect.anything());
    error.mockRestore();
    stage.remove();
  });

  it('a storage refusal on the save form is named in the status line, and adds no slot', () => {
    // `saves.ts` logs the refusal (`console.error('saves:', err)`): expected
    // here, so it is captured and asserted rather than printed into CI logs.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    expect(error).toHaveBeenCalledWith('saves:', expect.anything());
    error.mockRestore();
    stage.remove();
  });

  it('K-12: a damaged slot is listed as such, survives a new save, and only its own delete removes it', async () => {
    const store = memStore();
    store.writeSlotsRaw(JSON.stringify({ bad: { version: 1, id: 'bad', ledger: 3 } }));
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    showSaves(stage, deps(store));
    const row = stage.querySelector('.rl-saves__row--damaged');
    expect(row?.textContent).toContain('Damaged save 1');
    expect(row?.textContent).toContain('cannot load');
    expect(row?.textContent).not.toContain('Load');
    expect(stage.textContent).not.toContain('No saves yet.');
    // save a new slot: the damaged one is still there, on screen and in storage
    stage.querySelector<HTMLFormElement>('.rl-saves__form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(stage.querySelectorAll('.rl-saves__row')).toHaveLength(2);
    expect(stage.querySelector('.rl-saves__row--damaged')).not.toBeNull();
    expect(store.readSlotsRaw()).toContain('"bad"');
    // export hands over the kept text
    const exported: string[] = [];
    stage.remove();
    const stage2 = document.createElement('div');
    document.body.appendChild(stage2);
    showSaves(stage2, deps(store, { download: (_n, json) => exported.push(json) }));
    const damaged = stage2.querySelector('.rl-saves__row--damaged')!;
    [...damaged.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Export')!.click();
    expect(JSON.parse(exported[0] ?? 'null')).toEqual({ version: 1, id: 'bad', ledger: 3 });
    // delete asks first, then removes only the damaged entry
    [...damaged.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Delete')!.click();
    document.querySelector<HTMLElement>('.rl-confirm')!.querySelector<HTMLButtonElement>('.rl-confirm__yes')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(stage2.querySelector('.rl-saves__row--damaged')).toBeNull();
    expect(stage2.querySelectorAll('.rl-saves__row')).toHaveLength(1);
    stage2.remove();
  });
});
