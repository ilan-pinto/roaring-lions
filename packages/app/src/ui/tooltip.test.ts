// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bindTip, closeTip } from './tooltip';

afterEach(() => closeTip());
const tip = (): HTMLElement | null => document.querySelector('.rl-tip');

describe('bindTip', () => {
  it('shows on hover and on focus, and hides on both partners', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    const off = bindTip(el, () => '<b>Conduct</b>');
    expect(tip()?.hidden ?? true).toBe(true);
    el.dispatchEvent(new Event('mouseenter'));
    expect(tip()?.hidden).toBe(false);
    expect(tip()?.innerHTML).toBe('<b>Conduct</b>');
    el.dispatchEvent(new Event('mouseleave'));
    expect(tip()?.hidden).toBe(true);
    el.dispatchEvent(new Event('focus'));
    expect(tip()?.hidden).toBe(false);
    el.dispatchEvent(new Event('blur'));
    expect(tip()?.hidden).toBe(true);
    off();
  });

  it('calls the thunk on every show, so live numbers are live', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    let n = 0;
    const off = bindTip(el, () => `${++n}`);
    el.dispatchEvent(new Event('mouseenter'));
    el.dispatchEvent(new Event('mouseleave'));
    el.dispatchEvent(new Event('mouseenter'));
    expect(tip()?.innerHTML).toBe('2');
    off();
  });

  it('Escape closes it, because a tooltip a keyboard cannot dismiss is a trap', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    const off = bindTip(el, () => 'x');
    el.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tip()?.hidden).toBe(true);
    off();
  });

  it('the disposer removes every listener and hides a tip it was showing', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    const off = bindTip(el, () => 'x');
    el.dispatchEvent(new Event('mouseenter'));
    off();
    expect(tip()?.hidden).toBe(true);
    el.dispatchEvent(new Event('mouseenter'));
    expect(tip()?.hidden).toBe(true);
  });

  it('describes its element for a screen reader while it is up, and stops after', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    const off = bindTip(el, () => 'x');
    el.dispatchEvent(new Event('focus'));
    expect(el.getAttribute('aria-describedby')).toBe(tip()?.id);
    el.dispatchEvent(new Event('blur'));
    expect(el.hasAttribute('aria-describedby')).toBe(false);
    off();
  });
});
