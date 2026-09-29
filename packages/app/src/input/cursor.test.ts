// Which cursor a resolution means.
//
// The rungs are ordered, and the order is the design: an armed support call
// outranks everything because that is what the pointer means; an empty
// selection outranks the ROE marks because a click that cannot fire must not
// warn about firing.
import { describe, expect, it } from 'vitest';
import { ANIMATED_CURSORS, SIGHT_OF, cursorFor, badgeFor, cursorKey, type CursorHints, type BadgeHints } from './cursor';
import { ORDER_SIGHT } from '../ui/order-sight';
import type { Resolution } from './intents';
import type { RoleBucket } from '../ui/role';

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

  it('is protected over a hall or a flagged zone', () => {
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

  it('names the armed call itself -- sweep or strike (Q3)', () => {
    // The approved sheet draws the two calls differently, and res.armed
    // already carries which one it is, so the cursor names it rather than
    // folding both into one 'support'.
    expect(cursorFor({ intents: [], roe: 'free', marker: false, armed: 'sweep' }, NONE)).toBe('sweep');
    expect(cursorFor({ intents: [], roe: 'free', marker: false, armed: 'strike' }, NONE)).toBe('strike');
  });

  it('keeps an armed call above protected and above the empty selection', () => {
    // Armed support fires with no selection at all -- pointerup always passes
    // ids: []. If this rung slipped below the empty-selection rung, the armed
    // cursor would never appear.
    expect(
      cursorFor({ intents: [], roe: 'protected', marker: false, armed: 'strike' }, NONE)
    ).toBe('strike');
  });

  it('is smoke while the smoke order is armed (Q2)', () => {
    const armedSmoke: CursorHints = { hostile: false, blocked: false, armedSmoke: true };
    expect(cursorFor(moving(), armedSmoke)).toBe('smoke');
    // ...over a hostile, over a costly or protected target, and with nothing selected:
    // the armed order is what the pointer means, the same argument as armed support.
    expect(cursorFor(moving({ roe: 'protected' }), { ...armedSmoke, hostile: true })).toBe('smoke');
    expect(cursorFor({ intents: [], roe: 'free', marker: false }, armedSmoke)).toBe('smoke');
  });

  it('puts an armed support call above armed smoke', () => {
    const armedSmoke: CursorHints = { hostile: false, blocked: false, armedSmoke: true };
    expect(cursorFor({ intents: [], roe: 'free', marker: false, armed: 'sweep' }, armedSmoke)).toBe('sweep');
    expect(cursorFor({ intents: [], roe: 'free', marker: false, armed: 'strike' }, armedSmoke)).toBe('strike');
  });

  it('is unchanged by armedSmoke: false or absent', () => {
    expect(cursorFor(moving(), { hostile: false, blocked: false, armedSmoke: false })).toBe('move');
    expect(cursorFor(moving(), NONE)).toBe('move');
  });
});

describe('ANIMATED_CURSORS follows the approved sheet', () => {
  it('animates the five wired sights at ORDER_SIGHT\'s own frame counts and rates, plus charge and demolish', () => {
    expect(Object.keys(ANIMATED_CURSORS).sort()).toEqual(
      ['attack', 'charge', 'demolish', 'move', 'smoke', 'strike', 'sweep']
    );
    for (const [name, id] of Object.entries(SIGHT_OF)) {
      const spec = ORDER_SIGHT[id];
      expect({ name, anim: ANIMATED_CURSORS[name as keyof typeof ANIMATED_CURSORS] }).toEqual({
        name,
        anim: { frames: spec.phases.length, intervalMs: Math.round(spec.periodMs / spec.phases.length) },
      });
    }
    expect(SIGHT_OF).toEqual({ move: 'move', attack: 'attackMove', sweep: 'sweep', strike: 'strike', smoke: 'smoke' });
    // The two housing animations keep their shipped rates (Q1).
    expect(ANIMATED_CURSORS.charge).toEqual({ frames: 4, intervalMs: 200 });
    expect(ANIMATED_CURSORS.demolish).toEqual({ frames: 4, intervalMs: 300 });
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

  it('puts charge above attack when a hostile stands on the identified tunnel', () => {
    // Not a synthetic pairing: resolvePointer's tunnel branch emits chargeTunnel
    // for whoever can charge plus an order for whoever cannot, and if an enemy
    // is on or near the route, hints.hostile is true at the same moment. A
    // yahalom_squad and a rifle squad selected, an identified tunnel under the
    // pointer, a hostile on it -- both rungs are live, and this pins which one
    // the cursor shows.
    const both = res([
      at('chargeTunnel', { tunnel: 1 }),
      at('order', { verb: 'attackMove' }),
    ]);
    expect(cursorFor(both, { hostile: true, blocked: false })).toBe('charge');
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

  it('but still says protected over a hall, whatever the verb', () => {
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
    expect(cursorFor(r, NONE)).toBe('sweep');
  });
});

describe('the badge says who is doing it', () => {
  const buckets = (map: Record<number, RoleBucket>): BadgeHints => ({
    bucketOf: (id) => map[id] ?? 'armour',
  });

  const res = (intents: Resolution['intents'], over: Partial<Resolution> = {}): Resolution => ({
    intents, roe: 'free', marker: true, ...over,
  });

  it('badges the winning group when it is one kind', () => {
    const r = res([{ kind: 'demolish', ids: [1, 2], structure: 3 }] as Resolution['intents']);
    const name = cursorFor(r, NONE);
    expect(badgeFor(r, NONE, buckets({ 1: 'soft', 2: 'soft' }), name)).toBe('soft');
  });

  it('says nothing when the winning group spans two kinds', () => {
    // A mixed mbt_lavi + apc_eitan pair both attack-move into a hostile:
    // armour and transport. A badge would have to pick one and would be
    // lying about the other.
    const r = res([{ kind: 'order', verb: 'attackMove', ids: [1, 2], x: 1, y: 1, append: false }]);
    const name = cursorFor(r, { hostile: true, blocked: false });
    expect(name).toBe('attack');
    expect(badgeFor(r, { hostile: true, blocked: false }, buckets({ 1: 'transport', 2: 'soft' }), name)).toBeNull();
  });

  it('says nothing when only the third id in the group differs', () => {
    // An inf_squad, a mortar_team and a sniper_team can all garrison the same
    // building -- soft, soft, sniper. The first two buckets agree; a
    // "compare only the first two ids" check would miss the third and badge
    // the whole trio "soft" while a sniper is standing among them.
    const r = res([{ kind: 'garrison', ids: [1, 2, 3], structure: 3 }] as Resolution['intents']);
    const name = cursorFor(r, NONE);
    expect(
      badgeFor(r, NONE, buckets({ 1: 'soft', 2: 'soft', 3: 'sniper' }), name)
    ).toBeNull();
  });

  it('badges the WINNING group, not the whole selection', () => {
    // The D9 demolishes and the infantry garrisons. demolish wins, so the
    // badge is the D9's -- the infantry's bucket must not leak into it.
    const r = res([
      { kind: 'demolish', ids: [1], structure: 3 },
      { kind: 'garrison', ids: [2], structure: 3 },
    ] as Resolution['intents']);
    const name = cursorFor(r, NONE);
    expect(name).toBe('demolish');
    expect(badgeFor(r, NONE, buckets({ 1: 'armour', 2: 'soft' }), name)).toBe('armour');
  });

  it('badges the winner even when it is not first in the array', () => {
    // resolvePointer's real order happens to put demolish before garrison,
    // so the previous case would still pass a `res.intents[0]` bug. Here the
    // array is garrison-then-demolish -- demolish still outranks garrison and
    // wins, but a naive "first intent" implementation would badge the
    // garrisoning infantry (soft) instead of the demolishing D9 (armour).
    const r = res([
      { kind: 'garrison', ids: [2], structure: 3 },
      { kind: 'demolish', ids: [1], structure: 3 },
    ] as Resolution['intents']);
    const name = cursorFor(r, NONE);
    expect(badgeFor(r, NONE, buckets({ 1: 'armour', 2: 'soft' }), name)).toBe('armour');
  });

  it('badges a plain move by the mover -- closing Critical 2', () => {
    // heli_peten (gunship), recon_drone (drone) and attack_drone (kamikaze)
    // have no click-triggerable ability: ordered over open ground, no ranked
    // verb wins, so cursorFor falls through to its own `hints.hostile ?
    // 'attack' : 'move'` default. The old badgeFor asked a second,
    // independent `winningVerb` for the verb, and winningVerb has no `move`
    // rung at all -- so a move cursor could never carry a badge, and the
    // spec's own example ("a heli_peten ordered to move shows a move cursor
    // wearing a gunship badge") was false. badgeFor now matches the name it
    // was given via intentVerb, which does know about `move`.
    const r = res([{ kind: 'order', verb: 'attackMove', ids: [1], x: 2, y: 2, append: false }]);
    const name = cursorFor(r, NONE);
    expect(name).toBe('move');
    expect(badgeFor(r, NONE, buckets({ 1: 'gunship' }), name)).toBe('gunship');
  });

  it('gives no badge when the resolved name is protected, even though a demolish intent survived -- closing Critical 1', () => {
    // The exact composition bug: a lone demolisher razing a hall produces
    // intents:[demolish] AND roe:'protected' (sortStructureOrder lets a pure-
    // demolisher selection through even without Alt), so cursorFor names it
    // 'protected' -- the roe rung fires before the verb rung. The old
    // badgeFor asked winningVerb a second time, found the demolish intent
    // regardless of what cursorFor had decided, and badged it anyway,
    // composing 'protected-armour': a key cursorRules never emits, so the
    // ROE X silently fell back to the OS arrow. badgeFor must badge the name
    // it was GIVEN, not one it re-derives.
    const r = res([{ kind: 'demolish', ids: [1], structure: 3 }] as Resolution['intents'], {
      roe: 'protected',
    });
    const name = cursorFor(r, NONE);
    expect(name).toBe('protected');
    expect(badgeFor(r, NONE, buckets({ 1: 'armour' }), name)).toBeNull();
  });

  it('gives no badge when there is no verb', () => {
    const empty = res([]);
    const name = cursorFor(empty, NONE);
    expect(badgeFor(empty, NONE, buckets({}), name)).toBeNull();
  });

  it('gives no badge for an armed support call', () => {
    const r = res([], { armed: 'strike' });
    const name = cursorFor(r, NONE);
    expect(name).toBe('strike');
    expect(badgeFor(r, NONE, buckets({ 1: 'soft' }), name)).toBeNull();
  });

  it('gives no badge to sweep, strike or smoke, even with a one-kind group underneath', () => {
    // sweep and strike are UNBADGED_NAMES (they name the mode, not the
    // actor); smoke is not, but no intent resolvePointer emits ever names
    // itself 'smoke', so the armed-smoke hover has nothing to badge.
    const group = res([{ kind: 'order', verb: 'attackMove', ids: [1], x: 2, y: 2, append: false }]);
    const smokeHints: CursorHints = { hostile: false, blocked: false, armedSmoke: true };
    const smoke = cursorFor(group, smokeHints);
    expect(smoke).toBe('smoke');
    expect(badgeFor(group, smokeHints, buckets({ 1: 'soft' }), smoke)).toBeNull();
    for (const name of ['sweep', 'strike'] as const) {
      expect(badgeFor(group, NONE, buckets({ 1: 'soft' }), name)).toBeNull();
      expect(cursorKey(name, 'soft')).toBe(name);
    }
  });

  it('gives no badge for an armed call even if a mismatched name is passed -- Minor 1', () => {
    // A defensive second gate: cursorFor never passes a name other than
    // res.armed itself ('sweep' or 'strike') when res.armed is set, so UNBADGED_NAMES alone would already
    // suppress the real call path. This proves the `res.armed` check inside
    // badgeFor still matters on its own account -- pass 'demolish', with a
    // real demolish intent underneath that would otherwise badge, and armed
    // must still win.
    const r = res([{ kind: 'demolish', ids: [1], structure: 3 }] as Resolution['intents'], {
      armed: 'strike',
    });
    expect(badgeFor(r, NONE, buckets({ 1: 'armour' }), 'demolish')).toBeNull();
  });
});

describe('cursorKey', () => {
  it('joins a name and a badge', () => {
    expect(cursorKey('demolish', 'armour')).toBe('demolish-armour');
  });

  it('is the bare name when there is no badge', () => {
    expect(cursorKey('blocked', null)).toBe('blocked');
  });

  it('suppresses a badge on an unbadged name even if a caller passes one', () => {
    // The same guard badgeFor applies (UNBADGED_NAMES), kept here too
    // because this is the last stop before a key reaches the DOM -- a
    // caller that (wrongly) hands cursorKey a badge alongside 'protected'
    // must not compose 'protected-soft', a key cursorRules never emits.
    expect(cursorKey('protected', 'soft')).toBe('protected');
    expect(cursorKey('sweep', 'armour')).toBe('sweep');
    expect(cursorKey('strike', 'armour')).toBe('strike');
  });
});

// GH-262 Task 6: the `pinned` cursor. It names what the click will NOT do --
// every unit the order would move is pinned, so nothing will go -- and it
// replaces only the plain order's own names (`move`, and `attack` over a
// hostile). Everything that outranks the order still outranks it.
describe('the pinned cursor', () => {
  const orderRes = (ids: number[]): Resolution => ({
    intents: [{ kind: 'order' as const, verb: 'move' as const, ids, x: 1, y: 1, append: false }],
    roe: 'free' as const,
    marker: true,
  });

  it('names pinned when the whole order is pinned, over open ground and over a hostile', () => {
    expect(cursorFor(orderRes([1]), { hostile: false, blocked: false, pinned: true })).toBe('pinned');
    expect(cursorFor(orderRes([1]), { hostile: true, blocked: false, pinned: true })).toBe('pinned');
  });

  it('keeps move when the hint is absent or false (some units will go)', () => {
    expect(cursorFor(orderRes([1]), { hostile: false, blocked: false })).toBe('move');
    expect(cursorFor(orderRes([1]), { hostile: false, blocked: false, pinned: false })).toBe('move');
  });

  it('never outranks armed support, protected or demolish', () => {
    expect(cursorFor({ ...orderRes([1]), armed: 'strike' }, { hostile: false, blocked: false, pinned: true })).toBe('strike');
    expect(cursorFor({ ...orderRes([1]), roe: 'protected' }, { hostile: false, blocked: false, pinned: true })).toBe('protected');
    const demolishing: Resolution = {
      ...orderRes([1]),
      intents: [{ kind: 'demolish', ids: [2], structure: 0 }, ...orderRes([1]).intents],
    };
    expect(cursorFor(demolishing, { hostile: false, blocked: false, pinned: true })).toBe('demolish');
  });

  it('leaves costly and blocked above it over open ground: they describe the target, not the order', () => {
    expect(cursorFor({ ...orderRes([1]), roe: 'costly' }, { hostile: false, blocked: false, pinned: true })).toBe('costly');
    expect(cursorFor(orderRes([1]), { hostile: false, blocked: true, pinned: true })).toBe('blocked');
  });

  it('needs an order intent: the hint alone on an empty selection is still default', () => {
    expect(cursorFor({ ...orderRes([]), intents: [] }, { hostile: false, blocked: false, pinned: true })).toBe('default');
  });

  it('is unbadged', () => {
    expect(cursorKey('pinned', 'armour')).toBe('pinned');
    const badges: BadgeHints = { bucketOf: () => 'armour' };
    const hints: CursorHints = { hostile: false, blocked: false, pinned: true };
    expect(badgeFor(orderRes([1]), hints, badges, 'pinned')).toBeNull();
  });

  it('does not animate', () => {
    expect(ANIMATED_CURSORS.pinned).toBeUndefined();
    expect(SIGHT_OF.pinned).toBeUndefined();
  });
});
