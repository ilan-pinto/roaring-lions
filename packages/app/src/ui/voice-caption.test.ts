// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPTION_EXTRA_MS, VoiceCaption, captionHoldMs } from './voice-caption';

afterEach(() => {
  vi.useRealTimers();
});

describe('the voice caption (WP-AU1 D8)', () => {
  it('holds a line for its length plus one second', () => {
    expect(captionHoldMs(1.2)).toBe(1200 + CAPTION_EXTRA_MS);
    expect(captionHoldMs(0)).toBe(CAPTION_EXTRA_MS);
    expect(captionHoldMs(-1)).toBe(CAPTION_EXTRA_MS);
  });

  it('starts hidden, shows the meaning, then clears itself', () => {
    vi.useFakeTimers();
    const c = new VoiceCaption();
    expect(c.el.hidden).toBe(true);
    c.show('moving', 1.2);
    expect([c.el.hidden, c.el.textContent]).toEqual([false, 'moving']);
    vi.advanceTimersByTime(2199);
    expect(c.el.textContent).toBe('moving');
    vi.advanceTimersByTime(1);
    expect([c.el.hidden, c.el.textContent]).toEqual([true, '']);
  });

  it('is one slot: a new line replaces the last and restarts the hold', () => {
    vi.useFakeTimers();
    const c = new VoiceCaption();
    c.show('moving', 1);
    vi.advanceTimersByTime(1500);
    c.show('copy', 1);
    vi.advanceTimersByTime(1500);
    expect(c.el.textContent).toBe('copy');
    vi.advanceTimersByTime(500);
    expect(c.el.hidden).toBe(true);
  });

  it('is a polite live region with a translated label, and never takes the pointer', () => {
    const c = new VoiceCaption();
    expect(c.el.getAttribute('role')).toBe('status');
    expect(c.el.getAttribute('aria-live')).toBe('polite');
    expect(c.el.getAttribute('aria-label')).toBe('Unit radio');
    expect(c.el.classList.contains('rl-caption')).toBe(true);
  });

  it('dispose takes its pending timer with it', () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const c = new VoiceCaption();
    host.append(c.el);
    c.show('moving', 1);
    c.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(host.contains(c.el)).toBe(false);
  });
});
