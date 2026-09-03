import { describe, expect, it } from 'vitest';
import { removedNotice, sayNotice } from './mission-notice';

describe('sayNotice', () => {
  it('names Shai in full caps, with an em dash before the line', () => {
    const [html, tone] = sayNotice('shai', 'Hold what you have.');
    expect(html).toBe('<b>SHAI</b> — Hold what you have.');
    expect(tone).toBe('info');
  });

  it('names Idit the same way', () => {
    const [html] = sayNotice('idit', 'Contact on the west ridge.');
    expect(html).toBe('<b>IDIT</b> — Contact on the west ridge.');
  });

  it('names the net literally, off the raw event field -- no lookup', () => {
    const [html] = sayNotice('net', 'Reinforcements are twelve minutes out.');
    expect(html).toBe('<b>NET</b> — Reinforcements are twelve minutes out.');
  });

  it('gives the enemy no name at all, and reads as a warning', () => {
    const [html, tone] = sayNotice('enemy', 'We see you.');
    expect(html).toBe('<b>—</b> We see you.');
    expect(tone).toBe('warn');
  });
});

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
