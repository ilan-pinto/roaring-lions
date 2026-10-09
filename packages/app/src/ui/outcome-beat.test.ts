// packages/app/src/ui/outcome-beat.test.ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BEAT_CAMERA_MS,
  BEAT_SLOW,
  BEAT_ZOOM,
  beatCamera,
  beatFocus,
  beatPose,
  beatThenReport,
  hideForBeat,
} from './outcome-beat';
import { OUTCOME_HOLD_MS, outcomeMoment } from './outcome-moment';

// The oracles below are literals (PA-07, lead ruling 9 Oct): 0.25x time,
// +35% zoom, a 1.8 s camera ease. Imported constants are checked against
// them once, so a change to the ruling is a change to this file.
describe('the held beat (PA-07)', () => {
  it('carries the ruled numbers', () => {
    expect(BEAT_SLOW).toBe(0.25);
    expect(BEAT_ZOOM).toBe(0.35);
    expect(BEAT_CAMERA_MS).toBe(1800);
  });

  it('eases presentation time to 0.25x and the camera all the way in', () => {
    expect(beatPose(0, false)).toEqual({ timeScale: 1, camera: 0 });
    expect(beatPose(150, false).timeScale).toBeGreaterThan(0.25);
    expect(beatPose(150, false).timeScale).toBeLessThan(1);
    expect(beatPose(400, false).timeScale).toBeCloseTo(0.25, 9);
    expect(beatPose(900, false).camera).toBeGreaterThan(0);
    expect(beatPose(900, false).camera).toBeLessThan(1);
    expect(beatPose(1800, false).camera).toBe(1);
    expect(beatPose(2500, false)).toEqual({ timeScale: 0.25, camera: 1 });
  });

  it('reduced motion: no camera ease and no time slow, at any moment of the hold', () => {
    for (const ms of [0, 150, 400, 900, 1800, 2500]) expect(beatPose(ms, true)).toEqual({ timeScale: 1, camera: 0 });
  });

  it('moves the camera from where it was to the focus, and zooms 35%, clamped', () => {
    const from = { x: 10, y: 20, zoom: 1 };
    expect(beatCamera(from, { x: 30, y: 40 }, 0)).toEqual({ x: 10, y: 20, zoom: 1 });
    expect(beatCamera(from, { x: 30, y: 40 }, 1)).toEqual({ x: 30, y: 40, zoom: 1.35 });
    expect(beatCamera(from, { x: 30, y: 40 }, 0.5)).toEqual({ x: 20, y: 30, zoom: 1.175 });
    expect(beatCamera({ x: 0, y: 0, zoom: 2.2 }, { x: 0, y: 0 }, 1).zoom).toBe(2.5);
  });
});

describe('beatFocus: the deciding ground', () => {
  const zones = { compound: [18, 17, 13, 13] as [number, number, number, number], yard: [2, 2, 4, 4] as [number, number, number, number] };

  it('victory: the zone of a completed primary', () => {
    const f = beatFocus({
      result: 'victory',
      objectives: [
        { type: 'survive_until', primary: true, status: 'complete' },
        { type: 'evacuate_before', primary: true, status: 'complete', target: 'compound' },
      ],
      zones,
      civilians: [],
      force: [{ x: 1, y: 1 }],
    });
    expect(f).toEqual({ x: 24.5, y: 23.5 });
  });

  it('victory with no zone anywhere: the living force', () => {
    const f = beatFocus({ result: 'victory', objectives: [{ type: 'locate', primary: true, status: 'complete' }], zones, civilians: [], force: [{ x: 2, y: 4 }, { x: 4, y: 8 }] });
    expect(f).toEqual({ x: 3, y: 6 });
  });

  it('a lost evacuation: the family still outside the wire that came nearest', () => {
    const f = beatFocus({
      result: 'defeat',
      objectives: [{ type: 'evacuate_before', primary: true, status: 'failed', target: 'compound' }],
      zones,
      civilians: [{ x: 24, y: 24 }, { x: 5, y: 5 }, { x: 15, y: 18.5 }],
      force: [],
    });
    expect(f).toEqual({ x: 15, y: 18.5 });
  });

  it('a lost hold: the failed zone; nothing at all: no focus', () => {
    expect(beatFocus({ result: 'defeat', objectives: [{ type: 'hold_for', primary: true, status: 'failed', target: 'yard' }], zones, civilians: [], force: [] })).toEqual({ x: 4, y: 4 });
    expect(beatFocus({ result: 'defeat', objectives: [], zones, civilians: [], force: [] })).toBeNull();
  });
});

describe('beat -> report', () => {
  let host: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    delete document.documentElement.dataset.motion;
    delete document.body.dataset.outcomeBeat;
  });

  it('the report comes once, after the hold, and not before', async () => {
    const report = vi.fn();
    beatThenReport(outcomeMoment(host, { outcome: 'victory', title: 'x' }), () => false, report);
    vi.advanceTimersByTime(OUTCOME_HOLD_MS - 1);
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('Escape skips straight to the report, and so does a click', async () => {
    for (const skip of [
      () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      () => window.dispatchEvent(new Event('pointerdown')),
    ]) {
      const report = vi.fn();
      const m = outcomeMoment(host, { outcome: 'defeat', title: 'x' });
      beatThenReport(m, () => false, report);
      skip();
      await Promise.resolve();
      await Promise.resolve();
      expect(report).toHaveBeenCalledTimes(1);
      expect(m.el.isConnected).toBe(false);
    }
  });

  it('a battlefield torn down during the beat never mounts a report', async () => {
    const report = vi.fn();
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    let disposed = false;
    beatThenReport(m, () => disposed, report);
    disposed = true;
    m.dismiss();
    await Promise.resolve();
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();
  });

  it('reduced motion cuts straight to the band and keeps the full hold', async () => {
    document.documentElement.dataset.motion = 'reduce';
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    expect(m.el.dataset.beat).toBe('cut');
    const report = vi.fn();
    beatThenReport(m, () => false, report);
    vi.advanceTimersByTime(OUTCOME_HOLD_MS - 1);
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();
    m.dismiss();
  });

  it('full motion holds the beat', () => {
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    expect(m.el.dataset.beat).toBe('held');
    m.dismiss();
  });
});

describe('hideForBeat: the HUD steps back for the beat', () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete document.body.dataset.outcomeBeat;
  });

  it('hides every HUD sibling present now, never the stage or the moment, and undoes once', () => {
    const stage = Object.assign(document.createElement('div'), { id: 'stage' });
    const strip = Object.assign(document.createElement('div'), { className: 'rl-strip' });
    const moment = Object.assign(document.createElement('div'), { className: 'rl-outcome' });
    document.body.append(stage, strip, moment);
    const undo = hideForBeat(document.body, [stage, moment]);
    expect(strip.classList.contains('rl-beat-hidden')).toBe(true);
    expect(stage.classList.contains('rl-beat-hidden')).toBe(false);
    expect(moment.classList.contains('rl-beat-hidden')).toBe(false);
    expect(document.body.dataset.outcomeBeat).toBe('1');
    // The report mounts after the beat began: it is not the HUD.
    const report = Object.assign(document.createElement('div'), { className: 'rl-aar' });
    document.body.append(report);
    expect(report.classList.contains('rl-beat-hidden')).toBe(false);
    undo();
    undo();
    expect(strip.classList.contains('rl-beat-hidden')).toBe(false);
    expect(document.body.dataset.outcomeBeat).toBeUndefined();
  });
});
