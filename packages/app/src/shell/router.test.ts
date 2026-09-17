// packages/app/src/shell/router.test.ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  Router,
  interceptLinks,
  legacyRedirect,
  matchPath,
  stripBase,
  type Disposer,
  type RouteRequest,
} from './router';

describe('matchPath', () => {
  it('matches a literal path and no other', () => {
    expect(matchPath('/campaign', '/campaign')).toEqual({});
    expect(matchPath('/campaign', '/campaign/')).toEqual({});
    expect(matchPath('/campaign', '/campaigns')).toBeNull();
    expect(matchPath('/', '/')).toEqual({});
    expect(matchPath('/', '/campaign')).toBeNull();
  });
  it('binds a :param and decodes it', () => {
    expect(matchPath('/mission/:id', '/mission/beit_sahwan_1_recon')).toEqual({ id: 'beit_sahwan_1_recon' });
    expect(matchPath('/mission/:id', '/mission/a%20b')).toEqual({ id: 'a b' });
    expect(matchPath('/mission/:id', '/mission')).toBeNull();
    expect(matchPath('/mission/:id', '/mission/a/b')).toBeNull();
  });
});

describe('stripBase', () => {
  it('removes the Pages base and keeps a leading slash', () => {
    expect(stripBase('/', '/campaign')).toBe('/campaign');
    expect(stripBase('/roaring-lions/', '/roaring-lions/campaign')).toBe('/campaign');
    expect(stripBase('/roaring-lions/', '/roaring-lions/')).toBe('/');
    expect(stripBase('/roaring-lions/', '/roaring-lions')).toBe('/');
    expect(stripBase('/roaring-lions/', '/elsewhere')).toBe('/elsewhere');
  });
});

describe('legacyRedirect', () => {
  it('maps every pre-router screen selector to a path and keeps the rest of the query', () => {
    expect(legacyRedirect('?campaign')).toEqual({ path: '/campaign', query: new URLSearchParams('') });
    expect(legacyRedirect('?brigade')).toEqual({ path: '/brigade', query: new URLSearchParams('') });
    expect(legacyRedirect('?sandboxes')).toEqual({ path: '/free-play', query: new URLSearchParams('') });
    expect(legacyRedirect('?mission=beit_sahwan_1_recon&renderer=three')).toEqual({
      path: '/mission/beit_sahwan_1_recon',
      query: new URLSearchParams('renderer=three'),
    });
    expect(legacyRedirect('?sandbox=tel_marum&tunnel&sur&roe&civ')).toEqual({
      path: '/free-play/tel_marum',
      query: new URLSearchParams('tunnel&sur&roe&civ'),
    });
  });
  it('sends a bare ?sandbox to the default map, as main.ts did', () => {
    expect(legacyRedirect('?sandbox')?.path).toBe('/free-play/beit_sahwan_outskirts');
    expect(legacyRedirect('?sandbox=')?.path).toBe('/free-play/beit_sahwan_outskirts');
  });
  it('leaves a URL with no legacy key alone', () => {
    expect(legacyRedirect('')).toBeNull();
    expect(legacyRedirect('?fresh=1')).toBeNull();
    expect(legacyRedirect('?renderer=pixi')).toBeNull();
  });
  it('prefers mission over sandbox when both are present, as the old guard did', () => {
    expect(legacyRedirect('?sandbox=tel_marum&mission=x')?.path).toBe('/mission/x');
  });
});

function makeRouter(opts: { base?: string; start?: string } = {}) {
  const stage = document.createElement('div');
  document.body.appendChild(stage);
  const log: string[] = [];
  const disposed: string[] = [];
  const mountOf =
    (name: string): ((stage: HTMLElement, req: RouteRequest) => Disposer) =>
    (host, req) => {
      const el = document.createElement('section');
      el.dataset.screen = name;
      el.textContent = JSON.stringify({ params: req.params, q: req.query.toString() });
      host.appendChild(el);
      log.push(`mount:${name}`);
      return () => {
        el.remove();
        disposed.push(name);
      };
    };
  window.history.replaceState(null, '', opts.start ?? '/');
  const router = new Router({
    base: opts.base ?? '/',
    stage,
    transitionMs: 0,
    routes: [
      { name: 'menu', pattern: '/', mount: mountOf('menu') },
      { name: 'campaign', pattern: '/campaign', mount: mountOf('campaign') },
      { name: 'mission', pattern: '/mission/:id', mount: mountOf('mission') },
      {
        name: 'slow',
        pattern: '/slow',
        mount: async (host, req) => {
          await new Promise((r) => setTimeout(r, 20));
          return mountOf('slow')(host, req);
        },
      },
    ],
    notFound: mountOf('404'),
  });
  return { router, stage, log, disposed };
}

describe('Router', () => {
  it('mounts the route for the current location on start', async () => {
    const { router, stage, log } = makeRouter({ start: '/campaign' });
    await router.start();
    expect(log).toEqual(['mount:campaign']);
    expect(stage.querySelector('[data-screen="campaign"]')).not.toBeNull();
    expect(router.current()?.name).toBe('campaign');
  });

  it('redirects a legacy query URL on start with replaceState, keeping the rest of the query', async () => {
    const { router, log } = makeRouter({ start: '/?mission=x&renderer=three' });
    await router.start();
    expect(log).toEqual(['mount:mission']);
    expect(window.location.pathname).toBe('/mission/x');
    expect(window.location.search).toBe('?renderer=three');
    expect(window.history.length).toBeGreaterThan(0);
  });

  it('drops the keys start() is told to drop from the residual query', async () => {
    const { router } = makeRouter({ start: '/?fresh=1' });
    await router.start({ drop: ['fresh'] });
    expect(window.location.search).toBe('');
  });

  it('honours the Pages base when matching and when building hrefs', async () => {
    const { router, log } = makeRouter({ base: '/roaring-lions/', start: '/roaring-lions/campaign' });
    await router.start();
    expect(log).toEqual(['mount:campaign']);
    expect(router.href('/mission/x')).toBe('/roaring-lions/mission/x');
    expect(router.href('/', new URLSearchParams('renderer=pixi'))).toBe('/roaring-lions/?renderer=pixi');
  });

  it('navigate() disposes the current screen before mounting the next, and pushes history', async () => {
    const { router, log, disposed, stage } = makeRouter({ start: '/' });
    await router.start();
    await router.navigate('/campaign');
    expect(disposed).toEqual(['menu']);
    expect(log).toEqual(['mount:menu', 'mount:campaign']);
    expect(stage.children.length).toBe(1);
    expect(window.location.pathname).toBe('/campaign');
  });

  it('navigate() to the current route is a no-op unless force is set', async () => {
    const { router, log } = makeRouter({ start: '/campaign' });
    await router.start();
    await router.navigate('/campaign');
    expect(log).toEqual(['mount:campaign']);
    await router.navigate('/campaign', { force: true });
    expect(log).toEqual(['mount:campaign', 'mount:campaign']);
  });

  it('navigate() accepts a base-prefixed href and a legacy query href', async () => {
    const { router, log } = makeRouter({ base: '/roaring-lions/', start: '/roaring-lions/' });
    await router.start();
    await router.navigate('/roaring-lions/campaign');
    await router.navigate('/roaring-lions/?mission=y');
    expect(log).toEqual(['mount:menu', 'mount:campaign', 'mount:mission']);
    expect(window.location.pathname).toBe('/roaring-lions/mission/y');
  });

  it('a stale slow mount is disposed the moment it resolves, never shown', async () => {
    const { router, log, disposed, stage } = makeRouter({ start: '/' });
    await router.start();
    const slow = router.navigate('/slow');
    await router.navigate('/campaign');
    await slow;
    expect(log).toEqual(['mount:menu', 'mount:campaign', 'mount:slow']);
    expect(disposed).toEqual(['menu', 'slow']);
    expect(stage.querySelector('[data-screen="slow"]')).toBeNull();
    expect(stage.querySelector('[data-screen="campaign"]')).not.toBeNull();
  });

  it('hands every mount an AbortSignal that aborts when the route is left', async () => {
    const { router } = makeRouter({ start: '/' });
    // A plain `let` reassigned only inside the mount closure below is narrowed
    // by TS to its initializer's type (`null`) at every later read, since the
    // compiler can't see the closure's assignment from this scope -- `tsc`
    // then rejects `seen?.aborted` as a property access on `never`. Boxing it
    // in an object sidesteps that narrowing without changing what's asserted.
    const box: { seen: AbortSignal | null } = { seen: null };
    router.register({ name: 'probe', pattern: '/probe', mount: (_h, req) => { box.seen = req.signal; return () => {}; } });
    await router.start();
    await router.navigate('/probe');
    expect(box.seen?.aborted).toBe(false);
    await router.navigate('/campaign');
    expect(box.seen?.aborted).toBe(true);
  });

  it('follows popstate', async () => {
    const { router, log } = makeRouter({ start: '/' });
    await router.start();
    await router.navigate('/campaign');
    window.history.back();
    // jsdom applies a pushState-history `back()` over two macrotask ticks
    // before `window.location` itself reflects it; one tick (as in a naive
    // port of this test) leaves the old pathname in place and the router's
    // own "already here" check makes the dispatch below a no-op. Two ticks
    // is the smallest wait that lets `window.location.pathname` catch up
    // before popstate fires.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    window.dispatchEvent(new PopStateEvent('popstate'));
    await router.idle();
    expect(log.at(-1)).toBe('mount:menu');
  });

  it('mounts notFound for an unknown path', async () => {
    const { router, log } = makeRouter({ start: '/nope' });
    await router.start();
    expect(log).toEqual(['mount:404']);
  });

  it('interceptLinks routes same-origin anchors and leaves the rest to the browser', async () => {
    const { router, log } = makeRouter({ start: '/' });
    await router.start();
    const off = interceptLinks(document, router);
    const a = document.createElement('a');
    a.href = '/campaign';
    document.body.appendChild(a);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await router.idle();
    expect(log.at(-1)).toBe('mount:campaign');

    const ext = document.createElement('a');
    ext.href = 'https://example.com/x';
    document.body.appendChild(ext);
    const ev2 = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    ext.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(false);

    const mod = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });
    a.dispatchEvent(mod);
    expect(mod.defaultPrevented).toBe(false);
    off();
  });

  it('dispose() tears the current screen down and stops listening', async () => {
    const { router, disposed } = makeRouter({ start: '/' });
    await router.start();
    router.dispose();
    expect(disposed).toEqual(['menu']);
  });
});

describe('Router transition', () => {
  it('marks the stage while a screen leaves and enters', async () => {
    const { router, stage } = makeRouter({ start: '/' });
    await router.start();
    const seen: string[] = [];
    const obs = new MutationObserver(() => seen.push(stage.className));
    obs.observe(stage, { attributes: true, attributeFilter: ['class'] });
    await router.navigate('/campaign');
    obs.disconnect();
    expect(seen.some((c) => c.includes('rl-stage--leave'))).toBe(true);
    expect(stage.className.includes('rl-stage--leave')).toBe(false);
    vi.restoreAllMocks();
  });
});
