/**
 * Cue coverage (polish pass F, AU-1): every critical event in the audio plan
 * sounds, and sounds as itself.
 *
 * `cues.ts` maps EVENTS to cue ids in typed exhaustive records, so a new
 * `MissionEvent` kind or objective status with no decision is a `tsc` error
 * there. This holds the other half -- `data/audio.json`, the shipped
 * manifest, read as the app reads it -- to those ids:
 *
 *  1. every cue id the app can ask for is in the manifest's `cues` table,
 *     and the table names nothing the app does not ask for;
 *  2. every mapped set exists, is a `ui` set (played unplaced), and ships at
 *     least one clip -- no critical cue lives on the synth stand-in;
 *  3. the cues that must never sound alike do not share a set: objective
 *     new / complete / failed, the three alert tiers, victory / defeat;
 *  4. every `MissionEvent` kind has a decision, a cue or a reasoned silence,
 *     and every cue it names is a real id.
 */
import { describe, expect, it } from 'vitest';
import { MISSION_EVENT_KINDS } from '@lions/sim';
import type { AudioManifest } from '@lions/render';
import manifestJson from '../../../../data/audio.json';
import {
  ALERT_CUE,
  CRITICAL_CUES,
  CUE_IDS,
  CUE_PRECEDENCE,
  MISSION_EVENT_SOUND,
  OBJECTIVE_CUE,
  OUTCOME_CUE,
  type CueId,
} from './cues';

const manifest = manifestJson as AudioManifest;
const table = manifest.cues ?? {};
const setOf = (id: CueId): string | null => {
  const entry = table[id];
  return typeof entry === 'string' ? entry : null;
};

describe('the cue map covers every critical event (AU-1)', () => {
  it('every cue id the app can ask for is mapped, and nothing else is', () => {
    const mapped = Object.keys(table).filter((k) => !k.startsWith('$'));
    expect([...mapped].sort()).toEqual([...CUE_IDS].sort());
  });

  it.each(Object.entries(CRITICAL_CUES))('%s (%s) plays a shipped ui set with a clip', (_moment, id) => {
    const set = setOf(id);
    expect(set, `${id} is not mapped to a set`).not.toBeNull();
    const spec = manifest.sets?.[set ?? ''];
    expect(spec, `${id} -> ${set}: no such set`).toBeDefined();
    expect(spec?.event).toBe('ui');
    expect(spec?.variants?.length ?? 0, `${id} -> ${set}: no clip, only the synth`).toBeGreaterThan(0);
  });

  it('objective new, complete and failed are three different sounds', () => {
    const sets = Object.values(OBJECTIVE_CUE).map(setOf);
    expect(new Set(sets).size).toBe(3);
  });

  it('the three alert tiers are three different sounds', () => {
    const sets = Object.values(ALERT_CUE).map(setOf);
    expect(new Set(sets).size).toBe(3);
  });

  it('victory and defeat are two different sounds, and neither is an alert or an objective', () => {
    const outcome = Object.values(OUTCOME_CUE).map(setOf);
    expect(new Set(outcome).size).toBe(2);
    const others = [...Object.values(ALERT_CUE), ...Object.values(OBJECTIVE_CUE)].map(setOf);
    for (const s of outcome) expect(others).not.toContain(s);
  });

  it('every MissionEvent kind has a decision: a real cue, or a reasoned silence', () => {
    for (const kind of MISSION_EVENT_KINDS) {
      const d = MISSION_EVENT_SOUND[kind];
      expect(d, kind).toBeDefined();
      if ('silent' in d) expect(d.silent.length, kind).toBeGreaterThan(10);
      else for (const c of d.cues) expect(CUE_IDS, `${kind} -> ${c}`).toContain(c);
    }
  });

  it('the outcome kind sounds exactly the two outcome cues', () => {
    const d = MISSION_EVENT_SOUND.missionEnd;
    expect('cues' in d ? [...d.cues].sort() : []).toEqual([OUTCOME_CUE.defeat, OUTCOME_CUE.victory].sort());
  });

  it('every alert and objective cue has a place in the per-tick precedence', () => {
    for (const id of [...Object.values(ALERT_CUE), ...Object.values(OBJECTIVE_CUE), ...Object.values(OUTCOME_CUE)]) {
      expect(CUE_PRECEDENCE).toContain(id);
    }
  });
});
