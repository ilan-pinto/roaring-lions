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

import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import {
  MissionRuntime,
  Sim,
  type MissionJson,
  type UnitTypeJson,
} from '@lions/sim';
import { ReinforcementDock, type ProductionRuntime, type SupportKind } from './production';
import type { DockUnit } from './dock-model';
import type { Tone } from './hud';

type QueueItem = ProductionRuntime['production'][number];

interface FakeRuntime extends ProductionRuntime {
  logistics: number;
  intel: number;
  production: QueueItem[];
  blocked: Record<string, string>;
  builds: string[];
  buildOk: boolean;
}

function fakeRuntime(over: Partial<FakeRuntime> = {}): FakeRuntime {
  const rt: FakeRuntime = {
    logistics: 1000,
    intel: 100,
    sweepCost: 30,
    strikeCost: 60,
    production: [],
    blocked: {},
    builds: [],
    buildOk: true,
    buildBlockedReason: (id) => rt.blocked[id] ?? null,
    requestBuild: (id) => {
      rt.builds.push(id);
      return rt.buildOk;
    },
    ...over,
  };
  return rt;
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

function rig(unitList: DockUnit[] = [dockUnit()], rt = fakeRuntime()): Rig {
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
  it('draws one tile per buildable plus the two support calls', () => {
    const r = rig([dockUnit(), dockUnit({ id: 'mbt_lavi', name: 'Lavi MBT' })]);
    expect(r.tiles()).toHaveLength(4);
    expect(r.support('sweep').textContent).toContain('sweep 30');
    expect(r.support('strike').textContent).toContain('strike 60');
  });

  it('names the key its label promises', () => {
    const r = rig();
    expect(r.host.querySelector('.rl-dock__label')?.textContent).toBe('Reinforcements · B');
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

  it('shortens the lock to what fits, and keeps the whole sentence on the title', () => {
    const rt = fakeRuntime({
      blocked: { inf_squad: 'requires campaign ROE 55 (no missions rated yet)' },
    });
    const r = rig([dockUnit()], rt);
    const t = r.tile('inf_squad');
    expect(t.dataset.locked).toBe('1');
    expect(t.querySelector('.rl-tile__lock')?.textContent).toBe('ROE ≥ 55');
    expect(t.title).toContain('requires campaign ROE 55 (no missions rated yet)');
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
    r.support('sweep').click();
    expect(r.support('sweep').dataset.armed).toBe('1');
    expect(r.support('strike').dataset.armed).toBe('0');
    expect(r.arms).toEqual(['sweep']);
  });

  it('dims a support call there is not enough intel for', () => {
    const r = rig([dockUnit()], fakeRuntime({ intel: 40 }));
    expect(r.support('sweep').dataset.poor).toBe('0');
    expect(r.support('strike').dataset.poor).toBe('1');
  });
});

// ----------------------------------------------------------------------
// Clicks
// ----------------------------------------------------------------------

describe('what a click does', () => {
  it('asks the runtime to build, and says so', () => {
    const r = rig();
    r.tile('inf_squad').click();
    expect(r.rt.builds).toEqual(['inf_squad']);
    expect(r.notes[0].html).toContain('Rifle Squad');
  });

  it('refuses a locked tile without asking the runtime to build it', () => {
    const r = rig([dockUnit()], fakeRuntime({ blocked: { inf_squad: 'locked' } }));
    r.tile('inf_squad').click();
    expect(r.rt.builds).toEqual([]);
    expect(r.notes[0].tone).toBe('warn');
    expect(r.notes[0].html).toContain('is locked');
  });

  it('explains a refused build rather than doing nothing', () => {
    const r = rig([dockUnit()], fakeRuntime({ buildOk: false }));
    r.tile('inf_squad').click();
    expect(r.notes[0].tone).toBe('mute');
    expect(r.notes[0].html).toContain('insufficient logistics');
  });

  it('will not arm a support call there is no intel for', () => {
    const r = rig([dockUnit()], fakeRuntime({ intel: 0 }));
    r.support('sweep').click();
    expect(r.arms).toEqual([]);
    expect(r.support('sweep').dataset.armed).toBe('0');
    expect(r.notes[0].tone).toBe('mute');
  });

  it('disarms when the armed call is clicked again', () => {
    const r = rig();
    r.support('strike').click();
    r.support('strike').click();
    expect(r.arms).toEqual(['strike', null]);
    expect(r.support('strike').dataset.armed).toBe('0');
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

  it('describes a support call too, since a glyph explains nothing on its own', () => {
    const r = rig();
    hover(r.support('strike'));
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
      unitInfo: () => ({ logistics: 292, buildTimeS: 15 }),
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
    const r = rig([dockUnit()], w.runtime as unknown as FakeRuntime);
    r.tile('inf_squad').click();
    r.support('sweep').click();
    r.support('strike').click();
    r.dock.refresh();
    expect(w.queued).toHaveLength(0);
    // …and the build really did land in the runtime's queue, so the zero above
    // is "went the right way", not "went nowhere".
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
        unitInfo: () => ({ logistics: 906, buildTimeS: 45, unlock: { roeMin: 55 } }),
      }
    );
    runtime.start();
    const r = rig(
      [dockUnit({ id: 'mbt_lavi', name: 'Lavi MBT', logistics: 906 })],
      runtime as unknown as FakeRuntime
    );
    expect(r.tile('mbt_lavi').dataset.locked).toBe('1');
    expect(r.tile('mbt_lavi').querySelector('.rl-tile__lock')?.textContent).toBe('ROE ≥ 55');
  });
});
