import { describe, expect, it } from 'vitest';
import { firstUseHints, type FirstUseHintRule } from '@lions/data';
import en from '../i18n/en.json';
import { createShownTimer, HINTS_SEEN_KEY, loadHintsSeen, markHintSeen, owedRule, ruleHolds, type HintContext } from './hint-rules';

const ctx = (over: Partial<HintContext> = {}): HintContext => ({
  missionId: 'beit_sahwan_2_foothold',
  hasResources: false,
  selectedCount: 0,
  selectedTypes: () => new Set(),
  forceSize: () => 4,
  carrierEmptySeat: () => false,
  enemyPinned: () => false,
  ...over,
});
const rule = (id: string): FirstUseHintRule => {
  const r = firstUseHints.find((x) => x.id === id);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const store = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

describe('the shipped rules', () => {
  it('every rule names a catalogue key that exists', () => {
    const cat = en as Record<string, string>;
    for (const r of firstUseHints) expect(cat[r.key], r.id).toBeTypeOf('string');
  });
  it('every {param} in a text is supplied by the rule', () => {
    const cat = en as Record<string, string>;
    for (const r of firstUseHints) {
      const params = [...cat[r.key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(params.sort(), r.id).toEqual(Object.keys(r.keys ?? {}).sort());
    }
  });
  it('covers every lesson the nine-beat tutorial cut', () => {
    expect(firstUseHints.map((r) => r.id)).toEqual(
      expect.arrayContaining(['group_move', 'sniper', 'drones', 'mount_up', 'pins', 'armour_rear', 'logistics', 'intel', 'groups'])
    );
  });
});

describe('ruleHolds', () => {
  it('a selected sniper holds sniper, an empty selection does not', () => {
    expect(ruleHolds(rule('sniper'), ctx({ selectedTypes: () => new Set(['sniper_team']) }))).toBe(true);
    expect(ruleHolds(rule('sniper'), ctx())).toBe(false);
  });
  it('group_move needs Mission I and more than two selected', () => {
    const m1 = { missionId: 'beit_sahwan_1_recon', selectedCount: 3 };
    expect(ruleHolds(rule('group_move'), ctx(m1))).toBe(true);
    expect(ruleHolds(rule('group_move'), ctx({ ...m1, selectedCount: 2 }))).toBe(false);
    expect(ruleHolds(rule('group_move'), ctx({ ...m1, missionId: 'beit_sahwan_2_foothold' }))).toBe(false);
  });
  it('logistics and intel need a mission with an economy; groups needs a force over 8', () => {
    expect(ruleHolds(rule('logistics'), ctx())).toBe(false);
    expect(ruleHolds(rule('logistics'), ctx({ hasResources: true }))).toBe(true);
    expect(ruleHolds(rule('groups'), ctx({ forceSize: () => 8 }))).toBe(false);
    expect(ruleHolds(rule('groups'), ctx({ forceSize: () => 9 }))).toBe(true);
  });
  it('mount_up and pins read their own facts', () => {
    expect(ruleHolds(rule('mount_up'), ctx({ carrierEmptySeat: () => true }))).toBe(true);
    expect(ruleHolds(rule('pins'), ctx())).toBe(false);
    expect(ruleHolds(rule('pins'), ctx({ enemyPinned: () => true }))).toBe(true);
  });
  it('a costly fact is not asked for when a cheaper condition already failed', () => {
    let asked = 0;
    const c = ctx({ missionId: 'other', selectedCount: 5, selectedTypes: () => (asked++, new Set()) });
    ruleHolds({ id: 'x', key: 'hud.hint.first.x', mission: ['beit_sahwan_1_recon'], selected_type: ['sniper_team'] }, c);
    expect(asked).toBe(0);
  });
});

describe('owedRule: each hint fires once', () => {
  const rules = firstUseHints;
  const dockMission = ctx({ hasResources: true });
  it('offers logistics, then (once that is seen) intel, then nothing', () => {
    const seen = new Set<string>();
    expect(owedRule(rules, seen, dockMission)?.id).toBe('logistics');
    seen.add('logistics');
    expect(owedRule(rules, seen, dockMission)?.id).toBe('intel');
    seen.add('intel');
    expect(owedRule(rules, seen, dockMission)).toBeNull();
  });
  it('a seen rule never comes back, however often its condition holds', () => {
    const seen = new Set(['sniper']);
    const c = ctx({ selectedTypes: () => new Set(['sniper_team']) });
    for (let i = 0; i < 5; i++) expect(owedRule(rules, seen, c)).toBeNull();
  });
});

describe('memory', () => {
  it('round-trips through the store and defaults to nothing seen', () => {
    const s = store();
    expect([...loadHintsSeen(s)]).toEqual([]);
    markHintSeen(s, 'sniper');
    markHintSeen(s, 'intel');
    markHintSeen(s, 'sniper');
    expect([...loadHintsSeen(s)].sort()).toEqual(['intel', 'sniper']);
  });
  it('survives a missing store, rubbish and a blocked store', () => {
    expect(loadHintsSeen(null).size).toBe(0);
    const s = store();
    s.setItem(HINTS_SEEN_KEY, '{"a":1}');
    expect(loadHintsSeen(s).size).toBe(0);
    s.setItem(HINTS_SEEN_KEY, '["a",3,"b"]');
    expect([...loadHintsSeen(s)]).toEqual(['a', 'b']);
    const blocked = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
      removeItem: () => undefined,
    };
    expect(loadHintsSeen(blocked).size).toBe(0);
    expect(() => markHintSeen(blocked, 'a')).not.toThrow();
  });
});

describe('createShownTimer', () => {
  it('fires once after the window of continuous display, then goes quiet', () => {
    const t = createShownTimer(6000);
    expect(t.tick('dock', 0)).toBeNull();
    expect(t.tick('dock', 5999)).toBeNull();
    expect(t.tick('dock', 6000)).toBe('dock');
    expect(t.tick('dock', 7000)).toBeNull();
  });
  it('a flash shorter than the window teaches nothing and restarts the clock', () => {
    const t = createShownTimer(6000);
    t.tick('sniper', 0);
    t.tick(null, 3000);
    expect(t.tick('sniper', 4000)).toBeNull();
    expect(t.tick('sniper', 9999)).toBeNull();
    expect(t.tick('sniper', 10000)).toBe('sniper');
  });
  it('changing the line resets it', () => {
    const t = createShownTimer(6000);
    t.tick('a', 0);
    t.tick('b', 5000);
    expect(t.tick('b', 6000)).toBeNull();
  });
});
