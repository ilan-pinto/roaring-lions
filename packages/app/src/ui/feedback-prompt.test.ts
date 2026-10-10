// @vitest-environment jsdom
// The debrief's rating prompt (GH-464, mocks 05-06).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ratingPrompt, type RatingPromptDeps } from './feedback-prompt';
import type { SendResult } from '../feedback/client';

const deps = () => {
  const d = {
    send: vi.fn(async (): Promise<SendResult> => ({ kind: 'sent', ref: 'FB-0001' })),
    onAnswered: vi.fn(),
    onIgnored: vi.fn(),
  } satisfies RatingPromptDeps;
  return d;
};
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
afterEach(() => document.body.replaceChildren());

describe('ratingPrompt', () => {
  it('asks without taking focus: Enter still belongs to the report', () => {
    const primary = document.createElement('a');
    primary.href = '#';
    document.body.appendChild(primary);
    primary.focus();
    const p = ratingPrompt(deps());
    document.body.appendChild(p.el);
    expect(document.activeElement).toBe(primary);
    expect(p.el.querySelectorAll('.rl-rate__n')).toHaveLength(5);
    expect((p.el.querySelector('.rl-rate__line') as HTMLElement).hidden).toBe(true);
  });

  it('a number opens the line; Enter in it sends the rating and the line, and stops the key there', async () => {
    const d = deps();
    const p = ratingPrompt(d);
    document.body.appendChild(p.el);
    (p.el.querySelectorAll('.rl-rate__n')[1] as HTMLButtonElement).click();
    expect(d.onAnswered).toHaveBeenCalledTimes(1);
    const line = p.el.querySelector('.rl-rate__line') as HTMLInputElement;
    expect(line.hidden).toBe(false);
    line.value = 'Lost everyone in the open';
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    line.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    line.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', reached);
    await flush();
    expect(reached).not.toHaveBeenCalled();
    expect(d.send).toHaveBeenCalledWith(2, 'Lost everyone in the open', { keepalive: false });
    expect(p.el.textContent).toContain('Thanks, sent.');
  });

  it('leaving after a number sends the rating alone, on a request that outlives the page', () => {
    const d = deps();
    const p = ratingPrompt(d);
    document.body.appendChild(p.el);
    (p.el.querySelectorAll('.rl-rate__n')[3] as HTMLButtonElement).click();
    (p.el.querySelector('.rl-rate__line') as HTMLInputElement).value = 'typed but never sent';
    p.dispose();
    expect(d.send).toHaveBeenCalledWith(4, '', { keepalive: true });
    expect(d.onIgnored).not.toHaveBeenCalled();
    expect(p.el.isConnected).toBe(false);
  });

  it('leaving with no number counts one ignored ask and sends nothing', () => {
    const d = deps();
    const p = ratingPrompt(d);
    document.body.appendChild(p.el);
    p.dispose();
    p.dispose();
    expect(d.onIgnored).toHaveBeenCalledTimes(1);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('a rating already sent is not sent again on leaving', async () => {
    const d = deps();
    const p = ratingPrompt(d);
    document.body.appendChild(p.el);
    (p.el.querySelectorAll('.rl-rate__n')[0] as HTMLButtonElement).click();
    (p.el.querySelector('.rl-rate__send') as HTMLButtonElement).click();
    await flush();
    p.dispose();
    expect(d.send).toHaveBeenCalledTimes(1);
  });
});
