// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootFailureCard, bootFailureKind, guardBoot, mountErrorCard, mountInterrupted, watchContextLoss, type BootFailureKind } from './boot-failure';

afterEach(() => {
  document.body.replaceChildren();
});

/** The two errors pass K actually photographed, as three.js throws them. */
function httpError(): Error {
  const e = new Error('fetch for "http://localhost:5241/meshes/buildings/house.glb" responded with 404: Not Found');
  e.name = 'HttpError';
  return e;
}
const noContext = new Error('Error creating WebGL context.');

describe('bootFailureKind', () => {
  it('names a missing WebGL context a graphics failure', () => {
    expect(bootFailureKind(noContext, true)).toBe('graphics');
  });
  it('names any failure on a browser with no WebGL2 a graphics failure', () => {
    expect(bootFailureKind(new Error('boom'), false)).toBe('graphics');
  });
  it('names a 404 from the model loader a download failure', () => {
    expect(bootFailureKind(httpError(), true)).toBe('download');
  });
  it('names a failed fetch and a failed dynamic import download failures', () => {
    expect(bootFailureKind(new TypeError('Failed to fetch'), true)).toBe('download');
    expect(bootFailureKind(new TypeError('Failed to fetch dynamically imported module: /x.js'), true)).toBe('download');
  });
  it('leaves anything else unknown, including a thrown non-Error', () => {
    expect(bootFailureKind(new RangeError('index out of range'), true)).toBe('unknown');
    expect(bootFailureKind('just a string', true)).toBe('unknown');
  });
});

// The words a player reads on a failure. Debug language is what pass K exists
// to keep off this card: the exception's own words, file names, stack frames.
const DEBUG = /error:|\bat\s+\S+:\d|https?:\/\/|\.glb|\.js\b|webgl|context|stack|console|undefined|null/i;

describe('bootFailureCard', () => {
  const kinds: BootFailureKind[] = ['graphics', 'download', 'unknown', 'interrupted'];
  it.each(kinds)('%s: says what happened, why, and what next, in plain words', (kind) => {
    const card = bootFailureCard(kind);
    for (const s of [card.title, card.body, card.next]) {
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toMatch(/^boot\.failed\./); // a missing key reads as itself
      expect(s).not.toMatch(DEBUG);
    }
  });
  it('offers a reload only where trying again can help', () => {
    expect(bootFailureCard('graphics').reload).toBe(false);
    expect(bootFailureCard('download').reload).toBe(true);
    expect(bootFailureCard('unknown').reload).toBe(true);
    expect(bootFailureCard('interrupted').reload).toBe(true);
  });
});

describe('mountErrorCard', () => {
  it('draws the card with the design system controls, and never the error', () => {
    const host = document.createElement('div');
    let reloads = 0;
    mountErrorCard(host, bootFailureCard('download'), '/', () => reloads++);
    const card = host.querySelector('.rl-boot-error');
    expect(card?.getAttribute('role')).toBe('alert');
    expect(host.querySelector('.rl-boot-error__title')?.textContent).toBe(bootFailureCard('download').title);
    expect(host.querySelector('.rl-boot-error__next')?.textContent).toBe(bootFailureCard('download').next);
    const home = host.querySelector('a.rl-btn');
    expect(home?.getAttribute('href')).toBe('/');
    const reload = host.querySelector<HTMLButtonElement>('button.rl-btn.rl-boot-error__reload');
    reload?.click();
    expect(reloads).toBe(1);
    expect(host.textContent ?? '').not.toMatch(DEBUG);
  });
  it('has no reload control on a graphics failure', () => {
    const host = document.createElement('div');
    mountErrorCard(host, bootFailureCard('graphics'), '/');
    expect(host.querySelector('.rl-boot-error__reload')).toBeNull();
  });
});

describe('guardBoot', () => {
  it('passes a successful mount through untouched', async () => {
    const host = document.createElement('div');
    const dispose = (): void => {};
    const failed: unknown[] = [];
    await expect(guardBoot(host, new AbortController().signal, (e) => failed.push(e), Promise.resolve(dispose))).resolves.toBe(dispose);
    expect(failed).toEqual([]);
  });
  it('answers a failed mount on screen instead of rejecting into a blank stage', async () => {
    const host = document.createElement('div');
    const failed: unknown[] = [];
    const dispose = await guardBoot(
      host,
      new AbortController().signal,
      (e) => {
        failed.push(e);
        host.textContent = 'card';
      },
      Promise.reject(noContext),
    );
    expect(failed).toEqual([noContext]);
    expect(host.textContent).toBe('card');
    dispose();
    expect(host.childNodes.length).toBe(0);
  });
  it("leaves a superseded mount's failure to the router", async () => {
    const host = document.createElement('div');
    const abort = new AbortController();
    abort.abort();
    const failed: unknown[] = [];
    await expect(guardBoot(host, abort.signal, (e) => failed.push(e), Promise.reject(noContext))).rejects.toBe(noContext);
    expect(failed).toEqual([]);
  });
});

// K-16.
describe('watchContextLoss', () => {
  const lose = (c: HTMLCanvasElement): void => void c.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  // Falsified: the canvas listener never added -> the first expectation is red.
  it('calls back once when the canvas reports its context lost, however often it says so', () => {
    const canvas = document.createElement('canvas');
    let lost = 0;
    watchContextLoss(canvas, () => lost++);
    lose(canvas);
    lose(canvas);
    expect(lost).toBe(1);
  });
  // Falsified: the returned remover made a no-op -> this is red.
  it('stops listening once the screen has taken it off, so its own teardown is not a loss', () => {
    const canvas = document.createElement('canvas');
    let lost = 0;
    const off = watchContextLoss(canvas, () => lost++);
    off();
    lose(canvas);
    expect(lost).toBe(0);
  });
});

describe('mountInterrupted', () => {
  it('lays the card over the mission with Reload and the way home, in plain words', () => {
    let reloaded = 0;
    const scrim = mountInterrupted(document.body, '/', () => reloaded++);
    expect(scrim.parentElement).toBe(document.body);
    expect(scrim.querySelector('[role="alert"]')).not.toBeNull();
    expect(scrim.querySelector('.rl-boot-error__title')?.textContent).toBe('The picture stopped');
    expect(scrim.querySelector<HTMLAnchorElement>('.rl-boot-error__home')?.getAttribute('href')).toBe('/');
    scrim.querySelector<HTMLButtonElement>('.rl-boot-error__reload')?.click();
    expect(reloaded).toBe(1);
    scrim.remove();
    expect(document.body.querySelector('.rl-boot-scrim')).toBeNull();
  });
});
