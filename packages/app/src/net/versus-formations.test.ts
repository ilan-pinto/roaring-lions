import { describe, expect, it } from 'vitest';
import { FORMATION_VERSUS_REASON_KEY, VERSUS_FORMATIONS_CLOSED_MAPS, VERSUS_FORMATIONS_OPEN, formationsOpenIn } from './versus-formations';
import { t } from '../i18n/t';

// GH-859 P1a: the one predicate behind the sender strip, the receiver gate and the HUD row's inert state.
describe('formationsOpenIn', () => {
  it('the gate ships OPEN since S4 passed on Beit Sahwan, Tel Marum, Milh Flats and Wadi Tarfan (GH-859, lead 1 Nov; GH-945)', () => {
    expect(VERSUS_FORMATIONS_OPEN).toBe(true);
  });
  it('a versus room follows the gate on a map that is not closed; every other place is open', () => {
    expect(formationsOpenIn('versus')).toBe(VERSUS_FORMATIONS_OPEN);
    expect(formationsOpenIn('versus')).toBe(true);
    expect(formationsOpenIn('versus', true)).toBe(true);
    expect(formationsOpenIn('versus', false)).toBe(false);
    expect(formationsOpenIn('versus', undefined, 'tel_marum')).toBe(true);
    for (const mode of [undefined, null, 'sandbox'] as const) {
      expect(formationsOpenIn(mode), String(mode)).toBe(true);
      expect(formationsOpenIn(mode, false), String(mode)).toBe(true);
    }
  });
  it('GH-913 L8: a map in VERSUS_FORMATIONS_CLOSED_MAPS stays closed with the gate open; the others follow the gate', () => {
    // Was ['rujm_sawda', 'wadi_tarfan']: Wadi Tarfan left the list when S4 passed on its re-seated cells (GH-945).
    expect([...VERSUS_FORMATIONS_CLOSED_MAPS]).toEqual(['rujm_sawda']);
    expect(formationsOpenIn('versus', true, 'rujm_sawda')).toBe(false);
    // GH-945: Wadi Tarfan follows the gate like any other map: open with it open, shut with it shut.
    expect(formationsOpenIn('versus', true, 'wadi_tarfan')).toBe(true);
    expect(formationsOpenIn('versus', undefined, 'wadi_tarfan')).toBe(true);
    expect(formationsOpenIn('versus', false, 'wadi_tarfan')).toBe(false);
    expect(formationsOpenIn('sandbox', undefined, 'wadi_tarfan')).toBe(true);
    expect(formationsOpenIn('versus', true, 'tel_marum')).toBe(true);
    expect(formationsOpenIn('versus', true, null)).toBe(true);
    expect(formationsOpenIn('versus', true)).toBe(true);
    // The map only narrows a versus room: sandbox and single player stay open on it.
    expect(formationsOpenIn('sandbox', undefined, 'rujm_sawda')).toBe(true);
    expect(formationsOpenIn(undefined, undefined, 'rujm_sawda')).toBe(true);
  });
  it('the reason line is a real catalogue string', () => {
    expect(FORMATION_VERSUS_REASON_KEY).toBe('hud.formation.inert.versus');
    expect(t(FORMATION_VERSUS_REASON_KEY)).toBe('Formations are not in versus rooms yet');
  });
});
