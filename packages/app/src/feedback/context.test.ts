// A note's context (GH-464, spec §4.1): the exact field list, each field's own
// budget, and the 8 KB cap the Worker enforces too.
import { describe, expect, it } from 'vitest';
import { CONTEXT_KEYS, CONTEXT_MAX_BYTES, collectContext, utf8Bytes, type ContextInput } from './context';

const realistic = (): ContextInput => ({
  renderer: 'three',
  quality: 'high',
  gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)',
  viewport: [1920, 1080],
  dpr: 2,
  locale: 'en',
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  route: '/mission/beit_sahwan_2_foothold',
  paused: true,
  objectives: [
    { id: 'hold_west', status: 'active', primary: true },
    { id: 'no_civ', status: 'complete', primary: false },
  ],
  conduct: 100,
  floor: 70,
  force: { alive: 9, lost: 2, fielded: ['inf_squad', 'apc_eitan', 'ifv_namer'], selected: ['inf_squad'] },
  camera: { x: 14.123, y: 22.987, zoom: 1.4 },
  feed: Array.from({ length: 12 }, (_, i) => `under fire -- Eitan APC in view x${i}`),
  settings: { uiScale: 'auto', textSize: 1, motion: 'system', colorVision: 'default' },
  errors: Array.from({ length: 5 }, (_, i) => `TypeError: x is undefined at hud.ts:${i}`),
});

describe('collectContext', () => {
  it('carries exactly the §4.1 fields the Worker does not index as a column', () => {
    expect([...CONTEXT_KEYS]).toEqual([
      'renderer', 'quality', 'gpu', 'viewport', 'dpr', 'locale', 'ua', 'route', 'paused',
      'objectives', 'conduct', 'floor', 'force', 'camera', 'feed', 'settings', 'errors',
    ]);
    const c = collectContext(realistic());
    expect(Object.keys(c).sort()).toEqual([...CONTEXT_KEYS].sort());
  });

  it('measures about the spec\'s 1.7 KB on a realistic frame', () => {
    const bytes = utf8Bytes(JSON.stringify(collectContext(realistic())));
    expect(bytes).toBeGreaterThan(1000);
    expect(bytes).toBeLessThan(2500);
  });

  it('keeps the last 12 feed lines, the last 5 errors at 300 characters, and a 200-character agent', () => {
    const i = realistic();
    i.feed = Array.from({ length: 30 }, (_, n) => `line ${n}`);
    i.errors = Array.from({ length: 9 }, (_, n) => `${n}`.repeat(1000));
    i.ua = 'u'.repeat(900);
    const c = collectContext(i);
    expect(c.feed).toHaveLength(12);
    expect(c.feed?.[11]).toBe('line 29');
    expect(c.errors).toHaveLength(5);
    expect(c.errors.every((e) => e.length <= 300)).toBe(true);
    expect(c.errors[4].startsWith('8')).toBe(true);
    expect(c.ua.length).toBe(200);
  });

  it('never goes over 8 KB, however large the input', () => {
    const i = realistic();
    i.feed = Array.from({ length: 12 }, () => '\u{1F981}'.repeat(400));
    i.errors = Array.from({ length: 5 }, () => 'א'.repeat(400));
    i.objectives = Array.from({ length: 40 }, (_, n) => ({ id: `objective_${'x'.repeat(50)}_${n}`, status: 'active', primary: true }));
    i.force = { alive: 300, lost: 0, fielded: Array.from({ length: 40 }, (_, n) => `unit_${'y'.repeat(40)}_${n}`), selected: Array.from({ length: 40 }, (_, n) => `unit_${n}`) };
    const c = collectContext(i);
    expect(utf8Bytes(JSON.stringify(c))).toBeLessThanOrEqual(CONTEXT_MAX_BYTES);
    // What a bug report cannot do without survives the shedding.
    expect(c.route).toBe('/mission/beit_sahwan_2_foothold');
    expect(c.camera).toEqual({ x: 14.12, y: 22.99, zoom: 1.4 });
  });
});
