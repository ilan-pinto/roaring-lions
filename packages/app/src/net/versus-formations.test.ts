import { describe, expect, it } from 'vitest';
import { FORMATION_VERSUS_REASON_KEY, VERSUS_FORMATIONS_OPEN, formationsOpenIn } from './versus-formations';
import { t } from '../i18n/t';

// GH-859 P1a: the one predicate behind the sender strip, the receiver gate and the HUD row's inert state.
describe('formationsOpenIn', () => {
  it('the gate ships closed: P1b flips it, gated on S4 per cell', () => {
    expect(VERSUS_FORMATIONS_OPEN).toBe(false);
  });
  it('a versus room follows the gate; every other place is open', () => {
    expect(formationsOpenIn('versus')).toBe(VERSUS_FORMATIONS_OPEN);
    expect(formationsOpenIn('versus')).toBe(false);
    expect(formationsOpenIn('versus', true)).toBe(true);
    expect(formationsOpenIn('versus', false)).toBe(false);
    for (const mode of [undefined, null, 'sandbox'] as const) {
      expect(formationsOpenIn(mode), String(mode)).toBe(true);
      expect(formationsOpenIn(mode, false), String(mode)).toBe(true);
    }
  });
  it('the reason line is a real catalogue string', () => {
    expect(FORMATION_VERSUS_REASON_KEY).toBe('hud.formation.inert.versus');
    expect(t(FORMATION_VERSUS_REASON_KEY)).toBe('Formations are not in versus rooms yet');
  });
});
