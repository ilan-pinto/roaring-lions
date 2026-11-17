// GH-1417 S3 (D6): the report meta the app builds, against the schema the Worker is pinned to.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { buildReportMeta, fitReportLines, reportLine, REPORT_CONTEXT_MAX_BYTES, REPORT_LINES_MAX, type ReportInput } from './report';

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../data/schemas/feedback.schema.json', import.meta.url)), 'utf8'));
const validate = new Ajv2020({ allErrors: true }).compile(schema);
const problems = (m: unknown): string[] => (validate(m) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ''}`));

const SESSION = '0c0c0c0c-1111-4222-8333-444444444444';
const input = (o: Partial<ReportInput> = {}): ReportInput => ({
  seat: 0,
  reportedSeat: 1,
  reason: 'abuse',
  note: 'kept at it after I asked',
  lines: [
    { seat: 1, text: 'you are awful' },
    { seat: 0, text: 'please stop' },
    { seat: 1, text: 'no' },
  ],
  reportedPublicId: 'ABCDEFG1',
  session: SESSION,
  build: '0.122.0',
  commit: '293ef4b1',
  map: 'wadi_tarfan_l',
  now: 1_760_000_000_000,
  ...o,
});

describe('buildReportMeta', () => {
  it('builds a meta the schema accepts, with the evidence as `<seat>: <text>` lines', () => {
    const m = buildReportMeta(input())!;
    expect(problems(m)).toEqual([]);
    expect(m).toMatchObject({ v: 1, source: 'match', category: 'report', session: SESSION, map: 'wadi_tarfan_l' });
    expect(m.context.lines).toEqual(['1: you are awful', '0: please stop', '1: no']);
    expect(m.context).toMatchObject({ seat: 0, reported_seat: 1, reason: 'abuse', reported_public_id: 'ABCDEFG1' });
  });

  it('never carries a tester, a contact or a player id (the reporter is the session alone)', () => {
    const m = buildReportMeta(input()) as unknown as Record<string, unknown>;
    for (const k of ['tester', 'contact', 'player']) expect(k in m, k).toBe(false);
    // and the context is closed: nothing like a room code or a seat token can ride along
    expect(Object.keys(m.context as object).sort()).toEqual(['lines', 'reason', 'reported_public_id', 'reported_seat', 'seat']);
  });

  it('names no public id for a guest, and drops a malformed one', () => {
    for (const reportedPublicId of [null, undefined, 'guest-seat-token', 'abcdefg1', 'ABCDEFG']) {
      const m = buildReportMeta(input({ reportedPublicId }))!;
      expect('reported_public_id' in m.context, String(reportedPublicId)).toBe(false);
      expect(problems(m)).toEqual([]);
    }
  });

  it('sends no session under an opt-out (none was given), and still validates', () => {
    const m = buildReportMeta(input({ session: undefined }))!;
    expect('session' in m).toBe(false);
    expect(problems(m)).toEqual([]);
  });

  it('keeps the last ten lines only, oldest first', () => {
    const lines = Array.from({ length: 25 }, (_, i) => ({ seat: (i % 2) as 0 | 1, text: `n${i}` }));
    const m = buildReportMeta(input({ lines }))!;
    expect(m.context.lines).toHaveLength(REPORT_LINES_MAX);
    expect(m.context.lines[0]).toBe('1: n15');
    expect(m.context.lines[9]).toBe('0: n24');
    expect(problems(m)).toEqual([]);
  });

  it('flattens control characters and caps a line at 280 code points', () => {
    expect(reportLine({ seat: 1, text: 'a\nb\tc\u0000d' })).toBe('1: a b c d');
    const long = reportLine({ seat: 1, text: '\u{1F981}'.repeat(400) })!;
    expect([...long.slice(3)]).toHaveLength(280);
    expect(problems(buildReportMeta(input({ lines: [{ seat: 1, text: '\u{1F981}'.repeat(400) }] })))).toEqual([]);
  });

  it('refuses to build with nothing to report, or when the reporter reports themselves', () => {
    expect(buildReportMeta(input({ lines: [] }))).toBeNull();
    expect(buildReportMeta(input({ lines: [{ seat: 1, text: '   ' }, { seat: 1, text: '\n' }] }))).toBeNull();
    expect(buildReportMeta(input({ reportedSeat: 0 }))).toBeNull();
  });

  it('every reason validates, and an unknown one is not typed in', () => {
    for (const reason of ['abuse', 'hate', 'sexual', 'threat', 'spam', 'other'] as const) expect(problems(buildReportMeta(input({ reason }))), reason).toEqual([]);
    const bad = { ...buildReportMeta(input())!, context: { ...buildReportMeta(input())!.context, reason: 'rude' } };
    expect(problems(bad).length).toBeGreaterThan(0);
  });

  it('the note is optional and trimmed', () => {
    expect(buildReportMeta(input({ note: '   ' }))!.text).toBe('');
    expect(problems(buildReportMeta(input({ note: '' })))).toEqual([]);
  });
});

// Review item 2: a report always fits the Worker's 8 KB context cap, whatever script or emoji the lines are in.
const bytes = (s: string): number => new TextEncoder().encode(s).length;
describe('the byte budget', () => {
  it('is the Worker\'s own cap, pinned to its source', () => {
    expect(REPORT_CONTEXT_MAX_BYTES).toBe(8192);
    const worker = readFileSync(fileURLToPath(new URL('../../../worker/src/feedback-meta.ts', import.meta.url)), 'utf8');
    expect(worker).toMatch(/export const CONTEXT_MAX_BYTES = 8 \* 1024;/);
  });
  it('ten lines of 280 CJK characters (3 bytes each) fit after the OLDEST are dropped, and say how many', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ seat: (i % 2) as 0 | 1, text: `${i}`.repeat(1) + '漢'.repeat(279) }));
    const fit = fitReportLines(lines);
    expect(fit.dropped).toBeGreaterThan(0);
    expect(fit.lines.length + fit.dropped).toBe(10);
    // the kept lines are the NEWEST ones
    expect(fit.lines[fit.lines.length - 1]).toEqual(lines[9]);
    expect(fit.lines[0]).toEqual(lines[10 - fit.lines.length]);
    const m = buildReportMeta(input({ lines }))!;
    expect(bytes(JSON.stringify(m.context))).toBeLessThanOrEqual(8192);
    expect(m.context.lines).toHaveLength(fit.lines.length);
    expect(problems(m)).toEqual([]);
  });
  it('four-byte emoji lines fit the same way', () => {
    const lines = Array.from({ length: 10 }, () => ({ seat: 1 as const, text: '\u{1F981}'.repeat(280) }));
    const m = buildReportMeta(input({ lines }))!;
    expect(bytes(JSON.stringify(m.context))).toBeLessThanOrEqual(8192);
    expect(m.context.lines.length).toBeLessThan(10);
    expect(m.context.lines.length).toBeGreaterThan(0);
  });
  it('a worst-case line alone still fits, and an ordinary conversation loses nothing', () => {
    expect(fitReportLines([{ seat: 1, text: '\u{1F981}'.repeat(280) }]).dropped).toBe(0);
    const talk = Array.from({ length: 10 }, (_, i) => ({ seat: (i % 2) as 0 | 1, text: `line ${i} with some ordinary words in it` }));
    expect(fitReportLines(talk)).toEqual({ lines: talk, dropped: 0 });
  });
  it('is independent of the reason, so the dialog can say what is left out before a reason is picked', () => {
    const lines = Array.from({ length: 10 }, () => ({ seat: 1 as const, text: '漢'.repeat(280) }));
    const kept = fitReportLines(lines).lines.length;
    for (const reason of ['abuse', 'hate', 'sexual', 'threat', 'spam', 'other'] as const) {
      expect(buildReportMeta(input({ lines, reason }))!.context.lines, reason).toHaveLength(kept);
    }
  });
  it('measures the NEWEST lines it would keep, not the oldest: dropping old long lines lets the short new ones through', () => {
    const big = (i: number) => ({ seat: 1 as const, text: `${i}` + '\u{1F981}'.repeat(279) });
    const lines = [...Array.from({ length: 8 }, (_, i) => big(i)), { seat: 1 as const, text: 'new one' }, { seat: 1 as const, text: 'new two' }];
    const fit = fitReportLines(lines);
    expect(fit.dropped).toBe(1);
    expect(fit.lines).toEqual(lines.slice(1));
  });
  it('is measured for the longest reason, so a report with ANY reason fits even at the byte boundary', () => {
    const ctx = (ls: { seat: 0 | 1; text: string }[]): number =>
      bytes(JSON.stringify({ lines: ls.map((l) => `${l.seat}: ${l.text}`), seat: 0, reported_seat: 1, reason: 'sexual', reported_public_id: 'ZZZZZZZZ' }));
    // nine full CJK lines, and a first line tuned (3-byte steps, then 1-byte steps) to land the 'sexual' context on exactly cap + 1
    let found: { seat: 0 | 1; text: string }[] | null = null;
    for (let n = 0; n <= 280 && found === null; n++) {
      for (let m = 0; m < 3 && found === null; m++) {
        const first = { seat: 1 as const, text: '漢'.repeat(n) + 'a'.repeat(m) + 'b' };
        const ls = [first, ...Array.from({ length: 9 }, () => ({ seat: 1 as const, text: '漢'.repeat(280) }))];
        if (ctx(ls) === REPORT_CONTEXT_MAX_BYTES + 1) found = ls;
      }
    }
    expect(found, 'a boundary fixture exists').not.toBeNull();
    for (const reason of ['abuse', 'sexual', 'threat'] as const) {
      const m = buildReportMeta(input({ lines: found ?? [], reason }))!;
      expect(bytes(JSON.stringify(m.context)), reason).toBeLessThanOrEqual(REPORT_CONTEXT_MAX_BYTES);
    }
  });
});

