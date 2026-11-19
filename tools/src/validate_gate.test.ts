// The compound-gate rules (GH-1438 E1) that validate_data cannot leave to the sim. Their own module because
// validate_data.mjs runs its sweep at import time and exits. Each spec names the one-line mutation of
// validate_gate.mjs that turns it red.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gateFailures } from '../validate_gate.mjs';

const ROOT = join(__dirname, '..', '..');

const GATE = { id: 'compound_gate', symbol: 'G', hp_per_tile: 600, per_tile: false, gate: { open_radius_tiles: 4 } };
const WALL = { id: 'wall', symbol: '=', hp_per_tile: 200, per_tile: true };
const catalogue = (gate: object = GATE): { types: Record<string, object> } => ({ types: { wall: WALL, compound_gate: gate } });

const map = (id: string, rows: string[]): { id: string; file: string; rows: string[] } => ({ id, file: `data/maps/${id}.json`, rows });
const mission = (file: string, mapId: string, structures: object[]): { file: string; mission: object } => ({
  file,
  mission: { map: { file: mapId }, structures },
});
const NONE = new Set<string>();

describe('G1: a gate is one structure', () => {
  // Mutation: delete the `per_tile === true` push. The per-tile gate is accepted.
  it('refuses a per_tile gate type, and passes the same type with per_tile false', () => {
    expect(gateFailures(catalogue({ ...GATE, per_tile: true }), [], [], NONE)).toEqual([
      'data/structures.json: gate "compound_gate" is per_tile -- a gate is one structure (its two leaves open together)',
    ]);
    expect(gateFailures(catalogue(), [], [], NONE)).toEqual([]);
  });
});

describe('G2: a gate is 2x1 or 1x2', () => {
  // Mutation: `n !== 2` -> `n < 2`. The three-tile run is accepted.
  it('in a grid: a 2x1 and a 1x2 run pass; a 3x1, a 2x2 and a lone tile are refused', () => {
    expect(gateFailures(catalogue(), [map('a', ['..GG..', '......', '.G....', '.G....'])], [], NONE)).toEqual([]);
    const bad = gateFailures(catalogue(), [map('b', ['GGG...', '......', '...GG.', '...GG.', 'G.....'])], [], NONE);
    expect(bad).toEqual([
      'data/maps/b.json: gate "compound_gate" at (0, 0) is a run of 3 tiles -- a gate is 2x1 or 1x2',
      'data/maps/b.json: gate "compound_gate" at (3, 2) is a run of 4 tiles -- a gate is 2x1 or 1x2',
      'data/maps/b.json: gate "compound_gate" at (0, 4) is a run of 1 tiles -- a gate is 2x1 or 1x2',
    ]);
  });

  // Mutation: drop the `(w === 1 && h === 2)` alternative, or the `?? [2, 2]` default. A legal 1x2, or the default 2x2.
  it('in a mission: size [2, 1] and [1, 2] pass; the default [2, 2] and [3, 1] are refused', () => {
    const ok = mission('data/missions/m.json', 'a', [
      { type: 'compound_gate', at: [3, 4], size: [2, 1] },
      { type: 'compound_gate', at: [9, 4], size: [1, 2] },
    ]);
    expect(gateFailures(catalogue(), [], [ok], NONE)).toEqual([]);
    const bad = mission('data/missions/m.json', 'a', [
      { type: 'compound_gate', at: [3, 4] },
      { type: 'compound_gate', at: [9, 4], size: [3, 1] },
      { type: 'wall', at: [1, 1], size: [3, 1] },
    ]);
    expect(gateFailures(catalogue(), [], [bad], NONE)).toEqual([
      'data/missions/m.json: structures[] places gate "compound_gate" at (3,4) with size [2, 2] -- a gate is [2, 1] or [1, 2]',
      'data/missions/m.json: structures[] places gate "compound_gate" at (9,4) with size [3, 1] -- a gate is [2, 1] or [1, 2]',
    ]);
  });
});

describe('G3: no gate on a map with a versus rules file', () => {
  // Mutation: delete either `versusMaps.has(...)` push. The gate on the versus map is accepted.
  it('refuses a drawn gate and a placed one on a versus map, and passes both on any other', () => {
    const vs = new Set(['tel_marum']);
    const grid = map('tel_marum', ['..GG..']);
    expect(gateFailures(catalogue(), [grid], [], vs)).toEqual([
      'data/maps/tel_marum.json: row 0 draws gate "compound_gate" at (2, 0) and the map has a versus rules file -- a gate opens for side 0 only',
    ]);
    const placed = mission('data/missions/x.json', 'tel_marum', [{ type: 'compound_gate', at: [2, 2], size: [2, 1] }]);
    expect(gateFailures(catalogue(), [], [placed], vs)).toEqual([
      'data/missions/x.json: structures[] places gate "compound_gate" on "tel_marum", which has a versus rules file -- a gate opens for side 0 only',
    ]);
    expect(gateFailures(catalogue(), [map('marj', ['..GG..'])], [mission('data/missions/y.json', 'marj', [{ type: 'compound_gate', at: [2, 2], size: [2, 1] }])], vs)).toEqual([]);
  });
});

describe('the shipped content', () => {
  it('ships no gate type yet (the compound_gate row waits on the lead: Q8 colour, Q10 art), so the rules check nothing today', () => {
    const shipped = JSON.parse(readFileSync(join(ROOT, 'data/structures.json'), 'utf8')) as { types: Record<string, { gate?: unknown }> };
    expect(Object.entries(shipped.types).filter(([, t]) => t.gate !== undefined)).toEqual([]);
    const maps = readdirSync(join(ROOT, 'data/maps'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(ROOT, 'data/maps', f), 'utf8')) as { id: string; rows: string[] });
    // With a gate type on the symbol nobody uses, every shipped map passes: `G` is drawn nowhere.
    const withGate = { types: { ...shipped.types, compound_gate: GATE } };
    expect(gateFailures(withGate, maps.map((m) => ({ ...m, file: `data/maps/${m.id}.json` })), [], NONE)).toEqual([]);
  });
});
