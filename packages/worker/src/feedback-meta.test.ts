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

  it('whitespace-only text is the twin\'s alone too', () => {
    expect(feedbackMetaProblem({ ...BASE, text: '   ' })).toBe('text');
  });

  it('references are FB- and four digits, growing rather than wrapping', () => {
    expect([feedbackRef(1), feedbackRef(42), feedbackRef(12345)]).toEqual(['FB-0001', 'FB-0042', 'FB-12345']);
  });
});
