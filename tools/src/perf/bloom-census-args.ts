// GH-943 WebGPU-primary P1 (T5): which renderer arm the bloom census reads, and how Chromium is launched for it.
//
// `--gpu=` already named the HARDWARE (`metal` | `swiftshader`, `ui-review/gpu.ts`). It now ALSO takes an ARM
// (`legacy` | `webgl2` | `webgpu`, `golden-diff/backend.ts`), the same vocabulary as the visual gate's `--gpu=`. An arm value picks
// the renderer; the hardware then comes from `--hw=` (default: the platform's, as before). A hardware value keeps working and means
// the legacy arm, so every existing invocation reads exactly as it did.
import { chromiumArgsFor, parseGpuArm, GPU_ARMS, type GpuArm } from '../golden-diff/backend';
import { gpuLaunchArgs, resolveGpuBackend, type GpuBackend } from '../ui-review/gpu';

export interface CensusGpu {
  readonly arm: GpuArm;
  readonly hardware: GpuBackend;
  /** `chromium.launch({ args })`. A node arm's own flags go LAST, so the WebGPU adapter flags are not shadowed. */
  readonly launchArgs: string[];
}

function last(argv: readonly string[], flag: string): string | undefined {
  const hit = argv.filter((a) => a.startsWith(`${flag}=`)).at(-1);
  return hit === undefined ? undefined : hit.slice(flag.length + 1);
}

export function resolveCensusGpu(argv: readonly string[], platform: NodeJS.Platform): CensusGpu {
  const raw = last(argv, '--gpu');
  const isArm = raw !== undefined && (GPU_ARMS as readonly string[]).includes(raw);
  const arm: GpuArm = isArm ? (parseGpuArm(raw) as GpuArm) : 'legacy';
  // A hardware choice: `--hw=` for an arm run, `--gpu=` itself otherwise (resolveGpuBackend throws on a bad value, as ever).
  const hwArgv = isArm ? (last(argv, '--hw') === undefined ? [] : [`--gpu=${last(argv, '--hw')}`]) : argv.filter((a) => a === '--gpu' || a.startsWith('--gpu='));
  const hardware = resolveGpuBackend(hwArgv, platform);
  // The WebGPU arm runs Dawn on SwiftShader/Vulkan (`chromiumArgsFor`); it supplies its own ANGLE flag, so the hardware flags are
  // the baseline and the arm's follow.
  // On Metal the WebGPU arm is Dawn on the Apple adapter, so it must NOT carry `chromiumArgsFor`'s SwiftShader/Vulkan flags (their
  // trailing `--use-angle=swiftshader` would win and the census would read a software rasteriser while stating Metal). GH-943 P1 T9.
  const nodeArgs = arm === 'webgpu' && hardware === 'metal' ? ['--enable-unsafe-webgpu'] : chromiumArgsFor(arm);
  return { arm, hardware, launchArgs: [...gpuLaunchArgs(hardware), ...nodeArgs] };
}
