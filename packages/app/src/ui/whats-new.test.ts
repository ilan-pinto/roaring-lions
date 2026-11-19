// @vitest-environment jsdom
// The main menu's "What's new" panel (GH-1622): opened by itself once per unseen game version that has notes, reopened
// from the menu's button, closed by Escape, taken down by the menu's disposer, and indifferent to a store that throws.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedWorld } from '../campaign';
import { safeStorage } from '../telemetry/identity';
import { WHATS_NEW_SEEN_KEY, type SeenStore, markVersionSeen, readSeenVersion, resetWhatsNewMemoryForTest } from '../whats-new-store';
import { closeOpenDialog, confirmDialog, isDialogOpen } from './confirm';
import { showMenu } from './menu';
import { mountWhatsNew, whatsNewAutoOpenAllowed, type WhatsNewDeps } from './whats-new';
import { RELEASE_NOTES_DIR, loadReleaseNotes, notesFileFor, parseReleaseNotes, type ReleaseNotes } from './whats-new-notes';

const VERSION = '0.135.0';
const NOTES: ReleaseNotes = {
  version: VERSION,
  units: ['The Lavi joins the brigade.'],
  rules: ['Formations hold their shape on the march.'],
  fixes: ['Smoke no longer hides your own units.'],
};

const memStore = (seed: Record<string, string> = {}): SeenStore & { data: Record<string, string> } => {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? (data[k] as string) : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
};
const throwingStore = (): SeenStore => ({
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const deps = (over: Partial<WhatsNewDeps> = {}): WhatsNewDeps => ({
  version: VERSION,
  load: vi.fn(async () => NOTES),
  store: memStore(),
  autoOpen: true,
  ...over,
});

const world = { name: 'The Sahar Basin' } as unknown as ParsedWorld;
const tutorial = { id: 'beit_sahwan_0_tutorial', name: 'Tutorial', done: true };

let stage: HTMLElement;
let button: HTMLButtonElement;
beforeEach(() => {
  resetWhatsNewMemoryForTest();
  stage = document.createElement('div');
  button = document.createElement('button');
  stage.appendChild(button);
  document.body.appendChild(stage);
});
afterEach(() => {
  closeOpenDialog();
  document.body.replaceChildren();
});

const panelEl = (): HTMLElement | null => document.querySelector<HTMLElement>('.rl-whats-new');

describe('auto-open (GH-1622)', () => {
  it('opens once on an unseen version with notes, marks it seen, and draws the three lists as data', async () => {
    const store = memStore();
    mountWhatsNew(stage, button, deps({ store }));
    expect(panelEl()).toBeNull(); // lazy: nothing until the notes arrive
    await flush();
    const p = panelEl();
    expect(p).not.toBeNull();
    expect(p?.getAttribute('role')).toBe('dialog');
    expect(isDialogOpen()).toBe(true);
    expect([...p!.querySelectorAll('.rl-whats-new__heading')].map((h) => h.textContent)).toEqual([
      'New units',
      'Rules and features',
      'Fixes',
    ]);
    expect(p!.textContent).toContain('The Lavi joins the brigade.');
    expect(p!.querySelector('.rl-panel__tag')?.textContent).toBe(VERSION);
    expect(store.data[WHATS_NEW_SEEN_KEY]).toBe(VERSION);
    expect(document.activeElement?.classList.contains('rl-whats-new__close')).toBe(true);
  });

  it('does not open on a version already seen, and does not even load the notes', async () => {
    const load = vi.fn(async () => NOTES);
    mountWhatsNew(stage, button, deps({ load, store: memStore({ [WHATS_NEW_SEEN_KEY]: VERSION }) }));
    await flush();
    expect(panelEl()).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('opens for a NEWER version than the one seen', async () => {
    mountWhatsNew(stage, button, deps({ store: memStore({ [WHATS_NEW_SEEN_KEY]: '0.134.2' }) }));
    await flush();
    expect(panelEl()).not.toBeNull();
  });

  it('opens only once: a second menu mount on the same store finds the version seen', async () => {
    const store = memStore();
    const first = mountWhatsNew(stage, button, deps({ store }));
    await flush();
    expect(panelEl()).not.toBeNull();
    first();
    expect(panelEl()).toBeNull();
    resetWhatsNewMemoryForTest(); // a new page load: only the store remembers
    mountWhatsNew(stage, button, deps({ store }));
    await flush();
    expect(panelEl()).toBeNull();
  });

  it('stays closed when the gate is closed (dev, tests, CI), and marks nothing', async () => {
    const store = memStore();
    mountWhatsNew(stage, button, deps({ store, autoOpen: false }));
    await flush();
    expect(panelEl()).toBeNull();
    expect(store.data[WHATS_NEW_SEEN_KEY]).toBeUndefined();
  });

  it('a missing notes file means no auto-open and nothing marked (a first visit included)', async () => {
    const store = memStore();
    mountWhatsNew(stage, button, deps({ store, load: async () => null }));
    await flush();
    expect(panelEl()).toBeNull();
    expect(store.data[WHATS_NEW_SEEN_KEY]).toBeUndefined();
  });

  it('does not open over another dialog that is already up when the notes arrive', async () => {
    const other = document.createElement('div');
    other.className = 'rl-confirm';
    document.body.appendChild(other);
    const store = memStore();
    mountWhatsNew(stage, button, deps({ store }));
    await flush();
    expect(document.querySelector('.rl-whats-new')).toBeNull();
    expect(store.data[WHATS_NEW_SEEN_KEY]).toBeUndefined();
  });

  it('the gate: a production build on a real host, or ?whatsnew; never a local or dev build', () => {
    const q = (s: string): URLSearchParams => new URLSearchParams(s);
    expect(whatsNewAutoOpenAllowed({ prod: true, hostname: 'roaring-lions.example.dev', query: q('') })).toBe(true);
    expect(whatsNewAutoOpenAllowed({ prod: true, hostname: 'localhost', query: q('') })).toBe(false);
    expect(whatsNewAutoOpenAllowed({ prod: false, hostname: 'roaring-lions.example.dev', query: q('') })).toBe(false);
    expect(whatsNewAutoOpenAllowed({ prod: false, hostname: 'localhost', query: q('?whatsnew') })).toBe(true);
  });
});

describe('the menu button (GH-1622)', () => {
  it('reopens the panel after it was closed, and loads the notes once', async () => {
    const load = vi.fn(async () => NOTES);
    mountWhatsNew(stage, button, deps({ load, autoOpen: false }));
    button.click();
    await flush();
    expect(panelEl()).not.toBeNull();
    panelEl()!.querySelector<HTMLButtonElement>('.rl-whats-new__close')!.click();
    expect(panelEl()).toBeNull();
    button.click();
    await flush();
    expect(panelEl()).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('says politely that there are no notes for this version when the file is missing', async () => {
    const store = memStore();
    mountWhatsNew(stage, button, deps({ store, load: async () => null, autoOpen: false }));
    button.click();
    await flush();
    expect(panelEl()?.querySelector('.rl-whats-new__empty')?.textContent).toBe('There are no notes for this version.');
    expect(panelEl()?.querySelector('.rl-whats-new__section')).toBeNull();
    expect(store.data[WHATS_NEW_SEEN_KEY]).toBeUndefined();
  });

  it('says the notes did not load when the chunk fails, and tries again on the next click', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error('offline');
      return NOTES;
    });
    mountWhatsNew(stage, button, deps({ load, autoOpen: false }));
    button.click();
    await flush();
    expect(panelEl()?.querySelector('.rl-whats-new__empty')?.textContent).toBe(
      'The notes for this version did not load. Try again later.'
    );
    closeOpenDialog();
    fail = false;
    button.click();
    await flush();
    expect(panelEl()?.textContent).toContain('The Lavi joins the brigade.');
    expect(load).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });

  it('is on the menu, with the other aside items, before Credits', () => {
    const s = document.createElement('div');
    showMenu(s, { base: '/', version: '0.0.0', world, tutorial, whatsNew: deps({ autoOpen: false }) });
    const [, aside] = s.querySelectorAll('nav.rl-menu__nav');
    const items = [...aside!.children] as HTMLElement[];
    const btn = s.querySelector<HTMLButtonElement>('button[data-act="whats-new"]');
    expect(btn?.textContent).toBe("What's new");
    expect(items.indexOf(btn!)).toBe(items.length - 2);
    expect(items[items.length - 1]?.textContent).toBe('Credits');
  });

  it('is absent when the shell passes null', () => {
    const s = document.createElement('div');
    showMenu(s, { base: '/', version: '0.0.0', world, tutorial, whatsNew: null });
    expect(s.querySelector('[data-act="whats-new"]')).toBeNull();
  });
});

describe('the dialog rules (GH-1622)', () => {
  it('Escape closes it and gives focus back to the button', async () => {
    mountWhatsNew(stage, button, deps({ autoOpen: false }));
    button.focus();
    button.click();
    await flush();
    expect(panelEl()).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panelEl()).toBeNull();
    expect(isDialogOpen()).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('lets no game key past it while open', async () => {
    mountWhatsNew(stage, button, deps());
    await flush();
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
    expect(reached).not.toHaveBeenCalled();
    window.removeEventListener('keydown', reached);
  });

  it('is closed by closeOpenDialog (what Router.unmount calls)', async () => {
    mountWhatsNew(stage, button, deps());
    await flush();
    expect(panelEl()).not.toBeNull();
    closeOpenDialog();
    expect(panelEl()).toBeNull();
  });
});

describe('the disposer contract (GH-1622)', () => {
  it('removes the panel and leaves no window listener behind', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const dispose = mountWhatsNew(stage, button, deps());
    await flush();
    expect(panelEl()).not.toBeNull();
    const adds = add.mock.calls.filter((c) => c[0] === 'keydown');
    // The dialog's two (Escape, and the capture-phase guard) and the focus trap's.
    expect(adds.length).toBeGreaterThanOrEqual(2);
    dispose();
    expect(panelEl()).toBeNull();
    for (const [type, fn, opt] of adds) {
      expect(remove.mock.calls.some((c) => c[0] === type && c[1] === fn && c[2] === opt)).toBe(true);
    }
    dispose(); // idempotent
    add.mockRestore();
    remove.mockRestore();
  });

  it('takes its click listener off the button', async () => {
    const load = vi.fn(async () => NOTES);
    const dispose = mountWhatsNew(stage, button, deps({ load, autoOpen: false }));
    dispose();
    button.click();
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(panelEl()).toBeNull();
  });

  it('opens nothing when the notes land after the menu is gone', async () => {
    let resolve: (n: ReleaseNotes) => void = () => undefined;
    const load = (): Promise<ReleaseNotes> => new Promise((r) => (resolve = r));
    const dispose = mountWhatsNew(stage, button, deps({ load }));
    dispose();
    resolve(NOTES);
    await flush();
    expect(panelEl()).toBeNull();
  });

  it('the menu disposer takes the panel down with the screen', async () => {
    const s = document.createElement('div');
    document.body.appendChild(s);
    const dispose = showMenu(s, { base: '/', version: '0.0.0', world, tutorial, whatsNew: deps() });
    await flush();
    expect(s.querySelector('.rl-whats-new')).not.toBeNull();
    dispose();
    expect(document.querySelector('.rl-whats-new')).toBeNull();
    expect(isDialogOpen()).toBe(false);
  });

  it('closes only its own dialog: a real confirm opened over it is left open and still tracked', async () => {
    const dispose = mountWhatsNew(stage, button, deps({ autoOpen: false }));
    button.click();
    await flush();
    expect(panelEl()).not.toBeNull();
    // A REAL confirm, registered with closeOpenDialog's slot (it takes the slot from the panel). A disposer that
    // closed "whatever dialog is open" (closeOpenDialog) would shut THIS one and leave the panel up.
    const other = confirmDialog(document.body, { title: 'Other', body: 'Someone else asked.', confirm: 'Yes' });
    let settled = false;
    void other.answer.then(() => {
      settled = true;
    });
    dispose();
    await flush();
    expect(panelEl()).toBeNull();
    expect(document.querySelector('.rl-confirm')).not.toBeNull();
    expect(isDialogOpen()).toBe(true);
    expect(settled).toBe(false);
    // Still the tracked dialog: the router's closeOpenDialog() takes it down.
    closeOpenDialog();
    await expect(other.answer).resolves.toBe(false);
    expect(isDialogOpen()).toBe(false);
  });
});

describe('storage (GH-1622)', () => {
  it('a store that throws on every call is tolerated: the panel opens, once per page', async () => {
    const store = throwingStore();
    expect(readSeenVersion(store)).toBeNull();
    expect(() => markVersionSeen(store, '0.1.0')).not.toThrow();
    resetWhatsNewMemoryForTest();
    const first = mountWhatsNew(stage, button, deps({ store }));
    await flush();
    expect(panelEl()).not.toBeNull();
    first();
    // Back to the menu on the same page: memory says seen, though the store kept nothing.
    mountWhatsNew(stage, button, deps({ store }));
    await flush();
    expect(panelEl()).toBeNull();
  });

  it('a store whose very access throws is no store, and still works', async () => {
    const store = safeStorage(() => {
      throw new Error('SecurityError');
    });
    expect(store).toBeNull();
    mountWhatsNew(stage, button, deps({ store }));
    await flush();
    expect(panelEl()).not.toBeNull();
  });

  it('a stored value that is not a version reads as nothing seen', () => {
    expect(readSeenVersion(memStore({ [WHATS_NEW_SEEN_KEY]: 'next' }))).toBeNull();
    expect(readSeenVersion(memStore({ [WHATS_NEW_SEEN_KEY]: '{"v":1}' }))).toBeNull();
    expect(readSeenVersion(memStore({ [WHATS_NEW_SEEN_KEY]: '0.135.0' }))).toBe('0.135.0');
  });
});

describe('the notes files (GH-1622)', () => {
  const file = notesFileFor(VERSION) as string;

  it('a version is X.Y.Z, so next.json can never be asked for', () => {
    expect(file).toBe(`${RELEASE_NOTES_DIR}v0.135.0.json`);
    expect(notesFileFor('next')).toBeNull();
    expect(notesFileFor('0.135')).toBeNull();
    expect(notesFileFor('')).toBeNull();
  });

  it('a missing file (or no directory at all) is null, never a throw, and loads nothing', async () => {
    const load = vi.fn();
    await expect(loadReleaseNotes(VERSION, {}, load)).resolves.toBeNull();
    await expect(loadReleaseNotes(VERSION, { [`${RELEASE_NOTES_DIR}v0.134.0.json`]: async () => ({ default: NOTES }) }, load)).resolves.toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('loads this version file through the loader it is handed (importWithRetry in the app)', async () => {
    const thunk = vi.fn(async () => ({ default: NOTES }));
    const load = vi.fn((f: () => Promise<unknown>) => f());
    await expect(loadReleaseNotes(VERSION, { [file]: thunk }, load as <T>(f: () => Promise<T>) => Promise<T>)).resolves.toEqual(NOTES);
    expect(load).toHaveBeenCalledTimes(1);
    expect(thunk).toHaveBeenCalledTimes(1);
  });

  it('a file with three empty lists, the wrong version, or the wrong shape is no notes', async () => {
    const via = (mod: unknown) => loadReleaseNotes(VERSION, { [file]: async () => mod }, (f) => f());
    await expect(via({ default: { version: VERSION, units: [], rules: [], fixes: [] } })).resolves.toBeNull();
    await expect(via({ default: { ...NOTES, version: '0.134.0' } })).resolves.toBeNull();
    await expect(via({ default: { version: VERSION, units: 'x', rules: [], fixes: [] } })).resolves.toBeNull();
    expect(parseReleaseNotes(null, VERSION)).toBeNull();
    expect(parseReleaseNotes({ ...NOTES, fixes: ['', 3, 'kept'] }, VERSION)?.fixes).toEqual(['kept']);
  });

  it('a chunk that fails is a rejection, which the panel shows as "did not load"', async () => {
    await expect(
      loadReleaseNotes(VERSION, { [file]: async () => Promise.reject(new Error('gone')) }, (f) => f())
    ).rejects.toThrow('gone');
  });

  it('the glob is LAZY and nothing imports the notes statically', () => {
    const src = readFileSync(join(__dirname, 'whats-new-notes.ts'), 'utf8');
    const globs = [...src.matchAll(/import\.meta\.glob\(([^)]*)\)/g)].map((m) => m[1] as string);
    expect(globs).toEqual(["'../../../../data/release-notes/v*.json'"]);
    // No static `import ... from '<...>/release-notes/...'` anywhere in the menu's modules either.
    for (const f of ['whats-new-notes.ts', 'whats-new.ts', 'menu.ts']) {
      const s = readFileSync(join(__dirname, f), 'utf8');
      expect(s).not.toMatch(/^\s*import[^;]*release-notes/m);
    }
  });
});
