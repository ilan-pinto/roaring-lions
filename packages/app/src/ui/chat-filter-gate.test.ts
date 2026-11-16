// GH-1417 S2: the word filter's lazy door. Before the filter has loaded, and after it failed to, no typed name is shown as typed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CALLSIGN } from '@lions/net';
import { PENDING_NAME, chatFilterNow, loadChatFilter, resetChatFilterGateForTests, shownName } from './chat-filter-gate';
import { labelsOf, nameFrom, seatLabel } from '../net/seat-label';

afterEach(() => {
  resetChatFilterGateForTests();
  vi.restoreAllMocks();
});

const never = (): Promise<never> => new Promise<never>(() => undefined);

describe('the chat filter gate', () => {
  it('before the filter loads, every typed name, a clean one included, reads as the fallback name', () => {
    void loadChatFilter(never);
    expect(PENDING_NAME).toBe(DEFAULT_CALLSIGN);
    expect(chatFilterNow()).toBeNull();
    expect(shownName('Desert Fox')).toBe(DEFAULT_CALLSIGN);
    expect(seatLabel({ callsign: 'Desert Fox' }, 'human').text).toBe(DEFAULT_CALLSIGN);
    expect(seatLabel({ callsign: 'x', member: { name: 'Desert Fox', publicId: 'K7Q2M4XA' } }, 'human').text).toBe(`${DEFAULT_CALLSIGN} · K7Q2M4XA`);
    expect(seatLabel({ callsign: 'B', botModel: { id: 'other', name: 'Zed-9' } }, 'bot').model).toBe(DEFAULT_CALLSIGN);
    expect(labelsOf([{ seat: 1, callsign: 'Desert Fox', connected: true, ready: false }])[1]?.text).toBe(DEFAULT_CALLSIGN);
    expect(nameFrom(undefined, 1, 'Desert Fox')).toBe(DEFAULT_CALLSIGN);
  });

  it('a failed load resolves false (never rejects), is logged, keeps the fallback, and the next call tries again', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = vi.fn(() => Promise.reject(new Error('chunk gone')));
    expect(await loadChatFilter(broken)).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
    expect(shownName('Desert Fox')).toBe(DEFAULT_CALLSIGN);
    expect(await loadChatFilter(broken)).toBe(false);
    expect(broken).toHaveBeenCalledTimes(2);
  });

  it('loads once; then a clean name reads as typed and a filtered one as the fallback', async () => {
    const real = vi.fn(() => import('./chat-filter'));
    const [a, b] = await Promise.all([loadChatFilter(real), loadChatFilter(real)]);
    expect([a, b]).toEqual([true, true]);
    expect(real).toHaveBeenCalledTimes(1);
    expect(chatFilterNow()).not.toBeNull();
    expect(shownName('Desert Fox')).toBe('Desert Fox');
    expect(shownName('Shit Lord')).toBe(DEFAULT_CALLSIGN);
    expect(await loadChatFilter(real)).toBe(true);
    expect(real).toHaveBeenCalledTimes(1);
  });
});
