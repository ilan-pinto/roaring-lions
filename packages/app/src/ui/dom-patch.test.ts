// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { patchChildren } from './dom-patch';

const host = (html: string): HTMLElement => {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
};

describe('patchChildren', () => {
  it('writes nothing and returns false for identical html', () => {
    const el = host('<p class="a">hi <b>there</b></p>');
    const p = el.querySelector('p');
    const mutations: MutationRecord[] = [];
    const obs = new MutationObserver((m) => mutations.push(...m));
    obs.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    expect(patchChildren(el, '<p class="a">hi <b>there</b></p>')).toBe(false);
    mutations.push(...obs.takeRecords());
    obs.disconnect();
    expect(mutations).toHaveLength(0);
    expect(el.querySelector('p')).toBe(p);
  });

  it('keeps the element node when only its text changes, and updates the data', () => {
    const el = host('<p><span>10</span></p>');
    const span = el.querySelector('span');
    const text = span?.firstChild;
    expect(patchChildren(el, '<p><span>9</span></p>')).toBe(true);
    expect(el.querySelector('span')).toBe(span);
    expect(span?.firstChild).toBe(text);
    expect(span?.textContent).toBe('9');
  });

  it('updates a changed attribute and removes one that is gone, on the same node', () => {
    const el = host('<i class="a" data-x="1" style="width: 10%"></i>');
    const i = el.querySelector('i');
    expect(patchChildren(el, '<i class="b" style="width: 20%"></i>')).toBe(true);
    expect(el.querySelector('i')).toBe(i);
    expect(i?.getAttribute('class')).toBe('b');
    expect(i?.getAttribute('style')).toBe('width: 20%');
    expect(i?.hasAttribute('data-x')).toBe(false);
  });

  it('replaces a node whose tag differs and only that node', () => {
    const el = host('<p>a</p><span>b</span><em>c</em>');
    const [p, span, em] = [...el.children];
    expect(patchChildren(el, '<p>a</p><b>b</b><em>c</em>')).toBe(true);
    expect(el.children[0]).toBe(p);
    expect(el.children[1]).not.toBe(span);
    expect(el.children[1].tagName).toBe('B');
    expect(el.children[2]).toBe(em);
  });

  it('appends an added child and removes a dropped one', () => {
    const el = host('<p>a</p>');
    const p = el.querySelector('p');
    expect(patchChildren(el, '<p>a</p><p>b</p>')).toBe(true);
    expect(el.children).toHaveLength(2);
    expect(el.children[0]).toBe(p);
    expect(patchChildren(el, '<p>a</p>')).toBe(true);
    expect(el.children).toHaveLength(1);
    expect(el.children[0]).toBe(p);
  });

  it('never strips aria-describedby, which the tooltip machinery owns', () => {
    const el = host('<button data-tip="k">x</button>');
    const b = el.querySelector('button')!;
    b.setAttribute('aria-describedby', 'tip-1');
    expect(patchChildren(el, '<button data-tip="k">x</button>')).toBe(false);
    expect(b.getAttribute('aria-describedby')).toBe('tip-1');
    patchChildren(el, '<button data-tip="k">y</button>');
    expect(b.getAttribute('aria-describedby')).toBe('tip-1');
  });
});
