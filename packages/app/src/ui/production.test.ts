// @vitest-environment jsdom
//
// The reinforcements dock, in the DOM (GH-153 slice 3).
//
// `dock-model.test.ts` proves the rules; this file proves the JOIN — the part
// a pure function cannot see. Four joins specifically:
//
//   - a tile's five visual states are driven by data attributes the stylesheet
//     reads, so a state computed correctly and written to the wrong attribute
//     is invisible to the model test and obvious here;
//   - the tiles are built ONCE and repainted, so a listener must survive the
//     4 Hz refresh (the failure mode is a build button that only fires if you
//     click it fast enough);
//   - a click reaches the runtime and NOTHING else — invariant 4;
//   - the tooltip is assembled from the tile it belongs to.

import { describe, expect, it, vi } from 'vitest';
import { units } from '@lions/data';
import {
  FIRE_SUPPORT_KINDS,
  MissionRuntime,
  Sim,
  type Command,
  type MissionJson,
  type UnitTypeJson,
} from '@lions/sim';
import { ReinforcementDock, type ProductionOptions, type ProductionRuntime, type SupportKind } from './production';
import type { DockUnit } from './dock-model';
import type { Tone } from './hud';
import { closeTip } from './tooltip';

type QueueItem = ProductionRuntime['production'][number];

interface FakeRuntime extends ProductionRuntime {
  logistics: number;
  intel: number;
  production: QueueItem[];
  blocked: Record<string, string>;
  /** The unit ids of every `build` command the dock dispatched (N2 D3). */
  builds: string[];
  /** Every command the dock dispatched, whole. */
  sent: Command[];
  /** What `canBuild` answers: the click-time pre-check. */
  buildOk: boolean;
  /** Gone from the slice the dock reads (N2 D3). Throws, so a dock that still
   *  calls it fails loudly instead of spending at click time. */
  requestBuild(unitId: string): boolean;
  /** Unit ids the cap refuses, and the readout; null is an uncapped mission. */
  capped: Set<string>;
  pop: { used: number; cap: number } | null;
}

function fakeRuntime(over: Partial<FakeRuntime> = {}): FakeRuntime {
  const rt: FakeRuntime = {
    logistics: 1000,
    intel: 100,
    supportCost: (k) => ({ smoke_screen: 10, mortar_barrage: 20, drone_sweep: 30, air_strike: 60 })[k],
    production: [],
    blocked: {},
    builds: [],
    sent: [],
    buildOk: true,
    capped: new Set<string>(),
    pop: null,
    buildBlockedReason: (id) =>
      rt.blocked[id] ?? (rt.capped.has(id) && rt.pop !== null ? `population cap reached (${rt.pop.used}/${rt.pop.cap})` : null),
    popCapped: (id) => rt.blocked[id] === undefined && rt.capped.has(id),
    populationView: () => rt.pop,
    canBuild: () => rt.buildOk,
    requestBuild: (id) => {
      throw new Error(`the dock called requestBuild(${id}); it must dispatch a build command instead`);
    },
    ...over,
  };
  return rt;
}

/** The order sink a fake runtime's dock dispatches to: records each command. */
function sinkOf(rt: FakeRuntime): (cmd: Command) => void {
  return (cmd) => {
    rt.sent.push(cmd);
    if (cmd.kind === 'build') rt.builds.push(cmd.unit);
  };
}

function dockUnit(over: Partial<DockUnit> = {}): DockUnit {
  return {
    id: 'inf_squad',
    name: 'Rifle Squad',
    logistics: 292,
    buildTimeS: 15,
    bucket: 'soft',
    sprite: '/sprites/INF_SQUAD/idle_f03_000.png',
    tags: ['soft', 'garrisons', 'spots'],
    ...over,
  };
}

interface Rig {
  dock: ReinforcementDock;
  host: HTMLElement;
  rt: FakeRuntime;
  notes: { html: string; tone?: Tone }[];
  arms: (SupportKind | null)[];
  tile: (id: string) => HTMLButtonElement;
  support: (kind: SupportKind) => HTMLButtonElement;
  tip: () => HTMLElement;
  tiles: () => HTMLButtonElement[];
}

function rig(
  unitList: DockUnit[] = [dockUnit()],
  rt = fakeRuntime(),
  meshPending?: (unitId: string) => boolean,
  extra: Partial<ProductionOptions> = {}
): Rig {
  document.body.replaceChildren();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const notes: { html: string; tone?: Tone }[] = [];
  const arms: (SupportKind | null)[] = [];
  const dock = new ReinforcementDock(host, {
    units: unitList,
    runtime: rt,
    note: (html, tone) => notes.push({ html, tone }),
    onArm: (kind) => arms.push(kind),
    dispatch: sinkOf(rt),
    meshPending,
    ...extra,
  });
  const q = <T extends HTMLElement>(sel: string): T => {
    const el = host.querySelector<T>(sel);
    if (el === null) throw new Error(`no ${sel}`);
    return el;
  };
  return {
    dock,
    host,
    rt,
    notes,
    arms,
    tile: (id) => q<HTMLButtonElement>(`[data-unit="${id}"]`),
    support: (kind) => q<HTMLButtonElement>(`[data-support="${kind}"]`),
    tip: () => q('.rl-tip'),
    tiles: () => [...host.querySelectorAll<HTMLButtonElement>('.rl-tile')],
  };
}

const hover = (el: HTMLElement): void => {
  el.dispatchEvent(new Event('mouseenter'));
};
const unhover = (el: HTMLElement): void => {
  el.dispatchEvent(new Event('mouseleave'));
};

// ----------------------------------------------------------------------
// Shape
// ----------------------------------------------------------------------

describe('the dock’s shape', () => {
  it('draws one tile per buildable plus the four support calls', () => {
    const r = rig([dockUnit(), dockUnit({ id: 'mbt_lavi', name: 'Lavi MBT' })]);
    expect(r.tiles()).toHaveLength(6);
    expect(r.support('drone_sweep').textContent).toContain('sweep 30');
    expect(r.support('air_strike').textContent).toContain('strike 60');
  });

  it('four support tiles, in the sim’s order, each showing its own price', () => {
    const r = rig();
    const tiles = [...r.host.querySelectorAll<HTMLElement>('[data-support]')];
    expect(tiles.map((el) => el.dataset.support)).toEqual([...FIRE_SUPPORT_KINDS]);
    const price = { smoke_screen: 10, mortar_barrage: 20, drone_sweep: 30, air_strike: 60 };
    const word = { smoke_screen: 'screen', mortar_barrage: 'barrage', drone_sweep: 'sweep', air_strike: 'strike' };
    for (const k of FIRE_SUPPORT_KINDS) {
      expect(r.support(k).querySelector('.rl-tile__word')?.textContent).toBe(`${word[k]} ${price[k]}`);
    }
  });

  it('names the key its label promises', () => {
    const r = rig();
    expect(r.host.querySelector('.rl-dock__label')?.textContent).toBe('Reinforcements · B');
  });

  // GH-229 bug 2: nowhere in a mission told the player their brigade credit
  // balance, so a locked tile's "N cr" price (`dock.lock.price`) and its full
  // "buy for N credits" note (`gate.buy`) named a price against a balance the
  // player could not see. Fix round 1 put it in the label at `--t-xs`; round
  // 2 gives it its own chip, `.rl-dock__credits`, sized like the strip's own
  // counters and carrying the WORD ("credits"), not folded into the label's
  // own text -- read separately in the DOM here for exactly that reason.
  it('shows the brigade credit balance as its own chip, with the word, when the caller supplies one', () => {
    document.body.replaceChildren();
    const host = document.createElement('div');
    document.body.appendChild(host);
    new ReinforcementDock(host, {
      units: [dockUnit()],
      runtime: fakeRuntime(),
      note: () => undefined,
      onArm: () => undefined,
      dispatch: () => undefined,
      credits: 1240,
    });
    // The label itself is untouched by the credits chip riding beside it.
    expect(host.querySelector('.rl-dock__label')?.textContent).toBe('Reinforcements · B');
    const creditsEl = host.querySelector('.rl-dock__credits');
    expect(creditsEl?.textContent).toBe('1240 credits');
    expect(creditsEl?.querySelector('b')?.textContent).toBe('1240');
    // Reachable by keyboard, the same as a dock tile -- `.rl-dock` itself
    // switches every non-control descendant's pointer events off.
    expect(creditsEl?.getAttribute('tabindex')).toBe('0');
  });

  // Falsified by hand: dropping the `opts.credits !== undefined` guard (always
  // appending the chip) turns this red -- a chip reading "undefined credits"
  // appears where none was expected.
  it('shows no credits chip when no balance is supplied, and leaves the label plain', () => {
    const r = rig();
    expect(r.host.querySelector('.rl-dock__credits')).toBeNull();
    expect(r.host.querySelector('.rl-dock__label')?.textContent).toBe('Reinforcements · B');
  });

  it('explains the credit chip on hover, through the same shared tooltip the tiles use', () => {
    document.body.replaceChildren();
    const host = document.createElement('div');
    document.body.appendChild(host);
    new ReinforcementDock(host, {
      units: [dockUnit()],
      runtime: fakeRuntime(),
      note: () => undefined,
      onArm: () => undefined,
      dispatch: () => undefined,
      credits: 5,
    });
    const chip = host.querySelector<HTMLElement>('.rl-dock__credits')!;
    chip.dispatchEvent(new Event('mouseenter'));
    const tip = host.querySelector('.rl-tip');
    expect(tip?.textContent).toContain('Brigade credits');
    expect(tip?.textContent).toContain('Brigade garage');
    chip.dispatchEvent(new Event('mouseleave'));
  });

  // Fix round 2: a bare "520" on a tile read as credits once the header
  // started showing a balance beside it. S3e: the prefix is the G1 sheet's
  // drawn logistics mark -- the same `symbolSvg('logistics')` the top
  // strip's own Logistics field draws -- and the number stays plain text.
  it('prices a tile with the logistics mark and the number, not a character', () => {
    const r = rig([dockUnit({ logistics: 292 })]);
    const cost = r.tile('inf_squad').querySelector('.rl-tile__cost');
    expect(cost?.querySelector('[data-symbol="logistics"]')).not.toBeNull();
    expect(cost?.textContent?.trim()).toBe('292');
  });

  it('draws the sweep and strike tiles with the order marks', () => {
    const r = rig();
    expect(r.support('drone_sweep').querySelector('.rl-tile__glyph [data-symbol="sweep"]')).not.toBeNull();
    expect(r.support('air_strike').querySelector('.rl-tile__glyph [data-symbol="strike"]')).not.toBeNull();
    expect(r.support('drone_sweep').textContent).not.toContain('◎');
    expect(r.support('air_strike').textContent).not.toContain('✸');
    // Fix round 1: cropped to the surround, not the cursor's full 24-box.
    for (const k of ['drone_sweep', 'air_strike'] as const) {
      expect(r.support(k).querySelector('svg')?.getAttribute('viewBox')).not.toBe('0 0 24 24');
    }
  });

  // S-F Task 2: the barrage and the smoke screen draw marks of their own --
  // they borrowed the strike's ring and the smoke order's puffs until the
  // support-marks mock. A tile falling back to either borrowed mark is red.
  it('draws the barrage and smoke-screen tiles with their own marks, not the strike\'s or the smoke order\'s', () => {
    const r = rig();
    expect(r.support('mortar_barrage').querySelector('.rl-tile__glyph [data-symbol="barrage"]')).not.toBeNull();
    expect(r.support('smoke_screen').querySelector('.rl-tile__glyph [data-symbol="smokeScreen"]')).not.toBeNull();
    const symbols = (['smoke_screen', 'mortar_barrage', 'drone_sweep', 'air_strike'] as const).map((k) =>
      r.support(k).querySelector('.rl-tile__glyph [data-symbol]')?.getAttribute('data-symbol')
    );
    expect(new Set(symbols).size).toBe(4);
    expect(symbols).not.toContain('smoke');
  });

  // The list the tile progress replaces. Its absence is the acceptance
  // criterion, so it is asserted rather than assumed.
  it('has no rl-queue list left in it', () => {
    const r = rig();
    expect(r.host.querySelector('.rl-queue')).toBe(null);
  });

  it('draws a sprite as an image and a missing sheet as the reserved hatch', () => {
    const r = rig([dockUnit(), dockUnit({ id: 'ghost', name: 'Ghost', sprite: null })]);
    expect(r.tile('inf_squad').querySelector('.rl-tile__art')?.tagName).toBe('IMG');
    const gap = r.tile('ghost').querySelector<HTMLElement>('.rl-tile__art');
    expect(gap?.tagName).toBe('DIV');
    expect(gap?.dataset.nosprite).toBe('1');
    // Never an empty box: the role mark says what the unit IS.
    expect(gap?.querySelector('svg')).not.toBe(null);
  });

  it('marks a cropped icon data-icon="1", and leaves an ordinary sheet frame unmarked', () => {
    const r = rig([
      dockUnit({ id: 'inf_squad', spriteIsIcon: true }),
      dockUnit({ id: 'mbt_lavi', name: 'Lavi MBT', sprite: '/sprites/TNK_HULL/f03_000.png' }),
    ]);
    expect(r.tile('inf_squad').querySelector<HTMLElement>('.rl-tile__art')?.dataset.icon).toBe('1');
    expect(r.tile('mbt_lavi').querySelector<HTMLElement>('.rl-tile__art')?.dataset.icon).toBeUndefined();
  });
});

// ----------------------------------------------------------------------
// The five states
// ----------------------------------------------------------------------

describe('tile states', () => {
  it('is plain when it is affordable, unlocked and not building', () => {
    const t = rig().tile('inf_squad');
    expect(t.dataset.locked).toBe('0');
    expect(t.dataset.poor).toBe('0');
    expect(t.dataset.queued).toBe('0');
  });

  it('marks a tile the player cannot pay for', () => {
    const r = rig([dockUnit()], fakeRuntime({ logistics: 100 }));
    expect(r.tile('inf_squad').dataset.poor).toBe('1');
  });

  it('shows the queue on the tile: a countdown, a bar and a count', () => {
    const rt = fakeRuntime({
      production: [{ unit: 'inf_squad', ticksLeft: 114, doneTicks: 186, totalTicks: 300 }],
    });
    const r = rig([dockUnit()], rt);
    const t = r.tile('inf_squad');
    expect(t.dataset.queued).toBe('1');
    expect(t.querySelector('.rl-tile__left')?.textContent).toBe('6s');
    // CSSOM normalises the trailing zero the source writes.
    expect(t.querySelector<HTMLElement>('.rl-tile__bar')?.style.width).toBe('62%');
    expect(t.title).toContain('1 building, next in 6s');
  });

  // The tile's only text is the cost badge, so the accessible name would
  // otherwise be the bare number "292".
  it('announces itself as a sentence, not as a price', () => {
    const r = rig();
    expect(r.tile('inf_squad').getAttribute('aria-label')).toBe(
      'Rifle Squad — 292 logistics'
    );
  });

  // The fake runtime still answers `buildBlockedReason` with the sim's raw
  // wording -- proving the dock recomputes the sentence from the unit's own
  // `unlock` (via `gateSentence`) rather than merely being able to.
  it('shortens the lock to what fits, and puts the human sentence -- never the sim’s raw wording -- on the title', () => {
    const rt = fakeRuntime({
      blocked: { inf_squad: 'requires campaign Conduct 55 (no missions rated yet)' },
    });
    const r = rig([dockUnit({ unlock: { roeMin: 55 } })], rt);
    const t = r.tile('inf_squad');
    expect(t.dataset.locked).toBe('1');
    expect(t.querySelector('.rl-tile__lock')?.textContent).toBe('Conduct ≥55');
    expect(t.title).toContain('Needs a campaign Conduct of 55 or better');
    expect(t.title).not.toContain('requires campaign Conduct');
  });

  it('shortens a stars lock to a star count, and puts the human sentence on the title', () => {
    const rt = fakeRuntime({
      blocked: { inf_squad: 'requires 12 stars (currently 4)' },
    });
    const r = rig([dockUnit({ unlock: { starsMin: 12 } })], rt);
    const t = r.tile('inf_squad');
    expect(t.dataset.locked).toBe('1');
    expect(t.querySelector('.rl-tile__lock')?.textContent).toBe('★ ≥12');
    expect(t.title).toContain('Needs 12 stars');
    expect(t.title).not.toContain('requires 12 stars');
  });

  // A type the campaign has not opened is not "expensive". Saying both at once
  // would dim the tile for two reasons and name neither.
  it('lets the lock outrank the price', () => {
    const rt = fakeRuntime({ logistics: 0, blocked: { inf_squad: 'locked' } });
    const r = rig([dockUnit()], rt);
    expect(r.tile('inf_squad').dataset.locked).toBe('1');
    expect(r.tile('inf_squad').dataset.poor).toBe('0');
  });

  it('repaints every state on refresh rather than only on build', () => {
    const rt = fakeRuntime();
    const r = rig([dockUnit()], rt);
    expect(r.tile('inf_squad').dataset.poor).toBe('0');
    rt.logistics = 10;
    rt.blocked = {};
    rt.production = [{ unit: 'inf_squad', ticksLeft: 20, doneTicks: 280, totalTicks: 300 }];
    r.dock.refresh();
    expect(r.tile('inf_squad').dataset.poor).toBe('1');
    expect(r.tile('inf_squad').dataset.queued).toBe('1');
  });

  it('marks a support call armed, and only the one armed', () => {
    const r = rig();
    r.support('drone_sweep').click();
    expect(r.support('drone_sweep').dataset.armed).toBe('1');
    expect(r.support('air_strike').dataset.armed).toBe('0');
    expect(r.arms).toEqual(['drone_sweep']);
  });

  it('dims a support call there is not enough intel for', () => {
    const r = rig([dockUnit()], fakeRuntime({ intel: 40 }));
    expect(r.support('drone_sweep').dataset.poor).toBe('0');
    expect(r.support('air_strike').dataset.poor).toBe('1');
  });
});

// ----------------------------------------------------------------------
// Clicks
// ----------------------------------------------------------------------

// WP-A3.3, the lead's ruling 1: a deferred buildable whose GLB has not landed
// draws nothing on the map, so once bought its tile says "deploying".
describe('the deploying chip', () => {
  it('is off for a tile nobody has bought, even while its model is pending', () => {
    const r = rig([dockUnit()], fakeRuntime(), () => true);
    expect(r.tile('inf_squad').dataset.meshPending).toBe('0');
  });

  it('turns on once the player buys one, and off again when the model lands', () => {
    let pending = true;
    const r = rig([dockUnit()], fakeRuntime(), () => pending);
    r.tile('inf_squad').click();
    expect(r.rt.builds).toEqual(['inf_squad']);
    expect(r.tile('inf_squad').dataset.meshPending).toBe('1');
    expect(r.tile('inf_squad').querySelector('.rl-tile__deploying')?.textContent).toBe('deploying');
    pending = false;
    r.dock.refresh();
    expect(r.tile('inf_squad').dataset.meshPending).toBe('0');
  });

  it('stays off when no pending predicate is supplied', () => {
    const r = rig();
    r.tile('inf_squad').click();
    expect(r.tile('inf_squad').dataset.meshPending).toBe('0');
  });

  it('stays off when the runtime refused the build', () => {
    const r = rig([dockUnit()], fakeRuntime({ buildOk: false }), () => true);
    r.tile('inf_squad').click();
    expect(r.tile('inf_squad').dataset.meshPending).toBe('0');
  });
});

describe('what a click does', () => {
  it('asks the runtime to build, and says so', () => {
    const r = rig();
    r.tile('inf_squad').click();
    expect(r.rt.builds).toEqual(['inf_squad']);
    expect(r.notes[0].html).toContain('Rifle Squad');
  });

  // N2, D3 (lead, 16 Oct: "check, then send"): the click pre-checks with
  // `canBuild` and dispatches a `build` command; the runtime spends when the
  // command runs, before the next tick. `requestBuild` is never called here --
  // the fake's throws.
  it('dispatches one build command for an affordable tile, notes it and counts it', () => {
    const bought: string[] = [];
    let denied = 0;
    const r = rig([dockUnit()], fakeRuntime(), undefined, {
      onBought: (id) => bought.push(id),
      onDeny: () => denied++,
    });
    r.tile('inf_squad').click();
    expect(r.rt.sent).toEqual([{ kind: 'build', side: 0, unit: 'inf_squad' }]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ tone: 'info' });
    expect(r.notes[0].html).toContain('building');
    expect(bought).toEqual(['inf_squad']);
    expect(denied).toBe(0);
  });

  it('dispatches nothing for a tile canBuild refuses, and says so with the deny cue', () => {
    const bought: string[] = [];
    let denied = 0;
    const r = rig([dockUnit()], fakeRuntime({ buildOk: false }), undefined, {
      onBought: (id) => bought.push(id),
      onDeny: () => denied++,
    });
    r.tile('inf_squad').click();
    expect(r.rt.sent).toEqual([]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ tone: 'mute' });
    expect(r.notes[0].html).toContain('insufficient logistics');
    expect(bought).toEqual([]);
    expect(denied).toBe(1);
  });

  // Review Focus 3, the UI half (the runtime half is Task 4's): two clicks in
  // one frame where the purse covers one. The pre-check reads the purse as it
  // stands, and nothing has spent yet, so it says yes to BOTH and both are
  // sent and noted "building". The runtime refuses the second when it runs it.
  // This is D3's known gap, pinned rather than hidden.
  it('says yes to two clicks in one frame: the pre-check cannot see the first, unspent', () => {
    const rt = fakeRuntime();
    const r = rig([dockUnit()], rt, undefined, { onBought: () => undefined });
    r.tile('inf_squad').click();
    r.tile('inf_squad').click();
    expect(rt.sent).toEqual([
      { kind: 'build', side: 0, unit: 'inf_squad' },
      { kind: 'build', side: 0, unit: 'inf_squad' },
    ]);
    expect(r.notes.map((n) => n.tone)).toEqual(['info', 'info']);
  });

  it('refuses a locked tile without asking the runtime to build it', () => {
    const r = rig([dockUnit()], fakeRuntime({ blocked: { inf_squad: 'locked' } }));
    r.tile('inf_squad').click();
    expect(r.rt.builds).toEqual([]);
    expect(r.notes[0].tone).toBe('warn');
    expect(r.notes[0].html).toContain('is locked');
  });

  // I1: the fake runtime still answers `buildBlockedReason` with the sim's
  // raw "requires ..." wording -- proving the click note recomputes the
  // human sentence from the unit's own `unlock` gate (via `tileState` /
  // `gateSentence`, the SAME call `refresh()`'s `title` already makes)
  // rather than piping that raw string into the feed. Before this fix the
  // note contained `requires campaign Conduct 55 (no missions rated yet)`
  // verbatim.
  it('never puts the sim\'s raw "requires" wording in the locked-tile note', () => {
    const r = rig(
      [dockUnit({ unlock: { roeMin: 55 } })],
      fakeRuntime({ blocked: { inf_squad: 'requires campaign Conduct 55 (no missions rated yet)' } })
    );
    r.tile('inf_squad').click();
    expect(r.rt.builds).toEqual([]);
    expect(r.notes[0].tone).toBe('warn');
    expect(r.notes[0].html).toContain('is locked');
    expect(r.notes[0].html).toContain('Needs a campaign Conduct of 55 or better');
    expect(r.notes[0].html).not.toContain('requires');
  });

  it('explains a refused build rather than doing nothing', () => {
    const r = rig([dockUnit()], fakeRuntime({ buildOk: false }));
    r.tile('inf_squad').click();
    expect(r.notes[0].tone).toBe('mute');
    expect(r.notes[0].html).toContain('insufficient logistics');
  });

  // Shell upgrade Phase 3, Task 10. A dock note is `hud.note` HTML, and a
  // unit's `name` (`data/units/*.json`, free text the schema does not
  // constrain) went into all three of them raw. Parsed the way `note` parses
  // it, each of these opened an `<i>` before the fix.
  it('names the unit in every note it writes as text, never as markup', () => {
    const name = '<i>Rifle</i> Squad';
    const r = rig([dockUnit({ name })]);
    r.tile('inf_squad').click(); // building
    r.rt.buildOk = false;
    r.tile('inf_squad').click(); // cannot build
    r.rt.blocked.inf_squad = 'field camp destroyed';
    r.tile('inf_squad').click(); // locked
    expect(r.notes.map((n) => n.tone)).toEqual(['info', 'mute', 'warn']);
    for (const n of r.notes) {
      const parsed = document.createElement('div');
      parsed.innerHTML = n.html;
      expect(parsed.querySelector('i')).toBeNull();
      expect(parsed.textContent).toContain(name);
    }
  });

  // The locked note's reason is `gateSentence`'s, and an `afterMission` gate
  // names the MISSION -- `missionName` resolves it to the mission's own
  // authored `name`, the same string the strip shows.
  it('names the mission a lock is waiting on as text, never as markup', () => {
    document.body.replaceChildren();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const notes: string[] = [];
    new ReinforcementDock(host, {
      units: [dockUnit({ unlock: { afterMission: 'wadi_halam_1_fords' } })],
      runtime: fakeRuntime({ blocked: { inf_squad: 'requires clearing wadi_halam_1_fords' } }),
      note: (html) => notes.push(html),
      onArm: () => undefined,
      dispatch: () => undefined,
      missionName: () => 'The <i>Fords</i>',
    });
    host.querySelector<HTMLButtonElement>('[data-unit="inf_squad"]')?.click();
    expect(notes).toHaveLength(1);
    const parsed = document.createElement('div');
    parsed.innerHTML = notes[0];
    expect(parsed.querySelector('i')).toBeNull();
    expect(parsed.textContent).toContain('Clear The <i>Fords</i> first');
  });

  it('will not arm a support call there is no intel for', () => {
    const r = rig([dockUnit()], fakeRuntime({ intel: 0 }));
    r.support('drone_sweep').click();
    expect(r.arms).toEqual([]);
    expect(r.support('drone_sweep').dataset.armed).toBe('0');
    expect(r.notes[0].tone).toBe('mute');
  });

  it('a short click denies: a note, the cue, nothing armed', () => {
    const onDeny = vi.fn();
    const r = rig([dockUnit()], fakeRuntime({ intel: 15 }), undefined, { onDeny });
    r.support('mortar_barrage').click();
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0].html).toContain('mortar barrage');
    expect(r.arms).toEqual([]);
    expect(r.support('mortar_barrage').dataset.armed).toBe('0');
  });

  it('an affordable click arms it and only it; a second click disarms', () => {
    for (const kind of FIRE_SUPPORT_KINDS) {
      const r = rig();
      r.support(kind).click();
      for (const other of FIRE_SUPPORT_KINDS) {
        expect(r.support(other).dataset.armed).toBe(other === kind ? '1' : '0');
      }
      r.support(kind).click();
      expect(r.support(kind).dataset.armed).toBe('0');
      expect(r.arms).toEqual([kind, null]);
    }
  });

  it('press is the click', () => {
    const onDeny = vi.fn();
    const r = rig([dockUnit()], fakeRuntime({ intel: 100 }), undefined, { onDeny });
    expect(r.dock.press('air_strike')).toBe(true);
    expect(r.support('air_strike').dataset.armed).toBe('1');
    expect(onDeny).not.toHaveBeenCalled();
    expect(r.dock.press('air_strike')).toBe(false); // a second press disarms
    expect(r.support('air_strike').dataset.armed).toBe('0');
    const poor = rig([dockUnit()], fakeRuntime({ intel: 10 }), undefined, { onDeny });
    expect(poor.dock.press('air_strike')).toBe(false);
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(poor.support('air_strike').dataset.armed).toBe('0');
  });

  it('no clock on a charging tile', () => {
    const r = rig([dockUnit()], fakeRuntime({ intel: 5 }), undefined, {
      supportCharge: (kind) => ({ fraction: 0.5, title: `charging ${kind}` }),
    });
    r.dock.refresh();
    for (const kind of FIRE_SUPPORT_KINDS) {
      expect(r.support(kind).querySelector('.rl-tile__clock')).toBeNull();
      expect(r.support(kind).dataset.charging).toBe('1');
      expect(r.support(kind).getAttribute('aria-label')).toBe(`charging ${kind}`);
    }
  });

  it('the tooltip names the bound key when the shell supplies one, and says nothing when not', () => {
    const r = rig([dockUnit()], fakeRuntime(), undefined, { hotkeyLabel: (k) => (k === 'air_strike' ? 'R' : undefined) });
    hover(r.support('air_strike'));
    expect(r.tip().textContent).toContain('Key R');
    unhover(r.support('air_strike'));
    hover(r.support('drone_sweep'));
    expect(r.tip().textContent).not.toContain('Key');
  });

  it('disarms when the armed call is clicked again', () => {
    const r = rig();
    r.support('air_strike').click();
    r.support('air_strike').click();
    expect(r.arms).toEqual(['air_strike', null]);
    expect(r.support('air_strike').dataset.armed).toBe('0');
  });

  // The tiles are repainted 4 Hz. A rebuild by innerHTML would drop the
  // listener and the second click would be lost.
  it('keeps its listeners across a refresh', () => {
    const r = rig();
    r.tile('inf_squad').click();
    r.dock.refresh();
    r.dock.refresh();
    r.tile('inf_squad').click();
    expect(r.rt.builds).toEqual(['inf_squad', 'inf_squad']);
  });

  it('sends B to the first tile the player could actually spend on', () => {
    const rt = fakeRuntime({ logistics: 400, blocked: { mbt_lavi: 'locked' } });
    const r = rig(
      [
        dockUnit({ id: 'mbt_lavi', name: 'Lavi MBT', logistics: 906 }),
        dockUnit({ id: 'heli_peten', name: 'Peten', logistics: 900 }),
        dockUnit(),
      ],
      rt
    );
    expect(r.dock.focusFirst()).toBe(true);
    expect(document.activeElement).toBe(r.tile('inf_squad'));
  });

  it('still lands somewhere when nothing at all is affordable', () => {
    const r = rig([dockUnit()], fakeRuntime({ logistics: 0 }));
    expect(r.dock.focusFirst()).toBe(true);
    expect(document.activeElement).toBe(r.tile('inf_squad'));
  });
});

// ----------------------------------------------------------------------
// The tooltip
// ----------------------------------------------------------------------

describe('the hover tooltip', () => {
  it('is hidden until something is hovered, and hides again after', () => {
    const r = rig();
    expect(r.tip().hidden).toBe(true);
    hover(r.tile('inf_squad'));
    expect(r.tip().hidden).toBe(false);
    unhover(r.tile('inf_squad'));
    expect(r.tip().hidden).toBe(true);
  });

  it('carries the name, the price and the build time, and the doctrine line', () => {
    const r = rig([dockUnit({ blurb: 'Holds ground and garrisons buildings.' })]);
    hover(r.tile('inf_squad'));
    const tip = r.tip();
    expect(tip.querySelector('.rl-tip__name')?.textContent).toBe('Rifle Squad');
    expect(tip.querySelector('.rl-tip__cost')?.textContent).toBe('292 · 15s');
    expect(tip.querySelector('.rl-tip__tags')?.textContent).toContain('soft · garrisons · spots');
    expect(tip.querySelector('.rl-tip__tags svg')).not.toBe(null);
    expect(tip.querySelector('.rl-tip__blurb')?.textContent).toBe(
      'Holds ground and garrisons buildings.'
    );
  });

  // Final review of shell-upgrade Phase 3, ruling 5: the tip is `innerHTML`
  // (`tooltip.ts`), and all three strings in it are catalogue data --
  // `name` and `blurb` from `data/units/*.json`, the tags from
  // `doctrineTags` over it -- that the schema does not forbid `<` or `&` in.
  // Each renders WRONG unescaped: an entity that decodes, a tag that opens.
  it('shows the name, the blurb and the tags as the characters they are', () => {
    const r = rig([
      dockUnit({ name: 'Fish &amp; <i>Chips</i>', blurb: 'Holds <b>ground</b> &amp; more', tags: ['soft', '<u>x</u> &lt;y&gt;'] }),
    ]);
    hover(r.tile('inf_squad'));
    const tip = r.tip();
    expect(tip.querySelector('i, b, u')).toBe(null);
    expect(tip.querySelector('.rl-tip__name')?.textContent).toBe('Fish &amp; <i>Chips</i>');
    expect(tip.querySelector('.rl-tip__blurb')?.textContent).toBe('Holds <b>ground</b> &amp; more');
    expect(tip.querySelector('.rl-tip__tags')?.textContent).toContain('soft · <u>x</u> &lt;y&gt;');
  });

  it('omits the description line for a unit that has no blurb', () => {
    const r = rig([dockUnit()]);
    hover(r.tile('inf_squad'));
    expect(r.tip().querySelector('.rl-tip__blurb')).toBe(null);
    // …and still draws everything else.
    expect(r.tip().querySelector('.rl-tip__name')?.textContent).toBe('Rifle Squad');
  });

  it('describes the tile under the pointer, not the one before it', () => {
    const r = rig([dockUnit(), dockUnit({ id: 'mbt_lavi', name: 'Lavi MBT', logistics: 906 })]);
    hover(r.tile('inf_squad'));
    hover(r.tile('mbt_lavi'));
    expect(r.tip().querySelector('.rl-tip__name')?.textContent).toBe('Lavi MBT');
  });

  // S3e (Q7): the tooltip's role badge was 8 px, where an APP-6 mark is a
  // smudge. 10 is the floor everywhere a unit is badged.
  it('draws no role badge below 10 px', () => {
    const r = rig();
    hover(r.tile('inf_squad'));
    const badge = r.tip().querySelector('.rl-tip__tags svg.rl-badge');
    expect(badge).not.toBeNull();
    expect(Number(badge?.getAttribute('width'))).toBeGreaterThanOrEqual(10);
  });

  it('describes a support call too, since a glyph explains nothing on its own', () => {
    const r = rig();
    hover(r.support('air_strike'));
    expect(r.tip().querySelector('.rl-tip__name')?.textContent).toBe('Precision strike');
    expect(r.tip().querySelector('.rl-tip__cost')?.textContent).toBe('60 intel');
    expect(r.tip().querySelector('.rl-tip__blurb')).not.toBe(null);
  });

  // Keyboard and mouse are the same intent; `B` would be a worse way in than
  // the mouse if it could not read the tooltip.
  it('opens on keyboard focus as well as on hover', () => {
    const r = rig();
    r.tile('inf_squad').dispatchEvent(new Event('focus'));
    expect(r.tip().hidden).toBe(false);
    r.tile('inf_squad').dispatchEvent(new Event('blur'));
    expect(r.tip().hidden).toBe(true);
  });
});

// ----------------------------------------------------------------------
// Invariant 4
// ----------------------------------------------------------------------

describe('invariant 4: the dock never touches the sim', () => {
  /** A real Sim and a real MissionRuntime, so this is the whole chain and not
   *  a stub agreeing with itself. `beit_sahwan`-shaped: one buildable, some
   *  logistics, a start line to deploy at. */
  function realWorld(): { sim: Sim; runtime: MissionRuntime; queued: number[] } {
    const sim = new Sim({ seed: 3, width: 16, height: 16, capacity: 16 });
    const typeIdx = sim.addUnitType(units.inf_squad as unknown as UnitTypeJson);
    const mission: MissionJson = {
      id: 'dock_test',
      map: { file: 'none', player_start: [2, 2] },
      ledger: { requires: [], produces: [] },
      objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
      resources: { logistics_start: 5000, intel_start: 500 },
    };
    const runtime = new MissionRuntime(sim, mission, {
      typeIdOf: () => typeIdx,
      markers: {},
      zones: {},
      unitInfo: () => ({ logistics: 292, buildTimeS: 15, population: 1 }),
    });
    runtime.start();
    const queued: number[] = [];
    const real = sim.queueCommand.bind(sim);
    sim.queueCommand = (cmd) => {
      queued.push(1);
      real(cmd);
    };
    return { sim, runtime, queued };
  }

  it('clicks every tile and issues no sim command at all', () => {
    const w = realWorld();
    const before = w.sim.entityCount;
    // N2 D3: the dock's purchase goes to the ORDER SINK (in the app, the
    // transport), never into the sim. Recorded here instead.
    const sent: Command[] = [];
    const r = rig([dockUnit()], w.runtime as unknown as FakeRuntime, undefined, { dispatch: (cmd) => sent.push(cmd) });
    r.tile('inf_squad').click();
    r.support('drone_sweep').click();
    r.support('air_strike').click();
    r.dock.refresh();
    expect(w.queued).toHaveLength(0);
    expect(w.runtime.production).toEqual([]);
    expect(sent).toEqual([{ kind: 'build', side: 0, unit: 'inf_squad' }]);
    // …and that command, run the way the frame path runs it, really does land
    // in the runtime's queue, so the zero above is "went the right way", not
    // "went nowhere". `build` is set aside by the sim, not queued as an order.
    for (const cmd of sent) w.sim.queueCommand(cmd);
    expect(w.runtime.applyQueued()).toBe(1);
    expect(w.runtime.production.map((p) => p.unit)).toEqual(['inf_squad']);
    expect(w.sim.entityCount).toBe(before);
  });

  it('reads a real runtime’s lock and queue rather than its own idea of them', () => {
    const sim = new Sim({ seed: 3, width: 16, height: 16, capacity: 16 });
    sim.addUnitType(units.inf_squad as unknown as UnitTypeJson);
    const runtime = new MissionRuntime(
      sim,
      {
        id: 'dock_test',
        map: { file: 'none', player_start: [2, 2] },
        ledger: { requires: [], produces: [] },
        objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
        resources: { logistics_start: 5000 },
      },
      {
        typeIdOf: () => 0,
        markers: {},
        zones: {},
        // The shipped gate on the Lavi, asked of an empty ledger.
        unitInfo: () => ({ logistics: 906, buildTimeS: 45, population: 1, unlock: { roeMin: 55 } }),
      }
    );
    runtime.start();
    const r = rig(
      [dockUnit({ id: 'mbt_lavi', name: 'Lavi MBT', logistics: 906, unlock: { roeMin: 55 } })],
      runtime as unknown as FakeRuntime
    );
    expect(r.tile('mbt_lavi').dataset.locked).toBe('1');
    expect(r.tile('mbt_lavi').querySelector('.rl-tile__lock')?.textContent).toBe('Conduct ≥55');
    // The tile's own recompute, not the real runtime's raw `unlockReason` text.
    expect(r.tile('mbt_lavi').title).toContain('Needs a campaign Conduct of 55 or better');
    expect(r.tile('mbt_lavi').title).not.toContain('requires campaign Conduct');
  });
});

/** `main.ts` mounts the dock on `document.body`, not on the stage the router
 *  clears, so a `resources` mission that is LEFT strands it over the campaign
 *  board unless the battlefield's disposer takes it off. Mounted on the body
 *  here for that reason, rather than through `rig()`'s scratch host. */
describe('destroy', () => {
  it('removes the dock from the body, and can be called twice', () => {
    document.body.replaceChildren();
    const before = document.body.children.length;
    const dock = new ReinforcementDock(document.body, {
      units: [dockUnit()],
      runtime: fakeRuntime(),
      note: () => {},
      onArm: () => {},
      dispatch: () => {},
    });
    expect(document.body.querySelector('.rl-dock')).not.toBeNull();
    dock.destroy();
    expect(document.body.querySelector('.rl-dock')).toBeNull();
    expect(document.body.children.length).toBe(before);
    // Idempotent, like the HUD's and the overlay's: a stale battlefield mount
    // resolving onto an aborted route runs its disposer after the teardown
    // that aborted it.
    dock.destroy();
    expect(document.body.children.length).toBe(before);
  });

  // Task 7: the dock's tooltip moved onto the shared `bindTip`, whose
  // Escape handling lives on `window`, not on `this.el` -- the one listener
  // `Element.remove()` cannot take down by itself. This is what proves the
  // disposers `destroy()` now runs actually release it, rather than merely
  // detaching the DOM node the app never happened to query again.
  it('releases its tooltip even mid-hover, leaving no window listener behind', () => {
    // Fix wave I2: `not.toThrow()` used to be the whole assertion -- a
    // keydown never throws whether or not the listener came off, so this
    // could not have caught the mutation it is now named for (dropping
    // `hide()` from `bindTip`'s disposer). `closeTip()` first, because
    // `tooltip.ts`'s Escape listener is a single MODULE-level singleton
    // shared by every host in the process: a hover left open by an earlier
    // test elsewhere would mean `escBound` is already true before this
    // test's own hover, and the `addEventListener` call below would never
    // happen.
    closeTip();
    document.body.replaceChildren();
    const dock = new ReinforcementDock(document.body, {
      units: [dockUnit()],
      runtime: fakeRuntime(),
      note: () => {},
      onArm: () => {},
      dispatch: () => {},
    });
    const tile = document.body.querySelector<HTMLButtonElement>('[data-unit="inf_squad"]')!;
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    hover(tile);
    expect(document.body.querySelector<HTMLElement>('.rl-tip')?.hidden).toBe(false);
    const keydownAdd = addSpy.mock.calls.find(([type]) => type === 'keydown');
    expect(keydownAdd).toBeDefined();
    const listener = keydownAdd![1];

    dock.destroy();
    // The tip is a descendant of `this.el` and goes down with it -- no node
    // left over for a later dock's tip to collide with.
    expect(document.body.querySelector<HTMLElement>('.rl-tip')).toBeNull();
    // The SAME listener reference that went on -- proof the one the hover
    // installed is the one that came off, not merely that something did.
    expect(removeSpy).toHaveBeenCalledWith('keydown', listener);
  });
});

describe('the kit sign on a tile (WP-S3g plan 2b)', () => {
  it("signs a kitted type's tile with its level, as the tile's own child, and leaves the others alone", () => {
    const r = rig([
      dockUnit({ kit: 1 }),
      dockUnit({ id: 'mbt_lavi', name: 'Lavi MBT', kit: 3 }),
      dockUnit({ id: 'at_team', name: 'Spike AT' }),
    ]);
    expect(r.tile('inf_squad').querySelector<HTMLElement>(':scope > .rl-kit-icon')?.dataset.kit).toBe('1');
    expect(r.tile('mbt_lavi').querySelector<HTMLElement>(':scope > .rl-kit-icon')?.dataset.kit).toBe('3');
    expect(r.tile('at_team').querySelector('.rl-kit-icon')).toBeNull();
  });

  it('builds an unkitted tile exactly as before', () => {
    const plainTile = rig([dockUnit()]).tile('inf_squad');
    const zeroTile = rig([dockUnit({ kit: 0 })]).tile('inf_squad');
    expect(zeroTile.outerHTML).toBe(plainTile.outerHTML);
    expect(plainTile.querySelector('.rl-kit-host')).toBeNull();
    expect(plainTile.querySelector('.rl-kit-icon')).toBeNull();
    expect(zeroTile.querySelector('.rl-kit-host')).toBeNull();
    expect(zeroTile.querySelector('.rl-kit-icon')).toBeNull();
  });

  it('keeps one sign through the 4 Hz repaint', () => {
    const r = rig([dockUnit({ kit: 2 })]);
    r.dock.refresh();
    r.dock.refresh();
    expect(r.tile('inf_squad').querySelectorAll('.rl-kit-icon')).toHaveLength(1);
  });

  it('adds the kit level to the tile’s aria-label only, never to its title, and only when unlocked', () => {
    const r = rig([dockUnit({ kit: 2 })]);
    const t = r.tile('inf_squad');
    expect(t.getAttribute('aria-label')).toBe('Rifle Squad — 292 logistics, Kit II');
    expect(t.title).toBe('Rifle Squad — 292 logistics');

    const rt = fakeRuntime({ blocked: { inf_squad: 'locked' } });
    const locked = rig([dockUnit({ kit: 2, unlock: { roeMin: 1 } })], rt).tile('inf_squad');
    expect(locked.getAttribute('aria-label')).not.toContain('Kit');
    expect(locked.getAttribute('aria-label')).toBe(locked.title);
  });

  it('leaves an unkitted tile’s aria-label exactly as before', () => {
    const r = rig([dockUnit({ kit: 0 })]);
    expect(r.tile('inf_squad').getAttribute('aria-label')).toBe('Rifle Squad — 292 logistics');
  });
});

describe('onBought (GH-254)', () => {
  function withSpy(rt = fakeRuntime(), unitList: DockUnit[] = [dockUnit()]) {
    document.body.replaceChildren();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const bought: string[] = [];
    new ReinforcementDock(host, {
      units: unitList, runtime: rt, note: () => undefined, onArm: () => undefined,
      dispatch: sinkOf(rt),
      onBought: (id) => bought.push(id),
    });
    const tile = host.querySelector<HTMLButtonElement>('[data-unit="inf_squad"]');
    if (tile === null) throw new Error('no inf_squad tile');
    return { bought, tile, rt };
  }

  it('fires once per accepted buy, with the unit id', () => {
    const { bought, tile } = withSpy();
    tile.click();
    tile.click();
    expect(bought).toEqual(['inf_squad', 'inf_squad']);
  });

  it('does not fire when the runtime refuses the buy', () => {
    const { bought, tile, rt } = withSpy(fakeRuntime({ buildOk: false }));
    tile.click();
    // N2 D3: the pre-check refused it, so no command went out at all.
    expect(rt.builds).toEqual([]);
    expect(bought).toEqual([]);
  });

  it('does not fire, and never asks the runtime, for a locked tile', () => {
    const { bought, tile, rt } = withSpy(fakeRuntime({ blocked: { inf_squad: 'Locked' } }));
    tile.click();
    expect(rt.builds).toEqual([]);
    expect(bought).toEqual([]);
  });
});

// ----------------------------------------------------------------------
// Population (F3 Lane A, S-F)
// ----------------------------------------------------------------------

describe('population in the dock', () => {
  const eitan = (): DockUnit => dockUnit({ id: 'apc_eitan', name: 'Eitan APC', logistics: 400, population: 2 });
  const drone = (): DockUnit => dockUnit({ id: 'recon_drone', name: 'Recon Drone', logistics: 100, population: 0 });
  const readout = (r: Rig): HTMLElement => r.host.querySelector<HTMLElement>('.rl-dock__pop')!;

  // Review Focus 5.
  it('shows no readout while the mission is uncapped', () => {
    const r = rig([dockUnit()], fakeRuntime({ pop: null }));
    expect(readout(r).hidden).toBe(true);
    expect(readout(r).textContent).toBe('');
    expect(r.tile('inf_squad').dataset.capped).toBe('0');
  });

  it('shows used/cap and the word in --info below the cap, in the header beside the credits', () => {
    const r = rig([dockUnit()], fakeRuntime({ pop: { used: 9, cap: 12 } }), undefined, { credits: 40 });
    expect(readout(r).hidden).toBe(false);
    expect(readout(r).textContent).toBe('9/12 population');
    expect(readout(r).classList.contains('rl-info')).toBe(true);
    expect(readout(r).classList.contains('rl-warn')).toBe(false);
    expect(readout(r).querySelector('.rl-dim')?.textContent).toBe('population');
    expect(readout(r).parentElement).toBe(r.host.querySelector('.rl-dock__head'));
  });

  it('turns to the warn tone at the cap', () => {
    const r = rig([dockUnit()], fakeRuntime({ pop: { used: 12, cap: 12 } }));
    expect(readout(r).textContent).toBe('12/12 population');
    expect(readout(r).classList.contains('rl-warn')).toBe(true);
    expect(readout(r).classList.contains('rl-info')).toBe(false);
  });

  it('follows the runtime on the 4 Hz repaint: a unit falls, a build queues', () => {
    const rt = fakeRuntime({ pop: { used: 12, cap: 12 } });
    const r = rig([dockUnit()], rt);
    expect(readout(r).textContent).toBe('12/12 population');
    rt.pop = { used: 11, cap: 12 };
    r.dock.refresh();
    expect(readout(r).textContent).toBe('11/12 population');
    expect(readout(r).classList.contains('rl-info')).toBe(true);
    rt.pop = { used: 12, cap: 12 };
    r.dock.refresh();
    expect(readout(r).classList.contains('rl-warn')).toBe(true);
    // …and goes away again if the mission stops reporting a cap.
    rt.pop = null;
    r.dock.refresh();
    expect(readout(r).hidden).toBe(true);
  });

  it('marks a capped tile: data-capped, the short label, the full line on title and aria-label', () => {
    // Short of logistics too, so `poor` has something to decline.
    const rt = fakeRuntime({ logistics: 0, pop: { used: 12, cap: 12 }, capped: new Set(['inf_squad']) });
    const r = rig([dockUnit(), drone()], rt);
    const tile = r.tile('inf_squad');
    expect(tile.dataset.capped).toBe('1');
    expect(tile.dataset.locked).toBe('0');
    // A capped tile is refused for a reason that is not its price.
    expect(tile.dataset.poor).toBe('0');
    expect(tile.querySelector('.rl-tile__lock')?.textContent).toBe('pop full');
    expect(tile.title).toBe('Rifle Squad — Population 12/12. A unit must fall first.');
    expect(tile.getAttribute('aria-label')).toBe(tile.title);
    // The other tile (a drone takes no population) is untouched.
    expect(r.tile('recon_drone').dataset.capped).toBe('0');
    expect(r.tile('recon_drone').querySelector('.rl-tile__lock')?.textContent).toBe('');
  });

  // Review Focus 4.
  it('at 11/12 a 2-population unit is capped and says what it needs; a drone never is', () => {
    const rt = fakeRuntime({ pop: { used: 11, cap: 12 }, capped: new Set(['apc_eitan']) });
    const r = rig([eitan(), drone()], rt);
    expect(r.tile('apc_eitan').dataset.capped).toBe('1');
    // The label opens with the name, so the sentence after the dash does not repeat it.
    expect(r.tile('apc_eitan').title).toBe('Eitan APC — Population 11/12; needs 2.');
    const label = r.tile('apc_eitan').getAttribute('aria-label') ?? '';
    expect(label.split('Eitan APC')).toHaveLength(2);
    expect(r.tile('recon_drone').dataset.capped).toBe('0');
  });

  // Review Focus 3.
  it('reads the lock, not "pop full", on a locked tile that is also over the cap', () => {
    const rt = fakeRuntime({
      pop: { used: 12, cap: 12 },
      capped: new Set(['inf_squad']),
      blocked: { inf_squad: 'requires campaign Conduct 55 (no missions rated yet)' },
    });
    const r = rig([dockUnit({ unlock: { roeMin: 55 } })], rt);
    expect(r.tile('inf_squad').dataset.locked).toBe('1');
    expect(r.tile('inf_squad').dataset.capped).toBe('0');
    expect(r.tile('inf_squad').querySelector('.rl-tile__lock')?.textContent).toBe('Conduct ≥55');
  });

  it('adds the full line to the rich tip as one warn line, and nothing on an open tile', () => {
    const rt = fakeRuntime({ pop: { used: 11, cap: 12 }, capped: new Set(['apc_eitan']) });
    const r = rig([eitan(), dockUnit()], rt);
    hover(r.tile('apc_eitan'));
    const warn = r.tip().querySelectorAll('.rl-warn');
    expect(warn).toHaveLength(1);
    expect(warn[0].textContent).toBe('Population 11/12. Eitan APC needs 2.');
    unhover(r.tile('apc_eitan'));
    hover(r.tile('inf_squad'));
    expect(r.tip().querySelectorAll('.rl-warn')).toHaveLength(0);
    unhover(r.tile('inf_squad'));
  });

  it('puts a locked tile\'s gate sentence in its rich tip as one warn line', () => {
    const rt = fakeRuntime({ blocked: { inf_squad: 'requires campaign Conduct 55 (no missions rated yet)' } });
    const r = rig([dockUnit({ unlock: { roeMin: 55 } })], rt);
    hover(r.tile('inf_squad'));
    const warn = r.tip().querySelectorAll('.rl-warn');
    expect(warn).toHaveLength(1);
    expect(warn[0].textContent).toBe(r.tile('inf_squad').title.replace('Rifle Squad — ', ''));
    expect(warn[0].textContent).not.toContain('requires campaign');
    expect(warn[0].textContent?.length).toBeGreaterThan(0);
    unhover(r.tile('inf_squad'));
  });

  it('shows the lock sentence and no cap line on a tile both locked and over the cap', () => {
    const rt = fakeRuntime({
      pop: { used: 12, cap: 12 },
      capped: new Set(['inf_squad']),
      blocked: { inf_squad: 'requires campaign Conduct 55 (no missions rated yet)' },
    });
    const r = rig([dockUnit({ unlock: { roeMin: 55 } })], rt);
    hover(r.tile('inf_squad'));
    const warn = r.tip().querySelectorAll('.rl-warn');
    expect(warn).toHaveLength(1);
    expect(warn[0].textContent).not.toContain('Population');
    unhover(r.tile('inf_squad'));
  });

  it('writes the unit name in the tip line as text, never as markup', () => {
    const rt = fakeRuntime({ pop: { used: 11, cap: 12 }, capped: new Set(['apc_eitan']) });
    const r = rig([dockUnit({ id: 'apc_eitan', name: '<i>Eitan</i>', population: 2 })], rt);
    hover(r.tile('apc_eitan'));
    expect(r.tip().querySelector('.rl-warn i')).toBeNull();
    expect(r.tip().querySelector('.rl-warn')?.textContent).toContain('<i>Eitan</i>');
    unhover(r.tile('apc_eitan'));
  });

  it('sends B past a capped tile as it does past a locked one', () => {
    const rt = fakeRuntime({ pop: { used: 12, cap: 12 }, capped: new Set(['inf_squad']) });
    const r = rig([dockUnit(), drone()], rt);
    expect(r.dock.focusFirst()).toBe(true);
    expect(document.activeElement).toBe(r.tile('recon_drone'));
  });

  describe('the deny cue on the unit tiles', () => {
    it('plays on a locked tile, queues nothing, and says why', () => {
      const onDeny = vi.fn();
      const r = rig([dockUnit()], fakeRuntime({ blocked: { inf_squad: 'locked' } }), undefined, { onDeny });
      r.tile('inf_squad').click();
      expect(onDeny).toHaveBeenCalledTimes(1);
      expect(r.rt.builds).toEqual([]);
      expect(r.notes[0].html).toContain('is locked');
    });

    it('plays on a capped tile, queues nothing, and the note carries the numbers', () => {
      const onDeny = vi.fn();
      const rt = fakeRuntime({ pop: { used: 11, cap: 12 }, capped: new Set(['apc_eitan']) });
      const r = rig([eitan()], rt, undefined, { onDeny });
      r.tile('apc_eitan').click();
      expect(onDeny).toHaveBeenCalledTimes(1);
      expect(r.rt.builds).toEqual([]);
      expect(r.notes).toHaveLength(1);
      expect(r.notes[0].tone).toBe('warn');
      expect(r.notes[0].html).toContain('Population 11/12. Eitan APC needs 2.');
    });

    it('plays on a build the runtime refuses', () => {
      const onDeny = vi.fn();
      const r = rig([dockUnit()], fakeRuntime({ buildOk: false }), undefined, { onDeny });
      r.tile('inf_squad').click();
      expect(onDeny).toHaveBeenCalledTimes(1);
      expect(r.notes[0].html).toContain('insufficient logistics');
    });

    it('never plays for an accepted build', () => {
      const onDeny = vi.fn();
      const r = rig([dockUnit()], fakeRuntime(), undefined, { onDeny });
      r.tile('inf_squad').click();
      expect(r.rt.builds).toEqual(['inf_squad']);
      expect(onDeny).not.toHaveBeenCalled();
    });

    it('still plays when intel is short on a support tile', () => {
      const onDeny = vi.fn();
      const r = rig([dockUnit()], fakeRuntime({ intel: 0 }), undefined, { onDeny });
      r.support('drone_sweep').click();
      expect(onDeny).toHaveBeenCalledTimes(1);
    });
  });

  // The join no fake can make: the REAL runtime's cap, its popCapped, its
  // populationView -- and the queue counting against it (D2).
  /** A real capped runtime (cap 1), with the dock's commands sent the way the
   *  frame path sends them: into the sim, which sets `build` aside for
   *  `applyQueued` (N2 D3). */
  function cappedWorld(onDeny: () => void): { r: Rig; sim: Sim; runtime: MissionRuntime; sent: Command[] } {
    const sim = new Sim({ seed: 3, width: 16, height: 16, capacity: 16 });
    const typeIdx = sim.addUnitType(units.inf_squad as unknown as UnitTypeJson);
    const runtime = new MissionRuntime(
      sim,
      {
        id: 'dock_cap',
        map: { file: 'none', player_start: [2, 2] },
        ledger: { requires: [], produces: [] },
        objectives: [{ id: 'win', type: 'destroy_all', primary: true }],
        resources: { logistics_start: 5000, pop_cap: 1 },
      },
      { typeIdOf: () => typeIdx, markers: {}, zones: {}, unitInfo: () => ({ logistics: 292, buildTimeS: 15, population: 1 }) }
    );
    runtime.start();
    const sent: Command[] = [];
    const r = rig([dockUnit({ population: 1 })], runtime as unknown as FakeRuntime, undefined, {
      onDeny,
      dispatch: (cmd) => {
        sent.push(cmd);
        sim.queueCommand(cmd);
      },
    });
    return { r, sim, runtime, sent };
  }

  it('against a real capped runtime: the build that fills the cap caps the next click', () => {
    const onDeny = vi.fn();
    const { r, runtime, sent } = cappedWorld(onDeny);
    expect(readout(r).textContent).toBe('0/1 population');
    expect(r.tile('inf_squad').dataset.capped).toBe('0');
    r.tile('inf_squad').click();
    expect(onDeny).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    // N2 D3: the click sent a command and spent nothing, so the click's own
    // refresh still reads the pre-purchase population...
    expect(readout(r).textContent).toBe('0/1 population');
    // ...until the command runs, before the next tick, and `main.ts`
    // repaints the dock on a tick that ran one.
    expect(runtime.applyQueued()).toBe(1);
    r.dock.refresh();
    expect(readout(r).textContent).toBe('1/1 population');
    expect(readout(r).classList.contains('rl-warn')).toBe(true);
    expect(r.tile('inf_squad').dataset.capped).toBe('1');
    r.tile('inf_squad').click();
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(runtime.production).toHaveLength(1);
  });

  // Review Focus 3, the UI half, against the real runtime: two clicks in ONE
  // frame where the cap (like the purse) covers one. The pre-check cannot see
  // the first, unspent, so it says yes to both: both are sent, both are noted
  // "building" and neither is denied (D3's known gap, pinned, not hidden).
  // When the commands run, the first is queued and the second refused,
  // spending nothing; neither runs late.
  it('against a real capped runtime: two clicks in one frame are both sent, and the runtime takes one', () => {
    const onDeny = vi.fn();
    const { r, sim, runtime, sent } = cappedWorld(onDeny);
    const before = runtime.logistics;
    r.tile('inf_squad').click();
    r.tile('inf_squad').click();
    expect(sent).toEqual([
      { kind: 'build', side: 0, unit: 'inf_squad' },
      { kind: 'build', side: 0, unit: 'inf_squad' },
    ]);
    expect(onDeny).not.toHaveBeenCalled();
    expect(r.notes.map((n) => n.tone)).toEqual(['info', 'info']);
    expect(runtime.applyQueued()).toBe(1);
    expect(runtime.production).toHaveLength(1);
    expect(runtime.logistics).toBe(before - 292);
    sim.tick();
    expect(runtime.applyQueued()).toBe(0);
    expect(runtime.production).toHaveLength(1);
    expect(runtime.logistics).toBe(before - 292);
  });
});
