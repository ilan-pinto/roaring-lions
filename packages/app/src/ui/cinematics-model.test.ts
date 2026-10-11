import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { videoManifest } from '@lions/data';
import { INTRO_VIDEO, backdropPlan, introDecision, isShippedVideo } from './cinematics-model';

const base = { shipped: true, seen: false, reducedMotion: false, saveData: false };

describe('introDecision: the first-launch rule', () => {
  it('plays on a first launch with the file shipped', () => {
    expect(introDecision(base)).toBe('play');
  });
  it('never plays again once seen', () => {
    expect(introDecision({ ...base, seen: true })).toBe('none');
    // Seen wins over the preferences too: nothing is re-marked.
    expect(introDecision({ ...base, seen: true, reducedMotion: true })).toBe('none');
    expect(introDecision({ ...base, seen: true, saveData: true })).toBe('none');
  });
  it('under reduced motion or save-data it is marked seen, unplayed', () => {
    expect(introDecision({ ...base, reducedMotion: true })).toBe('mark-seen');
    expect(introDecision({ ...base, saveData: true })).toBe('mark-seen');
    expect(introDecision({ ...base, reducedMotion: true, saveData: true })).toBe('mark-seen');
  });
  it('a file that is not shipped does nothing at all, and marks nothing', () => {
    // Not 'mark-seen' even under reduced motion: that would swallow the intro
    // for good on the day it ships.
    expect(introDecision({ ...base, shipped: false })).toBe('none');
    expect(introDecision({ ...base, shipped: false, reducedMotion: true })).toBe('none');
    expect(introDecision({ ...base, shipped: false, saveData: true })).toBe('none');
  });
});

describe('backdropPlan', () => {
  it('autoplays by default, shows a still under reduced motion, and fetches nothing under save-data', () => {
    expect(backdropPlan({ reducedMotion: false, saveData: false })).toBe('autoplay');
    expect(backdropPlan({ reducedMotion: true, saveData: false })).toBe('still');
    expect(backdropPlan({ reducedMotion: false, saveData: true })).toBe('none');
    expect(backdropPlan({ reducedMotion: true, saveData: true })).toBe('none');
  });
});

describe('isShippedVideo', () => {
  const m = { files: { 'video/a.mp4': {} } };
  it('is true for a listed path only', () => {
    expect(isShippedVideo(m, 'video/a.mp4')).toBe(true);
    expect(isShippedVideo(m, 'video/b.mp4')).toBe(false);
    expect(isShippedVideo(m, 'toString')).toBe(false);
    expect(isShippedVideo(m, '__proto__')).toBe(false);
  });
});

describe('the real manifest', () => {
  const root = join(__dirname, '..', '..', '..', '..');
  it('lists the intro exactly when the file is on disk (the data gate holds the same line)', () => {
    expect(isShippedVideo(videoManifest, INTRO_VIDEO)).toBe(existsSync(join(root, 'assets', INTRO_VIDEO)));
  });
  it('every listed video is on disk, so "listed" really means "shipped"', () => {
    for (const path of Object.keys(videoManifest.files)) expect(existsSync(join(root, 'assets', path)), path).toBe(true);
  });
});
