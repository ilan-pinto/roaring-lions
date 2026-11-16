import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, it, expect } from 'vitest';
import { feedbackMetaProblem, feedbackRef } from './feedback-meta';

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../../../data/schemas/feedback.schema.json', import.meta.url)), 'utf8')) as object;
const validate = new Ajv2020({ allErrors: true }).compile(schema);

const BASE = {
  v: 1,
  t: 1_790_000_000_000,
  source: 'pause',
  category: 'bug',
  text: 'It walked to the far wall.',
  build: '0.122.0',
  context: {},
};
const RATING = { ...BASE, source: 'debrief', category: 'rating', rating: 4, text: '' };

// GH-1417 S3: a report from a match. Its evidence is the reporter's own copy, in `context`, in one closed shape.
const SESSION = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const REPORT = {
  ...BASE,
  source: 'match',
  category: 'report',
  text: '',
  session: SESSION,
  context: { lines: ['1: you are rubbish', '0: gg', '1: report me then'], seat: 0, reported_seat: 1, reason: 'abuse' },
};

const VALID: Record<string, unknown>[] = [
  BASE,
  { ...BASE, commit: '41bc520b', player: '0f8fad5b-d9cb-469f-a165-70867728950e', session: '7c9e6679-7425-40de-944b-e07fc1f90ae7', tester: 'dana', mission: 'beit_sahwan_2_foothold', map: 'beit_sahwan_outskirts', tick: 467, dev: true },
  { ...BASE, source: 'menu', category: 'idea', contact: 'dana on Discord' },
  { ...BASE, category: 'praise', text: 'line one\nline two\ttabbed' },
  { ...BASE, text: 'x'.repeat(2000) },
  { ...BASE, text: '😀'.repeat(2000) },
  RATING,
  { ...RATING, rating: 1, text: 'too hard' },
  { ...RATING, text: 'x'.repeat(280) },
  { ...BASE, context: { renderer: 'three', viewport: [1920, 1080], feed: ['a', 'b'] } },
  REPORT,
  { ...REPORT, text: 'He kept at it all match.', map: 'wadi_tarfan', mission: undefined },
  { ...REPORT, context: { ...REPORT.context, reported_public_id: 'K7M4Q2XW', reason: 'hate' } },
  { ...REPORT, context: { ...REPORT.context, lines: ['0: x'.padEnd(283, 'y')] } },
  { ...REPORT, context: { ...REPORT.context, lines: Array.from({ length: 10 }, (_, i) => `${i % 2}: line ${i}`) } },
  { ...REPORT, session: undefined },
];

const INVALID: [string, unknown][] = [
  ['not an object', 'bug'],
  ['wrong version', { ...BASE, v: 2 }],
  ['unknown field', { ...BASE, email: 'x@y.z' }],
  ['unknown source', { ...BASE, source: 'hud' }],
  ['unknown category', { ...BASE, category: 'rant' }],
  ['empty text on a form', { ...BASE, text: '' }],
  ['text over 2000', { ...BASE, text: 'x'.repeat(2001) }],
  ['text with a control character', { ...BASE, text: 'a\u0000b' }],
  ['rating on a form', { ...BASE, rating: 3 }],
  ['rating from the pause form', { ...RATING, source: 'pause' }],
  ['a form kind from the debrief', { ...BASE, source: 'debrief' }],
  ['rating missing', { ...RATING, rating: undefined }],
  ['rating out of range', { ...RATING, rating: 6 }],
  ['rating line over 280', { ...RATING, text: 'x'.repeat(281) }],
  ['rating line with a newline', { ...RATING, text: 'a\nb' }],
  ['contact over 120', { ...BASE, contact: 'x'.repeat(121) }],
  ['empty contact', { ...BASE, contact: '' }],
  ['bad build', { ...BASE, build: 'dev' }],
  ['bad commit', { ...BASE, commit: 'HEAD' }],
  ['bad player', { ...BASE, player: 'me' }],
  ['tester with a space', { ...BASE, tester: 'dana k' }],
  ['bad mission', { ...BASE, mission: 'Beit Sahwan' }],
  ['float tick', { ...BASE, tick: 1.5 }],
  ['dev false', { ...BASE, dev: false }],
  ['context is an array', { ...BASE, context: [] }],
  ['context missing', { ...BASE, context: undefined }],
  ['a note on the debrief source with a report category', { ...REPORT, source: 'debrief' }],
  ['a report from the pause form', { ...REPORT, source: 'pause' }],
  ['the match source with a form category', { ...BASE, source: 'match' }],
  ['a rating from the match source', { ...RATING, source: 'match' }],
  ['a report with a tester label', { ...REPORT, tester: 'dana' }],
  ['a report with a contact', { ...REPORT, contact: 'dana on Discord' }],
  ['a report with the persistent player id', { ...REPORT, player: '0f8fad5b-d9cb-469f-a165-70867728950e' }],
  ['a report with a rating', { ...REPORT, rating: 3 }],
  ['a report with no lines', { ...REPORT, context: { ...REPORT.context, lines: [] } }],
  ['a report with eleven lines', { ...REPORT, context: { ...REPORT.context, lines: Array.from({ length: 11 }, () => '0: x') } }],
  ['a line with no seat prefix', { ...REPORT, context: { ...REPORT.context, lines: ['you are rubbish'] } }],
  ['a line from seat 2', { ...REPORT, context: { ...REPORT.context, lines: ['2: x'] } }],
  ['a line over 280 characters', { ...REPORT, context: { ...REPORT.context, lines: [`1: ${'x'.repeat(281)}`] } }],
  ['a line with a control character', { ...REPORT, context: { ...REPORT.context, lines: ['1: a\u0007b'] } }],
  ['a line with only the prefix', { ...REPORT, context: { ...REPORT.context, lines: ['1: '] } }],
  ['a lines entry that is not a string', { ...REPORT, context: { ...REPORT.context, lines: [{ seat: 1, text: 'x' }] } }],
  ['a report with seat 2', { ...REPORT, context: { ...REPORT.context, seat: 2 } }],
  ['an unknown reason', { ...REPORT, context: { ...REPORT.context, reason: 'rude' } }],
  ['a missing reason', { ...REPORT, context: { lines: ['1: x'], seat: 0, reported_seat: 1 } }],
  ['a room code in the context', { ...REPORT, context: { ...REPORT.context, room_code: 'ABC234' } }],
  ['a seat token in the context', { ...REPORT, context: { ...REPORT.context, token: 'abc' } }],
  ['a free-form context key a form would carry', { ...REPORT, context: { ...REPORT.context, renderer: 'three' } }],
  ['a persistent anonymous id as the reported id', { ...REPORT, context: { ...REPORT.context, reported_public_id: '0f8fad5b-d9cb-469f-a165-70867728950e' } }],
  ['a lowercase public id', { ...REPORT, context: { ...REPORT.context, reported_public_id: 'k7m4q2xw' } }],
  ['a public id with a letter Crockford leaves out', { ...REPORT, context: { ...REPORT.context, reported_public_id: 'K7M4Q2XI' } }],
  ['a report note over 2000', { ...REPORT, text: 'x'.repeat(2001) }],
  ['a report note with a control character', { ...REPORT, text: 'a\u0000b' }],
  ['a report with an empty context', { ...REPORT, context: {} }],
];

const strip = (x: unknown): unknown => JSON.parse(JSON.stringify(x)) as unknown; // drops undefined, as the wire does

describe('feedback meta: the hand-written twin agrees with data/schemas/feedback.schema.json', () => {
  it.each(VALID.map((v, i) => [i, v]))('valid #%i passes both', (_i, v) => {
    expect(validate(strip(v)), JSON.stringify(validate.errors)).toBe(true);
    expect(feedbackMetaProblem(strip(v))).toBeNull();
  });

  it.each(INVALID)('%s fails both', (_name, v) => {
    expect(validate(strip(v))).toBe(false);
    expect(feedbackMetaProblem(strip(v))).not.toBeNull();
  });

  it('the 8 KB context cap is the twin\'s alone (a schema cannot measure serialised size)', () => {
    const big = { ...BASE, context: { feed: ['x'.repeat(8200)] } };
    expect(validate(big)).toBe(true);
    expect(feedbackMetaProblem(big)).toBe('context over 8 KB');
  });

  it('a report\'s optional note: empty passes both, and the form kinds still refuse an empty one', () => {
    expect(validate(REPORT)).toBe(true);
    expect(feedbackMetaProblem(REPORT)).toBeNull();
    expect(feedbackMetaProblem({ ...BASE, text: '' })).toBe('text');
  });

  it('the twin names the first bad part of a report, for the 400 body', () => {
    const ctx = REPORT.context;
    expect(feedbackMetaProblem({ ...REPORT, tester: 'dana' })).toBe('tester');
    expect(feedbackMetaProblem({ ...REPORT, player: '0f8fad5b-d9cb-469f-a165-70867728950e' })).toBe('player');
    expect(feedbackMetaProblem({ ...REPORT, contact: 'x' })).toBe('contact');
    expect(feedbackMetaProblem({ ...REPORT, context: { ...ctx, room_code: 'ABC234' } })).toBe('context key');
    expect(feedbackMetaProblem({ ...REPORT, context: { ...ctx, lines: [] } })).toBe('context.lines');
    expect(feedbackMetaProblem({ ...REPORT, context: { ...ctx, reason: 'rude' } })).toBe('context.reason');
    expect(feedbackMetaProblem({ ...REPORT, context: { ...ctx, reported_seat: 0 } })).toBe('context.reported_seat');
    expect(feedbackMetaProblem({ ...REPORT, context: { ...ctx, reported_public_id: 'nope' } })).toBe('context.reported_public_id');
  });

  it('a report of oneself is the twin\'s alone (a schema cannot compare two fields)', () => {
    const self = { ...REPORT, context: { ...REPORT.context, reported_seat: 0 } };
    expect(validate(self)).toBe(true);
    expect(feedbackMetaProblem(self)).toBe('context.reported_seat');
  });

  it('whitespace-only text is the twin\'s alone too', () => {
    expect(feedbackMetaProblem({ ...BASE, text: '   ' })).toBe('text');
  });

  it('references are FB- and four digits, growing rather than wrapping', () => {
    expect([feedbackRef(1), feedbackRef(42), feedbackRef(12345)]).toEqual(['FB-0001', 'FB-0042', 'FB-12345']);
  });
});
