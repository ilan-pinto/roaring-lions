// GH-943 WebGPU-primary: the ONE thing the `visual-backends` CI job gates on (the lead's ruling of 7 Nov): frame CONTENT.
//
//   pnpm --filter @lions/tools exec tsx src/ci/content-vote.ts --captures=<dir> --log=<file> [--log=<file> ...]
//
// The job's arms are otherwise report-only (no baseline exists for a node arm; the parity bands are voted at the P1 sheet). What may fail a
// PR is a PICTURE that is not one, which PR 1085 taught `capture()` to refuse (`golden-diff/frame-content.ts`):
//   - any GPU validation error the page logged, or
//   - a frame that is black or near-constant (centre-region luma mean or std below 4).
// `capture()` throws a `[label] REFUSED (arm): gpu-validation: ...` / `... frame-content: ...` error. A report-only scenario (combat,
// dusk) catches it and the gate prints it as "CAPTURE FAILED (report-only, ...)", so the refusal is read from the LOGS: that sees both.
// Nothing else votes: not a backend refusal, not a baseline difference, not a parity band.
//
// And a vote with nothing to judge is not a pass: an arm that wrote no capture at all (the renderer threw at boot, the server never came
// up) drew nothing, which is the same finding as a black frame. `--captures` is the arm's output directory; no `.png` in it fails.
//
// Exit codes: 0 every log is clean and the arm captured something; 1 a content refusal, or no captures; 2 usage (no log, unreadable file).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isContentRefusalLine } from '../golden-diff/frame-content';

export interface ContentVoteInput {
  readonly logs: readonly { readonly name: string; readonly lines: readonly string[] }[];
  /** How many capture PNGs the arm wrote. */
  readonly captures: number;
}

export interface ContentVoteResult {
  readonly ok: boolean;
  /** One sentence per reason, each naming where it was read. */
  readonly failures: readonly string[];
}

/** How many refusal lines are quoted per log (the first is the finding; the rest are the count). */
const QUOTED = 3;

export function contentVote(input: ContentVoteInput): ContentVoteResult {
  const failures: string[] = [];
  for (const log of input.logs) {
    const hits = log.lines.filter(isContentRefusalLine);
    if (hits.length === 0) continue;
    const shown = hits.slice(0, QUOTED).map((l) => `    ${l.trim().slice(0, 300)}`).join('\n');
    failures.push(`${log.name}: ${hits.length} content refusal line(s) (a GPU validation error or a black / near-constant frame):\n${shown}`);
  }
  if (input.captures === 0) failures.push('no captures: the arm wrote no picture, so it drew nothing (a vote with nothing to judge is not a pass)');
  return { ok: failures.length === 0, failures };
}

/** The `.png` files under a directory, recursively; a missing directory has none. */
export function countPngs(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) n += countPngs(p);
    else if (entry.toLowerCase().endsWith('.png')) n++;
  }
  return n;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function main(argv: readonly string[]): number {
  const values = (name: string): string[] => argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
  const logFiles = values('log');
  const captureDir = values('captures')[0];
  if (logFiles.length === 0 || captureDir === undefined) {
    console.error('[content-vote] usage: content-vote.ts --captures=<dir> --log=<file> [--log=<file> ...]');
    return 2;
  }
  const logs: { name: string; lines: string[] }[] = [];
  for (const f of logFiles) {
    const file = path.resolve(REPO_ROOT, f);
    if (!existsSync(file)) {
      console.error(`[content-vote] ${f}: no such log (the step that writes it did not run)`);
      return 2;
    }
    logs.push({ name: f, lines: readFileSync(file, 'utf8').split('\n') });
  }
  const captures = countPngs(path.resolve(REPO_ROOT, captureDir));
  const result = contentVote({ logs, captures });
  console.log(`[content-vote] ${logs.length} log(s), ${captures} capture(s) in ${captureDir}`);
  if (result.ok) {
    console.log('[content-vote] PASS: no GPU validation error, no black or near-constant frame');
    return 0;
  }
  for (const f of result.failures) console.log(`[content-vote] FAIL: ${f}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
