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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { units } from '@lions/data';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { Hud, type HudCommanderInfo, type HudDeps, type MissionView } from './hud';
import { alertNotice } from './mission-notice';
import { closeTip } from './tooltip';

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

  it('gives the CONTESTED hold clock the readable red in both places it is drawn', () => {
    const r = rig(mission());
    const big = r.host.querySelector<HTMLElement>('.rl-clock')!;
    expect(big.className.split(/\s+/)).toContain('rl-plate');
    const inline = r.host.querySelector<HTMLElement>('[data-obj="hold_west"] b')!;
    const classes = inline.className.split(/\s+/);
    expect(classes).toContain('rl-bad-text');
    expect(classes).not.toContain('rl-bad');
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

  it('marks a failed primary with the readable red, not the fill-only one', () => {
    const r = rig(
      mission({
        objectives: [{ id: 'hold_west', text: 'Hold the west', primary: true, status: 'failed' }],
      })
    );
    const obj = r.host.querySelector<HTMLElement>('[data-obj="hold_west"]')!;
    expect(obj.className).toContain('rl-bad-text');
  });

  it('tone-colours ROE by the campaign gate it is heading for', () => {
    const roeClass = (n: number): string =>
      rig(mission({ roe: n })).host.querySelector('[data-roe]')!.className;
    expect(roeClass(95)).toBe('rl-good');
    expect(roeClass(70)).toBe('rl-warn');
    expect(roeClass(20)).toBe('rl-bad');
  });

  // Task 7: this used to be a bare `title=`, which a touch player and a
  // keyboard user could never reach. `data-tip="conduct"` is delegated on
  // `this.strip` (`bindDelegatedTip`, not one bound per field, since the
  // strip is innerHTML'd at 4 Hz), so a real hover event -- bubbled, the way
  // a browser's own would be -- has to reach `.rl-tip` for the definition to
  // show at all.
  it('labels the figure Conduct, never ROE, and defines it on hover', () => {
    const r = rig(mission({ roe: 95 }));
    expect(r.strip()).toContain('95 Conduct');
    expect(r.strip()).not.toContain('ROE');
    const figure = r.host.querySelector<HTMLElement>('[data-tip="conduct"]')!;
    expect(figure.querySelector('[data-roe]')).not.toBeNull();
    expect(figure.hasAttribute('title')).toBe(false);
    figure.dispatchEvent(new Event('mouseover', { bubbles: true }));
    const tip = r.host.querySelector<HTMLElement>('.rl-tip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('how cleanly you fight');
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

  // Task 7: Logistics, Intel, Pinned and Broken -- the strip's four other
  // fields never had a `title` at all, and each is a state a player sees
  // before they have a name for it. All four are delegated on the SAME
  // `this.strip` listener as Conduct above, so one hover call proves the
  // whole set rather than just the first one bound.
  it('explains logistics, intel, pinned and broken on hover, with none of them a bare title', () => {
    const r = rig(mission({ logistics: 410, logisticsRate: 120, intel: 40 }));
    r.sim.state.pinned[r.ids[0]] = 1;
    r.sim.state.routed[r.ids[1]] = 1;
    r.sim.state.pinned[r.ids[1]] = 1;
    for (let i = 0; i < 5; i++) r.tick();

    const hover = (sel: string): string => {
      const el = r.host.querySelector<HTMLElement>(sel)!;
      expect(el.hasAttribute('title')).toBe(false);
      el.dispatchEvent(new Event('mouseover', { bubbles: true }));
      return r.host.querySelector<HTMLElement>('.rl-tip')!.textContent!;
    };
    expect(hover('[data-tip="logistics"]')).toContain('spent to build reinforcements');
    expect(hover('[data-tip="logistics"]')).toContain('120 more a minute');
    expect(hover('[data-tip="intel"]')).toContain('fire support');
    expect(hover('[data-tip="pinned"]')).toContain('suppressed');
    expect(hover('[data-tip="broken"]')).toContain('routed');
  });

  // Fix round 1, I1: `renderStrip` replaces `[data-tip="logistics"]` wholesale
  // every 4 Hz repaint, with no event of its own -- a tip shown for the OLD
  // node used to freeze on the rate it read at the moment of the hover and
  // never move again, however long the mouse sat still over it.
  it('keeps a shown tooltip live across the 4 Hz rebuild instead of freezing it', () => {
    const m = mission({ logistics: 400, logisticsRate: 100, intel: 20 });
    const r = rig(m);
    const tipText = (): string => r.host.querySelector<HTMLElement>('.rl-tip')!.textContent!;
    r.host
      .querySelector<HTMLElement>('[data-tip="logistics"]')!
      .dispatchEvent(new Event('mouseover', { bubbles: true }));
    expect(tipText()).toContain('100 more a minute');

    // The rate changes and the strip repaints at 4 Hz -- no new hover.
    m.logisticsRate = 250;
    for (let i = 0; i < 5; i++) r.tick();
    expect(tipText()).toContain('250 more a minute');
    expect(r.host.querySelector<HTMLElement>('.rl-tip')?.hidden).toBe(false);
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

  // Task 6: the pause menu calls `hud.paintSpeed()` directly (it is public
  // now) from `main.ts`'s own `pause`/`resume`, since at `paused` no tick
  // ever comes to repaint it otherwise -- the same reason a speed-chip click
  // already repaints itself inline, above.
  it('dims the speed cluster while paused, distinct from a deliberate 0x hold', () => {
    let paused = false;
    const r = rig(mission(), { getSpeed: () => 1, isPaused: () => paused });
    const cluster = r.host.querySelector<HTMLElement>('.rl-strip__chips')!;
    expect(cluster.dataset.paused).toBe('0');
    paused = true;
    r.hud.paintSpeed();
    expect(cluster.dataset.paused).toBe('1');
    paused = false;
    r.hud.paintSpeed();
    expect(cluster.dataset.paused).toBe('0');
  });

  it('offers to leave the mission at all times, mid-mission included -- confirmed, not a plain navigation', async () => {
    let left = false;
    const r = rig(mission(), { leave: () => { left = true; } });
    const btn = r.host.querySelector<HTMLButtonElement>('.rl-strip__link')!;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toContain('leave');
    btn.click();
    // Confirmed first: clicking the strip control alone must not navigate.
    expect(left).toBe(false);
    const dialog = document.body.querySelector<HTMLElement>('.rl-confirm')!;
    expect(dialog).not.toBeNull();
    dialog.querySelector<HTMLButtonElement>('.rl-confirm__yes')!.click();
    await Promise.resolve();
    expect(left).toBe(true);
  });

  it('sits leftmost in the strip -- the one control here that ends the attempt, not one of the instruments', () => {
    const r = rig(mission());
    expect(r.host.querySelector('.rl-strip')!.firstElementChild?.classList.contains('rl-strip__link')).toBe(true);
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
  // Task 9: the line used to hide the instant anything was selected -- the
  // opposite of what a new player needs. `renderHint` no longer hides it for
  // any reason; a HUD with no `hint` dep wired (every other rig in this file)
  // falls back to the plain controls line, unconditionally, which is "today's
  // behaviour" for a dep every OTHER test here still omits.
  it('shows the plain controls line, with or without a selection, when no hint dep is wired', () => {
    let sel: number[] = [];
    const r = rig(mission(), { getSelection: () => sel });
    const hint = r.host.querySelector<HTMLElement>('.rl-hint')!;
    expect(hint.style.display).toBe('');
    expect(hint.className).toContain('rl-plate');
    expect(hint.textContent).toContain('click/drag select');
    sel = [0];
    for (let i = 0; i < 5; i++) r.tick(); // the rebuild is 4 Hz, not every tick
    // The inversion this task exists for: still on screen, still saying
    // something, with a selection.
    expect(hint.style.display).toBe('');
    expect(hint.textContent).toContain('click/drag select');
  });

  it('prints whatever the hint dep returns, selection or not', () => {
    const r = rig(mission(), { getSelection: () => [0], hint: () => ({ key: 'hud.hint.selected' }) });
    const hint = r.host.querySelector<HTMLElement>('.rl-hint')!;
    expect(hint.style.display).toBe('');
    expect(hint.textContent).toContain('order row above');
  });

  // hint-model.test.ts pins the priority order itself; this is the one thing
  // only the DOM join can prove -- `hintFor` never sees a keybinding, so the
  // dock hint's key name has to be merged in here, from `keyFor`, the same
  // way the order row's own key caps are.
  it('names the CURRENT key for the dock hint, through keyFor -- never a literal letter', () => {
    const r = rig(mission(), {
      hint: () => ({ key: 'hud.hint.dock' }),
      keyFor: (action) => (action === 'production' ? 'J' : action),
    });
    const hint = r.host.querySelector<HTMLElement>('.rl-hint')!;
    expect(hint.textContent).toBe('press J to open the reinforcements dock and call in support');
  });

  it('falls back to the raw action id for the dock hint when keyFor is absent', () => {
    const r = rig(mission(), { hint: () => ({ key: 'hud.hint.dock' }) });
    const hint = r.host.querySelector<HTMLElement>('.rl-hint')!;
    expect(hint.textContent).toContain('press production to open');
  });

  it('the hint stacks under the feed inside the cluster', () => {
    const r = rig(mission());
    const sel = r.host.querySelector<HTMLElement>('.rl-sel')!;
    expect(sel.lastElementChild?.classList.contains('rl-hint')).toBe(true);
  });
});

describe('projected fire: taught once, after it has actually shown', () => {
  /** A rig with a knob for whether the panel is visible this tick, and a
   *  count of how many times `onProjectedFireShown` fired -- `contentTick`
   *  drives `onTick` five times, since `renderFire` only actually runs on
   *  every FIFTH call (the 4Hz throttle `onTick`'s own comment explains),
   *  so "three consecutive HUD ticks" means three consecutive CONTENT
   *  ticks, not three raw `onTick` calls. */
  function fireRig(): { setVisible: (v: boolean) => void; shownCount: () => number; contentTick: () => void } {
    let visible = false;
    let shownCount = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { sim, ids } = makeSim();
    const hud = new Hud(host, {
      sim,
      getSelection: () => (visible ? [ids[0]] : []),
      getMission: () => null,
      hoverStructure: () => -1,
      hoverEntity: () => (visible ? ids[1] : -1),
      gameVersion: '0.1',
      commander: TEST_COMMANDER,
      onProjectedFireShown: () => {
        shownCount++;
      },
    });
    const contentTick = (): void => {
      for (let i = 0; i < 5; i++) hud.onTick();
    };
    return { setVisible: (v) => (visible = v), shownCount: () => shownCount, contentTick };
  }

  it('is not learned from a two-tick glimpse, only from a three-tick hold, and re-learnable after a gap', () => {
    const r = fireRig();
    r.setVisible(true);
    r.contentTick(); // streak 1
    r.contentTick(); // streak 2
    expect(r.shownCount()).toBe(0);
    r.contentTick(); // streak 3 -- the streak this task exists to teach from
    expect(r.shownCount()).toBe(1);
    r.contentTick(); // streak 4 -- once per streak, not once per tick after
    expect(r.shownCount()).toBe(1);

    r.setVisible(false);
    r.contentTick(); // hidden: the streak resets to 0
    expect(r.shownCount()).toBe(1);

    r.setVisible(true);
    r.contentTick(); // streak 1
    r.contentTick(); // streak 2
    expect(r.shownCount()).toBe(1);
    r.contentTick(); // streak 3 again -- a second, independent streak
    expect(r.shownCount()).toBe(2);
  });

  it('never calls the dep at all when it is absent -- a HUD built without it behaves as before', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { sim, ids } = makeSim();
    const hud = new Hud(host, {
      sim,
      getSelection: () => [ids[0]],
      getMission: () => null,
      hoverStructure: () => -1,
      hoverEntity: () => ids[1],
      gameVersion: '0.1',
      commander: TEST_COMMANDER,
    });
    // No onProjectedFireShown -- five full content ticks, well past the
    // streak, must not throw on the missing optional dep.
    expect(() => {
      for (let i = 0; i < 25; i++) hud.onTick();
    }).not.toThrow();
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
    expect(line.className).toContain('rl-plate');
    expect(line.className).not.toContain('rl-panel');
  });

  it('gives a bad-tone notice the readable red -- it sits on the same rl-plate the fill-only red measures 4.01:1 on', () => {
    const r = rig(mission());
    r.hud.note('contact', 'bad');
    const line = r.host.querySelector('.rl-feed')!.firstElementChild!;
    const classes = line.className.split(/\s+/);
    expect(classes).toContain('rl-bad-text');
    expect(classes).not.toContain('rl-bad');
  });

  it('stacks the feed above the selection cluster instead of over it', () => {
    const r = rig(mission());
    const feed = r.host.querySelector('.rl-feed');
    expect(feed?.parentElement?.classList.contains('rl-sel')).toBe(true);
    expect(feed?.parentElement?.firstElementChild).toBe(feed);
  });

  it('a notice stays visible with nothing selected', () => {
    // review finding (task-5 fix round 1): .rl-sel used to be hidden
    // wholesale whenever nothing was selected -- the default state, and true
    // for most of a mission -- which took the feed down with it. .rl-sel
    // itself must never be display:none; only the order row and the card
    // hide.
    const r = rig(mission()); // default getSelection: () => []
    r.hud.note('contact', 'live');
    r.tick();
    const sel = r.host.querySelector<HTMLElement>('.rl-sel')!;
    expect(sel.style.display).not.toBe('none');
    const notice = sel.querySelector('.rl-notice');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toBe('contact');
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

  it('gives a BROKEN chip status the readable red -- this chip sits on the same rl-plate background as the notice/strip', () => {
    const world = makeForce();
    const r = clusterRig(() => world.squads, {}, world);
    world.sim.state.routed[world.squads[0]] = 1;
    for (let i = 0; i < 5; i++) r.tick();
    const status = r.chips()[0].querySelector<HTMLElement>('.rl-chip__status')!;
    expect(status.textContent).toContain('BROKEN');
    const classes = status.className.split(/\s+/);
    expect(classes).toContain('rl-bad-text');
    expect(classes).not.toContain('rl-bad');
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

  it('puts the name in its own element so a long one can wrap without cutting', () => {
    // A 150px chip is narrower than several shipped unit names. Task 7 widened
    // `--chip-w` and let this span wrap instead of ellipsising (theme.css's
    // own `.rl-chip__name > span`, pinned below), but the name still has to
    // be an element of its own for either rule to have anything to act on —
    // `text-overflow`/wrapping does nothing to a flex CONTAINER's own text.
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

  // Task 7: `title` used to carry the name; it is a bound tip now, delegated
  // on `this.cluster` (`bindDelegatedTip`) since the chip row is innerHTML'd
  // at 4 Hz the same way the strip is. `mouseover` (not `mouseenter`, which
  // does not bubble) dispatched on a descendant proves the delegation, not
  // merely a listener on the chip itself.
  it('names the unit and its count in a real tooltip, not a bare title', () => {
    const world = makeForce();
    const r = clusterRig(() => [...world.squads, world.at, world.namer], {}, world);
    const chip = r.chips()[0];
    expect(chip.hasAttribute('title')).toBe(false);
    chip.querySelector('.rl-chip__name > span')!.dispatchEvent(new Event('mouseover', { bubbles: true }));
    const tip = r.host.querySelector<HTMLElement>('.rl-tip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('Rifle Squad');
    expect(tip.textContent).toContain('×2');
  });

  // Fix round 1, I1: `renderChips` replaces every `.rl-chip` wholesale each
  // 4 Hz repaint, with no event of its own -- a tip shown for the OLD chip
  // used to freeze at the count it read on hover, however long the mouse
  // sat still, and however many of the group then died.
  it('keeps a shown chip tooltip live across the 4 Hz rebuild instead of freezing it', () => {
    const world = makeForce();
    // Three selected (two rifle squads, one AT team) so the group still has
    // more than one member once the first drops -- otherwise `renderCard`
    // takes the single-unit CARD path instead, which is a different bug.
    const r = clusterRig(() => [...world.squads, world.at], {}, world);
    const tipText = (): string => r.host.querySelector<HTMLElement>('.rl-tip')!.textContent!;
    r.chips()[0]
      .querySelector('.rl-chip__name > span')!
      .dispatchEvent(new Event('mouseover', { bubbles: true }));
    expect(tipText()).toContain('×2');

    // One squad falls: the group's count drops to one, the chip row
    // rebuilds at 4 Hz with a brand-new node for the same type, and no new
    // mouse event fires.
    world.sim.state.alive[world.squads[1]] = 0;
    for (let i = 0; i < 5; i++) r.tick();
    expect(tipText()).toContain('×1');
    expect(r.host.querySelector<HTMLElement>('.rl-tip')?.hidden).toBe(false);
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

  it('paints a veteran’s stripe as a commendation, never as a caution', () => {
    // The stripe is earned, not a warning, and `--commend` exists so a reward
    // never borrows the caution colour. The card is the one place the stripe
    // is drawn for a single unit, and it wore `rl-warn` until 2026-09-11 --
    // the same red-amber that means "collateral risk: heavy" two lines up.
    const world = makeForce();
    const r = clusterRig(() => [world.namer], {}, world);
    world.sim.state.veterancy[world.namer] = 2;
    for (let i = 0; i < 5; i++) r.tick();
    const card = r.host.querySelector<HTMLElement>('.rl-card')!;
    const stripe = card.querySelector('.rl-commend')!;
    expect(stripe.textContent).toBe('★★');
    expect(card.querySelector('.rl-warn')).toBeNull();
  });

  it('hides the order row and the card, never the whole .rl-sel stack, when nothing is selected', () => {
    // .rl-sel is the bottom-centre stack that also holds the feed and the
    // hint -- hiding it wholesale (the old behaviour) took the feed down
    // with it any time nothing was selected, which is most of a mission.
    // Only the order row and the card/chips body go away now.
    const world = makeForce();
    let sel: number[] = [world.namer];
    const r = clusterRig(() => sel, {}, world);
    expect(r.host.querySelector<HTMLElement>('.rl-sel')!.style.display).not.toBe('none');
    sel = [];
    for (let i = 0; i < 5; i++) r.tick();
    expect(r.host.querySelector<HTMLElement>('.rl-sel')!.style.display).not.toBe('none');
    expect(r.host.querySelector<HTMLElement>('.rl-orders')!.style.display).toBe('none');
    expect(r.host.querySelector<HTMLElement>('.rl-cluster')!.style.display).toBe('none');
  });

  it('names a unit drawn from the roster and shows its service record on the card', () => {
    const world = makeForce();
    const r = clusterRig(
      () => [world.namer],
      {
        rosterEntryOf: (id) =>
          id === world.namer
            ? { type: 'inf_squad', veterancy: 2, name: 'Sela', missions: 3, kills: 4 }
            : undefined,
      },
      world
    );
    const card = r.host.querySelector<HTMLElement>('.rl-card')!;
    expect(card.querySelector('.rl-card__callsign')?.textContent).toBe('Sela');
    expect(card.querySelector('.rl-card__record')?.textContent).toBe('3 missions · 4 kills');
  });

  it('reads the singular for exactly one mission and one kill -- both plurals, independently', () => {
    const world = makeForce();
    const r = clusterRig(
      () => [world.namer],
      {
        rosterEntryOf: (id) =>
          id === world.namer
            ? { type: 'inf_squad', veterancy: 0, name: 'Dror', missions: 1, kills: 1 }
            : undefined,
      },
      world
    );
    const card = r.host.querySelector<HTMLElement>('.rl-card')!;
    expect(card.querySelector('.rl-card__record')?.textContent).toBe('1 mission · 1 kill');
  });

  it('shows the callsign alone for a named unit that carries no record', () => {
    // An old save's entry: named on a victory before `missions`/`kills` were
    // written at all, and never fielded since. The callsign is still its name
    // and must show; "0 missions - 0 kills" would be a fact nobody recorded.
    const world = makeForce();
    const r = clusterRig(
      () => [world.namer],
      { rosterEntryOf: (id) => (id === world.namer ? { type: 'inf_squad', veterancy: 0, name: 'Keshet' } : undefined) },
      world
    );
    const card = r.host.querySelector<HTMLElement>('.rl-card')!;
    expect(card.querySelector('.rl-card__callsign')?.textContent).toBe('Keshet');
    expect(card.querySelector('.rl-card__record')).toBeNull();
  });

  it('a fresh unit has no callsign and no record line', () => {
    const world = makeForce();
    const r = clusterRig(() => [world.namer], { rosterEntryOf: () => undefined }, world);
    const card = r.host.querySelector<HTMLElement>('.rl-card')!;
    expect(card.querySelector('.rl-card__callsign')).toBeNull();
    expect(card.querySelector('.rl-card__record')).toBeNull();
  });

  // Shell upgrade Phase 3, Task 10 moved the card's escaper into
  // `escape-html.ts`. The callsign escape it re-points had no test of its own
  // until then -- deleting it left this whole file green.
  it('shows an entity-shaped callsign as the characters it was given', () => {
    const world = makeForce();
    const r = clusterRig(
      () => [world.namer],
      { rosterEntryOf: (id) => (id === world.namer ? { type: 'inf_squad', veterancy: 0, name: 'Fish &amp; Chips' } : undefined) },
      world
    );
    expect(r.host.querySelector('.rl-card__callsign')?.textContent).toBe('Fish &amp; Chips');
  });
});

describe('the card\'s service record — whose place this is', () => {
  it('names the predecessor when this unit took a vacant slot', () => {
    const world = makeForce();
    const r = clusterRig(
      () => [world.namer],
      {
        rosterEntryOf: (id) =>
          id === world.namer ? { type: 'inf_squad', veterancy: 1, name: 'Gilad', missions: 1, kills: 0, slot: 7 } : undefined,
        predecessorOf: (slot) => (slot === 7 ? { name: 'Barkai', type: 'inf_squad' } : undefined),
      },
      world
    );
    const card = r.host.querySelector<HTMLElement>('.rl-card')!;
    expect(card.querySelector('.rl-card__replaces')?.textContent).toContain('Barkai');
  });

  // Do not regress the plain record line: a unit that has always held its own
  // place is the common case and must gain nothing.
  it('shows nothing extra for a unit whose slot has no history', () => {
    const world = makeForce();
    const r = clusterRig(
      () => [world.namer],
      {
        rosterEntryOf: (id) =>
          id === world.namer ? { type: 'inf_squad', veterancy: 0, name: 'Gilad', missions: 1, kills: 0, slot: 7 } : undefined,
        predecessorOf: () => undefined,
      },
      world
    );
    const card = r.host.querySelector<HTMLElement>('.rl-card')!;
    expect(card.querySelector('.rl-card__replaces')).toBeNull();
    expect(card.querySelector('.rl-card__record')?.textContent).toBe('1 mission · 0 kills');
  });

  // A fresh spawn has no ledger entry at all (`drawn = [null]`, mission.ts:1264),
  // so there is no slot to look up and the lookup must not be attempted with
  // `undefined`.
  it('shows nothing for a fresh spawn with no roster entry', () => {
    const world = makeForce();
    const r = clusterRig(
      () => [world.namer],
      {
        rosterEntryOf: () => undefined,
        predecessorOf: () => {
          throw new Error('must not be called');
        },
      },
      world
    );
    const card = r.host.querySelector<HTMLElement>('.rl-card')!;
    expect(card.querySelector('.rl-card__replaces')).toBeNull();
  });

  it('escapes a predecessor\'s name like every other name on the card', () => {
    const world = makeForce();
    const r = clusterRig(
      () => [world.namer],
      {
        rosterEntryOf: (id) => (id === world.namer ? { type: 'inf_squad', veterancy: 0, slot: 7 } : undefined),
        predecessorOf: () => ({ name: '<img src=x onerror=1>', type: 'inf_squad' }),
      },
      world
    );
    const card = r.host.querySelector<HTMLElement>('.rl-card')!;
    expect(card.querySelector('.rl-card__replaces img')).toBeNull();
  });

  // jsdom computes no stylesheet, so -- the same disk-read shape "the chip
  // name slot" below uses for its own rule -- this reads `theme.css` back off
  // disk rather than asking a computed style for a rule no rendering engine
  // here applies.
  //
  // Falsified by hand: dropping `.rl-card__replaces` from the grouped
  // selector (leaving `.rl-card__record` alone) turns this red.
  it('sizes the replaces line the same as the record line above it', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/app/src/ui/theme.css'), 'utf8');
    let found = false;
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = rule[1]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(',')
        .map((s) => s.trim());
      if (!selectors.includes('.rl-card__replaces')) continue;
      found = true;
      const fontSize = /font-size\s*:\s*([^;]+);/.exec(rule[2]);
      expect(fontSize?.[1].trim()).toBe('var(--t-s)');
    }
    // A selector that stopped matching (a rename, a merge into another rule)
    // would otherwise report zero offenders forever.
    expect(found).toBe(true);
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

describe('data-icon: telling a cropped unit icon from a sheet frame', () => {
  it('marks the art data-icon="1" when the deps say this picture is a cropped icon', () => {
    const world = makeForce();
    const r = clusterRig(
      () => [world.namer],
      { portraitIsIcon: (id) => id === 'ifv_namer' },
      world
    );
    const art = r.host.querySelector<HTMLImageElement>('.rl-card__art')!;
    expect(art.dataset.icon).toBe('1');
  });

  it('leaves data-icon unset for an ordinary sheet frame', () => {
    const world = makeForce();
    // No `portraitIsIcon` at all -- the same as every caller before this
    // feature existed, and the same as a type whose picture came from the
    // sheet-frame fallback.
    const r = clusterRig(() => [world.namer], {}, world);
    const art = r.host.querySelector<HTMLImageElement>('.rl-card__art')!;
    expect(art.dataset.icon).toBeUndefined();
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

  it('prints the CURRENT keycap for a rebound order, through keyFor', () => {
    // `ORDERS[].key` carries an action id ('halt'), not a letter -- this is
    // what proves the row asks `keyFor` for the label instead of printing the
    // id itself, so a rebind (Task 5) changes the button along with the key.
    const world = makeForce();
    const r = clusterRig(
      () => [world.namer],
      { keyFor: (action) => (action === 'halt' ? 'J' : action) },
      world
    );
    expect(r.order('halt')!.textContent).toContain('J');
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

  // Task 7: `btn.title` is gone -- every order button is bound once, directly
  // (`bindTip`, not delegated: the row is built once and only repainted), so
  // a plain `mouseenter` on the button itself is enough to show it.
  it('explains what the order does in a real tooltip, not a bare title', () => {
    const world = makeForce();
    const r = clusterRig(() => world.squads, {}, world);
    const btn = r.order('attackMove')!;
    expect(btn.hasAttribute('title')).toBe(false);
    btn.dispatchEvent(new Event('mouseenter'));
    const tip = r.host.querySelector<HTMLElement>('.rl-tip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('Attack-move');
    expect(tip.textContent).toContain('engaging anything in the way');
  });

  it('says why an inert order would do nothing, in the same tooltip', () => {
    const world = makeForce();
    const r = clusterRig(() => [world.namer], {}, world);
    const btn = r.order('unload')!;
    expect(btn.dataset.inert).toBe('1');
    btn.dispatchEvent(new Event('mouseenter'));
    const tip = r.host.querySelector<HTMLElement>('.rl-tip')!;
    expect(tip.textContent).toContain('Step out of the transport');
    expect(tip.textContent).toContain('nothing in the selection would act on it right now');
  });

  it('drops the inert reason once the order stops being inert', () => {
    const world = makeForce();
    const r = clusterRig(() => [world.namer], {}, world);
    for (const s of world.squads) {
      world.sim.state.posX[s] = world.sim.state.posX[world.namer];
      world.sim.state.posY[s] = world.sim.state.posY[world.namer];
    }
    world.sim.queueCommand({ kind: 'load', ids: world.squads, carrier: world.namer });
    world.sim.tick();
    for (let i = 0; i < 5; i++) r.tick();
    const btn = r.order('unload')!;
    expect(btn.dataset.inert).toBe('0');
    btn.dispatchEvent(new Event('mouseenter'));
    const tip = r.host.querySelector<HTMLElement>('.rl-tip')!;
    expect(tip.textContent).not.toContain('nothing in the selection would act on it right now');
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

/** The HUD mounts on `document.body` in the real app, not on the stage the
 *  router clears -- so leaving a mission softly means the HUD has to take
 *  itself off. These two mount on the body deliberately, rather than through
 *  `rig()`'s scratch host, because "the body is back where it started" is the
 *  actual claim. */
describe('destroy', () => {
  const bodyHud = (): Hud =>
    new Hud(document.body, {
      sim: makeSim().sim,
      getSelection: () => [],
      getMission: () => null,
      hoverStructure: () => -1,
      hoverEntity: () => -1,
      gameVersion: '0.1',
      commander: TEST_COMMANDER,
    });

  it('removes everything it put on the body, and can be called twice', () => {
    const before = document.body.children.length;
    const hud = bodyHud();
    expect(document.body.children.length).toBeGreaterThan(before);
    hud.destroy();
    expect(document.body.children.length).toBe(before);
    // Idempotent: a stale battlefield mount resolving onto an already-aborted
    // route runs its disposer after the teardown that aborted it.
    hud.destroy();
    expect(document.body.children.length).toBe(before);
  });

  // `announce` mounts a title card that holds for up to five seconds and
  // registers two window listeners and a timer to dismiss itself. Leaving a
  // mission inside that window stranded all three on the document, because
  // `announce` discarded the dismisser `titleCard` hands back.
  it('takes a mid-hold title card down with it', () => {
    const before = document.body.children.length;
    const hud = bodyHud();
    hud.announce('Beit Sahwan II', '2 primary objective(s)', 'Move out.');
    expect(document.body.querySelector('.rl-titlecard')).not.toBeNull();
    hud.destroy();
    expect(document.body.querySelector('.rl-titlecard')).toBeNull();
    expect(document.body.children.length).toBe(before);
  });

  // fix round 1: `destroy()` used to sweep `.rl-titlecard` off `this.host`,
  // which in the real app is `document.body` -- a host other screens mount on
  // too. It now removes the card `announce` itself created, by reference, so a
  // card that is not this HUD's is none of its business.
  it('removes only the card it created, not every title card on the host', () => {
    const foreign = document.createElement('div');
    foreign.className = 'rl-titlecard';
    foreign.dataset.owner = 'someone-else';
    document.body.appendChild(foreign);

    const hud = bodyHud();
    hud.announce('Beit Sahwan II', '2 primary objective(s)');
    expect(document.body.querySelectorAll('.rl-titlecard').length).toBe(2);
    hud.destroy();

    const left = document.body.querySelectorAll<HTMLElement>('.rl-titlecard');
    expect(left.length).toBe(1);
    expect(left[0].dataset.owner).toBe('someone-else');
    foreign.remove();
  });

  // Task 7 fix round 1 (minor a): `production.test.ts` already proves this
  // for the dock's tip; this is the HUD's own equivalent, mirrored for the
  // same reason -- `Element.remove()` on `this.roots` cannot reach the
  // shared tooltip's Escape listener on `window`, which is why `destroy()`
  // runs `tipDisposers` explicitly first.
  it('releases its tooltip even mid-hover, leaving no window listener behind', () => {
    // Fix wave I2: `not.toThrow()` used to be the whole assertion here, and
    // dispatching a keydown never throws whether or not anything is still
    // listening for it -- this test could not have caught the mutation it
    // is now named for (dropping `hide()` from `bindTip`'s disposer). It now
    // spies on the shared listener itself. `closeTip()` first, because
    // `tooltip.ts`'s Escape listener is a single MODULE-level singleton
    // shared by every host in this file -- an earlier suite's hover left
    // open (nothing else in this file calls `closeTip`) would otherwise
    // mean `escBound` is already true before this test's own hover runs, so
    // the `addEventListener` call below would never happen and there would
    // be no call to find.
    closeTip();

    // Other suites in this file mount a `Hud` on their own scratch `host`
    // and never destroy it (only this describe block cares to), so
    // `document.body` carries other Huds' order buttons and tips by the
    // time this runs -- a plain `document.body.querySelector` would as
    // easily find one of THOSE. The six elements `bodyHud`'s constructor
    // appends (`roots.push(strip, cmd, clock, sel, fire, banner)`) are what
    // scope every query below to THIS Hud alone, the same way `rig()`'s own
    // `host` scopes its -- the order button lives under `sel`, the tip's
    // host is `strip`, so both have to be searched.
    const before = document.body.children.length;
    const hud = bodyHud();
    const roots = [...document.body.children].slice(before, before + 6) as HTMLElement[];
    const findIn = (sel: string): HTMLElement | null => {
      for (const root of roots) {
        const found = root.querySelector<HTMLElement>(sel);
        if (found) return found;
      }
      return null;
    };
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    findIn('[data-order="halt"]')!.dispatchEvent(new Event('mouseenter'));
    expect(findIn('.rl-tip')?.hidden).toBe(false);
    const keydownAdd = addSpy.mock.calls.find(([type]) => type === 'keydown');
    expect(keydownAdd).toBeDefined();
    const listener = keydownAdd![1];

    hud.destroy();
    // The tip is a descendant of `this.strip`, itself in `this.roots`, and
    // goes down with it -- no node left over for the next mission's HUD to
    // collide with.
    expect(roots.some((root) => document.body.contains(root))).toBe(false);
    expect(document.body.children.length).toBe(before);
    // The SAME listener reference that went on -- proof the one the hover
    // installed is the one that came off, not merely that something did.
    expect(removeSpy).toHaveBeenCalledWith('keydown', listener);
  });
});

// Task 6: the strip's `+N` counts, collapsed into one button that opens the
// in-mission tracker (`main.ts`'s `objectivesPanel` popover).
describe('top strip: the objectives control', () => {
  it('the +N counts are a button, and clicking one opens the tracker', () => {
    const opened: number[] = [];
    const { hud, host } = rig(mission(), { openObjectives: () => opened.push(1) }); // hud.test.ts:66, :93
    hud.onTick();
    const btn = host.querySelector<HTMLButtonElement>('.rl-strip__more');
    expect(btn).not.toBeNull();
    expect(btn?.tagName).toBe('BUTTON');
    btn?.click();
    expect(opened).toEqual([1]);
  });

  it('with nothing left open there is no control at all, not a disabled one', () => {
    const { hud, host } = rig(mission({ objectives: [{ id: 'a', text: 'Done', primary: true, status: 'complete' }] }));
    hud.onTick();
    expect(host.querySelector('.rl-strip__more')).toBeNull();
  });

  // `renderStrip` innerHTMLs `stripBody` four times a second (hud.ts:894). A
  // listener bound to the button itself would be dropped 4 Hz and the first
  // click would land only if it beat the next rebuild.
  it('the control survives a rebuild -- the click is delegated', () => {
    const opened: number[] = [];
    const { hud, host } = rig(mission(), { openObjectives: () => opened.push(1) });
    hud.onTick();
    for (let i = 0; i < 10; i++) hud.onTick();
    host.querySelector<HTMLButtonElement>('.rl-strip__more')?.click();
    expect(opened).toEqual([1]);
  });

  // Fix round 1 (task 6 review, I3): a keyboard/screen-reader user reads the
  // tracker's state off `aria-expanded`, not off the CSS-only `data-open` on
  // the strip -- and since the button is rebuilt at 4 Hz, the attribute has
  // to be read back from `Hud`'s own stored flag on every rebuild rather
  // than written once and left to survive.
  // Fix round 1 (review, minor): a button keeps focus after the click that
  // pressed it, and Space is `jumpToAlert` -- which yields to a focused button
  // (`shouldYieldSpace`), so after one mouse click Space toggled the tracker
  // instead of jumping. A mouse click lets go (`detail > 0`, the same rule
  // the dock's tiles follow); Enter or Space on a focused button arrives as a
  // click with `detail` 0 and keeps it, so the keyboard stays where it was.
  it('lets go of the objectives button after a mouse click, and keeps it after a key press', () => {
    const opened: number[] = [];
    const { host } = rig(mission(), { openObjectives: () => opened.push(1) });
    const btn = (): HTMLButtonElement | null => host.querySelector('.rl-strip__more');
    btn()?.focus(); // what the mousedown before a real click does
    btn()?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(opened).toEqual([1]);
    expect(document.activeElement).not.toBe(btn());

    btn()?.focus();
    btn()?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(opened).toEqual([1, 1]);
    expect(document.activeElement).toBe(btn());
  });

  it('setObjectivesOpen mirrors onto the button\'s own aria-expanded, both ways', () => {
    const { hud, host } = rig(mission());
    hud.onTick();
    const btn = (): HTMLButtonElement | null => host.querySelector('.rl-strip__more');
    expect(btn()?.getAttribute('aria-expanded')).toBe('false');

    hud.setObjectivesOpen(true);
    for (let i = 0; i < 10; i++) hud.onTick();
    expect(btn()?.getAttribute('aria-expanded')).toBe('true');

    hud.setObjectivesOpen(false);
    for (let i = 0; i < 10; i++) hud.onTick();
    expect(btn()?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the chip name slot', () => {
  // jsdom computes no stylesheet, so -- the shape `brigade.test.ts`'s "the
  // garage type floor" established for its own reading ladder -- this reads
  // `theme.css` back off disk rather than asking a computed style for a rule
  // no rendering engine here applies.
  //
  // Falsified by hand: putting `text-overflow: ellipsis` back on this rule
  // turns it red.
  it('lets the name wrap instead of ellipsising', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/app/src/ui/theme.css'), 'utf8');
    let found = false;
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (selector !== '.rl-chip__name > span') continue;
      found = true;
      const textOverflow = /text-overflow\s*:\s*([^;]+);/.exec(rule[2]);
      expect(textOverflow?.[1].trim()).not.toBe('ellipsis');
    }
    // A selector that stopped matching (a rename, a merge into another rule)
    // would otherwise report zero offenders forever.
    expect(found).toBe(true);
  });
});

describe('the strip tooltips (final review, C1/C2)', () => {
  // C1: `.rl-strip` is `pointer-events: none` furniture, re-enabled only for
  // `a`/`button` -- so the five `[data-tip]` spans (Conduct, Logistics,
  // Intel, Pinned, Broken) never received a real hover at all; only a test
  // dispatching `mouseover` directly on the element, bypassing hit-testing,
  // could ever show one. Same disk-read shape as "the chip name slot" above.
  //
  // Falsified by hand: deleting the `.rl-strip [data-tip]` rule turns this
  // red.
  it('re-enables pointer events on the strip field tooltip triggers', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/app/src/ui/theme.css'), 'utf8');
    let found = false;
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!selector.includes('.rl-strip [data-tip]')) continue;
      found = true;
      const pointerEvents = /pointer-events\s*:\s*([^;]+);/.exec(rule[2]);
      expect(pointerEvents?.[1].trim()).toBe('auto');
    }
    expect(found).toBe(true);
  });

  // C1: a keyboard/touch player has no `mouseover` at all, and the delegated
  // `focusin` path in `bindDelegatedTip` only fires for an element that can
  // actually TAKE focus -- a bare `<span data-tip>` cannot without
  // `tabindex="0"`, so every field beyond Conduct was unreachable by
  // keyboard even after C1's pointer-events fix landed for the mouse.
  //
  // Falsified by hand: dropping `tabindex="0"` from any one of the five
  // spans in `renderStrip` turns this red.
  it('makes every strip field tooltip trigger focusable', () => {
    const r = rig(mission({ roe: 80, logistics: 410, logisticsRate: 120, intel: 40 }));
    r.sim.state.pinned[r.ids[0]] = 1;
    r.sim.state.routed[r.ids[1]] = 1;
    r.sim.state.pinned[r.ids[1]] = 1;
    for (let i = 0; i < 5; i++) r.tick();

    const tipped = [...r.host.querySelectorAll<HTMLElement>('.rl-strip [data-tip]')];
    const keys = tipped.map((el) => el.dataset.tip).sort();
    expect(keys).toEqual(['broken', 'conduct', 'intel', 'logistics', 'pinned']);
    for (const el of tipped) expect(el.tabIndex).toBe(0);
  });
});

describe('the strip tooltip element (final review, C2)', () => {
  // C2: `.rl-strip` sets `white-space: nowrap` and `.rl-tip` is
  // `position: fixed`, which does not cut the inheritance chain -- every
  // strip tooltip rendered as one unbroken line running off its own
  // 14.375rem box instead of wrapping.
  //
  // Falsified by hand: removing the `white-space: normal;` declaration from
  // `.rl-tip` turns this red.
  it('lets the tip text wrap instead of running off the box', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/app/src/ui/theme.css'), 'utf8');
    let found = false;
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (selector !== '.rl-tip') continue;
      found = true;
      // The rule's own body carries a comment that mentions `white-space:
      // nowrap` in prose (explaining what this declaration overrides) --
      // stripped first so the regex below cannot match inside it.
      const body = rule[2].replace(/\/\*[\s\S]*?\*\//g, '');
      const whiteSpace = /white-space\s*:\s*([^;]+);/.exec(body);
      expect(whiteSpace?.[1].trim()).toBe('normal');
    }
    expect(found).toBe(true);
  });
});

// Shell upgrade Phase 3, Task 10. `renderStrip` put three mission-authored
// strings straight into `innerHTML`: the mission's `name`, the shown
// primary's `text`, and a deadline objective's `text` (the third sink, which
// the plan missed and the pre-flight scan found). All three can also come
// from a translator's `data/locales/<lang>/missions.json` overlay. Every input
// below renders WRONG before the fix -- an entity that decodes, a tag that
// opens -- rather than a bare `&`, which a parser already shows literally and
// which would pass with or without escaping (pre-flight M7).
describe('the strip and the feed show what a mission authored as text', () => {
  it('shows an entity-shaped mission name as the characters it was authored with', () => {
    const r = rig(mission({ name: 'Fish &amp; Chips' }));
    expect(r.host.querySelector('.rl-strip__name')?.textContent).toBe('Fish &amp; Chips');
  });

  // Green before the fix too -- `escapeAttr` escaped `"` -- and kept because
  // it is what the consolidation could break: `hud.ts`'s old TEXT body did not
  // escape `"`, and choosing it as "the one" would end this attribute early.
  it('keeps the campaign tooltip whole when it carries a double quote', () => {
    const r = rig(mission({ campaign: 'Roster 9 · "Conduct" 82' }));
    expect(r.host.querySelector('.rl-strip__name')?.getAttribute('title')).toBe('Roster 9 · "Conduct" 82');
  });

  it('does not let the shown objective open a tag', () => {
    const r = rig(
      mission({ objectives: [{ id: 'hold', text: 'Hold <i>the</i> line', primary: true, status: 'active' }] })
    );
    const row = r.host.querySelector('[data-obj="hold"]');
    expect(row?.querySelector('i')).toBeNull();
    expect(row?.textContent).toContain('Hold <i>the</i> line');
  });

  it('does not let a deadline objective open a tag either -- the third sink', () => {
    const r = rig(
      mission({
        objectives: [
          { id: 'hold', text: 'Hold the line', primary: true, status: 'active' },
          { id: 'raze', type: 'raze', text: 'Raze <i>the</i> cache', primary: true, status: 'active', ticksLeft: 200 * 20 },
        ],
      })
    );
    const row = r.host.querySelector('.rl-strip__deadline');
    expect(row?.getAttribute('data-obj')).toBe('raze');
    expect(row?.querySelector('i')).toBeNull();
    expect(row?.textContent).toContain('Raze <i>the</i> cache');
  });

  // `hud.note` takes HTML by name and keeps doing so -- its callers pass
  // catalogue markup. What is tested is the CALL SITE's output (M7): the lost-
  // unit alert used to be `t(a.line.key, a.line.params)` inline in `main.ts`,
  // with `{name}` a unit's display name from `data/units/*.json`, unescaped.
  it('names a lost unit in the feed as text, and keeps the catalogue\'s own markup', () => {
    const r = rig(mission());
    r.hud.note(...alertNotice({ key: 'alert.unitLost', params: { name: '<i>Doobi</i>', n: 1 }, tone: 'bad' }));
    const line = r.host.querySelector('.rl-notice');
    expect(line?.querySelector('i')).toBeNull();
    expect(line?.textContent).toContain('<i>Doobi</i>');
    expect(line?.querySelector('b')?.textContent).toBe('lost');
  });
});

// Shell upgrade Phase 3, Task 10, second half (R-9: the Phase 2 deferral
// HANDOVER assigns here). `renderStrip` innerHTMLs `stripBody`/`stripInfo`
// four times a second, so keyboard focus on any strip field lasted 250 ms at
// most: the element holding it was destroyed and focus fell to <body>. The
// strip now remembers the focused control's STABLE key -- its `data-obj`, its
// `data-tip`, or the objectives button's own attribute -- and focuses the
// node carrying the same key after the swap. Never an index (M8).
describe('the strip does not eat the keyboard', () => {
  /** One 4 Hz rebuild: `onTick` renders the strip on every fifth call. */
  const rebuild = (r: Rig): void => {
    for (let i = 0; i < 5; i++) r.tick();
  };

  it('keeps focus on the same field, objective or control across rebuilds', () => {
    const m = mission({ roe: 80, logistics: 410, intel: 40 });
    const r = rig(m);
    for (const sel of [
      '[data-tip="conduct"]',
      '[data-tip="logistics"]',
      '[data-tip="intel"]',
      '[data-obj="hold_west"]',
      '.rl-strip__more',
    ]) {
      const before = r.host.querySelector<HTMLElement>(sel);
      before?.focus();
      expect(document.activeElement, `${sel} takes focus at all`).toBe(before);
      // Both runs must have something new to draw, or (fix round 1) the
      // rebuild keeps the node it has and this would prove nothing.
      for (let i = 0; i < 2; i++) {
        m.roe = (m.roe ?? 80) - 1;
        m.logistics = (m.logistics ?? 410) + 1;
        rebuild(r);
      }
      const after = r.host.querySelector<HTMLElement>(sel);
      // Not the same node: the rebuild really happened, so this cannot pass
      // by the strip simply not having been touched.
      expect(after, `${sel} was rebuilt`).not.toBe(before);
      expect(document.activeElement, `${sel} still has focus`).toBe(after);
    }
  });

  // M8. Two primaries, the second a failable deadline. The strip shows the
  // first as its primary and gives the deadline its own row AFTER it.
  // Completing the first promotes the deadline to the primary row, one place
  // earlier, and the deadline row goes away. A restore by position -- the nth
  // keyed control, or the nth objective row -- lands on a different control
  // or on none, and only a restore by the objective's own id holds.
  it('keeps focus on an objective by its own id when completing another reorders the rows', () => {
    const m = mission({
      objectives: [
        { id: 'take_ridge', text: 'Take the ridge', primary: true, status: 'active' },
        { id: 'raze_cache', type: 'raze', text: 'Raze the cache', primary: true, status: 'active', ticksLeft: 200 * 20 },
      ],
    });
    const r = rig(m);
    const keyed = (): HTMLElement[] => [
      ...r.host.querySelectorAll<HTMLElement>('.rl-strip [data-obj], .rl-strip [data-tip], .rl-strip [data-open-objectives]'),
    ];
    const cache = r.host.querySelector<HTMLElement>('[data-obj="raze_cache"]');
    expect(cache?.classList.contains('rl-strip__deadline')).toBe(true);
    const placeBefore = cache ? keyed().indexOf(cache) : -1;
    cache?.focus();
    expect(document.activeElement).toBe(cache);

    m.objectives[0].status = 'complete';
    rebuild(r);

    const now = r.host.querySelector<HTMLElement>('[data-obj="raze_cache"]');
    // The reorder the test exists for, asserted rather than assumed.
    expect(now?.classList.contains('rl-strip__deadline')).toBe(false);
    expect(now ? keyed().indexOf(now) : -1).toBeLessThan(placeBefore);
    expect(document.activeElement).toBe(now);
  });

  it('lets focus go when the control it was on is gone, rather than handing it to a neighbour', () => {
    const m = mission({
      objectives: [
        { id: 'take_ridge', text: 'Take the ridge', primary: true, status: 'active' },
        { id: 'hold_town', text: 'Hold the town', primary: true, status: 'active' },
      ],
    });
    const r = rig(m);
    r.host.querySelector<HTMLElement>('[data-obj="take_ridge"]')?.focus();
    expect(document.activeElement?.getAttribute('data-obj')).toBe('take_ridge');

    m.objectives[0].status = 'complete';
    rebuild(r);

    expect(r.host.querySelector('[data-obj="take_ridge"]')).toBeNull();
    expect(r.host.querySelector('[data-obj="hold_town"]')).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  // The strip is rebuilt 4 Hz for the whole mission; a restore that fires when
  // focus is somewhere else takes the keyboard off the battlefield 4 Hz.
  it('does not take the keyboard back once it has left the strip', () => {
    const r = rig(mission({ roe: 80 }));
    r.host.querySelector<HTMLElement>('[data-tip="conduct"]')?.focus();
    rebuild(r);
    expect(document.activeElement?.getAttribute('data-tip')).toBe('conduct');

    // Outside the strip, and carrying the SAME key -- the HUD's own selection
    // chips carry `data-tip` too -- so neither a key remembered from before
    // nor a restore that skips the "was it in the strip" check can pass.
    const outside = document.createElement('span');
    outside.tabIndex = 0;
    outside.dataset.tip = 'conduct';
    document.body.appendChild(outside);
    try {
      outside.focus();
      rebuild(r);
      rebuild(r);
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  // Fix round 1 (review, Important). The restore's `focus()` fires `focusin`,
  // and the strip's delegated tip opens on `focusin` -- so a field the MOUSE
  // had clicked (it has `tabindex`, so a click focuses it) re-opened its tip
  // on every rebuild after the pointer left, and kept it open until the
  // player clicked the battlefield. Two answers: a rebuild with nothing new
  // to draw keeps the node it already has, and one that does replace it hands
  // focus over without opening a tip the old node did not have open.
  const tip = (r: Rig): HTMLElement | null => r.host.querySelector<HTMLElement>('.rl-tip');
  const pointerLeaves = (el: HTMLElement | null): void => {
    el?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
  };

  it('does not re-open a tip the pointer closed, when nothing changed', () => {
    const r = rig(mission({ roe: 80 }));
    const conduct = r.host.querySelector<HTMLElement>('[data-tip="conduct"]');
    conduct?.focus();
    pointerLeaves(conduct);
    rebuild(r);
    rebuild(r);
    expect(tip(r)?.hidden).toBe(true);
  });

  it('keeps the very node, not a copy, when a rebuild has nothing new to draw', () => {
    const m = mission({ roe: 80, logistics: 410, intel: 40 });
    const r = rig(m);
    const conduct = r.host.querySelector<HTMLElement>('[data-tip="conduct"]');
    conduct?.focus();
    rebuild(r);
    rebuild(r);
    expect(r.host.querySelector('[data-tip="conduct"]')).toBe(conduct);
    expect(document.activeElement).toBe(conduct);
    // The two runs are judged separately: new logistics repaints the right
    // half and leaves the left half's nodes -- and the focus on one -- alone.
    m.logistics = 411;
    rebuild(r);
    expect(r.host.querySelector('[data-tip="logistics"]')?.textContent).toContain('411');
    expect(r.host.querySelector('[data-tip="conduct"]')).toBe(conduct);
  });

  it('does not re-open a tip the pointer closed, when the field did change', () => {
    const m = mission({ roe: 80 });
    const r = rig(m);
    const conduct = r.host.querySelector<HTMLElement>('[data-tip="conduct"]');
    conduct?.focus();
    pointerLeaves(conduct);
    expect(tip(r)?.hidden).toBe(true);
    m.roe = 79;
    rebuild(r);
    m.roe = 78;
    rebuild(r);
    const now = r.host.querySelector<HTMLElement>('[data-tip="conduct"]');
    expect(now).not.toBe(conduct);
    expect(document.activeElement).toBe(now);
    expect(tip(r)?.hidden).toBe(true);
    // Quiet for the restore only: the player's own next hover still opens it.
    // A quiet flag left set would leave every strip tip dead for the mission.
    now?.dispatchEvent(new Event('mouseover', { bubbles: true }));
    expect(tip(r)?.hidden).toBe(false);
  });

  // The other half of the same rule: a tip that WAS open on the focused field
  // follows it to the new node. jsdom fires no `focusout` when `innerHTML`
  // removes the focused node, and some engines do -- which closes the tip
  // before the successor is focused, so `refreshStripTip` has nothing left to
  // re-point and only the restore itself can put it back. The wrapper below
  // installs that engine behaviour for the length of the test.
  it('carries a tip that was open over to the new node, even where removal fires focusout', () => {
    const m = mission({ roe: 80 });
    const r = rig(m);
    withFocusoutOnRemoval(() => {
      r.host.querySelector<HTMLElement>('[data-tip="conduct"]')?.focus();
      expect(tip(r)?.hidden).toBe(false);
      m.roe = 79;
      rebuild(r);
    });
    const now = r.host.querySelector<HTMLElement>('[data-tip="conduct"]');
    expect(document.activeElement).toBe(now);
    expect(tip(r)?.hidden).toBe(false);
    expect(now?.getAttribute('aria-describedby')).toBe(tip(r)?.id);
  });
});

/** For the length of `body`, fire `focusout` on the focused element whenever
 *  an `innerHTML` write is about to remove it -- what some engines do and
 *  jsdom does not. Restores the real accessor however `body` exits. */
function withFocusoutOnRemoval(body: () => void): void {
  const real = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  const get = real?.get;
  const set = real?.set;
  if (!real || !get || !set) throw new Error('no innerHTML accessor on Element.prototype');
  Object.defineProperty(Element.prototype, 'innerHTML', {
    configurable: true,
    enumerable: real.enumerable,
    get(this: Element): string {
      return get.call(this);
    },
    set(this: Element, html: string) {
      const active = document.activeElement;
      if (active !== null && active !== this && this.contains(active)) {
        active.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
      }
      set.call(this, html);
    },
  });
  try {
    body();
  } finally {
    Object.defineProperty(Element.prototype, 'innerHTML', real);
  }
}
