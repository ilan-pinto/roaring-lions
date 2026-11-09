// GH-1097: the versus bot fought the lead's 7 Nov match (room 487VTK) as one attack-moved blob: about 14 orders, no
// formation, no smoke, no fire support. Two halves are pinned here. The harness half: `observe` and `terrain` give the
// ground a commander reads (cover, elevation, who can lay smoke), from the sim's own grids. The prompt half: the
// standing prompt carries a short, checkable doctrine, and the bot addendum its cadence. `mcp-tools.test.ts` holds the
// formation orders themselves (accepted where open, refused with the reason where closed, sent as a Command).
import { describe, expect, it } from 'vitest';
import { buildMatchWorld } from '../../../packages/app/src/net/match-world';
import { applyWinRule } from './win-rule';
import { BOT_ADDENDUM, botPrompt } from './bot';
import { readStandingPrompt } from './external-player';
import { FogTracker } from './fog-tracker';
import { openingGroundOf, sideView, terrainView, TERRAIN_LEGEND, type UnitLine } from './view';
import { versusConfig } from './test-config';

function world(map = 'wadi_tarfan') {
  const w = buildMatchWorld(versusConfig(map));
  const fog = new FogTracker(w.sim, 0);
  for (let i = 0; i < 4; i++) { w.sim.tick(); fog.step(); }
  return { w, fog };
}

/** The first tile (row-major) for which `pred` holds, or a thrown error naming what the map lacks. */
function firstTile(w: ReturnType<typeof world>['w'], what: string, pred: (t: number, x: number, y: number) => boolean): [number, number] {
  for (let y = 0; y < w.sim.height; y++) for (let x = 0; x < w.sim.width; x++) if (pred(y * w.sim.width + x, x, y)) return [x, y];
  throw new Error(`the map has no ${what} tile`);
}

/** The ground as the room's match began, from a world built fresh from the same config (as the agent client builds it). */
const openingOf = (w: ReturnType<typeof world>['w']) => openingGroundOf(buildMatchWorld(versusConfig(w.mapJson.id)));
/** `terrain` as seat 0 reads it: live where its fog sees the tile centre now, the opening ground elsewhere. */
const seen = (w: ReturnType<typeof world>['w'], fog: FogTracker, x: number, y: number, wt: number, ht: number) =>
  terrainView(w, openingOf(w), (tx, ty) => fog.visibleTile(tx + 0.5, ty + 0.5), x, y, wt, ht);

describe('GH-1097: terrain, the map\'s ground as the model reads it', () => {
  it('one character a tile: cover digits, buildings, ridges and open ground; elevation where there is relief', () => {
    const { w, fog } = world();
    const t = seen(w, fog, 0, 0, w.sim.width, w.sim.height);
    expect(t.size).toEqual([w.sim.width, w.sim.height]);
    expect(t.rows).toHaveLength(w.sim.height);
    for (const r of t.rows) {
      expect(r).toHaveLength(w.sim.width);
      for (const ch of r) expect(Object.keys(TERRAIN_LEGEND), ch).toContain(ch);
    }
    const at = ([x, y]: [number, number]): string => t.rows[y][x];
    const sim = w.sim;
    expect(at(firstTile(w, 'cover 2', (i) => sim.blocked[i] === 0 && sim.boulder[i] === 0 && sim.cover[i] === 2))).toBe('2');
    expect(at(firstTile(w, 'building', (i, x, y) => sim.blocked[i] !== 0 && w.mapJson.rows[y][x] !== '^'))).toBe('#');
    expect(at(firstTile(w, 'open', (i) => sim.blocked[i] === 0 && sim.boulder[i] === 0 && sim.cover[i] === 0))).toBe('.');
    // Wadi Tarfan is a wadi: banks above its bed.
    expect(t.elevation).toBeDefined();
    const [ex, ey] = firstTile(w, 'raised', (i) => sim.elevation[i] > 0);
    expect(t.elevation?.[ey][ex]).toBe(String(sim.elevation[ey * sim.width + ex]));
  });
  it('a window reads the same tiles as the whole map, with its origin', () => {
    const { w, fog } = world();
    const whole = seen(w, fog, 0, 0, w.sim.width, w.sim.height);
    const part = seen(w, fog, 10, 12, 7, 5);
    expect(part.origin).toEqual([10, 12]);
    expect(part.rows).toEqual(whole.rows.slice(12, 17).map((r) => r.slice(10, 17)));
  });
  // The review of PR 1106: built from the live grids alone, `terrain` told a seat of a collapse anywhere, under the fog too.
  it('a building that falls OUT of the seat\'s sight still stands in terrain; one that falls in sight reads as its rubble', () => {
    const { w, fog } = world();
    const sim = w.sim;
    const hidden = firstTile(w, 'building out of sight', (i, tx, ty) => sim.blocked[i] !== 0 && w.mapJson.rows[ty][tx] !== '^' && !fog.visibleTile(tx + 0.5, ty + 0.5));
    const [x, y] = hidden;
    expect(seen(w, fog, x, y, 1, 1).rows).toEqual(['#']);
    (sim.blocked as Uint8Array)[y * sim.width + x] = 0; // fixture: a collapse opens the tile and leaves rubble (sim.ts `collapse`)
    (sim.cover as Uint8Array)[y * sim.width + x] = 1;
    expect(fog.visibleTile(x + 0.5, y + 0.5)).toBe(false);
    expect(seen(w, fog, x, y, 1, 1).rows).toEqual(['#']);
    // The same tile, seen: the live ground.
    expect(terrainView(w, openingOf(w), () => true, x, y, 1, 1).rows).toEqual(['1']);
  });
});

describe('GH-1097: a unit row and a contact row say what ground they stand on, and who can smoke', () => {
  const rowOf = (w: ReturnType<typeof world>['w'], fog: FogTracker, id: number): UnitLine => {
    const r = sideView(w, 0, fog, null).units.find((u) => u.id === id);
    if (r === undefined) throw new Error(`unit ${id} not in view`);
    return r;
  };
  it('cover and elev are the tile\'s, and absent on open level ground', () => {
    const { w, fog } = world();
    const sim = w.sim;
    const id = w.bySide[0][0];
    const place = ([x, y]: [number, number]): void => {
      sim.state.posX[id] = (x << 16) + (1 << 15);
      sim.state.posY[id] = (y << 16) + (1 << 15);
    };
    place(firstTile(w, 'open level', (i) => sim.blocked[i] === 0 && sim.cover[i] === 0 && sim.elevation[i] === 0));
    const open = rowOf(w, fog, id);
    expect(open).not.toHaveProperty('cover');
    expect(open).not.toHaveProperty('elev');
    const covered = firstTile(w, 'raised cover', (i) => sim.blocked[i] === 0 && sim.cover[i] >= 2 && sim.elevation[i] > 0);
    place(covered);
    const r = rowOf(w, fog, id);
    expect(r.cover).toBe(sim.cover[covered[1] * sim.width + covered[0]]);
    expect(r.elev).toBe(sim.elevation[covered[1] * sim.width + covered[0]]);
  });
  it('a garrisoned unit carries no tile cover (the building is its protection)', () => {
    const { w, fog } = world();
    const sim = w.sim;
    const id = w.bySide[0][0];
    const [x, y] = firstTile(w, 'cover', (i) => sim.blocked[i] === 0 && sim.cover[i] > 0);
    sim.state.posX[id] = (x << 16) + (1 << 15);
    sim.state.posY[id] = (y << 16) + (1 << 15);
    expect(rowOf(w, fog, id).cover).toBeGreaterThan(0);
    sim.state.garrisonedIn[id] = 0;
    expect(rowOf(w, fog, id)).not.toHaveProperty('cover');
  });
  it('a unit whose type lays smoke is flagged smoke, and an infantry squad is not', () => {
    const { w, fog } = world();
    const view = sideView(w, 0, fog, null);
    const smokers = view.units.filter((u) => u.flags.includes('smoke')).map((u) => u.type);
    expect(smokers).toContain('mortar_team');
    expect(smokers).toContain('mbt_lavi');
    expect(view.units.filter((u) => u.type === 'inf_squad').every((u) => !u.flags.includes('smoke'))).toBe(true);
  });
});

/** The doctrine's twelve rules, by their bold heads, in order. */
const DOCTRINE = [
  'Groups.', 'Scout first.', 'Approach in Column.', 'Take ground with cover.', 'Engage in Attack, or hold in Ambush.',
  'Flank, never head-on.', 'Smoke before open ground.', 'Fire support.', 'Focus fire.', 'Pull back the damaged.',
  'Steady cadence.', 'Read `held` and `holding`.',
] as const;

describe('GH-1097: the standing prompt carries a doctrine a match can be checked against', () => {
  const prompt = readStandingPrompt();
  const section = (): string => {
    const at = prompt.indexOf('## The doctrine: fight like a commander');
    expect(at).toBeGreaterThanOrEqual(0);
    return prompt.slice(at, prompt.indexOf('\n## ', at + 1));
  };
  it('every rule is there, numbered in order', () => {
    const s = section();
    DOCTRINE.forEach((head, k) => expect(s, head).toContain(`${k + 1}. **${head}**`));
  });
  it('the rules name the exact order keys and tools they ask for', () => {
    const s = section();
    for (const w of ['"formation":"column"', '"formation":"attack"', '"formation":"ambush"', '`terrain`', '`garrison`', '`smoke`', 'flagged `smoke`', '`attack`', '200 ticks', '`pinned`', '`checkpoint`', 'no strike call']) {
      expect(s, w).toContain(w);
    }
  });
  it('the prompt says where the formations a room accepts are listed, and the tools list has terrain', () => {
    expect(prompt).toContain('`observe` lists the ones this room accepts as `formations`');
    expect(prompt).toContain('- `terrain` —');
    expect(prompt).not.toContain('Fewer, larger orders');
  });
  it('the doctrine survives every win mode\'s swap (the swap edits the rule lines only), and is in the bot\'s prompt', () => {
    for (const mode of ['points', 'flag', 'camp'] as const) expect(applyWinRule(prompt, mode)).toContain(section());
    expect(botPrompt({ room: 'ABCDEF' })).toContain(section());
  });
  it('the bot addendum sets the realtime cadence', () => {
    expect(BOT_ADDENDUM).toContain('`wait` 100 ticks between looks (60 while you are in contact, never more than 200)');
  });
});
