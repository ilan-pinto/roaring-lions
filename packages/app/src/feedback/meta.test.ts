// The `meta` part (GH-464), built to data/schemas/feedback.schema.json.
import { describe, expect, it } from 'vitest';
import { buildMeta, CONTACT_MAX, LINE_MAX, TEXT_MAX, type MetaInput } from './meta';
import type { FeedbackContext } from './context';

const context: FeedbackContext = { renderer: 'three', viewport: [1, 1], dpr: 1, locale: 'en', ua: '', route: '/', settings: { uiScale: 'auto', textSize: 1, motion: 'system', colorVision: 'default' }, errors: [] };
const PLAYER = '0b0b0b0b-1111-4222-8333-444444444444';
const SESSION = '0c0c0c0c-1111-4222-8333-444444444444';
const input = (o: Partial<MetaInput> = {}): MetaInput => ({
  source: 'pause',
  category: 'bug',
  text: 'It walked to the far wall.',
  ids: {},
  build: '0.122.0',
  context,
  now: 1_700_000_000_000,
  ...o,
});

describe('buildMeta', () => {
  it('builds the schema\'s required fields and nothing it was not given', () => {
    expect(buildMeta(input())).toEqual({ v: 1, t: 1_700_000_000_000, source: 'pause', category: 'bug', text: 'It walked to the far wall.', build: '0.122.0', context });
  });

  it('sends ids only when it has them, and only well-formed ones', () => {
    const m = buildMeta(input({ ids: { player: PLAYER, session: SESSION, tester: 'dana' }, mission: 'beit_sahwan_2_foothold', map: 'beit_sahwan_outskirts', tick: 540, commit: 'abcdef1' }));
    expect(m).toMatchObject({ player: PLAYER, session: SESSION, tester: 'dana', mission: 'beit_sahwan_2_foothold', map: 'beit_sahwan_outskirts', tick: 540, commit: 'abcdef1' });
    const bad = buildMeta(input({ ids: { player: 'nope', tester: 'two words' }, mission: 'Bad Id', commit: 'zzz' }));
    for (const k of ['player', 'tester', 'mission', 'commit']) expect([k, k in bad]).toEqual([k, false]);
  });

  it('caps the note at 2000 characters, a rating line at 280, a contact at 120', () => {
    expect([...buildMeta(input({ text: 'a'.repeat(5000) })).text]).toHaveLength(TEXT_MAX);
    const r = buildMeta(input({ source: 'debrief', category: 'rating', rating: 2, text: 'b'.repeat(900) }));
    expect([...r.text]).toHaveLength(LINE_MAX);
    expect(r.rating).toBe(2);
    expect([...(buildMeta(input({ contact: 'c'.repeat(500) })).contact ?? '')]).toHaveLength(CONTACT_MAX);
  });

  it('keeps a rating line to one line, and gives a rating no contact', () => {
    const r = buildMeta(input({ source: 'debrief', category: 'rating', rating: 4, text: 'good\nfun', contact: 'me@x' }));
    expect(r.text).toBe('good fun');
    expect('contact' in r).toBe(false);
  });
});
