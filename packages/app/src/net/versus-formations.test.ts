import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { versusRules } from '@lions/data';
import type { MatchConfig } from '@lions/net';
import { FORMATION_ROOM_REASON_KEY, FORMATION_VERSUS_REASON_KEY, VERSUS_FORMATIONS_CLOSED_MAPS, VERSUS_FORMATIONS_OPEN, formationClosedReason, formationsClosedByRules, formationsOpenIn, roomKindOf } from './versus-formations';
import { t } from '../i18n/t';

// GH-859 P1a: the one predicate behind the sender strip, the receiver gate and the HUD row's inert state.
describe('formationsOpenIn', () => {
  it('the gate ships OPEN since S4 passed on Beit Sahwan, Tel Marum, Milh Flats and Wadi Tarfan (GH-859, lead 1 Nov; GH-945), and on Rujm Sawda and Milh Flats (large) (3 Nov)', () => {
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
    // Was ['rujm_sawda']: Wadi Tarfan (large) is closed from birth, until its own S4 run (GH-920 B3).
    // Was ['rujm_sawda', 'wadi_tarfan_l']: Milh Flats (large) is closed from birth too (GH-920 B3).
    // Was ['rujm_sawda', 'wadi_tarfan_l', 'milh_flats_l']: Rujm Sawda and Milh Flats (large) passed their own S4 run on 3 Nov (GH-913); Wadi Tarfan (large) tripped one cell of 21 and stays.
    // Was ['wadi_tarfan_l']: Tel Marum (large) is closed from birth too, until its own S4 run (GH-920 B3).
    expect([...VERSUS_FORMATIONS_CLOSED_MAPS]).toEqual(['wadi_tarfan_l', 'tel_marum_l']);
    expect(formationsOpenIn('versus', true, 'tel_marum_l')).toBe(false);
    expect(formationsOpenIn('versus', undefined, 'tel_marum_l')).toBe(false);
    // the original follows the gate
    expect(formationsOpenIn('versus', true, 'tel_marum')).toBe(true);
    expect(formationsOpenIn('versus', true, 'wadi_tarfan_l')).toBe(false);
    expect(formationsOpenIn('versus', undefined, 'wadi_tarfan_l')).toBe(false);
    // The two that passed follow the gate like any other map: open with it open, shut with it shut.
    for (const map of ['rujm_sawda', 'milh_flats_l']) {
      expect(formationsOpenIn('versus', true, map), map).toBe(true);
      expect(formationsOpenIn('versus', undefined, map), map).toBe(true);
      expect(formationsOpenIn('versus', false, map), map).toBe(false);
    }
    // GH-945: Wadi Tarfan follows the gate like any other map: open with it open, shut with it shut.
    expect(formationsOpenIn('versus', true, 'wadi_tarfan')).toBe(true);
    expect(formationsOpenIn('versus', undefined, 'wadi_tarfan')).toBe(true);
    expect(formationsOpenIn('versus', false, 'wadi_tarfan')).toBe(false);
    expect(formationsOpenIn('sandbox', undefined, 'wadi_tarfan')).toBe(true);
    expect(formationsOpenIn('versus', true, 'tel_marum')).toBe(true);
    expect(formationsOpenIn('versus', true, null)).toBe(true);
    expect(formationsOpenIn('versus', true)).toBe(true);
    // The map only narrows a versus room: sandbox and single player stay open on it.
    expect(formationsOpenIn('sandbox', undefined, 'wadi_tarfan_l')).toBe(true);
    expect(formationsOpenIn(undefined, undefined, 'wadi_tarfan_l')).toBe(true);
  });
  // GH-859 (the lead's ruling of 5 Nov): formations are open in versus rooms, except a Tel Marum ECONOMY room. The exclusion is data:
  // `formations_closed_in` in a map's rules file, read by room KIND, so no map id is written in the predicate.
  const room = (a: 'kdf' | 'sarim', b: 'kdf' | 'sarim', winMode?: 'camp'): Pick<MatchConfig, 'mode' | 'seats' | 'winMode'> =>
    ({ mode: 'versus', seats: [{ faction: a }, { faction: b }], ...(winMode === undefined ? {} : { winMode }) }) as unknown as Pick<MatchConfig, 'mode' | 'seats' | 'winMode'>;
  it('roomKindOf names the kind of a versus room: mirror, placed (a win-mode room on two factions) or economy; anything else has none', () => {
    expect(roomKindOf(room('kdf', 'kdf'))).toBe('mirror');
    expect(roomKindOf(room('sarim', 'sarim'))).toBe('mirror');
    expect(roomKindOf(room('kdf', 'sarim'))).toBe('economy');
    expect(roomKindOf(room('sarim', 'kdf'))).toBe('economy');
    expect(roomKindOf(room('kdf', 'sarim', 'camp'))).toBe('placed');
    expect(roomKindOf({ ...room('kdf', 'sarim'), mode: 'sandbox' } as Pick<MatchConfig, 'mode' | 'seats' | 'winMode'>)).toBeUndefined();
    expect(roomKindOf(null)).toBeUndefined();
    expect(roomKindOf(undefined)).toBeUndefined();
  });
  it('the rules files close ONE thing: Tel Marum economy rooms (the data, pinned so a second entry is a decision)', () => {
    const closed = Object.entries(versusRules as Record<string, { formations_closed_in?: string[] }>)
      .filter(([, r]) => r.formations_closed_in !== undefined)
      .map(([map, r]) => [map, r.formations_closed_in]);
    expect(closed).toEqual([['tel_marum', ['economy']]]);
  });
  it('a Tel Marum economy room is closed with the gate open; every other kind on Tel Marum, and an economy room on any other map, is open', () => {
    expect(formationsOpenIn('versus', true, 'tel_marum', 'economy')).toBe(false);
    expect(formationsOpenIn('versus', undefined, 'tel_marum', 'economy')).toBe(false);
    expect(formationsOpenIn('versus', true, 'tel_marum', 'mirror')).toBe(true);
    expect(formationsOpenIn('versus', true, 'tel_marum', 'placed')).toBe(true);
    expect(formationsOpenIn('versus', true, 'tel_marum')).toBe(true); // a caller that gives no kind gets the map's answer alone
    for (const map of ['wadi_tarfan', 'rujm_sawda', 'milh_flats_l', 'beit_sahwan_outskirts', 'milh_flats']) {
      for (const kind of ['mirror', 'placed', 'economy'] as const) expect(formationsOpenIn('versus', true, map, kind), `${map} ${kind}`).toBe(true);
    }
    // The kind only narrows a versus room: the sandbox and single player stay open on it.
    expect(formationsOpenIn('sandbox', undefined, 'tel_marum', 'economy')).toBe(true);
    expect(formationsOpenIn(undefined, undefined, 'tel_marum', 'economy')).toBe(true);
    // ...and the gate still wins over the data.
    expect(formationsOpenIn('versus', false, 'wadi_tarfan', 'mirror')).toBe(false);
  });
  it('formationsClosedByRules reads the file, not an id: no rules file, no map and no kind close nothing', () => {
    expect(formationsClosedByRules('tel_marum', 'economy')).toBe(true);
    expect(formationsClosedByRules('tel_marum', 'mirror')).toBe(false);
    expect(formationsClosedByRules('beit_sahwan_outskirts', 'economy')).toBe(false); // a mirror-only map has no rules file
    expect(formationsClosedByRules('nosuch', 'economy')).toBe(false);
    expect(formationsClosedByRules(null, 'economy')).toBe(false);
    expect(formationsClosedByRules('tel_marum', undefined)).toBe(false);
  });
  // GH-859: "not in versus rooms yet" is wrong in a room kind a map's rules file closes: formations ARE in versus rooms, just not in this kind.
  it('the reason line: a Tel Marum economy room says its own thing; Wadi Tarfan (large) keeps the versus line', () => {
    expect(FORMATION_ROOM_REASON_KEY).toBe('hud.formation.inert.room');
    const tel = formationClosedReason('tel_marum', 'economy');
    expect(tel).toEqual({ key: 'hud.formation.inert.room', params: { kind: 'economy' } });
    expect(t(tel.key, tel.params)).toBe('Formations are off in economy rooms on this map');
    const large = formationClosedReason('wadi_tarfan_l', 'economy');
    expect(large).toEqual({ key: FORMATION_VERSUS_REASON_KEY });
    expect(t(large.key, large.params)).toBe('Formations are not in versus rooms yet');
    // a map that is whole-closed keeps the versus line whatever its kind; a kind the rules do not close has nothing to say (the versus line is the default)
    expect(formationClosedReason('wadi_tarfan_l', 'mirror')).toEqual({ key: FORMATION_VERSUS_REASON_KEY });
    expect(formationClosedReason('tel_marum', 'mirror')).toEqual({ key: FORMATION_VERSUS_REASON_KEY });
    expect(formationClosedReason(null, undefined)).toEqual({ key: FORMATION_VERSUS_REASON_KEY });
  });
  it('precedence: a map closed WHOLE, or the gate shut, keeps the versus line even when its rules file also closes the kind', () => {
    const yes = (): boolean => true;
    // the injected rules close every kind everywhere; only the map / gate decide which line is true
    expect(formationClosedReason('tel_marum', 'economy', true, yes)).toEqual({ key: FORMATION_ROOM_REASON_KEY, params: { kind: 'economy' } });
    expect(formationClosedReason('wadi_tarfan_l', 'economy', true, yes)).toEqual({ key: FORMATION_VERSUS_REASON_KEY });
    expect(formationClosedReason('tel_marum', 'economy', false, yes)).toEqual({ key: FORMATION_VERSUS_REASON_KEY });
    // and the rules are asked about the room's own map and kind
    const asked: unknown[][] = [];
    formationClosedReason('tel_marum', 'placed', true, (m, k) => { asked.push([m, k]); return false; });
    expect(asked).toEqual([['tel_marum', 'placed']]);
  });
  it('the room line names a kind it knows and falls back to a plain phrase for any other', () => {
    expect(t(FORMATION_ROOM_REASON_KEY, { kind: 'economy' })).toBe('Formations are off in economy rooms on this map');
    for (const kind of ['mirror', 'placed']) expect(t(FORMATION_ROOM_REASON_KEY, { kind }), kind).toBe('Formations are off in this kind of room on this map');
  });
  it('main.ts hands the room kind\'s reason to the HUD row, the arming and the armed cursor (a call that drops it falls back to the versus line)', () => {
    const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    expect(main).toContain('const formationClosedNow = () => formationClosedReason(netConfig?.map, roomKindOf(netConfig));');
    expect(main).toContain('formationClosedReason: formationClosedNow,'); // the HUD's deps
    expect(main).toContain('closedReason: formationClosedNow(), units:'); // the arming's row
    expect(main).toContain('reason: formationClosedNow,'); // the arming's deps
    expect(main).toContain('reason: formationClosedNow() } : null,'); // the armed cursor
  });
  it('the reason line is a real catalogue string', () => {
    expect(FORMATION_VERSUS_REASON_KEY).toBe('hud.formation.inert.versus');
    expect(t(FORMATION_VERSUS_REASON_KEY)).toBe('Formations are not in versus rooms yet');
  });
});
