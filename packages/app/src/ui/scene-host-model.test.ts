// packages/app/src/ui/scene-host-model.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  CROSSFADE_MS, HOST_DEADLINE_MS, NARROW_COLUMN_SHARE, PARALLAX_TAU_MS,
  easeToward, hostPath, hostStep, parallaxTarget,
  type HostEvent, type HostInputs, type HostState, type HostStep,
} from './scene-host-model';

const base = (over: Partial<HostInputs> = {}): HostInputs => ({
  renderer: 'three',
  reducedMotion: false,
  saveData: false,
  viewportWidth: 1920,
  columnWidth: 625.6,
  webgl2: () => true,
  ...over,
});

describe('hostPath', () => {
  it('is live on three, with WebGL2 and room either side of the column', () => {
    expect(hostPath(base())).toEqual({ path: 'live' });
  });
  it('is off when the column takes more than 70% of the width -- nothing to show', () => {
    expect(hostPath(base({ viewportWidth: 390, columnWidth: 358.8 }))).toEqual({ path: 'off', reason: 'narrow' });
    expect(hostPath(base({ viewportWidth: 1000, columnWidth: 700 })).path).toBe('live'); // exactly 70% still has flanks
  });
  // The campaign board's rule: a Pixi player never creates even a throwaway
  // WebGL context on this screen, and never downloads three.
  it('Pixi gets the plate and never probes WebGL2', () => {
    const probe = vi.fn(() => true);
    expect(hostPath(base({ renderer: 'pixi', webgl2: probe }))).toEqual({ path: 'plate', reason: 'pixi' });
    expect(probe).not.toHaveBeenCalled();
  });
  it('reduced motion gets the plate and never probes WebGL2', () => {
    const probe = vi.fn(() => true);
    expect(hostPath(base({ reducedMotion: true, webgl2: probe }))).toEqual({ path: 'plate', reason: 'reduced-motion' });
    expect(probe).not.toHaveBeenCalled();
  });
  it('save-data gets the plate', () => {
    expect(hostPath(base({ saveData: true }))).toEqual({ path: 'plate', reason: 'save-data' });
  });
  it('no WebGL2 gets the plate', () => {
    expect(hostPath(base({ webgl2: () => false }))).toEqual({ path: 'plate', reason: 'no-webgl2' });
  });
  it('narrow wins over every other reason: there is no picture to choose', () => {
    expect(hostPath(base({ renderer: 'pixi', viewportWidth: 390, columnWidth: 358.8 })).path).toBe('off');
  });
  it('a zero-width viewport is narrow, never NaN', () => {
    expect(hostPath(base({ viewportWidth: 0 })).path).toBe('off');
  });
});

describe('hostStep -- spec §5, row by row', () => {
  it('pending + ready → live, reveal', () => {
    expect(hostStep('pending', { type: 'ready' })).toEqual({ state: 'live', effects: ['reveal'] });
  });
  it('pending + failed → plate, kept and named', () => {
    expect(hostStep('pending', { type: 'failed' })).toEqual({ state: 'plate', effects: ['keep-plate', 'warn'], reason: 'load-failed' });
  });
  it('pending + deadline → plate, and the load is aborted', () => {
    expect(hostStep('pending', { type: 'deadline' })).toEqual({ state: 'plate', effects: ['keep-plate', 'abort', 'warn'], reason: 'deadline' });
  });
  // The two leak rows: a view that arrives after nobody wants it must be
  // destroyed the moment it arrives, or it holds ~0.5 GB (spec M14).
  it('plate + a late ready → the view is disposed at once', () => {
    expect(hostStep('plate', { type: 'ready' })).toEqual({ state: 'plate', effects: ['dispose-view'] });
  });
  it('disposed + a late ready → the view is disposed at once', () => {
    expect(hostStep('disposed', { type: 'ready' })).toEqual({ state: 'disposed', effects: ['dispose-view'] });
  });
  it('live ignores a deadline', () => {
    expect(hostStep('live', { type: 'deadline' })).toEqual({ state: 'live', effects: [] });
  });
  it.each(['pending', 'live', 'plate', 'off'] as const)('%s + dispose → disposed, aborting and disposing', (s) => {
    expect(hostStep(s, { type: 'dispose' })).toEqual({ state: 'disposed', effects: ['abort', 'dispose-view'] });
  });
  it('disposed ignores everything but a late view', () => {
    expect(hostStep('disposed', { type: 'deadline' })).toEqual({ state: 'disposed', effects: [] });
    expect(hostStep('disposed', { type: 'failed' })).toEqual({ state: 'disposed', effects: [] });
    expect(hostStep('disposed', { type: 'dispose' })).toEqual({ state: 'disposed', effects: [] });
  });
  // An abort WE caused surfaces from the door as a rejection; after a
  // deadline it must not warn a second time.
  it('plate ignores a late failure', () => {
    expect(hostStep('plate', { type: 'failed' })).toEqual({ state: 'plate', effects: [] });
  });

  // Every cell, not only the ones a path reaches today. The leak rows exist to
  // make a stranded view IMPOSSIBLE rather than unlikely, so a `ready` outside
  // `pending` -- including `live` and `off`, which no path reaches -- disposes
  // the view it delivered.
  const TABLE: readonly [HostState, HostEvent['type'], HostStep][] = [
    ['pending', 'ready', { state: 'live', effects: ['reveal'] }],
    ['pending', 'failed', { state: 'plate', effects: ['keep-plate', 'warn'], reason: 'load-failed' }],
    ['pending', 'deadline', { state: 'plate', effects: ['keep-plate', 'abort', 'warn'], reason: 'deadline' }],
    ['pending', 'dispose', { state: 'disposed', effects: ['abort', 'dispose-view'] }],
    ['live', 'ready', { state: 'live', effects: ['dispose-view'] }],
    ['live', 'failed', { state: 'live', effects: [] }],
    ['live', 'deadline', { state: 'live', effects: [] }],
    ['live', 'dispose', { state: 'disposed', effects: ['abort', 'dispose-view'] }],
    ['plate', 'ready', { state: 'plate', effects: ['dispose-view'] }],
    ['plate', 'failed', { state: 'plate', effects: [] }],
    ['plate', 'deadline', { state: 'plate', effects: [] }],
    ['plate', 'dispose', { state: 'disposed', effects: ['abort', 'dispose-view'] }],
    ['off', 'ready', { state: 'off', effects: ['dispose-view'] }],
    ['off', 'failed', { state: 'off', effects: [] }],
    ['off', 'deadline', { state: 'off', effects: [] }],
    ['off', 'dispose', { state: 'disposed', effects: ['abort', 'dispose-view'] }],
    ['disposed', 'ready', { state: 'disposed', effects: ['dispose-view'] }],
    ['disposed', 'failed', { state: 'disposed', effects: [] }],
    ['disposed', 'deadline', { state: 'disposed', effects: [] }],
    ['disposed', 'dispose', { state: 'disposed', effects: [] }],
  ];
  it.each(TABLE)('every cell: %s + %s', (state, type, want) => {
    expect(hostStep(state, { type })).toEqual(want);
  });
  it('the table is the whole of it: 5 states x 4 events', () => {
    expect(new Set(TABLE.map(([s, e]) => `${s}+${e}`)).size).toBe(20);
  });
});

describe('parallaxTarget', () => {
  it('is centred when the pointer is', () => {
    const t = parallaxTarget(960, 540, 1920, 1080);
    expect(t.x).toBeCloseTo(0, 10);
    expect(t.y).toBeCloseTo(0, 10);
  });
  it('moves against the pointer: the scene is seen through the column like a window', () => {
    expect(parallaxTarget(1920, 540, 1920, 1080).x).toBeCloseTo(-1, 10);
    expect(parallaxTarget(0, 540, 1920, 1080).x).toBeCloseTo(1, 10);
    expect(parallaxTarget(960, 1080, 1920, 1080).y).toBeCloseTo(-1, 10);
  });
  it('clamps a pointer outside the viewport', () => {
    expect(parallaxTarget(5000, -300, 1920, 1080)).toEqual({ x: -1, y: 1 });
  });
  it('a zero-sized viewport reads centre, never NaN', () => {
    expect(parallaxTarget(10, 10, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('easeToward', () => {
  it('no time, no movement', () => {
    expect(easeToward(0, 1, 0, PARALLAX_TAU_MS)).toBe(0);
  });
  it('one time constant, in 100 ms steps, closes 1 - 1/e of the gap', () => {
    let v = 0;
    for (let i = 0; i < PARALLAX_TAU_MS / 100; i++) v = easeToward(v, 1, 100, PARALLAX_TAU_MS);
    expect(v).toBeCloseTo(1 - Math.exp(-1), 6);
  });
  // The same 100 ms clamp every other clock here uses: a tab that slept must
  // not jump the picture across the bleed in one frame.
  it('clamps a long frame to 100 ms', () => {
    expect(easeToward(0, 1, 5000, PARALLAX_TAU_MS)).toBeCloseTo(1 - Math.exp(-100 / PARALLAX_TAU_MS), 10);
  });
  it('never overshoots and treats negative time as none', () => {
    expect(easeToward(0.9, 1, 100, 1)).toBeLessThanOrEqual(1);
    expect(easeToward(0.5, 1, -50, PARALLAX_TAU_MS)).toBe(0.5);
  });
});

it('the constants are spec §10’s numbers', () => {
  expect(HOST_DEADLINE_MS).toBe(15000);
  expect(CROSSFADE_MS).toBe(400);
  expect(PARALLAX_TAU_MS).toBe(700);
  expect(NARROW_COLUMN_SHARE).toBe(0.7);
});
