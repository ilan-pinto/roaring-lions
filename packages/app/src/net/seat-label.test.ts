import { afterEach, describe, expect, it } from 'vitest';
import { chatFilters } from '@lions/data/chat-filters';
import { DEFAULT_CALLSIGN } from '@lions/net';
import { labelsOf, nameFrom, seatLabel } from './seat-label';
import { setCatalogue } from '../i18n/t';
import { preloadChatFilter } from '../ui/chat-filter';

// The lists are a lazy chunk; load them before anything is collected (a describe body reads shippedFilter at collection time).
await preloadChatFilter();
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';

afterEach(() => setCatalogue('en', en));

const member = { name: 'Ilan', publicId: 'K7Q2M4XA' };

describe('seatLabel (GH-1075 A3)', () => {
  it('a member reads name · public id, tagged, with its record when shown', () => {
    setCatalogue('en', en);
    expect(seatLabel({ callsign: 'x', member: { ...member, record: { won: 3, lost: 1, drawn: 0 } } }, 'human')).toEqual({ text: 'Ilan · K7Q2M4XA', tag: 'member', record: '3-1', model: null });
    expect(seatLabel({ callsign: 'x', member: { ...member, record: { won: 3, lost: 1, drawn: 2 } } }, 'human').record).toBe('3-1-2');
    expect(seatLabel({ callsign: 'x', member }, 'human')).toMatchObject({ record: null, tag: 'member' });
  });
  it('a seat with no member is a guest, or a bot', () => {
    setCatalogue('en', en);
    expect(seatLabel({ callsign: 'Lion' }, 'human')).toEqual({ text: 'Lion', tag: 'guest', record: null, model: null });
    expect(seatLabel({ callsign: 'Bot' }, 'bot')).toEqual({ text: 'Bot', tag: 'bot', record: null, model: null });
  });
  it('a sandbox room shows no tag', () => {
    expect(seatLabel({ callsign: 'Lion' }, 'human', { sandbox: true }).tag).toBeNull();
    expect(seatLabel({ callsign: 'B' }, 'bot', { sandbox: true }).tag).toBeNull();
  });
  it('a bot with a listed model reads its catalogue string, bracketed under ?pseudo=1', () => {
    setCatalogue('en', en);
    expect(seatLabel({ callsign: 'B', botModel: { id: 'claude-sonnet-5-5' } }, 'bot').model).toBe('Claude Sonnet 5.5');
    setCatalogue('pseudo', en, pseudo);
    expect(seatLabel({ callsign: 'B', botModel: { id: 'claude-sonnet-5-5' } }, 'bot').model).toMatch(/^⟦/);
  });
  it('a typed model name is data: unbracketed under ?pseudo=1', () => {
    setCatalogue('pseudo', en, pseudo);
    expect(seatLabel({ callsign: 'B', botModel: { id: 'other', name: 'Zed-9' } }, 'bot').model).toBe('Zed-9');
  });
  it('a human seat carrying a stray botModel shows none', () => {
    expect(seatLabel({ callsign: 'H', botModel: { id: 'other', name: 'Zed-9' } }, 'human').model).toBeNull();
  });
});

describe('every typed seat name passes the chat word filter (GH-1417 S2)', () => {
  // The words come from the shipped English list, so this test writes no slur of its own.
  const enList = chatFilters.find((c) => c.lang === 'en');
  if (enList === undefined) throw new Error('no English list');
  const slur = enList.hide[0];
  it('a guest callsign, a bot callsign and a typed model name with a hide or mask word read as the fallback name', () => {
    setCatalogue('en', en);
    expect(seatLabel({ callsign: `big${slur}99` }, 'human').text).toBe(DEFAULT_CALLSIGN);
    expect(seatLabel({ callsign: `xx ${slur}` }, 'human').text).toBe(DEFAULT_CALLSIGN);
    expect(seatLabel({ callsign: 'Shit Lord' }, 'bot').text).toBe(DEFAULT_CALLSIGN);
    expect(seatLabel({ callsign: 'B', botModel: { id: 'other', name: `${slur} bot` } }, 'bot').model).toBe(DEFAULT_CALLSIGN);
    expect(seatLabel({ callsign: 'Desert Fox' }, 'human').text).toBe('Desert Fox');
  });
  it('a member keeps their public id beside the fallback name', () => {
    expect(seatLabel({ callsign: 'x', member: { name: `${slur}`, publicId: 'K7Q2M4XA' } }, 'human').text).toBe(`${DEFAULT_CALLSIGN} · K7Q2M4XA`);
  });
  it('the config callsign a seat falls back to without a lobby label is filtered as well, and labelsOf carries the filtered text', () => {
    expect(nameFrom(undefined, 1, `the ${slur}`)).toBe(DEFAULT_CALLSIGN);
    expect(nameFrom(undefined, 1, 'Desert Fox')).toBe('Desert Fox');
    const labels = labelsOf([{ seat: 1, callsign: `a ${slur}`, connected: true, ready: false }]);
    expect(labels[1]?.text).toBe(DEFAULT_CALLSIGN);
    expect(nameFrom(labels, 1, 'unused')).toBe(DEFAULT_CALLSIGN);
  });
});
