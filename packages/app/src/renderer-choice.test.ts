// The escape hatch: `?renderer=pixi` must be a real, parsed value, and an
// explicit choice must survive a navigation that drops the query string
// (every `menu.ts` link does) or a reload with no `?renderer` at all.
//
// The bug this guards: `main.ts` used to test
// `params.get('renderer') === 'three'`, so `pixi`, a typo, and an absent
// param were all indistinguishable -- "fall through to Pixi". That worked
// by accident only because Pixi is the default; it never proved `pixi` was
// parsed at all, which is exactly the case that matters once the default
// flips.
import { describe, expect, it } from 'vitest';
import { resolveRendererChoice } from './renderer-choice';

describe('resolveRendererChoice', () => {
  it('parses an explicit ?renderer=pixi as a real choice, not a fallthrough', () => {
    // This is the case a naive `=== 'three'` check cannot distinguish from
    // an absent param -- both fall to the same branch. Asserting `persist`
    // here is what proves `pixi` was actually read, not merely defaulted to.
    expect(resolveRendererChoice('pixi', null)).toEqual({ choice: 'pixi', persist: 'pixi' });
  });

  it('parses an explicit ?renderer=three the same way', () => {
    expect(resolveRendererChoice('three', null)).toEqual({ choice: 'three', persist: 'three' });
  });

  it('defaults to pixi with no param and nothing stored', () => {
    expect(resolveRendererChoice(null, null)).toEqual({ choice: 'pixi', persist: null });
  });

  it('falls back to the stored choice when the param is absent -- this is the hatch surviving a menu.ts link', () => {
    // menu.ts hard-codes `?mission=${id}` and drops any query string a
    // player arrived with. This is what makes the choice survive that.
    expect(resolveRendererChoice(null, 'three')).toEqual({ choice: 'three', persist: null });
  });

  it('an explicit param overrides a different stored choice, and re-persists it', () => {
    expect(resolveRendererChoice('pixi', 'three')).toEqual({ choice: 'pixi', persist: 'pixi' });
  });

  it('treats a typo the same as absent, rather than crashing or silently picking three', () => {
    expect(resolveRendererChoice('threee', 'three')).toEqual({ choice: 'three', persist: null });
    expect(resolveRendererChoice('threee', null)).toEqual({ choice: 'pixi', persist: null });
  });

  it('ignores garbage in storage rather than trusting it as three', () => {
    expect(resolveRendererChoice(null, 'nope')).toEqual({ choice: 'pixi', persist: null });
  });
});
