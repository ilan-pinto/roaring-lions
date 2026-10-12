import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT } from '../feedback/draft';
import { TEXT_MAX } from '../feedback/meta';
import { desyncReportDraft, withoutReplay } from './desync-report';

const LINE = 'Desync in room TESTAB at 0:02 (tick 39, seat 1)';

// N1b task 11 (R-B13, R-B16): a desync's Report prefills the pause menu's
// feedback form through the existing draft, as a bug, with no replay -- the
// room has already written the evidence to D1 (`match_desync`).
describe('desyncReportDraft', () => {
  it('an empty draft becomes a bug report that names the room', () => {
    expect(desyncReportDraft(EMPTY_DRAFT, LINE)).toEqual({ kind: 'bug', text: LINE, contact: '' });
  });
  it('keeps the contact and anything the player had already written, below the line', () => {
    const d = desyncReportDraft({ kind: 'idea', text: 'More maps please', contact: 'dana@example.org' }, LINE);
    expect(d).toEqual({ kind: 'bug', text: `${LINE}\n\nMore maps please`, contact: 'dana@example.org' });
  });
  it('a second Report does not write the line twice', () => {
    const once = desyncReportDraft(EMPTY_DRAFT, LINE);
    expect(desyncReportDraft({ ...once, text: `${once.text}\nunits jumped` }, LINE).text).toBe(`${LINE}\nunits jumped`);
  });
  it('stays inside the form cap', () => {
    const d = desyncReportDraft({ kind: null, text: 'x'.repeat(TEXT_MAX), contact: '' }, LINE);
    expect([...d.text].length).toBe(TEXT_MAX);
    expect(d.text.startsWith(LINE)).toBe(true);
  });
});

describe('withoutReplay', () => {
  it('drops the replay and keeps the rest', () => {
    const fb = { build: '1', replay: { available: () => true } };
    expect(withoutReplay(fb)).toEqual({ build: '1' });
    expect(withoutReplay(fb)?.replay).toBeUndefined();
    expect(fb.replay).toBeDefined();
  });
  it('no feedback stays no feedback', () => {
    expect(withoutReplay(undefined)).toBeUndefined();
  });
});
