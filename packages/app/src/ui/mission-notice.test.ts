import type { MissionEvent } from '@lions/sim';
import { describe, expect, it } from 'vitest';
import { missionEventTier } from './alerts';
import { FEED_MERGE_WINDOW_MS } from './feed-model';
import {
  alertNotice,
  CIVILIAN_FEED_WINDOW_TICKS,
  CIVILIAN_STREAK_TICKS,
  CivilianFeed,
  civilianLineNotice,
  civilianLineReplaces,
  civilianTallyOf,
  coalesceCivilianEvents,
  evacuatedNotice,
  placePhrase,
  reinforceTrigger,
  removedNotice,
  ledgerSavedNotice,
  triggerLabel,
  unknownSandboxMapNotice,
  writeCivilianLines,
  type CivilianFeedEntry,
  type CivilianLine,
} from './mission-notice';

describe('removedNotice', () => {
  it('reads "taken (n)" for a civilian (side 2)', () => {
    const [html, tone] = removedNotice(2, 'civilians');
    expect(html).toContain('taken');
    expect(html).toContain('(1)');
    expect(tone).toBe('bad');
  });

  it('reads "<unit> taken" for a player unit, using the type id verbatim like the built case does', () => {
    const [html, tone] = removedNotice(0, 'inf_squad');
    expect(html).toContain('inf_squad');
    expect(html).toContain('taken');
    expect(tone).toBe('bad');
  });

  it('never uses a word that reads as a kill', () => {
    for (const [html] of [removedNotice(2, 'civilians'), removedNotice(0, 'inf_squad')]) {
      for (const forbidden of ['destroyed', 'killed', 'dead', 'lost']) {
        expect(html.toLowerCase()).not.toContain(forbidden);
      }
    }
  });
});

describe('evacuatedNotice', () => {
  it('reads as the mirror of an abduction: same shape, opposite tone', () => {
    const [html, tone] = evacuatedNotice();
    const [takenHtml, takenTone] = removedNotice(2, 'civilians');
    expect(html).toBe('<b>clear</b> (1)');
    expect(tone).toBe('good');
    // The two ways a civilian leaves the field, worded alike on purpose.
    expect(takenHtml).toBe('<b>taken</b> (1)');
    expect(takenTone).toBe('bad');
    expect(tone).not.toBe(takenTone);
  });

  it('says one by default, and the count it is given (E4 folds the count, `CivilianFeed`)', () => {
    expect(evacuatedNotice()[0]).toBe('<b>clear</b> (1)');
    expect(evacuatedNotice(30)[0]).toBe('<b>clear</b> (30)');
    expect(removedNotice(2, 'civilians', 12)[0]).toBe('<b>taken</b> (12)');
    // A player unit is named, never counted.
    expect(removedNotice(0, 'inf_squad', 12)[0]).not.toContain('12');
  });
});

// Civilian drama E4 (GH-1438, `docs/campaign/civilian-drama.md` 10.2): the
// merged feed line. Every expected value below is a literal.
describe('E4: the civilian feed line folds a second of arrivals into one', () => {
  const evac = (tick: number, entity = 0): MissionEvent => ({ kind: 'evacuated', tick, entity });
  const removed = (tick: number, side: number, entity = 0): MissionEvent => ({ kind: 'removed', tick, entity, side, unit: side === 2 ? 'civilians' : 'inf_squad' });
  const civ = (tally: 'evacuated' | 'taken', n: number, total: number, replaces: number, tick: number): CivilianFeedEntry<string> => ({ civilian: { tally, n, total, replaces, tick } });
  const named = (e: MissionEvent): string | null => (e.kind === 'removed' ? `unit:${e.side}` : e.kind === 'trigger' ? `trigger:${e.id}` : null);

  it('a window is one second and a streak eight, on the sim clock', () => {
    expect(CIVILIAN_FEED_WINDOW_TICKS).toBe(20);
    expect(CIVILIAN_STREAK_TICKS).toBe(160);
    // The streak is the feed's own merge window, at 50 ms a tick.
    expect(CIVILIAN_STREAK_TICKS * 50).toBe(FEED_MERGE_WINDOW_MS);
  });

  it('30 arrivals in 20 ticks are one line, n = 30', () => {
    const events: MissionEvent[] = [];
    for (let i = 0; i < 30; i++) events.push(evac(Math.floor((i * 20) / 30), 100 + i));
    expect(events[29].tick).toBe(19);
    expect(coalesceCivilianEvents(events, 20)).toEqual([civ('evacuated', 30, 30, 0, 0)]);
  });

  it('a taken civilian and a taken soldier in the same second are not merged', () => {
    const out = coalesceCivilianEvents([removed(0, 2, 1), removed(5, 0, 2), removed(10, 2, 3)], 20, named);
    // The soldier is his own line, worded by the caller; the civilians are
    // counted without him, and the open tally is written before his line.
    expect(out).toEqual([civ('taken', 1, 1, 0, 0), { event: removed(5, 0, 2), line: 'unit:0' }, civ('taken', 1, 2, 1, 10)]);
    expect(civilianTallyOf(removed(0, 0))).toBeNull();
    expect(civilianTallyOf(removed(0, 1))).toBeNull();
    expect(civilianTallyOf(removed(0, 2))).toBe('taken');
  });

  it('clear and taken are separate tallies in the same second', () => {
    expect(coalesceCivilianEvents([evac(0), removed(2, 2), evac(4), removed(6, 2), removed(8, 2)], 20)).toEqual([
      civ('evacuated', 2, 2, 0, 0),
      civ('taken', 3, 3, 0, 2),
    ]);
  });

  it('the window holds 20 ticks: tick 19 joins it, tick 20 opens the next', () => {
    expect(coalesceCivilianEvents([evac(0), evac(19)], 20)).toEqual([civ('evacuated', 2, 2, 0, 0)]);
    expect(coalesceCivilianEvents([evac(0), evac(20)], 20)).toEqual([civ('evacuated', 1, 1, 0, 0), civ('evacuated', 1, 2, 1, 20)]);
    const feed = new CivilianFeed(20);
    expect(feed.take(evac(0))).toBe(true);
    expect(feed.due(19)).toEqual([]);
    expect(feed.due(20)).toEqual([{ tally: 'evacuated', n: 1, total: 1, replaces: 0, tick: 0 }]);
    expect(feed.due(40)).toEqual([]);
  });

  it('a steady run is one streak whose total climbs; eight silent seconds start a fresh count', () => {
    // Three a second for four seconds.
    const run: MissionEvent[] = [];
    for (let s = 0; s < 4; s++) for (let k = 0; k < 3; k++) run.push(evac(s * 20 + k * 6));
    expect(coalesceCivilianEvents(run, 20)).toEqual([
      civ('evacuated', 3, 3, 0, 0),
      civ('evacuated', 3, 6, 3, 20),
      civ('evacuated', 3, 9, 6, 40),
      civ('evacuated', 3, 12, 9, 60),
    ]);
    // 160 ticks after the last arrival the streak still stands; 161 and it is over.
    expect(coalesceCivilianEvents([evac(0), evac(160)], 20)).toEqual([civ('evacuated', 1, 1, 0, 0), civ('evacuated', 1, 2, 1, 160)]);
    expect(coalesceCivilianEvents([evac(0), evac(161)], 20)).toEqual([civ('evacuated', 1, 1, 0, 0), civ('evacuated', 1, 1, 0, 161)]);
  });

  it('another line writes the open tallies first, so the feed stays in order', () => {
    const trigger: MissionEvent = { kind: 'trigger', tick: 4, id: 'gate_shut' };
    const out = coalesceCivilianEvents([evac(0), evac(2), removed(3, 2), trigger, evac(4)], 20, named);
    expect(out).toEqual([
      civ('evacuated', 2, 2, 0, 0),
      civ('taken', 1, 1, 0, 3),
      { event: trigger, line: 'trigger:gate_shut' },
      civ('evacuated', 1, 3, 2, 4),
    ]);
    // An event that writes no line (a `say`, a `wave`) closes nothing.
    const say: MissionEvent = { kind: 'say', tick: 3, speaker: 'commander', text: 'x' };
    expect(coalesceCivilianEvents([evac(0), say, evac(5)], 20, named)).toEqual([civ('evacuated', 2, 2, 0, 0)]);
  });

  it('lines come out in the order their windows opened, however they closed', () => {
    const feed = new CivilianFeed(20);
    feed.take(evac(0));
    feed.take(removed(5, 2));
    // The taken window closes first (its own next event, past its end), the clear one only at `due`.
    feed.take(removed(26, 2));
    expect(feed.due(26).map((l) => l.tally)).toEqual(['evacuated', 'taken']);
    expect(feed.flush()).toEqual([{ tally: 'taken', n: 1, total: 2, replaces: 1, tick: 26 }]);
    expect(feed.flush()).toEqual([]);
  });

  it('keeps nothing of an event that is not a civilian leaving', () => {
    const feed = new CivilianFeed(20);
    expect(feed.take(removed(0, 0))).toBe(false);
    expect(feed.take({ kind: 'trigger', tick: 0, id: 'x' })).toBe(false);
    expect(feed.flush()).toEqual([]);
  });

  it('words the total, in the tone and tier of the event it folds', () => {
    const clear: CivilianLine = { tally: 'evacuated', n: 3, total: 30, replaces: 27, tick: 0 };
    const taken: CivilianLine = { tally: 'taken', n: 12, total: 12, replaces: 0, tick: 0 };
    expect(civilianLineNotice(clear)).toEqual({ html: '<b>clear</b> (30)', tone: 'good' });
    expect(civilianLineNotice(taken)).toEqual({ html: '<b>taken</b> (12)', tone: 'bad', tier: 'important' });
    expect(civilianLineReplaces(clear)).toEqual({ html: '<b>clear</b> (27)', tone: 'good' });
    expect(civilianLineReplaces(taken)).toBeNull();
    // The tiers are `missionEventTier`'s for the kinds folded.
    expect(civilianLineNotice(taken).tier).toBe(missionEventTier(removed(0, 2)));
    expect(civilianLineNotice(clear).tier).toBe(missionEventTier(evac(0)) ?? undefined);
  });

  it('writes a streak as one line: the previous total is taken back before the new one goes up', () => {
    const calls: string[] = [];
    const sink = {
      note: (html: string, tone: string, o: { tier?: string }) => void calls.push(`note ${tone}|${o.tier ?? ''}|${html}`),
      retireNote: (html: string, tone: string, o: { tier?: string; fade?: boolean }) =>
        void calls.push(`retire ${tone}|${o.tier ?? ''}|${html}${o.fade === false ? ' now' : ''}`),
    };
    writeCivilianLines(sink, [
      { tally: 'taken', n: 2, total: 2, replaces: 0, tick: 0 },
      { tally: 'taken', n: 3, total: 5, replaces: 2, tick: 20 },
    ]);
    expect(calls).toEqual(['note bad|important|<b>taken</b> (2)', 'retire bad|important|<b>taken</b> (2) now', 'note bad|important|<b>taken</b> (5)']);
  });
});

describe('triggerLabel', () => {
  const mission = { triggers: [{ id: 'hunt', label: 'Enemy scouts hunt the drone' }, { label: 'Reserves commit' }, { id: 'silent' }] };
  it('reads the authored label by id', () => expect(triggerLabel(mission, 'hunt')).toBe('Enemy scouts hunt the drone'));
  it('reads the label of an id-less trigger through the runtime index fallback', () => expect(triggerLabel(mission, 'trigger_1')).toBe('Reserves commit'));
  it('is null for a trigger with no label, so nothing is shown', () => expect(triggerLabel(mission, 'silent')).toBeNull());
  it('is null for an unknown id', () => expect(triggerLabel(mission, 'nope')).toBeNull());
});

// Shell upgrade Phase 3, Task 10. `escapeHtml` moved to `escape-html.ts`,
// taking its five-entity pin with it; what stays here is the wording that
// uses it. `alertsForTick` hands back a key and params and never calls `t()`;
// this is where they become feed HTML, and the unit NAME in `alert.unitLost`
// is free text from `data/units/*.json`.
describe('alertNotice', () => {
  it('escapes the unit name it interpolates and keeps the catalogue markup', () => {
    const [html, tone] = alertNotice({ key: 'alert.unitLost', params: { name: '<i>Doobi</i>', n: 1 }, tone: 'bad' });
    expect(html).toBe('<b>lost</b> — &lt;i&gt;Doobi&lt;/i&gt;');
    expect(tone).toBe('bad');
  });

  // The plural branch substitutes `#` for the count -- in the TEMPLATE, before
  // `{name}` goes in, so the `#` of an escaped apostrophe (`&#39;`) is not
  // mistaken for one. A formatter that substituted afterwards would print
  // `&239;` here.
  it('passes the count through as a number, and an escaped apostrophe survives the plural', () => {
    const [html] = alertNotice({ key: 'alert.unitLost', params: { name: "Sahim's squad", n: 2 }, tone: 'bad' });
    expect(html).toBe('<b>lost</b> — Sahim&#39;s squad (2)');
  });
});

// WP-P5: where an alert happened, as one phrase.
describe('placePhrase', () => {
  it('words one place, two, or a crowd of them', () => {
    expect(placePhrase([])).toBe('');
    expect(placePhrase(['here'])).toBe('in view');
    expect(placePhrase(['ne', 'ne'])).toBe('north-east');
    expect(placePhrase(['nw', 'here'])).toBe('north-west and in view');
    expect(placePhrase(['n', 'e', 's'])).toBe('from several sides');
  });

  it('a line with no place drops its own separator rather than ending on one', () => {
    const line = { key: 'alert.arrived', params: { name: 'Lavi' }, tone: 'info' as const };
    expect(alertNotice({ ...line, place: [] })[0]).toBe('<b>reinforcement deployed</b> — Lavi');
    expect(alertNotice({ ...line, place: ['w'] })[0]).toBe('<b>reinforcement deployed</b> — Lavi · west');
  });
});

describe('reinforceTrigger', () => {
  const mission = {
    triggers: [
      { id: 'squad', label: 'Second squad arrives', do: { kind: 'reinforce', units: [{ marker: 'rp' }] } },
      { id: 'quiet', do: { kind: 'reinforce', units: [{ marker: 'rp' }] } },
      { label: 'Village rises', do: { kind: 'spawn' } },
      { label: 'Mortar arrives', do: { kind: 'reinforce', units: [{ marker: 'rp2' }] } },
    ],
  };
  it('finds a labelled reinforce by id or by index, and nothing else', () => {
    expect(reinforceTrigger(mission, 'squad')).toEqual({ label: 'Second squad arrives', units: [{ marker: 'rp' }] });
    expect(reinforceTrigger(mission, 'trigger_3')?.label).toBe('Mortar arrives');
    expect(reinforceTrigger(mission, 'quiet')).toBeNull();
    expect(reinforceTrigger(mission, 'trigger_2')).toBeNull();
  });
});

describe('unknownSandboxMapNotice (pass K)', () => {
  const known = { beit_sahwan_outskirts: {}, tel_marum: {} };
  it('is silent for a shipped map, and for no map at all', () => {
    expect(unknownSandboxMapNotice('tel_marum', known, 'Tel Marum')).toBeNull();
    expect(unknownSandboxMapNotice(null, known, 'Beit Sahwan')).toBeNull();
  });
  it('says the map is missing, names the map shown instead, and how to pick one -- never the raw id', () => {
    const notice = unknownSandboxMapNotice('tel_maram', known, 'Beit Sahwan outskirts');
    expect(notice).not.toBeNull();
    const [html, tone] = notice ?? ['', 'mute'];
    expect(tone).toBe('warn');
    expect(html).toMatch(/not in this build/);
    expect(html).not.toContain('tel_maram');
    expect(html).toContain('<b>Beit Sahwan outskirts</b>');
    expect(html).toMatch(/Free Play/);
  });
  it('treats an inherited Object member as unknown, not as a shipped map (#559 F5)', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(unknownSandboxMapNotice(id, known, 'Beit Sahwan outskirts'), id).not.toBeNull();
    }
  });
  it('escapes the shown map name', () => {
    const [html] = unknownSandboxMapNotice('nope', known, '<img>') ?? [''];
    expect(html).toContain('&lt;img&gt;');
  });
});

describe('ledgerSavedNotice (pass K)', () => {
  it('says "campaign saved" only when the write landed', () => {
    const [ok, okTone] = ledgerSavedNotice(true);
    expect(ok).toMatch(/campaign saved/);
    expect(okTone).toBe('info');
    const [no, noTone] = ledgerSavedNotice(false);
    expect(no).not.toMatch(/campaign saved/);
    expect(no).toMatch(/not saved/);
    expect(no).toMatch(/Allow this site to store data/);
    expect(noTone).toBe('bad');
  });
});
