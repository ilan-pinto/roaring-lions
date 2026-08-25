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

  it('is attack over impassable ground with a hostile hint, now that the verb outranks blocked', () => {
    // Slice 3 moved THE VERB rung above roe costly and, with it, blocked:
    // winningVerb folds a hostile plain order in as 'attack' (ordering
    // decision 2), and that check now runs before hints.blocked is ever
    // consulted. This is a deliberate, ruled-on change, not a regression
    // this test failed to notice: attack is a verb in the destructiveness
    // ranking like the other six, and a hostile under the pointer now
    // outranks the collateral tier (costly/blocked) the same way demolish
    // does -- "here is what you would hit" beats "here is what it costs or
    // blocks." Before this task blocked won here.
    expect(cursorFor(moving(), { hostile: true, blocked: true })).toBe('attack');
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

  it('puts attack above costly, now that the verb outranks costly', () => {
    // Same reorder as the blocked case above: THE VERB rung sits above roe
    // costly, and winningVerb resolves a hostile plain order to 'attack'
    // before roe === 'costly' is ever reached. Deliberate: a hostile under
    // the pointer now outranks the collateral tier, so the cursor names
    // what the click does (attack) over what it merely costs (costly).
    expect(cursorFor(moving({ roe: 'costly' }), { hostile: true, blocked: false })).toBe(
      'attack'
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

describe('the cursor names the verb', () => {
  const at = (kind: string, extra: Record<string, unknown> = {}) =>
    ({ kind, ids: [1], ...extra }) as unknown as Resolution['intents'][number];

  const res = (intents: Resolution['intents'], over: Partial<Resolution> = {}): Resolution => ({
    intents, roe: 'free', marker: true, ...over,
  });

  it('says demolish, charge, garrison, mount, dismount and smoke', () => {
    expect(cursorFor(res([at('demolish', { structure: 3 })]), NONE)).toBe('demolish');
    expect(cursorFor(res([at('chargeTunnel', { tunnel: 1 })]), NONE)).toBe('charge');
    expect(cursorFor(res([at('garrison', { structure: 3 })]), NONE)).toBe('garrison');
    expect(cursorFor(res([at('mount', { carrier: 2, riders: [1] })]), NONE)).toBe('mount');
    expect(cursorFor(res([at('dismount', { carriers: [1] })]), NONE)).toBe('dismount');
    expect(cursorFor(res([at('smoke', { x: 1, y: 1 })]), NONE)).toBe('smoke');
  });

  it('ranks a mixed click by what it destroys, heaviest first', () => {
    // sortStructureOrder can emit all three at once. One cursor, so it names
    // the worst thing the click will cause.
    const all = res([
      at('demolish', { structure: 3 }),
      at('garrison', { structure: 3 }),
      at('order', { verb: 'attackMove', x: 1, y: 1, append: false }),
    ]);
    expect(cursorFor(all, NONE)).toBe('demolish');
  });

  it('puts charge above garrison when a tunnel click splits', () => {
    const both = res([at('chargeTunnel', { tunnel: 1 }), at('garrison', { structure: 3 })]);
    expect(cursorFor(both, NONE)).toBe('charge');
  });

  it('puts attack above garrison, since firing outranks entering', () => {
    const both = res([at('garrison', { structure: 3 }), at('order', { verb: 'attackMove' })]);
    expect(cursorFor(both, { hostile: true, blocked: false })).toBe('attack');
  });

  it('is the verb over a costly building, not the warning', () => {
    // A house is a blocked tile with a non-zero roe_penalty, so without the
    // verb outranking costly a D9 over a house would read "costly" -- true,
    // milder, and useless next to "you are about to level this".
    const r = res([at('demolish', { structure: 3 })], { roe: 'costly' });
    expect(cursorFor(r, { hostile: false, blocked: true })).toBe('demolish');
  });

  it('but still says protected over a mosque, whatever the verb', () => {
    const r = res([at('demolish', { structure: 3 })], { roe: 'protected' });
    expect(cursorFor(r, NONE)).toBe('protected');
  });

  it('falls back to costly when no special verb applies', () => {
    const r = res([at('order', { verb: 'attackMove' })], { roe: 'costly' });
    expect(cursorFor(r, NONE)).toBe('costly');
  });

  it('keeps armed above refused — the gap slice 2 left open', () => {
    // Unreachable through resolvePointer today, because armed early-returns
    // before the structure branch can set refused. That is an implementation
    // invariant, not a type one: change the resolver and the order starts
    // mattering with nothing to catch it.
    const r = res([], { armed: 'sweep', refused: true });
    expect(cursorFor(r, NONE)).toBe('support');
  });
});
