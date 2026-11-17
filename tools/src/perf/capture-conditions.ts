// The capture-conditions block a performance tool prints at the top of its output (GH-1411).
//
// CLAUDE.md: "State capture conditions with every visual number". docs/PERFORMANCE.md quoted three
// 300-unit frame figures that disagreed by 4.6x because their conditions were scattered through the
// prose, or missing. A tool that prints its own conditions first cannot be quoted without them.
//
// Node only (node:os, node:child_process). The browser half of a harness must not import this file.
//
// Every field is read through `ConditionsEnv`, so a test can hand in a fake machine. A field that
// cannot be read prints `unknown`, never a guess.

import { execFileSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';

export interface ConditionsEnv {
  /** `git rev-parse HEAD`, or null when git cannot answer. */
  gitHead(): string | null;
  /** True when tracked files differ from HEAD (`git status --porcelain -uno` is not empty); null when unknown. */
  gitDirty(): boolean | null;
  nodeVersion: string;
  cpus(): readonly { model: string }[];
  loadavg(): readonly number[];
  now(): Date;
}

export interface CaptureConditions {
  commit: string;
  node: string;
  cpuModel: string;
  cores: string;
  loadAverage: string;
  date: string;
  /** The rendering backend, or `CPU only` for a tool that runs no renderer and no GPU. */
  backend: string;
}

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function git(args: readonly string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

export const NODE_ENV: ConditionsEnv = {
  gitHead: () => {
    const out = git(['rev-parse', 'HEAD']);
    return out === null ? null : out.trim();
  },
  gitDirty: () => {
    const out = git(['status', '--porcelain', '-uno']);
    return out === null ? null : out.trim() !== '';
  },
  nodeVersion: process.version,
  cpus: () => cpus(),
  loadavg: () => loadavg(),
  now: () => new Date(),
};

/** The 1 / 5 / 15 minute load average, two decimals, or `unknown`. */
export function formatLoad(env: Pick<ConditionsEnv, 'loadavg'>): string {
  const l = env.loadavg();
  if (l.length < 3 || l.slice(0, 3).some((n) => !Number.isFinite(n))) return 'unknown';
  return `${l[0].toFixed(2)} / ${l[1].toFixed(2)} / ${l[2].toFixed(2)} (1 / 5 / 15 min)`;
}

export function readConditions(backend: string, env: ConditionsEnv = NODE_ENV): CaptureConditions {
  const head = env.gitHead();
  const dirty = env.gitDirty();
  const commit =
    head === null || !/^[0-9a-f]{7,40}$/i.test(head)
      ? 'unknown'
      : `${head.toLowerCase()}${dirty === null ? ' (tree state unknown)' : dirty ? ' + uncommitted changes to tracked files' : ' (clean)'}`;
  const list = env.cpus();
  const models = [...new Set(list.map((c) => c.model.trim()).filter((m) => m !== ''))];
  return {
    commit,
    node: env.nodeVersion === '' ? 'unknown' : env.nodeVersion,
    cpuModel: models.length === 0 ? 'unknown' : models.join(' + '),
    cores: list.length === 0 ? 'unknown' : String(list.length),
    loadAverage: formatLoad(env),
    date: env.now().toISOString(),
    backend,
  };
}

/** The block's lines, in a fixed order, one field a line. */
export function conditionsBlock(c: CaptureConditions): string[] {
  return [
    'Capture conditions (GH-1411):',
    `  commit:       ${c.commit}`,
    `  node:         ${c.node}`,
    `  cpu:          ${c.cpuModel}`,
    `  cores:        ${c.cores}`,
    `  load average: ${c.loadAverage}`,
    `  date:         ${c.date}`,
    `  backend:      ${c.backend}`,
  ];
}
