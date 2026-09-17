// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { showSaves, type SavesDeps } from './saves';
import { ACCOUNT_KEY, emptyAccount } from '../brigade-account';
import { LEDGER_KEY } from '../main-keys';
import { listSlots, saveSlot, type ActiveState } from '../profile';

/** Map-backed, the shape a browser hands over -- not a spy. Same fake
 *  `profile.test.ts`/`brigade-account.test.ts` use. */
function memStore() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
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
    expect(stage.querySelector('.rl-saves__msg')?.textContent).toBe('not a Roaring Lions save');
    expect(listSlots(store)).toHaveLength(0);
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
});
