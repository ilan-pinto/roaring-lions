// @vitest-environment jsdom
//
// KS-08 (`docs/polish/keyboard-and-saves.md`): every soft navigation left
// focus on <body>, so a keyboard player's next Tab started wherever the
// browser's sequential-focus starting point happened to be, and coming back
// to the menu put them at the top rather than on the item they left from.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router, type Disposer, type Mount } from './router';

/** A screen of plain links, the way the shell screens are built. */
function screen(links: [string, string][], opts: { focusOwn?: string } = {}): Mount {
  return (host): Disposer => {
    const wrap = document.createElement('div');
    const h = document.createElement('h1');
    h.textContent = 'Title';
    wrap.appendChild(h);
    for (const [label, href] of links) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      wrap.appendChild(a);
    }
    host.appendChild(wrap);
    if (opts.focusOwn) wrap.querySelector<HTMLElement>(`a[href="${opts.focusOwn}"]`)?.focus();
    return () => wrap.remove();
  };
}

function rig(): { router: Router; stage: HTMLElement } {
  const stage = document.createElement('main');
  document.body.appendChild(stage);
  window.history.replaceState(null, '', '/');
  const router = new Router({
    base: '/',
    stage,
    transitionMs: 0,
    routes: [
      { name: 'menu', pattern: '/', mount: screen([['Campaign', '/campaign'], ['Brigade', '/brigade'], ['Saves', '/saves']]) },
      { name: 'brigade', pattern: '/brigade', mount: screen([['Card', '/brigade#a'], ['Back', '/']]) },
      { name: 'saves', pattern: '/saves', mount: screen([['Load', '/saves#a'], ['Back', '/']], { focusOwn: '/' }) },
      { name: 'mission', pattern: '/mission/:id', mount: screen([['leave', '/campaign']]), focus: false },
    ],
    notFound: screen([]),
  });
  return { router, stage };
}

const label = (): string => (document.activeElement === document.body ? 'BODY' : (document.activeElement?.textContent ?? 'null'));

afterEach(() => {
  document.body.replaceChildren();
});

describe('focus on arrival (KS-08)', () => {
  it('a navigation focuses the new screen’s first control', async () => {
    const { router } = rig();
    await router.start();
    await router.navigate('/brigade');
    expect(label()).toBe('Card');
    router.dispose();
  });

  it('coming back focuses the control that leads where you came from', async () => {
    const { router } = rig();
    await router.start();
    await router.navigate('/brigade');
    await router.navigate('/');
    expect(label()).toBe('Brigade');
    router.dispose();
  });

  it('never scrolls to do it (the PA-13 lesson)', async () => {
    const { router } = rig();
    await router.start();
    const spy = vi.spyOn(HTMLElement.prototype, 'focus');
    await router.navigate('/brigade');
    expect(spy).toHaveBeenCalledWith({ preventScroll: true });
    spy.mockRestore();
    router.dispose();
  });

  it('leaves alone a screen that placed focus itself, a route that opts out, and the first load', async () => {
    const { router } = rig();
    await router.start();
    // the first load: a page the player has not touched yet draws no ring
    expect(label()).toBe('BODY');
    await router.navigate('/saves');
    expect(label()).toBe('Back');
    await router.navigate('/mission/x');
    expect(label()).toBe('BODY');
    router.dispose();
  });
});
