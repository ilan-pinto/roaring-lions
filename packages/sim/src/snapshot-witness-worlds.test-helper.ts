import { fx } from './fixed';
import {
  ECONOMY_SEED,
  RELIEF_ECO_B_ORDER_TICK,
  RELIEF_ECO_SEED,
  economyAdvance,
  economyDrive,
  economySetup,
  reliefEconomySetup,
  type EconomyWorld,
} from './golden-worlds.test-helper';
import type { MissionRuntime } from './mission';
import { sinkAdvance, sinkDrive, sinkWorld } from './runtime-sink-world.test-helper';
import type { Sim } from './sim';
import type { WitnessHooks, WitnessWorld } from './snapshot-witness';

// The three worlds with a MissionRuntime that the fork witness carries natively (net sim snapshot S2,
// Task 4): the golden economy replay, the relief economy replay and the sink world, each as the hooks
// `forkWitness` takes. The file name is not matched by vitest's `*.test.ts` glob on purpose, as
// `golden-worlds.test-helper.ts`: it holds no spec.

/** A world whose runtime is always present. */
export interface RuntimeWorld extends WitnessWorld {
  readonly sim: Sim;
  readonly runtime: MissionRuntime;
}

export interface RuntimeWorldSpec {
  readonly name: string;
  readonly ticks: number;
  readonly hooks: Pick<WitnessHooks<RuntimeWorld>, 'build' | 'drive' | 'advance' | 'hashEvery'>;
}

/** The golden economy replay: the driver closes over the replay's own `EconomyWorld`, so the world carries it. */
interface EconomyRuntimeWorld extends RuntimeWorld {
  readonly eco: EconomyWorld;
}

export const ECONOMY_WORLD: RuntimeWorldSpec = {
  name: 'the golden economy replay (2400 ticks)',
  ticks: 2400,
  hooks: {
    build: (): RuntimeWorld => {
      const eco = economySetup(ECONOMY_SEED);
      const w: EconomyRuntimeWorld = { sim: eco.sim, runtime: eco.rt, eco };
      return w;
    },
    // Both worlds make direct runtime calls in their drivers (requestBuild, setRally, cancelBuild), so both are driven.
    drive: (w, t) => economyDrive((w as EconomyRuntimeWorld).eco, t),
    advance: (w) => {
      economyAdvance((w as EconomyRuntimeWorld).eco, w.sim.tickCount);
    },
    hashEvery: 20,
  },
};

export const RELIEF_WORLD: RuntimeWorldSpec = {
  name: 'the relief economy replay (2400 ticks)',
  ticks: 2400,
  hooks: {
    build: (): RuntimeWorld => {
      const { sim, rt } = reliefEconomySetup(RELIEF_ECO_SEED);
      return { sim, runtime: rt };
    },
    // determinism.test.ts `reliefEconomyReplay`: A onto the bench at 5, a refused build at 100 (the cap is full), B up to the pass late.
    drive: (w, t) => {
      if (t === 5) w.sim.queueCommand({ kind: 'move', ids: [0], x: fx.from(24.5), y: fx.from(25.5) });
      if (t === 100) w.runtime.requestBuild('inf_squad');
      if (t === RELIEF_ECO_B_ORDER_TICK) w.sim.queueCommand({ kind: 'move', ids: [1], x: fx.from(24.5), y: fx.from(15.5) });
    },
    advance: (w) => {
      w.runtime.step(w.sim.tick());
    },
    hashEvery: 20,
  },
};

/**
 * The sink world (every container the economy replays leave empty). With `cancelAt` the works site staked at
 * tick 1 is cancelled at that tick, which leaves the sim's vehicle mask equal to the runtime's mask copies again
 * before the next recheck: `terrainVersion` never bumps and the corridor fields keep their stamp.
 */
export function sinkSpec(cancelAt: number | null): RuntimeWorldSpec {
  return {
    name: cancelAt === null ? 'the sink world (400 ticks)' : `the sink world, its site cancelled at ${cancelAt} (400 ticks)`,
    ticks: 400,
    hooks: {
      build: (): RuntimeWorld => {
        const { sim, rt } = sinkWorld();
        return { sim, runtime: rt };
      },
      drive: (w, t) => {
        sinkDrive(w.runtime, t, cancelAt);
      },
      advance: (w) => {
        sinkAdvance({ sim: w.sim, rt: w.runtime });
      },
      hashEvery: 20,
    },
  };
}

export const SINK_WORLD: RuntimeWorldSpec = sinkSpec(null);
/** Staked at tick 1, cancelled at tick 10: the window in which the runtime's mask copies are not the sim's masks. */
export const SINK_WINDOW_WORLD: RuntimeWorldSpec = sinkSpec(10);
