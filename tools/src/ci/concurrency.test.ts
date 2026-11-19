// ci.yml's top-level `concurrency` decides which runs a new run cancels. A pull
// request cancels its own older runs; a push to dev cancels the older dev push
// runs (19 Nov 2026: 30 dev push runs queued with none started); main, which
// runs the release bump, and every other push never share a group and are never
// cancelled. These pins read both expressions straight out of ci.yml and
// EVALUATE them (GitHub's `&&`/`||` return an operand, as JavaScript's do), so
// the strings tested are the strings CI runs. The cases are literals.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');

/** The raw `group:` and `cancel-in-progress:` values of the top-level block, or null. */
function block(text: string): { group: string; cancel: string } | null {
  const lines = text.split('\n');
  const at = lines.indexOf('concurrency:');
  if (at < 0) return null;
  const group = /^ {2}group: (.+)$/.exec(lines[at + 1] ?? '')?.[1];
  const cancel = /^ {2}cancel-in-progress: (.+)$/.exec(lines[at + 2] ?? '')?.[1];
  return group && cancel ? { group, cancel } : null;
}

interface Ctx {
  event_name: string;
  ref: string;
  run_id: string;
  event: { pull_request?: { number: number } };
}

/** Evaluate a value that may hold `${{ ... }}` interpolations. */
function evaluate(value: string, github: Ctx): unknown {
  const format = (f: string, ...a: unknown[]): string => f.replace(/\{(\d+)\}/g, (_, i: string) => String(a[Number(i)]));
  const run = (expr: string): unknown =>
    new Function('github', 'format', `return (${expr.replace(/ == /g, ' === ')});`)(github, format);
  const whole = /^\$\{\{(.*)\}\}$/.exec(value.trim());
  if (whole) return run(whole[1]);
  return value.replace(/\$\{\{(.*?)\}\}/g, (_, e: string) => String(run(e)));
}

const pr = (n: number, run: string): Ctx => ({ event_name: 'pull_request', ref: `refs/pull/${n}/merge`, run_id: run, event: { pull_request: { number: n } } });
const push = (branch: string, run: string): Ctx => ({ event_name: 'push', ref: `refs/heads/${branch}`, run_id: run, event: {} });

describe('ci.yml concurrency', () => {
  const b = block(ci);

  it('the block is found', () => {
    expect(b).not.toBeNull();
  });

  it('a pull request shares a group with its own runs only, and cancels them', () => {
    if (!b) throw new Error('no concurrency block');
    expect(evaluate(b.group, pr(1630, '111'))).toBe('ci-pr-1630');
    expect(evaluate(b.group, pr(1630, '222'))).toBe('ci-pr-1630');
    expect(evaluate(b.group, pr(1631, '333'))).toBe('ci-pr-1631');
    expect(evaluate(b.cancel, pr(1630, '111'))).toBe(true);
  });

  it('a second dev push lands in the first one\'s group and cancels it', () => {
    if (!b) throw new Error('no concurrency block');
    expect(evaluate(b.group, push('dev', '444'))).toBe('ci-dev-push');
    expect(evaluate(b.group, push('dev', '555'))).toBe('ci-dev-push');
    expect(evaluate(b.cancel, push('dev', '555'))).toBe(true);
  });

  it('a main push keeps a group of its own per run and is never cancelled', () => {
    if (!b) throw new Error('no concurrency block');
    expect(evaluate(b.group, push('main', '666'))).toBe('ci-666');
    expect(evaluate(b.group, push('main', '777'))).toBe('ci-777');
    expect(evaluate(b.cancel, push('main', '777'))).toBe(false);
  });

  it('any other push keeps a group of its own per run and is never cancelled', () => {
    if (!b) throw new Error('no concurrency block');
    expect(evaluate(b.group, push('claude/some-branch', '888'))).toBe('ci-888');
    expect(evaluate(b.group, push('devx', '999'))).toBe('ci-999');
    expect(evaluate(b.cancel, push('devx', '999'))).toBe(false);
  });
});
