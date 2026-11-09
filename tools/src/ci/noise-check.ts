// GH-943 WebGPU-primary (P1 T1): the zero-noise check on a node key. The `workflow_dispatch` job `webgpu-noise` runs it.
//
//   pnpm --filter @lions/tools exec tsx src/ci/noise-check.ts --gpu=webgl2|webgpu [--runs=24] [--scenario=quiet] [--port=5186]
//
// `backend-gates` already proves N captures in fresh PAGES of one browser are byte-identical. This is the stronger claim the parity
// job stands on: N captures in N FRESH PROCESSES (a new dev server, a new browser, a new GPU device each) are byte-identical, so the
// node arm's reading is a deterministic function of the build and any later ratio moves only because the code moved. Each process is
// `backend-gates --runs=1`; this file only runs them and compares the PNG hashes (`bitIdenticalVerdict`).
//
// Exit: 0 all N identical, 1 not identical, 2 a child was refused or failed (a capture that did not run cannot agree with the others).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bitIdenticalVerdict } from '../golden-diff/backend-gates';
import { parseGpuArm } from '../golden-diff/backend';

const TAG = 'noise-check';
const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function noiseExit(hashes: readonly string[], runs: number, childFailures: number): number {
  if (childFailures > 0) return 2;
  return bitIdenticalVerdict(hashes, runs).ok ? 0 : 1;
}

export function main(argv: readonly string[]): number {
  const arg = (n: string): string | undefined => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const arm = parseGpuArm(arg('gpu'));
  if (arm === null || arm === 'legacy') {
    console.error(`[${TAG}] --gpu must be webgl2 or webgpu`);
    return 2;
  }
  const runs = Number(arg('runs') ?? '24');
  if (!Number.isInteger(runs) || runs < 2) {
    console.error(`[${TAG}] --runs must be an integer >= 2 (one capture agrees with itself)`);
    return 2;
  }
  const scenario = arg('scenario') ?? 'quiet';
  const port = arg('port') ?? '5186';
  const root = path.resolve(TOOLS, '..', arg('out-dir') ?? 'noise-check-output', arm);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const hashes: string[] = [];
  let failures = 0;
  for (let i = 0; i < runs; i++) {
    const out = path.join(root, String(i));
    const r = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'src/ci/backend-gates.ts', `--gpu=${arm}`, `--scenario=${scenario}`, '--runs=1', `--port=${port}`, `--out-dir=${out}`],
      { cwd: TOOLS, stdio: 'inherit' }
    );
    const png = path.join(out, arm, 'run-0.png');
    if (r.status !== 0 && r.status !== 1) failures++; // 1 is "pictures differ", which one run cannot be; 2 is a refusal
    if (existsSync(png)) hashes.push(createHash('sha256').update(readFileSync(png)).digest('hex'));
    else failures++;
    console.log(`[${TAG}] ${arm} process ${i + 1}/${runs}: exit ${String(r.status)}, ${hashes[i]?.slice(0, 12) ?? 'NO PNG'}`);
  }
  const verdict = bitIdenticalVerdict(hashes, runs);
  console.log(`[${TAG}] ${arm} ${scenario}: ${failures > 0 ? 'FAIL (a process failed)' : verdict.ok ? 'PASS' : 'FAIL'} -- ${verdict.message} (${runs} fresh processes)`);
  writeFileSync(path.join(root, 'hashes.json'), JSON.stringify({ arm, scenario, runs, hashes }, null, 2));
  return noiseExit(hashes, runs, failures);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
