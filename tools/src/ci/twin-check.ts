// GH-943 WebGPU-primary (P1 T1): the SAME-PR RULE, enforced (design section 8).
//
//   pnpm --filter @lions/tools exec tsx src/ci/twin-check.ts --base=<ref>            # the files changed since <ref> (two-dot)
//   pnpm --filter @lions/tools exec tsx src/ci/twin-check.ts --files=a.ts,b.ts        # an explicit list (tests, local use)
//
// A ported area has two shader sources until the P7 cutover: the legacy GLSL file and its `X.node.ts` twin (`TWINS`, in
// tools/webgpu_ratchet.mjs). A PR that changes the legacy file and not the twin leaves the two looking different, silently, and
// the parity job only finds it later. So: for every TWINS row whose twin EXISTS, a changed legacy file without a changed twin
// is a violation (exit 1). A row whose twin does not exist yet is not armed (reported, not failed). No allowlist.
//
// Exit codes: 0 clean, 1 a violation, 2 usage (no input, or an unreadable base).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TWINS } from '../../webgpu_ratchet.mjs';

export interface TwinRow {
  readonly legacy: string;
  readonly twin: string;
}

export function twinRows(table: Readonly<Record<string, string>> = TWINS): TwinRow[] {
  return Object.entries(table).map(([legacy, twin]) => ({ legacy, twin }));
}

export interface TwinVerdict {
  readonly violations: string[];
  readonly armed: number;
  readonly unarmed: string[];
}

/** Pure. `exists(twin)` says whether the twin is on disk; `changed` is the set of repo-relative paths the PR touched. */
export function twinVerdict(changed: readonly string[], rows: readonly TwinRow[], exists: (rel: string) => boolean): TwinVerdict {
  const touched = new Set(changed.map((f) => f.replace(/\\/g, '/')));
  const violations: string[] = [];
  const unarmed: string[] = [];
  let armed = 0;
  for (const r of rows) {
    if (!exists(r.twin)) {
      unarmed.push(`${r.legacy} (twin ${r.twin} not written yet)`);
      continue;
    }
    armed++;
    if (touched.has(r.legacy) && !touched.has(r.twin)) {
      violations.push(`${r.legacy} changed without ${r.twin}: the same-PR rule (a ported area's GLSL and its node twin change together)`);
    }
  }
  return { violations, armed, unarmed };
}

export interface TwinIo {
  readonly root: string;
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
  /** Files changed since `base`; throws when `base` cannot be read. */
  readonly changedSince: (base: string, root: string) => string[];
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const realIo: TwinIo = {
  root: REPO_ROOT,
  log: (l) => console.log(l),
  err: (l) => console.error(l),
  changedSince: (base, root) =>
    execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
};

export function runTwinCheck(argv: readonly string[], io: TwinIo = realIo, table: Readonly<Record<string, string>> = TWINS): number {
  const arg = (n: string): string | undefined => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const files = arg('files');
  const base = arg('base');
  let changed: string[];
  if (files !== undefined) changed = files.split(',').filter((f) => f.length > 0);
  else if (base !== undefined) {
    try {
      changed = io.changedSince(base, io.root);
    } catch (e) {
      io.err(`[twin-check] cannot read the diff against "${base}": ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
  } else {
    io.err('[twin-check] pass --base=<ref> or --files=<a,b>');
    return 2;
  }
  const rows = twinRows(table);
  if (rows.length === 0) {
    io.err('[twin-check] the TWINS table is empty: a check over nothing passes vacuously, so it is refused');
    return 2;
  }
  const v = twinVerdict(changed, rows, (rel) => existsSync(path.join(io.root, rel)));
  io.log(`[twin-check] ${changed.length} changed file(s); ${v.armed} of ${rows.length} twin rows armed`);
  for (const u of v.unarmed) io.log(`[twin-check]   not armed: ${u}`);
  for (const x of v.violations) io.err(`[twin-check] VIOLATION: ${x}`);
  io.log(`[twin-check] ${v.violations.length === 0 ? 'PASS' : 'FAIL'}`);
  return v.violations.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runTwinCheck(process.argv.slice(2));
}
