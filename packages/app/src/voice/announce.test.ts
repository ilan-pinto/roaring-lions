import { describe, expect, it } from 'vitest';
import type { AnnouncementManifest } from '@lions/render';
import type { MissionEvent } from '@lions/sim';
import audioManifest from '../../../../data/audio.json';
import en from '../i18n/en.json';
import {
  INITIAL_ANNOUNCE,
  UNIT_LOST_COALESCE_MS,
  UNIT_LOST_STALE_MS,
  announceInputsOf,
  decideAnnouncements,
  type AnnounceEventId,
  type AnnounceInput,
  type AnnounceState,
} from './announce';
import { VoiceRuntime, type VoiceRuntimeDeps } from './voice-runtime';
import type { DirectorLook, VoiceCue } from './director';
import type { VoiceResult } from '@lions/render';

const TABLE: AnnouncementManifest = {
  hold_s: 3,
  caption_s: 3.5,
  events: {
    objective_active: { caption: 'a.active', audio: '', cooldown_s: 2, priority: 'high' },
    objective_complete: { caption: 'a.complete', audio: '', cooldown_s: 2, priority: 'high' },
    objective_failed: { caption: 'a.failed', audio: '', cooldown_s: 2, priority: 'high' },
    deadline: { caption: 'a.deadline', audio: '', cooldown_s: 10, priority: 'high' },
    wave: { caption: 'a.wave', audio: '', cooldown_s: 20, priority: 'normal' },
    reinforcements: { caption: 'a.reinf', audio: '', cooldown_s: 8, priority: 'normal' },
    unit_lost: { caption: 'a.lost', audio: '', cooldown_s: 6, priority: 'low' },
  },
};
const inp = (event: AnnounceEventId): AnnounceInput => ({ event });
const lossOf = (n: number): AnnounceInput => ({ event: 'unit_lost', params: { n } });
const say = (s: AnnounceState, inputs: AnnounceInput[], nowMs: number) => decideAnnouncements(s, inputs, TABLE, 'he', nowMs);

describe('decideAnnouncements: cooldown (GH-110)', () => {
  it('speaks an event once per its cooldown, then again after it', () => {
    let r = say(INITIAL_ANNOUNCE, [inp('reinforcements')], 0);
    expect(r.cue?.caption).toBe('a.reinf');
    r = say(r.state, [inp('reinforcements')], 7_999);
    expect(r.cue).toBeNull();
    expect(r.notes[0].why).toBe('silent:cooldown');
    r = say(r.state, [inp('reinforcements')], 8_000);
    expect(r.cue?.caption).toBe('a.reinf');
  });

  it('a silenced event does not restart its own cooldown', () => {
    let r = say(INITIAL_ANNOUNCE, [inp('wave')], 0);
    r = say(r.state, [inp('wave')], 19_000);
    r = say(r.state, [inp('wave')], 20_000);
    expect(r.cue?.caption).toBe('a.wave');
  });

  it('cooldowns are per event: a different event speaks inside another one’s window', () => {
    let r = say(INITIAL_ANNOUNCE, [inp('wave')], 0);
    r = say(r.state, [inp('reinforcements')], 100);
    expect(r.cue?.caption).toBe('a.reinf');
  });
});

describe('decideAnnouncements: priority (GH-110)', () => {
  it('of several events in one tick only the highest speaks; the rest are outranked', () => {
    const r = say(INITIAL_ANNOUNCE, [inp('reinforcements'), inp('objective_complete'), inp('wave')], 0);
    expect(r.cue?.caption).toBe('a.complete');
    expect(r.notes.filter((n) => n.why === 'silent:outranked').map((n) => n.event).sort()).toEqual(['reinforcements', 'wave']);
  });

  it('an outranked event does not spend its cooldown', () => {
    let r = say(INITIAL_ANNOUNCE, [inp('wave'), inp('objective_complete')], 0);
    r = say(r.state, [inp('wave')], 3_000); // hold over, the wave never spoke
    expect(r.cue?.caption).toBe('a.wave');
  });

  it('a lower priority stays quiet while a higher one holds the floor, then may speak', () => {
    let r = say(INITIAL_ANNOUNCE, [inp('objective_failed')], 0);
    r = say(r.state, [inp('wave')], 2_999);
    expect(r.cue).toBeNull();
    expect(r.notes[0].why).toBe('silent:held');
    r = say(r.state, [inp('wave')], 3_000);
    expect(r.cue?.caption).toBe('a.wave');
  });

  it('an equal or higher priority may follow at once; a loss does not hold off an objective', () => {
    let r = say(INITIAL_ANNOUNCE, [inp('objective_active')], 0);
    r = say(r.state, [inp('objective_complete')], 100);
    expect(r.cue?.caption).toBe('a.complete');
    r = say(INITIAL_ANNOUNCE, [inp('unit_lost')], 0);
    r = say(r.state, [inp('objective_failed')], 100);
    expect(r.cue?.caption).toBe('a.failed');
  });

  it('within one priority the first input wins a tie', () => {
    const r = say(INITIAL_ANNOUNCE, [inp('wave'), inp('reinforcements')], 0);
    expect(r.cue?.caption).toBe('a.wave');
  });
});

describe('unit-lost coalescing over 2 s (AU-5)', () => {
  it('a salvo that kills across several ticks is one call, with the whole count, once the window closes', () => {
    expect(UNIT_LOST_COALESCE_MS).toBe(2000);
    let r = say(INITIAL_ANNOUNCE, [lossOf(1)], 0);
    expect(r.cue).toBeNull();
    expect(r.notes).toEqual([{ event: 'unit_lost', why: 'pending:coalesce', cue: null }]);
    r = say(r.state, [lossOf(2)], 50);
    expect(r.cue).toBeNull();
    r = say(r.state, [lossOf(1)], 1_900);
    expect(r.cue).toBeNull();
    r = say(r.state, [], 1_999);
    expect(r.cue).toBeNull();
    r = say(r.state, [], 2_000);
    expect(r.cue).toMatchObject({ caption: 'a.lost', captionParams: { n: 4 } });
    r = say(r.state, [], 2_050);
    expect(r.cue).toBeNull();
  });

  it('losses inside the cooldown are kept and counted, and said once it ends -- not dropped', () => {
    let r = say(INITIAL_ANNOUNCE, [lossOf(1)], 0);
    r = say(r.state, [], 2_000); // spoke: cooldown to 8 000
    r = say(r.state, [lossOf(1)], 3_000);
    r = say(r.state, [lossOf(2)], 4_000);
    r = say(r.state, [], 7_999);
    expect(r.cue).toBeNull();
    r = say(r.state, [], 8_000);
    expect(r.cue).toMatchObject({ caption: 'a.lost', captionParams: { n: 3 } });
  });

  it('a pending loss waits out a higher call’s hold and then speaks, rather than being dropped', () => {
    let r = say(INITIAL_ANNOUNCE, [lossOf(1)], 0);
    r = say(r.state, [inp('objective_complete')], 1_500); // holds lower calls to 4 500
    r = say(r.state, [], 2_000);
    expect(r.cue).toBeNull();
    r = say(r.state, [], 4_500);
    expect(r.cue).toMatchObject({ caption: 'a.lost', captionParams: { n: 1 } });
  });

  it('a count nobody got to say is dropped once it is stale: a loss call is about now', () => {
    let r = say(INITIAL_ANNOUNCE, [lossOf(1)], 0);
    for (let t = 1_000; t < UNIT_LOST_STALE_MS; t += 2_500) r = say(r.state, [inp(t % 2 ? 'objective_active' : 'objective_complete')], t);
    r = say(r.state, [], UNIT_LOST_STALE_MS);
    expect(r.cue).toBeNull();
    expect(r.notes.map((n) => n.why)).toContain('silent:stale');
    r = say(r.state, [], UNIT_LOST_STALE_MS + 10_000);
    expect(r.cue).toBeNull();
  });
});

describe('the cue (GH-110)', () => {
  it('carries the caption key, params, length, the radio priority and no position', () => {
    const r = decideAnnouncements(INITIAL_ANNOUNCE, [{ event: 'objective_failed', params: { label: 'Hold' } }], TABLE, 'he', 0);
    expect(r.cue).toMatchObject({ key: '', lang: 'he', trigger: 'announce', priority: 'announce_high', at: null, caption: 'a.failed', captionParams: { label: 'Hold' }, captionSeconds: 3.5 });
  });

  it('carries the manifest priority onto the voice ladder: high, normal and low are three rungs (AU-5)', () => {
    expect(say(INITIAL_ANNOUNCE, [inp('deadline')], 0).cue?.priority).toBe('announce_high');
    expect(say(INITIAL_ANNOUNCE, [inp('wave')], 0).cue?.priority).toBe('announce');
    const lost = say(say(INITIAL_ANNOUNCE, [lossOf(1)], 0).state, [], UNIT_LOST_COALESCE_MS);
    expect(lost.cue?.priority).toBe('announce_low');
  });

  it('an event the table does not know is noted and silent, never thrown', () => {
    const r = decideAnnouncements(INITIAL_ANNOUNCE, [inp('wave')], { ...TABLE, events: {} }, 'he', 0);
    expect(r.cue).toBeNull();
    expect(r.notes[0].why).toBe('silent:unknown');
  });

  it('never mutates the state it is given', () => {
    const s = say(INITIAL_ANNOUNCE, [inp('wave')], 0).state;
    const frozen = JSON.stringify(s);
    say(s, [inp('objective_complete')], 10);
    expect(JSON.stringify(s)).toBe(frozen);
  });
});

describe('announceInputsOf', () => {
  const ev = (e: Partial<MissionEvent> & { kind: MissionEvent['kind'] }): MissionEvent => ({ tick: 1, ...e }) as MissionEvent;
  it('maps objective status, wave and built, labelling objectives', () => {
    const out = announceInputsOf(
      [
        ev({ kind: 'objective', id: 'o1', status: 'complete' }),
        ev({ kind: 'objective', id: 'o2', status: 'failed' }),
        ev({ kind: 'objective', id: 'o3', status: 'active' }),
        ev({ kind: 'wave', count: 4 }),
        ev({ kind: 'built', unit: 'x' }),
      ],
      (id) => `L-${id}`
    );
    expect(out).toEqual([
      { event: 'objective_complete', params: { label: 'L-o1' } },
      { event: 'objective_failed', params: { label: 'L-o2' } },
      { event: 'objective_active', params: { label: 'L-o3' } },
      { event: 'wave' },
      { event: 'reinforcements' },
    ]);
  });

  it('coalesces a squad wipe into one loss call with a count', () => {
    const out = announceInputsOf(
      [ev({ kind: 'unitLost', entity: 1, unit: 'a' }), ev({ kind: 'unitLost', entity: 2, unit: 'a' }), ev({ kind: 'unitLost', entity: 3, unit: 'b' })],
      (id) => id
    );
    expect(out).toEqual([{ event: 'unit_lost', params: { n: 3 } }]);
  });

  it('says nothing for events nobody announces', () => {
    expect(announceInputsOf([ev({ kind: 'trigger', id: 't' }), ev({ kind: 'say', speaker: 'shai', text: 'x' })], (i) => i)).toEqual([]);
  });

  it('a Conduct penalty is announced (polish pass F, A9)', () => {
    expect(announceInputsOf([ev({ kind: 'roe', penalty: 1, reason: 'r', score: 1 })], (i) => i)).toEqual([{ event: 'roe' }]);
  });
});

describe('the shipped table', () => {
  const t = (audioManifest as { voices: { announcements: AnnouncementManifest; lines: Record<string, unknown> } }).voices;
  it('declares every event the announcer can raise, each with a real caption key', () => {
    const ids: AnnounceEventId[] = ['objective_active', 'objective_complete', 'objective_failed', 'deadline', 'wave', 'reinforcements', 'unit_lost', 'mission_start', 'roe'];
    expect(Object.keys(t.announcements.events).sort()).toEqual([...ids].sort());
    for (const [id, def] of Object.entries(t.announcements.events)) {
      expect(def.caption in en, id).toBe(true);
      expect(def.audio === '' || def.audio in t.lines, id).toBe(true);
    }
  });

  it('puts every objective and deadline call above a unit-lost call', () => {
    const e = t.announcements.events;
    expect(e.unit_lost.priority).toBe('low');
    for (const id of ['objective_active', 'objective_complete', 'objective_failed', 'deadline']) expect(e[id].priority).toBe('high');
  });
});

// --- through the runtime: the one cue and caption path ---------------------
const look: DirectorLook = {
  unitOf: () => null,
  side: () => 0,
  pos: () => ({ x: 0, y: 0 }),
  isVisible: () => true,
  camera: () => ({ x: 0, y: 0 }),
};
function rig(table: AnnouncementManifest, over: Partial<VoiceRuntimeDeps> = {}) {
  const played: VoiceCue[] = [];
  const captions: [string, number][] = [];
  let now = 0;
  const always: boolean[] = [];
  let result: VoiceResult = { status: 'missing', seconds: 0, en: null, cut: 0 };
  const rt = new VoiceRuntime({
    now: () => now,
    schedule: (fn) => fn(),
    look,
    languages: {},
    play: (c) => {
      played.push(c);
      return result;
    },
    caption: (x, s, a) => {
      captions.push([x, s]);
      always.push(a === true);
    },
    info: () => {},
    text: (k, p) => (p ? `${k}|${JSON.stringify(p)}` : k),
    announcements: table,
    announceLang: 'he',
    labelOf: (id) => `label:${id}`,
    ...over,
  });
  return { rt, played, captions, always, setNow: (n: number) => void (now = n), setResult: (r: VoiceResult) => void (result = r) };
}
const complete: MissionEvent = { kind: 'objective', tick: 1, id: 'o1', status: 'complete' };

describe('VoiceRuntime.onMission (GH-110)', () => {
  it('captions an announcement with no audio and never touches the mixer', () => {
    const r = rig(TABLE);
    r.rt.onMission([complete]);
    expect(r.captions).toEqual([['a.complete|{"label":"label:o1"}', 3.5]]);
    // Polish pass F (A5): an announcement captions whatever the setting says.
    expect(r.always).toEqual([true]);
    expect(r.played).toEqual([]);
    expect(r.rt.log()).toMatchObject([{ source: 'announce', trigger: 'objective_complete', why: 'line', status: null }]);
  });

  it('with an audio key whose take is missing, falls back to the caption alone', () => {
    const table = { ...TABLE, events: { ...TABLE.events, objective_complete: { ...TABLE.events.objective_complete, audio: 'he.common.announce_objective_complete' } } };
    const r = rig(table);
    r.setResult({ status: 'missing', seconds: 0, en: null, cut: 0 });
    r.rt.onMission([complete]);
    expect(r.played.map((c) => [c.key, c.priority])).toEqual([['he.common.announce_objective_complete', 'announce_high']]);
    expect(r.captions).toHaveLength(1);
    expect(r.rt.log()[0].status).toBe('missing');
  });

  it('with a recorded take, plays it and still shows the house caption', () => {
    const table = { ...TABLE, events: { ...TABLE.events, objective_complete: { ...TABLE.events.objective_complete, audio: 'he.common.announce_objective_complete' } } };
    const r = rig(table);
    r.setResult({ status: 'played', seconds: 1.2, en: 'the take’s own words', cut: 0 });
    r.rt.onMission([complete]);
    expect(r.captions).toEqual([['a.complete|{"label":"label:o1"}', 3.5]]);
    expect(r.rt.log()[0].status).toBe('played');
  });

  it('fires its caption once per cooldown, and a deadline raised by the app joins the same path', () => {
    const r = rig(TABLE);
    r.rt.onMission([complete]);
    r.setNow(1_000);
    r.rt.onMission([complete]);
    expect(r.captions).toHaveLength(1);
    r.setNow(5_000);
    r.rt.onMission([], [{ event: 'deadline', params: { label: 'Raze' } }]);
    expect(r.captions.map((c) => c[0])).toEqual(['a.complete|{"label":"label:o1"}', 'a.deadline|{"label":"Raze"}']);
  });

  it('a loss inside an objective call’s hold stays silent', () => {
    const r = rig(TABLE);
    r.rt.onMission([complete]);
    r.setNow(500);
    r.rt.onMission([{ kind: 'unitLost', tick: 2, entity: 1, side: 0, unit: 'x' } as MissionEvent]);
    expect(r.captions).toHaveLength(1);
  });

  it('a coalesced loss is said on a later, quiet tick: the runtime asks even when nothing new happened (AU-5)', () => {
    const r = rig(TABLE);
    r.rt.onMission([{ kind: 'unitLost', tick: 2, entity: 1, side: 0, unit: 'x' } as MissionEvent]);
    r.setNow(1_000);
    r.rt.onMission([{ kind: 'unitLost', tick: 22, entity: 2, side: 0, unit: 'x' } as MissionEvent]);
    expect(r.captions).toEqual([]);
    r.setNow(2_000);
    r.rt.onMission([]);
    expect(r.captions).toEqual([['a.lost|{"n":2}', 3.5]]);
  });

  it('does nothing without a table, and nothing after dispose', () => {
    const none = rig(TABLE, { announcements: undefined });
    none.rt.onMission([complete]);
    expect(none.captions).toEqual([]);
    const r = rig(TABLE);
    r.rt.dispose();
    r.rt.onMission([complete]);
    expect(r.captions).toEqual([]);
  });
});
