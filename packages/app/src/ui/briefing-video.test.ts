// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { briefingVideo } from './briefing-video';

let plays = 0;
let playResult: () => Promise<void>;
beforeEach(() => {
  plays = 0;
  playResult = () => Promise.resolve();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => {
    plays += 1;
    return playResult();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('briefingVideo: once, then hold the last frame', () => {
  it('autoplays once and never loops', () => {
    const v = briefingVideo('/video/x.mp4', { plan: 'autoplay' });
    expect(v?.autoplay).toBe(true);
    expect(v?.loop).toBe(false);
    expect(v?.hasAttribute('loop')).toBe(false);
    expect(plays).toBe(1);
  });

  it('on ended it stays on screen at its last frame: not removed, not rewound, not replayed', () => {
    const v = briefingVideo('/video/x.mp4', { plan: 'autoplay' });
    if (!v) throw new Error('no video');
    document.body.append(v);
    v.currentTime = 7.9;
    v.dispatchEvent(new Event('ended'));
    expect(v.isConnected).toBe(true);
    expect(v.currentTime).toBe(7.9);
    expect(v.loop).toBe(false);
    expect(plays).toBe(1);
    expect(v.getAttribute('src')).toBe('/video/x.mp4');
  });

  it('falls back to muted playback when sound is refused', async () => {
    let n = 0;
    playResult = () => (n++ === 0 ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve());
    const v = briefingVideo('/video/x.mp4', { plan: 'autoplay' });
    await Promise.resolve();
    await Promise.resolve();
    expect(v?.muted).toBe(true);
    expect(plays).toBe(2);
  });

  it('reduced motion: an element at its first frame, no autoplay, no play call, the player can press play', () => {
    const v = briefingVideo('/video/x.mp4', { plan: 'still' });
    expect(v?.autoplay).toBe(false);
    expect(v?.controls).toBe(true);
    expect(v?.loop).toBe(false);
    expect(v?.preload).toBe('metadata');
    expect(v?.getAttribute('src')).toBe('/video/x.mp4#t=0.001');
    expect(plays).toBe(0);
  });

  it('save-data: nothing is built, so nothing is fetched', () => {
    expect(briefingVideo('/video/x.mp4', { plan: 'none' })).toBeNull();
    expect(plays).toBe(0);
  });

  it('a video that fails to load removes itself and tells the screen, which then looks as it did without one', () => {
    const onError = vi.fn();
    const v = briefingVideo('/video/x.mp4', { plan: 'autoplay', onError });
    if (!v) throw new Error('no video');
    document.body.append(v);
    v.dispatchEvent(new Event('error'));
    expect(v.isConnected).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
