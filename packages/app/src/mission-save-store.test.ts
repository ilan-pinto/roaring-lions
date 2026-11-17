/**
 * GH-1393 slice 2: the one guarded reader and writer of the suspended mission's key. Every storage failure is surfaced, a failed write puts
 * the previous record back, and nothing else in the app names the key. Every check was seen red under the one-line mutations in the commit.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MISSION_SAVE_VERSION, serializeSuspended, type SuspendedMission } from './mission-save';
import { SUSPEND_KEY, discardSuspended, openSuspendStore, readSuspended, savedMissionOtherThan, writeSuspended, type KeyStore } from './mission-save-store';
import { SIM_EPOCH, SNAPSHOT_FORMAT } from '@lions/sim';
import { digestOf } from './mission-save';
import { missions } from '@lions/data';

const MISSION = Object.keys(missions)[0] ?? 'beit_sahwan_0_tutorial';
const record = (over: Partial<SuspendedMission> = {}): SuspendedMission => ({
  version: MISSION_SAVE_VERSION, simEpoch: SIM_EPOCH, snapshotFormat: SNAPSHOT_FORMAT, build: '0.1.0', missionId: MISSION, seed: 7, savedAt: 1_790_000_000_000, simTick: 40,
  contentDigest: 1, campaign: { a: 1 }, campaignDigest: digestOf({ a: 1 }), shell: null, shellDigest: digestOf(null), hashAtSave: { sim: 1, runtime: 2 }, rawBytes: 10, snapshot: 'AAAA', ...over,
});

/** A storage that can be told to fail, in each of the ways a browser does. */
function store(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  const s = {
    failSet: false,
    failGet: false,
    failRemove: false,
    /** Accepts the write and keeps something else (a quota shim that truncates, a full disk). */
    corrupt: false,
    /** Overwrites the key with junk and THEN throws: a write that fails halfway through, as a full disk can. */
    clobberThenThrow: false,
    sets: [] as string[],
    getItem(k: string): string | null {
      if (s.failGet) throw new Error('get blocked');
      return data.get(k) ?? null;
    },
    setItem(k: string, v: string): void {
      if (s.clobberThenThrow) {
        s.clobberThenThrow = false; // the restoring write, which comes next, succeeds
        data.set(k, 'half-written junk');
        throw new DOMException('quota', 'QuotaExceededError');
      }
      if (s.failSet) throw new DOMException('quota', 'QuotaExceededError');
      s.sets.push(k);
      data.set(k, s.corrupt ? v.slice(0, -1) : v);
    },
    removeItem(k: string): void {
      if (s.failRemove) throw new Error('remove blocked');
      data.delete(k);
    },
    data,
  };
  return s satisfies KeyStore & Record<string, unknown>;
}

describe('openSuspendStore: the access itself may throw', () => {
  it('a storage whose property read throws is no storage, not an error', () => {
    expect(openSuspendStore(() => { throw new Error('SecurityError'); })).toBeNull();
  });
  it('a bare object, null and a missing method are no storage', () => {
    expect(openSuspendStore(() => ({}))).toBeNull();
    expect(openSuspendStore(() => null)).toBeNull();
    expect(openSuspendStore(() => ({ getItem: () => null, setItem: () => undefined }))).toBeNull();
  });
  it('a real storage is used as it is', () => {
    const s = store();
    expect(openSuspendStore(() => s)).toBe(s);
  });
});

describe('writeSuspended: a refusal is surfaced, never swallowed, and costs nothing', () => {
  it('writes, reads back and says how many characters', () => {
    const s = store();
    const r = writeSuspended(s, record());
    expect(r).toEqual({ ok: true, bytes: serializeSuspended(record()).length });
    expect(s.data.get(SUSPEND_KEY)).toBe(serializeSuspended(record()));
  });

  it('no storage at all: no_storage', () => {
    expect(writeSuspended(null, record())).toEqual({ ok: false, reason: 'no_storage' });
  });

  it('the browser throws on the write (quota, a private window): refused, and the PREVIOUS record is still there', () => {
    const old = serializeSuspended(record({ simTick: 20 }));
    const s = store({ [SUSPEND_KEY]: old });
    s.failSet = true;
    expect(writeSuspended(s, record())).toEqual({ ok: false, reason: 'refused' });
    expect(s.data.get(SUSPEND_KEY)).toBe(old);
  });

  it('a write that fails HALFWAY (the key overwritten, then the throw) is put back as it was: the player keeps the save they had', () => {
    const old = serializeSuspended(record({ simTick: 20 }));
    const s = store({ [SUSPEND_KEY]: old });
    s.clobberThenThrow = true;
    expect(writeSuspended(s, record())).toEqual({ ok: false, reason: 'refused' });
    expect(s.data.get(SUSPEND_KEY)).toBe(old);
    const none = store();
    none.clobberThenThrow = true;
    expect(writeSuspended(none, record())).toEqual({ ok: false, reason: 'refused' });
    expect(none.data.has(SUSPEND_KEY)).toBe(false); // no previous record: the junk is removed, not left to be read as a save
  });

  it('the write returns but reading it back gives something else: unverified, and the previous record is put back', () => {
    const old = serializeSuspended(record({ simTick: 20 }));
    const s = store({ [SUSPEND_KEY]: old });
    s.corrupt = true;
    const r = writeSuspended(s, record());
    expect(r).toEqual({ ok: false, reason: 'unverified' });
    // `corrupt` also corrupts the restoring write; what matters is that it tried, with the old text
    expect(s.sets.length).toBe(2);
  });

  it('with no previous record a failed verification leaves no record behind', () => {
    const s = store();
    s.corrupt = true;
    expect(writeSuspended(s, record())).toEqual({ ok: false, reason: 'unverified' });
    expect(s.data.has(SUSPEND_KEY)).toBe(false);
  });

  it('a read that throws before the write does not stop the save', () => {
    const s = store();
    s.failGet = true;
    // the read-back throws too, so the save cannot be verified: unverified, not a crash
    expect(writeSuspended(s, record())).toEqual({ ok: false, reason: 'unverified' });
  });

  it('a second save overwrites the first (one save)', () => {
    const s = store();
    expect(writeSuspended(s, record({ simTick: 20 })).ok).toBe(true);
    expect(writeSuspended(s, record({ simTick: 40 })).ok).toBe(true);
    const r = readSuspended(s);
    expect(r.state === 'ready' && r.record.simTick).toBe(40);
  });
});

describe('readSuspended: what is there, checked as far as it can be, never deleted', () => {
  it('nothing stored: none', () => {
    expect(readSuspended(store())).toEqual({ state: 'none' });
  });
  it('no storage, or a read that throws: unavailable, so no card claims a save', () => {
    expect(readSuspended(null)).toEqual({ state: 'unavailable' });
    const s = store();
    s.failGet = true;
    expect(readSuspended(s)).toEqual({ state: 'unavailable' });
  });
  it('a good record is ready', () => {
    const s = store();
    writeSuspended(s, record());
    expect(readSuspended(s)).toMatchObject({ state: 'ready', record: { missionId: MISSION } });
  });
  it('a record that will not load is refused with the reason, and is KEPT', () => {
    const s = store({ [SUSPEND_KEY]: serializeSuspended(record({ simEpoch: SIM_EPOCH + 1 })) });
    expect(readSuspended(s)).toEqual({ state: 'refused', reason: 'older_version' });
    expect(s.data.has(SUSPEND_KEY)).toBe(true);
    const gone = store({ [SUSPEND_KEY]: serializeSuspended(record({ missionId: 'removed_in_an_update' })) });
    expect(readSuspended(gone)).toEqual({ state: 'refused', reason: 'mission_unknown' });
    const junk = store({ [SUSPEND_KEY]: 'not json' });
    expect(readSuspended(junk)).toEqual({ state: 'refused', reason: 'unreadable' });
    expect(junk.data.get(SUSPEND_KEY)).toBe('not json');
  });
});

describe('savedMissionOtherThan: would a Save replace somebody else\'s save?', () => {
  const OTHER = Object.keys(missions).find((id) => id !== MISSION) ?? '';
  it('names the stored mission when it is not the one being saved', () => {
    const s = store();
    writeSuspended(s, record({ missionId: OTHER }));
    expect(savedMissionOtherThan(s, MISSION)).toBe(OTHER);
  });
  it('is null for an empty slot, this mission\'s own save, no storage, a blocked read, and a save that cannot load', () => {
    const s = store();
    expect(savedMissionOtherThan(s, MISSION)).toBeNull();
    writeSuspended(s, record());
    expect(savedMissionOtherThan(s, MISSION)).toBeNull();
    expect(savedMissionOtherThan(null, MISSION)).toBeNull();
    s.failGet = true;
    expect(savedMissionOtherThan(s, MISSION)).toBeNull();
    expect(savedMissionOtherThan(store({ [SUSPEND_KEY]: serializeSuspended(record({ missionId: OTHER, simEpoch: SIM_EPOCH + 1 })) }), MISSION)).toBeNull();
  });
  it('reads, never writes or deletes', () => {
    const s = store();
    writeSuspended(s, record({ missionId: OTHER }));
    const before = s.sets.length;
    savedMissionOtherThan(s, MISSION);
    expect(s.sets.length).toBe(before);
    expect(s.data.has(SUSPEND_KEY)).toBe(true);
  });
});

describe('the store module keeps each function\'s own doc (a function inserted between a JSDoc and its function steals it)', () => {
  const src = readFileSync(join(__dirname, 'mission-save-store.ts'), 'utf8');
  it('discardSuspended is documented by its own "Removes the record" line, directly above it', () => {
    expect(src).toMatch(/\/\*\* Removes the record\.[^\n]*\*\/\nexport function discardSuspended\(/);
  });
  it('savedMissionOtherThan is documented by its own block, directly above it', () => {
    expect(src).toMatch(/\*\/\nexport function savedMissionOtherThan\(/);
    expect(src).toMatch(/\/\*\*\n \* The mission whose save is stored now[\s\S]*?\*\/\nexport function savedMissionOtherThan\(/);
  });
});

describe('discardSuspended', () => {
  it('removes it and says so; says false when the browser refuses or the key stays', () => {
    const s = store();
    writeSuspended(s, record());
    expect(discardSuspended(s)).toBe(true);
    expect(readSuspended(s)).toEqual({ state: 'none' });
    writeSuspended(s, record());
    s.failRemove = true;
    expect(discardSuspended(s)).toBe(false);
    expect(discardSuspended(null)).toBe(false);
  });
});

describe('one reader and writer (design G5)', () => {
  const root = join(__dirname, '..', '..', '..');
  it('only mission-save-store.ts names the key: not main.ts, not a screen, not the campaign slots', () => {
    const hits = execFileSync('git', ['grep', '--untracked', '-l', '--', 'lions.mission.suspend'], { cwd: root, encoding: 'utf8' })
      .split('\n').filter((f) => f !== '')
      // the store, its test, the design note and this note's docs may name it; no other source does
      .filter((f) => !/(^|\/)(mission-save-store(\.test)?\.ts|[^/]+\.md|[^/]+\.html)$/.test(f));
    expect(hits).toEqual([]);
    expect(readFileSync(join(__dirname, 'mission-save-store.ts'), 'utf8')).toContain("'lions.mission.suspend'");
  });

  it('it never touches lions.saves, and the sync outbox has no suspend kind (never sent to the server)', () => {
    expect(readFileSync(join(__dirname, 'mission-save-store.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).not.toMatch(/lions\.saves|outbox/);
    const outbox = readFileSync(join(__dirname, 'account', 'outbox.ts'), 'utf8');
    expect(outbox).not.toMatch(/suspend/i);
  });
});
