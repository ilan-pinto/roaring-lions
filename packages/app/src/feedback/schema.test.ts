// The client against the server's own contract (GH-464, spec §12.2):
// every `meta` this app builds -- a pause Bug, a menu note, a debrief rating,
// opted out or not, from a realistic context and a pathological one -- must
// validate against `data/schemas/feedback.schema.json`, the file the Worker's
// `feedback-meta.ts` is pinned to. Copied onto this branch from
// `feat/feedback-worker` (PR #466) unchanged.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { collectContext, utf8Bytes, type ContextInput } from './context';
import { buildMeta, type MetaInput } from './meta';

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../data/schemas/feedback.schema.json', import.meta.url)), 'utf8'));
const validate = new Ajv2020({ allErrors: true }).compile(schema);
const ok = (m: unknown): string[] => (validate(m) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ''}`));

const PLAYER = '0b0b0b0b-1111-4222-8333-444444444444';
const SESSION = '0c0c0c0c-1111-4222-8333-444444444444';
const ctx = (huge = false): ContextInput => ({
  renderer: 'three',
  quality: 'high',
  gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)',
  viewport: [1920, 1080],
  dpr: 2,
  locale: 'en',
  ua: 'Mozilla/5.0',
  route: '/mission/beit_sahwan_2_foothold',
  paused: true,
  objectives: [{ id: 'hold_west', status: 'active', primary: true }],
  conduct: 100,
  floor: 70,
  force: { alive: 9, lost: 2, fielded: ['inf_squad'], selected: [] },
  camera: { x: 4, y: 23, zoom: 1 },
  feed: Array.from({ length: 12 }, () => (huge ? '\u{1F981}'.repeat(500) : 'under fire')),
  settings: { uiScale: 'auto', textSize: 1, motion: 'system', colorVision: 'default' },
  errors: Array.from({ length: 5 }, () => (huge ? 'e'.repeat(999) : 'TypeError: x')),
});
const meta = (o: Partial<MetaInput>, huge = false) =>
  buildMeta({
    source: 'pause',
    category: 'bug',
    text: 'It walked to the far wall.',
    ids: { player: PLAYER, session: SESSION, tester: 'dana' },
    build: '0.122.0',
    commit: '293ef4b1',
    mission: 'beit_sahwan_2_foothold',
    map: 'beit_sahwan_outskirts',
    tick: 540,
    context: collectContext(ctx(huge)),
    now: 1_760_000_000_000,
    ...o,
  });

describe('meta against data/schemas/feedback.schema.json', () => {
  it('accepts a pause Bug, a menu note and a debrief rating', () => {
    expect(ok(meta({}))).toEqual([]);
    for (const category of ['balance', 'confusing', 'idea', 'praise'] as const) expect(ok(meta({ category }))).toEqual([]);
    expect(ok(meta({ source: 'menu', category: 'idea', mission: undefined, map: undefined, tick: undefined, contact: 'dana@example.com' }))).toEqual([]);
    expect(ok(meta({ source: 'debrief', category: 'rating', rating: 2, text: '' }))).toEqual([]);
    expect(ok(meta({ source: 'debrief', category: 'rating', rating: 5, text: 'Lost everyone\nin the open' }))).toEqual([]);
  });

  it('accepts an opt-out note with no ids, and a pathological context under 8 KB', () => {
    expect(ok(meta({ ids: {} }))).toEqual([]);
    const m = meta({}, true);
    expect(ok(m)).toEqual([]);
    expect(utf8Bytes(JSON.stringify(m.context))).toBeLessThanOrEqual(8192);
  });

  it('is a validator that can say no (control)', () => {
    expect(ok({ ...meta({}), dev: false }).length).toBeGreaterThan(0);
    expect(ok({ ...meta({}), extra: 1 }).length).toBeGreaterThan(0);
    expect(ok({ ...meta({ source: 'debrief', category: 'rating', rating: 3 }), rating: undefined }).length).toBeGreaterThan(0);
  });
});
