// Which cursor a resolution means.
//
// The rungs are ordered, and the order is the design: an armed support call
// outranks everything because that is what the pointer means; an empty
// selection outranks the ROE marks because a click that cannot fire must not
// warn about firing.
import { describe, expect, it } from 'vitest';
import { cursorFor, type CursorHints } from './cursor';
import type { Resolution } from './intents';

const NONE: CursorHints = { hostile: false, blocked: false };

/** A resolution that would order a plain attack-move. */
function moving(over: Partial<Resolution> = {}): Resolution {
  return {
    intents: [{ kind: 'order', verb: 'attackMove', ids: [1], x: 2.5, y: 3.5, append: false }],
    roe: 'free',
    marker: true,
    ...over,
  };
}

describe('cursorFor', () => {
  it('is move over open ground with something selected', () => {
    expect(cursorFor(moving(), NONE)).toBe('move');
  });

  it('is attack when a hostile is under the pointer', () => {
    expect(cursorFor(moving(), { hostile: true, blocked: false })).toBe('attack');
  });

  it('is blocked over impassable ground, even with a hostile hint', () => {
    // Rock is impassable and can hide a unit behind it; the ground is still
    // the thing you cannot stand on.
    expect(cursorFor(moving(), { hostile: true, blocked: true })).toBe('blocked');
  });

  it('is costly over a structure that scores against you', () => {
    expect(cursorFor(moving({ roe: 'costly' }), NONE)).toBe('costly');
  });

  it('is protected over a mosque or a flagged zone', () => {
    expect(cursorFor(moving({ roe: 'protected' }), NONE)).toBe('protected');
  });

  it('puts protected above costly, blocked and attack', () => {
    expect(cursorFor(moving({ roe: 'protected' }), { hostile: true, blocked: true })).toBe(
      'protected'
    );
  });

  it('puts costly above blocked', () => {
    expect(cursorFor(moving({ roe: 'costly' }), { hostile: false, blocked: true })).toBe(
      'costly'
    );
  });

  it('puts costly above attack', () => {
    expect(cursorFor(moving({ roe: 'costly' }), { hostile: true, blocked: false })).toBe(
      'costly'
    );
  });

  it('is default when nothing is selected', () => {
    expect(cursorFor({ intents: [], roe: 'free', marker: false }, NONE)).toBe('default');
  });

  it('stays default over a protected target when nothing is selected', () => {
    // A click that cannot issue an order must not warn about one. This is the
    // true "nothing selected" shape resolvePointer returns from its
    // ids.length === 0 branch: refused is absent (not merely false), which is
    // what tells it apart from the gated-and-refused case below -- the two
    // shapes both have empty intents, and only `refused` distinguishes them.
    expect(
      cursorFor({ intents: [], roe: 'protected', marker: false, refused: undefined }, NONE)
    ).toBe('default');
  });

  it('shows protected when a selection is refused over a protected structure with no Alt', () => {
    // The gated case: the whole selection was suppressed by the protected-
    // structure check and the player has not held Alt. `intents` is empty
    // here too -- same as "nothing selected" -- but `refused` is set, and
    // that must win over the empty-intents rung or the warning never shows
    // on the one click it exists to warn about.
    expect(
      cursorFor(
        {
          intents: [],
          roe: 'protected',
          marker: false,
          refused: true,
          note: { text: 'protected site — hold Alt to order fire on it', tone: 'mute' },
        },
        NONE
      )
    ).toBe('protected');
  });

  it('shows protected when a selection is allowed over a protected structure with Alt held', () => {
    // Alt lifts the gate: resolvePointer no longer sets refused and the
    // attack-move intent survives, so this rung is not reached -- it falls
    // through to the roe === 'protected' rung below instead. Still 'protected'.
    expect(cursorFor(moving({ roe: 'protected' }), NONE)).toBe('protected');
  });

  it('is support whenever a call is armed', () => {
    expect(cursorFor({ intents: [], roe: 'free', marker: false, armed: 'sweep' }, NONE)).toBe(
      'support'
    );
  });

  it('keeps support above protected and above the empty selection', () => {
    // Armed support fires with no selection at all -- pointerup always passes
    // ids: []. If this rung slipped below the empty-selection rung, the armed
    // cursor would never appear.
    expect(
      cursorFor({ intents: [], roe: 'protected', marker: false, armed: 'strike' }, NONE)
    ).toBe('support');
  });
});
