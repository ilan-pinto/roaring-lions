// @vitest-environment jsdom
/**
 * VR-03 follow-up: a health track's tone class must WIN over the track's own
 * lime fill. `.rl-track > i` (0,1,1) used to outrank a bare `.rl-fill-bad`
 * (0,1,0), so every health track was lime whatever `hpTone` said. Checked
 * against the real `theme.css` through jsdom's own cascade (which orders by
 * specificity); `var()` is not substituted there, so the declared token is
 * what comes back -- which is the thing being asked.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';

const fillOf = (cls: string | null): string => {
  const track = document.createElement('div');
  track.className = 'rl-track';
  const i = document.createElement('i');
  if (cls) i.className = cls;
  track.appendChild(i);
  document.body.appendChild(track);
  const s = getComputedStyle(i);
  return s.getPropertyValue('background') || s.getPropertyValue('background-color');
};

describe('health track tone (theme.css cascade)', () => {
  beforeAll(() => {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(__dirname, 'theme.css'), 'utf8');
    document.head.appendChild(style);
  });

  it('a plain track fill is the lime default', () => {
    expect(fillOf(null)).toContain('var(--live)');
  });

  it('a healthy track keeps the lime default', () => {
    expect(fillOf('rl-fill-good')).toContain('var(--live)');
  });

  it('the warn tone wins over the lime', () => {
    expect(fillOf('rl-fill-warn')).toContain('var(--warn)');
  });

  it('the bad tone wins over the lime', () => {
    expect(fillOf('rl-fill-bad')).toContain('var(--bad)');
  });
});
