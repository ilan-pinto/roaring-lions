import { describe, expect, it, vi } from 'vitest';
import { RUN_SEED, runDrive, runSetup } from './golden-worlds.test-helper';
import { internals } from './snapshot';
import { rowsOf } from './snapshot-schema';
import { forkWitness, stateRowsMoved, type ForkVerdict } from './snapshot-witness';
import type { Sim } from './sim';

// The pre-restore poison (net sim snapshot S1, Task 7c). `forkWitness` fills B with garbage in every
// `state` row BEFORE `restoreSim`, so a restore that skips a row written only at build (`stCx`, `tnLength`,
// `stTiles`, ...) is seen: without it, B was built exactly as A was, already held A's tick-0 value in
// that row, and the skip read as right.
//
// How it is observed without a test seam in production code: this file replaces the `restoreSim` the
// witness imports with a wrapper that calls the real one. The wrapper can look at B at the moment the
// restore is entered, and can emulate "a restore that did not write row X" by putting X back to what it
// held on entry once the real restore has finished. Nothing in `snapshot.ts` or `snapshot-witness.ts`
// knows the wrapper exists.

type Restore = (sim: Sim, bytes: Uint8Array) => unknown;
const hook = vi.hoisted(() => ({ around: null as null | ((sim: unknown, bytes: Uint8Array, real: (sim: unknown, bytes: Uint8Array) => unknown) => unknown) }));
vi.mock('./snapshot', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./snapshot')>();
  return {
    ...orig,
    restoreSim: ((sim: Sim, bytes: Uint8Array) =>
      hook.around === null ? orig.restoreSim(sim, bytes) : hook.around(sim, bytes, orig.restoreSim as Restore as (sim: unknown, bytes: Uint8Array) => unknown)) as Restore,
  };
});

const T = 300;
const HORIZON = 60;
const build = () => runSetup(RUN_SEED);

function fork(): ForkVerdict<ReturnType<typeof build>> {
  return forkWitness({ build, drive: (w, t) => runDrive(w.sim, t, w.ids), T, horizon: HORIZON, hashEvery: 20 });
}

describe('fork witness: B is poisoned before the restore', () => {
  it('on entry to restoreSim every state row, the four pool rows included, differs from a fresh world', () => {
    const fresh = build().sim;
    let moved: Set<string> | null = null;
    let entries = 0;
    hook.around = (sim, bytes, real) => {
      entries++;
      moved = stateRowsMoved(fresh, sim as Sim);
      return real(sim, bytes);
    };
    try {
      const v = fork();
      expect(v.roundTripEqualAtT).toBe(true);
      expect(v.encodingEqualAtEnd).toBe(true);
      expect(v.configDifference, 'config is untouched by the poison').toBeNull();
    } finally {
      hook.around = null;
    }
    expect(entries, 'the witness restores exactly once per fork').toBe(1);
    const want = rowsOf('state').map((r) => r.name).sort();
    expect(Array.from(moved ?? []).sort()).toEqual(want);
  });

  /** Emulates a restore that never wrote one row: the real restore, then the row put back to what it held on entry. */
  const skipping = (put: (sim: Sim) => () => void) => {
    hook.around = (sim, bytes, real) => {
      const undo = put(sim as Sim);
      const out = real(sim, bytes);
      undo();
      return out;
    };
  };
  const column = (name: string) => (sim: Sim): (() => void) => {
    const a = internals(sim)[name] as Int32Array;
    const entry = a.slice();
    return () => a.set(entry);
  };

  const skips: { label: string; row: string; aux?: boolean; mayThrow?: boolean; put: (sim: Sim) => () => void }[] = [
    { label: 'stCx (a typed row written at build)', row: 'stCx', put: column('stCx') },
    { label: 'tnLength (a typed row written at build)', row: 'tnLength', put: column('tnLength') },
    {
      label: 'stTiles (an aux row written at build)',
      row: 'stTiles',
      aux: true,
      put: (sim) => {
        const t = internals(sim).stTiles as number[][];
        const entry = t.map((x) => [...x]);
        return () => {
          t.length = 0;
          for (const x of entry) t.push(x);
        };
      },
    },
    {
      label: 'structureCount_ (a scalar written at build)',
      row: 'structureCount_',
      mayThrow: true,
      put: (sim) => {
        const entry = internals(sim).structureCount_;
        return () => {
          internals(sim).structureCount_ = entry;
        };
      },
    },
  ];

  for (const s of skips) {
    it(`a restore that skips ${s.label} turns the witness red`, () => {
      // The control: the real restore with the row left alone is green.
      hook.around = null;
      const clean = fork();
      expect(clean.hashDivergedAt, 'clean fork: hash').toBeNull();
      expect(clean.roundTripEqualAtT, 'clean fork: round trip').toBe(true);
      expect(clean.encodingEqualAtEnd, `clean fork: ${clean.firstDifference ?? ''}`).toBe(true);
      skipping(s.put);
      try {
        let v: ForkVerdict<ReturnType<typeof build>>;
        try {
          v = fork();
        } catch (e) {
          // A skipped count keeps its garbage and the sim indexes past its tables: a crash is as red as a verdict.
          expect(s.mayThrow, `${s.row} skipped: the fork threw ${String(e)}`).toBe(true);
          return;
        }
        expect(v.roundTripEqualAtT, `${s.row} skipped: the round trip at T`).toBe(false);
        expect(v.encodingEqualAtEnd, `${s.row} skipped`).toBe(false);
        // A typed column or a scalar is named; an aux row lives in the tail, which the message says instead.
        expect(v.firstDifference ?? '').toMatch(s.aux === true ? /outside the state columns/ : new RegExp(`^${s.row}`));
      } finally {
        hook.around = null;
      }
    });
  }
});
