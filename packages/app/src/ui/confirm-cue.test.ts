// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmCueTarget, installConfirmCue, markConfirm } from './confirm-cue';

let remove: (() => void) | null = null;
afterEach(() => {
  remove?.();
  remove = null;
  document.body.innerHTML = '';
});

const button = (label: string): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  document.body.appendChild(b);
  return b;
};

describe('the confirm cue (polish pass F, A8)', () => {
  it('a marked primary action plays it once per click; an unmarked button plays nothing', () => {
    const play = vi.fn();
    remove = installConfirmCue(document, play);
    const deploy = button('Deploy');
    markConfirm(deploy);
    const other = button('Settings');
    deploy.click();
    expect(play).toHaveBeenCalledTimes(1);
    other.click();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('a click on a child of the marked control counts (an icon inside a link)', () => {
    const play = vi.fn();
    remove = installConfirmCue(document, play);
    const a = document.createElement('a');
    a.href = '#';
    const span = document.createElement('span');
    a.appendChild(span);
    document.body.appendChild(a);
    markConfirm(a);
    span.click();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('a disabled, aria-disabled or locked control is not a confirmation', () => {
    const b = button('Deploy');
    markConfirm(b);
    expect(confirmCueTarget(b)).toBe(true);
    b.disabled = true;
    expect(confirmCueTarget(b)).toBe(false);
    b.disabled = false;
    b.setAttribute('aria-disabled', 'true');
    expect(confirmCueTarget(b)).toBe(false);
    b.removeAttribute('aria-disabled');
    b.dataset.locked = '1';
    expect(confirmCueTarget(b)).toBe(false);
  });

  it('runs in the capture phase, so a handler that stops propagation cannot swallow it', () => {
    const play = vi.fn();
    remove = installConfirmCue(document, play);
    const b = button('Save');
    markConfirm(b);
    b.addEventListener('click', (e) => e.stopPropagation());
    b.click();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('the remover takes the listener off', () => {
    const play = vi.fn();
    const off = installConfirmCue(document, play);
    off();
    const b = button('Deploy');
    markConfirm(b);
    b.click();
    expect(play).not.toHaveBeenCalled();
  });
});
