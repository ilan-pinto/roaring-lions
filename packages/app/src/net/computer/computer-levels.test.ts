/**
 * GH-1389: a computer level reaches the game as the computer seat's `withhold`, a stated handicap on its placed force, and
 * through nothing else. Absent a level (and at a level that leaves nothing home) the config and the world are today's, byte
 * for byte; at a level, the computer's side spawns its force minus exactly what the level names, and the human's side is
 * untouched. The sim never learns a level exists.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPUTER_LEVEL_IDS, computerLevelOf, withholdOf } from '@lions/data';
import { validateConfig } from '@lions/net';
import { buildMatchWorld, matchTick } from '../match-world';
import { runFrames, seatWorldFor } from '../frame-step';
import { offlineConfig, offlineMatch, COMPUTER_SEAT, HUMAN_SEAT, type OfflineRequest } from '../offline-match';
import { VERSUS_KDF, versusForceOf } from '../versus-force';

const REQ: OfflineRequest = { map: 'tel_marum', matchup: 'mirror', callsign: 'Ari', computerName: 'Basic computer', build: 'test+0', seed: 1234 };

const typesOn = (w: ReturnType<typeof buildMatchWorld>, side: 0 | 1): string[] => {
  const byIdx = new Map<number, string>();
  for (const [id, idx] of w.typeOfBySide[side]) byIdx.set(idx, id);
  return w.bySide[side].map((e) => byIdx.get(w.sim.state.typeIdx[e]) ?? '?');
};

/** The world's hash after the computer has made its first decisions, both seats played through the shipped transport. */
function playedHash(req: OfflineRequest, ticks: number): number {
  const { transport, config } = offlineMatch(req);
  const w = buildMatchWorld(config);
  transport.attach(w);
  const step = { transport, sim: w.sim, seatWorld: seatWorldFor(config, w.sim), config, runTick: () => { matchTick(w); }, runtimeDigest: () => w.runtime?.digest() ?? 0 };
  while (w.sim.tickCount < ticks) if (runFrames(step, 4).ran === 0) break;
  return w.sim.hash();
}

describe('absent a level, the computer seat is today\'s, byte for byte', () => {
  it('versusForceOf with no withhold, or an empty one, is the very array', () => {
    expect(versusForceOf('kdf')).toBe(VERSUS_KDF);
    expect(versusForceOf('kdf', {})).toBe(VERSUS_KDF);
  });

  it('the config names no withhold, and "hard" (which leaves nothing home) mints the identical config', () => {
    const none = offlineConfig(REQ);
    expect(none.seats.some((s) => 'withhold' in s)).toBe(false);
    expect(withholdOf(computerLevelOf('hard'))).toEqual({});
    expect(JSON.stringify(offlineConfig({ ...REQ, level: 'hard' }))).toBe(JSON.stringify(none));
  });

  it('the world and its play are identical: the same hash at spawn and after the first decisions', () => {
    const a = buildMatchWorld(offlineConfig(REQ));
    const b = buildMatchWorld(offlineConfig({ ...REQ, level: 'hard' }));
    expect(b.sim.hash()).toBe(a.sim.hash());
    expect(typesOn(a, 1)).toEqual(VERSUS_KDF.map(([id]) => id));
    expect(playedHash({ ...REQ, level: 'hard' }, 260)).toBe(playedHash(REQ, 260));
  }, 120_000);
});

describe('at a level, the computer fields its force minus exactly what the level names', () => {
  it.each(COMPUTER_LEVEL_IDS.filter((id) => Object.keys(withholdOf(computerLevelOf(id))).length > 0))('%s', (id) => {
    const config = offlineConfig({ ...REQ, level: id });
    const withhold = withholdOf(computerLevelOf(id));
    expect(config.seats[COMPUTER_SEAT].withhold).toEqual(withhold);
    expect(config.seats[HUMAN_SEAT].withhold).toBeUndefined();
    expect(validateConfig(JSON.parse(JSON.stringify(config)))).not.toBeNull();
    const w = buildMatchWorld(config);
    const computerSide = config.seats[COMPUTER_SEAT].side;
    const humanSide = config.seats[HUMAN_SEAT].side;
    // The human's force is the whole force.
    expect(typesOn(w, humanSide)).toEqual(VERSUS_KDF.map(([id]) => id));
    // The computer's is the whole force less the named units, counted type by type.
    const count = (ids: readonly string[]): Record<string, number> => ids.reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
    const want = count(VERSUS_KDF.map(([u]) => u));
    for (const [u, n] of Object.entries(withhold)) want[u] = Math.max(0, (want[u] ?? 0) - n);
    for (const u of Object.keys(want)) if (want[u] === 0) delete want[u];
    expect(count(typesOn(w, computerSide))).toEqual(want);
    expect(w.bySide[computerSide].length).toBe(VERSUS_KDF.length - Object.values(withhold).reduce((a, b) => a + b, 0));
  });

  it('withholds the LAST placements of a type and keeps every other placement in order', () => {
    const out = versusForceOf('kdf', { mbt_lavi: 1, inf_squad: 2 });
    expect(out).toEqual(VERSUS_KDF.filter((p, i) => !(p === VERSUS_KDF[1] || (p[0] === 'inf_squad' && i !== VERSUS_KDF.findIndex(([u]) => u === 'inf_squad')))));
    expect(versusForceOf('kdf', { mbt_lavi: 9 }).some(([u]) => u === 'mbt_lavi')).toBe(false);
    expect(versusForceOf('kdf', { atgm_cell: 3 })).toEqual(VERSUS_KDF);
  });
});

describe('the sim never learns a level exists', () => {
  it('no file in packages/sim/src names a level, a withhold or a difficulty of the computer', () => {
    const dir = join(__dirname, '..', '..', '..', '..', 'sim', 'src');
    const hits: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (!e.isFile() || !e.name.endsWith('.ts')) continue;
      const text = readFileSync(join(e.parentPath, e.name), 'utf8');
      if (/withhold|computerLevel|ComputerLevel|computer_level/.test(text)) hits.push(e.name);
    }
    expect(hits).toEqual([]);
  });
});
