# Shell Upgrade Phase 1 — "the shell as an application" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the shell from a set of query-string page loads into one application: a client-side router with a persistent stage and disposable screens, a settings screen that persists, a pause menu over a visibly paused world, Continue and save slots that carry both stores, a credits screen, and an i18n seam with every chrome string behind `t()` and a pseudo-locale the capture pass can photograph.

**Architecture:** A small pure router (`packages/app/src/shell/router.ts`) owns `history`, matches base-relative paths against a route table, and mounts one screen at a time into `#stage`; every `show*` returns a disposer. `main.ts` becomes the route table plus one `bootBattlefield()` that returns a disposer for everything a mission puts on the page (the rAF loop, window listeners, body-mounted HUD chrome, the renderer). Settings, keybindings, profile slots and the message catalogue are typed stores with pure parse/serialise functions and a thin DOM layer each, all persisted under `lions.*` keys beside the ledger. Old query URLs redirect to paths on boot for one release, so every tool that drives the app by `?sandbox=`/`?mission=`/`?campaign` keeps working unchanged.

**Tech Stack:** TypeScript strict, vitest (jsdom per file), Vite, Playwright (tools only), `Intl.PluralRules`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-shell-upgrade-design.md` — §6 "Phase 1 — the shell as an application", §5 constraints, §7 evidence, §10 status and the parallel-work boundary. The spec is the binding authority; this plan argues from it and records where it departs (below).

## Global Constraints

Copied from the spec §5 and §10, binding on every task:

- **The sim is untouched.** No file under `packages/sim/**` changes in this phase. A need that looks like a sim change is a missing sim EVENT, raised separately.
- **Colour comes from the palette.** `packages/app/src/ui/theme.css` remains the only file naming an `--rl-*` variable; new tokens are semantic; `pnpm validate:ui` stays at an empty allowlist; translucency is `color-mix()`; no hex or `rgb()` literal anywhere in UI source.
- **Fonts are self-hosted, never a CDN.** This phase adds no font file (see Ruling R-4).
- **Three only under `packages/render/src/three/**`**, and `packages/app` reaches a renderer only through `packages/render/src/api.ts` or the five dynamic-import doors named in `eslint.config.mjs`. Nothing in this plan adds a door.
- **The parallel-work boundary (spec §10):** the art session owns `packages/render/src/three/units/mesh-*.ts`, `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/sheet.ts`, `tools/src/mesh_gait*`, `tools/units/rig.py`, the four Meshy importers, `art/meshes/**`, `assets/meshes/**` and CLAUDE.md's "Mesh units" section until it lands. **Tasks 0–13 touch none of those.** Task 14 touches two lines of `ThreeRenderer.ts` and runs only after `origin/main` carries that landing (see the task).
- **No `any`. No non-null assertion in new code.** Strict TypeScript; tests colocated as `*.test.ts`; every DOM test file opens with `// @vitest-environment jsdom`; `window.localStorage` in that environment is a bare `{}` — guard every access the way `menu.ts`'s `storedRenderer()` does, or take a `StorageLike` parameter and test with a Map-backed fake.
- **The visual gate is blessed, never widened.** No task in this plan should move `quiet`, `open-ground`, `vehicle` or `relief` (the default settings reproduce today's frame exactly). If a CI run shows movement, that is a defect in the task, not a bless.
- **Screens are pure functions.** Every `show*(stage, opts)` returns a disposer; nothing reads `window.location` inside a screen after Task 1 — the route request carries params and query.
- **Every player-facing string is human, and after Task 11 every chrome string is a `t()` key.** No mission id, map id, URL flag or gate expression reaches the DOM.
- **UI scale is one number.** `rem` throughout; a new `px` ≥ 4 in UI CSS fails `pnpm validate:ui` unless the line carries `/* px-ok */`.
- **Every check gets an input that makes it fail — constructed, and run** (CLAUDE.md). Each task's test step names the mutation that turns it red; the commit message says it was seen red.
- **The tool contracts stay whole:** `window.__lions` keeps `sim`, `renderer`, `runtime`, `audio`, `help`, `step`, `goto`, `sel`, `units`, `cursorKey`, `hover` with today's semantics; the frame loop is armed through `window.requestAnimationFrame` so `FREEZE_FRAME_LOOP_STATEMENTS` (`tools/src/golden-diff/capture-protocol.ts:624`) still freezes it; `.rl-loading`, `.rl-loading__deploy`, `.rl-loading__count`, `.rl-world[data-board]`, `.rl-world__canvas canvas` keep their names; a hard navigation to `/` mounts the menu and defines no `__lions` (`tools/src/perf/backend-curve-gate.ts` depends on it).
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`. Nothing here needs `validate:assets`, `validate:meshes`, `balance` or `playtest`; the determinism hash cannot move because the sim does not change.
- **Git hygiene:** commit with explicit paths (`git add <paths>` / `git commit -- <paths>`), never `-A`; never `git checkout -- <file>`; the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` verbatim.

## Rulings taken while planning

Each departs from or narrows the spec's §6 text; each is written into the spec's Deviations at landing as `D-10`…`D-17` with the measurement that justified it.

- **R-1 — `/briefing/:mission` and `/debrief` are not separate screens in Phase 1.** Today the briefing is a mode of `showLoading` fused with asset loading and the deploy gate (`loading.ts:31` `briefingHoldsDeployment`), and the end screen and debrief are overlays painted on the live mission (`main.ts:2349`, `2356`). Splitting them is Phase 3's two-column deploy spread and victory/defeat moments. The route table carries `/briefing/:mission` as a redirect to `/mission/:mission`; `/debrief` is not a route. The overlays stay, but they are now torn down by the mission's disposer (Task 2).
- **R-2 — a `/saves` route is added.** The spec's table has no home for save slots; the menu's aside links to it.
- **R-3 — Controls in settings are the keybinding table and camera speed.** Edge pan and zoom-to-cursor do not exist until Phase 2; a setting for a feature that does not exist is a lie. They join the controls section with the features.
- **R-4 — No CJK faces, and the seam carries `dir`.** `docs/GDD.md:314` names Hebrew as the deferred second locale, which is RTL and not CJK; the spec's "CJK subset" was a guess. The locale table carries `dir`, `document.documentElement.dir` follows it, and the first non-Latin locale brings its own subset under `assets/fonts/` with its OFL text.
- **R-5 — Settings from the pause menu is a panel inside the modal**, not a navigation: navigating to `/settings` would unmount the mission. One `settingsPanel()` component serves both the route and the pause menu.
- **R-6 — The quality preset's render plumbing is the last task**, because it touches `ThreeRenderer.ts`, which the art session holds. The setting is stored and shown from Task 4; the renderer starts reading it in Task 14. Until then the screen says "applies when the next mission starts" and does exactly that once Task 14 lands.
- **R-7 — The credits screen states the licence the project lead decided, and the LICENSE files are aligned to it.** `docs/ART_PIPELINE.md:181` records art and data as "all rights reserved" since 2026-08-30, ahead of a commercial release; `LICENSE:25-26` and `data/LICENSE.md` still say CC BY-SA 4.0. Two files on disk disagree, and a credits screen cannot quote both. Task 8 states the later decision and updates the two stale files in the same commit. **The project lead can reverse this in one line; it is flagged in the landing report.** The Namer IFV model's CC BY 3.0 credit (Mutte, BlendSwap #75225, `docs/ASSET_PROVENANCE.md:39-45`) is mandatory and appears. The jeep sprite set's "LICENCE UNVERIFIED" line (`ASSET_PROVENANCE.md:41`) is NOT credited as anything; it is listed in the landing report for the lead.
- **R-8 — `?fresh` stays accepted for one release** (it is in `KNOWN_PARAMS` and documented in CLAUDE.md); the menu's "New campaign" replaces the `?fresh=1` navigation and names what it keeps.
- **R-9 — `bootBattlefield` stays in `main.ts`.** Moving 2,000 lines into a new file would make the review diff unreadable for a mechanical reason. The extraction is a function boundary inside the file; a later phase can move the file.
- **R-10 — Audio gains are master, music and SFX.** No voice channel exists (`packages/render/src/audio.ts` has one master bus and an `<audio>` element for music, nothing else); a slider for silence is a lie. Voice joins when a voice line ships.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/app/src/shell/router.ts` (+test) | Pure route matching, legacy-URL redirect, `Router` with history, mount/dispose protocol, stale-mount guard, link interception | 0 |
| `packages/app/src/shell/links.ts` (+test) | The one place that spells a route: `routes.campaign()`, `routes.mission(id)`, base-prefixed hrefs | 1 |
| `packages/app/src/main.ts` | Route table; `bootBattlefield(stage, req, signal)` returning a disposer; settings/keymap/i18n wiring | 1, 2, 4, 5, 6, 7, 9, 11, 12, 14 |
| `packages/app/src/ui/menu.ts`, `brigade.ts`, `debrief.ts`, `loading.ts`, `worldmap.ts`, `worldmap3d.ts`, `hud.ts` | Links through `routes.*`; disposers; `Hud.destroy()` | 1, 2 |
| `packages/render/src/overlay.ts` | `DebugOverlay.destroy()` | 2 |
| `tools/src/ui-review/routes-check.ts` | Playwright route walk: no reload, two missions in one realm, no console errors | 2 |
| `packages/render/src/audio.ts` (+test) | `setGains`, an SFX bus, live music volume | 3 |
| `packages/app/src/settings.ts` (+test) | `Settings` type, defaults, tolerant parse, load/save, `applySettings` | 4 |
| `packages/app/src/ui/settings-panel.ts` (+test) | The one settings table; `showSettings` route wrapper | 4, 5 |
| `packages/app/src/input/keymap.ts` (+test) | Actions, default bindings, `resolveKey`, `rebind` with conflicts, key labels | 5 |
| `packages/app/src/shell/clock.ts` (+test) | The tick accumulator as a pure function, with pause | 6 |
| `packages/app/src/ui/pause.ts` (+test) | The pause modal | 6 |
| `packages/app/src/campaign.ts` (+test) | `continueTarget` | 7 |
| `packages/app/src/profile.ts` (+test) | Save slots over both stores; export/import | 7 |
| `packages/app/src/ui/saves.ts` (+test) | The saves screen | 7 |
| `packages/app/src/credits-data.ts` (+test), `packages/app/src/ui/credits.ts` (+test) | Credits content pinned against `package.json`; the screen | 8 |
| `LICENSE`, `data/LICENSE.md`, `README.md` | Licence alignment (R-7) | 8 |
| `packages/app/src/i18n/t.ts` (+test), `format.ts` (+test), `pseudo.ts` (+test), `locales.ts`, `en.json` | Catalogue, `t()`, message format with plurals, pseudo-locale, locale table with `dir` | 9 |
| `tools/validate_i18n.mjs` (+test) | Bare chrome literals fail `validate:ui` | 9, 10, 11 |
| every `packages/app/src/ui/*.ts` with chrome text, `main.ts`, `input/intents.ts`, `tutorial/panel.ts`, `gate-sentence.ts` | Extraction | 10, 11 |
| `packages/data/src/index.ts`, `tools/validate_narrative.mjs` | Mission text locale overlay + its `validate:data` rule | 11 |
| `data/palette.json`, `packages/app/vite-plugin-palette.ts`, `theme.css`, `packages/data/src/index.ts`, `tools/src/cvd.test.ts` | Colour-vision variants, measured under simulated deficiency | 12 |
| `tools/src/ui-review/shoot.ts` | `--pseudo`; settings, credits, saves, pause, end-screen and debrief states | 13 |
| `packages/render/src/api.ts`, `quality.ts`, `three/post-chain.ts`, `three/lighting.ts`, `three/ThreeRenderer.ts` | The quality preset reaches the renderer | 14 |

---

### Task 0: The router core — pure matching, legacy redirect, history

**Files:**
- Create: `packages/app/src/shell/router.ts`
- Test: `packages/app/src/shell/router.test.ts`

**Interfaces:**
- Consumes: nothing from the app.
- Produces (Task 1 and every later task rely on these exact names):
  - `type Disposer = () => void`
  - `interface RouteRequest { name: string; params: Readonly<Record<string, string>>; query: URLSearchParams; path: string; signal: AbortSignal }`
  - `type Mount = (stage: HTMLElement, req: RouteRequest) => Disposer | Promise<Disposer>`
  - `interface RouteDef { name: string; pattern: string; mount: Mount }`
  - `function matchPath(pattern: string, path: string): Readonly<Record<string, string>> | null`
  - `function legacyRedirect(search: string): { path: string; query: URLSearchParams } | null`
  - `function stripBase(base: string, pathname: string): string`
  - `class Router { constructor(opts: RouterOptions); start(opts?: { drop?: readonly string[] }): Promise<void>; navigate(href: string, opts?: { replace?: boolean; force?: boolean }): Promise<void>; href(path: string, query?: URLSearchParams): string; current(): RouteRequest | null; dispose(): void }`
  - `function interceptLinks(root: HTMLElement | Document, router: Router): Disposer`

- [ ] **Step 1: Write the failing tests**

```ts
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
    let seen: AbortSignal | null = null;
    router.register({ name: 'probe', pattern: '/probe', mount: (_h, req) => { seen = req.signal; return () => {}; } });
    await router.start();
    await router.navigate('/probe');
    expect(seen?.aborted).toBe(false);
    await router.navigate('/campaign');
    expect(seen?.aborted).toBe(true);
  });

  it('follows popstate', async () => {
    const { router, log } = makeRouter({ start: '/' });
    await router.start();
    await router.navigate('/campaign');
    window.history.back();
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `pnpm vitest run packages/app/src/shell/router.test.ts`
Expected: FAIL — `Cannot find module './router'`.

- [ ] **Step 3: Write the router**

```ts
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
  private seq = 0;
  private pending: Promise<void> = Promise.resolve();
  private readonly onPop = (): void => {
    this.pending = this.pending.then(() => this.mountLocation(false, null));
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
    const qs = query && [...query.keys()].length > 0 ? `?${query.toString()}` : '';
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
    this.pending = this.pending.then(() => {
      if (opts.replace) window.history.replaceState(null, '', target);
      else window.history.pushState(null, '', target);
      return this.mountLocation(true, opts.force ? path : null);
    });
    return this.pending;
  }

  dispose(): void {
    window.removeEventListener('popstate', this.onPop);
    this.seq++;
    this.unmount();
  }

  private unmount(): void {
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
    if (animate && this.transitionMs > 0 && this.mounted) {
      this.stage.classList.add('rl-stage--leave');
      await new Promise((r) => setTimeout(r, this.transitionMs));
      this.stage.classList.remove('rl-stage--leave');
    }
    if (seq !== this.seq) return;
    this.unmount();
    const abort = new AbortController();
    const req: RouteRequest = { name: def?.name ?? '404', params, query, path, signal: abort.signal };
    const mount = def?.mount ?? this.notFound;
    let dispose: Disposer;
    try {
      dispose = await mount(this.stage, req);
    } catch (err) {
      if (abort.signal.aborted || seq !== this.seq) return;
      throw err;
    }
    if (seq !== this.seq) {
      abort.abort();
      dispose();
      return;
    }
    this.mounted = { req, dispose, abort };
    if (animate && this.transitionMs > 0) {
      this.stage.classList.add('rl-stage--enter');
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
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm vitest run packages/app/src/shell/router.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Falsify two checks by mutation, then restore**

Change `if (seq !== this.seq) { abort.abort(); dispose(); return; }` to drop the `dispose()` call — "a stale slow mount is disposed" must go red. Change `legacyRedirect`'s order so `sandbox` is checked before `mission` — "prefers mission over sandbox" must go red. Restore both; run again; record both in the commit message.

- [ ] **Step 6: Add the stage transition CSS**

In `packages/app/src/ui/theme.css`, next to the `--dur-*` tokens (around line 245), add `--dur-route: 200ms;`, and after the `#stage`-related rules (search for `.rl-menu` block start) add:

```css
/* Route transitions (shell/router.ts): the stage fades out under the old
   screen and in under the new. The blanket reduced-motion rule collapses both
   durations to 1ms, which is the whole of "honouring prefers-reduced-motion". */
#stage { transition: opacity var(--dur-route) var(--ease); }
#stage.rl-stage--leave { opacity: 0; }
#stage.rl-stage--enter { animation: rl-route-in var(--dur-route) var(--ease); }
@keyframes rl-route-in { from { opacity: 0; } to { opacity: 1; } }
```

Run `pnpm validate:ui` — must stay green (no px, no literals).

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/shell/router.ts packages/app/src/shell/router.test.ts packages/app/src/ui/theme.css
git commit -m "feat(shell): a router -- paths under the base, legacy query redirects, one screen at a time

Pure matchPath/stripBase/legacyRedirect, a Router with a stale-mount guard and an
AbortSignal per route, interceptLinks for same-origin anchors. Seen red: dropping the
stale disposer; checking sandbox before mission." -- packages/app/src/shell packages/app/src/ui/theme.css
```

---

### Task 1: The shell screens on the router, links through one table, legacy redirects live

**Files:**
- Create: `packages/app/src/shell/links.ts`, `packages/app/src/shell/links.test.ts`
- Modify: `packages/app/src/main.ts` (`main()` lines 403–696 become the route table; lines 698–2775 become `bootBattlefield`), `packages/app/src/ui/menu.ts` (every link at lines 102, 105, 106, 124, 130, 251, 308, 409, 551–554; `showMenu`/`showCampaign`/`showSandbox`/`showEndScreen` return disposers), `packages/app/src/ui/brigade.ts:301-302`, `packages/app/src/ui/debrief.ts:124,136-138`, `packages/app/src/ui/hud.ts` (the campaign link asserted at `hud.test.ts:256`), `packages/app/src/sandbox-help.ts` (`KNOWN_PARAMS`), `packages/app/src/ui/worldmap3d.ts:200` (default `navigate`), tests: `ui/hud.test.ts:256`, `ui/worldmap.test.ts:25,229,232,247`, `ui/sandbox-menu.test.ts:107-175`, `ui/debrief.test.ts:85`, `ui/worldmap3d.test.ts:86,96,267,392`, `ui/menu.test.ts`.
- Docs: `CLAUDE.md` "Dev instruments" (one paragraph: paths, and that the query forms still redirect).

**Interfaces:**
- Consumes: `Router`, `interceptLinks`, `RouteRequest`, `Disposer` from Task 0.
- Produces:
  - `packages/app/src/shell/links.ts`: `export const routes = { menu(), campaign(), brigade(), freePlay(), sandbox(map, flags?), mission(id, opts?: { tutorial?: boolean; fresh?: boolean }), settings(), credits(), saves() }` — each returns a **base-prefixed href** (`import.meta.env.BASE_URL` + path), so an anchor works for a hard navigation on Pages and the router normalises it on a soft one.
  - `interface BattlefieldRequest { missionId: string | null; sandboxMap: string | null; query: URLSearchParams; signal: AbortSignal }` and `async function bootBattlefield(stage: HTMLElement, req: BattlefieldRequest): Promise<Disposer>` in `main.ts` — in this task the disposer is `() => {}` and in-mission exits remain hard navigations (`window.location.assign(routes.campaign())`); Task 2 makes them soft.
  - every `show*` in `menu.ts`, `brigade.ts`, `debrief.ts` returns `Disposer` (`() => wrap.remove()`).

- [ ] **Step 1: Write the failing link-table tests**

```ts
// packages/app/src/shell/links.test.ts
import { describe, expect, it } from 'vitest';
import { routes } from './links';

describe('routes', () => {
  it('spells every route once, under the base', () => {
    expect(routes.menu()).toBe('/');
    expect(routes.campaign()).toBe('/campaign');
    expect(routes.brigade()).toBe('/brigade');
    expect(routes.freePlay()).toBe('/free-play');
    expect(routes.settings()).toBe('/settings');
    expect(routes.credits()).toBe('/credits');
    expect(routes.saves()).toBe('/saves');
  });
  it('encodes a mission id and carries the tutorial replay flag', () => {
    expect(routes.mission('beit_sahwan_1_recon')).toBe('/mission/beit_sahwan_1_recon');
    expect(routes.mission('a b')).toBe('/mission/a%20b');
    expect(routes.mission('x', { tutorial: true })).toBe('/mission/x?tutorial=1');
  });
  it('builds a sandbox href with bare flags in table order, like sandboxUrl did', () => {
    expect(routes.sandbox('tel_marum')).toBe('/free-play/tel_marum');
    expect(routes.sandbox('tel_marum', { sur: true, tunnel: true })).toBe('/free-play/tel_marum?tunnel&sur');
  });
});
```

- [ ] **Step 2: Run to see it fail, then write `links.ts`**

```ts
// packages/app/src/shell/links.ts
/**
 * Every href the shell writes, in one place. Screens import `routes` and never
 * spell a path; the router (shell/router.ts) strips the base back off.
 * `import.meta.env.BASE_URL` is `/` in dev and tests and `/<repo>/` on Pages,
 * always with a trailing slash.
 */
import { SANDBOX_FLAGS, type SandboxFlagName } from '../sandbox-help';

const BASE: string = import.meta.env.BASE_URL;

function href(path: string, query?: URLSearchParams): string {
  const qs = query && [...query.keys()].length > 0 ? `?${query.toString()}` : '';
  return `${BASE}${path.startsWith('/') ? path.slice(1) : path}${qs}`;
}

/** Bare flags (`?tunnel&sur`), never `=1` — `readFlags` tests presence. */
function flagQuery(on: Partial<Record<SandboxFlagName, boolean>> | undefined): string {
  if (!on) return '';
  const names = SANDBOX_FLAGS.filter((f) => on[f.name] === true).map((f) => f.name);
  return names.length > 0 ? `?${names.join('&')}` : '';
}

export const routes = {
  menu: (): string => href('/'),
  campaign: (): string => href('/campaign'),
  brigade: (): string => href('/brigade'),
  freePlay: (): string => href('/free-play'),
  sandbox: (map: string, on?: Partial<Record<SandboxFlagName, boolean>>): string =>
    `${href(`/free-play/${encodeURIComponent(map)}`)}${flagQuery(on)}`,
  mission: (id: string, opts: { tutorial?: boolean; fresh?: boolean } = {}): string => {
    const q = new URLSearchParams();
    if (opts.tutorial) q.set('tutorial', '1');
    if (opts.fresh) q.set('fresh', '1');
    return href(`/mission/${encodeURIComponent(id)}`, q);
  },
  settings: (): string => href('/settings'),
  credits: (): string => href('/credits'),
  saves: (): string => href('/saves'),
} as const;
```

Note `URLSearchParams.toString()` renders a bare flag set via `q.append('tunnel', '')` as `tunnel=`; that is why `flagQuery` joins names by hand. `readFlags` uses `params.has`, so both spellings parse; the test pins the bare one because `sandboxUrl` always produced it and `sandbox-menu.test.ts:150` prints the URL to the player.

- [ ] **Step 3: Restructure `main()` into the route table**

Keep everything above `async function main()` (line 403) as is. Inside `main()`:

1. Keep: the `#stage` lookup, `performance.mark('rl:boot')` (add this line first — Task 2's route walk reads it), audio construction and `attach()`, `registerServiceWorker(BASE, window.location.search)` (moved up from line 782 so `?nosw` is read before any redirect), and the `?fresh` purge at lines 568–576 but keyed on `legacyRedirect(window.location.search)?.path.startsWith('/mission/') !== true && !window.location.pathname.includes('/mission/')` instead of `params.get('mission') === null` — i.e. purge only when the landing is not a mission.
2. Replace the branch at lines 578–696 with:

```ts
const router = new Router({
  base: BASE,
  stage,
  routes: [
    { name: 'menu', pattern: '/', mount: (host) => mountMenu(host) },
    { name: 'campaign', pattern: '/campaign', mount: (host) => mountCampaign(host) },
    { name: 'brigade', pattern: '/brigade', mount: (host) => mountBrigade(host) },
    { name: 'free-play', pattern: '/free-play', mount: (host) => showSandbox(host) },
    {
      name: 'sandbox',
      pattern: '/free-play/:map',
      mount: (host, req) => bootBattlefield(host, { missionId: null, sandboxMap: req.params.map, query: req.query, signal: req.signal }),
    },
    {
      name: 'mission',
      pattern: '/mission/:id',
      mount: (host, req) => bootBattlefield(host, { missionId: req.params.id, sandboxMap: null, query: req.query, signal: req.signal }),
    },
    { name: 'briefing', pattern: '/briefing/:id', mount: (_host, req) => { void router.navigate(routes.mission(req.params.id), { replace: true }); return () => {}; } },
  ],
  notFound: (host, req) => {
    bootError(host, 'No such screen', `Nothing lives at ${req.path}.`, routes.menu());
    return () => host.replaceChildren();
  },
});
const offLinks = interceptLinks(document, router);
void offLinks;
await router.start({ drop: ['fresh'] });
```

where `mountMenu`, `mountCampaign`, `mountBrigade` are the three existing call sites (lines 684–695, 584–596, 598–672) wrapped as `function mountX(host: HTMLElement): Disposer { …existing setup…; return showX(host, {...}); }`. The brigade's `onReset`/`onBuy`/`onBuyUpgrade` callbacks replace `window.location.reload()` with `void router.navigate(routes.brigade(), { replace: true, force: true })`. The menu's `reset` opt becomes `() => { purgeCampaign(); void router.navigate(routes.menu(), { replace: true, force: true }); }` where `purgeCampaign()` is the two `removeItem` calls from lines 569 and 574 extracted into a function (the `?fresh` path calls the same function).

3. Lines 698–2775 become the body of:

```ts
export interface BattlefieldRequest {
  missionId: string | null;
  sandboxMap: string | null;
  query: URLSearchParams;
  signal: AbortSignal;
}

async function bootBattlefield(stage: HTMLElement, req: BattlefieldRequest): Promise<Disposer> {
  const params = req.query;
  const missionId = req.missionId;
  const sandboxMap = req.sandboxMap;
  // ...the existing body, with these substitutions:
  //   params.get('mission')  -> missionId          (line 698)
  //   params.get('sandbox')  -> sandboxMap         (line 753)
  //   every `return;` on an error path -> `return () => {};`
  //   the unknown-mission bootError's home -> routes.menu()
  //   window.location.assign('?campaign') (lines 1291, 1634) -> window.location.assign(routes.campaign())
  //   showEndScreen/showDebrief links: unchanged here (they come from menu.ts/debrief.ts and are fixed below)
  // ...
  return () => {};   // Task 2 replaces this with the real teardown
}
```

`unknownParams(params)` at line 783 keeps working on the residual query. Add `'pseudo'` and `'lang'` to `KNOWN_PARAMS` in Task 9, not here.

- [ ] **Step 4: Every link goes through `routes`**

Replace each literal listed under **Files** with the `routes.*()` call: `menu.ts:102` `routes.mission(opts.tutorial.id)`, `:105` `routes.campaign()`, `:106` `routes.brigade()`, `:124` `routes.mission(opts.tutorial.id, { tutorial: true })`, `:130` `routes.freePlay()`, `:251` `const href = (id: string): string => routes.mission(id);`, `:308` and `:409` `routes.menu()`, `:551-554`, `brigade.ts:301-302`, `debrief.ts:124,136-138`, the HUD's campaign link, and `showSandbox`'s `sandboxUrl(l.id, on)` → `routes.sandbox(l.id, on)` (keep `sandboxUrl` in `sandbox-help.ts` for `sandboxHelp()`'s console text). `worldmap3d.ts:200`'s default `navigate` stays `window.location.assign` (the campaign screen passes `(h) => void router.navigate(h)` from `mountCampaign` — add `navigate` to `CampaignOptions` and thread it through `showCampaign` → `worldMap3d`).

Make `showMenu`, `showCampaign`, `showSandbox`, `showBrigade`, `showEndScreen` return `Disposer` — each already builds one `wrap`; return `() => wrap.remove()`. `showEndScreen`'s and `showDebrief`'s disposers are stored by `bootBattlefield` for Task 2.

Update the test assertions named under **Files** from `?campaign`/`?mission=x`/`?`/`?sandboxes`/`?sandbox=…` to `/campaign`/`/mission/x`/`/`/`/free-play`/`/free-play/…` (the `sandbox-menu.test.ts:134-144` round-trip through `readFlags`/`unknownParams` now parses the query part of `routes.sandbox()`; `unknownParams` must still return `[]`).

- [ ] **Step 5: Run the gates and see them pass**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`
Expected: all green; the eight updated test files pass with the new shapes.

- [ ] **Step 6: Drive it (the only manual step, and it is not optional)**

With the dev server already running in the main checkout (never start one from a worktree — `preview_start` is pinned to the launch directory; use `pnpm --filter @lions/app dev --port 5199` from the worktree in a background shell and stop it yourself afterwards): load `/?campaign` — the address bar must read `/campaign` and the board must draw; load `/?sandbox=tel_marum&tunnel&sur` — `/free-play/tel_marum?tunnel&sur`, the sandbox boots, `window.__lions` exists, `__lions.help()` prints the flags on; load `/` — the menu, `window.__lions` undefined; click Campaign → Brigade → menu without a page load (`performance.getEntriesByName('rl:boot').length === 1` in the console after three clicks). Record the four observations in the report.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/shell/links.ts packages/app/src/shell/links.test.ts packages/app/src/main.ts packages/app/src/ui/menu.ts packages/app/src/ui/brigade.ts packages/app/src/ui/debrief.ts packages/app/src/ui/hud.ts packages/app/src/ui/worldmap3d.ts packages/app/src/sandbox-help.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/worldmap.test.ts packages/app/src/ui/sandbox-menu.test.ts packages/app/src/ui/debrief.test.ts packages/app/src/ui/worldmap3d.test.ts packages/app/src/ui/menu.test.ts CLAUDE.md
git commit -m "feat(shell): the shell screens mount through the router; every link comes from one table; query URLs redirect

/, /campaign, /brigade, /free-play, /free-play/:map, /mission/:id. ?campaign, ?mission=, ?sandbox=,
?sandboxes, ?brigade redirect on boot and on click. bootBattlefield() is the old mission path behind a
function boundary; its disposer is a no-op until the next commit." -- <the same paths>
```

---

### Task 2: A mission that can be left — the battlefield disposer and the route walk

**Files:**
- Modify: `packages/app/src/main.ts` (`bootBattlefield`), `packages/app/src/ui/hud.ts` (`destroy()`), `packages/render/src/overlay.ts` (`DebugOverlay.destroy()`), `packages/app/src/ui/loading.ts` (`onBack` stays a callback; nothing else), `packages/app/src/tutorial/panel.ts` (return a disposer if it mounts on `document.body`)
- Create: `tools/src/ui-review/routes-check.ts`; `tools/package.json` script `ui:routes`; root `package.json` script `ui:routes`
- Test: `packages/app/src/ui/hud.test.ts` (destroy removes every body-mounted element), `packages/render/src/overlay.test.ts` (new, destroy)

**Interfaces:**
- Consumes: `bootBattlefield`, `routes`, `Router` from Task 1.
- Produces: `bootBattlefield`'s returned disposer really tears down; `Hud.destroy(): void`; `DebugOverlay.destroy(): void`; `pnpm ui:routes` (exit 0/1).

- [ ] **Step 1: Write the failing `Hud.destroy` test**

In `packages/app/src/ui/hud.test.ts`, next to the existing constructor tests:

```ts
it('destroy() removes everything it put on the body, and can be called twice', () => {
  const before = document.body.children.length;
  const hud = new Hud(document.body, deps());   // the file's existing deps() helper
  expect(document.body.children.length).toBeGreaterThan(before);
  hud.destroy();
  expect(document.body.children.length).toBe(before);
  hud.destroy();
  expect(document.body.children.length).toBe(before);
});
```

and in a new `packages/render/src/overlay.test.ts` (`// @vitest-environment jsdom`), the same shape for `new DebugOverlay(document.body, …)` — read `overlay.ts:34` for its constructor arguments and build the minimal fakes.

- [ ] **Step 2: Implement `destroy()` on both**

`Hud`: every `document.createElement` whose result is appended to `this.host` at construction is pushed onto `private readonly roots: HTMLElement[]` at the moment it is appended (grep `host.appendChild` and `this.host.appendChild` in the constructor — there are several: the strip, the bottom stack `.rl-sel`, the commander bar, the campaign link, the mute chip; list them in the report). `destroy()` removes each and clears the array. `DebugOverlay`: same pattern for its one root.

- [ ] **Step 3: The real disposer in `bootBattlefield`**

Inside `bootBattlefield`, immediately after the `params`/`missionId` lines, add `const cleanup: Disposer[] = []; const onDispose = (f: Disposer): void => { cleanup.push(f); };` and register, at the point each thing is created:

- the loading screen: `onDispose(() => loading.dispose())` — add `dispose()` to `LoadingScreen` (`loading.ts:165`): removes `wrap` and the keydown listener via the existing `cleanup()` (`loading.ts:498`), idempotent;
- `await renderer.init(stage)` → `onDispose(() => renderer.dispose())` (the `Renderer` interface already has `dispose()`);
- every `window.addEventListener(type, fn[, opts])` in the body (lines 2048, 2049, 2142 and any others — grep `window.addEventListener` and `document.addEventListener` between the function's braces; the report lists every line found) becomes `const off = on(window, type, fn, opts)` with a local helper `function on<K extends keyof WindowEventMap>(target: Window, type: K, fn: (ev: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): Disposer` that registers with `onDispose`;
- `new Hud(document.body, …)` → `onDispose(() => hud.destroy())`; `new Minimap(…)` → `onDispose(() => minimap.destroy())`; `new DebugOverlay(…)` → `onDispose(() => overlay.destroy())`; the tutorial panel if it mounts on the body;
- `showEndScreen(document.body, …)` and `showDebrief(document.body, …)` at lines 2349/2356 return disposers now; store them in a `let endScreen: Disposer | null` and `let debriefScreen: Disposer | null` and `onDispose(() => { endScreen?.(); debriefScreen?.(); })`;
- the loop: `onDispose(() => cancelAnimationFrame(rafId))` right after `rafId = requestAnimationFrame(loop)` (line 2768), and delete `void rafId` (line 2774) with its comment;
- `__lions`: `onDispose(() => { delete (window as unknown as Record<string, unknown>).__lions; })` right after the `Object.assign` (line 2481).

The function's last statement becomes:

```ts
return () => {
  for (const f of cleanup.splice(0).reverse()) {
    try { f(); } catch (err) { console.error('battlefield teardown:', err); }
  }
};
```

Abort: after `await loading.done()` (line 1458) and after `await renderer.init(stage)` (line 1293) add `if (req.signal.aborted) { run(); throw new DOMException('left before deploy', 'AbortError'); }` where `run` is the same reversed-cleanup loop factored into a local function — the router swallows an `AbortError` from a stale mount (Task 0). `loading.done()` must also resolve/reject when the screen is disposed from outside: in `loading.ts`, `dispose()` rejects the pending `done()` promise with an `AbortError` if one is outstanding.

Exits go soft: `leave` (line 1634) → `() => void router.navigate(routes.campaign())` and the loading screen's `onBack` (line 1291) → the same. `bootBattlefield` therefore takes `router` — add it to `BattlefieldRequest` as `navigate: (href: string) => void`.

- [ ] **Step 4: The route walk instrument**

```ts
// tools/src/ui-review/routes-check.ts
// Usage: pnpm ui:routes            (starts its own dev server on 5177, like ui:shots)
//
// The reference-free check for Task 2: one JS realm, two missions, no reload,
// nothing left behind. It fails (exit 1) on any console error, on a page
// reload (performance mark count), on __lions surviving a leave, or on a
// second mission that does not tick.
import { chromium, type ConsoleMessage, type Page } from 'playwright';
import { ensureDevServer } from '../golden-diff/browser';
import { dismissDeployGate } from '../golden-diff/capture-guard';

const PORT = 5177;
const TAG = 'ui-routes';
const REPO_ROOT = new URL('../../..', import.meta.url).pathname;
const MISSION_A = 'beit_sahwan_1_recon';
const MISSION_B = 'tel_marum_1_recon';

interface Probe { boots: number; lions: boolean; tick: number | null; bodyChildren: number }

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const w = window as unknown as { __lions?: { sim: { tickCount: number } } };
    return {
      boots: performance.getEntriesByName('rl:boot').length,
      lions: w.__lions !== undefined,
      tick: w.__lions ? w.__lions.sim.tickCount : null,
      bodyChildren: document.body.children.length,
    };
  });
}

const failures: string[] = [];
const expect = (cond: boolean, msg: string): void => { if (!cond) failures.push(msg); };

const server = await ensureDevServer(PORT, REPO_ROOT, TAG);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  const menu = await probe(page);
  expect(menu.boots === 1 && !menu.lions, `menu: boots=${menu.boots} lions=${menu.lions}`);
  const idleBody = menu.bodyChildren;

  await page.click(`a[href="/campaign"]`);
  await page.waitForSelector('.rl-world');
  await page.goto(`http://localhost:${PORT}/?mission=${MISSION_A}`, { waitUntil: 'load' });
  expect(new URL(page.url()).pathname === `/mission/${MISSION_A}`, `legacy redirect: ${page.url()}`);
  await dismissDeployGate(page, 'A');
  await page.waitForFunction(() => (window as unknown as { __lions?: unknown }).__lions !== undefined);
  const a1 = await probe(page);
  await page.waitForTimeout(1500);
  const a2 = await probe(page);
  expect(a2.tick !== null && a1.tick !== null && a2.tick > a1.tick, `mission A ticks: ${a1.tick} -> ${a2.tick}`);

  // Leave through the HUD's leave button and its confirm, in-app.
  await page.click('.rl-hud__leave');
  await page.click('.rl-confirm__yes');
  await page.waitForSelector('.rl-world');
  const back = await probe(page);
  expect(back.boots === 1, `leave reloaded the page: boots=${back.boots}`);
  expect(!back.lions, 'window.__lions survived leaving the mission');
  expect(back.bodyChildren === idleBody, `body has ${back.bodyChildren} children after leave, ${idleBody} at the menu`);

  // A second mission in the same realm.
  await page.evaluate((href) => { location.assign(href); }, `/mission/${MISSION_B}`);
  await page.waitForLoadState('load');
  // ^ a hard navigation on purpose: the SOFT path is exercised next.
  await dismissDeployGate(page, 'B-hard');
  await page.click('.rl-hud__leave');
  await page.click('.rl-confirm__yes');
  await page.waitForSelector('.rl-world');
  await page.click(`a[href^="/mission/"]`);           // the first card the board offers
  await dismissDeployGate(page, 'B-soft');
  await page.waitForFunction(() => (window as unknown as { __lions?: unknown }).__lions !== undefined);
  const b1 = await probe(page);
  await page.waitForTimeout(1500);
  const b2 = await probe(page);
  expect(b1.boots === 1, `soft mission boot reloaded: boots=${b1.boots}`);
  expect(b2.tick !== null && b1.tick !== null && b2.tick > b1.tick, `second mission ticks: ${b1.tick} -> ${b2.tick}`);

  expect(errors.length === 0, `console errors:\n${errors.join('\n')}`);
} finally {
  await browser.close();
  await server.stop();
}
if (failures.length > 0) {
  console.error(`[${TAG}] FAIL\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`[${TAG}] OK: one realm, two missions, no reload, nothing left behind`);
```

Read `tools/src/golden-diff/browser.ts` for `ensureDevServer`'s real signature and return shape before writing the call, and `tools/src/ui-review/shoot.ts` for how it stops the server it started; match both. The HUD's leave button needs a stable class — give it `rl-hud__leave` if it does not have one (check `hud.ts:305`). Add `"ui:routes": "tsx src/ui-review/routes-check.ts"` to `tools/package.json` and `"ui:routes": "pnpm --filter @lions/tools ui:routes"` to the root.

- [ ] **Step 5: Run it, watch it fail, make it pass**

Run `pnpm ui:routes` BEFORE Step 3 is complete (or with the disposer's `cancelAnimationFrame` line commented out): it must fail on `__lions survived` or on console errors from a loop drawing into a disposed renderer. Then with the full disposer: OK. Record both outputs in the report. Also run the full visual gate locally once — `pnpm golden-baseline` — to prove that a mission booted through the redirect still captures: every scenario must report the same verdict as before this branch (red-or-green is irrelevant here; "captured" is the point, and `combat` must clear its deploy gate).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/main.ts packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/loading.ts packages/render/src/overlay.ts packages/render/src/overlay.test.ts tools/src/ui-review/routes-check.ts tools/package.json package.json
git commit -m "feat(shell): a mission can be left -- bootBattlefield returns a real disposer, and pnpm ui:routes proves it

rAF cancelled, every window listener removed, HUD/minimap/overlay/end screen off the body, renderer
disposed, __lions gone; leave and back navigate in-app. Seen red: routes-check with the rAF line out." -- <paths>
```


---

### Task 3: Audio gains — master, music, SFX, live

**Files:**
- Modify: `packages/render/src/audio.ts` (`BattleAudio`: lines 144–215 construction, 288 music volume, every `.connect(this.master)`)
- Test: `packages/render/src/audio.test.ts` (create if absent; if a test file exists, extend it)

**Interfaces:**
- Consumes: nothing new.
- Produces: `interface AudioGains { master: number; music: number; sfx: number }` (each 0..1), `BattleAudio.setGains(g: AudioGains): void`, `BattleAudio.gains(): AudioGains`, and two pure helpers exported for the tests: `musicVolume(manifestMaster: number, trackGain: number, g: AudioGains): number` and `busGain(manifestMaster: number, g: AudioGains): { master: number; sfx: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/render/src/audio.test.ts  (add to the existing file if there is one)
import { describe, expect, it } from 'vitest';
import { busGain, musicVolume } from './audio';

describe('audio gains', () => {
  it('music is the manifest gain times the track gain times the user master and music', () => {
    expect(musicVolume(0.9, 0.4, { master: 1, music: 1, sfx: 1 })).toBeCloseTo(0.36);
    expect(musicVolume(0.9, 0.4, { master: 0.5, music: 0.5, sfx: 1 })).toBeCloseTo(0.09);
    expect(musicVolume(0.9, 0.4, { master: 1, music: 0, sfx: 1 })).toBe(0);
  });
  it('clamps to [0, 1] whatever the manifest says', () => {
    expect(musicVolume(2, 2, { master: 1, music: 1, sfx: 1 })).toBe(1);
    expect(musicVolume(0.9, -1, { master: 1, music: 1, sfx: 1 })).toBe(0);
  });
  it('the master bus carries the manifest master times the user master; the sfx bus the user sfx', () => {
    expect(busGain(0.9, { master: 0.5, music: 1, sfx: 0.25 })).toEqual({ master: 0.45, sfx: 0.25 });
  });
});
```

- [ ] **Step 2: Run to see it fail, then implement**

In `audio.ts`:

```ts
export interface AudioGains {
  master: number;
  music: number;
  sfx: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export function musicVolume(manifestMaster: number, trackGain: number, g: AudioGains): number {
  return clamp01(manifestMaster * trackGain * g.master * g.music);
}

export function busGain(manifestMaster: number, g: AudioGains): { master: number; sfx: number } {
  return { master: clamp01(manifestMaster * g.master), sfx: clamp01(g.sfx) };
}
```

In `BattleAudio`: add `private sfx: GainNode | null = null;` and `private user: AudioGains = { master: 1, music: 1, sfx: 1 };`. In `attach()`'s `start`, after creating `this.master`, create `this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);` and set both values from `busGain(this.masterGain, this.user)`. Every source that today does `.connect(this.master)` (grep — `playSet`, `tone`, `sweep`, `noise`) connects to `this.sfx` instead. Replace the `el.volume = …` expression at line 288 with `el.volume = musicVolume(this.masterGain, spec?.gain ?? 1, this.user);` and add:

```ts
setGains(g: AudioGains): void {
  this.user = { master: clamp01(g.master), music: clamp01(g.music), sfx: clamp01(g.sfx) };
  const bus = busGain(this.masterGain, this.user);
  if (this.master) this.master.gain.value = bus.master;
  if (this.sfx) this.sfx.gain.value = bus.sfx;
  if (this.music) this.music.volume = musicVolume(this.masterGain, this.manifest?.music?.gain ?? 1, this.user);
}

gains(): AudioGains {
  return { ...this.user };
}
```

`useManifest` re-applies `setGains(this.user)` after reading `master_gain`, so the manifest's own level and the user's compose in either order.

- [ ] **Step 3: Run, falsify, commit**

Run `pnpm vitest run packages/render/src/audio.test.ts`. Mutate `musicVolume` to ignore `g.music` — the first test must go red. Restore. Then the gates, then:

```bash
git add packages/render/src/audio.ts packages/render/src/audio.test.ts
git commit -m "feat(audio): master, music and SFX gains that move while the game runs

An sfx bus under the master, music volume recomputed from the same user gains; the mute
toggle is untouched. Seen red: musicVolume ignoring the music gain." -- packages/render/src/audio.ts packages/render/src/audio.test.ts
```

---

### Task 4: Settings — the typed store, the screen, and what it applies

**Files:**
- Create: `packages/app/src/settings.ts`, `packages/app/src/settings.test.ts`, `packages/app/src/ui/settings-panel.ts`, `packages/app/src/ui/settings-panel.test.ts`
- Modify: `packages/app/src/main.ts` (load/apply at boot, `/settings` route, `BattlefieldRequest.settings`), `packages/app/src/ui/menu.ts` (aside link "Settings"), `packages/app/src/ui/theme.css` (`--text-size`, `[data-motion='reduce']`, the settings table styles), `packages/app/src/shell/links.ts` (already has `settings()`)

**Interfaces:**
- Consumes: `AudioGains`, `BattleAudio.setGains` (Task 3); `routes` (Task 1).
- Produces:
  - `packages/app/src/settings.ts`:
    ```ts
    export type UiScaleSetting = 'auto' | 0.85 | 1 | 1.15 | 1.4;
    export type TextSize = 1 | 1.15 | 1.3;
    export type Quality = 'low' | 'medium' | 'high';
    export type ColorVision = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia';
    export interface Settings {
      version: 1;
      video: { fullscreen: boolean; uiScale: UiScaleSetting; textSize: TextSize; quality: Quality };
      audio: { master: number; music: number; sfx: number };
      controls: { cameraSpeed: 0.5 | 1 | 1.5 | 2; bindings: Record<string, string> };
      accessibility: { motion: 'system' | 'reduce'; colorVision: ColorVision };
      language: string;
    }
    export const SETTINGS_KEY = 'lions.settings';
    export const DEFAULT_SETTINGS: Settings;
    export function parseSettings(raw: string | null): Settings;      // tolerant; never throws
    export function loadSettings(store: StorageLike | null): Settings;
    export function saveSettings(store: StorageLike | null, s: Settings): void;
    export function applySettings(s: Settings, root: HTMLElement): void; // --ui-scale / --text-size inline, data-motion, data-cvd, lang
    export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
    ```
    (`StorageLike` already exists in `brigade-account.ts` — import and re-export that one rather than declaring a second.)
  - `packages/app/src/ui/settings-panel.ts`:
    ```ts
    export interface SettingsDeps {
      get(): Settings;
      set(next: Settings): void;          // persists and applies
      fullscreen: { supported(): boolean; active(): boolean; set(on: boolean): Promise<void> } | null;
      audio: { setGains(g: AudioGains): void } | null;
      locales: readonly { id: string; name: string }[];   // Task 9 fills; ['en'] until then
      keymap: KeymapDeps | null;          // Task 5 fills; null renders no controls section
      build: string;                      // __APP_BUILD__
    }
    export function settingsPanel(host: HTMLElement, deps: SettingsDeps): { el: HTMLElement; dispose: Disposer };
    export function showSettings(stage: HTMLElement, deps: SettingsDeps & { back: string }): Disposer;
    ```
  - `BattlefieldRequest` gains `settings: SettingsDeps` (the pause menu mounts the same panel in Task 6).

- [ ] **Step 1: Write the failing store tests**

```ts
// packages/app/src/settings.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, applySettings, loadSettings, parseSettings, saveSettings } from './settings';

function memStore(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

describe('parseSettings', () => {
  it('returns the defaults for nothing, garbage, and the wrong shape', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"version":99}')).toEqual(DEFAULT_SETTINGS);
  });
  it('keeps every valid field and replaces each invalid one with its default, never the whole object', () => {
    const s = parseSettings(JSON.stringify({
      version: 1,
      video: { fullscreen: true, uiScale: 7, textSize: 1.15, quality: 'ultra' },
      audio: { master: 0.5, music: 2, sfx: 'loud' },
      accessibility: { motion: 'reduce', colorVision: 'nope' },
      language: 'he',
      extra: 'dropped',
    }));
    expect(s.video).toEqual({ fullscreen: true, uiScale: 'auto', textSize: 1.15, quality: 'high' });
    expect(s.audio).toEqual({ master: 0.5, music: 1, sfx: 1 });
    expect(s.accessibility).toEqual({ motion: 'reduce', colorVision: 'default' });
    expect(s.language).toBe('he');
    expect('extra' in s).toBe(false);
  });
  it('round-trips through save and load', () => {
    const store = memStore();
    const s = { ...DEFAULT_SETTINGS, audio: { master: 0.3, music: 0.2, sfx: 0.1 } };
    saveSettings(store, s);
    expect(store.map.get(SETTINGS_KEY)).toBe(JSON.stringify(s));
    expect(loadSettings(store)).toEqual(s);
  });
  it('survives a store that throws or is absent', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
    expect(loadSettings(bad)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(bad, DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe('applySettings', () => {
  it('writes the scale tokens inline only when they differ from auto, and the data attributes always', () => {
    const root = document.createElement('div');
    applySettings(DEFAULT_SETTINGS, root);
    expect(root.style.getPropertyValue('--ui-scale')).toBe('');
    expect(root.style.getPropertyValue('--text-size')).toBe('1');
    expect(root.dataset.motion).toBe('system');
    expect(root.dataset.cvd).toBe('default');
    applySettings({ ...DEFAULT_SETTINGS, video: { ...DEFAULT_SETTINGS.video, uiScale: 1.4, textSize: 1.3 }, accessibility: { motion: 'reduce', colorVision: 'tritanopia' } }, root);
    expect(root.style.getPropertyValue('--ui-scale')).toBe('1.4');
    expect(root.style.getPropertyValue('--text-size')).toBe('1.3');
    expect(root.dataset.motion).toBe('reduce');
    expect(root.dataset.cvd).toBe('tritanopia');
    applySettings(DEFAULT_SETTINGS, root);
    expect(root.style.getPropertyValue('--ui-scale')).toBe('');
  });
});
```

- [ ] **Step 2: Run to see it fail, then write the store**

```ts
// packages/app/src/settings.ts
/**
 * The player's settings: one JSON object under `lions.settings`, beside the
 * ledger and the brigade account. Parsing is tolerant FIELD BY FIELD — a bad
 * value falls back to its own default and every neighbour survives, because a
 * settings blob that resets wholesale over one bad key teaches the player not
 * to touch settings. Unknown keys are dropped so a downgrade cannot smuggle
 * state forward.
 *
 * `applySettings` is the ONLY writer of the three root hooks the CSS reads:
 * `--ui-scale` (inline overrides theme.css's media steps; absent means auto),
 * `--text-size` (a second multiplier on the rem), `data-motion` and
 * `data-cvd`. The audio gains and the render quality are applied by their
 * owners (main.ts) from the same object.
 */
import type { StorageLike } from './brigade-account';

export type { StorageLike };
export type UiScaleSetting = 'auto' | 0.85 | 1 | 1.15 | 1.4;
export type TextSize = 1 | 1.15 | 1.3;
export type Quality = 'low' | 'medium' | 'high';
export type ColorVision = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia';
export type CameraSpeed = 0.5 | 1 | 1.5 | 2;

export interface Settings {
  version: 1;
  video: { fullscreen: boolean; uiScale: UiScaleSetting; textSize: TextSize; quality: Quality };
  audio: { master: number; music: number; sfx: number };
  controls: { cameraSpeed: CameraSpeed; bindings: Record<string, string> };
  accessibility: { motion: 'system' | 'reduce'; colorVision: ColorVision };
  language: string;
}

export const SETTINGS_KEY = 'lions.settings';

export const UI_SCALES: readonly UiScaleSetting[] = ['auto', 0.85, 1, 1.15, 1.4];
export const TEXT_SIZES: readonly TextSize[] = [1, 1.15, 1.3];
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];
export const COLOR_VISIONS: readonly ColorVision[] = ['default', 'deuteranopia', 'protanopia', 'tritanopia'];
export const CAMERA_SPEEDS: readonly CameraSpeed[] = [0.5, 1, 1.5, 2];

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  video: { fullscreen: false, uiScale: 'auto', textSize: 1, quality: 'high' },
  audio: { master: 1, music: 1, sfx: 1 },
  controls: { cameraSpeed: 1, bindings: {} },
  accessibility: { motion: 'system', colorVision: 'default' },
  language: 'en',
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T,>(allowed: readonly T[], v: unknown, dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);
const unit = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : dflt);
const bool = (v: unknown, dflt: boolean): boolean => (typeof v === 'boolean' ? v : dflt);

function bindings(v: unknown): Record<string, string> {
  if (!isRecord(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string' && val.length > 0) out[k] = val;
  return out;
}

export function parseSettings(raw: string | null): Settings {
  if (raw === null) return structuredClone(DEFAULT_SETTINGS);
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
  if (!isRecord(v) || v.version !== 1) return structuredClone(DEFAULT_SETTINGS);
  const d = DEFAULT_SETTINGS;
  const video = isRecord(v.video) ? v.video : {};
  const audio = isRecord(v.audio) ? v.audio : {};
  const controls = isRecord(v.controls) ? v.controls : {};
  const acc = isRecord(v.accessibility) ? v.accessibility : {};
  return {
    version: 1,
    video: {
      fullscreen: bool(video.fullscreen, d.video.fullscreen),
      uiScale: oneOf(UI_SCALES, video.uiScale, d.video.uiScale),
      textSize: oneOf(TEXT_SIZES, video.textSize, d.video.textSize),
      quality: oneOf(QUALITIES, video.quality, d.video.quality),
    },
    audio: { master: unit(audio.master, 1), music: unit(audio.music, 1), sfx: unit(audio.sfx, 1) },
    controls: { cameraSpeed: oneOf(CAMERA_SPEEDS, controls.cameraSpeed, 1), bindings: bindings(controls.bindings) },
    accessibility: {
      motion: oneOf(['system', 'reduce'] as const, acc.motion, 'system'),
      colorVision: oneOf(COLOR_VISIONS, acc.colorVision, 'default'),
    },
    language: typeof v.language === 'string' && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(v.language) ? v.language : 'en',
  };
}

export function loadSettings(store: StorageLike | null): Settings {
  if (!store) return structuredClone(DEFAULT_SETTINGS);
  try {
    return parseSettings(store.getItem(SETTINGS_KEY));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(store: StorageLike | null, s: Settings): void {
  if (!store) return;
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // A blocked store keeps this session's settings in memory; nothing to say.
  }
}

export function applySettings(s: Settings, root: HTMLElement): void {
  if (s.video.uiScale === 'auto') root.style.removeProperty('--ui-scale');
  else root.style.setProperty('--ui-scale', String(s.video.uiScale));
  root.style.setProperty('--text-size', String(s.video.textSize));
  root.dataset.motion = s.accessibility.motion;
  root.dataset.cvd = s.accessibility.colorVision;
  root.setAttribute('lang', s.language);
}
```

`structuredClone` is in Node 17+ and every shipping browser; vitest runs on Node 22 here.

- [ ] **Step 3: The CSS hooks**

In `theme.css`: change line 254 to `html { font-size: calc(16px * var(--ui-scale) * var(--text-size, 1)); /* px-ok */ }`. After the `@media (prefers-reduced-motion: reduce)` block at ~2384, add the same three declarations and the `.rl-pulse` rule under `:root[data-motion='reduce'] *, :root[data-motion='reduce'] *::before, :root[data-motion='reduce'] *::after { … }` and `:root[data-motion='reduce'] .rl-pulse { … }`, and the loading-screen pair from ~2681 likewise. Comment: "the setting is the media query a player cannot reach from the OS."

Settings table styles: `.rl-settings` (a `.rl-panel` with `data-rank`), `.rl-settings__section` (h3 in the display face, `--t-h3`), `.rl-settings__row` (grid `minmax(0, 1fr) auto`, gap `--s-2`, a hairline under each row via `border-block-end: 1px solid color-mix(in srgb, var(--ink) 12%, transparent) /* px-ok */`), `.rl-settings__control` (selects, ranges and buttons inherit the sandbox picker's `.rl-sandbox` control styling — read that block and share the rules by adding the settings selectors to it rather than copying values), `.rl-settings__hint` (dim, `--t-small`). All rem.

- [ ] **Step 4: Write the failing panel tests**

```ts
// packages/app/src/ui/settings-panel.test.ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { settingsPanel, showSettings } from './settings-panel';

function deps(overrides: Partial<Parameters<typeof settingsPanel>[1]> = {}) {
  let s: Settings = structuredClone(DEFAULT_SETTINGS);
  const set = vi.fn((next: Settings) => { s = next; });
  const gains = vi.fn();
  return {
    d: {
      get: () => s,
      set,
      fullscreen: null,
      audio: { setGains: gains },
      locales: [{ id: 'en', name: 'English' }],
      keymap: null,
      build: '0.68.0',
      ...overrides,
    },
    set,
    gains,
  };
}

describe('settingsPanel', () => {
  it('renders one table with the four sections and the build id', () => {
    const { d } = deps();
    const { el } = settingsPanel(document.body, d);
    const heads = [...el.querySelectorAll('h3')].map((h) => h.textContent);
    expect(heads).toEqual(['Video', 'Audio', 'Accessibility', 'Language']);
    expect(el.textContent).toContain('0.68.0');
  });
  it('changing the UI scale persists through set() and applies at once', () => {
    const { d, set } = deps();
    const { el } = settingsPanel(document.body, d);
    const sel = el.querySelector<HTMLSelectElement>('select[name="uiScale"]');
    if (!sel) throw new Error('no uiScale control');
    sel.value = '1.4';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0].video.uiScale).toBe(1.4);
  });
  it('an audio slider reaches the mixer while it is dragged and persists on release', () => {
    const { d, set, gains } = deps();
    const { el } = settingsPanel(document.body, d);
    const r = el.querySelector<HTMLInputElement>('input[name="music"]');
    if (!r) throw new Error('no music slider');
    r.value = '0.25';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    expect(gains).toHaveBeenCalledWith({ master: 1, music: 0.25, sfx: 1 });
    expect(set).not.toHaveBeenCalled();
    r.dispatchEvent(new Event('change', { bubbles: true }));
    expect(set).toHaveBeenCalledTimes(1);
  });
  it('hides the fullscreen row when the browser cannot do it, and shows the quality note', () => {
    const { d } = deps();
    const { el } = settingsPanel(document.body, d);
    expect(el.querySelector('input[name="fullscreen"]')).toBeNull();
    expect(el.textContent).toContain('applies when the next mission starts');
  });
  it('showSettings mounts on the stage with a back link and its disposer empties the stage', () => {
    const { d } = deps();
    const stage = document.createElement('div');
    const off = showSettings(stage, { ...d, back: '/' });
    expect(stage.querySelector('a[href="/"]')).not.toBeNull();
    off();
    expect(stage.children.length).toBe(0);
  });
});
```

- [ ] **Step 5: Write the panel**

```ts
// packages/app/src/ui/settings-panel.ts
import type { AudioGains } from '@lions/render';
import type { Disposer } from '../shell/router';
import {
  CAMERA_SPEEDS, COLOR_VISIONS, QUALITIES, TEXT_SIZES, UI_SCALES,
  type Settings, type UiScaleSetting, type TextSize, type Quality, type ColorVision, type CameraSpeed,
} from '../settings';
import { panel } from './panel';
import type { KeymapDeps } from './settings-keymap';   // Task 5 creates it; until then declare `export type KeymapDeps = never` in a stub file

export interface SettingsDeps {
  get(): Settings;
  set(next: Settings): void;
  fullscreen: { supported(): boolean; active(): boolean; set(on: boolean): Promise<void> } | null;
  audio: { setGains(g: AudioGains): void } | null;
  locales: readonly { id: string; name: string }[];
  keymap: KeymapDeps | null;
  build: string;
}

function row(table: HTMLElement, label: string, control: HTMLElement, hint?: string): HTMLElement {
  const r = document.createElement('div');
  r.className = 'rl-settings__row';
  const l = document.createElement('label');
  l.textContent = label;
  const id = `set-${control.getAttribute('name') ?? Math.random().toString(36).slice(2)}`;
  control.id = id;
  l.htmlFor = id;
  r.appendChild(l);
  const c = document.createElement('div');
  c.className = 'rl-settings__control';
  c.appendChild(control);
  if (hint) {
    const h = document.createElement('div');
    h.className = 'rl-settings__hint';
    h.textContent = hint;
    c.appendChild(h);
  }
  r.appendChild(c);
  table.appendChild(r);
  return r;
}

function select<T extends string | number>(name: string, options: readonly T[], value: T, label: (v: T) => string, onChange: (v: T) => void): HTMLSelectElement {
  const s = document.createElement('select');
  s.name = name;
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = String(o);
    opt.textContent = label(o);
    opt.selected = o === value;
    s.appendChild(opt);
  }
  s.addEventListener('change', () => {
    const picked = options.find((o) => String(o) === s.value);
    if (picked !== undefined) onChange(picked);
  });
  return s;
}

function slider(name: string, value: number, onInput: (v: number) => void, onCommit: (v: number) => void): HTMLInputElement {
  const r = document.createElement('input');
  r.type = 'range';
  r.name = name;
  r.min = '0';
  r.max = '1';
  r.step = '0.05';
  r.value = String(value);
  r.addEventListener('input', () => onInput(Number(r.value)));
  r.addEventListener('change', () => onCommit(Number(r.value)));
  return r;
}

function checkbox(name: string, value: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.name = name;
  c.checked = value;
  c.addEventListener('change', () => onChange(c.checked));
  return c;
}

function section(table: HTMLElement, title: string): void {
  const h = document.createElement('h3');
  h.className = 'rl-settings__section';
  h.textContent = title;
  table.appendChild(h);
}

export function settingsPanel(host: HTMLElement, deps: SettingsDeps): { el: HTMLElement; dispose: Disposer } {
  const el = panel('Settings', 'settings');   // read panel.ts for the real signature; it returns the .rl-panel root
  el.classList.add('rl-settings');
  const table = document.createElement('div');
  table.className = 'rl-settings__table';
  el.appendChild(table);

  const update = (mut: (s: Settings) => void): void => {
    const next = structuredClone(deps.get());
    mut(next);
    deps.set(next);
  };
  const s = deps.get();

  section(table, 'Video');
  if (deps.fullscreen?.supported()) {
    const fs = deps.fullscreen;
    row(table, 'Fullscreen', checkbox('fullscreen', fs.active(), (on) => { void fs.set(on); update((n) => { n.video.fullscreen = on; }); }));
  }
  row(table, 'Interface scale', select<UiScaleSetting>('uiScale', UI_SCALES, s.video.uiScale, (v) => (v === 'auto' ? 'Automatic (by screen width)' : `${Math.round(v * 100)}%`), (v) => update((n) => { n.video.uiScale = v; })));
  row(table, 'Text size', select<TextSize>('textSize', TEXT_SIZES, s.video.textSize, (v) => (v === 1 ? 'Normal' : `${Math.round(v * 100)}%`), (v) => update((n) => { n.video.textSize = v; })));
  row(table, 'Render quality', select<Quality>('quality', QUALITIES, s.video.quality, (v) => ({ low: 'Low — no ambient occlusion, no anti-aliasing, soft shadows', medium: 'Medium — anti-aliasing, 2K shadows', high: 'High — everything, 4K shadows' })[v], (v) => update((n) => { n.video.quality = v; })), 'Applies when the next mission starts.');

  section(table, 'Audio');
  const live = (k: 'master' | 'music' | 'sfx') => (v: number): void => {
    const g = { ...deps.get().audio, [k]: v };
    deps.audio?.setGains(g);
  };
  for (const [k, label] of [['master', 'Master'], ['music', 'Music'], ['sfx', 'Effects']] as const) {
    row(table, label, slider(k, s.audio[k], live(k), (v) => update((n) => { n.audio[k] = v; })));
  }

  section(table, 'Accessibility');
  row(table, 'Motion', select<'system' | 'reduce'>('motion', ['system', 'reduce'], s.accessibility.motion, (v) => (v === 'system' ? 'Follow the system setting' : 'Reduce motion'), (v) => update((n) => { n.accessibility.motion = v; })));
  row(table, 'Colour vision', select<ColorVision>('colorVision', COLOR_VISIONS, s.accessibility.colorVision, (v) => ({ default: 'Default', deuteranopia: 'Deuteranopia (red–green)', protanopia: 'Protanopia (red–green)', tritanopia: 'Tritanopia (blue–yellow)' })[v], (v) => update((n) => { n.accessibility.colorVision = v; })), 'Team colours on the map, the minimap and the HUD.');

  if (deps.keymap) {
    section(table, 'Controls');
    row(table, 'Camera speed', select<CameraSpeed>('cameraSpeed', CAMERA_SPEEDS, s.controls.cameraSpeed, (v) => `${v}×`, (v) => update((n) => { n.controls.cameraSpeed = v; })));
    deps.keymap.mount(table);   // Task 5: one row per rebindable action
  }

  section(table, 'Language');
  row(table, 'Language', select<string>('language', deps.locales.map((l) => l.id), s.language, (id) => deps.locales.find((l) => l.id === id)?.name ?? id, (v) => update((n) => { n.language = v; })), deps.locales.length === 1 ? 'More languages are coming.' : undefined);

  const foot = document.createElement('p');
  foot.className = 'rl-settings__hint';
  foot.textContent = `Build ${deps.build}`;
  el.appendChild(foot);

  host.appendChild(el);
  return { el, dispose: () => el.remove() };
}

export function showSettings(stage: HTMLElement, deps: SettingsDeps & { back: string }): Disposer {
  const wrap = document.createElement('div');
  wrap.className = 'rl-menu rl-menu--settings';
  const { dispose } = settingsPanel(wrap, deps);
  const back = document.createElement('a');
  back.className = 'rl-menu__back';
  back.href = deps.back;
  back.textContent = '← main menu';
  wrap.appendChild(back);
  stage.appendChild(wrap);
  return () => { dispose(); wrap.remove(); };
}
```

Read `panel.ts:36` for `panel()`'s exact signature and `menu.ts`'s back-link class before writing those two lines. (Task 10 turns every literal above into `t()` keys; write them as literals now so this task's diff is about behaviour.)

- [ ] **Step 6: Wire it in `main.ts`**

At boot (before the router): `const settingsStore = safeStorage(); let settings = loadSettings(settingsStore); applySettings(settings, document.documentElement); audio.setGains(settings.audio);` and a `const settingsDeps: SettingsDeps = { get: () => settings, set: (next) => { settings = next; saveSettings(settingsStore, next); applySettings(next, document.documentElement); audio.setGains(next.audio); }, fullscreen: document.fullscreenEnabled ? { supported: () => true, active: () => document.fullscreenElement !== null, set: async (on) => { if (on) await document.documentElement.requestFullscreen(); else if (document.fullscreenElement) await document.exitFullscreen(); } } : null, audio, locales: [{ id: 'en', name: 'English' }], keymap: null, build: __APP_BUILD__ }`. Register `{ name: 'settings', pattern: '/settings', mount: (host) => showSettings(host, { ...settingsDeps, back: routes.menu() }) }`. Pass `settings: settingsDeps` in `BattlefieldRequest`. Add "Settings" to the menu's aside (`menu.ts`, next to "free play"), href `routes.settings()`. The camera pan at the loop (`panSpeed = 0.5 / renderer.camera.zoom`) becomes `(0.5 * settings.controls.cameraSpeed) / renderer.camera.zoom` — `bootBattlefield` reads `req.settings.get()` each frame (cheap; it is a getter).

- [ ] **Step 7: Gates, falsify, drive, commit**

Falsify: make `parseSettings` return `DEFAULT_SETTINGS` when ANY field is invalid — the field-by-field test goes red. Restore. Drive: `/settings` from the menu, set scale 140% → the menu grows at once; reload → it stays; set music to 0 → the theme goes silent while dragging. Commit:

```bash
git add packages/app/src/settings.ts packages/app/src/settings.test.ts packages/app/src/ui/settings-panel.ts packages/app/src/ui/settings-panel.test.ts packages/app/src/main.ts packages/app/src/ui/menu.ts packages/app/src/ui/theme.css
git commit -m "feat(shell): settings -- one table, persisted under lions.settings, applied as it changes

Video (fullscreen, interface scale, text size, quality preset stored for the renderer), audio
gains live on the mixer, motion and colour-vision hooks on the root, language. parseSettings is
tolerant field by field. Seen red: wholesale reset on one bad field." -- <paths>
```

---

### Task 5: The keybinding table — one source for the key handler, the button labels and rebinding

**Files:**
- Create: `packages/app/src/input/keymap.ts`, `packages/app/src/input/keymap.test.ts`, `packages/app/src/ui/settings-keymap.ts`, `packages/app/src/ui/settings-keymap.test.ts`
- Modify: `packages/app/src/main.ts:2049-2141` (the `if (ev.key === …)` chain becomes a `switch` on `resolveKey`), `packages/app/src/ui/hud.ts:1058` (order-row key label), `packages/app/src/ui/selection-model.ts:55-61` (`OrderSpec.key` becomes the ACTION id, not a letter), `packages/app/src/ui/settings-panel.ts` (`keymap` dep now non-null)

**Interfaces:**
- Consumes: `Settings.controls.bindings` (Task 4).
- Produces:
  ```ts
  // packages/app/src/input/keymap.ts
  export type Action = 'halt' | 'smoke' | 'load' | 'unload' | 'overlay' | 'production' | 'mute' | 'selectAll' | 'cycleChips' | 'panUp' | 'panDown' | 'panLeft' | 'panRight' | 'pause';
  export interface ActionSpec { id: Action; label: string; key: string; rebindable: boolean; modifier?: 'ctrl' }
  export const ACTIONS: readonly ActionSpec[];                  // the defaults, in display order
  export type Bindings = Readonly<Record<Action, string>>;
  export function bindingsFrom(overrides: Record<string, string>): Bindings;   // defaults + valid overrides
  export function resolveKey(b: Bindings, ev: { key: string; ctrlKey: boolean; metaKey: boolean }): Action | null;
  export function rebind(b: Bindings, action: Action, key: string): { ok: true; bindings: Bindings } | { ok: false; takenBy: Action };
  export function keyLabel(key: string): string;                // 'arrowup' -> '↑', ' ' -> 'Space', 'h' -> 'H'
  export function overridesOf(b: Bindings): Record<string, string>;   // only the keys that differ from ACTIONS
  ```
  ```ts
  // packages/app/src/ui/settings-keymap.ts
  export interface KeymapDeps { bindings(): Bindings; set(next: Bindings): void; mount(table: HTMLElement): void }
  export function keymapRows(deps: { bindings(): Bindings; set(next: Bindings): void }): KeymapDeps;
  ```
  - `HudDeps.keyFor?: (action: string) => string` — the HUD asks for the label of the action an order button carries.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/input/keymap.test.ts
import { describe, expect, it } from 'vitest';
import { ACTIONS, bindingsFrom, keyLabel, overridesOf, rebind, resolveKey } from './keymap';

describe('keymap', () => {
  it('ships the bindings main.ts had hard-coded, in the same letters', () => {
    const b = bindingsFrom({});
    expect(b.halt).toBe('h');
    expect(b.smoke).toBe('f');
    expect(b.load).toBe('g');
    expect(b.unload).toBe('u');
    expect(b.overlay).toBe('o');
    expect(b.production).toBe('b');
    expect(b.mute).toBe('m');
    expect(b.selectAll).toBe('a');       // with ctrl/cmd
    expect(b.cycleChips).toBe('tab');
    expect(b.pause).toBe('escape');
    expect(b.panUp).toBe('w');
  });
  it('resolves a key to its action, honouring the ctrl modifier where the action needs one', () => {
    const b = bindingsFrom({});
    expect(resolveKey(b, { key: 'H', ctrlKey: false, metaKey: false })).toBe('halt');
    expect(resolveKey(b, { key: 'a', ctrlKey: true, metaKey: false })).toBe('selectAll');
    expect(resolveKey(b, { key: 'a', ctrlKey: false, metaKey: true })).toBe('selectAll');
    expect(resolveKey(b, { key: 'a', ctrlKey: false, metaKey: false })).toBe('panLeft');
    expect(resolveKey(b, { key: 'Escape', ctrlKey: false, metaKey: false })).toBe('pause');
    expect(resolveKey(b, { key: 'ArrowUp', ctrlKey: false, metaKey: false })).toBe('panUp');
    expect(resolveKey(b, { key: '5', ctrlKey: false, metaKey: false })).toBeNull();   // groups are not in the table
  });
  it('rebind refuses a key another action holds and names it', () => {
    const b = bindingsFrom({});
    expect(rebind(b, 'halt', 'f')).toEqual({ ok: false, takenBy: 'smoke' });
    const r = rebind(b, 'halt', 'j');
    expect(r.ok && r.bindings.halt).toBe('j');
    expect(r.ok && r.bindings.smoke).toBe('f');
  });
  it('rebind refuses a non-rebindable action and the group digits', () => {
    const b = bindingsFrom({});
    expect(rebind(b, 'pause', 'p').ok).toBe(false);
    expect(rebind(b, 'halt', '3').ok).toBe(false);
  });
  it('bindingsFrom drops an override that collides or names an unknown action', () => {
    const b = bindingsFrom({ halt: 'f', nope: 'x', smoke: 'k' });
    expect(b.halt).toBe('h');
    expect(b.smoke).toBe('k');
  });
  it('overridesOf round-trips through bindingsFrom and is empty at the defaults', () => {
    expect(overridesOf(bindingsFrom({}))).toEqual({});
    const b = bindingsFrom({ halt: 'j' });
    expect(overridesOf(b)).toEqual({ halt: 'j' });
    expect(bindingsFrom(overridesOf(b))).toEqual(b);
  });
  it('labels keys the way a keycap does', () => {
    expect(keyLabel('h')).toBe('H');
    expect(keyLabel('arrowup')).toBe('↑');
    expect(keyLabel(' ')).toBe('Space');
    expect(keyLabel('escape')).toBe('Esc');
    expect(keyLabel('tab')).toBe('Tab');
  });
  it('every action in ACTIONS has a distinct default key within its modifier class', () => {
    const plain = ACTIONS.filter((a) => a.modifier === undefined).map((a) => a.key);
    expect(new Set(plain).size).toBe(plain.length);
  });
});
```

- [ ] **Step 2: Run to see it fail, then write the module**

```ts
// packages/app/src/input/keymap.ts
/**
 * The keyboard, as data. `main.ts`'s keydown listener used to be an if-chain
 * of literals and `selection-model.ts`'s ORDERS carried a second copy of the
 * same letters for display; nothing kept them in step and nothing could
 * rebind either. Both read this table now. Keys are stored lower-case as
 * `KeyboardEvent.key` reports them (`'h'`, `'arrowup'`, `'escape'`).
 *
 * Deliberately NOT in the table: the control groups (ctrl+digit assigns, digit
 * recalls), which every RTS player expects on exactly those keys, and the
 * digit keys are refused as bindings for that reason.
 */
export type Action =
  | 'halt' | 'smoke' | 'load' | 'unload' | 'overlay' | 'production' | 'mute'
  | 'selectAll' | 'cycleChips' | 'panUp' | 'panDown' | 'panLeft' | 'panRight' | 'pause';

export interface ActionSpec {
  id: Action;
  label: string;
  key: string;
  rebindable: boolean;
  /** The action fires only with ctrl (or cmd on a Mac) held. */
  modifier?: 'ctrl';
}

export const ACTIONS: readonly ActionSpec[] = [
  { id: 'halt', label: 'Halt', key: 'h', rebindable: true },
  { id: 'smoke', label: 'Smoke at the cursor', key: 'f', rebindable: true },
  { id: 'load', label: 'Load', key: 'g', rebindable: true },
  { id: 'unload', label: 'Unload', key: 'u', rebindable: true },
  { id: 'overlay', label: 'Toggle the debug overlay', key: 'o', rebindable: true },
  { id: 'production', label: 'Focus the production dock', key: 'b', rebindable: true },
  { id: 'mute', label: 'Mute', key: 'm', rebindable: true },
  { id: 'selectAll', label: 'Select every unit', key: 'a', rebindable: true, modifier: 'ctrl' },
  { id: 'cycleChips', label: 'Cycle the selection chips', key: 'tab', rebindable: false },
  { id: 'panUp', label: 'Pan up', key: 'w', rebindable: true },
  { id: 'panDown', label: 'Pan down', key: 's', rebindable: true },
  { id: 'panLeft', label: 'Pan left', key: 'a', rebindable: true },
  { id: 'panRight', label: 'Pan right', key: 'd', rebindable: true },
  { id: 'pause', label: 'Pause', key: 'escape', rebindable: false },
];

/** The arrow keys pan alongside WASD whatever the bindings say. */
const ARROWS: Readonly<Record<string, Action>> = { arrowup: 'panUp', arrowdown: 'panDown', arrowleft: 'panLeft', arrowright: 'panRight' };

export type Bindings = Readonly<Record<Action, string>>;

const isAction = (s: string): s is Action => ACTIONS.some((a) => a.id === s);
const spec = (id: Action): ActionSpec => ACTIONS.find((a) => a.id === id) as ActionSpec;
const norm = (key: string): string => key.toLowerCase();
const DIGIT = /^[0-9]$/;

function holder(b: Bindings, key: string, modifier: 'ctrl' | undefined, except?: Action): Action | null {
  for (const a of ACTIONS) {
    if (a.id === except) continue;
    if (b[a.id] === key && a.modifier === modifier) return a.id;
  }
  return null;
}

export function bindingsFrom(overrides: Record<string, string>): Bindings {
  const out = Object.fromEntries(ACTIONS.map((a) => [a.id, a.key])) as Record<Action, string>;
  for (const [id, key] of Object.entries(overrides)) {
    if (!isAction(id) || !spec(id).rebindable) continue;
    const k = norm(key);
    if (DIGIT.test(k) || k.length === 0) continue;
    if (holder(out, k, spec(id).modifier, id) !== null) continue;
    out[id] = k;
  }
  return out;
}

export function resolveKey(b: Bindings, ev: { key: string; ctrlKey: boolean; metaKey: boolean }): Action | null {
  const k = norm(ev.key);
  const mod = ev.ctrlKey || ev.metaKey ? 'ctrl' : undefined;
  const hit = holder(b, k, mod);
  if (hit) return hit;
  if (mod === undefined && k in ARROWS) return ARROWS[k];
  return null;
}

export function rebind(b: Bindings, action: Action, key: string): { ok: true; bindings: Bindings } | { ok: false; takenBy: Action } {
  const k = norm(key);
  const s = spec(action);
  if (!s.rebindable || DIGIT.test(k) || k.length === 0) return { ok: false, takenBy: action };
  const taken = holder(b, k, s.modifier, action);
  if (taken) return { ok: false, takenBy: taken };
  return { ok: true, bindings: { ...b, [action]: k } };
}

export function overridesOf(b: Bindings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of ACTIONS) if (b[a.id] !== a.key) out[a.id] = b[a.id];
  return out;
}

const LABELS: Readonly<Record<string, string>> = {
  ' ': 'Space', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
  escape: 'Esc', tab: 'Tab', enter: 'Enter', backspace: '⌫', delete: 'Del',
};

export function keyLabel(key: string): string {
  const k = norm(key);
  return LABELS[k] ?? (k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1));
}
```

- [ ] **Step 3: The handler reads the table**

In `main.ts`, `bootBattlefield` holds `let bindings = bindingsFrom(req.settings.get().controls.bindings)` and re-reads it whenever settings change (the `set` in `settingsDeps` calls a registered `onSettings` listener list; add `onChange(fn): Disposer` to `SettingsDeps` — one line in Task 4's type, do it here). The listener at line 2049 becomes:

```ts
const action = resolveKey(bindings, ev);
switch (action) {
  case 'halt': orders.halt(); break;
  case 'cycleChips': if (hud.cycleChipFocus()) ev.preventDefault(); break;
  case 'selectAll': /* existing body of the ctrl+a branch */ ev.preventDefault(); break;
  case 'overlay': /* existing */ break;
  case 'load': orders.load(); break;
  case 'unload': orders.unload(); break;
  case 'production': production?.focusFirst(); break;
  case 'smoke': runVerb('smoke'); break;
  case 'mute': /* existing */ break;
  case 'pause': /* Task 6 */ break;
  case 'panUp': case 'panDown': case 'panLeft': case 'panRight': keys.add(action); break;
  case null: /* the digit branches stay exactly as they are below */ break;
}
```

and the pan block in the loop tests `keys.has('panUp')` etc. (the `keyup` listener maps its key through `resolveKey` too and deletes the action; the `blur` listener clears the set as before). `ORDERS[].key` in `selection-model.ts` becomes the action id (`'halt'`, `'smoke'`, `'load'`, `'unload'`; `attackMove` keeps `'RMB'` with `rebindable` irrelevant), and `hud.ts:1058` renders `deps.keyFor?.(row.key) ?? row.key`, with `keyFor: (id) => isAction(id) ? keyLabel(bindings[id]) : id` passed from `bootBattlefield` (export `isAction` from keymap.ts). `hud.test.ts` gains one assertion: with `keyFor` mapping `halt` to `'J'`, the Halt button shows `J`.

- [ ] **Step 4: The rebinding rows**

`settings-keymap.ts` `keymapRows(deps).mount(table)` appends, for each `ACTIONS` entry, a `.rl-settings__row` with the label, a `<kbd>` showing `keyLabel(bindings[id])` (with "ctrl +" prefixed for the modifier class), and for rebindable actions a "Change" button: on click the kbd reads "press a key…", a one-shot capture-phase `keydown` on `window` takes the next key (Escape cancels), calls `rebind`; on `ok:false` the row's hint says `Already used by ${label of takenBy}` for 2 s; on `ok:true` calls `deps.set(next)`. A final row has a "Reset to defaults" button (`deps.set(bindingsFrom({}))`). `settings-keymap.test.ts` drives one rebind through DOM events (jsdom `KeyboardEvent`) and asserts `set` received the new table, and one conflict that leaves `set` uncalled. In `main.ts`, `settingsDeps.keymap = keymapRows({ bindings: () => bindingsFrom(settings.controls.bindings), set: (next) => settingsDeps.set({ ...settings, controls: { ...settings.controls, bindings: overridesOf(next) } }) })`.

- [ ] **Step 5: Gates, falsify, drive, commit**

Falsify: remove the `holder` check from `rebind` — "refuses a key another action holds" goes red. Restore. Drive: rebind Halt to J in `/settings`, start a sandbox, select a squad, press J — it halts, and the order row shows `J`. Commit:

```bash
git add packages/app/src/input/keymap.ts packages/app/src/input/keymap.test.ts packages/app/src/ui/settings-keymap.ts packages/app/src/ui/settings-keymap.test.ts packages/app/src/main.ts packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/selection-model.ts packages/app/src/ui/settings-panel.ts
git commit -m "feat(input): the keyboard is a table -- one source for the handler, the button labels and rebinding

resolveKey replaces the if-chain; ORDERS carries action ids and the HUD asks keyFor; settings
rebinds with conflicts named. Seen red: rebind without the holder check." -- <paths>
```

---

### Task 6: The clock and the pause menu

**Files:**
- Create: `packages/app/src/shell/clock.ts`, `packages/app/src/shell/clock.test.ts`, `packages/app/src/ui/pause.ts`, `packages/app/src/ui/pause.test.ts`
- Modify: `packages/app/src/main.ts` (the loop at 2732–2768, the `'pause'` case, `BattlefieldRequest.restart`), `packages/app/src/ui/theme.css` (`.rl-pause`), `packages/app/src/ui/hud.ts` (`paintSpeed` shows the paused state)

**Interfaces:**
- Consumes: `confirmDialog` (`ui/confirm.ts`), `settingsPanel` (Task 4), `resolveKey` (Task 5), `routes` and `Router.navigate` (Tasks 0–1).
- Produces:
  ```ts
  // packages/app/src/shell/clock.ts
  export const MAX_ACC_MS = 250;
  export interface Clock { acc: number; last: number }
  export function advance(c: Clock, now: number, speed: number, paused: boolean, msPerTick: number): { ticks: number; frameMs: number };
  ```
  ```ts
  // packages/app/src/ui/pause.ts
  export interface PauseDeps {
    objectives(): readonly { text: string; primary: boolean; status: string }[];
    onResume(): void;
    onRestart(): void;        // the caller confirms
    onQuit(): void;           // the caller confirms
    settings: SettingsDeps;
    build: string;
  }
  export function pauseMenu(host: HTMLElement, deps: PauseDeps): { close: Disposer };
  ```
  - `BattlefieldRequest` gains `restart(): void` (the mount passes `() => void router.navigate(router.href(req.path, req.query), { replace: true, force: true })`).

- [ ] **Step 1: Write the failing clock tests**

```ts
// packages/app/src/shell/clock.test.ts
import { describe, expect, it } from 'vitest';
import { MAX_ACC_MS, advance, type Clock } from './clock';

describe('advance', () => {
  it('runs one tick per 50 ms of wall time at speed 1', () => {
    const c: Clock = { acc: 0, last: 0 };
    expect(advance(c, 16, 1, false, 50)).toEqual({ ticks: 0, frameMs: 16 });
    expect(advance(c, 50, 1, false, 50).ticks).toBe(1);
    expect(c.acc).toBeCloseTo(0);
  });
  it('doubles at speed 2 and runs none at speed 0', () => {
    const c: Clock = { acc: 0, last: 0 };
    expect(advance(c, 100, 2, false, 50).ticks).toBe(4);
    expect(advance(c, 200, 0, false, 50).ticks).toBe(0);
  });
  it('paused: no ticks, no accumulation, whatever the speed', () => {
    const c: Clock = { acc: 0, last: 0 };
    expect(advance(c, 1000, 2, true, 50).ticks).toBe(0);
    expect(c.acc).toBe(0);
    expect(c.last).toBe(1000);
    expect(advance(c, 1050, 1, false, 50).ticks).toBe(1);   // resuming does not replay the pause
  });
  it('clamps a background-tab gap to MAX_ACC_MS so it never spirals', () => {
    const c: Clock = { acc: 0, last: 0 };
    expect(advance(c, 10_000, 1, false, 50).ticks).toBe(MAX_ACC_MS / 50);
  });
});
```

- [ ] **Step 2: Write `clock.ts`**

```ts
// packages/app/src/shell/clock.ts
/**
 * The mission's accumulator, pulled out of the rAF loop so "paused" can be
 * tested without a browser. The rules are main.ts's own: speed feeds the
 * ACCUMULATOR, never the tick (invariant 1 — a tick is 50 ms of sim time at
 * every setting); a gap over MAX_ACC_MS is cut, not replayed; and a pause
 * accumulates nothing, so resuming runs the next frame's ticks and not the
 * pause's worth.
 */
export const MAX_ACC_MS = 250;

export interface Clock {
  acc: number;
  last: number;
}

export function advance(c: Clock, now: number, speed: number, paused: boolean, msPerTick: number): { ticks: number; frameMs: number } {
  const frameMs = now - c.last;
  c.last = now;
  if (paused) return { ticks: 0, frameMs };
  c.acc += frameMs * speed;
  if (c.acc > MAX_ACC_MS) c.acc = MAX_ACC_MS;
  let ticks = 0;
  while (c.acc >= msPerTick) {
    ticks++;
    c.acc -= msPerTick;
  }
  return { ticks, frameMs };
}
```

The loop in `main.ts` becomes:

```ts
const clock: Clock = { acc: 0, last: performance.now() };
const loop = (): void => {
  rafId = requestAnimationFrame(loop);
  const { ticks, frameMs } = advance(clock, performance.now(), gameSpeed, paused, MS_PER_TICK);
  lastFrameMs = frameMs;
  for (let i = 0; i < ticks; i++) runTick();
  // ...the pan block, then
  renderer.frame(clock.acc / MS_PER_TICK, lastFrameMs);
  updateHover();
};
```

`__lions.step` is untouched (it calls `runTick` directly and works while paused — the tools depend on that).

- [ ] **Step 3: Write the failing pause tests**

```ts
// packages/app/src/ui/pause.test.ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import { pauseMenu } from './pause';

function deps() {
  return {
    objectives: () => [{ text: 'Take the crossroads', primary: true, status: 'active' }, { text: 'Lose no one', primary: false, status: 'active' }],
    onResume: vi.fn(), onRestart: vi.fn(), onQuit: vi.fn(),
    settings: { get: () => DEFAULT_SETTINGS, set: vi.fn(), fullscreen: null, audio: null, locales: [{ id: 'en', name: 'English' }], keymap: null, build: '0.68.0', onChange: () => () => {} },
    build: '0.68.0',
  };
}

describe('pauseMenu', () => {
  it('is a modal that lists the objectives and takes focus', () => {
    const d = deps();
    pauseMenu(document.body, d);
    const dlg = document.querySelector('.rl-pause');
    expect(dlg?.getAttribute('role')).toBe('dialog');
    expect(dlg?.getAttribute('aria-modal')).toBe('true');
    expect(dlg?.textContent).toContain('Take the crossroads');
    expect(document.activeElement?.textContent).toBe('Resume');
  });
  it('Escape and Resume both resume; nothing else leaks to the game', () => {
    const d = deps();
    pauseMenu(document.body, d);
    const leaked = vi.fn();
    window.addEventListener('keydown', leaked);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
    expect(leaked).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(d.onResume).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', leaked);
    expect(document.querySelector('.rl-pause')).toBeNull();
  });
  it('the Settings tab mounts the settings table inside the modal, not a navigation', () => {
    const d = deps();
    pauseMenu(document.body, d);
    (document.querySelector('.rl-pause button[data-tab="settings"]') as HTMLButtonElement).click();
    expect(document.querySelector('.rl-pause .rl-settings')).not.toBeNull();
  });
  it('Restart and Quit hand off to the caller without closing (the caller confirms)', () => {
    const d = deps();
    pauseMenu(document.body, d);
    (document.querySelector('.rl-pause button[data-act="restart"]') as HTMLButtonElement).click();
    expect(d.onRestart).toHaveBeenCalledTimes(1);
    (document.querySelector('.rl-pause button[data-act="quit"]') as HTMLButtonElement).click();
    expect(d.onQuit).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.rl-pause')).not.toBeNull();
  });
});
```

- [ ] **Step 4: Write `pause.ts`**

Mirror `confirm.ts`'s modal skeleton exactly (scrim, `role=dialog`, `aria-modal`, opener focus captured and restored, a bubble-phase `keydown` for Escape and a capture-phase guard that `stopPropagation()`s everything but Escape/Enter/Tab). The panel: title "Paused", a tab row (`Objectives` | `Settings`, buttons with `data-tab`), the objectives list (`<ol>`, primaries first, each `text` with a status word), an action row (`Resume` focused first, `Restart`, `Settings`, `Quit to campaign` with `data-act`), and `Build ${build}` dim at the foot. The Settings tab calls `settingsPanel(pane, deps.settings)` on first open and keeps it. `close()` removes everything and restores focus. Styles: `.rl-pause` reuses `.rl-confirm`'s scrim and `.rl-confirm__panel`'s ground; `.rl-pause__tabs`, `.rl-pause__list`, `.rl-pause__actions` — rem, tokens, no literals.

- [ ] **Step 5: Wire it in `bootBattlefield`**

`let paused = false; let pauseHandle: { close: Disposer } | null = null;` and

```ts
const pause = (): void => {
  if (paused) return;
  paused = true;
  hud.paintSpeed();   // paintSpeed reads deps.isPaused?.() and marks the cluster
  pauseHandle = pauseMenu(document.body, {
    objectives: () => runtime?.objectiveList ?? [],
    onResume: resume,
    onRestart: () => { void confirmDialog(document.body, { title: 'Restart the mission?', body: 'This attempt is lost.', confirm: 'Restart', danger: true }).then((ok) => { if (ok) req.restart(); }); },
    onQuit: () => { void confirmDialog(document.body, { title: 'Leave the mission?', body: 'This attempt is lost. The campaign keeps everything from before it.', confirm: 'Leave', danger: true }).then((ok) => { if (ok) req.navigate(routes.campaign()); }); },
    settings: req.settings,
    build: __APP_BUILD__,
  });
};
const resume = (): void => {
  if (!paused) return;
  paused = false;
  pauseHandle?.close();
  pauseHandle = null;
  hud.paintSpeed();
};
onDispose(() => pauseHandle?.close());
```

The `'pause'` case in the key switch: `if (paused) resume(); else pause();` — but the pause modal's own capture guard swallows Escape while it is open, and its bubble handler calls `onResume`, so in practice the switch only ever opens. `HudDeps` gains `isPaused?: () => boolean`; `paintSpeed` sets `data-paused="1"` on the speed cluster and theme.css dims the chips under it. The confirm dialogs stack over the pause modal correctly because `confirmDialog`'s capture guard registers later and therefore runs first.

- [ ] **Step 6: Gates, falsify, drive, commit**

Falsify: make `advance` accumulate while paused — "paused: no ticks" goes red. Drive: in a sandbox press Escape; the HUD clock stops, the camera still pans with WASD, `__lions.sim.tickCount` in the console does not change over five seconds, `__lions.step(1)` still advances it by one; Resume; Escape → Settings → music slider moves the theme; Quit → confirm → the campaign board, no reload (`performance.getEntriesByName('rl:boot').length === 1`). Commit:

```bash
git add packages/app/src/shell/clock.ts packages/app/src/shell/clock.test.ts packages/app/src/ui/pause.ts packages/app/src/ui/pause.test.ts packages/app/src/main.ts packages/app/src/ui/hud.ts packages/app/src/ui/theme.css
git commit -m "feat(shell): Escape pauses -- a modal over a world that keeps drawing while the sim stops

The accumulator is a pure clock with a paused input; the pause menu lists the objectives, mounts
settings inside itself, and hands restart and quit to confirms. Seen red: accumulating while paused." -- <paths>
```

---

### Task 7: Continue, New campaign, and save slots over both stores

**Files:**
- Modify: `packages/app/src/campaign.ts` (+ `campaign.test.ts`): `continueTarget`
- Create: `packages/app/src/profile.ts`, `packages/app/src/profile.test.ts`, `packages/app/src/ui/saves.ts`, `packages/app/src/ui/saves.test.ts`
- Modify: `packages/app/src/main.ts` (`/saves` route, the menu's `continue`/`reset` opts, `purgeCampaign`), `packages/app/src/ui/menu.ts` (first nav item "Continue", "New campaign" replaces "reset campaign ledger", aside "Saves"), `packages/app/src/ui/menu.test.ts`, `packages/app/src/ui/theme.css` (`.rl-saves`)

**Interfaces:**
- Consumes: `LedgerData` (`@lions/sim`), `BrigadeAccount`, `loadAccount`, `saveAccount`, `migrateAccount`, `ACCOUNT_KEY`, `StorageLike` (`brigade-account.ts`), `LEDGER_KEY`, `TUTORIAL_DONE_KEY` (`main.ts:155,160` — export them), `nextMissionOf`, `regionProgress`, `ParsedWorld` (`campaign.ts`), `confirmDialog`, `routes`.
- Produces:
  ```ts
  // campaign.ts
  export function continueTarget(world: ParsedWorld, ledger: LedgerData, tutorial: { id: string; done: boolean }): { missionId: string; kind: 'tutorial' | 'next' } | null;
  ```
  ```ts
  // profile.ts
  export const SAVES_KEY = 'lions.saves';
  export const SAVE_VERSION = 1 as const;
  export interface SaveSlot { version: 1; id: string; name: string; savedAt: number; build: string; ledger: LedgerData; account: BrigadeAccount; tutorialDone: boolean }
  export interface SlotMeta { id: string; name: string; savedAt: number; build: string; missions: number; credits: number }
  export interface ActiveState { ledger: LedgerData; account: BrigadeAccount; tutorialDone: boolean }
  export function readActive(store: StorageLike): ActiveState;
  export function writeActive(store: StorageLike, s: ActiveState): void;
  export function listSlots(store: StorageLike): SlotMeta[];
  export function saveSlot(store: StorageLike, id: string, name: string, s: ActiveState, build: string, now: number): SaveSlot;
  export function loadSlot(store: StorageLike, id: string): SaveSlot | null;
  export function deleteSlot(store: StorageLike, id: string): void;
  export function exportSlot(slot: SaveSlot): string;                       // JSON, stable key order
  export function importSlot(json: string): SaveSlot;                       // throws Error('not a Roaring Lions save') on anything else
  ```
  ```ts
  // ui/saves.ts
  export interface SavesDeps { store: StorageLike; build: string; now(): number; back: string; download(name: string, json: string): void; pickFile(): Promise<string | null>; onChanged(): void }
  export function showSaves(stage: HTMLElement, deps: SavesDeps): Disposer;
  ```
  - `MenuOptions` gains `continue?: { missionId: string; name: string; kind: 'tutorial' | 'next' }` and `newCampaign?: () => void` (replacing `reset`), and the aside gains `Saves` and `Settings` links.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/campaign.test.ts  (append)
describe('continueTarget', () => {
  const world = parseWorld(worldJson);   // the file's existing fixture
  const tutorial = { id: 'beit_sahwan_0_tutorial', done: false };
  it('names the tutorial first on an empty ledger', () => {
    expect(continueTarget(world, {}, tutorial)).toEqual({ missionId: 'beit_sahwan_0_tutorial', kind: 'tutorial' });
  });
  it('names the first open mission of the live region once the tutorial is done', () => {
    expect(continueTarget(world, {}, { ...tutorial, done: true })).toEqual({ missionId: 'beit_sahwan_1_recon', kind: 'next' });
  });
  it('follows the ledger through a town', () => {
    const ledger = { 'campaign.completed_missions': ['beit_sahwan_1_recon'] };
    expect(continueTarget(world, ledger, { ...tutorial, done: true })?.missionId).toBe('beit_sahwan_2_foothold');
  });
  it('returns null when every mission is complete', () => {
    const all = world.regions.flatMap((r) => r.towns).flatMap((t) => t.missions);
    expect(continueTarget(world, { 'campaign.completed_missions': all }, { ...tutorial, done: true })).toBeNull();
  });
});
```

```ts
// packages/app/src/profile.test.ts
import { describe, expect, it } from 'vitest';
import { ACCOUNT_KEY, emptyAccount } from './brigade-account';
import { LEDGER_KEY, TUTORIAL_DONE_KEY } from './main-keys';   // see Step 2: the two keys move to a tiny module both main.ts and profile.ts import
import { SAVES_KEY, deleteSlot, exportSlot, importSlot, listSlots, loadSlot, readActive, saveSlot, writeActive } from './profile';

function memStore() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
}
const ledger = { 'campaign.completed_missions': ['beit_sahwan_1_recon'], 'roe.mission_ratings': { beit_sahwan_1_recon: 88 } };
const account = { ...emptyAccount(), balance: 120, earned_total: 120 };

describe('profile slots', () => {
  it('a slot round-trips the ledger and the account byte for byte', () => {
    const s = memStore();
    writeActive(s, { ledger, account, tutorialDone: true });
    const before = { ledger: s.map.get(LEDGER_KEY), account: s.map.get(ACCOUNT_KEY) };
    saveSlot(s, 'a', 'First push', readActive(s), '0.68.0', 1_700_000_000_000);
    s.map.delete(LEDGER_KEY);
    s.map.delete(ACCOUNT_KEY);
    s.map.delete(TUTORIAL_DONE_KEY);
    const slot = loadSlot(s, 'a');
    if (!slot) throw new Error('slot missing');
    writeActive(s, slot);
    expect(s.map.get(LEDGER_KEY)).toBe(before.ledger);
    expect(s.map.get(ACCOUNT_KEY)).toBe(before.account);
    expect(s.map.get(TUTORIAL_DONE_KEY)).toBe('1');
  });
  it('lists slots newest first with the numbers the screen shows', () => {
    const s = memStore();
    saveSlot(s, 'a', 'Old', { ledger, account, tutorialDone: true }, '0.68.0', 1);
    saveSlot(s, 'b', 'New', { ledger: {}, account: emptyAccount(), tutorialDone: false }, '0.68.0', 2);
    expect(listSlots(s).map((m) => [m.id, m.missions, m.credits])).toEqual([['b', 0, 0], ['a', 1, 120]]);
  });
  it('export and import are inverse, and import refuses a stranger', () => {
    const s = memStore();
    const slot = saveSlot(s, 'a', 'X', { ledger, account, tutorialDone: false }, '0.68.0', 5);
    expect(importSlot(exportSlot(slot))).toEqual(slot);
    expect(() => importSlot('{"hello":1}')).toThrow('not a Roaring Lions save');
    expect(() => importSlot('nope')).toThrow('not a Roaring Lions save');
  });
  it('import migrates an old account shape through migrateAccount and drops unknown ledger keys never', () => {
    const raw = JSON.stringify({ version: 1, id: 'z', name: 'Z', savedAt: 1, build: '0.60.0', ledger: { 'campaign.completed_missions': [], 'future.key': 1 }, account: { version: 1, balance: 3 }, tutorialDone: false });
    const slot = importSlot(raw);
    expect(slot.account.version).toBe(1);
    expect(slot.account.paid).toEqual({});
    expect(slot.ledger['future.key']).toBe(1);
  });
  it('a corrupt slot store reads as empty, and a delete of a missing id is a no-op', () => {
    const s = memStore();
    s.map.set(SAVES_KEY, '{');
    expect(listSlots(s)).toEqual([]);
    expect(() => deleteSlot(s, 'nope')).not.toThrow();
  });
});
```

- [ ] **Step 2: Implement**

Move `LEDGER_KEY` and `TUTORIAL_DONE_KEY` (and `loadLedger`/`saveLedger`, `main.ts:155-172`) into `packages/app/src/main-keys.ts`, exported, imported back by `main.ts` — three names, no behaviour change. Then:

```ts
// packages/app/src/campaign.ts (append)
export function continueTarget(
  world: ParsedWorld,
  ledger: LedgerData,
  tutorial: { id: string; done: boolean }
): { missionId: string; kind: 'tutorial' | 'next' } | null {
  const done = new Set(ledger['campaign.completed_missions'] ?? []);
  if (!tutorial.done && done.size === 0) return { missionId: tutorial.id, kind: 'tutorial' };
  for (const region of world.regions) {
    if (regionProgress(region, ledger).status !== 'live') continue;
    for (const town of region.towns) {
      const next = nextMissionOf(town, ledger);
      if (next !== null) return { missionId: next, kind: 'next' };
    }
  }
  return null;
}
```

(Check `regionProgress`'s status vocabulary in `campaign.ts` before relying on `'live'`; the test fixture decides which mission is first.)

```ts
// packages/app/src/profile.ts
/**
 * Save slots. The ACTIVE campaign stays where it always was — the ledger under
 * `lions.campaign.ledger`, the brigade account under `lions.brigade.account`,
 * the tutorial flag under `lions.tutorial.done` — so nothing that reads them
 * changes. A slot is a snapshot of all three, named, under `lions.saves`.
 * Loading a slot writes the three keys back; saving reads them. Two stores
 * or it is not a save: the brigade account survives a new campaign on
 * purpose (spec 2026-09-15 §4.1), so a slot that carried only the ledger
 * would restore a campaign into the wrong brigade.
 */
import type { LedgerData } from '@lions/sim';
import { ACCOUNT_KEY, loadAccount, migrateAccount, saveAccount, type BrigadeAccount, type StorageLike } from './brigade-account';
import { LEDGER_KEY, TUTORIAL_DONE_KEY, loadLedger, saveLedger } from './main-keys';

export const SAVES_KEY = 'lions.saves';
export const SAVE_VERSION = 1 as const;

export interface SaveSlot {
  version: typeof SAVE_VERSION;
  id: string;
  name: string;
  savedAt: number;
  build: string;
  ledger: LedgerData;
  account: BrigadeAccount;
  tutorialDone: boolean;
}

export interface SlotMeta { id: string; name: string; savedAt: number; build: string; missions: number; credits: number }
export interface ActiveState { ledger: LedgerData; account: BrigadeAccount; tutorialDone: boolean }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function readActive(store: StorageLike): ActiveState {
  return { ledger: loadLedger(store), account: loadAccount(store), tutorialDone: store.getItem(TUTORIAL_DONE_KEY) === '1' };
}

export function writeActive(store: StorageLike, s: ActiveState): void {
  saveLedger(store, s.ledger);
  saveAccount(store, s.account);
  if (s.tutorialDone) store.setItem(TUTORIAL_DONE_KEY, '1');
  else store.removeItem(TUTORIAL_DONE_KEY);
}

function readAll(store: StorageLike): Record<string, SaveSlot> {
  try {
    const v: unknown = JSON.parse(store.getItem(SAVES_KEY) ?? '{}');
    if (!isRecord(v)) return {};
    const out: Record<string, SaveSlot> = {};
    for (const [id, raw] of Object.entries(v)) {
      try {
        out[id] = importSlot(JSON.stringify(raw));
      } catch {
        // a damaged slot is skipped, never allowed to hide its neighbours
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(store: StorageLike, all: Record<string, SaveSlot>): void {
  store.setItem(SAVES_KEY, JSON.stringify(all));
}

export function listSlots(store: StorageLike): SlotMeta[] {
  return Object.values(readAll(store))
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((s) => ({
      id: s.id, name: s.name, savedAt: s.savedAt, build: s.build,
      missions: (s.ledger['campaign.completed_missions'] ?? []).length,
      credits: s.account.balance,
    }));
}

export function saveSlot(store: StorageLike, id: string, name: string, s: ActiveState, build: string, now: number): SaveSlot {
  const slot: SaveSlot = { version: SAVE_VERSION, id, name, savedAt: now, build, ledger: s.ledger, account: s.account, tutorialDone: s.tutorialDone };
  const all = readAll(store);
  all[id] = slot;
  writeAll(store, all);
  return slot;
}

export function loadSlot(store: StorageLike, id: string): SaveSlot | null {
  return readAll(store)[id] ?? null;
}

export function deleteSlot(store: StorageLike, id: string): void {
  const all = readAll(store);
  if (!(id in all)) return;
  delete all[id];
  writeAll(store, all);
}

export function exportSlot(slot: SaveSlot): string {
  return JSON.stringify(slot);
}

export function importSlot(json: string): SaveSlot {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    throw new Error('not a Roaring Lions save');
  }
  if (!isRecord(v) || v.version !== SAVE_VERSION || typeof v.id !== 'string' || typeof v.name !== 'string' || !isRecord(v.ledger) || !isRecord(v.account)) {
    throw new Error('not a Roaring Lions save');
  }
  return {
    version: SAVE_VERSION,
    id: v.id,
    name: v.name,
    savedAt: typeof v.savedAt === 'number' ? v.savedAt : 0,
    build: typeof v.build === 'string' ? v.build : '',
    ledger: v.ledger as LedgerData,
    account: migrateAccount(v.account),
    tutorialDone: v.tutorialDone === true,
  };
}
```

`loadLedger`/`saveLedger` take a `StorageLike` now (they read `window.localStorage` directly at `main.ts:162-172`; give them a parameter and pass `safeStorage()` from `main.ts` — `readAll` never sees `ACCOUNT_KEY` directly, it goes through `loadAccount`). Check `migrateAccount(raw: unknown)`'s real signature at `brigade-account.ts:100`.

- [ ] **Step 3: The saves screen**

`showSaves(stage, deps)`: a `.rl-menu.rl-menu--saves` wrap with a `.rl-panel` "Saves": a row per `listSlots` entry (name, `savedAt` as a date via `Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })`, `N missions · M credits · build`), buttons `Load` (confirm: "Replace your current campaign and brigade with this save?"), `Export` (`deps.download(`${name}.lions-save.json`, exportSlot(slot))`), `Delete` (confirm, danger); a "Save current campaign" form (text input for the name, default `Save ${n + 1}`; writes `saveSlot(store, crypto.randomUUID(), name, readActive(store), build, now())`); an "Import a save file" button (`deps.pickFile()` → `importSlot` → `saveSlot` under a fresh id; a thrown error shows its message in an `aria-live` line, never an alert); back link. Every mutation re-renders the list and calls `deps.onChanged()`. `saves.test.ts` covers: the list renders newest first; save adds a slot; load calls `writeActive` (assert the store keys after confirming through `.rl-confirm__yes`); import of a bad file shows the message and adds nothing. In `main.ts`, `download` is a Blob + `<a download>` click and `pickFile` an `<input type=file accept=".json">` read through `File.text()`; the route is `/saves`, `onChanged` re-reads nothing (the menu reads the ledger when it mounts).

- [ ] **Step 4: The menu**

`mountMenu` computes `continueTarget(worldData, loadLedger(store), { id: 'beit_sahwan_0_tutorial', done: tutorialDone })` and passes `continue: target && { missionId, name: missions[target.missionId]?.name ?? target.missionId, kind }`. `showMenu` renders it as the FIRST nav item: `Continue — ${name}` (kind `next`) or `Start — ${name}` (kind `tutorial`), href `routes.mission(missionId)`; when `continue` is absent (campaign complete) the first item is `Campaign` as today. The tutorial item at `menu.ts:102` is dropped when `continue.kind === 'tutorial'` names it already. "reset campaign ledger" becomes "New campaign" with the body `Your campaign progress and tutorial completion start over. Your brigade — its credits, unlocks and upgrades — stays.` and `confirm: 'Start over'`; on confirm `opts.newCampaign?.()` → `purgeCampaign(); void router.navigate(routes.menu(), { replace: true, force: true })`. Aside gains `Saves` (`routes.saves()`) and `Settings` (`routes.settings()`) — the latter was added in Task 4; keep the order: replay the tutorial · free play · saves · settings · new campaign · credits (Task 8). `menu.test.ts` pins the first item for both kinds and the New-campaign body's "stays" sentence.

- [ ] **Step 5: Gates, falsify, drive, commit**

Falsify: make `writeActive` skip the account — the byte-for-byte test goes red. Drive: play the tutorial to its first step, save a slot, New campaign, load the slot → the menu's Continue names the tutorial's successor again and the brigade balance is unchanged; export → a file downloads; import it back → a second slot. Commit:

```bash
git add packages/app/src/campaign.ts packages/app/src/campaign.test.ts packages/app/src/profile.ts packages/app/src/profile.test.ts packages/app/src/main-keys.ts packages/app/src/ui/saves.ts packages/app/src/ui/saves.test.ts packages/app/src/main.ts packages/app/src/ui/menu.ts packages/app/src/ui/menu.test.ts packages/app/src/ui/theme.css
git commit -m "feat(shell): Continue names the next mission; save slots carry the ledger AND the brigade; New campaign says what it keeps

Slots under lions.saves snapshot the three active keys and restore them; export/import through
the browser's file APIs. Seen red: a slot that skipped the account." -- <paths>
```

---

### Task 8: Credits — people, libraries, fonts, assets, the licence, the disclosure, the build

**Files:**
- Create: `packages/app/src/credits-data.ts`, `packages/app/src/credits-data.test.ts`, `packages/app/src/ui/credits.ts`, `packages/app/src/ui/credits.test.ts`
- Modify: `packages/app/src/main.ts` (`/credits` route), `packages/app/src/ui/menu.ts` (aside "Credits"), `packages/app/src/ui/theme.css` (`.rl-credits`), `LICENSE:25-26`, `data/LICENSE.md`, `README.md:112-114` (R-7), `docs/ASSET_PROVENANCE.md` (one line: the credits screen is the player-facing surface of this file)

**Interfaces:**
- Produces:
  ```ts
  // credits-data.ts
  export interface LibraryCredit { name: string; version: string; licence: string; url: string }
  export interface FontCredit { family: string; licenceFile: string; holder: string }
  export interface AssetCredit { what: string; author: string; licence: string; source: string }
  export const CREDITS: {
    people: readonly string[];
    libraries: readonly LibraryCredit[];
    fonts: readonly FontCredit[];
    assets: readonly AssetCredit[];
    codeLicence: string;
    artLicence: string;
    aiDisclosure: string;
  };
  ```
  ```ts
  // ui/credits.ts
  export function showCredits(stage: HTMLElement, deps: { base: string; build: string; back: string; fetchText(url: string): Promise<string> }): Disposer;
  ```

- [ ] **Step 1: Write the failing data test — the one that cannot go stale**

```ts
// packages/app/src/credits-data.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREDITS } from './credits-data';

const ROOT = new URL('../../../', import.meta.url).pathname;
const pkg = (p: string): { dependencies?: Record<string, string> } => JSON.parse(readFileSync(`${ROOT}${p}`, 'utf8'));

describe('CREDITS', () => {
  it('names every third-party runtime dependency of the shipping packages, at the installed major.minor', () => {
    const deps = new Map<string, string>();
    for (const p of ['packages/app/package.json', 'packages/render/package.json', 'packages/data/package.json', 'packages/sim/package.json']) {
      for (const [name, range] of Object.entries(pkg(p).dependencies ?? {})) if (!range.startsWith('workspace:')) deps.set(name, range);
    }
    expect(deps.size).toBeGreaterThan(0);
    for (const [name] of deps) {
      const c = CREDITS.libraries.find((l) => l.name === name);
      expect(c, `${name} is shipped and not credited`).toBeDefined();
      const installed = JSON.parse(readFileSync(`${ROOT}node_modules/${name}/package.json`, 'utf8')) as { version: string; license?: string };
      expect(installed.version.startsWith(c?.version ?? '?'), `${name}: credited ${c?.version}, installed ${installed.version}`).toBe(true);
      expect(c?.licence).toBe(installed.license);
    }
  });
  it('names every font file under assets/fonts with a licence file that exists', () => {
    const files = readdirSync(`${ROOT}assets/fonts`);
    for (const f of CREDITS.fonts) expect(files, f.licenceFile).toContain(f.licenceFile);
    const families = files.filter((f) => f.endsWith('.woff2')).map((f) => f.split('-')[0]);
    for (const fam of new Set(families)) expect(CREDITS.fonts.some((f) => f.licenceFile.toLowerCase().includes(fam.replace(/[^a-z]/gi, '').toLowerCase().slice(0, 5))), `${fam} has no credit`).toBe(true);
  });
  it('states the licences the repository states', () => {
    const licence = readFileSync(`${ROOT}LICENSE`, 'utf8');
    expect(licence.startsWith('MIT License')).toBe(true);
    expect(CREDITS.codeLicence).toContain('MIT');
    expect(licence).toContain(CREDITS.artLicence);
  });
});
```

- [ ] **Step 2: Write the data**

```ts
// packages/app/src/credits-data.ts
/**
 * What the credits screen says. Pinned by credits-data.test.ts against the
 * package.json files, the fonts directory and LICENSE, so a dependency or a
 * font cannot ship uncredited and the licence line cannot drift from the file.
 * Asset attributions come from docs/ASSET_PROVENANCE.md; the entries here are
 * the ones whose licence REQUIRES a credit. AI-generated assets are disclosed
 * as a class, per CONTRIBUTING.md.
 */
export interface LibraryCredit { name: string; version: string; licence: string; url: string }
export interface FontCredit { family: string; licenceFile: string; holder: string }
export interface AssetCredit { what: string; author: string; licence: string; source: string }

export const CREDITS = {
  people: ['Ilan Pinto and the Roaring Lions contributors'],
  libraries: [
    { name: 'three', version: '0.170', licence: 'MIT', url: 'https://threejs.org' },
    { name: 'pixi.js', version: '8.19', licence: 'MIT', url: 'https://pixijs.com' },
  ],
  fonts: [
    { family: 'Big Shoulders Display', licenceFile: 'OFL-BigShouldersDisplay.txt', holder: 'The Big Shoulders Project Authors' },
    { family: 'Barlow', licenceFile: 'OFL-Barlow.txt', holder: 'The Barlow Project Authors' },
    { family: 'IBM Plex Mono', licenceFile: 'OFL-IBMPlexMono.txt', holder: 'IBM Corp.' },
  ],
  assets: [
    { what: 'Namer IFV model (sprite sheets NAMER_HULL, NAMER_TURR)', author: 'Mutte', licence: 'CC BY 3.0', source: 'BlendSwap #75225' },
  ],
  codeLicence: 'MIT License',
  artLicence: 'all rights reserved',
  aiDisclosure:
    'Some models were generated with Meshy and reworked in Blender. Every asset, generated or drawn, passes the same four art gates before it ships; the full provenance record is docs/ASSET_PROVENANCE.md in the repository.',
} as const satisfies {
  people: readonly string[]; libraries: readonly LibraryCredit[]; fonts: readonly FontCredit[]; assets: readonly AssetCredit[];
  codeLicence: string; artLicence: string; aiDisclosure: string;
};
```

Verify the installed versions with `cat node_modules/three/package.json | head` before writing them; the test pins the prefix.

- [ ] **Step 3: Align the licence files (R-7)**

`LICENSE:25-26` becomes: `This license covers the source code in this repository. Game data (data/) and art assets (art/, assets/) are all rights reserved — see data/LICENSE.md.` `data/LICENSE.md` is rewritten to state the same, with the sentence from `docs/ART_PIPELINE.md:181` about the irrevocability of copies obtained under the earlier CC BY-SA 4.0 grant kept verbatim (that sentence is the honest part). `README.md:112-114` says the same in one line. This is the project lead's 2026-08-30 decision made consistent on disk; it is named in the landing report so it can be reversed in one line.

- [ ] **Step 4: The screen**

`showCredits`: `.rl-menu.rl-menu--credits` with a `.rl-panel` "Credits": sections *Made by* (people), *Built with* (libraries as `name version — licence`, linked), *Type* (each font with holder and a `<details>` whose body is the OFL text fetched from `${base}fonts/${licenceFile}` on open — `deps.fetchText`; a failed fetch shows "licence text unavailable offline"), *Art and models* (the asset credits, then the AI disclosure paragraph), *Licence* (`Code: ${codeLicence}. Art and data: ${artLicence}.`), and `Build ${build}`. `credits.test.ts`: renders every library name and the Namer credit; opening a `<details>` calls `fetchText` with the right URL and shows its text; a rejected fetch shows the fallback. Route `/credits`; menu aside "Credits" last.

- [ ] **Step 5: Gates, falsify, commit**

Falsify: remove `pixi.js` from `CREDITS.libraries` — the dependency test goes red naming it. Restore. Commit:

```bash
git add packages/app/src/credits-data.ts packages/app/src/credits-data.test.ts packages/app/src/ui/credits.ts packages/app/src/ui/credits.test.ts packages/app/src/main.ts packages/app/src/ui/menu.ts packages/app/src/ui/theme.css LICENSE data/LICENSE.md README.md docs/ASSET_PROVENANCE.md
git commit -m "feat(shell): credits -- people, libraries, the three OFL texts, the Namer credit, the AI disclosure, the build

CREDITS is pinned against package.json, assets/fonts and LICENSE. LICENSE and data/LICENSE.md
now say what ART_PIPELINE.md decided on 2026-08-30. Seen red: pixi.js dropped from the list." -- <paths>
```

---

### Task 9: The i18n seam — catalogue, `t()`, plurals, the pseudo-locale, and the validator that keeps strings out of the source

**Files:**
- Create: `packages/app/src/i18n/format.ts`, `format.test.ts`, `t.ts`, `t.test.ts`, `pseudo.ts`, `pseudo.test.ts`, `locales.ts`, `en.json`, `tools/validate_i18n.mjs`, `tools/validate_i18n.d.mts`, `tools/src/validate_i18n.test.ts`
- Modify: `package.json` (`validate:ui` runs both validators), `packages/app/src/sandbox-help.ts` (`KNOWN_PARAMS` + `pseudo`, `lang`), `packages/app/src/main.ts` (locale from settings/`?lang`/`?pseudo` before any screen mounts; `settingsDeps.locales`), `packages/app/src/settings.ts` (language validated against `LOCALES`)

**Interfaces:**
- Produces:
  ```ts
  // i18n/format.ts
  export type Params = Readonly<Record<string, string | number>>;
  export function format(message: string, params: Params, locale: string): string;
  // Syntax: `{name}` interpolates; `{n, plural, one {# unit} other {# units}}` selects by Intl.PluralRules(locale).select(n),
  //         `#` inside a branch is the number; `=0 {none}` exact matches win; unknown category falls back to `other`;
  //         `{name, select, a {A} b {B} other {C}}` selects by string. Braces nest one level. Unmatched → the raw text.
  // i18n/t.ts
  export type Catalogue = Readonly<Record<string, string>>;
  export function setCatalogue(locale: string, messages: Catalogue, transform?: (s: string) => string): void;
  export function t(key: string, params?: Params): string;     // missing key → the key, and one console.warn per key per session
  export function currentLocale(): string;
  export function missingKeys(): readonly string[];             // for the tests and the capture pass
  // i18n/pseudo.ts
  export function pseudo(s: string): string;                    // 'Deploy' → '⟦Ðéþļöý·⟧'  (accents, ~30% padding, brackets; {…} spans untouched)
  // i18n/locales.ts
  export interface Locale { id: string; name: string; dir: 'ltr' | 'rtl' }
  export const LOCALES: readonly Locale[];                      // [{ id: 'en', name: 'English', dir: 'ltr' }]
  export function applyLocale(root: HTMLElement, id: string): void;   // lang + dir
  export async function loadLocale(id: string, base: string): Promise<Catalogue>;   // en from the bundled JSON; others fetch `${base}locales/${id}.json` (none ship yet)
  ```
  - `tools/validate_i18n.mjs`: `export function bareStringFailures(file, source): string[]`; `MIGRATED` list of files it scans (grows in Tasks 10–11, then becomes the whole of `packages/app/src`).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/i18n/format.test.ts
import { describe, expect, it } from 'vitest';
import { format } from './format';

describe('format', () => {
  it('interpolates named params and leaves unknown ones visible', () => {
    expect(format('Conduct {conduct}', { conduct: 88 }, 'en')).toBe('Conduct 88');
    expect(format('Hello {who}', {}, 'en')).toBe('Hello {who}');
  });
  it('selects English plural categories and substitutes #', () => {
    const m = '{n, plural, one {# unit survives} other {# units survive}}';
    expect(format(m, { n: 1 }, 'en')).toBe('1 unit survives');
    expect(format(m, { n: 0 }, 'en')).toBe('0 units survive');
    expect(format(m, { n: 12 }, 'en')).toBe('12 units survive');
  });
  it('exact matches win over categories', () => {
    const m = '{n, plural, =0 {none carried} one {# carried} other {# carried}}';
    expect(format(m, { n: 0 }, 'en')).toBe('none carried');
    expect(format(m, { n: 1 }, 'en')).toBe('1 carried');
  });
  it('select on a string, with other as the fallback', () => {
    const m = '{result, select, victory {Mission accomplished} defeat {Mission failed} other {Mission over}}';
    expect(format(m, { result: 'victory' }, 'en')).toBe('Mission accomplished');
    expect(format(m, { result: 'draw' }, 'en')).toBe('Mission over');
  });
  it('nests one level and keeps text around the argument', () => {
    expect(format('{n, plural, one {{n} position is} other {{n} positions are}} marked', { n: 2 }, 'en')).toBe('2 positions are marked');
  });
  it('uses the locale plural rules (Arabic has six categories; Hebrew has two/many)', () => {
    const m = '{n, plural, one {a} two {b} few {c} many {d} other {e}}';
    expect(format(m, { n: 2 }, 'ar')).toBe('b');
    expect(format(m, { n: 2 }, 'he')).toBe('b');
    expect(format(m, { n: 5 }, 'en')).toBe('e');
  });
});
```

```ts
// packages/app/src/i18n/t.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentLocale, missingKeys, setCatalogue, t } from './t';

describe('t', () => {
  beforeEach(() => setCatalogue('en', { 'menu.campaign': 'Campaign', 'hud.survivors': '{n, plural, one {# unit survives} other {# units survive}}' }));
  it('looks a key up and formats', () => {
    expect(t('menu.campaign')).toBe('Campaign');
    expect(t('hud.survivors', { n: 1 })).toBe('1 unit survives');
    expect(currentLocale()).toBe('en');
  });
  it('returns the key for a miss, warns once, and records it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(t('nope.key')).toBe('nope.key');
    expect(t('nope.key')).toBe('nope.key');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(missingKeys()).toContain('nope.key');
    warn.mockRestore();
  });
  it('a transform (the pseudo-locale) wraps the formatted text but never the params', () => {
    setCatalogue('pseudo', { 'hud.survivors': '{n, plural, one {# unit survives} other {# units survive}}' }, (s) => `⟦${s}⟧`);
    expect(t('hud.survivors', { n: 3 })).toBe('⟦3 units survive⟧');
  });
});
```

```ts
// packages/app/src/i18n/pseudo.test.ts
import { describe, expect, it } from 'vitest';
import { pseudo } from './pseudo';

describe('pseudo', () => {
  it('accents every letter, pads by about a third, and brackets the result', () => {
    const p = pseudo('Deploy');
    expect(p.startsWith('⟦') && p.endsWith('⟧')).toBe(true);
    expect(p).not.toContain('Deploy');
    expect(p.length).toBeGreaterThanOrEqual('Deploy'.length + 2 + 2);
  });
  it('leaves interpolated values alone', () => {
    expect(pseudo('Conduct 88')).toContain('88');
  });
  it('is stable for the same input', () => {
    expect(pseudo('Campaign')).toBe(pseudo('Campaign'));
  });
});
```

```ts
// tools/src/validate_i18n.test.ts
import { describe, expect, it } from 'vitest';
import { bareStringFailures } from '../validate_i18n.mjs';

describe('bareStringFailures', () => {
  it('flags a literal with words assigned to a text sink', () => {
    expect(bareStringFailures('x.ts', `el.textContent = 'Deploy now';`)).toHaveLength(1);
    expect(bareStringFailures('x.ts', 'el.title = `Leave the mission`;')).toHaveLength(1);
    expect(bareStringFailures('x.ts', `el.setAttribute('aria-label', 'Close');`)).toHaveLength(1);
    expect(bareStringFailures('x.ts', 'el.innerHTML = `<b>enemy reinforcements</b> inbound`;')).toHaveLength(1);
  });
  it('accepts t() calls, glyphs, ids and data passthrough', () => {
    expect(bareStringFailures('x.ts', `el.textContent = t('menu.campaign');`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.textContent = '▮▮';`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.textContent = '1×';`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.textContent = mission.name;`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.className = 'rl-menu__back';`)).toEqual([]);
    expect(bareStringFailures('x.ts', `el.textContent = \`\${n} / \${m}\`;`)).toEqual([]);
  });
  it('honours a line-level exemption comment for a proper noun', () => {
    expect(bareStringFailures('x.ts', `el.textContent = 'Roaring Lions'; /* i18n-ok: proper noun */`)).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement `format.ts`**

```ts
// packages/app/src/i18n/format.ts
/**
 * A small ICU-shaped message format: `{name}`, `{n, plural, …}`, `{s, select,
 * …}`, one level of nesting. Not the whole of ICU — no offsets, no number
 * formats, no dates — because nothing in the shell needs them yet and a
 * dependency for the rest is a licence line and 40 kB for four features.
 * Plural categories come from Intl.PluralRules for the locale, which is what
 * makes Hebrew's `two`/`many` and Arabic's six a data change later.
 */
export type Params = Readonly<Record<string, string | number>>;

function splitTopLevel(body: string): { arg: string; kind: string | null; rest: string } {
  const first = body.indexOf(',');
  if (first < 0) return { arg: body.trim(), kind: null, rest: '' };
  const second = body.indexOf(',', first + 1);
  if (second < 0) return { arg: body.slice(0, first).trim(), kind: body.slice(first + 1).trim(), rest: '' };
  return { arg: body.slice(0, first).trim(), kind: body.slice(first + 1, second).trim(), rest: body.slice(second + 1).trim() };
}

/** `one {# unit} other {# units}` → [['one', '# unit'], ['other', '# units']] */
function branches(rest: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  while (i < rest.length) {
    while (i < rest.length && /\s/.test(rest[i])) i++;
    const open = rest.indexOf('{', i);
    if (open < 0) break;
    const sel = rest.slice(i, open).trim();
    let depth = 0;
    let j = open;
    for (; j < rest.length; j++) {
      if (rest[j] === '{') depth++;
      else if (rest[j] === '}' && --depth === 0) break;
    }
    out.push([sel, rest.slice(open + 1, j)]);
    i = j + 1;
  }
  return out;
}

function pluralCategory(n: number, locale: string): string {
  try {
    return new Intl.PluralRules(locale).select(n);
  } catch {
    return n === 1 ? 'one' : 'other';
  }
}

export function format(message: string, params: Params, locale: string): string {
  let out = '';
  let i = 0;
  while (i < message.length) {
    const open = message.indexOf('{', i);
    if (open < 0) {
      out += message.slice(i);
      break;
    }
    out += message.slice(i, open);
    let depth = 0;
    let j = open;
    for (; j < message.length; j++) {
      if (message[j] === '{') depth++;
      else if (message[j] === '}' && --depth === 0) break;
    }
    if (j >= message.length) {
      out += message.slice(open);
      break;
    }
    const body = message.slice(open + 1, j);
    const { arg, kind, rest } = splitTopLevel(body);
    const value = params[arg];
    if (kind === null) {
      out += value === undefined ? `{${arg}}` : String(value);
    } else if (kind === 'plural' && typeof value === 'number') {
      const bs = branches(rest);
      const exact = bs.find(([s]) => s === `=${value}`);
      const cat = pluralCategory(value, locale);
      const pick = exact ?? bs.find(([s]) => s === cat) ?? bs.find(([s]) => s === 'other');
      out += pick ? format(pick[1].replace(/#/g, String(value)), params, locale) : `{${arg}}`;
    } else if (kind === 'select') {
      const bs = branches(rest);
      const pick = bs.find(([s]) => s === String(value)) ?? bs.find(([s]) => s === 'other');
      out += pick ? format(pick[1], params, locale) : `{${arg}}`;
    } else {
      out += `{${body}}`;
    }
    i = j + 1;
  }
  return out;
}
```

- [ ] **Step 3: Implement `t.ts`, `pseudo.ts`, `locales.ts`, seed `en.json`**

`t.ts` keeps module state `{ locale, messages, transform, missing: Set<string>, warned: Set<string> }`; `t(key, params)` → `messages[key]` → `format(msg, params ?? {}, locale)` → `transform?.(result) ?? result`; a miss returns `key`, warns once, records. `pseudo.ts`: map each ASCII letter through a fixed accented table (`a→á, b→ƀ, c→ç, d→ð, e→é, …`), skip `{…}` spans and runs of digits, append `·` padding of `ceil(letters * 0.3)`, wrap in `⟦ ⟧`. `locales.ts` as in the interface; `loadLocale('en')` imports `./en.json` (JSON modules typecheck already — `tsconfig.base.json` has `resolveJsonModule`); `'pseudo'` returns the `en` catalogue with `setCatalogue('pseudo', en, pseudo)`. `en.json` seeds the keys the settings, pause, saves and credits screens use (Tasks 4–8 wrote literals; convert THOSE FOUR NEW FILES to `t()` in this task, so the validator's first `MIGRATED` list has real members): keys are dotted, screen-first (`settings.video`, `settings.uiScale.auto`, `pause.resume`, `saves.load.confirm.body`, `credits.builtWith`), never sentence text.

- [ ] **Step 4: The validator**

```js
// tools/validate_i18n.mjs
// A chrome string that reaches the DOM as a literal is a string the catalogue
// cannot translate. This scans the MIGRATED files for a text sink being
// assigned a literal with words in it. Reference-free and cheap; falsified
// in validate_i18n.test.ts and by the mutation in the commit that added it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SINKS = /(?:\.textContent|\.innerText|\.innerHTML|\.title|\.placeholder|\.ariaLabel)\s*=\s*(['"`])((?:(?!\1)[\s\S])*)\1/g;
const ATTR = /setAttribute\(\s*['"](?:aria-label|title|placeholder)['"]\s*,\s*(['"`])((?:(?!\1)[\s\S])*)\1/g;
const WORDS = /[A-Za-z]{3,}/;
const OK = /i18n-ok/;

export function bareStringFailures(file, source) {
  const out = [];
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    if (OK.test(line)) return;
    for (const re of [SINKS, ATTR]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const lit = m[2];
        const text = lit.replace(/\$\{[^}]*\}/g, '').replace(/<[^>]+>/g, '');
        if (WORDS.test(text)) out.push(`${file}:${i + 1}: bare chrome string ${JSON.stringify(lit.slice(0, 40))} -- use t('…') or tag the line /* i18n-ok: reason */`);
      }
    }
  });
  return out;
}

/** Grows in Tasks 10-11; Task 11's last commit replaces it with a directory walk. */
export const MIGRATED = [
  'packages/app/src/ui/settings-panel.ts',
  'packages/app/src/ui/settings-keymap.ts',
  'packages/app/src/ui/pause.ts',
  'packages/app/src/ui/saves.ts',
  'packages/app/src/ui/credits.ts',
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL('..', import.meta.url).pathname;
  const failures = MIGRATED.flatMap((f) => bareStringFailures(f, readFileSync(join(root, f), 'utf8')));
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log(`validate:i18n OK -- ${MIGRATED.length} file(s), no bare chrome strings`);
}
```

`tools/validate_i18n.d.mts` declares the two exports (mirror `tools/validate_ui_palette.d.mts`). `package.json`: `"validate:ui": "node tools/validate_ui_palette.mjs && node tools/validate_i18n.mjs"`.

- [ ] **Step 5: Boot wiring**

In `main.ts`, before the router starts: `const q = new URLSearchParams(window.location.search); const lang = q.get('lang') ?? settings.language; const cat = await loadLocale(q.has('pseudo') ? 'pseudo' : lang, BASE); setCatalogue(...); applyLocale(document.documentElement, lang);` — `pseudo` and `lang` join `KNOWN_PARAMS` with blurbs; the router's `start({ drop: ['fresh'] })` does NOT drop them (they must survive a reload). `settingsDeps.locales = LOCALES`; `settings.ts`'s `language` validator uses `LOCALES.some((l) => l.id === v)` instead of the regex. `t()`'s locale for plural rules is the catalogue's id (`'en'` under pseudo).

- [ ] **Step 6: Gates, falsify, commit**

Falsify: (a) in `format.ts` make `pluralCategory` always return `'other'` — the plural test goes red; (b) drop `SINKS`' `.title` alternative — the validator test's second assertion goes red; (c) put `el.textContent = 'Hello world';` into `pause.ts` — `pnpm validate:ui` goes red on that line. Restore all three. Commit:

```bash
git add packages/app/src/i18n packages/app/src/ui/settings-panel.ts packages/app/src/ui/settings-keymap.ts packages/app/src/ui/pause.ts packages/app/src/ui/saves.ts packages/app/src/ui/credits.ts packages/app/src/main.ts packages/app/src/settings.ts packages/app/src/sandbox-help.ts tools/validate_i18n.mjs tools/validate_i18n.d.mts tools/src/validate_i18n.test.ts package.json
git commit -m "feat(i18n): t(), a message format with real plural rules, a pseudo-locale, and a validator that refuses bare chrome strings

The four new screens speak through the catalogue; ?pseudo=1 and ?lang= are known params; the
locale table carries dir. Seen red: plural always other; .title dropped from the sinks; a bare
literal in pause.ts." -- <paths>
```

---

### Task 10: Extraction, batch A — the shell screens

**Files:**
- Modify: `packages/app/src/ui/menu.ts`, `brigade.ts`, `debrief.ts`, `loading.ts`, `worldmap.ts`, `worldmap3d.ts`, `grade-copy.ts`, `role.ts`, `mark.ts` (proper nouns tagged `/* i18n-ok: proper noun */`), `confirm.ts` callers' copy (already in the screens above), `tutorial/panel.ts`, `packages/app/src/i18n/en.json`, `tools/validate_i18n.mjs` (`MIGRATED` += these files), their tests where a test asserts English copy (assert through `t()` or keep the literal — the catalogue is `en`, so both read the same; prefer the literal in tests, it is the falsification of the catalogue).

**Interfaces:** consumes `t()`; produces ~110 new `en.json` keys under `menu.*`, `brigade.*`, `debrief.*`, `loading.*`, `world.*`, `grade.*`, `role.*`, `tutorial.*`.

- [ ] **Step 1: Inventory, then extract, file by file**

Run `node -e "…"`-free: `grep -nE "(textContent|innerHTML|innerText|title|placeholder)\s*=\s*['\"\`]" <file>` and `grep -n "setAttribute('aria-label'" <file>` per file; every hit with words becomes `t('<screen>.<thing>')` with the English moved to `en.json`. Plurals and interpolations use the format: `loading.ts:149`'s sentence becomes the key `loading.marked` = `{n, plural, one {# position your recon marked is} other {# positions your recon marked are}} on your map before a shot is fired.` and the call `t('loading.marked', { n: marked })`; the always-plural nouns the inventory named (`brigade.ts` "N of M stars", "N credits"; `worldmap.ts` "N / M missions"; `loading.ts` "N / M sheets"; `debrief.ts` "N credits") get real `plural` forms now — that is the point of the seam. Data text (mission `name`/`briefing`/`objectives[].text`/`label`, unit names, world.json copy, flag blurbs, tutorial step text) is NOT extracted: it flows through unchanged, and the validator ignores it because it is never a literal.

- [ ] **Step 2: Grow the validator**

Append every file above to `MIGRATED`; `pnpm validate:ui` must be green. Falsify once: revert one extraction by hand (`git diff` shows which), run the validator, see the line named, redo it.

- [ ] **Step 3: The pseudo pass**

Run `pnpm ui:shots -- --pseudo --out=.superpowers/ui-shots/p1-task10` (Task 13 adds `--pseudo`; until then, load each screen with `?pseudo=1` in the browser and screenshot by hand). Every chrome word on the menu, campaign, brigade, free play, briefing, debrief, settings, saves and credits screens shows the ⟦ ⟧ brackets; any plain word is an unextracted string — fix it. Write `missingKeys()` (from the console: `__lions` is absent on shell screens, so expose `window.__lionsI18n = { missingKeys }` in dev builds only — `import.meta.env.DEV`) into the report: it must be empty.

- [ ] **Step 4: Gates and commit**

```bash
git add packages/app/src/ui/menu.ts packages/app/src/ui/brigade.ts packages/app/src/ui/debrief.ts packages/app/src/ui/loading.ts packages/app/src/ui/worldmap.ts packages/app/src/ui/worldmap3d.ts packages/app/src/ui/grade-copy.ts packages/app/src/ui/role.ts packages/app/src/ui/mark.ts packages/app/src/tutorial/panel.ts packages/app/src/i18n/en.json tools/validate_i18n.mjs <tests>
git commit -m "feat(i18n): the shell screens speak through the catalogue -- ~110 keys, five real plurals

Menu, campaign, brigade, free play, briefing, debrief, tutorial panel. Seen red: one extraction
reverted, the validator names the line." -- <paths>
```

---

### Task 11: Extraction, batch B — the HUD and the mission side, plus the mission-text locale overlay

**Files:**
- Modify: `packages/app/src/ui/hud.ts`, `hud-model.ts`, `selection-model.ts`, `dock-model.ts`, `production.ts`, `mission-notice.ts`, `roe-notice.ts`, `packages/app/src/main.ts` (`describeMissionEvent` at 321–364, every `hud.note(...)` literal), `packages/app/src/input/intents.ts` (the `.note.text` strings), `packages/app/src/gate-sentence.ts`, `packages/app/src/input/keymap.ts` (`ACTIONS[].label`), `packages/app/src/i18n/en.json`, `tools/validate_i18n.mjs` (the `MIGRATED` list becomes a walk of `packages/app/src/**/*.ts` minus tests), `packages/data/src/index.ts` (`applyMissionLocale`), `tools/validate_narrative.mjs` (+`.d.mts`, `overlayFailures`), `tools/validate_data.mjs` (wire it), `data/locales/README.md`
- Test: the existing `*.test.ts` beside each file (assert copy through literals as in Task 10), `packages/data/src/mission-locale.test.ts`, `tools/src/validate_narrative.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  // packages/data/src/index.ts
  export interface MissionLocaleOverlay { [missionId: string]: { name?: string; briefing?: string; objectives?: Record<string, string>; triggers?: Record<string, string> } }
  export function applyMissionLocale(mission: MissionJson, overlay: MissionLocaleOverlay | null): MissionJson;   // a new object; objectives/triggers keyed by their ids
  ```
  - `tools/validate_narrative.mjs`: `export function overlayFailures(file, overlay, missions)` — every mission id, objective id and trigger id in an overlay must exist, and every `label` value obeys the schema's 48-character cap; `validate:data` runs it over `data/locales/*/missions.json` (none ship yet; the test fixture proves the rule).

- [ ] **Step 1: Extract**

The inventory's numbers: `hud.ts` ~65 strings (the largest — its capability lines, condition flags, the control hint, the projected-fire headings), `main.ts` ~26 (`describeMissionEvent`, `hud.note` calls — including the three `unit(s)` sites at 340, 1983 and the survivors line at 357 that reads "units" for one survivor: real plurals now), `intents.ts`'s note texts, `selection-model.ts`'s `ORDERS[].label`, `keymap.ts`'s `ACTIONS[].label` (a function of the key: `label: () => t('keymap.halt')`, or keep `label` as the key and translate at render — pick the latter, it keeps `ACTIONS` data). `hud.note()` takes HTML (`innerHTML`); keys whose value carries `<b>` tags keep the tag in the catalogue value, and the validator's `<[^>]+>` strip already ignores markup.

- [ ] **Step 2: The mission-text overlay seam**

```ts
// packages/data/src/index.ts (append)
export function applyMissionLocale(mission: MissionJson, overlay: MissionLocaleOverlay | null): MissionJson {
  const o = overlay?.[mission.id];
  if (!o) return mission;
  return {
    ...mission,
    name: o.name ?? mission.name,
    briefing: o.briefing ?? mission.briefing,
    objectives: mission.objectives.map((ob) => (o.objectives?.[ob.id] !== undefined ? { ...ob, text: o.objectives[ob.id] } : ob)),
    triggers: mission.triggers?.map((tr) => (o.triggers?.[tr.id] !== undefined ? { ...tr, label: o.triggers[tr.id] } : tr)),
  };
}
```

`main.ts` applies it where a mission is resolved (`missions[missionId]` at line ~700): `applyMissionLocale(raw, await loadMissionOverlay(lang, BASE))` where the loader fetches `${base}locales/${lang}/missions.json` and returns `null` for `en` or a 404. `mission-locale.test.ts`: an overlay renames one objective and one trigger label and leaves the rest identical (`toEqual` on the untouched fields); a missing mission id is a no-op. `overlayFailures` in `validate_narrative.mjs` with a fixture overlay naming a bogus objective id → one failure; `validate_data.mjs` walks `data/locales/*/missions.json` (zero files today) and `data/locales/README.md` states the shape and that `en` is the source, never an overlay.

- [ ] **Step 3: The validator walks the tree**

Replace `MIGRATED` with a walk of `packages/app/src` (`.ts`, not `.test.ts`, not `sandbox-help.ts` — its blurbs are console text by that file's own header, and `unknownParams`' warning names a URL flag on purpose; tag its two DOM readers in `menu.ts` with `/* i18n-ok: dev tool */` if the picker's blurbs are to stay English, which they are: R-3 of the spec's own list). Run `pnpm validate:ui`; fix every line it names. Then falsify the walk by dropping the `.test.ts` exclusion — it must go red on a test literal — and restore.

- [ ] **Step 4: The pseudo pass, again**

`?pseudo=1` on a mission: the HUD strip, the unit card, the order row, the projected-fire panel, a `hud.note`, the end screen and the debrief all bracketed; `missingKeys()` empty. Photograph three states into the report.

- [ ] **Step 5: Gates and commit**

```bash
git add packages/app/src/ui/hud.ts packages/app/src/ui/hud-model.ts packages/app/src/ui/selection-model.ts packages/app/src/ui/dock-model.ts packages/app/src/ui/production.ts packages/app/src/ui/mission-notice.ts packages/app/src/ui/roe-notice.ts packages/app/src/main.ts packages/app/src/input/intents.ts packages/app/src/input/keymap.ts packages/app/src/gate-sentence.ts packages/app/src/i18n/en.json tools/validate_i18n.mjs packages/data/src/index.ts packages/data/src/mission-locale.test.ts tools/validate_narrative.mjs tools/validate_narrative.d.mts tools/validate_data.mjs data/locales/README.md <tests>
git commit -m "feat(i18n): the HUD and the mission side speak through the catalogue; mission text has a locale overlay validate:data gates

Every chrome string in packages/app is a key now and the validator walks the whole tree. Seen red:
the .test.ts exclusion dropped; an overlay naming a bogus objective id." -- <paths>
```

---

### Task 12: Colour-vision variants, measured under simulated deficiency

**Files:**
- Modify: `data/palette.json` (`reserved.team.variants`), `packages/app/vite-plugin-palette.ts` (publish `--rl-team-<variant>-<key>`), `packages/app/src/ui/theme.css` (`:root[data-cvd='…']` blocks), `packages/data/src/index.ts` (`paletteTeamColors(variant)`), `packages/app/src/main.ts` (`teamColors` and the minimap's tuple from the setting), `tools/src/bad-text-contrast.test.ts` (every variant's `hostile_text` ≥ 4.5:1)
- Create: `tools/src/cvd.ts`, `tools/src/cvd.test.ts`

**Interfaces:**
- Produces: `paletteTeamColors(variant: 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia'): [kedem: string, hostile: string, neutral: string]` in `@lions/data`; CSS `--rl-team-deuteranopia-kedem` etc.; `tools/src/cvd.ts`: `simulate(hex: string, kind: 'deuteranopia' | 'protanopia' | 'tritanopia'): [r, g, b]` (linear-light, Machado, Oliveira & Fernandes 2009 severity 1.0 matrices) and `labDistance(a, b): number` (CIE76 ΔE).

- [ ] **Step 1: Write the failing gate**

```ts
// tools/src/cvd.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { labDistance, simulate } from './cvd';

const palette = JSON.parse(readFileSync(new URL('../../data/palette.json', import.meta.url), 'utf8')) as {
  reserved: { team: { colors: Record<string, string>; variants: Record<string, Record<string, string>> } };
};
const KINDS = ['deuteranopia', 'protanopia', 'tritanopia'] as const;
const FLOOR = 25;   // CIE76 ΔE; 2.3 is a just-noticeable difference, 25 is "a different colour at a glance"

describe('team colours under simulated colour-vision deficiency', () => {
  it('the DEFAULT team colours are what a CVD variant exists to fix: at least one pair collapses', () => {
    const c = palette.reserved.team.colors;
    const worst = Math.min(...KINDS.flatMap((k) => [
      labDistance(simulate(c.kedem, k), simulate(c.hostile, k)),
      labDistance(simulate(c.kedem, k), simulate(c.neutral, k)),
      labDistance(simulate(c.hostile, k), simulate(c.neutral, k)),
    ]));
    expect(worst).toBeLessThan(FLOOR);
  });
  for (const k of KINDS) {
    it(`${k}: every pair of team colours stays apart by ΔE ≥ ${FLOOR} under simulation`, () => {
      const v = palette.reserved.team.variants[k];
      const pairs: [string, string][] = [[v.kedem, v.hostile], [v.kedem, v.neutral], [v.hostile, v.neutral]];
      for (const [a, b] of pairs) expect(labDistance(simulate(a, k), simulate(b, k)), `${a} vs ${b}`).toBeGreaterThanOrEqual(FLOOR);
    });
  }
  it('the simulation is the identity for grey and darkens nothing to black', () => {
    for (const k of KINDS) expect(labDistance(simulate('#808080', k), simulate('#808080', 'tritanopia'))).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Implement `cvd.ts` and choose the values**

`simulate`: hex → sRGB → linear (the standard 2.4 curve) → multiply by the matrix for the kind → clamp → return linear RGB. Matrices (Machado et al. 2009, severity 1.0; verify against the paper's Table before committing and cite the row in the file header):

```
protanopia    [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]]
deuteranopia  [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]]
tritanopia    [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
```

`labDistance`: linear RGB → XYZ (D65) → CIELAB → Euclidean. Starting values for the variants, from the Okabe–Ito set, to be adjusted only if the gate says so: deuteranopia and protanopia `kedem #0072B2, hostile #D55E00, neutral #F0E442, hostile_text #F2A15C`; tritanopia `kedem #2F6FD9 (unchanged), hostile #D93A2B (unchanged), neutral #CC79A7, hostile_text #F26A55 (unchanged)`. Each `hostile_text` must clear 4.5:1 on `--bg` in `bad-text-contrast.test.ts` — extend that test to iterate the variants; lighten until it passes and record the final hex beside the number. `total_colors` moves by the number of new entries — read how `validate_data.mjs` counts it and keep it honest.

- [ ] **Step 3: Publish and apply**

`vite-plugin-palette.ts` emits `--rl-team-${variant}-${key}` for each variant entry. `theme.css` adds, after the team mappings at ~128–137:

```css
:root[data-cvd='deuteranopia'] { --friendly: var(--rl-team-deuteranopia-kedem); --bad: var(--rl-team-deuteranopia-hostile); --warn: var(--rl-team-deuteranopia-neutral); --bad-text: var(--rl-team-deuteranopia-hostile-text); }
/* …protanopia, tritanopia likewise */
```

`@lions/data` gains `paletteTeamColors(variant)` beside `paletteColor` (`packages/data/src/index.ts:334`), and `main.ts:849`'s `teamColors` and the minimap's tuple (`main.ts:1520-1525`) read `paletteTeamColors(req.settings.get().accessibility.colorVision)` — construction-time, like the renderer choice; the settings hint already says team colours apply "on the map, the minimap and the HUD", add "from the next mission" for the first two.

- [ ] **Step 4: Gates, falsify, drive, commit**

Falsify: set the deuteranopia `hostile` to `#00A000` (green) — that variant's gate goes red on kedem-vs-hostile or hostile-vs-neutral. Restore. Drive: settings → deuteranopia → a sandbox: HP bars and the minimap read orange/blue/yellow; the visual gate's four scenarios are unmoved at the default (run `pnpm golden-baseline` locally and confirm the deltas are the same as before the task). Commit:

```bash
git add data/palette.json packages/app/vite-plugin-palette.ts packages/app/src/ui/theme.css packages/data/src/index.ts packages/app/src/main.ts tools/src/bad-text-contrast.test.ts tools/src/cvd.ts tools/src/cvd.test.ts
git commit -m "feat(a11y): three colour-vision variants of the team colours, gated under simulated deficiency

Machado 2009 matrices, CIE76 ΔE ≥ 25 for every pair under each deficiency, hostile_text ≥ 4.5:1
per variant. Seen red: a green hostile under deuteranopia." -- <paths>
```

---

### Task 13: The capture harness photographs the new screens, pseudo-localised

**Files:**
- Modify: `tools/src/ui-review/shoot.ts`
- Docs: `CLAUDE.md` "Dev instruments" (one sentence: `--pseudo`, and the four new states)

**Interfaces:** `pnpm ui:shots -- [--pseudo] [--res=…] [--out=…]`; states `12-settings`, `13-credits`, `14-saves`, `15-pause`, `16-end-defeat`, `17-debrief`, and every existing state's URL moved to its path.

- [ ] **Step 1: Paths and `--pseudo`**

`arg('pseudo', '')` → `const PSEUDO = argv.includes('--pseudo')`; a `url(path)` helper returns `${BASE}${path}${PSEUDO ? (path.includes('?') ? '&' : '?') + 'pseudo=1' : ''}`. The eleven `page.goto` calls at lines 108–138 use `url('/')`, `url('/campaign')`, `url('/brigade')`, `url('/free-play')`, `url(`/mission/${MISSION}`)`. The escape-from-briefing check at line 143 expects `${BASE}/campaign` now.

- [ ] **Step 2: The new states**

After `04-sandboxes`: `url('/settings')` → `12-settings`; `url('/credits')` → `13-credits` (open the first `<details>` first); `url('/saves')` → `14-saves`. In the mission, after `06-hud-idle`: `page.keyboard.press('Escape')` → settle → `15-pause` → `Escape` again. After `11-hud-combat`: the scripted end — `page.evaluate(() => { const w = window.__lions; for (const u of w.units(0)) w.sim.debugKill(u.id); w.step(40); })` (check `sim.debugKill`'s name and signature in `packages/sim/src/sim.ts` — the wreck captures use it) → `waitForSelector('.rl-end')` (the end screen's root class; read `menu.ts:471`) → `16-end-defeat` → click the debrief button → `17-debrief`. The defeat path is the one a script can force without knowing the mission; a victory needs the objectives and stays a manual capture, said so in the harness header.

- [ ] **Step 3: Run it both ways**

`pnpm ui:shots -- --out=.superpowers/ui-shots/p1-task13` and `pnpm ui:shots -- --pseudo --out=.superpowers/ui-shots/p1-task13-pseudo`: 17 states × 3 resolutions each, and in the pseudo set every chrome word bracketed. Attach the two `15-pause` and `16-end-defeat` frames at 1400×900 to the report.

- [ ] **Step 4: Commit**

```bash
git add tools/src/ui-review/shoot.ts CLAUDE.md
git commit -m "tools(ui-shots): paths, --pseudo, and six more states -- settings, credits, saves, pause, a scripted defeat, the debrief" -- tools/src/ui-review/shoot.ts CLAUDE.md
```

---

### Task 14: The quality preset reaches the renderer (after the art session lands)

**Precondition:** `git fetch origin && git log origin/main --oneline | head` shows the art session's infantry-animation landing, or that session has said it no longer holds `ThreeRenderer.ts`. **Merge `origin/main` into this branch first**, run the full gate, and only then start. If the precondition is not met when every other task is done, the branch lands WITHOUT this task and the task is carried into the spec's status as the one Phase 1 item still open — do not touch `ThreeRenderer.ts` while it is held.

**Files:**
- Create: `packages/render/src/quality.ts`, `packages/render/src/quality.test.ts`
- Modify: `packages/render/src/api.ts` (`RendererOptions.quality?`), `packages/render/src/index.ts` (export), `packages/render/src/three/post-chain.ts` (`createPostChain` takes `quality`; the AO pass and the SMAA pass are conditional), `packages/render/src/three/lighting.ts` (`shadowMapSize` parameter), `packages/render/src/three/ThreeRenderer.ts` (two call sites pass `this.opts.quality ?? QUALITY_PRESETS.high`), `packages/app/src/main.ts` (`quality: QUALITY_PRESETS[settings.video.quality]` in the options at ~847), the existing post-chain and lighting tests

**Interfaces:**
```ts
// packages/render/src/quality.ts
export interface RenderQuality { ao: boolean; smaa: boolean; shadowMapSize: 1024 | 2048 | 4096 }
export const QUALITY_PRESETS: Readonly<Record<'low' | 'medium' | 'high', RenderQuality>> = {
  low: { ao: false, smaa: false, shadowMapSize: 1024 },
  medium: { ao: false, smaa: true, shadowMapSize: 2048 },
  high: { ao: true, smaa: true, shadowMapSize: 4096 },
};
```

- [ ] **Step 1: Tests first** — `quality.test.ts` pins the three presets and that `high` equals today's constants (`AO_RESOLUTION_SCALE` unchanged, `SHADOW_MAP_SIZE === 4096`); the post-chain test asserts the pass list for `low` is `RenderPass → FogOfWarPass → OutputPass → VignettePass` (no GTAO, no SMAA) and for `high` is today's; the lighting test asserts `sun.shadow.mapSize` follows the parameter.
- [ ] **Step 2: Implement** — the chain builder skips `createAoPass` when `!quality.ao` and skips `new SMAAPass` when `!quality.smaa`, keeping the order in the file header comment true in both cases; `lighting.ts` takes `shadowMapSize` with the old constant as the default so no other caller changes. `ThreeRenderer.ts`: the two lines. `main.ts`: the option.
- [ ] **Step 3: Falsify, gate, drive, commit** — falsify: make `low` keep SMAA → the pass-list test goes red. Drive: settings → Low → a sandbox: `__lions.renderer` reports no GTAO pass (expose nothing new; read it from the post-chain's pass list in the console via the existing debug surface, or the frame time in `perf:units`); the visual gate at High is unmoved (`pnpm golden-baseline` locally, same deltas as before). Commit with the trailer, paths explicit.

---

## Self-review

**Spec coverage (§6 Phase 1):** Router — Tasks 0–2 (route table, persistent stage, `navigate` with disposers, 200 ms crossfade via CSS, `?renderer=`/flags preserved as query, the deploy gate inside the mission route, legacy URLs redirecting; `/briefing` and `/debrief` narrowed by R-1). Settings — Tasks 3–5, 12, 14 (video incl. fullscreen/scale/quality, audio, controls incl. rebinding and camera speed with R-3's narrowing, accessibility incl. CVD/text size/reduced motion, language with the switch present). Pause — Task 6 (Escape, resume, objectives, restart with confirm, settings, quit with confirm; the frame loop keeps drawing, the sim stops). Continue/profile/save — Task 7 (Continue names the next mission; slots in the ledger's own shape plus the account, per spec §6 as amended; file export/import). Credits — Task 8 (contributors, library licences, the three OFL texts, the game's licence, the AI disclosure, the build id also in pause and settings). i18n — Tasks 9–11, 13 (catalogue, `t()` with plurals, every chrome string, the mission-text overlay `validate:data` gates, `?pseudo=1` through the capture harness; fonts narrowed by R-4). §7 evidence — the router's route-table and disposer tests (Task 0), `t()` and plural tests (Task 9), settings defaults and persistence (Task 4), the contrast test extended (Task 12), the capture harness with `--pseudo` and the scripted mission end (Task 13, which is also §7's (a) instrument from the spec's §10 amendment), the `pnpm ui:routes` reference-free check (Task 2).

**Acceptance (spec §6 Phase 1):** no full page reload between any two screens — `performance.mark('rl:boot')` counted by `pnpm ui:routes` (Task 2); settings persist across reload — Task 4's round-trip test and the drive; Escape pauses and resumes with the tick count unchanged — Task 6's clock test and the drive; a save slot round-trips the ledger byte-for-byte — Task 7's test, and the account with it; the pseudo-localised capture pass shows no clipped chrome string — Task 13's run (clipping is judged by eye on the 17 × 3 sheets; the report names any).

**Placeholder scan:** no TBD/TODO; every code step carries code or an exact anchor; Task 10/11's "extract every literal" steps are mechanical by construction and gated by the validator rather than by a listed diff.

**Type consistency:** `Disposer`, `RouteRequest`, `Mount`, `RouteDef` (Task 0) are consumed by name in 1, 2, 4, 6, 7, 8; `BattlefieldRequest` is declared in Task 1 and gains `navigate` (2), `settings` (4), `restart` (6) — each named where added; `SettingsDeps` (4) gains `keymap` (5, typed `KeymapDeps` from `settings-keymap.ts`, a stub type in Task 4) and `onChange` (5); `AudioGains` (3) is the type `SettingsDeps.audio.setGains` takes; `StorageLike` is the one in `brigade-account.ts` throughout; `LEDGER_KEY`/`TUTORIAL_DONE_KEY`/`loadLedger`/`saveLedger` move to `main-keys.ts` in Task 7 and take a store parameter there.

**Model tiering for the executor:** Task 1 and Task 2 on the most capable model (two thousand lines of `main.ts` under a function boundary, with teardown); Tasks 0, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14 on the standard model; Tasks 10 and 11 on the standard model too — they are mechanical, but a cheap model takes three times the turns across twenty files, and the validator is the real reviewer. Scoped re-reviews on the cheapest tier. The final whole-branch review on the most capable model.

**What lands in the spec's Deviations at landing:** R-1 … R-10 above as D-10 … D-19, each with what the executing session measured.
