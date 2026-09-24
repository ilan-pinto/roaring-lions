// Which GPU backend `shoot.ts` launches Chromium with, and the refusal of an
// unrecognised choice -- the same shape `./port.ts` (`fix/ui-shots-port`)
// uses for its own flag: a pure resolver a test can drive with plain
// arguments, and a thin wrapper that turns a bad one into `process.exit(2)`
// before any browser starts.
//
// `tools/src/perf/unit-plates.ts` sets the precedent this follows: SwiftShader
// (software) is the safe default, and real hardware GPU (`--use-angle=metal`)
// is an opt-in, because Metal is macOS-only and that file measured it
// reproducing its own WebGL-context-loss crash (faster, not fixed) under
// heavy churn. `shoot.ts` inverts the DEFAULT rather than dropping
// SwiftShader entirely, for a reason `unit-plates.ts` did not have to weigh:
// measured directly against the actual defect this file exists to fix
// (`OutcomeMomentDismissedError`), with the frame loop frozen from well
// before the outcome scene ever rendered -- ruling out loop contention --
// `page.screenshot()` of the post-combat scene cost 5.0-7.8s on SwiftShader
// and 115-164ms on Metal, against a fixed 2600ms hold. On a platform with no
// Metal (or any future non-macOS runner), the default falls back to
// SwiftShader automatically rather than passing a Metal-only flag to a
// backend that cannot use it.
const FLAG = '--gpu';

export type GpuBackend = 'metal' | 'swiftshader';

const KNOWN: readonly GpuBackend[] = ['metal', 'swiftshader'];

function isGpuBackend(value: string): value is GpuBackend {
  return (KNOWN as readonly string[]).includes(value);
}

/**
 * `--gpu=<metal|swiftshader>` wins; otherwise `metal` on macOS
 * (`platform === 'darwin'`) and `swiftshader` everywhere else, matching where
 * this file's own Metal args are actually known to work
 * (`backend-curve-gate.ts`/`render-frame-cost.ts` are macOS-only tooling
 * too).
 *
 * Mirrors `resolvePort`'s refusal shape (`./port.ts`): a bare `--gpu` with no
 * `=` or an unrecognised value THROWS rather than falling through to the
 * platform default, which is the failure this exists to prevent -- silently
 * running SwiftShader because of a typo would reproduce the exact defect
 * this backend switch was written to close, with no indication why.
 */
export function resolveGpuBackend(argv: readonly string[], platform: NodeJS.Platform): GpuBackend {
  if (argv.includes(FLAG)) {
    throw new Error(`${FLAG} needs a value: write ${FLAG}=metal or ${FLAG}=swiftshader`);
  }
  const hit = argv.filter((a) => a.startsWith(`${FLAG}=`)).at(-1);
  if (hit === undefined) {
    return platform === 'darwin' ? 'metal' : 'swiftshader';
  }
  const raw = hit.slice(FLAG.length + 1);
  if (isGpuBackend(raw)) return raw;
  throw new Error(`${FLAG}="${raw}" is not a known backend: use ${FLAG}=metal or ${FLAG}=swiftshader`);
}

/** The `chromium.launch({ args })` for a resolved backend. Metal's five flags
 *  are the ones `backend-curve-gate.ts`/`render-frame-cost.ts` already use
 *  for the same real-hardware switch; SwiftShader's are this file's
 *  pre-existing default, unchanged. */
export function gpuLaunchArgs(backend: GpuBackend): string[] {
  return backend === 'metal'
    ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
}

/**
 * Resolves the backend from `process.argv`/`process.platform` and refuses a
 * bad value: one line to stderr and `process.exit(2)`, before any browser or
 * server starts, rather than a thrown stack trace out of a top-level await.
 * Mirrors `claimPort`'s own shape (`./port.ts`).
 */
export function claimGpuBackend(tag: string): GpuBackend {
  let backend: GpuBackend;
  try {
    backend = resolveGpuBackend(process.argv.slice(2), process.platform);
  } catch (err) {
    console.error(`[${tag}] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  console.log(`[${tag}] GPU backend requested: ${backend}`);
  return backend;
}
