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
import { Hud, type HudDeps, type MissionView } from './hud';

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
