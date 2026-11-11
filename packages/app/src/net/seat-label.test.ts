import { afterEach, describe, expect, it } from 'vitest';
import { seatLabel } from './seat-label';
import { setCatalogue } from '../i18n/t';
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
