import { describe, expect, it } from 'vitest';
import { alertNotice, evacuatedNotice, placePhrase, reinforceTrigger, removedNotice, ledgerSavedNotice, triggerLabel, unknownSandboxMapNotice } from './mission-notice';

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

  it('says one, never a running total', () => {
    // One line per arrival, like `removedNotice`: nothing here coalesces a
    // tick's worth of civilians, so the count is always (1).
    expect(evacuatedNotice()[0]).toContain('(1)');
    expect(evacuatedNotice()[0]).toBe(evacuatedNotice()[0]);
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
