/**
 * The pure half of `kit-drawcalls.ts`: its argv and its verdict on one
 * reading, apart from the browser so a test can hold both.
 *
 * Two things this file exists to refuse.
 *
 * **An argument nobody recognised.** Strict for the reason `parseWreckArgs`
 * gives: `--tier=3` (one letter short) used to fall through to the default
 * and measure tiers 0 and 3 as if nothing had been asked, and a harness that
 * prints PASS for a question it was not asked is worse than one that stops.
 *
 * **A +0 claim measured on no kit.** The harness exists to show that merging
 * bought kit costs no draw call. On a GLB with no `kit_*` node, tiers 3 and
 * tiers 0 build the SAME template, so a "12 at tiers 3" there is a reading of
 * the tier-0 hull and says nothing about the merge -- yet it printed PASS.
 * Every shipped vehicle read that way until Task 4. Now a tiers > 0 reading
 * with no mesh carrying kit FAILS, unless `--synthetic-kit` grafted one on
 * purpose.
 */
import { KIT_VEHICLES } from '../meshes/kit-contract';
import { RG_SPIN_VEHICLES, RG_TRACK_VEHICLES } from '../meshes/running-gear-contract';
import { resolveGpuBackend, type GpuBackend } from '../ui-review/gpu';

export interface KitDrawcallArgs {
  readonly ids: readonly string[];
  readonly tierLevels: readonly number[];
  readonly n: number;
  readonly gpu: GpuBackend;
  readonly syntheticKit: boolean;
  /** GH-177: measure each vehicle twice in one page, parked and then with every
   *  clone bound to its running-gear material, and require the same count. */
  readonly runningGear: boolean;
}

const USAGE =
  'usage: tsx tools/src/perf/kit-drawcalls.ts [--ids=<id>,<id>] [--tiers=0|1|2|3] [--n=<clones>] ' +
  '[--gpu=metal|swiftshader] [--synthetic-kit] [--running-gear]';

/** The value flags this harness reads, by name (`--<name>=<value>`). */
const VALUE_FLAGS = ['ids', 'tiers', 'n', 'gpu'] as const;
const SYNTHETIC_FLAG = '--synthetic-kit';
const RUNNING_GEAR_FLAG = '--running-gear';
/** `--running-gear`'s default ids: every vehicle that carries running gear. */
export const RUNNING_GEAR_IDS: readonly string[] = [...new Set([...RG_SPIN_VEHICLES, ...RG_TRACK_VEHICLES])].sort();

/** argv -> the run, or a throw naming the argument. The last of a repeated
 *  value flag wins, as `resolveGpuBackend` already does for `--gpu`. */
export function parseKitDrawcallArgs(argv: readonly string[], platform: NodeJS.Platform): KitDrawcallArgs {
  const values = new Map<string, string>();
  let syntheticKit = false;
  let runningGear = false;
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === RUNNING_GEAR_FLAG) {
      runningGear = true;
      continue;
    }
    if (arg === SYNTHETIC_FLAG) {
      syntheticKit = true;
      continue;
    }
    const flag = VALUE_FLAGS.find((name) => arg.startsWith(`--${name}=`));
    // `--gpu` alone is left for `resolveGpuBackend`, which explains it better.
    if (flag === undefined && arg !== '--gpu') throw new Error(`unrecognised argument "${arg}" -- ${USAGE}`);
    if (flag !== undefined) values.set(flag, arg.slice(flag.length + 3));
  }

  const defaults = runningGear ? RUNNING_GEAR_IDS : KIT_VEHICLES;
  const ids = (values.get('ids') ?? defaults.join(',')).split(',').filter((s) => s.length > 0);
  if (ids.length === 0) throw new Error(`--ids names no vehicle -- ${USAGE}`);

  const tiersRaw = values.get('tiers');
  const tierLevels = tiersRaw === undefined ? (runningGear ? [0] : [0, 3]) : [Number(tiersRaw)];
  for (const t of tierLevels) {
    if (tiersRaw === '' || !Number.isInteger(t) || t < 0 || t > 3) {
      throw new Error(`--tiers must be 0, 1, 2 or 3 (got "${tiersRaw}")`);
    }
  }

  const nRaw = values.get('n');
  const n = nRaw === undefined ? 20 : Number(nRaw);
  if (nRaw === '' || !Number.isInteger(n) || n < 1) throw new Error(`--n must be a positive integer (got "${nRaw}")`);

  return { ids, tierLevels, n, gpu: resolveGpuBackend(argv, platform), syntheticKit, runningGear };
}

/** Submissions per vehicle per frame, all three passes: 4 live meshes x 3,
 *  and the D9's 2 x 3 (spec §5's measured table). */
export const EXPECTED_DEFAULT = 12;
export const EXPECTED: Readonly<Record<string, number>> = {
  dozer_d9: 6,
  // The two enemy pickups ship five live meshes (a glass and a metal hull part
  // beside the hull, the rubber and the gun): 5 x 3.
  gun_truck: 15,
  technical: 15,
};

export interface KitReading {
  readonly id: string;
  readonly level: number;
  readonly perVehicle: number;
  /** Live meshes whose geometry carries merged kit (`rlKitBaseCount`). */
  readonly kittedMeshes: number;
  readonly syntheticKit: boolean;
}

/** One reading's verdict: `null` for a pass, else why it fails. */
export function kitReadingFailure(r: KitReading): string | null {
  const want = EXPECTED[r.id] ?? EXPECTED_DEFAULT;
  if (r.perVehicle !== want) return `${r.perVehicle} submissions/vehicle, want ${want}`;
  if (r.level > 0 && r.kittedMeshes === 0 && !r.syntheticKit) {
    return (
      `tiers=${r.level} but no mesh carries kit, so this reads the tier-0 hull and measures no merge -- ` +
      `graft ${r.id}'s kit first (pnpm kit:meshes -- --id=${r.id}, then wreck:meshes and encode:meshes), ` +
      `or pass --synthetic-kit to measure a stand-in`
    );
  }
  return null;
}

export interface RunningGearReading {
  readonly id: string;
  /** Submissions per vehicle, parked (the original material). */
  readonly perVehicle: number;
  /** The template carried `rl_running_gear`. */
  readonly rgSpec: boolean;
  /** Clones bound to a running-gear material (of the run's N). */
  readonly rgBound: number;
  /** Submissions per vehicle with every clone bound. */
  readonly rgPerVehicle: number | null;
  /** Programs added by binding (the design expects at most one). */
  readonly rgPrograms: number | null;
  /** `console.error`s in the page so far: a shader that failed to compile. */
  readonly consoleErrors: number;
}

/** GH-177's +0: the running-gear material must cost no submission, the
 *  shipped Draco file must still carry the tags the loader maps, and the
 *  patched shader must compile. `null` for a pass. */
export function runningGearReadingFailure(r: RunningGearReading): string | null {
  if (!r.rgSpec) return `${r.id}'s shipped GLB carries no rl_running_gear (run pnpm running-gear:meshes, then encode)`;
  if (r.rgBound === 0) return `${r.id}: no clone could be bound -- the Draco-decoded geometry has no _rl_wheel/_rl_track`;
  if (r.rgPerVehicle !== r.perVehicle) return `${r.id}: ${r.rgPerVehicle} submissions/vehicle bound, ${r.perVehicle} parked`;
  if (r.rgPrograms === null || r.rgPrograms > 1) return `${r.id}: binding added ${r.rgPrograms} programs, want at most 1`;
  if (r.consoleErrors > 0) return `${r.id}: ${r.consoleErrors} console error(s) -- did the patched shader compile?`;
  return null;
}
