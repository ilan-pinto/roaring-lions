// @vitest-environment jsdom
//
// The top strip, in the DOM.
//
// hud-model.test.ts proves the arithmetic; this file proves the JOIN, which is
// where the floating layout can go wrong in a way no pure function sees. Three
// joins specifically:
//
//   - the strip's inline clock and the big centred clock come from ONE
//     derivation, so they can never disagree;
//   - the persistent controls (speed, mute, campaign) survive the 4 Hz
//     innerHTML rebuild that replaces every mission field beside them;
//   - a field that would report nothing (`0 pinned`, `+0 secondary`) is absent
//     rather than present and empty.

import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { Hud, type HudCommanderInfo, type HudDeps, type MissionView } from './hud';

/** A stand-in resolved commander, the shape `main.ts` would hand over from
 *  `commanderForMission` -- this suite is about the DOM join, not about rank
 *  resolution, which `campaign.test.ts` already covers on its own. */
const TEST_COMMANDER: HudCommanderInfo = {
  shai: { name: 'Shai Hammai', plate: 'Hammai', rank: 'Captain', stars: 2 },
  idit: { name: 'Idit Zohar', plate: 'Zohar' },
};

/** The same shape, but with a portrait URL already resolved for both
 *  people -- `main.ts` hands over exactly this after `portraitUrl` runs, so
 *  this suite never has to touch `import.meta.glob` to prove the DOM join. */
const TEST_COMMANDER_WITH_PORTRAITS: HudCommanderInfo = {
  shai: {
    name: 'Shai Hammai',
    plate: 'Hammai',
    rank: 'Captain',
    stars: 2,
    portrait: '/ui/portraits/shai_hammai.png',
  },
  idit: { name: 'Idit Zohar', plate: 'Zohar', portrait: '/ui/portraits/idit_zohar.png' },
};

/** Same again, plus the front's villain (storyline.md G18) -- what `main.ts`
 *  hands over once `regionForTown`/`villainPortrait` (`campaign.ts`) resolve
 *  a mission's `town` to a face. No name or plate on this entry at all: the
 *  bar shows a face beside the literal word ENEMY, never a lookup. */
const TEST_COMMANDER_WITH_ENEMY: HudCommanderInfo = {
  ...TEST_COMMANDER_WITH_PORTRAITS,
  enemy: { portrait: '/ui/portraits/nadir_sahim.png' },
};

/** A two-unit force on an 8x8 field: enough for the suppression counter to have
 *  something to count, and nothing else. The type is the shipped `inf_squad`
 *  rather than a hand-written stand-in — a stand-in here would only be testing
 *  that the stand-in matches itself. */
function makeSim(): { sim: Sim; ids: number[] } {
  const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 8 });
  const t = sim.addUnitType(units.inf_squad as unknown as UnitTypeJson);
  const ids = [
    sim.spawn(t, 0, fx.from(1), fx.from(1)),
    sim.spawn(t, 0, fx.from(2), fx.from(2)),
  ];
  return { sim, ids };
}

function mission(over: Partial<MissionView> = {}): MissionView {
  return {
    name: 'Beit Sahwan II',
    result: 'ongoing',
    objectives: [
      {
        id: 'hold_west',
        text: 'Hold the west',
        primary: true,
        status: 'active',
        ticksLeft: 160 * 20,
        paused: 'contested',
      },
    ],
    ...over,
  };
}

interface Rig {
  hud: Hud;
  host: HTMLElement;
  sim: Sim;
  ids: number[];
  strip: () => string;
  tick: () => void;
}

function rig(m: MissionView | null, over: Partial<HudDeps> = {}): Rig {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const { sim, ids } = makeSim();
  const hud = new Hud(host, {
    sim,
    getSelection: () => [],
    getMission: () => m,
    hoverStructure: () => -1,
    hoverEntity: () => -1,
    gameVersion: '0.1',
    commander: TEST_COMMANDER,
    ...over,
  });
  const tick = (): void => hud.onTick();
  tick();
  return {
    hud,
    host,
    sim,
    ids,
    tick,
    strip: () => host.querySelector('.rl-strip')!.textContent!.replace(/\s+/g, ' ').trim(),
  };
}

describe('top strip', () => {
  it('stamps the hold clock beside the objective it belongs to', () => {
    const r = rig(mission());
    // `strip()` collapses runs of whitespace, so the clock's double space
    // between the time and the reason arrives as one.
    expect(r.strip()).toContain('☐ Hold the west 2:40 CONTESTED');
  });

  it('and the big clock says exactly the same thing — one derivation, two places', () => {
    const r = rig(mission());
    const big = r.host.querySelector<HTMLElement>('.rl-clock')!;
    expect(big.textContent).toBe('2:40  CONTESTED');
    expect(big.dataset.tone).toBe('bad');
    expect(big.classList.contains('rl-pulse')).toBe(true);
    expect(r.strip()).toContain(big.textContent!.replace(/\s+/g, ' '));
  });

  it('does not stamp a clock that belongs to a different objective', () => {
    // The strip shows the active PRIMARY; the only timed objective here is a
    // secondary. Its deadline is the big clock's, never the primary's.
    const r = rig(
      mission({
        objectives: [
          { id: 'take_town', text: 'Take the town', primary: true, status: 'active' },
          {
            id: 'evac',
            text: 'Evacuate',
            primary: false,
            status: 'active',
            ticksLeft: 90 * 20,
          },
        ],
      })
    );
    expect(r.strip()).toContain('☐ Take the town');
    expect(r.strip()).not.toContain('1:30');
    expect(r.host.querySelector('.rl-clock')!.textContent).toBe('1:30');
  });

  it('tone-colours ROE by the campaign gate it is heading for', () => {
    const roeClass = (n: number): string =>
      rig(mission({ roe: n })).host.querySelector('[data-roe]')!.className;
    expect(roeClass(95)).toBe('rl-good');
    expect(roeClass(70)).toBe('rl-warn');
    expect(roeClass(20)).toBe('rl-bad');
  });

  it('shows ⚑ broken and ▼ pinned only when there are some', () => {
    const r = rig(mission());
    expect(r.strip()).not.toContain('pinned');
    expect(r.strip()).not.toContain('broken');

    r.sim.state.pinned[r.ids[0]] = 1;
    r.sim.state.routed[r.ids[1]] = 1;
    r.sim.state.pinned[r.ids[1]] = 1; // the sim flags a routed unit pinned too
    for (let i = 0; i < 5; i++) r.tick(); // the rebuild is 4 Hz, not every tick
    expect(r.strip()).toContain('▼ 1 pinned');
    expect(r.strip()).toContain('⚑ 1 broken');
  });

  it('omits the secondary count when nothing secondary is open', () => {
    expect(rig(mission()).strip()).not.toContain('secondary');
    const two = rig(
      mission({
        objectives: [
          { id: 'p', text: 'Hold', primary: true, status: 'active' },
          { id: 's1', text: 'A', primary: false, status: 'active' },
          { id: 's2', text: 'B', primary: false, status: 'active' },
          { id: 's3', text: 'C', primary: false, status: 'complete' },
        ],
      })
    );
    expect(two.strip()).toContain('+2 secondary');
  });

  it('stamps logistics with its rate and intel as separate fields', () => {
    const r = rig(mission({ logistics: 410, logisticsRate: 120, intel: 40 }));
    expect(r.strip()).toContain('▣ 410 +120/min');
    expect(r.strip()).toContain('◎ 40');
  });

  it('drops the rate when the mission pays none, rather than printing +0/min', () => {
    expect(rig(mission({ logistics: 410, logisticsRate: 0 })).strip()).not.toContain('/min');
  });
});

describe('top strip: the persistent controls', () => {
  it('keeps its listeners across the 4 Hz rebuild that replaces the mission fields', () => {
    // This is the whole reason the strip is built in three runs. One innerHTML
    // over the lot would drop these listeners four times a second, and the
    // symptom is a pause button that works only if you click it fast enough.
    let speed = 1;
    const r = rig(mission(), {
      getSpeed: () => speed,
      setSpeed: (s: number) => {
        speed = s;
      },
    });
    for (let i = 0; i < 20; i++) r.tick(); // four full rebuilds
    const chips = r.host.querySelectorAll<HTMLButtonElement>('.rl-strip__chip');
    chips[0].click(); // pause
    expect(speed).toBe(0);
    expect(chips[0].dataset.on).toBe('1');
    expect(chips[1].dataset.on).toBe('0');
    chips[2].click(); // 2x
    expect(speed).toBe(2);
    expect(chips[2].dataset.on).toBe('1');
  });

  it('mirrors mute in both directions — the chip and the key are one state', () => {
    let muted = false;
    const r = rig(mission(), {
      isMuted: () => muted,
      toggleMute: () => {
        muted = !muted;
      },
    });
    const chip = r.host.querySelectorAll<HTMLButtonElement>('.rl-strip__chip')[3];
    expect(chip.dataset.on).toBe('1');
    chip.click();
    expect(muted).toBe(true);
    expect(chip.dataset.on).toBe('0');
    muted = false; // as if the `m` key had been pressed
    r.hud.paintMute();
    expect(chip.dataset.on).toBe('1');
  });

  it('offers the campaign map at all times, mid-mission included', () => {
    const a = rig(mission()).host.querySelector<HTMLAnchorElement>('.rl-strip__link')!;
    expect(a.getAttribute('href')).toBe('?campaign');
  });
});

describe('commander', () => {
  it('stays hidden for a mission with no briefing', () => {
    // Two ways to have no briefing: never handed one, and handed an empty one.
    // A mission whose `briefing` is absent takes the first path and every
    // sandbox takes the second, so both have to leave the portrait off screen
    // rather than parking an empty frame over the map corner.
    const r = rig(mission());
    const cmd = r.host.querySelector<HTMLElement>('.rl-cmd')!;
    expect(cmd.style.display).toBe('none');
    r.hud.brief([]);
    expect(cmd.style.display).toBe('none');
    expect(cmd.dataset.open).toBe('0');
  });

  it('opens on the first beat and pages without wrapping', () => {
    const r = rig(mission());
    r.hud.brief(['One.', 'Two.', 'Three.']);
    const cmd = r.host.querySelector<HTMLElement>('.rl-cmd')!;
    const who = (): string => r.host.querySelector('.rl-cmd__who')!.textContent!;
    const buttons = r.host.querySelectorAll<HTMLButtonElement>('.rl-cmd__page button');
    expect(cmd.style.display).toBe('');
    expect(cmd.dataset.open).toBe('1');
    expect(who()).toContain('1 / 3');
    expect(buttons[0].disabled).toBe(true);

    buttons[1].click();
    buttons[1].click();
    expect(who()).toContain('3 / 3');
    expect(buttons[1].disabled).toBe(true);
    buttons[1].click();
    expect(who()).toContain('3 / 3'); // clamped, not wrapped back to beat 1
  });

  it('folds to the portrait and reopens from it', () => {
    const r = rig(mission());
    r.hud.brief(['One.', 'Two.']);
    const cmd = r.host.querySelector<HTMLElement>('.rl-cmd')!;
    cmd.dataset.open = '0'; // as the dwell timer leaves it
    r.host.querySelector<HTMLElement>('.rl-cmd__face')!.click();
    expect(cmd.dataset.open).toBe('1');
  });

  it('a say line forces the bar visible and shows the speaker plate, even with no briefing at all', () => {
    const r = rig(mission()); // no brief() call -- no authored briefing
    const cmd = r.host.querySelector<HTMLElement>('.rl-cmd')!;
    expect(cmd.style.display).toBe('none');

    r.hud.say('idit', 'Contact on the west ridge.');

    expect(cmd.style.display).toBe('');
    expect(cmd.dataset.open).toBe('1');
    expect(r.host.querySelector('.rl-cmd__who')!.textContent).toBe('Zohar');
    expect(cmd.textContent).toContain('Contact on the west ridge.');
  });

  it('shows Shai and Idit by their own plates, and never looks a name up for the enemy', () => {
    const r = rig(mission());
    const who = (): string => r.host.querySelector('.rl-cmd__who')!.textContent!;

    r.hud.say('shai', 'Hold what you have.');
    expect(who()).toBe('Hammai');

    r.hud.say('net', 'Reinforcements are twelve minutes out.');
    expect(who()).toBe('NET');

    r.hud.say('enemy', 'We see you.');
    expect(who()).toBe('ENEMY');
  });

  it('stays ENEMY -- never the villain\'s name -- even once a face is resolved for him (storyline.md G18)', () => {
    const r = rig(mission(), { commander: TEST_COMMANDER_WITH_ENEMY });
    r.hud.say('enemy', 'We see you.');
    expect(r.host.querySelector('.rl-cmd__who')!.textContent).toBe('ENEMY');
  });

  it('◂/▸ keep stepping the underlying beat regardless of a say overlay, and paging dismisses it', () => {
    const r = rig(mission());
    r.hud.brief(['One.', 'Two.']);
    const cmd = r.host.querySelector<HTMLElement>('.rl-cmd')!;
    const who = (): string => r.host.querySelector('.rl-cmd__who')!.textContent!;
    const buttons = r.host.querySelectorAll<HTMLButtonElement>('.rl-cmd__page button');

    buttons[1].click(); // beat 2 / 2, the last one
    expect(who()).toContain('2 / 2');

    r.hud.say('net', 'Reinforcements are twelve minutes out.');
    expect(who()).toBe('NET');
    expect(cmd.dataset.open).toBe('1');
    // The paging buttons still reflect the BEAT position underneath the
    // overlay, not the say -- "keep the beat paging working" means this
    // never has to reason about which of the two is currently showing.
    expect(buttons[1].disabled).toBe(true); // already the last beat
    expect(buttons[0].disabled).toBe(false);

    buttons[0].click(); // pages away from the say, back to beat 1 / 2
    expect(who()).toContain('1 / 2');
  });
});

describe('commander portrait', () => {
  const face = (host: HTMLElement): HTMLImageElement =>
    host.querySelector<HTMLImageElement>('.rl-cmd__face-img')!;

  it('shows the hatch -- the image stays hidden -- when nobody on the roster has a portrait', () => {
    const r = rig(mission(), { commander: TEST_COMMANDER });
    r.hud.brief(['One.']);
    expect(face(r.host).hidden).toBe(true);
  });

  it("shows Shai's portrait while the bar is delivering his own beats", () => {
    const r = rig(mission(), { commander: TEST_COMMANDER_WITH_PORTRAITS });
    r.hud.brief(['One.', 'Two.']);
    const img = face(r.host);
    expect(img.hidden).toBe(false);
    expect(img.src).toContain('shai_hammai.png');
  });

  it("a say line from Idit swaps the face to hers, and paging back to a beat swaps it back to Shai's", () => {
    const r = rig(mission(), { commander: TEST_COMMANDER_WITH_PORTRAITS });
    r.hud.brief(['One.', 'Two.']);
    expect(face(r.host).src).toContain('shai_hammai.png');

    r.hud.say('idit', 'Contact on the west ridge.');
    expect(face(r.host).src).toContain('idit_zohar.png');

    // pageCommander's own doc comment: paging clears the say overlay, which
    // is how one is dismissed by hand -- the very next render should show
    // the beat paging landed on, face included.
    const buttons = r.host.querySelectorAll<HTMLButtonElement>('.rl-cmd__page button');
    buttons[1].click();
    expect(face(r.host).src).toContain('shai_hammai.png');
  });

  it('falls to the hatch for enemy, who is not a person on the roster', () => {
    const r = rig(mission(), { commander: TEST_COMMANDER_WITH_PORTRAITS });
    r.hud.say('enemy', 'We see you.');
    expect(face(r.host).hidden).toBe(true);
    expect(r.host.querySelector('.rl-cmd__face')!.classList.contains('rl-cmd__face--net')).toBe(
      false
    );
  });

  it('paints the brigade mark for net -- not the hatch, no <img> -- and restores Shai\'s portrait on his next beat', () => {
    const r = rig(mission(), { commander: TEST_COMMANDER_WITH_PORTRAITS });
    r.hud.brief(['One.', 'Two.']);
    expect(face(r.host).src).toContain('shai_hammai.png');

    r.hud.say('net', 'Reinforcements are twelve minutes out.');
    const frame = r.host.querySelector('.rl-cmd__face')!;
    expect(frame.classList.contains('rl-cmd__face--net')).toBe(true);
    expect(face(r.host).hidden).toBe(true);
    expect(face(r.host).hasAttribute('src')).toBe(false);
    expect(frame.querySelector('.rl-cmd__face-mark svg')).not.toBeNull();

    // Paging clears the say overlay the same way it does for Idit/enemy.
    const buttons = r.host.querySelectorAll<HTMLButtonElement>('.rl-cmd__page button');
    buttons[1].click();
    expect(r.host.querySelector('.rl-cmd__face')!.classList.contains('rl-cmd__face--net')).toBe(
      false
    );
    expect(face(r.host).src).toContain('shai_hammai.png');
  });

  it("an enemy say paints the front's villain face (G18), and Shai's next beat restores his own", () => {
    const r = rig(mission(), { commander: TEST_COMMANDER_WITH_ENEMY });
    r.hud.brief(['One.', 'Two.']);
    expect(face(r.host).src).toContain('shai_hammai.png');

    r.hud.say('enemy', 'We see you.');
    expect(face(r.host).hidden).toBe(false);
    expect(face(r.host).src).toContain('nadir_sahim.png');
    // The plate beside that face stays unnamed regardless of the resolved
    // portrait -- covered on its own in the `commander` describe above.
    expect(r.host.querySelector('.rl-cmd__who')!.textContent).toBe('ENEMY');

    // Paging clears the say overlay the same way it does for Idit above.
    const buttons = r.host.querySelectorAll<HTMLButtonElement>('.rl-cmd__page button');
    buttons[1].click();
    expect(face(r.host).src).toContain('shai_hammai.png');
  });

  it('falls back to the hatch when a resolved URL fails to load, rather than a broken-image glyph', () => {
    const r = rig(mission(), { commander: TEST_COMMANDER_WITH_PORTRAITS });
    r.hud.brief(['One.']);
    const img = face(r.host);
    expect(img.hidden).toBe(false);

    img.dispatchEvent(new Event('error'));
    expect(img.hidden).toBe(true);
    expect(img.getAttribute('src')).toBeNull();
  });
});

describe('bottom-centre controls hint', () => {
  it('shows while nothing is selected and hides once something is', () => {
    let sel: number[] = [];
    const r = rig(mission(), { getSelection: () => sel });
    const hint = r.host.querySelector<HTMLElement>('.rl-hint')!;
    expect(hint.style.display).toBe('');
    expect(hint.textContent).toContain('click/drag select');
    sel = [0];
    for (let i = 0; i < 5; i++) r.tick(); // the rebuild is 4 Hz, not every tick
    expect(hint.style.display).toBe('none');
  });
});

describe('event feed', () => {
  it('keeps four lines, newest first, and carries the tone as a class', () => {
    const r = rig(mission());
    for (const [text, tone] of [
      ['one', 'good'],
      ['two', 'bad'],
      ['three', 'warn'],
      ['four', 'info'],
      ['five', 'live'],
    ] as const) {
      r.hud.note(text, tone);
    }
    const feed = r.host.querySelector<HTMLElement>('.rl-feed')!;
    expect(feed.childElementCount).toBe(4);
    expect(feed.firstElementChild!.textContent).toBe('five');
    expect(feed.firstElementChild!.className).toContain('rl-live');
    expect([...feed.children].map((c) => c.textContent)).not.toContain('one');
  });

  it('carries no panel chrome — it is type on the map', () => {
    const r = rig(mission());
    r.hud.note('contact', 'bad');
    const line = r.host.querySelector('.rl-feed')!.firstElementChild!;
    expect(line.className).toContain('rl-onmap');
    expect(line.className).not.toContain('rl-panel');
  });
});

// ======================================================================
// The selection cluster (GH-153 slice 2)
//
// selection-model.test.ts proves the rules; this proves the JOIN — that the
// rules reach the DOM, that a button's click goes to the same function the
// hotkey calls, and that Tab moves something a player can see.
// ======================================================================

/** The spec's own state 2a: two rifle squads, one AT team, one Namer. */
function makeForce(): { sim: Sim; squads: number[]; at: number; namer: number } {
  const sim = new Sim({ seed: 1, width: 16, height: 16, capacity: 16 });
  const inf = sim.addUnitType(units.inf_squad as unknown as UnitTypeJson);
  const atT = sim.addUnitType(units.at_team as unknown as UnitTypeJson);
  const ifv = sim.addUnitType(units.ifv_namer as unknown as UnitTypeJson);
  const squads = [
    sim.spawn(inf, 0, fx.from(1), fx.from(1)),
    sim.spawn(inf, 0, fx.from(2), fx.from(1)),
  ];
  const at = sim.spawn(atT, 0, fx.from(3), fx.from(1));
  const namer = sim.spawn(ifv, 0, fx.from(4), fx.from(1));
  return { sim, squads, at, namer };
}

interface ClusterRig {
  hud: Hud;
  host: HTMLElement;
  sim: Sim;
  tick: () => void;
  chips: () => HTMLElement[];
  order: (id: string) => HTMLButtonElement | null;
  calls: string[];
  selected: number[][];
  queued: number;
}

function clusterRig(
  sel: () => number[],
  over: Partial<HudDeps> = {},
  world = makeForce()
): ClusterRig {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const calls: string[] = [];
  const selected: number[][] = [];
  const rigOut = { queued: 0 };
  const realQueue = world.sim.queueCommand.bind(world.sim);
  world.sim.queueCommand = (cmd) => {
    rigOut.queued++;
    realQueue(cmd);
  };
  const hud = new Hud(host, {
    sim: world.sim,
    getSelection: sel,
    getMission: () => null,
    hoverStructure: () => -1,
    hoverEntity: () => -1,
    gameVersion: '0.1',
    commander: TEST_COMMANDER,
    orders: {
      attackMove: () => calls.push('attackMove'),
      halt: () => calls.push('halt'),
      smoke: () => calls.push('smoke'),
      load: () => calls.push('load'),
      unload: () => calls.push('unload'),
    },
    portrait: (id) => (id === 'civilians' ? null : `/sprites/${id}/idle_f03_000.png`),
    setSelection: (ids) => selected.push(ids),
    ...over,
  });
  const tick = (): void => hud.onTick();
  tick();
  return {
    hud,
    host,
    sim: world.sim,
    tick,
    chips: () => [...host.querySelectorAll<HTMLElement>('.rl-chip')],
    order: (id) => host.querySelector<HTMLButtonElement>(`[data-order="${id}"]`),
    calls,
    selected,
    get queued() {
      return rigOut.queued;
    },
  };
}

describe('multi-select chips', () => {
  it('draws one chip per unit type, with the count and the name', () => {
    const world = makeForce();
    const r = clusterRig(() => [...world.squads, world.at, world.namer], {}, world);
    const chips = r.chips();
    expect(chips.map((c) => c.dataset.type)).toEqual(['inf_squad', 'at_team', 'ifv_namer']);
    expect(chips[0].textContent).toContain('Rifle Squad');
    expect(chips[0].textContent).toContain('×2');
    expect(chips[1].textContent).toContain('×1');
  });

  it('reports the sub-group’s health, not its first member’s', () => {
    const world = makeForce();
    const r = clusterRig(() => world.squads, {}, world);
    // Halve one of the two squads: the group is at 75%, the first member 100%.
    world.sim.state.hp[world.squads[1]] = world.sim.state.hp[world.squads[1]] / 2;
    for (let i = 0; i < 5; i++) r.tick();
    const fill = r.chips()[0].querySelector<HTMLElement>('.rl-track > i')!;
    expect(fill.style.width).toBe('75%');
    expect(fill.className).toBe('rl-fill-good');
  });

  it('frames one chip and moves the frame on Tab, wrapping', () => {
    const world = makeForce();
    const r = clusterRig(() => [...world.squads, world.at, world.namer], {}, world);
    const focused = (): number => r.chips().findIndex((c) => c.dataset.focus === '1');
    expect(focused()).toBe(0);
    expect(r.hud.cycleChipFocus()).toBe(true);
    expect(focused()).toBe(1);
    r.hud.cycleChipFocus();
    r.hud.cycleChipFocus();
    expect(focused()).toBe(0);
  });

  it('refuses to swallow Tab when there is nothing to cycle', () => {
    // main.ts only calls preventDefault when this returns true, so a false
    // here is what leaves the browser's own focus traversal alone.
    const world = makeForce();
    const r = clusterRig(() => [world.namer], {}, world);
    expect(r.hud.cycleChipFocus()).toBe(false);
  });

  it('puts the name in its own element so a long one ellipses', () => {
    // A 150px chip is narrower than several shipped unit names, and
    // `text-overflow` does nothing to a flex CONTAINER's own text — the name
    // has to be an element of its own or it is simply cut, which reads as a
    // truncated field rather than a long name.
    const world = makeForce();
    const r = clusterRig(() => [...world.squads, world.at], {}, world);
    const name = r.chips()[0].querySelector('.rl-chip__name')!;
    const inner = name.querySelector('span:not(.rl-badge)');
    expect(inner).not.toBeNull();
    expect(inner!.textContent).toBe('Rifle Squad');
  });

  it('narrows the selection to a sub-group when its chip is clicked', () => {
    const world = makeForce();
    const r = clusterRig(() => [...world.squads, world.at, world.namer], {}, world);
    r.chips()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(r.selected).toEqual([world.squads]);
  });

  it('drops a unit that has died rather than reporting a corpse', () => {
    const world = makeForce();
    const r = clusterRig(() => [...world.squads, world.at], {}, world);
    world.sim.state.alive[world.at] = 0;
    for (let i = 0; i < 5; i++) r.tick();
    expect(r.chips().map((c) => c.dataset.type)).toEqual(['inf_squad']);
  });
});

describe('the single-unit card', () => {
  it('names the unit, its armament and its capabilities in one 460px card', () => {
    const world = makeForce();
    const r = clusterRig(() => [world.namer], {}, world);
    const card = r.host.querySelector<HTMLElement>('.rl-card')!;
    expect(r.host.querySelector('.rl-chip')).toBeNull();
    expect(card.querySelector('.rl-card__name')!.textContent).toBe('Namer IFV');
    expect(card.textContent).toContain('Armament');
    expect(card.textContent).toContain('cannon_30');
    expect(card.textContent).toContain('Capabilities');
    expect(card.textContent).toContain('smoke screen');
  });

  it('keeps the condition line’s existing flags', () => {
    const world = makeForce();
    const r = clusterRig(() => [world.namer], {}, world);
    world.sim.state.pinned[world.namer] = 1;
    world.sim.state.moving[world.namer] = 1;
    for (let i = 0; i < 5; i++) r.tick();
    const cond = r.host.querySelector<HTMLElement>('.rl-card__cond')!;
    expect(cond.textContent).toContain('PINNED');
    expect(cond.textContent).toContain('moving');
  });

  it('hides the whole cluster when nothing is selected', () => {
    const world = makeForce();
    let sel: number[] = [world.namer];
    const r = clusterRig(() => sel, {}, world);
    expect(r.host.querySelector<HTMLElement>('.rl-sel')!.style.display).toBe('');
    sel = [];
    for (let i = 0; i < 5; i++) r.tick();
    expect(r.host.querySelector<HTMLElement>('.rl-sel')!.style.display).toBe('none');
  });
});

describe('unit art the pipeline has not produced', () => {
  it('draws the reserved hatch with the role mark, never an empty box', () => {
    // `civilians` is the one shipped type absent from SPRITE_MAP, and a left
    // click can select one. A bare 40px hole reads as a broken image.
    const world = makeForce();
    const r = clusterRig(() => [world.namer], { portrait: () => null }, world);
    const art = r.host.querySelector<HTMLElement>('.rl-card__art')!;
    expect(art.tagName).toBe('DIV');
    expect(art.dataset.nosprite).toBe('1');
    expect(art.querySelector('svg')).not.toBeNull();
    expect(art.title).toContain('no sprite sheet');
    expect(r.host.querySelector('.rl-card__art img')).toBeNull();
  });

  it('draws the unit’s own frame where there is one', () => {
    const world = makeForce();
    const r = clusterRig(() => [world.namer], {}, world);
    const art = r.host.querySelector<HTMLImageElement>('.rl-card__art')!;
    expect(art.tagName).toBe('IMG');
    expect(art.getAttribute('src')).toBe('/sprites/ifv_namer/idle_f03_000.png');
  });
});

describe('the order row', () => {
  it('offers only the orders the selection can give', () => {
    const world = makeForce();
    const r = clusterRig(() => world.squads, {}, world);
    // Rifle squads: no smoke, no transport.
    expect(r.order('attackMove')!.style.display).toBe('');
    expect(r.order('halt')!.style.display).toBe('');
    expect(r.order('smoke')!.style.display).toBe('none');
    expect(r.order('load')!.style.display).toBe('none');
    expect(r.order('unload')!.style.display).toBe('none');
  });

  it('shows an empty transport’s Unload dimmed rather than absent', () => {
    const world = makeForce();
    const r = clusterRig(() => [world.namer], {}, world);
    const unload = r.order('unload')!;
    expect(unload.style.display).toBe('');
    expect(unload.dataset.inert).toBe('1');
    // Dim, not disabled: the handler's own refusal note is the explanation,
    // and a disabled button explains nothing.
    expect(unload.disabled).toBe(false);
    unload.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(r.calls).toEqual(['unload']);
  });

  it('undims Unload the moment there is somebody aboard', () => {
    const world = makeForce();
    const r = clusterRig(() => [world.namer], {}, world);
    // Stand the squads on the Namer's kerb: boarding seats them only inside
    // LOAD_RANGE, and walking them there would be testing the pathfinder.
    for (const s of world.squads) {
      world.sim.state.posX[s] = world.sim.state.posX[world.namer];
      world.sim.state.posY[s] = world.sim.state.posY[world.namer];
    }
    world.sim.queueCommand({ kind: 'load', ids: world.squads, carrier: world.namer });
    world.sim.tick();
    expect(world.sim.passengerCount(world.namer)).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) r.tick();
    expect(r.order('unload')!.dataset.inert).toBe('0');
  });

  it('states the transport’s capacity beside Load, and only there', () => {
    const world = makeForce();
    const r = clusterRig(() => [world.namer], {}, world);
    expect(r.order('load')!.textContent).toContain('0/5');
    expect(r.order('unload')!.textContent).not.toContain('/');
  });

  it('dims Halt while nothing is under way', () => {
    const world = makeForce();
    const r = clusterRig(() => world.squads, {}, world);
    expect(r.order('halt')!.dataset.inert).toBe('1');
    world.sim.state.moving[world.squads[0]] = 1;
    for (let i = 0; i < 5; i++) r.tick();
    expect(r.order('halt')!.dataset.inert).toBe('0');
  });

  it('sends every button to the handler its key is bound to, and queues nothing itself', () => {
    // The whole contract of the row: `orders` is the object main.ts's keydown
    // listener calls, so a button and its key are one function. The HUD may
    // never construct a command of its own (invariant 4).
    const world = makeForce();
    const r = clusterRig(() => [world.namer], {}, world);
    for (const id of ['attackMove', 'halt', 'smoke', 'load', 'unload']) {
      r.order(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    expect(r.calls).toEqual(['attackMove', 'halt', 'smoke', 'load', 'unload']);
    expect(r.queued).toBe(0);
  });

  it('lights the armed order and only that one', () => {
    const world = makeForce();
    const r = clusterRig(() => [world.namer], { armedOrder: () => 'attackMove' }, world);
    expect(r.order('attackMove')!.dataset.armed).toBe('1');
    expect(r.order('halt')!.dataset.armed).toBe('0');
  });

  it('offers nothing at all for a selection of somebody else’s units', () => {
    // pickUnit does not filter by side — inspecting a contact is how a player
    // reads the battlefield — but no order in this row applies to one.
    const world = makeForce();
    const enemy = world.sim.spawn(
      world.sim.state.typeIdx[world.at],
      1,
      fx.from(9),
      fx.from(9)
    );
    const r = clusterRig(() => [enemy], {}, world);
    for (const id of ['attackMove', 'halt', 'smoke', 'load', 'unload']) {
      expect(r.order(id)!.style.display).toBe('none');
    }
    // The card still draws: the player asked what that thing is.
    expect(r.host.querySelector('.rl-card')).not.toBeNull();
  });
});

describe('victory banner', () => {
  it('appends the aftermath line to a victory, and never to a defeat', () => {
    const rVictory = rig(mission({ result: 'victory', aftermath: 'The town is quiet tonight.' }));
    const bannerV = rVictory.host.querySelector<HTMLElement>('.rl-bigbanner')!;
    expect(bannerV.querySelector('.rl-bigbanner__head')!.textContent).toBe('Mission accomplished');
    expect(bannerV.textContent).toContain('The town is quiet tonight.');

    // `mission.ts`'s own doc comment on `aftermath`: "Shown on the victory
    // banner." -- a defeat's retry prompt speaks for itself.
    const rDefeat = rig(mission({ result: 'defeat', aftermath: 'Should never show.' }));
    const bannerD = rDefeat.host.querySelector<HTMLElement>('.rl-bigbanner')!;
    expect(bannerD.querySelector('.rl-bigbanner__head')!.textContent).toBe('Mission failed');
    expect(bannerD.textContent).not.toContain('Should never show.');
  });

  it('shows the plain headline when the mission declares no aftermath', () => {
    const r = rig(mission({ result: 'victory' }));
    const banner = r.host.querySelector<HTMLElement>('.rl-bigbanner')!;
    expect(banner.querySelector('.rl-bigbanner__head')!.textContent).toBe('Mission accomplished');
    expect(banner.querySelector('.rl-bigbanner__aftermath')).toBeNull();
  });
});
