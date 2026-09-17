// packages/app/src/shell/router.ts
/**
 * The shell's router: one persistent stage, one screen mounted at a time,
 * real paths under the Pages base, and a redirect for every pre-router
 * query URL so the tools and bookmarks that drive the app by `?sandbox=`,
 * `?mission=` and `?campaign` keep working for a release.
 *
 * Pure parts first (matchPath, stripBase, legacyRedirect) so the shapes are
 * testable without a DOM; the Router class below is the thin history layer.
 *
 * Three things a reader may get wrong:
 * - A mount may be async (a mission boots for seconds). A navigation that
 *   arrives while an earlier mount is still pending must WIN: the earlier
 *   mount's disposer is called the moment it resolves and its screen is
 *   never shown. `seq` is that guard, and `req.signal` lets a long mount
 *   stop early instead of finishing work nobody will see.
 * - The stage's own children are the only thing the router removes. Screens
 *   that mount chrome on document.body (the HUD does) remove it in their
 *   own disposer — that is the contract, not an oversight.
 * - `href()` is base-prefixed; `navigate()` accepts base-prefixed hrefs,
 *   base-relative paths and legacy query URLs alike, and normalises.
 */

export type Disposer = () => void;

export interface RouteRequest {
  name: string;
  params: Readonly<Record<string, string>>;
  query: URLSearchParams;
  /** Base-relative path, e.g. `/mission/x`. */
  path: string;
  /** Aborted when this route is left, including while its mount is pending. */
  signal: AbortSignal;
}

export type Mount = (stage: HTMLElement, req: RouteRequest) => Disposer | Promise<Disposer>;

export interface RouteDef {
  name: string;
  /** `/`, `/campaign`, `/mission/:id` — one `:param` per segment, no wildcards. */
  pattern: string;
  mount: Mount;
}

export interface RouterOptions {
  /** `import.meta.env.BASE_URL`: `/` in dev, `/<repo>/` on Pages. Always ends in `/`. */
  base: string;
  stage: HTMLElement;
  routes: readonly RouteDef[];
  notFound: Mount;
  /** Crossfade length; 0 in tests. Reduced motion is honoured by the CSS, not here. */
  transitionMs?: number;
}

const DEFAULT_SANDBOX_MAP = 'beit_sahwan_outskirts';

export function matchPath(pattern: string, path: string): Readonly<Record<string, string>> | null {
  const want = pattern.split('/').filter((s) => s.length > 0);
  const got = path.split('/').filter((s) => s.length > 0);
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i];
    const g = got[i];
    if (w.startsWith(':')) {
      try {
        params[w.slice(1)] = decodeURIComponent(g);
      } catch {
        return null;
      }
    } else if (w !== g) {
      return null;
    }
  }
  return params;
}

export function stripBase(base: string, pathname: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  if (b.length === 0) return pathname.length === 0 ? '/' : pathname;
  if (pathname === b) return '/';
  if (pathname.startsWith(`${b}/`)) return pathname.slice(b.length);
  return pathname;
}

/**
 * The pre-router URL contract, exactly as `main.ts` read it: `mission` beats
 * `sandbox` (the old guard checked mission first); a bare or empty `sandbox`
 * meant the default map; `sandboxes` (plural) was the picker. Every other key
 * — `renderer`, `fresh`, `tutorial`, the sandbox flags, `nosw` — rides along.
 */
export function legacyRedirect(search: string): { path: string; query: URLSearchParams } | null {
  const q = new URLSearchParams(search);
  const take = (k: string): string | null => {
    const v = q.get(k);
    q.delete(k);
    return v;
  };
  if (q.has('mission')) return { path: `/mission/${encodeURIComponent(take('mission') ?? '')}`, query: q };
  if (q.has('sandbox')) {
    const map = take('sandbox');
    return { path: `/free-play/${encodeURIComponent(map && map.length > 0 ? map : DEFAULT_SANDBOX_MAP)}`, query: q };
  }
  if (q.has('sandboxes')) {
    take('sandboxes');
    return { path: '/free-play', query: q };
  }
  if (q.has('campaign')) {
    take('campaign');
    return { path: '/campaign', query: q };
  }
  if (q.has('brigade')) {
    take('brigade');
    return { path: '/brigade', query: q };
  }
  return null;
}

/**
 * `URLSearchParams.toString()`, except that a value-less key renders BARE.
 *
 * `toString()` spells an empty value as `tunnel=`, and the sandbox flags are
 * value-less by design: `routes.sandbox()` writes `?tunnel&sur`, `sandboxHelp()`
 * prints `&sur`, CLAUDE.md's examples say `&sur`, and `readFlags` asks `has`.
 * Without this, clicking a picker link whose own `href` says `?tunnel&sur`
 * left `?tunnel=&sur=` in the address bar -- the same URL, in a second
 * spelling, which is exactly the drift `shell/links.ts` exists to prevent.
 *
 * Built per pair through `URLSearchParams` rather than `encodeURIComponent`
 * so a key or value with a `&`, `=` or space is escaped by the same rules
 * `toString()` would have used; only the trailing `=` of an empty value is
 * dropped. Both spellings parse back identically, so this changes what the
 * player SEES and nothing about what the app reads.
 */
function queryString(query: URLSearchParams): string {
  return [...query]
    .map(([k, v]) => {
      const pair = new URLSearchParams([[k, v]]).toString();
      return v === '' ? pair.slice(0, -1) : pair;
    })
    .join('&');
}

interface Mounted {
  req: RouteRequest;
  dispose: Disposer;
  abort: AbortController;
}

export class Router {
  private readonly routes: RouteDef[];
  private readonly base: string;
  private readonly stage: HTMLElement;
  private readonly notFound: Mount;
  private readonly transitionMs: number;
  private mounted: Mounted | null = null;
  /** The abort controller for a mount currently in flight (awaiting its `mount()` call), or null between navigations. */
  private inflight: AbortController | null = null;
  private seq = 0;
  private pending: Promise<void> = Promise.resolve();
  private readonly onPop = (): void => {
    // Dispatched immediately, exactly like navigate() below: a back/forward
    // that arrives while an earlier navigation is still mounting must be able
    // to preempt it right away rather than queue behind it.
    this.pending = this.mountLocation(false, null);
  };

  constructor(opts: RouterOptions) {
    this.routes = [...opts.routes];
    this.base = opts.base.endsWith('/') ? opts.base : `${opts.base}/`;
    this.stage = opts.stage;
    this.notFound = opts.notFound;
    this.transitionMs = opts.transitionMs ?? 200;
  }

  register(route: RouteDef): void {
    this.routes.push(route);
  }

  current(): RouteRequest | null {
    return this.mounted?.req ?? null;
  }

  href(path: string, query?: URLSearchParams): string {
    const p = path.startsWith('/') ? path.slice(1) : path;
    const qs = query && [...query.keys()].length > 0 ? `?${queryString(query)}` : '';
    return `${this.base}${p}${qs}`;
  }

  /** Mounts the current location, redirecting a legacy query URL to its path first. */
  async start(opts: { drop?: readonly string[] } = {}): Promise<void> {
    window.addEventListener('popstate', this.onPop);
    const legacy = legacyRedirect(window.location.search);
    if (legacy) {
      for (const k of opts.drop ?? []) legacy.query.delete(k);
      window.history.replaceState(null, '', this.href(legacy.path, legacy.query));
    } else if (opts.drop && opts.drop.length > 0) {
      const q = new URLSearchParams(window.location.search);
      for (const k of opts.drop) q.delete(k);
      window.history.replaceState(null, '', this.href(stripBase(this.base, window.location.pathname), q));
    }
    await this.mountLocation(false, null);
  }

  /** Resolves once every navigation issued so far has settled. */
  idle(): Promise<void> {
    return this.pending;
  }

  navigate(href: string, opts: { replace?: boolean; force?: boolean } = {}): Promise<void> {
    const url = new URL(href, window.location.href);
    const legacy = legacyRedirect(url.search);
    const path = legacy ? legacy.path : stripBase(this.base, url.pathname);
    const query = legacy ? legacy.query : new URLSearchParams(url.search);
    const target = this.href(path, query);
    const same = this.mounted !== null && this.mounted.req.path === path && this.mounted.req.query.toString() === query.toString();
    if (same && !opts.force) return this.pending;
    if (opts.replace) window.history.replaceState(null, '', target);
    else window.history.pushState(null, '', target);
    // Dispatched immediately, not chained behind `this.pending`: a mount can be
    // async and slow (a mission boots for seconds), and a navigation that
    // arrives while an earlier one is still mounting must be able to win the
    // race right away rather than queue behind it. `mountLocation`'s `seq`
    // guard is what makes the loser's eventual resolution a no-op disposal.
    const p = this.mountLocation(true, opts.force ? path : null);
    this.pending = p;
    return p;
  }

  dispose(): void {
    window.removeEventListener('popstate', this.onPop);
    this.seq++;
    this.unmount();
  }

  private unmount(): void {
    // A mount still in flight (never reached `this.mounted`) is aborted here
    // too, not just the currently-mounted screen -- otherwise dispose() (which
    // calls this) or a navigation arriving mid-mount would leave that mount's
    // `req.signal` unaborted until it happens to resolve on its own.
    this.inflight?.abort();
    this.inflight = null;
    const m = this.mounted;
    this.mounted = null;
    if (!m) return;
    m.abort.abort();
    m.dispose();
    this.stage.replaceChildren();
  }

  private async mountLocation(animate: boolean, force: string | null): Promise<void> {
    const path = stripBase(this.base, window.location.pathname);
    const query = new URLSearchParams(window.location.search);
    if (
      force === null &&
      this.mounted !== null &&
      this.mounted.req.path === path &&
      this.mounted.req.query.toString() === query.toString()
    ) {
      return;
    }
    const seq = ++this.seq;
    let def: RouteDef | null = null;
    let params: Readonly<Record<string, string>> = {};
    for (const r of this.routes) {
      const p = matchPath(r.pattern, path);
      if (p) {
        def = r;
        params = p;
        break;
      }
    }
    // Unmount happens synchronously, right after claiming `seq`, with no
    // `await` in between: that atomicity is what lets a second, overlapping
    // navigate() call see the correct (already-cleared) `this.mounted` the
    // moment it runs, rather than racing this one to decide who tears the
    // old screen down. The leave animation is cosmetic and comes after --
    // and since an interrupted earlier call may still be mid-fade, every
    // call clears any leftover leave class unconditionally right here. That
    // makes the earlier call's own (guarded, below) removal a harmless
    // no-op instead of the winner inheriting someone else's faded-out stage.
    const hadPrevious = this.mounted !== null;
    this.unmount();
    this.stage.classList.remove('rl-stage--leave');
    if (animate && hadPrevious && this.transitionMs > 0) {
      this.stage.classList.add('rl-stage--leave');
      await new Promise((r) => setTimeout(r, this.transitionMs));
      // A newer navigation may have taken over while this one was waiting;
      // only the current call may still touch the shared stage class list.
      if (seq === this.seq) this.stage.classList.remove('rl-stage--leave');
    }
    const abort = new AbortController();
    this.inflight = abort;
    const req: RouteRequest = { name: def?.name ?? '404', params, query, path, signal: abort.signal };
    const mount = def?.mount ?? this.notFound;
    let dispose: Disposer;
    try {
      dispose = await mount(this.stage, req);
    } catch (err) {
      if (this.inflight === abort) this.inflight = null;
      if (abort.signal.aborted || seq !== this.seq) return;
      throw err;
    }
    if (this.inflight === abort) this.inflight = null;
    if (seq !== this.seq) {
      abort.abort();
      dispose();
      return;
    }
    this.mounted = { req, dispose, abort };
    if (animate && this.transitionMs > 0) {
      this.stage.classList.add('rl-stage--enter');
      // Unconditional, unlike the leave removal above: `classList.add` on an
      // already-present class does not retrigger its CSS animation, so if
      // this call went stale before its own timer fired, leaving the class
      // stuck would silently break the next navigation's enter animation.
      // There is no "winner inherits it at the wrong opacity" risk here the
      // way there is for leave, since entering is additive, not exclusive.
      setTimeout(() => this.stage.classList.remove('rl-stage--enter'), this.transitionMs);
    }
  }
}

/**
 * Same-origin anchors become navigations. A modifier click, a middle click,
 * `target`, `download` or a foreign origin is left to the browser — a player
 * who wants the campaign in a new tab gets one.
 */
export function interceptLinks(root: HTMLElement | Document, router: Router): Disposer {
  const onClick = (ev: Event): void => {
    if (!(ev instanceof MouseEvent)) return;
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const a = target.closest('a[href]');
    if (!(a instanceof HTMLAnchorElement)) return;
    if (a.target.length > 0 || a.hasAttribute('download')) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    ev.preventDefault();
    void router.navigate(url.pathname + url.search);
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
