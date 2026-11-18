// The README is the project's front page, and it stated a stale mission count for weeks. This pins the numbers and tables it states to the data and
// the code they describe, so a change to either fails here until the README is updated with it. It checks what can be checked mechanically
// (counts, the unit unlock column, the versus map table, the pause and forfeit rules, the scripts, the links and images); the prose claims
// each carry their evidence in the pull request that last rewrote the file.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACTION_MATCHUP_MAPS, MAP_CAP_MINUTES, MATCH_CAP_MINUTES_DEFAULT, PAUSES_PER_SEAT, PAUSE_MS, FORFEIT_MS, winModesOffered, type WinMode } from '@lions/net';
import { maps as shippedMaps } from '@lions/data/content';

const maps: Readonly<Record<string, { name: string; rows: readonly string[] }>> = shippedMaps;

const ROOT = join(__dirname, '..', '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const json = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as T;

/** The README's pipe tables: every row's trimmed cells, by the heading line above it. */
function tableRows(after: string): string[][] {
  const start = README.indexOf(after);
  expect(start, `README has no "${after}"`).toBeGreaterThanOrEqual(0);
  const rows: string[][] = [];
  let seen = false;
  for (const line of README.slice(start).split('\n').slice(1)) {
    if (line.startsWith('|')) {
      seen = true;
      if (/^\|[-| ]+\|$/.test(line)) continue;
      rows.push(line.split('|').slice(1, -1).map((c) => c.trim()));
    } else if (seen) break;
  }
  return rows.slice(1); // drop the header row
}

const WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, seventeen: 17 };

interface Region { towns: { id: string; name: string; missions: string[] }[] }
const world = json<{ regions: Region[] }>('data/campaign/world.json');
const missionFiles = readdirSync(join(ROOT, 'data/missions')).filter((f) => f.endsWith('.json'));

describe('README: campaign numbers', () => {
  it('"three fronts, 34 missions" is the count on the campaign map', () => {
    const onMap = world.regions.flatMap((r) => r.towns.flatMap((t) => t.missions));
    expect(world.regions).toHaveLength(3);
    expect(README).toContain(`three fronts, ${onMap.length} missions`);
  });
  it('the tutorial is the one mission file outside the map ("the thirty-fifth")', () => {
    const onMap = new Set(world.regions.flatMap((r) => r.towns.flatMap((t) => t.missions)));
    const off = missionFiles.map((f) => f.replace(/\.json$/, '')).filter((id) => !onMap.has(id));
    expect(off).toEqual(['beit_sahwan_0_tutorial']);
    expect(missionFiles).toHaveLength(35);
    expect(README).toContain('is the thirty-fifth mission file');
  });
  it('every town count in the front table is the town\'s mission count', () => {
    for (const r of world.regions) for (const t of r.towns) expect(README, t.name).toContain(`${t.name} (${t.missions.length})`);
  });
  it('"Seventeen missions" with income zones is the number of mission files that declare them', () => {
    const n = missionFiles.filter((f) => json<{ resources?: { income_zones?: unknown[] } }>(`data/missions/${f}`).resources?.income_zones !== undefined).length;
    const m = /\*\*Held ground pays\.\*\* (\w+) missions/.exec(README);
    expect(m, 'the Held ground line').not.toBeNull();
    expect(WORD[(m?.[1] ?? '').toLowerCase()]).toBe(n);
  });
  it('"48 listed maps" (was 43 before Bir Tarsha listed its five) is the maps on disk minus the picker\'s unlisted ids', () => {
    const src = readFileSync(join(ROOT, 'packages/app/src/ui/menu.ts'), 'utf8');
    const ids = /UNLISTED_MAP_IDS[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(src)?.[1].match(/'([a-z0-9_]+)'/g) ?? [];
    expect(ids.length).toBeGreaterThan(0);
    const listed = readdirSync(join(ROOT, 'data/maps')).filter((f) => f.endsWith('.json')).length - ids.length;
    expect(README).toContain(`any of the ${listed} listed maps`);
  });
});

describe('README: credits, coins and the unit table', () => {
  it('the credit payout weights are the code\'s', () => {
    const src = readFileSync(join(ROOT, 'packages/sim/src/credits.ts'), 'utf8');
    const w = Object.fromEntries([...src.matchAll(/^\s+(win|carryingSecondary|unitHome|conductPoint): (\d+),/gm)].map((m) => [m[1], Number(m[2])]));
    expect(README).toContain(`${w.win} for the win, ${w.carryingSecondary} per carrying secondary objective, ${w.unitHome} per starting-force unit brought home, and ${w.conductPoint} per Conduct point`);
  });
  it('the Roar coin earn table and the coin rate are the code\'s', () => {
    const earn = readFileSync(join(ROOT, 'packages/app/src/roar-earn.ts'), 'utf8');
    const get = (label: RegExp): number => Number(label.exec(earn)?.[1]);
    expect(README).toContain(`${get(/welcome issue\s+(\d+)/)} on the first victory, ${get(/first win of a mission\s+(\d+)/)} for the first win of each mission, ${get(/a new star\s+(\d+)/)} per new star, ${get(/campaign complete\s+(\d+)/)} for finishing the campaign`);
    const stores = readFileSync(join(ROOT, 'packages/economy/src/stores.ts'), 'utf8');
    expect(README).toContain(`1 coin = ${/CREDITS_PER_COIN = (\d+)/.exec(stores)?.[1]} credits`);
    expect(stores).toMatch(/PURCHASES_OPEN/);
  });
  it('real-money coins are still off, which the README says outright', () => {
    const wallet = readFileSync(join(ROOT, 'packages/economy/src/wallet.ts'), 'utf8');
    expect(wallet).toMatch(/export const PURCHASES_OPEN\s*(:\s*boolean\s*)?=\s*false/);
    expect(README).toContain('the real-money coin packs are switched off');
  });
  const units = new Map<string, { id: string; unlock?: { roe_rating_min?: number; stars_min?: number; price?: number } }>();
  for (const f of readdirSync(join(ROOT, 'data/units/kdf'))) {
    const d = json<{ id: string; name: string; unlock?: { roe_rating_min?: number; stars_min?: number; price?: number } }>(`data/units/kdf/${f}`);
    units.set(d.name, d);
  }
  const rows = tableRows('### KDF (the player\'s brigade)');
  it('every KDF unit but the wounded man is in the table, and every name in it is a unit', () => {
    const named = rows.flatMap((r) => r[0].split(', '));
    for (const n of named) expect(units.has(n), n).toBe(true);
    const missing = [...units.keys()].filter((n) => !named.includes(n) && n !== 'Wounded Soldier');
    expect(missing).toEqual([]);
  });
  it('each "Opens" cell is the unit\'s unlock in the data (start, Conduct N, N stars, credits)', () => {
    for (const r of rows) {
      const names = r[0].split(', ');
      const opens = r[r.length - 1].split(', ');
      names.forEach((n, i) => {
        const cell = opens.length === names.length ? opens[i] : opens[0];
        const u = units.get(n)?.unlock;
        const expected = u === undefined ? 'start' : u.roe_rating_min !== undefined ? `Conduct ${u.roe_rating_min}` : u.stars_min !== undefined ? `${u.stars_min} stars` : 'credits';
        expect(cell, n).toBe(expected);
      });
    }
  });
});

describe('README: versus', () => {
  const LABEL: Record<WinMode, string> = { camp: 'Destroy the camp', points: 'Points race', flag: 'Capture the flag' };
  const rows = tableRows('**Choose the ground and how it is won.**');
  const byName = (cell: string): string => {
    const ids = Object.keys(maps).filter((id) => {
      const [a, b] = maps[id].name.split(' — ');
      return cell === (b === undefined ? a : /\(large\)$/.test(a) ? a : `${a}, ${b}`);
    });
    expect(ids, cell).toHaveLength(1);
    return ids[0];
  };
  it('lists exactly the maps a room can be hosted on, with their size, pairing and mirror win modes', () => {
    const offered = Object.keys(maps).filter((id) => (winModesOffered(id, 'mirror').length > 0) || FACTION_MATCHUP_MAPS.includes(id));
    expect(rows.map((r) => byName(r[0])).sort()).toEqual(offered.sort());
    for (const r of rows) {
      const id = byName(r[0]);
      const n = maps[id].rows.length;
      expect(r[1], id).toBe(`${n} x ${n}`);
      expect(r[2], id).toBe(FACTION_MATCHUP_MAPS.includes(id) ? 'yes' : 'no');
      expect(r[3].split(', ').sort(), id).toEqual(winModesOffered(id, 'mirror').map((m) => LABEL[m]).sort());
    }
  });
  it('"only Destroy the camp, on both Wadi Tarfan maps" is what a KDF-against-Sarim room is offered', () => {
    const cells = Object.keys(maps).flatMap((id) => (['kdf', 'sarim'] as const).map((side) => [id, side, winModesOffered(id, side)] as const)).filter(([, , m]) => m.length > 0);
    expect([...new Set(cells.map(([id]) => id))].sort()).toEqual(['wadi_tarfan', 'wadi_tarfan_l']);
    expect(cells.every(([, , m]) => m.length === 1 && m[0] === 'camp')).toBe(true);
    expect(README).toContain('except *Destroy the camp*, which both Wadi Tarfan maps also offer there');
  });
  it('the two camp menus listed are the doctrines\' menus, by unit name', () => {
    const name = (id: string): string => (json<{ name: string }>(`data/units/${existsSync(join(ROOT, `data/units/kdf/${id}.json`)) ? 'kdf' : 'enemy'}/${id}.json`)).name;
    for (const side of ['kdf', 'sarim'] as const) {
      const menu = json<{ menu: string[] }>(`data/doctrines/${side}.json`).menu.map(name).sort();
      const line = new RegExp(`^- The ${side === 'kdf' ? 'KDF' : 'Sarim'} menu: (.+)\\.$`, 'm').exec(README)?.[1];
      expect(line, side).toBeDefined();
      expect((line ?? '').split(', ').sort(), side).toEqual(menu);
    }
  });
  it('the pause, forfeit and time-cap rules are the protocol\'s', () => {
    expect(README).toContain(`three pauses each, ${PAUSE_MS / 1000} seconds each`);
    expect(PAUSES_PER_SEAT).toBe(3);
    expect(README).toContain(`gone for ${FORFEIT_MS / 1000} seconds forfeits`);
    const big = Object.entries(MAP_CAP_MINUTES).filter(([, m]) => m !== MATCH_CAP_MINUTES_DEFAULT);
    expect(big.map(([, m]) => m)).toEqual(big.map(() => 35));
    expect(README).toContain(`${MATCH_CAP_MINUTES_DEFAULT} minutes, 35 on Rujm Sawda and the two 96 x 96 maps`);
    expect(big.map(([id]) => id).sort()).toEqual(['milh_flats_l', 'rujm_sawda', 'wadi_tarfan_l']);
  });
});

describe('README: what is and is not in the build', () => {
  it('English is the only selectable language, which the README says; it must change when the first other one ships', () => {
    const src = readFileSync(join(ROOT, 'packages/app/src/i18n/locales.ts'), 'utf8');
    const ids = [...(/export const LOCALES[^=]*=\s*\[([\s\S]*?)\];/.exec(src)?.[1] ?? '').matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
    expect(ids).toEqual(['en']);
    expect(README).toContain('**English is the only language you can choose today.**');
  });
  it('the difficulty picker and the chat filter are in the build and block and report are not, which the README says', () => {
    // GH-1394 slice 2 (PR 1548) shipped the picker: the posture UI reads the three posture labels and writes the ledger key.
    const ui = readdirSync(join(ROOT, 'packages/app/src/ui')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const reads = ui.filter((f) => /difficulty\.(easier|standard|harder)/.test(readFileSync(join(ROOT, 'packages/app/src/ui', f), 'utf8')));
    expect(reads, 'the picker is in the build: the README\'s Difficulty bullet says so').toContain('posture-copy.ts');
    expect(existsSync(join(ROOT, 'packages/app/src/ui/posture-ui.ts'))).toBe(true);
    expect(README).toContain('- **Difficulty.** Choose Easier, Standard or Harder');
    expect(README).not.toContain('Difficulty (coming)');
    // GH-1417 S2 (PR 1492) shipped the word filter: the matcher exists and the mask setting is a Settings row.
    expect(existsSync(join(ROOT, 'packages/app/src/ui/chat-filter.ts')), 'the filter is in the build: the README\'s Chat paragraph says so').toBe(true);
    expect(README).toContain('A **word filter** runs on your own screen');
    expect(README).toContain('**Mask swear words**');
    expect(existsSync(join(ROOT, 'packages/app/src/chat/block-list.ts')), 'block list exists: update the Chat paragraph').toBe(false);
    expect(README).toContain('Block and report buttons are designed but **not in the build yet**');
  });
  it('claims the store copy refuses are not made here either', () => {
    for (const w of [/co-?op\b/i, /skirmish/i, /WebGPU/i, /Steam Deck/i, /matchmaking is/i]) expect(README, String(w)).not.toMatch(w);
  });
});

describe('README: scripts, links and images', () => {
  const scripts = json<{ scripts: Record<string, string> }>('package.json').scripts;
  it('every `pnpm <script>` it names exists in package.json', () => {
    const named = new Set([...README.matchAll(/(?:^|`)pnpm ([a-z][a-z0-9:-]*)/gm)].map((m) => m[1]));
    const builtin = new Set(['install']);
    for (const s of named) expect(s in scripts || builtin.has(s), `pnpm ${s}`).toBe(true);
    expect(named.size).toBeGreaterThan(8);
  });
  it('every relative link and image points at a file or directory that exists', () => {
    const targets = [...README.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)].map((m) => m[1]).filter((p) => !/^https?:/.test(p));
    expect(targets.length).toBeGreaterThan(8);
    for (const p of targets) expect(existsSync(join(ROOT, p)), p).toBe(true);
  });
  it('every in-page anchor it links to is a heading in the file', () => {
    const slug = (h: string): string => h.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');
    const heads = new Set([...README.matchAll(/^#{1,4} (.+)$/gm)].map((m) => slug(m[1])));
    for (const m of README.matchAll(/\]\(#([^)]+)\)/g)) expect(heads.has(m[1]), `#${m[1]}`).toBe(true);
  });
});
