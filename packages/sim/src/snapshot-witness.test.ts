import { describe, expect, it } from 'vitest';
import {
  ORDERS_SEED,
  RELIEF_SEED,
  ordersDrive,
  ordersSetup,
  reliefDrive,
  reliefSetup,
  runDrive,
  runSetup,
} from './golden-worlds.test-helper';
import { HASH_SEED, hashWord } from './hash';
import { encodeSim, internals } from './snapshot';
import { configDiff, forkWitness, poisonScratch, type ForkVerdict, type WitnessWorld } from './snapshot-witness';
import type { Sim } from './sim';

// The fork witness on the three runtime-free golden worlds (net sim snapshot S1,
// Task 5): restore a world at tick T onto a fresh one, drive both with the same
// inputs, and require the hash equal at every hash tick AND the canonical
// encodings byte-equal at the end. The routine is `snapshot-witness.ts`, a
// non-test module, so tools/ runs the same proof on the versus worlds.

const RUN_SEED = 0x1310_0001; // the golden 1000-tick replay's own seed
const HORIZON = 200;
const HASH_EVERY = 20;

interface World extends WitnessWorld {
  readonly sim: Sim;
}

interface Golden {
  readonly name: string;
  readonly ticks: number;
  readonly build: () => World;
  readonly drive: (w: World, t: number) => void;
  /** Three snapshot ticks for the poison check. */
  readonly poisonAt: readonly number[];
  /** Whether the poison check must find an unkeyed pool slot to garble (only the battle has any). */
  readonly poisonsPool: boolean;
}

const GOLDEN: readonly Golden[] = [
  {
    name: 'the 1000-tick battle',
    ticks: 1000,
    build: () => runSetup(RUN_SEED),
    drive: (w, t) => runDrive(w.sim, t, (w as ReturnType<typeof runSetup>).ids),
    poisonAt: [300, 500, 700],
    poisonsPool: true,
  },
  {
    name: 'the relief replay (900 ticks)',
    ticks: 900,
    build: () => reliefSetup(RELIEF_SEED, true),
    drive: (w, t) => reliefDrive(w.sim, t, (w as ReturnType<typeof reliefSetup>).up),
    poisonAt: [100, 300, 600],
    poisonsPool: false,
  },
  {
    name: 'the orders replay (900 ticks)',
    ticks: 900,
    build: () => ordersSetup(ORDERS_SEED),
    drive: (w, t) => ordersDrive(w.sim, t, (w as ReturnType<typeof ordersSetup>).ids),
    poisonAt: [50, 300, 600],
    poisonsPool: false,
  },
];

function fork(g: Golden, T: number, extra: { mutate?: (b: World, a: World) => void } = {}): ForkVerdict<World> {
  return forkWitness<World>({ build: g.build, drive: g.drive, T, horizon: HORIZON, hashEvery: HASH_EVERY, ...extra });
}

function expectClean(v: ForkVerdict<World>, label: string): void {
  expect(v.configDifference, `${label}: a config row differs after the restore`).toBeNull();
  expect(v.hashDivergedAt, `${label}: hash diverged`).toBeNull();
  expect(v.encodingEqualAtEnd, `${label}: encodings differ at the end (${v.firstDifference ?? ''})`).toBe(true);
}

describe('fork witness: restore at T, step 200 ticks, hash and encoding equal', () => {
  for (const g of GOLDEN) {
    it(`${g.name}: every T = 0, 50, 100, ... up to its end - 200`, () => {
      let forks = 0;
      for (let T = 0; T + HORIZON <= g.ticks; T += 50) {
        expectClean(fork(g, T), `${g.name} T=${T}`);
        forks++;
      }
      expect(forks).toBeGreaterThan(10);
    });
  }
});

describe('fork witness: scratch and unkeyed pool slots poisoned after the restore', () => {
  for (const g of GOLDEN) {
    it(`${g.name}: stays green at ${g.poisonAt.join(', ')}`, () => {
      let unkeyed = 0;
      for (const T of g.poisonAt) {
        const v = fork(g, T, {
          mutate: (b) => {
            const self = internals(b.sim);
            unkeyed += (self.fieldGoalKey as number[]).filter((k) => k === -1).length;
            poisonScratch(b.sim);
          },
        });
        expectClean(v, `${g.name} poisoned T=${T}`);
      }
      // A poison check that garbles nothing proves nothing: say what it had to garble.
      if (g.poisonsPool) {
        expect(unkeyed, 'unkeyed pool slots garbled').toBeGreaterThan(0);
      }
    });
  }
});

// ---- the self-checks: a witness that cannot fail proves nothing -----------------------------
//
// Each applies ONE mutation to B right after the restore and requires the witness to FAIL
// (hash diverged, or encodings differ at the end). The mutations are the spec's 6.2 table; the
// reason they are permanent tests is CLAUDE.md's "every check gets an input that makes it fail".
// Each also prints whether the HASH alone noticed. That is information, never asserted: the
// hash's blindness depends on the world (spec 6.2 saw `fieldByGoal` leave every hash equal).

const RUN = GOLDEN[0];

function fails(v: ForkVerdict<World>): boolean {
  return v.hashDivergedAt !== null || !v.encodingEqualAtEnd;
}

function report(label: string, v: ForkVerdict<World>): void {
  console.log(
    `self-check ${label}: ${v.hashDivergedAt !== null ? `the hash noticed (tick ${v.hashDivergedAt})` : 'the hash was BLIND'}; ` +
      `${v.encodingEqualAtEnd ? 'encodings equal' : `encodings differ (${v.firstDifference ?? '?'})`}`
  );
}

describe('fork witness: self-checks that must stay red', () => {
  it('fieldByGoal emptied: the encoding differs by the end (the hash stays equal)', () => {
    const v = fork(RUN, 250, {
      mutate: (b) => {
        for (const m of internals(b.sim).fieldByGoal as Map<number, number>[]) m.clear();
      },
    });
    report('fieldByGoal emptied', v);
    expect(fails(v)).toBe(true);
  });

  it('fieldLastIssued zeroed: the encoding differs by the end', () => {
    const v = fork(RUN, 250, {
      mutate: (b) => {
        (internals(b.sim).fieldLastIssued as number[]).fill(0);
      },
    });
    report('fieldLastIssued zeroed', v);
    expect(fails(v)).toBe(true);
  });

  it('rng.state reset to the fresh seed: the hash fails at the first hash tick', () => {
    const T = 300;
    const fresh = RUN.build();
    const v = fork(RUN, T, {
      mutate: (b) => {
        (internals(b.sim).rng as { state: Uint32Array }).state.set((internals(fresh.sim).rng as { state: Uint32Array }).state);
      },
    });
    report('rng.state reset', v);
    expect(fails(v)).toBe(true);
    expect(v.hashDivergedAt, 'the hash covers the RNG words, so it sees this at once').not.toBeNull();
    expect(v.hashDivergedAt as number).toBeLessThanOrEqual(T + HASH_EVERY);
  });

  it('trail zeroed at T = 300 of the 1000-tick world, which digs from tick 0', () => {
    const v = fork(RUN, 300, {
      mutate: (b) => {
        (internals(b.sim).trail as Uint8Array).fill(0);
      },
    });
    report('trail zeroed', v);
    expect(fails(v)).toBe(true);
  });
});

describe('config check: every config row of A equals B after the restore', () => {
  it('two worlds from one setup agree, and a change to a typed, scalar or table row is named', () => {
    const a = RUN.build().sim;
    expect(configDiff(a, RUN.build().sim)).toBeNull();

    const typed = RUN.build().sim;
    (internals(typed).openGrid as Uint8Array)[7] ^= 1;
    expect(configDiff(a, typed)).toBe('openGrid[7]');

    const scalar = RUN.build().sim;
    internals(scalar).seed = (internals(scalar).seed as number) + 1;
    expect(configDiff(a, scalar)).toMatch(/^seed: /);

    const table = RUN.build().sim;
    (internals(table).structureTypes as unknown[]).push({ id: 'extra' });
    expect(configDiff(a, table)).toBe('structureTypes: differs by JSON');
  });
});

// ---- the format pin -------------------------------------------------------------------------

describe('snapshot format pin', () => {
  it('the bytes of the 1000-tick world at tick 500 are pinned', () => {
    const w = RUN.build();
    for (let t = 0; t < 500; t++) {
      RUN.drive(w, t);
      w.sim.tick();
    }
    const bytes = encodeSim(w.sim);
    let h = HASH_SEED;
    for (let i = 0; i < bytes.length; i++) h = hashWord(h, bytes[i]);
    // Pin. `hashWord` folded over every byte of `encodeSim` (one byte per word), unsigned. The
    // bytes are canonical (one state, one string, any engine), so this is the same number on every
    // machine. It moves ONLY in a commit that changes the format or the set of `state` rows on
    // purpose (a row added, removed, reordered or reclassed in snapshot-schema.ts, or a layout
    // change in snapshot.ts), and that commit says "Was <n>." and why. It also moves when sim
    // behaviour changes the state at tick 500, but then the golden hash in determinism.test.ts
    // moves in the same commit and says why there.
    expect(h >>> 0).toBe(2172139112);
  });
});
