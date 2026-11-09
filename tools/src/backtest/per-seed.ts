// The versus probe's per-seed file (`--per-seed=<file>`, GH-859 P1b Task 7) and the one reader of it, the
// S4 gate (`s4-gate.ts`). A shared leaf: types and a validator, no sim, so the gate imports nothing heavy.
//
// One file is one probe invocation. It names what was played (the seat table, the cap, the formation arm)
// so the gate can refuse a pairing that is not a pairing, and per cell, per seed, the winning END, how the
// game ended and its length. A cell's key is `<map> <cell name> <world>`: the same map and spawn order in
// the placed-force world, the economy world and a tunnel cell are different cells.

import type { Finish } from './versus-probe';

export const PER_SEED_SCHEMA = 'versus-per-seed/1';

/** One game. `winner` is the END (0 friendly/west, 1 hostile/east), null for a draw. */
export interface PerSeedRow {
  /** The game's index within the cell: seedOf(n) is `seed`. */
  n: number;
  seed: number;
  winner: 0 | 1 | null;
  by: Finish;
  ticks: number;
}

export interface PerSeedCell {
  /** `<map> <cell name> <world>`: unique within a file. */
  key: string;
  map: string;
  /** `<faction>/<faction>` by END, friendly first. */
  arr: string;
  /** `placed`, `economy` or `tunnel-<cell>`. */
  world: string;
  rows: PerSeedRow[];
}

export interface PerSeedFile {
  schema: typeof PER_SEED_SCHEMA;
  seedFrom: number;
  seeds: number;
  rules: 'room' | 'default';
  capSeconds: number;
  /** The formation arm the file was played under: null is the baseline game. `ends` is [friendly, hostile].
   *  `looseAir: 'separate'` is written on a ONE-end arm (S4 (c)) played since the lead's Q2 ruling (GH-859 P1c): the
   *  loose end orders its aircraft with a separate attack-move. A one-end file without it was played with the aircraft
   *  inside the one combined order, a different comparator, and the gate refuses to pair it. */
  formation: { id: string; ends: [boolean, boolean]; looseAir?: 'separate' } | null;
  cells: PerSeedCell[];
}

const FINISHES: readonly string[] = ['annihilation', 'mutual', 'stalemate', 'cap'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The file, checked to the field; a sentence per fault. `where` names the file in the sentences. */
export function parsePerSeed(raw: unknown, where: string): { file: PerSeedFile; faults: string[] } {
  const faults: string[] = [];
  const bad = (m: string): void => { faults.push(`${where}: ${m}`); };
  const empty: PerSeedFile = { schema: PER_SEED_SCHEMA, seedFrom: 0, seeds: 0, rules: 'room', capSeconds: 0, formation: null, cells: [] };
  if (!isObj(raw)) { bad('not a JSON object'); return { file: empty, faults }; }
  if (raw.schema !== PER_SEED_SCHEMA) bad(`schema is ${JSON.stringify(raw.schema)}, not ${PER_SEED_SCHEMA}`);
  if (!Number.isInteger(raw.seedFrom)) bad('seedFrom is not a whole number');
  if (!Number.isInteger(raw.seeds)) bad('seeds is not a whole number');
  if (raw.rules !== 'room' && raw.rules !== 'default') bad('rules is not room or default');
  if (typeof raw.capSeconds !== 'number') bad('capSeconds is not a number');
  let formation: PerSeedFile['formation'] = null;
  if (raw.formation !== null) {
    const f = raw.formation;
    if (isObj(f) && typeof f.id === 'string' && Array.isArray(f.ends) && f.ends.length === 2 && f.ends.every((e) => typeof e === 'boolean')) {
      formation = { id: f.id, ends: [f.ends[0] as boolean, f.ends[1] as boolean] };
      if (f.looseAir === 'separate') formation.looseAir = 'separate';
      else if (f.looseAir !== undefined) bad('formation.looseAir is neither absent nor "separate"');
    } else bad('formation is neither null nor {id, ends: [boolean, boolean]}');
  }
  const cells: PerSeedCell[] = [];
  if (!Array.isArray(raw.cells)) bad('cells is not an array');
  else {
    raw.cells.forEach((c: unknown, i) => {
      if (!isObj(c) || typeof c.key !== 'string' || typeof c.map !== 'string' || typeof c.arr !== 'string' || typeof c.world !== 'string' || !Array.isArray(c.rows)) {
        bad(`cell ${i} lacks key, map, arr, world or rows`);
        return;
      }
      const rows: PerSeedRow[] = [];
      c.rows.forEach((r: unknown, j) => {
        if (!isObj(r) || !Number.isInteger(r.n) || !Number.isInteger(r.seed) || !(r.winner === 0 || r.winner === 1 || r.winner === null)
          || typeof r.by !== 'string' || !FINISHES.includes(r.by) || !Number.isInteger(r.ticks)) {
          bad(`cell ${c.key as string} row ${j} is not {n, seed, winner: 0|1|null, by, ticks}`);
          return;
        }
        rows.push({ n: r.n as number, seed: r.seed as number, winner: r.winner, by: r.by as Finish, ticks: r.ticks as number });
      });
      cells.push({ key: c.key, map: c.map, arr: c.arr, world: c.world, rows });
    });
  }
  return {
    file: faults.length > 0 ? empty : {
      schema: PER_SEED_SCHEMA, seedFrom: raw.seedFrom as number, seeds: raw.seeds as number, rules: raw.rules as 'room' | 'default',
      capSeconds: raw.capSeconds as number, formation, cells,
    },
    faults,
  };
}
