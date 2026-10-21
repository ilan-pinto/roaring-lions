// @vitest-environment jsdom
//
// F4: the dock's camp rows in the DOM (direction B, the lead's ruling 18 Oct).
// `dock-model.test.ts` proves the rules; this proves the join -- the rows
// appear only when there is something to say, a pin changes what a tile click
// sends, every cancel and rally control dispatches the runtime's own command
// and nothing else, and a pause is a glyph and a word, never colour alone.
import { describe, expect, it } from 'vitest';
import { MissionRuntime, Sim, fx, type Command, type MissionJson, type UnitTypeJson } from '@lions/sim';
import { ReinforcementDock, type ProductionRuntime } from './production';
import type { DockUnit, LineSnapshot } from './dock-model';
import { closeTip } from './tooltip';

const FX = 65536;
type Line = LineSnapshot & { anchor: number };
function line(over: Partial<Line> = {}): Line {
  return { anchor: 0, exit: [10 * FX, 4 * FX], current: null, items: [], progress: 0, ticksLeft: 0, contested: false, rally: null, alive: true, ...over };
}

const SQUAD: DockUnit = { id: 'inf_squad', name: 'Rifle Squad', logistics: 292, buildTimeS: 15, bucket: 'soft', sprite: null, tags: ['soft'] };
const AT: DockUnit = { id: 'at_team', name: 'AT Team', logistics: 236, buildTimeS: 18, bucket: 'soft', sprite: null, tags: ['soft'] };

function rig(lines: Line[] | null, canBuild: (id: string, line?: number) => boolean = () => true) {
  document.body.replaceChildren();
  closeTip();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const sent: Command[] = [];
  const notes: string[] = [];
  const rallyArms: (number | null)[] = [];
  const denies: number[] = [];
  const state = { lines };
  const rt: ProductionRuntime = {
    logistics: 1000,
    intel: 0,
    production: [],
    supportCost: () => 10,
    buildBlockedReason: () => null,
    canBuild,
    ...(lines === null ? {} : { productionLines: () => state.lines ?? [] }),
    canSetRally: () => true,
  };
  const dock = new ReinforcementDock(host, {
    units: [SQUAD, AT],
    runtime: rt,
    note: (html) => notes.push(html),
    onArm: () => undefined,
    onArmRally: (l) => rallyArms.push(l),
    onDeny: () => denies.push(1),
    dispatch: (cmd) => sent.push(cmd),
  });
  const rows = () => [...host.querySelectorAll<HTMLElement>('.rl-line')].filter((r) => !r.hidden);
  const tile = (id: string) => host.querySelector<HTMLButtonElement>(`.rl-tile[data-unit='${id}']`) as HTMLButtonElement;
  const lineEl = () => host.querySelector<HTMLElement>('.rl-dock__lines') as HTMLElement;
  return { dock, host, sent, notes, rallyArms, denies, rows, tile, lineEl, state };
}

describe('the camp rows appear only when there is something to say', () => {
  it('one idle camp with no rally: no rows -- the dock a pre-F4 runtime draws, to the markup', () => {
    const bare = rig(null);
    // The tooltip's id is a running counter; everything else must match.
    const norm = (html: string) => html.replace(/rl-tip(-\d+)?"/g, 'rl-tip-N"');
    const before = norm(bare.host.innerHTML);
    const one = rig([line()]);
    expect(one.lineEl().hidden).toBe(true);
    expect(one.rows()).toHaveLength(0);
    expect(norm(one.host.innerHTML)).toBe(before);
  });

  it('one camp that is building gets its row; two camps always do', () => {
    expect(rig([line({ current: 'inf_squad', progress: 500, ticksLeft: 100 })]).rows()).toHaveLength(1);
    const two = rig([line(), line()]);
    expect(two.lineEl().hidden).toBe(false);
    expect(two.rows().map((r) => r.querySelector('.rl-line__camp')?.textContent)).toEqual(['Camp 1', 'Camp 2']);
  });
});

describe('pinning a camp', () => {
  it('unpinned, a tile sends `build` with no line (the runtime\'s shortest queue)', () => {
    const r = rig([line(), line()]);
    r.tile('inf_squad').click();
    expect(r.sent).toEqual([{ kind: 'build', side: 0, unit: 'inf_squad' }]);
    expect(r.notes.at(-1)).toContain('shortest queue');
  });

  it('a pinned row is pressed, and a tile builds on its line; a second click unpins', () => {
    const asked: (number | undefined)[] = [];
    const r = rig([line(), line()], (_id, l) => {
      asked.push(l);
      return true;
    });
    const pin = r.rows()[1].querySelector<HTMLButtonElement>('.rl-line__pin') as HTMLButtonElement;
    pin.click();
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    expect(r.rows()[0].querySelector('.rl-line__pin')?.getAttribute('aria-pressed')).toBe('false');
    r.tile('at_team').click();
    expect(r.sent.at(-1)).toEqual({ kind: 'build', side: 0, unit: 'at_team', line: 1 });
    expect(asked.at(-1)).toBe(1);
    expect(r.notes.at(-1)).toContain('deploys at Camp 2');
    expect(r.host.querySelector('.rl-dock__hint')?.textContent).toContain('Camp 2');
    pin.click();
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    r.tile('at_team').click();
    expect(r.sent.at(-1)).toEqual({ kind: 'build', side: 0, unit: 'at_team' });
  });

  it('a fallen camp cannot be pinned, and a pin on a camp that falls is dropped', () => {
    const r = rig([line(), line()]);
    const pin = r.rows()[0].querySelector<HTMLButtonElement>('.rl-line__pin') as HTMLButtonElement;
    pin.click();
    r.state.lines = [line({ alive: false }), line()];
    r.dock.refresh();
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    r.tile('inf_squad').click();
    expect(r.sent.at(-1)).toEqual({ kind: 'build', side: 0, unit: 'inf_squad' });
    pin.click();
    expect(r.denies).toHaveLength(1);
    expect(r.rows()[0].dataset.state).toBe('lost');
  });

  it('one camp at the start line still says "start line"; one real camp names it', () => {
    const start = rig([line({ anchor: -1, current: 'inf_squad' })]);
    start.tile('inf_squad').click();
    expect(start.notes.at(-1)).toContain('start line');
    const camp = rig([line({ anchor: 3, current: 'inf_squad' })]);
    camp.tile('inf_squad').click();
    expect(camp.notes.at(-1)).toContain('deploys at Camp 1');
  });
});

describe('a row\'s items and their cancels', () => {
  it('the item in progress and each queued chip cancel their own index on their own line', () => {
    const r = rig([line(), line({ current: 'inf_squad', progress: 400, ticksLeft: 180, items: ['at_team', 'inf_squad'] })]);
    const row = r.rows()[1];
    expect(row.querySelector('.rl-line__left')?.textContent).toBe('9s');
    (row.querySelector('.rl-line__item') as HTMLButtonElement).click();
    const chips = [...row.querySelectorAll<HTMLButtonElement>('.rl-line__chip')].filter((c) => !c.hidden);
    expect(chips).toHaveLength(2);
    chips[1].click();
    expect(r.sent).toEqual([
      { kind: 'cancelBuild', side: 0, line: 1, index: -1 },
      { kind: 'cancelBuild', side: 0, line: 1, index: 1 },
    ]);
    expect(chips[0].getAttribute('aria-label')).toBe('Cancel AT Team, refunds 236 logistics');
    expect(r.notes.at(-1)).toContain('292 logistics refunded');
  });

  it('folds a long queue into +n', () => {
    const r = rig([line({ current: 'inf_squad', items: ['at_team', 'at_team', 'at_team', 'at_team', 'at_team'] })]);
    const more = r.rows()[0].querySelector<HTMLElement>('.rl-line__more') as HTMLElement;
    expect(more.hidden).toBe(false);
    expect(more.textContent).toBe('+2');
  });
});

describe('a paused camp', () => {
  it('reads as the pause glyph and the word, in the warn tone, with the cause in the tip -- never colour alone', () => {
    const r = rig([line(), line({ current: 'inf_squad', progress: 300, ticksLeft: 100, contested: true })]);
    const row = r.rows()[1];
    const state = row.querySelector('.rl-line__state') as HTMLElement;
    expect(state.classList.contains('rl-warn')).toBe(true);
    expect(state.textContent?.trim()).toBe('paused');
    expect(state.querySelector('svg')).not.toBeNull();
    expect((row.querySelector('.rl-line__item') as HTMLElement).dataset.paused).toBe('1');
    const pin = row.querySelector('.rl-line__pin') as HTMLButtonElement;
    expect(pin.getAttribute('aria-label')).toContain('Camp 2: production paused. Enemy within 6 tiles of the camp exit.');
    pin.dispatchEvent(new Event('focus'));
    expect(r.host.querySelector('.rl-tip')?.textContent).toContain('It resumes by itself when the ground is clear.');
  });

  it('a building camp is not paused', () => {
    const r = rig([line({ current: 'inf_squad' })]);
    expect((r.rows()[0].querySelector('.rl-line__state') as HTMLElement).textContent).toBe('');
    expect((r.rows()[0].querySelector('.rl-line__item') as HTMLElement).dataset.paused).toBe('0');
  });
});

describe('the rally controls', () => {
  it('Set rally arms for its camp and says so; a second press disarms', () => {
    const r = rig([line(), line()]);
    const btn = r.rows()[1].querySelector<HTMLButtonElement>('.rl-line__rally') as HTMLButtonElement;
    btn.click();
    expect(r.rallyArms).toEqual([1]);
    expect(btn.dataset.armed).toBe('1');
    expect(r.dock.rallyArmed).toBe(1);
    expect(r.notes.at(-1)).toContain('click open ground for Camp 2');
    btn.click();
    expect(r.rallyArms).toEqual([1, null]);
    expect(btn.dataset.armed).toBe('0');
    expect(r.sent).toEqual([]);
  });

  it('names its camp to a screen reader and reports armed as pressed', () => {
    const r = rig([line(), line()]);
    const btn = r.rows()[1].querySelector<HTMLButtonElement>('.rl-line__rally') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Set rally for Camp 2');
    expect(r.rows()[1].querySelector('.rl-line__clear')?.getAttribute('aria-label')).toBe('Clear rally for Camp 2');
    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('disarms when its camp falls, and says so to the input layer', () => {
    const r = rig([line(), line()]);
    (r.rows()[0].querySelector('.rl-line__rally') as HTMLButtonElement).click();
    r.state.lines = [line({ alive: false }), line()];
    r.dock.refresh();
    expect(r.rallyArms).toEqual([0, null]);
    expect(r.dock.rallyArmed).toBeNull();
  });

  it('a row holding focus draws its rally; focus elsewhere does not', () => {
    const r = rig([line({ current: 'inf_squad', rally: [6 * FX, 28 * FX] }), line()]);
    const item = r.rows()[0].querySelector('.rl-line__item') as HTMLButtonElement;
    item.focus();
    expect(r.dock.rallyMarks(0)).toHaveLength(1);
    // A repaint hides the focused item; focus is read from the DOM each frame,
    // so a hidden row or focus moved away cannot leave the mark standing.
    r.rows()[0].hidden = true;
    expect(r.dock.rallyMarks(0)).toBeNull();
  });

  it('Clear rally shows only with a rally, and sends clearRally for its line', () => {
    const r = rig([line(), line({ rally: [20 * FX, 23 * FX] })]);
    const clear0 = r.rows()[0].querySelector<HTMLButtonElement>('.rl-line__clear') as HTMLButtonElement;
    const clear1 = r.rows()[1].querySelector<HTMLButtonElement>('.rl-line__clear') as HTMLButtonElement;
    expect(clear0.hidden).toBe(true);
    expect(clear1.hidden).toBe(false);
    clear1.click();
    expect(r.sent).toEqual([{ kind: 'clearRally', side: 0, line: 1 }]);
  });

  it('the tip says what happens with and without a rally (Q4: no rally, units wait at the camp)', () => {
    const r = rig([line(), line({ rally: [20 * FX, 23 * FX] })]);
    expect(r.rows()[0].querySelector('.rl-line__pin')?.getAttribute('aria-label')).toContain('No rally: units wait at the camp.');
    expect(r.rows()[1].querySelector('.rl-line__pin')?.getAttribute('aria-label')).toContain('Rally set');
  });

  it('marks are on demand: none by default; the pinned, hovered or armed row\'s, and a few seconds after one is set', () => {
    const r = rig([line({ rally: [6 * FX, 28 * FX] }), line({ rally: [20 * FX, 23 * FX] })]);
    expect(r.dock.rallyMarks(0)).toBeNull();
    (r.rows()[0].querySelector('.rl-line__pin') as HTMLButtonElement).click();
    expect(r.dock.rallyMarks(0)).toEqual([{ from: { x: 10, y: 4 }, to: { x: 6, y: 28 } }]);
    (r.rows()[0].querySelector('.rl-line__pin') as HTMLButtonElement).click();
    r.rows()[1].dispatchEvent(new Event('pointerenter'));
    expect(r.dock.rallyMarks(0)?.map((m) => m.to)).toEqual([{ x: 20, y: 23 }]);
    r.rows()[1].dispatchEvent(new Event('pointerleave'));
    expect(r.dock.rallyMarks(0)).toBeNull();
    r.dock.flashRally(0, 1000);
    expect(r.dock.rallyMarks(2000)).toHaveLength(1);
    expect(r.dock.rallyMarks(5000)).toBeNull();
  });
});

describe('with a real runtime', () => {
  const T: UnitTypeJson = {
    id: 'inf_squad', role: 'infantry',
    hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1 }, sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
    weapons: [],
  };
  it('draws each camp\'s queue from `productionLines`, and a tile pinned to Camp 2 lands there', () => {
    const sim = new Sim({ seed: 3, width: 40, height: 14, capacity: 64 });
    const t = sim.addUnitType(T);
    sim.addStructureType({ id: 'camp', name: 'Field Camp', hp_per_tile: 300, garrison_slots: 3, rubble_cover: 2, produces_for: 0 });
    const mission: MissionJson = {
      id: 'f4_dock', map: { file: 'none', player_start: [3, 5] },
      ledger: { requires: [], produces: [] },
      objectives: [{ id: 'hold', type: 'survive_until', primary: true, seconds: 600 }],
      starting_force: [{ unit: 'inf_squad', count: 1, at: [2, 12] }],
      structures: [{ type: 'camp', at: [10, 2], size: [2, 2] }, { type: 'camp', at: [28, 9], size: [2, 2] }],
    };
    const rt = new MissionRuntime(sim, mission, {
      typeIdOf: () => t, markers: {}, zones: {},
      economy: { logisticsStart: [3000, 3000], logisticsRatePerMin: [0, 0] },
      unitInfo: (u) => (u === 'inf_squad' || u === 'at_team' ? { logistics: 100, buildTimeS: 10, population: 1 } : null),
    });
    rt.start();
    document.body.replaceChildren();
    const sent: Command[] = [];
    const dock = new ReinforcementDock(document.body, {
      units: [SQUAD, AT], runtime: rt, note: () => undefined, onArm: () => undefined, dispatch: (c) => sent.push(c),
    });
    const rows = [...document.querySelectorAll<HTMLElement>('.rl-line')];
    expect(rows).toHaveLength(2);
    (rows[1].querySelector('.rl-line__pin') as HTMLButtonElement).click();
    (document.querySelector(".rl-tile[data-unit='at_team']") as HTMLButtonElement).click();
    (document.querySelector(".rl-tile[data-unit='inf_squad']") as HTMLButtonElement).click();
    // Run the dock's commands as the frame path does: `applyQueued` before the tick.
    for (const c of sent) sim.queueCommand(c);
    rt.applyQueued();
    rt.step(sim.tick());
    dock.refresh();
    expect(rt.productionLines(0)[1]).toMatchObject({ current: 'at_team', items: ['inf_squad'] });
    expect(rows[0].querySelector('.rl-line__item')?.hasAttribute('hidden')).toBe(true);
    expect(rows[1].querySelector('.rl-line__item')?.getAttribute('aria-label')).toContain('AT Team');
    const chips = [...rows[1].querySelectorAll<HTMLElement>('.rl-line__chip')].filter((c) => !c.hidden);
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual(['Cancel Rifle Squad, refunds 292 logistics']);
    // A rally the real runtime refuses (the camp's own tile) and one it takes.
    expect(dock.canRallyAt(1, fx.from(28.5), fx.from(9.5))).toBe(false);
    expect(dock.canRallyAt(1, fx.from(20.5), fx.from(6.5))).toBe(true);
  });
});
