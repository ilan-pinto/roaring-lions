/**
 * `pnpm replay:verify -- <recording.frames.jsonl> [--build <id>] [--json]` (GH-1398 slice 2): re-sim a recorded match headlessly and say
 * whether it ends where it was recorded.
 *
 * Reports the final state hash (recorded and replayed), and for a version 2 file the first checkpoint, taken every N ticks, whose hash
 * differs, with the window the replay left the recording in. It REFUSES, and replays nothing, a recording of another format or another
 * build (`--build` names the build to check against; default this checkout's `buildId()`, the string a browser on it sends).
 *
 * Exit code: 0 the recording re-sims to its recorded hash at every checkpoint and at the end; 1 it does not (a desync); 2 it was refused,
 * could not be read, or the command line was wrong. Nothing is written, no network is opened and no git is run beyond `buildId()`'s.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildId } from './build-id';
import { verifyRecording, type RecordingVerdict } from './replay-verify';

export interface VerifyCliDeps {
  read: (path: string) => string;
  build: () => string;
}

export interface VerifyCliResult { code: 0 | 1 | 2; out: string }

const USAGE = 'usage: pnpm replay:verify -- <recording.frames.jsonl> [--build <id>] [--json]';

/** The verdict as the lines a person reads. Pure. */
export function describeVerdict(v: RecordingVerdict, path: string, build: string): string {
  if (v.kind === 'refused') return [`replay: ${path}`, `REFUSED (${v.code}): ${v.why}`, `verifying on build ${build}; nothing was replayed`].join('\n');
  const h = v.file.header;
  const lines = [
    `replay: ${path}`,
    `recorded on build ${h.build}; format version ${h.v}`,
    `match: ${h.game.matchup} on ${h.game.map}, seed ${h.game.seed}, ${v.file.end.ticks} ticks, ${v.file.end.outcome} by ${v.file.end.by}`,
  ];
  const checks = v.file.end.checks;
  const checkText = checks === undefined ? 'checkpoints: none in this file (a divergence can be reported, not located)' : `checkpoints: ${v.checked} checked, every ${checks.every} ticks`;
  if (v.kind === 'ok') {
    lines.push(`final state hash: recorded ${v.file.end.referee.hash}, replayed ${v.digest.hash} at tick ${v.digest.tick}`);
    lines.push(`${checkText}, all match`);
    lines.push('OK: the recording re-sims to its recorded state');
    return lines.join('\n');
  }
  lines.push(`final state hash: recorded ${v.recorded.hash} at tick ${v.recorded.tick}, replayed ${v.replayed.hash} at tick ${v.replayed.tick}`);
  lines.push(checkText);
  const d = v.divergence;
  if (d !== null) {
    lines.push(
      d.atEnd
        ? `first divergence: in the last window, after tick ${d.afterTick} and by the end at tick ${d.atTick} (every checkpoint matched; the end hash does not)`
        : `first divergence: checkpoint at tick ${d.atTick}, so between ticks ${d.afterTick} and ${d.atTick}: recorded ${d.recorded}, replayed ${d.replayed}`,
    );
  } else {
    lines.push('first divergence: not located (the file has no checkpoints)');
  }
  lines.push('DESYNC: the recording does not re-sim to its recorded state');
  return lines.join('\n');
}

export function runVerifyCli(argv: readonly string[], deps: VerifyCliDeps): VerifyCliResult {
  let path: string | undefined;
  let build: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--json') json = true;
    else if (a === '--build') {
      build = argv[++i];
      if (build === undefined || build === '') return { code: 2, out: `--build needs a value\n${USAGE}` };
    } else if (a.startsWith('--')) return { code: 2, out: `unknown option ${a}\n${USAGE}` };
    else if (path === undefined) path = a;
    else return { code: 2, out: `one file at a time\n${USAGE}` };
  }
  if (path === undefined) return { code: 2, out: USAGE };
  let text: string;
  try {
    text = deps.read(path);
  } catch (e) {
    return { code: 2, out: `cannot read ${path}: ${e instanceof Error ? e.message : String(e)}` };
  }
  let on: string;
  try {
    on = build ?? deps.build();
  } catch (e) {
    return { code: 2, out: `cannot name this build: ${e instanceof Error ? e.message : String(e)} (pass --build)` };
  }
  const v = verifyRecording(text, { build: on });
  const code: 0 | 1 | 2 = v.kind === 'ok' ? 0 : v.kind === 'desync' ? 1 : 2;
  if (json) {
    const body =
      v.kind === 'refused'
        ? { verdict: 'refused', code: v.code, why: v.why, build: on }
        : v.kind === 'ok'
          ? { verdict: 'ok', ticks: v.digest.tick, hash: v.digest.hash, checked: v.checked }
          : { verdict: 'desync', recorded: v.recorded, replayed: v.replayed, checked: v.checked, divergence: v.divergence };
    return { code, out: JSON.stringify(body) };
  }
  return { code, out: describeVerdict(v, path, on) };
}

function isEntry(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(entry)).href; } catch { return false; }
}

if (isEntry()) {
  // pnpm runs the script in tools/: a relative path means the one the person typed where they typed it.
  const base = process.env.INIT_CWD ?? process.cwd();
  const r = runVerifyCli(process.argv.slice(2), { read: (p) => readFileSync(resolve(base, p), 'utf8'), build: () => buildId() });
  (r.code === 0 ? process.stdout : process.stderr).write(r.out + '\n');
  process.exit(r.code);
}
