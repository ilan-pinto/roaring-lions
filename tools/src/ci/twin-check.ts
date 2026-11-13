// GH-943 WebGPU-primary (P1 T1): the SAME-PR RULE, enforced (design section 8).
//
//   pnpm --filter @lions/tools exec tsx src/ci/twin-check.ts --base=<ref>            # the files the branch changed since it left <ref> (three-dot: against merge-base(<ref>, HEAD))
//   pnpm --filter @lions/tools exec tsx src/ci/twin-check.ts --files=a.ts,b.ts        # an explicit list (tests, local use)
//
// A ported area has two shader sources until the P7 cutover: the legacy GLSL file and its `X.node.ts` twin (`TWINS`, in
// tools/webgpu_ratchet.mjs). A PR that changes the legacy file and not the twin leaves the two looking different, silently, and
// the parity job only finds it later. So: for every TWINS row whose twin EXISTS, a changed legacy file without a changed twin
// is a violation (exit 1). A row whose twin does not exist yet is not armed (reported, not failed).
//
// The ONE narrow exemption (`EXEMPTIONS`, GH-1227 lead ruling): a change to a legacy file's NON-shader code (lifecycle such as `dispose` or
// `onBeforeRender` chaining) that the node twin has no equivalent of. It is VERIFIED, not declared: the checker diffs the file against
// `--base` at line level and honours the exemption only when no changed line (old side or new side) lies inside a GLSL template literal
// (`/* glsl */` backtick strings) or, for an exemption that declares one (`Exemption.span`), its shader-building span (flipbook-fx.ts:
// `const SOFT_ANCHORS` .. `export const FLIPBOOK_SHADERS`). It fails CLOSED: with `--files` (no base to diff), a file with no GLSL
// literal, a declared span whose markers cannot be found, or any touched shader line, the same-PR rule applies in full.
//
// The base is resolved to `git merge-base <ref> HEAD` first. Diffing HEAD against the base TIP is wrong the moment the base moves a twin file
// after the branch was cut: every older branch then "changes" that file and fails. If no merge-base is reachable (a history too shallow to
// hold it), that is exit 2, never a pass.
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

/** A file's shader-building code outside its GLSL literals: from the first line matching `from` to the first matching `to`. */
export interface ShaderSpan {
  readonly from: RegExp;
  readonly to: RegExp;
}

/** flipbook-fx.ts splices its programs in TS between these two declarations (GH-1227). */
export const FLIPBOOK_SPAN: ShaderSpan = { from: /^const SOFT_ANCHORS\b/, to: /^export const FLIPBOOK_SHADERS\b/ };

export interface Exemption {
  readonly file: string;
  readonly reason: string;
  /** The only scope the checker can verify: every changed line lies outside the file's shader program. */
  readonly scope: 'outside-shader';
  /** Extra shader-building lines beyond the GLSL literals; when declared and not found, the file fails closed. */
  readonly span?: ShaderSpan;
}

const UPLOAD_REASON = "buffer-upload calls for the node path's drawn-prefix uploads (GH-1152); no shader line; the node twins build from the record";

export const EXEMPTIONS: readonly Exemption[] = [
  {
    file: 'packages/render/src/three/units/flipbook-fx.ts',
    reason: 'TS lifecycle (dispose, onBeforeRender chaining) has no node-twin equivalent; the twin builds from the record, not from the mesh hooks',
    scope: 'outside-shader',
    span: FLIPBOOK_SPAN,
  },
  // Lead ruling, 12 Nov (PR 1292): the same verified scope; these two build their programs only in `/* glsl */` literals, so no span.
  { file: 'packages/render/src/three/units/fx.ts', reason: UPLOAD_REASON, scope: 'outside-shader' },
  { file: 'packages/render/src/three/units/overlays.ts', reason: UPLOAD_REASON, scope: 'outside-shader' },
];

/**
 * 1-based line numbers of `src` that belong to the shader program: every GLSL template literal (the glsl-tagged backtick strings),
 * plus `span` when given. Null (fail closed) when the file has no GLSL literal, or when `span` is given and its markers cannot be
 * found in order.
 */
export function shaderLines(src: string, span?: ShaderSpan): Set<number> | null {
  const lines = src.split('\n');
  const out = new Set<number>();
  let literals = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/\/\*\s*glsl\s*\*\/\s*`/.test(lines[i] ?? '')) continue;
    literals++;
    let j = i;
    // The closing backtick is the first one after the opening line's own.
    if (((lines[i] ?? '').match(/`/g) ?? []).length < 2) {
      j = i + 1;
      while (j < lines.length && !(lines[j] ?? '').includes('`')) j++;
    }
    for (let k = i; k <= Math.min(j, lines.length - 1); k++) out.add(k + 1);
    i = j;
  }
  if (literals === 0) return null;
  if (span === undefined) return out;
  const a = lines.findIndex((l) => span.from.test(l));
  const b = lines.findIndex((l) => span.to.test(l));
  if (a < 0 || b < a) return null;
  for (let k = a; k <= b; k++) out.add(k + 1);
  return out;
}

/** Pure. True iff every hunk (`git diff -U0` text) touches only lines outside the shader on both sides. */
export function hunksOutsideShader(diffU0: string, oldSrc: string, newSrc: string, span?: ShaderSpan): boolean {
  const oldShader = shaderLines(oldSrc, span);
  const newShader = shaderLines(newSrc, span);
  if (oldShader === null || newShader === null) return false;
  let hunks = 0;
  for (const m of diffU0.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    hunks++;
    const oldStart = Number(m[1]);
    const oldLen = m[2] === undefined ? 1 : Number(m[2]);
    const newStart = Number(m[3]);
    const newLen = m[4] === undefined ? 1 : Number(m[4]);
    for (let k = 0; k < oldLen; k++) if (oldShader.has(oldStart + k)) return false;
    for (let k = 0; k < newLen; k++) if (newShader.has(newStart + k)) return false;
    // A pure insertion BETWEEN two shader lines (old side empty) is inside the shader even though no new line is flagged.
    if (oldLen === 0 && oldShader.has(oldStart) && oldShader.has(oldStart + 1)) return false;
  }
  return hunks > 0;
}

export interface TwinVerdict {
  readonly violations: string[];
  readonly armed: number;
  readonly unarmed: string[];
  readonly exempted: string[];
}

/** Pure. `exists(twin)` says whether the twin is on disk; `changed` is the set of repo-relative paths the PR touched. */
export function twinVerdict(
  changed: readonly string[],
  rows: readonly TwinRow[],
  exists: (rel: string) => boolean,
  /** Whether `file`'s change is verified to lie outside its shader program; absent (no base) means never. */
  outsideShader: (file: string) => boolean = () => false,
  exemptions: readonly Exemption[] = EXEMPTIONS,
): TwinVerdict {
  const touched = new Set(changed.map((f) => f.replace(/\\/g, '/')));
  const violations: string[] = [];
  const unarmed: string[] = [];
  const exempted: string[] = [];
  let armed = 0;
  for (const r of rows) {
    if (!exists(r.twin)) {
      unarmed.push(`${r.legacy} (twin ${r.twin} not written yet)`);
      continue;
    }
    armed++;
    if (touched.has(r.legacy) && !touched.has(r.twin)) {
      const ex = exemptions.find((e) => e.file === r.legacy);
      if (ex !== undefined && outsideShader(r.legacy)) {
        exempted.push(`${r.legacy}: ${ex.reason}`);
        continue;
      }
      violations.push(`${r.legacy} changed without ${r.twin}: the same-PR rule (a ported area's GLSL and its node twin change together)`);
    }
  }
  return { violations, armed, unarmed, exempted };
}

export interface TwinIo {
  readonly root: string;
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
  /** The fork point of `base` and HEAD (`git merge-base`); throws when none is reachable. */
  readonly mergeBase: (base: string, root: string) => string;
  /** Files changed since `base`; throws when `base` cannot be read. */
  readonly changedSince: (base: string, root: string) => string[];
  /** True iff `file`'s diff against `base` touches no shader line (see `hunksOutsideShader`); throws when it cannot tell. */
  readonly outsideShader: (base: string, file: string, root: string, span?: ShaderSpan) => boolean;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const realIo: TwinIo = {
  root: REPO_ROOT,
  log: (l) => console.log(l),
  err: (l) => console.error(l),
  mergeBase: (base, root) => execFileSync('git', ['merge-base', base, 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  changedSince: (base, root) =>
    execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  outsideShader: (base, file, root, span) => {
    const git = (args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return hunksOutsideShader(git(['diff', '-U0', base, 'HEAD', '--', file]), git(['show', `${base}:${file}`]), git(['show', `HEAD:${file}`]), span);
  },
};

export function runTwinCheck(argv: readonly string[], io: TwinIo = realIo, table: Readonly<Record<string, string>> = TWINS): number {
  const arg = (n: string): string | undefined => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const files = arg('files');
  const baseRef = arg('base');
  let base: string | undefined;
  let changed: string[];
  if (files !== undefined) changed = files.split(',').filter((f) => f.length > 0);
  else if (baseRef !== undefined) {
    try {
      base = io.mergeBase(baseRef, io.root);
      changed = io.changedSince(base, io.root);
    } catch (e) {
      io.err(`[twin-check] cannot read the diff against the merge-base with "${baseRef}": ${e instanceof Error ? e.message : String(e)}`);
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
  const outside = (file: string): boolean => {
    if (base === undefined) return false; // --files: nothing to diff, so the exemption cannot be verified
    try {
      return io.outsideShader(base, file, io.root, EXEMPTIONS.find((e) => e.file === file)?.span);
    } catch {
      return false;
    }
  };
  const v = twinVerdict(changed, rows, (rel) => existsSync(path.join(io.root, rel)), outside);
  io.log(`[twin-check] ${changed.length} changed file(s); ${v.armed} of ${rows.length} twin rows armed`);
  for (const u of v.unarmed) io.log(`[twin-check]   not armed: ${u}`);
  for (const x of v.exempted) io.log(`[twin-check]   exempt (change verified outside the shader program): ${x}`);
  for (const x of v.violations) io.err(`[twin-check] VIOLATION: ${x}`);
  io.log(`[twin-check] ${v.violations.length === 0 ? 'PASS' : 'FAIL'}`);
  return v.violations.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runTwinCheck(process.argv.slice(2));
}
