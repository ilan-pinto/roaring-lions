import { describe, expect, it } from 'vitest';
import type { AnnouncementManifest } from '@lions/render';
import type { SimEvent } from '@lions/sim';
import audioManifest from '../../../../data/audio.json';
import en from '../i18n/en.json';
import { INITIAL_ANNOUNCE, decideAnnouncements, medicCallInputs } from './announce';

const shipped = (audioManifest as unknown as { voices: { announcements: AnnouncementManifest } }).voices.announcements;
const down = (entity: number): SimEvent => ({ kind: 'woundedDown', tick: 0, entity, parent: 5, by: 20 }) as SimEvent;
// Entities 0-9 ours, 10-29 theirs, 30+ civilians.
const side = (e: number): number => (e < 10 ? 0 : e < 30 ? 1 : 2);

describe('medicCallInputs (GH-707 P2)', () => {
  it('one input for a burst of our men going down, none for anyone else\'s', () => {
    expect(medicCallInputs([down(1), down(2), down(3)], side)).toEqual([{ event: 'medic' }]);
    expect(medicCallInputs([down(12), down(31)], side)).toEqual([]);
    expect(medicCallInputs([], side)).toEqual([]);
  });

  it('the other seat hears its own men, not seat 0\'s', () => {
    expect(medicCallInputs([down(12)], side, 1)).toEqual([{ event: 'medic' }]);
    expect(medicCallInputs([down(1)], side, 1)).toEqual([]);
  });
});

describe('the shipped "medic" announcement', () => {
  it('speaks at most once per 8 s, with a caption that says "Medic!" and the voice slot once it is recorded', () => {
    const call = [{ event: 'medic' as const }];
    let r = decideAnnouncements(INITIAL_ANNOUNCE, call, shipped, 'he', 0);
    expect(r.cue?.caption).toBe('announce.medic');
    // GH-753: '' until tools/prepare_medic_voice.py fills the slot, then the slot's own key -- never anything else.
    expect(r.cue?.key).toBe(shipped.events.medic.audio);
    expect(['', 'he.common.announce_medic']).toContain(r.cue?.key);
    r = decideAnnouncements(r.state, call, shipped, 'he', 7_999);
    expect(r.cue).toBeNull();
    expect(r.notes[0].why).toBe('silent:cooldown');
    r = decideAnnouncements(r.state, call, shipped, 'he', 8_000);
    expect(r.cue?.caption).toBe('announce.medic');
    expect(en['announce.medic' as keyof typeof en]).toBe('Medic!');
  });
});
