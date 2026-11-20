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
import { ABD_TICKS, abductAdvance, abductWorld } from './runtime-abduct-world.test-helper';
import { FWD_TICKS, forwardAdvance, forwardDrive, forwardWorld } from './runtime-forward-world.test-helper';
import { sinkAdvance, sinkDrive, sinkWorld } from './runtime-sink-world.test-helper';
import { VW_TICKS, versusWorksAdvance, versusWorksDrive, versusWorksWorld } from './runtime-versus-works-world.test-helper';
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

/**
 * The forward-camp world (GH-277 follow-on): a production work raised by an engineer, its line appended at the tail of
 * side 0's lines the tick it completes (136), then items queued on both lines, a rally, a refused off-menu build and a
 * cancel. The only world in which `appendedAnchors`, the tail of `lines[0]` and a COMPLETED work's rows hold a value
 * other than their build value, so a cut at 20 (a site staked), 100 (mid-build), 136 (the completion tick), 250 and 300
 * (items on both lines) restores each state.
 */
export const FORWARD_WORLD: RuntimeWorldSpec = {
  name: `the forward-camp world (${FWD_TICKS} ticks)`,
  ticks: FWD_TICKS,
  hooks: {
    build: (): RuntimeWorld => {
      const { sim, rt } = forwardWorld();
      return { sim, runtime: rt };
    },
    drive: (w, t) => {
      forwardDrive(w.runtime, t);
    },
    advance: (w) => {
      forwardAdvance({ sim: w.sim, rt: w.runtime });
    },
    hashEvery: 20,
  },
};

/**
 * The versus works world (the lead's ruling, 18 Nov 2026): a WORKS-ONLY runtime, both sides raising from their own purses.
 * The only world in which the side-1 rows (`worksOfferList1`, `worksPending1`, `worksSites1`, `appendedAnchors1`) hold a value
 * other than their build value: a cut at 3 (both sides staking), 100 (side 1's camp mid-build), 150 (its line appended),
 * 200 (a side-1 post charged and walking) and 330 (that post cancelled part-built) restores each state.
 */
export const VERSUS_WORKS_WORLD: RuntimeWorldSpec = {
  name: `the versus works world (${VW_TICKS} ticks)`,
  ticks: VW_TICKS,
  hooks: {
    build: (): RuntimeWorld => {
      const { sim, rt } = versusWorksWorld();
      return { sim, runtime: rt };
    },
    drive: (w, t) => {
      versusWorksDrive(w.sim, w.runtime, t);
    },
    advance: (w) => {
      versusWorksAdvance({ sim: w.sim, rt: w.runtime });
    },
    hashEvery: 20,
  },
};

/**
 * The abduct world (GH-1438 E8 pacing): the only runtime here whose mission has an `abduct` trigger, so the only one that carries
 * the `when: 'abduct'` row `abductPace`. The escort outwalks its captive, so pacing halts it (a positive word) and walks it on
 * (0) every 42 ticks from 51; a `withdraw_to` at 600 turns it OFF (-2). A cut at 3 (before the abduct), 60 (a halt), 80
 * (walking on) and 610 (off) restores each state.
 */
export const ABDUCT_WORLD: RuntimeWorldSpec = {
  name: `the abduct world (${ABD_TICKS} ticks)`,
  ticks: ABD_TICKS,
  hooks: {
    build: (): RuntimeWorld => {
      const { sim, rt } = abductWorld();
      return { sim, runtime: rt };
    },
    drive: () => {},
    advance: (w) => {
      abductAdvance({ sim: w.sim, rt: w.runtime });
    },
    hashEvery: 20,
  },
};
