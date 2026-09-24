// @vitest-environment jsdom
// jsdom, not the default `node` environment, and that is load-bearing for the
// last case: under `node` there is no `window` at all, so `browserLedgerStore`
// would be exercising the ReferenceError path and the case would pass without
// ever meeting the thing it names. This vitest jsdom config hands over a bare
// `{}` for `window.localStorage` -- no `getItem`, no `setItem`, no `length`
// (CLAUDE.md) -- which is the shape the guard actually has to survive.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { browserLedgerStore, memoryLedgerStore, type CampaignLedger } from './ledger-store';
import { ACCOUNT_KEY } from './brigade-account';
import { LEDGER_KEY, TUTORIAL_DONE_KEY } from './main-keys';
import { SAVES_KEY } from './profile';

/** A save written by the build BEFORE this package: a named, cumulative roster,
 *  no `slot` anywhere, no `roster.reserve`, no `roster.lost`, no
 *  `campaign.slots_issued`. Verbatim, not built by a helper -- R-7's whole point
 *  is that the bytes a shipped build wrote still load. */
const PRE_CHANGE_LEDGER = JSON.stringify({
  'roster.surviving_units': [
    { type: 'inf_squad', veterancy: 2, name: 'Barkai', missions: 4, kills: 11 },
    { type: 'mbt_lavi', veterancy: 1, name: '1-2 Ayil', missions: 2, kills: 3 },
  ],
  'campaign.names_issued': { squad: 1, vehicle: 1, task: 0 },
  'campaign.completed_missions': ['beit_sahwan_breach', 'beit_sahwan_1_recon'],
  'roe.mission_ratings': { beit_sahwan_breach: 97 },
});

describe('LedgerStore — one method, one spec', () => {
  it('readLedger parses the stored ledger; writeLedger puts it back under LEDGER_KEY', () => {
    const store = memoryLedgerStore({ [LEDGER_KEY]: PRE_CHANGE_LEDGER });
    const led = store.readLedger();
    expect(led['roster.surviving_units']).toHaveLength(2);
    store.writeLedger({ ...led, 'campaign.slots_issued': 7 });
    expect(JSON.parse(store.raw(LEDGER_KEY)!)['campaign.slots_issued']).toBe(7);
  });

  // R-7: the bytes a shipped build wrote survive the whole trip unchanged. Not
  // "the fields we remembered to check" -- the exact string back out again.
  //
  // Read from one store and written into a FRESH one, deliberately. Reading and
  // writing the same store passes for the wrong reason: a `writeLedger` that
  // does nothing at all leaves the seeded bytes exactly where they were, and
  // the assertion holds (caught by falsification 1 -- it was the one mutation
  // this case survived).
  it('a pre-change save round-trips byte for byte through the store', () => {
    const stored = memoryLedgerStore({ [LEDGER_KEY]: PRE_CHANGE_LEDGER });
    const fresh = memoryLedgerStore();
    fresh.writeLedger(stored.readLedger());
    expect(fresh.raw(LEDGER_KEY)).toBe(PRE_CHANGE_LEDGER);
  });

  it('readLedger answers {} for absent, unparseable and blocked storage', () => {
    expect(memoryLedgerStore().readLedger()).toEqual({});
    expect(memoryLedgerStore({ [LEDGER_KEY]: '{oh no' }).readLedger()).toEqual({});
    expect(memoryLedgerStore.blocked().readLedger()).toEqual({});
  });

  // The three new keys are the reason this module exists (R-1): they are app-only,
  // and `@lions/sim`'s LedgerData does not declare them. There is no cast here:
  // `readLedger` widens `loadLedger`'s `LedgerData` to `CampaignLedger` by plain
  // assignment (every added key is optional). The one cast on the read path is
  // `main-keys.ts`'s `JSON.parse(...) as LedgerData`, which checks nothing --
  // which is why the malformed-key specs below exist.
  it('carries the three app-only keys through a round trip untouched', () => {
    const store = memoryLedgerStore();
    const led: CampaignLedger = {
      'roster.surviving_units': [{ type: 'inf_squad', veterancy: 0, slot: 3 }],
      'roster.reserve': [{ type: 'mortar_team', veterancy: 1, slot: 9 }],
      'roster.lost': [
        { slot: 3, name: 'Barkai', type: 'inf_squad', veterancy: 2, missions: 4, kills: 11, missionId: 'beit_sahwan_2_foothold', tick: 3200 },
      ],
      'campaign.slots_issued': 12,
    };
    store.writeLedger(led);
    expect(store.readLedger()).toEqual(led);
  });

  // Final review, minors. `JSON.parse(...) as LedgerData` is a cast, not a check,
  // so a hand-edited save reached the victory write as whatever it said:
  // `"roster.lost": {}` throws inside `appendLost`'s spread, and a fractional or
  // string counter would issue fractional or concatenated slot ids. Each
  // malformed app-only key reads as ABSENT -- the shape a pre-change save has
  // (R-7), which everything downstream already handles -- and every other key
  // is left exactly as stored.
  describe('readLedger drops a malformed app-only key to absent', () => {
    const read = (ledger: Record<string, unknown>): CampaignLedger =>
      memoryLedgerStore({ [LEDGER_KEY]: JSON.stringify(ledger) }).readLedger();
    const kept = { 'roster.surviving_units': [{ type: 'inf_squad', veterancy: 0, name: 'Barkai', slot: 0 }], 'campaign.slots_issued': 1 };

    it('a hand-edited "roster.lost": {}', () => {
      const got = read({ ...kept, 'roster.lost': {} });
      expect(got).not.toHaveProperty('roster.lost');
      expect(got).toEqual(kept);
    });

    it('a non-array roster.lost of any other shape', () => {
      for (const bad of ['x', 3, null, { 0: { slot: 1 } }]) expect(read({ 'roster.lost': bad })).toEqual({});
    });

    it('a non-array roster.reserve', () => {
      for (const bad of [{}, 'x', 3, null]) expect(read({ ...kept, 'roster.reserve': bad })).toEqual(kept);
    });

    it('a non-integer campaign.slots_issued', () => {
      for (const bad of [2.5, '7', null, [], {}]) {
        const got = read({ 'roster.lost': [], 'campaign.slots_issued': bad });
        expect(got, String(bad)).toEqual({ 'roster.lost': [] });
      }
    });

    it('keeps all three when they are well formed', () => {
      const store = memoryLedgerStore({ [LEDGER_KEY]: JSON.stringify({ ...kept, 'roster.lost': [], 'roster.reserve': [] }) });
      expect(store.readLedger()).toEqual({ ...kept, 'roster.lost': [], 'roster.reserve': [] });
    });
  });

  // `purgeCampaign`'s half of "New campaign". Separate from `writeLedger({})`
  // deliberately: the key is REMOVED, exactly as `main.ts` removed it before this
  // module existed, so nothing on disk changes shape for an existing player.
  it('clearLedger removes the key rather than writing an empty object', () => {
    const store = memoryLedgerStore({ [LEDGER_KEY]: PRE_CHANGE_LEDGER });
    store.clearLedger();
    expect(store.raw(LEDGER_KEY)).toBe(null);
    expect(store.readLedger()).toEqual({});
  });

  it('readAccount migrates; writeAccount puts it back under ACCOUNT_KEY', () => {
    const store = memoryLedgerStore();
    expect(store.readAccount().balance).toBe(0);
    store.writeAccount({ ...store.readAccount(), balance: 450 });
    expect(JSON.parse(store.raw(ACCOUNT_KEY)!).balance).toBe(450);
    expect(memoryLedgerStore({ [ACCOUNT_KEY]: 'not json' }).readAccount().balance).toBe(0);
  });

  // The brigade screen's "reset", which is a REMOVE and not a write of an empty
  // account -- same reason as `clearLedger` above.
  it('resetAccount removes the key and hands back an empty account', () => {
    const store = memoryLedgerStore();
    store.writeAccount({ ...store.readAccount(), balance: 450 });
    expect(store.resetAccount().balance).toBe(0);
    expect(store.raw(ACCOUNT_KEY)).toBe(null);
    expect(memoryLedgerStore.blocked().resetAccount().balance).toBe(0);
  });

  it('tutorialDone/setTutorialDone are one pair, and false removes the key', () => {
    const store = memoryLedgerStore();
    expect(store.tutorialDone()).toBe(false);
    store.setTutorialDone(true);
    expect(store.raw(TUTORIAL_DONE_KEY)).toBe('1');
    expect(store.tutorialDone()).toBe(true);
    store.setTutorialDone(false);
    expect(store.raw(TUTORIAL_DONE_KEY)).toBe(null);
  });

  // Slots move BYTES, not meaning: `profile.ts` keeps its own parse and its own
  // `importSlot` validation, because a damaged slot must still be skippable
  // without the adapter knowing what a slot is.
  it('readSlotsRaw/writeSlotsRaw pass the SAVES_KEY string through unparsed', () => {
    const store = memoryLedgerStore();
    expect(store.readSlotsRaw()).toBe(null);
    store.writeSlotsRaw('{"a":{"broken":true}}');
    expect(store.readSlotsRaw()).toBe('{"a":{"broken":true}}');
    expect(store.raw(SAVES_KEY)).toBe('{"a":{"broken":true}}');
  });

  // The whole point of `available`: a blocked store is a quiet no-op everywhere,
  // never a throw and never a half-written campaign. `main.ts`'s `safeStorage()`
  // guard moves in here and stops being re-decided at thirteen call sites.
  it('a blocked store reports unavailable, reads empty and swallows every write', () => {
    const store = memoryLedgerStore.blocked();
    expect(store.available).toBe(false);
    expect(() => {
      store.writeLedger({ 'campaign.slots_issued': 1 });
      store.writeAccount({ ...memoryLedgerStore().readAccount(), balance: 9 });
      store.setTutorialDone(true);
      store.writeSlotsRaw('{}');
      store.clearLedger();
    }).not.toThrow();
    expect(store.readLedger()).toEqual({});
    expect(store.tutorialDone()).toBe(false);
    expect(store.readSlotsRaw()).toBe(null);
  });

  // A store that CAN be written to does not swallow a refusal: `ui/saves.ts`'s
  // `role="status"` line (profile.ts's I2) exists because a quota failure partway
  // through `writeActive` must reach the player. `available: false` and a quota
  // refusal are different cases and this module must not conflate them.
  it('an available store lets a write failure through', () => {
    const store = memoryLedgerStore();
    expect(store.available).toBe(true);
    store.map.set = () => {
      throw new Error('QuotaExceededError: the quota has been exceeded.');
    };
    expect(() => store.writeLedger({})).toThrow('QuotaExceededError');
  });

  // jsdom's `window.localStorage` in THIS vitest config is a bare `{}` -- no
  // getItem, no setItem, no length (CLAUDE.md). `browserLedgerStore` must survive
  // that, not merely a property access that throws.
  it('browserLedgerStore survives a storage object with no methods', () => {
    // The bare `{}` is installed here rather than assumed from the environment.
    // What `window.localStorage` is under vitest's jsdom depends on the Node
    // version: Node 25's own web-storage global shadows jsdom's and reads as a
    // method-less object, while CI's Node 22 gets jsdom's real Storage. Pinning
    // the environment made this spec pass locally and fail on CI (PR GH-211).
    const own = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', { value: {}, configurable: true });
    try {
      expect(typeof (window.localStorage as Partial<Storage>).getItem).toBe('undefined');
      const store = browserLedgerStore();
      expect(store.available).toBe(false);
      expect(() => store.readLedger()).not.toThrow();
      expect(() => store.writeLedger({})).not.toThrow();
    } finally {
      if (own) Object.defineProperty(window, 'localStorage', own);
      else delete (window as { localStorage?: unknown }).localStorage;
    }
  });
});

/**
 * R-1's acceptance, as a spec rather than a command somebody remembers to run:
 * after this task no screen names one of the three campaign keys and no module
 * outside the door reaches for `localStorage`. The door is `ledger-store.ts`
 * plus the three single-purpose modules it wraps, which are its implementation
 * (the brief keeps them unchanged on purpose) -- so each key literal must
 * appear in exactly ONE file, and that file is named here.
 *
 * A FILE allow-list rather than a line one, and it counts comments too: a
 * mention of `localStorage` in a new module is either a second door or a
 * reader being pointed at the wrong one, and both are worth a red line.
 */
describe('the three campaign keys have one door', () => {
  // `process.cwd()` is the repo root under this vitest config, the same way
  // `ui/hud.test.ts` reaches `theme.css`.
  const SRC = resolve(process.cwd(), 'packages/app/src');

  function sources(dir: string, into: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) sources(full, into);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) into.push(full);
    }
    return into;
  }

  const files = sources(SRC).map((f) => ({ path: relative(SRC, f), text: readFileSync(f, 'utf8') }));
  const naming = (needle: string): string[] => files.filter((f) => f.text.includes(needle)).map((f) => f.path).sort();

  it('found the source tree it means to scan', () => {
    // A scan that matched nothing would pass every assertion below in zero
    // milliseconds (CLAUDE.md: "it returned an empty array").
    expect(files.length).toBeGreaterThan(20);
    expect(files.map((f) => f.path)).toContain('ledger-store.ts');
  });

  it('each campaign key literal is named in exactly one module', () => {
    expect(naming("'lions.campaign.ledger'")).toEqual(['main-keys.ts']);
    expect(naming("'lions.brigade.account'")).toEqual(['brigade-account.ts']);
    expect(naming("'lions.saves'")).toEqual(['profile.ts']);
  });

  /**
   * The half of R-1 the `localStorage` scan below cannot see. Those three
   * modules never named `localStorage` outside their own file to begin with,
   * so a text scan reads the same before and after this task; what actually
   * moved is WHO CALLS THEM. `main.ts` imported all seven of these before, and
   * nothing but the door may import one now -- otherwise a second caller is
   * free to re-decide what a blocked store means, which is the thing this
   * module exists to stop.
   *
   * Import BINDINGS rather than mentions, so `profile.ts`'s `tutorialDone`
   * FIELD and `ui/saves.ts`'s object literals are not false hits.
   */
  it('only the door imports a storage function from the three modules it wraps', () => {
    const STORAGE_FNS = new Set([
      'loadLedger', 'saveLedger', 'tutorialDone', 'markTutorialDone',
      'loadAccount', 'saveAccount', 'resetAccount',
    ]);
    const IMPORTS = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'(\.[^']*(?:main-keys|brigade-account))'/g;
    const callers: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(IMPORTS)) {
        const names = (m[1] ?? '').split(',').map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim() ?? '');
        if (names.some((n) => STORAGE_FNS.has(n))) callers.push(f.path);
      }
    }
    expect([...new Set(callers)].sort()).toEqual(['ledger-store.ts']);
  });

  it('nothing outside the door mentions localStorage, bar the person-and-device keys', () => {
    expect(naming('localStorage')).toEqual([
      // The door itself, and the module whose header explains the guard it moved.
      'ledger-store.ts',
      'main-keys.ts',
      // R-9: the renderer choice and the settings/hint stores are facts about
      // the person and the device, and stay on their own guarded access.
      // `ui/menu.ts` left this list when its guarded renderer read/write
      // moved into `renderer-choice.ts` (scene-host plan, Task 6).
      'main.ts',
      'renderer-choice.ts',
      'shell/router.ts',
      'ui/saves.ts',
      'ui/worldmap3d.ts',
    ]);
  });
});
