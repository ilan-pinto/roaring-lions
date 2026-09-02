// The failure paths of the capture harness, which is the point: both bugs
// these guard against shipped because their failure path had never been run
// once, anywhere. `visual-baseline-bless` run 33591712714 was the first time a
// scenario failed to capture on CI and the first time the deploy gate met a
// cold Linux runner, and both went wrong on that first contact.
//
// Every test here drives the failure, not the happy path. The stub page is a
// real state machine rather than a mock that returns a constant -- a stub that
// hands back "gone: true" on the first call cannot distinguish the fixed
// dismissal from the broken one, and that is exactly the kind of test this
// change is a reaction to.

import { describe, expect, it } from 'vitest';
import { dismissDeployGate, guardCapture, type DeployGatePage } from './capture-guard';
import { BASELINES, isGated } from './baseline';

/**
 * A stand-in for `ui/loading.ts`'s deploy gate with the real timing hazard in
 * it: the button is in the DOM from the start, and its click HANDLER is
 * attached only on the `liveOnPoll`-th poll (1-based). A click before that is
 * accepted and does nothing at all, exactly as `HTMLElement.click()` on a
 * button with no listener does.
 */
function stubDeployGate(liveOnPoll: number): DeployGatePage & { polls: number; clicks: number; removed: boolean } {
  const state = {
    polls: 0,
    clicks: 0,
    removed: false,
    async waitForSelector(): Promise<unknown> {
      return null;
    },
    async evaluate<R>(fn: () => R): Promise<R> {
      // Run the real page function against a tiny DOM stand-in rather than
      // reimplementing what it does, so the thing under test is the shipped
      // `DEPLOY_GATE_POLL` and not a paraphrase of it.
      const self = state;
      const doc = {
        querySelector(sel: string): unknown {
          if (self.removed) return null;
          if (sel === '.rl-loading') return {};
          return {
            click(): void {
              self.clicks += 1;
              if (self.polls >= liveOnPoll) self.removed = true;
            },
          };
        },
      };
      const prev = (globalThis as { document?: unknown }).document;
      (globalThis as { document?: unknown }).document = doc;
      try {
        state.polls += 1;
        return fn();
      } finally {
        (globalThis as { document?: unknown }).document = prev;
      }
    },
    async waitForTimeout(): Promise<void> {
      /* no real waiting in a unit test */
    },
  };
  return state;
}

describe('dismissDeployGate', () => {
  it('keeps clicking until the loading screen is actually gone', async () => {
    // The handler goes live only on the 6th poll. The old implementation
    // clicked exactly once, at a moment it guessed from the progress text, and
    // a guess that lands early is lost forever -- `main.ts` never gets past
    // `await loading.done()` and `window.__lions` is never assigned.
    const page = stubDeployGate(6);
    const lines: string[] = [];
    const result = await dismissDeployGate(page, 'test', { intervalMs: 0, log: (l) => lines.push(l) });

    expect(page.removed).toBe(true);
    expect(result.clicks).toBe(6);
    expect(lines.join('\n')).toContain('5 landed before the handler was attached and were lost');
  });

  it('reports a single click when the handler was live immediately', async () => {
    const page = stubDeployGate(1);
    const lines: string[] = [];
    const result = await dismissDeployGate(page, 'test', { intervalMs: 0, log: (l) => lines.push(l) });

    expect(result.clicks).toBe(1);
    // The count is the whole diagnostic: 1 means nothing was swallowed, so the
    // "were lost" clause must NOT appear or it would report a race that did
    // not happen.
    expect(lines.join('\n')).not.toContain('were lost');
  });

  it('throws with the boot it was waiting on, rather than timing out somewhere else', async () => {
    // A handler that never goes live: this is the state the Linux runner was
    // actually in, and it used to surface 30 s later as an unexplained
    // `waitForFunction` timeout with no mention of the deploy gate at all.
    const page = stubDeployGate(Number.POSITIVE_INFINITY);
    await expect(
      dismissDeployGate(page, 'test', { intervalMs: 0, timeoutMs: 0, log: () => {} })
    ).rejects.toThrow(/deploy gate was still up.*loading\.done/s);
  });
});

describe('guardCapture', () => {
  it('rethrows a GATED scenario capture failure', async () => {
    // The inverse mistake, and the more dangerous one: a gated scenario that
    // silently "passes" because it could not be captured is the green-ticking
    // no-op this gate was rebuilt to end.
    await expect(
      guardCapture(true, 'test/quiet', () => Promise.reject(new Error('boom')), () => {})
    ).rejects.toThrow('boom');
  });

  it('lets a REPORT-ONLY scenario fail without taking the run down', async () => {
    const warnings: string[] = [];
    const outcome = await guardCapture(
      false,
      'test/combat',
      () => Promise.reject(new Error('page.waitForFunction: Timeout 30000ms exceeded.')),
      (l) => warnings.push(l)
    );

    expect(outcome.ok).toBe(false);
    expect(warnings.join('\n')).toContain('CAPTURE FAILED');
    expect(warnings.join('\n')).toContain('REPORT-ONLY');
  });

  it('passes a successful capture straight through', async () => {
    const outcome = await guardCapture(true, 'test/quiet', () => Promise.resolve(42));
    expect(outcome).toEqual({ ok: true, value: 42 });
  });

  it('reads report-only status from the shipped scenario table', () => {
    // Binds the rule to the real config rather than to a literal: `combat` is
    // the one scenario whose capture failure is survivable, and it is
    // survivable BECAUSE it cannot vote. Promoting it to gated, or ungating a
    // scenario that does vote, must move this.
    expect(isGated(BASELINES.combat)).toBe(false);
    for (const id of ['quiet', 'open-ground', 'vehicle', 'relief']) {
      expect(isGated(BASELINES[id])).toBe(true);
    }
  });
});
