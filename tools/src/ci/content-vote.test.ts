import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { captureRefusalMessage, frameContentRefusal, frameContentStats, isContentRefusalLine, retriedValidationRefusal, validationErrorRefusal } from '../golden-diff/frame-content';
import { contentVote, countPngs } from './content-vote';

/**
 * GH-943 (the lead's ruling of 7 Nov): the `visual-backends` job gates on frame CONTENT only. The vote reads the gate's logs for the two
 * refusals PR 1085 gave `capture()`, and nothing else; an arm that wrote no picture fails too, because a vote with nothing to judge passes
 * vacuously.
 */
const clean = [
  '[three-baseline] scenario "quiet" (GATED): sandbox=beit_sahwan_outskirts targetTick=140',
  '[three-baseline] scenario "quiet" repaint-control: a zero-time repaint moved 0 px / 0.0000 (budget <=0 px / 0) -> PASS',
  '[three-baseline] scenario "quiet" layer "fog": hiding it moved 350387 px / 29.3235 (floor >=116802 px / 9.7) -> PASS',
  'gate arm webgpu: exit 3 in 912s',
];
const black = new Uint8Array(40 * 40 * 4); // all zero: opaque black needs alpha, but the stats read RGB only
const blackStats = frameContentStats(black, 40, 40);

describe('contentVote', () => {
  it('a clean arm that captured something passes', () => {
    expect(contentVote({ logs: [{ name: 'gate-arm.log', lines: clean }], captures: 12 })).toEqual({ ok: true, failures: [] });
  });

  it('a GPU validation error refuses, in the exact words capture() throws (the real producer, wrapped by the real builder)', () => {
    const refusal = validationErrorRefusal(['console.error: GPUValidationError: Invalid BindGroup']);
    expect(refusal).not.toBeNull();
    const line = captureRefusalMessage('quiet', 'webgpu', refusal as string);
    const r = contentVote({ logs: [{ name: 'gate-arm.log', lines: [...clean, line] }], captures: 12 });
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain('gate-arm.log');
    expect(r.failures[0]).toContain('GPUValidationError');
  });

  it('a black frame refuses, in the exact words capture() throws', () => {
    const refusal = frameContentRefusal(blackStats);
    expect(refusal).not.toBeNull();
    const r = contentVote({ logs: [{ name: 'backend-gates.log', lines: [captureRefusalMessage('quiet', 'webgl2', refusal as string)] }], captures: 5 });
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toContain('backend-gates.log');
    expect(r.failures[0]).toContain('black');
  });

  it('a near-constant frame refuses too', () => {
    const flat = frameContentRefusal({ pixels: 1600, meanLuma: 120, stdLuma: 0.5 });
    expect(contentVote({ logs: [{ name: 'g.log', lines: [captureRefusalMessage('relief', 'webgpu', flat as string)] }], captures: 3 }).ok).toBe(false);
  });

  it('a report-only scenario\'s refusal still votes: the gate wraps it as "CAPTURE FAILED (report-only, does not vote)"', () => {
    // Literal, not built from the producers: if a producer ever drops its prefix, this stays red.
    const line =
      '[three-baseline] scenario "dusk" CAPTURE FAILED (report-only, does not vote): [dusk] REFUSED (webgpu): frame-content: the frame is black (mean luma 0.00, std 0.00 over 1600 px; floor mean >= 4)';
    expect(isContentRefusalLine(line)).toBe(true);
    expect(contentVote({ logs: [{ name: 'gate-arm.log', lines: [...clean, line] }], captures: 11 }).ok).toBe(false);
    expect(isContentRefusalLine('Error: [quiet] REFUSED (webgl2): gpu-validation: the page logged 2 GPU validation error(s); the first: "x"')).toBe(true);
  });

  it('only content votes: a backend refusal, a baseline difference and a parity band do not', () => {
    const noise = [
      '[three-baseline] REFUSED "quiet": the page drew through webgl2 but the webgpu arm was asked for',
      '[three-baseline] scenario "vehicle" -> FAIL',
      '[three-baseline]   over budget: meanAbsChannelDelta 0.0144 > 0.004',
      '[parity] webgpu quiet: units OUTSIDE band (0.21 > 0.10)',
      'REFUSED (webgpu): the backend mix is not allowed',
      // the same `[label] REFUSED (arm): ...` shape capture() uses, with a refusal that is not about content: it must not vote
      '[backend-gates/webgpu/0] REFUSED (webgpu): backend: the page reported node-webgl2 but the arm asked for node-webgpu',
      '3 gated scenario(s) differ from the stored baseline: vehicle, kitted, graded',
    ];
    expect(noise.filter(isContentRefusalLine)).toEqual([]);
    expect(contentVote({ logs: [{ name: 'gate-arm.log', lines: noise }], captures: 12 }).ok).toBe(true);
  });

  it('an arm that wrote no capture fails: a vote with nothing to judge is not a pass', () => {
    const r = contentVote({ logs: [{ name: 'gate-arm.log', lines: clean }], captures: 0 });
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([expect.stringContaining('no captures')]);
  });

  it('every log is read: a refusal in the second log fails the vote, and each failure names its log', () => {
    const r = contentVote({
      logs: [
        { name: 'gate-arm.log', lines: clean },
        { name: 'backend-gates.log', lines: ['[quiet] REFUSED (webgpu): frame-content: the frame is near-constant'] },
      ],
      captures: 12,
    });
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([expect.stringContaining('backend-gates.log')]);
  });

  it('quotes at most three refusal lines but counts them all', () => {
    const lines = Array.from({ length: 7 }, (_, i) => `[s${i}] REFUSED (webgpu): gpu-validation: the page logged 1 GPU validation error(s)`);
    const r = contentVote({ logs: [{ name: 'g.log', lines }], captures: 7 });
    expect(r.failures[0]).toContain('7 content refusal line(s)');
    expect(r.failures[0]?.split('\n').filter((l) => l.includes('REFUSED'))).toHaveLength(3);
  });
});

describe('countPngs', () => {
  it('counts .png files under a directory, recursively; a missing directory has none', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'content-vote-'));
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'quiet.png'), '');
    writeFileSync(path.join(dir, 'sub', 'relief.PNG'), '');
    writeFileSync(path.join(dir, 'summary.json'), '{}');
    expect(countPngs(dir)).toBe(2);
    expect(countPngs(path.join(dir, 'nosuch'))).toBe(0);
  });
});

/**
 * The workflow is the half of the gate no unit test above can see: the vote does nothing if the job is allowed to fail, or if its step
 * is gone. Read as text (no YAML dependency): a top-level job runs from `  <name>:` to the next two-space key.
 */
describe('the visual-backends job votes (.github/workflows/ci.yml)', () => {
  const ci = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.github/workflows/ci.yml'), 'utf8');
  const job = (name: string): string => {
    const start = ci.indexOf(`\n  ${name}:\n`);
    expect(start, `job ${name}`).toBeGreaterThan(-1);
    const rest = ci.slice(start + 1);
    // A blank line separates jobs here (none occurs inside one), and the comment that opens the NEXT job sits after it.
    const blank = rest.indexOf('\n\n');
    return blank === -1 ? rest : rest.slice(0, blank + 1);
  };
  const backends = job('visual-backends');
  const header = backends.slice(0, backends.indexOf('    steps:'));

  it('the job may fail the PR: no job-level continue-on-error', () => {
    expect(header).not.toMatch(/continue-on-error/);
  });
  it('its last step is the content vote, and it passes its exit code on', () => {
    const steps = [...backends.matchAll(/\n {6}- (?:name|uses|run): ([^\n]*)/g)].map((m) => m[1] as string);
    expect(steps.at(-1)).toContain('Frame-content vote');
    const vote = backends.slice(backends.indexOf('- name: Frame-content vote'));
    expect(vote).toContain('src/ci/content-vote.ts');
    expect(vote).toContain('--log=gate-arm.log');
    expect(vote).toContain('--log=backend-gates.log');
    expect(vote.trimEnd().endsWith('exit $code')).toBe(true);
    expect(vote).not.toMatch(/continue-on-error/);
  });
  it('the gate arm keeps its log for the vote, and the upload carries it', () => {
    expect(backends).toMatch(/golden-baseline[^\n]*\| tee gate-arm\.log/);
    expect(backends).toMatch(/\n {12}gate-arm\.log\n/);
  });
  it('everything else stays report-only: the other arms end in exit 0, and the parity job still cannot fail the PR', () => {
    const reportOnly = ['Gate arm (report-only, no baseline)', 'Bit-identical captures', 'Ramp card (legacy vs node output stage, report-only)'];
    for (const name of reportOnly) {
      const at = backends.indexOf(`- name: ${name}`);
      expect(at, name).toBeGreaterThan(-1);
      const end = backends.indexOf('\n      - name:', at + 1);
      expect(backends.slice(at, end === -1 ? undefined : end), name).toMatch(/\n\s+exit 0\s*(\n|$)/);
    }
    expect(job('visual-parity')).toMatch(/\n {4}continue-on-error: true\n/);
  });
});

/**
 * Review of PR 1092 (CodeRabbit, verified against browser.ts): `capture()` clears its page errors at the top of every attempt, so a GPU validation
 * error from an attempt that FAILED for another reason (an unsettled frame, a timeout) was printed as a "page said:" line and then forgotten; a clean
 * retry passed, and so did the vote. The retry loop now also prints the refusal line for it.
 */
describe('a GPU validation error from a capture attempt that was retried', () => {
  const err = 'console.error: GPUValidationError: Invalid BindGroup (a depth texture bound with aspect all)';
  it('gets the refusal line the vote reads, and a clean second attempt no longer hides it', () => {
    const line = retriedValidationRefusal('quiet', 'webgpu', [err]);
    expect(line).not.toBeNull();
    expect(isContentRefusalLine(line as string)).toBe(true);
    // the log of a run: attempt 1 failed (unsettled) after the page logged the error; attempt 2 passed; the scenario then finished normally
    const log = [
      '[quiet] capture attempt 1 failed: settled-frame: two zero-time repaints differ',
      `[quiet]   page said: ${err}`,
      line as string,
      ...clean,
    ];
    const r = contentVote({ logs: [{ name: 'gate-arm.log', lines: log }], captures: 12 });
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toContain('GPUValidationError');
    // without the added line the same log votes PASS: that is the hole
    expect(contentVote({ logs: [{ name: 'gate-arm.log', lines: log.filter((l) => l !== line) }], captures: 12 }).ok).toBe(true);
  });
  it('is a node-arm refusal only, and only for a validation error', () => {
    expect(retriedValidationRefusal('quiet', 'legacy', [err])).toBeNull();
    expect(retriedValidationRefusal('quiet', 'webgl2', ['pageerror: boom'])).toBeNull();
    expect(retriedValidationRefusal('quiet', 'webgl2', [])).toBeNull();
  });
  it('is wired into the retry loop, as a log line (the retry itself still happens)', () => {
    const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../golden-diff/browser.ts'), 'utf8');
    const catchAt = src.indexOf('} catch (err) {\n      lastErr = err;');
    expect(catchAt).toBeGreaterThan(-1);
    const block = src.slice(catchAt, src.indexOf('throw new Error(', catchAt));
    expect(block).toContain('retriedValidationRefusal(label, arm, pageErrors)');
    expect(block).toContain('console.warn(lost)');
    expect(block).not.toMatch(/\bthrow\b/);
  });
});
