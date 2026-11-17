// GH-1417 S3, review item 3: a block holds after a reload in the middle of a match.
import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../telemetry/identity';
import { SEAT_IDS_KEY, seatIdsFor } from './seat-ids';

const store = (): StorageLike & { d: Record<string, string> } => {
  const d: Record<string, string> = {};
  return { d, getItem: (k) => d[k] ?? null, setItem: (k, v) => void (d[k] = v) };
};
const label = (publicId: string | null) => ({ publicId });

describe('seatIdsFor', () => {
  it('with the lobby\'s labels, answers with their member ids and stores them for this room', () => {
    const s = store();
    expect(seatIdsFor(s, 'ABCDEF', [label(null), label('K7Q2M4XA')])).toEqual([null, 'K7Q2M4XA']);
    expect(JSON.parse(s.d[SEAT_IDS_KEY]!)).toEqual({ code: 'ABCDEF', ids: [null, 'K7Q2M4XA'] });
  });
  it('after a reload (no labels) answers from what was stored for the SAME room: the id is not lost', () => {
    const s = store();
    seatIdsFor(s, 'ABCDEF', [label(null), label('K7Q2M4XA')]);
    expect(seatIdsFor(s, 'ABCDEF', undefined)).toEqual([null, 'K7Q2M4XA']);
  });
  it('ignores another room\'s ids, and a store holding nothing', () => {
    const s = store();
    seatIdsFor(s, 'ABCDEF', [label('K7Q2M4XA'), label(null)]);
    expect(seatIdsFor(s, 'ZZZZZZ', undefined)).toEqual([null, null]);
    expect(seatIdsFor(store(), 'ABCDEF', undefined)).toEqual([null, null]);
    expect(seatIdsFor(null, 'ABCDEF', undefined)).toEqual([null, null]);
  });
  it('keeps only valid public ids, from labels and from storage', () => {
    const s = store();
    expect(seatIdsFor(s, 'ABCDEF', [label('guest-token'), label('K7Q2M4XA')])).toEqual([null, 'K7Q2M4XA']);
    s.d[SEAT_IDS_KEY] = JSON.stringify({ code: 'ABCDEF', ids: ['<b>x</b>', 7] });
    expect(seatIdsFor(s, 'ABCDEF', undefined)).toEqual([null, null]);
    s.d[SEAT_IDS_KEY] = 'not json';
    expect(seatIdsFor(s, 'ABCDEF', undefined)).toEqual([null, null]);
    s.d[SEAT_IDS_KEY] = JSON.stringify({ code: 'ABCDEF', ids: 'nope' });
    expect(seatIdsFor(s, 'ABCDEF', undefined)).toEqual([null, null]);
  });
  it('survives a storage that throws', () => {
    const throwing: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
    expect(seatIdsFor(throwing, 'ABCDEF', [label(null), label('K7Q2M4XA')])).toEqual([null, 'K7Q2M4XA']);
    expect(seatIdsFor(throwing, 'ABCDEF', undefined)).toEqual([null, null]);
  });
  it('a block made in the lobby holds after a reload: the recalled id feeds the inbox\'s identity', async () => {
    const { ChatInbox } = await import('../ui/chat-inbox');
    const { createBlockList } = await import('./block-list');
    const blocks = createBlockList(store());
    const s = store();
    // lobby: labels present, the member is blocked
    const lobby = seatIdsFor(s, 'ABCDEF', [label(null), label('K7Q2M4XA')]);
    const a = new ChatInbox(() => true);
    a.useWho({ blocks, publicIdOf: (seat) => lobby[seat] });
    a.setBlocked(1, true);
    // reload: a NEW inbox, the match has no labels
    const after = seatIdsFor(s, 'ABCDEF', undefined);
    const b = new ChatInbox(() => true);
    b.useWho({ blocks, publicIdOf: (seat) => after[seat] });
    expect(b.canBlock(1)).toBe(true);
    expect(b.verdict(1)).toBe('blocked');
  });
});
