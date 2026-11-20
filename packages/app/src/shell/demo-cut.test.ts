// @vitest-environment jsdom
//
// GH-1418 (lead, 20 Nov 2026): the desktop demo plays the tutorial and Beit Sahwan I to IV, and nothing else. Each gated
// surface is driven twice: with the lead's cut (only those five reachable) and with no cut, the web default (everything
// as before). Oracles are literal mission ids and paths.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { world as shippedWorld } from '@lions/data';
import type { LedgerData } from '@lions/sim';
import { campaignWorldJson, cutWorld, demoCut, freePlayOpen, missionInDemo, type DemoCut } from './demo-cut';
import { demoLeaveFor, gateDemoRoutes } from './demo-routes';
import { Router, type Disposer, type RouteDef, type RouteRequest } from './router';
import { continueTarget, missionOpen, nextMissionAfter, nextMissionOf, nextOperation, parseWorld, regionProgress } from '../campaign';
import { boardRestingLine, campaignComplete, closingExchange } from '../campaign-close';
import { t } from '../i18n/t';
import { worldMap } from '../ui/worldmap';
import { showMenu } from '../ui/menu';
import { parseCountries } from '../campaign';
import countriesJson from '../../../../data/campaign/countries.json';
import { MISSION_SAVE_VERSION, digestOf, parseSuspended } from '../mission-save';
import { SIM_EPOCH, SNAPSHOT_FORMAT } from '@lions/sim';

// The lead's rulings of 20 Nov 2026: the tutorial, First Light, then Beit Sahwan I to IV.
const LEAD: DemoCut = [
  'beit_sahwan_0_tutorial',
  'beit_sahwan_breach',
  'beit_sahwan_1_recon',
  'beit_sahwan_2_foothold',
  'beit_sahwan_3_clearance',
  'beit_sahwan_4_subterranean',
];
const I_TO_IV = ['beit_sahwan_1_recon', 'beit_sahwan_2_foothold', 'beit_sahwan_3_clearance', 'beit_sahwan_4_subterranean'];
/** The town's missions in the demo: First Light, then I to IV (world.json's own order). */
const TOWN = ['beit_sahwan_breach', ...I_TO_IV];
const OUTSIDE = ['qasr_liwan_1_recon', 'khan_rafid_1_recon', 'tel_marum_1_recon', 'wadi_halam_1_recon'];
// jsdom's URL is not node's, so files are named by path.
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** What `tools/desktop/demo.json` ships: the cut the world tests below are built from, so a change there reaches them. */
const SHIPPED_CUT = (JSON.parse(readFileSync(path.join(HERE, '..', '..', '..', '..', 'tools', 'desktop', 'demo.json'), 'utf8')) as { missions: string[] }).missions;
const MISSIONS = path.join(HERE, '..', '..', '..', '..', 'data', 'missions');
const ALL_MISSIONS = readdirSync(MISSIONS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => (JSON.parse(readFileSync(path.join(MISSIONS, f), 'utf8')) as { id: string }).id);
const done = (...ids: string[]): LedgerData => ({ 'campaign.completed_missions': ids });

afterEach(() => vi.unstubAllGlobals());

describe('the build constant', () => {
  it('is no cut when the build defined none (the web, dev, CI, every test)', () => {
    expect(demoCut()).toBeNull();
    expect(missionInDemo('qasr_liwan_1_recon')).toBe(true);
    expect(freePlayOpen()).toBe(true);
  });
  it('is the baked list in the demo build', () => {
    vi.stubGlobal('__DEMO_MISSIONS__', LEAD);
    expect(demoCut()).toEqual(LEAD);
    expect(missionInDemo('beit_sahwan_1_recon')).toBe(true);
    expect(missionInDemo('qasr_liwan_1_recon')).toBe(false);
    expect(freePlayOpen()).toBe(false);
  });
  it('fails closed on a malformed value: an empty cut, every mission shut', () => {
    for (const bad of [[], 'beit_sahwan_1_recon', [1], {}]) {
      vi.stubGlobal('__DEMO_MISSIONS__', bad);
      expect(demoCut()).toEqual([]);
      expect(missionInDemo('beit_sahwan_1_recon')).toBe(false);
    }
  });
  it('the predicate, by its own arguments', () => {
    for (const id of LEAD ?? []) expect(missionInDemo(id, LEAD)).toBe(true);
    for (const id of OUTSIDE) expect(missionInDemo(id, LEAD)).toBe(false);
    for (const id of ALL_MISSIONS) expect(missionInDemo(id, null)).toBe(true);
  });
});

describe('the campaign world', () => {
  const cut = parseWorld(cutWorld(shippedWorld, SHIPPED_CUT));
  it('is cut by what demo.json ships, which is the lead\'s six', () => expect(SHIPPED_CUT).toEqual(LEAD));
  const full = parseWorld(shippedWorld);

  it('with no cut is world.json itself, the same object', () => {
    expect(cutWorld(shippedWorld, null)).toBe(shippedWorld);
    expect(campaignWorldJson()).toBe(shippedWorld);
    expect(campaignWorldJson(null)).toBe(shippedWorld);
  });
  it('campaignWorldJson cuts world.json by the build constant', () => {
    vi.stubGlobal('__DEMO_MISSIONS__', LEAD);
    expect(parseWorld(campaignWorldJson()).regions.flatMap((r) => r.towns.flatMap((tw) => tw.missions))).toEqual(TOWN);
  });
  it('with the cut holds one town, Beit Sahwan, with First Light then I to IV in order, and is marked cut', () => {
    const towns = cut.regions.flatMap((r) => r.towns);
    expect(towns.map((tw) => tw.id)).toEqual(['beit_sahwan']);
    expect(towns[0]?.missions).toEqual(TOWN);
    expect(cut.cut).toBe(true);
    expect(full.cut).toBeUndefined();
  });
  it('keeps every region, those left with no town ungated and "no operations yet"', () => {
    expect(cut.regions.map((r) => r.id)).toEqual(full.regions.map((r) => r.id));
    for (const r of cut.regions.filter((x) => x.towns.length === 0)) {
      expect(r.unlock).toBeUndefined();
      expect(regionProgress(r, {}).status).toBe('empty');
    }
    expect(regionProgress(cut.regions[0]!, {}).status).toBe('live');
  });
  it('opens on First Light, the tutorial first, exactly as the full game does', () => {
    const town = cut.regions[0]!.towns[0]!;
    expect(nextMissionOf(town, {})).toBe('beit_sahwan_breach');
    expect(continueTarget(cut, {}, { id: 'beit_sahwan_0_tutorial', done: false })).toEqual({ missionId: 'beit_sahwan_0_tutorial', kind: 'tutorial' });
    expect(nextMissionAfter(cut, 'beit_sahwan_0_tutorial', {})).toBe('beit_sahwan_breach');
    expect(continueTarget(cut, done('beit_sahwan_0_tutorial'), { id: 'beit_sahwan_0_tutorial', done: true })).toEqual({ missionId: 'beit_sahwan_breach', kind: 'next' });
    expect(missionOpen(cut, 'beit_sahwan_breach', {})).toBe(true);
    expect(missionOpen(cut, 'beit_sahwan_1_recon', {})).toBe(false);
    // First Light leads on to I.
    expect(nextMissionAfter(cut, 'beit_sahwan_breach', done('beit_sahwan_breach'))).toBe('beit_sahwan_1_recon');
    expect(missionOpen(cut, 'beit_sahwan_1_recon', done('beit_sahwan_breach'))).toBe(true);
    // The same questions of the full world give the same answers.
    expect(nextMissionOf(full.regions[0]!.towns[0]!, {})).toBe('beit_sahwan_breach');
    expect(nextMissionAfter(full, 'beit_sahwan_0_tutorial', {})).toBe('beit_sahwan_breach');
  });
  it('walks First Light and I to IV in order, and after IV there is no next mission, no Next, no Continue', () => {
    expect(nextMissionAfter(cut, 'beit_sahwan_1_recon', done('beit_sahwan_breach', 'beit_sahwan_1_recon'))).toBe('beit_sahwan_2_foothold');
    expect(nextMissionAfter(cut, 'beit_sahwan_3_clearance', done(...TOWN.slice(0, 4)))).toBe('beit_sahwan_4_subterranean');
    const after = done('beit_sahwan_0_tutorial', ...TOWN);
    expect(nextMissionAfter(cut, 'beit_sahwan_4_subterranean', after)).toBeUndefined();
    expect(nextOperation(cut, after)).toBeNull();
    expect(continueTarget(cut, after, { id: 'beit_sahwan_0_tutorial', done: true })).toBeNull();
    // The full game goes on to the next town.
    expect(nextOperation(full, done(...TOWN))).toBe('qasr_liwan_1_recon');
  });
  it('is never a won war: no closing exchange, no "every front is closed" line', () => {
    const after = done(...TOWN);
    expect(campaignComplete(cut, after)).toBe(false);
    expect(closingExchange(cut, done(...TOWN.slice(0, 4)), after, 'victory')).toBeNull();
    expect(boardRestingLine(cut, after)).toBe(t('world3d.hint'));
    // The same world without the mark would have said the war was over.
    expect(campaignComplete({ ...cut, cut: undefined }, after)).toBe(true);
  });
  it('the flat board draws one town pin, Beit Sahwan, and no line saying the war is over', () => {
    const countries = parseCountries(countriesJson);
    const pins = (w: ReturnType<typeof parseWorld>, ledger: LedgerData): string[] =>
      [...worldMap({ base: '/', world: w, countries, ledger, href: (id) => `/mission/${id}` }).querySelectorAll<HTMLElement>('.rl-world__town')].map((el) => el.dataset.town ?? '');
    expect(pins(cut, {})).toEqual(['beit_sahwan']);
    expect(pins(full, {}).length).toBeGreaterThan(5);
    const board = worldMap({ base: '/', world: cut, countries, ledger: done(...TOWN), href: (id) => `/mission/${id}` });
    expect(board.querySelector('.rl-world__say')).toBeNull();
    const fresh = worldMap({ base: '/', world: cut, countries, ledger: {}, href: (id) => `/mission/${id}` });
    const links = [...fresh.querySelectorAll<HTMLAnchorElement>('a[href^="/mission/"]')].map((a) => a.getAttribute('href'));
    expect(links.length).toBeGreaterThan(0);
    for (const h of links) expect(TOWN.map((id) => `/mission/${id}`)).toContain(h);
  });
});

describe('free play on the menu', () => {
  const world = { name: 'The Sahar Basin' } as unknown as ReturnType<typeof parseWorld>;
  const tutorial = { id: 'beit_sahwan_0_tutorial', name: 'Tutorial', done: true };
  const freePlayLinks = (): number => {
    const stage = document.createElement('div');
    showMenu(stage, { base: '/', version: '0.0.0', world, tutorial });
    return [...stage.querySelectorAll('a')].filter((a) => a.getAttribute('href') === '/free-play').length;
  };
  it('is offered with no cut', () => expect(freePlayLinks()).toBe(1));
  it('is not offered in the demo', () => {
    vi.stubGlobal('__DEMO_MISSIONS__', LEAD);
    expect(freePlayLinks()).toBe(0);
  });
});

describe('a saved mission', () => {
  const record = (missionId: string): string => {
    const campaign = { ledger: {} };
    return JSON.stringify({
      version: MISSION_SAVE_VERSION,
      simEpoch: SIM_EPOCH,
      snapshotFormat: SNAPSHOT_FORMAT,
      build: 'test',
      missionId,
      seed: 1,
      savedAt: 0,
      simTick: 0,
      contentDigest: 0,
      campaignDigest: digestOf(campaign),
      shellDigest: digestOf(null),
      rawBytes: 1,
      snapshot: 'x',
      campaign,
      shell: null,
      hashAtSave: { sim: 0, runtime: 0 },
    });
  };
  it('of any shipped mission passes the shipped-mission check with no cut', () => {
    expect(parseSuspended(record('qasr_liwan_1_recon')).ok).toBe(true);
    expect(parseSuspended(record('beit_sahwan_1_recon')).ok).toBe(true);
  });
  it('of a mission outside the cut is refused as one this build does not ship; one inside still loads', () => {
    vi.stubGlobal('__DEMO_MISSIONS__', LEAD);
    expect(parseSuspended(record('qasr_liwan_1_recon'))).toEqual({ ok: false, reason: 'mission_unknown' });
    expect(parseSuspended(record('khan_rafid_1_recon'))).toEqual({ ok: false, reason: 'mission_unknown' });
    expect(parseSuspended(record('beit_sahwan_breach')).ok).toBe(true);
    expect(parseSuspended(record('beit_sahwan_2_foothold')).ok).toBe(true);
  });
});

describe('the routes', () => {
  function makeRouter(start: string, cut: DemoCut) {
    document.body.replaceChildren();
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    const log: string[] = [];
    const mountOf =
      (name: string) =>
      (host: HTMLElement, req: RouteRequest): Disposer => {
        log.push(`${name}${req.params.id !== undefined ? `:${req.params.id}` : ''}${req.params.map !== undefined ? `:${req.params.map}` : ''}`);
        const el = document.createElement('section');
        host.appendChild(el);
        return () => el.remove();
      };
    window.history.replaceState(null, '', start);
    // The names and patterns main.ts registers (pinned against main.ts below).
    // eslint-disable-next-line prefer-const -- read by the closures below, assigned once
    let router: Router;
    const defs: RouteDef[] = [
      { name: 'menu', pattern: '/', mount: mountOf('menu') },
      { name: 'campaign', pattern: '/campaign', mount: mountOf('campaign') },
      { name: 'brigade', pattern: '/brigade', mount: mountOf('brigade') },
      { name: 'saves', pattern: '/saves', mount: mountOf('saves') },
      { name: 'free-play', pattern: '/free-play', mount: mountOf('free-play') },
      { name: 'sandbox', pattern: '/free-play/:map', mount: mountOf('sandbox') },
      { name: 'mission', pattern: '/mission/:id', mount: mountOf('mission') },
      {
        name: 'briefing',
        pattern: '/briefing/:id',
        mount: (_h, req) => {
          void router.navigate(`/mission/${encodeURIComponent(req.params.id)}`, { replace: true });
          return () => {};
        },
      },
    ];
    router = new Router({
      base: '/',
      stage,
      transitionMs: 0,
      routes: gateDemoRoutes(defs, (href) => void router.navigate(href, { replace: true }), cut),
      notFound: mountOf('404'),
    });
    return { router, log };
  }
  /** Start at `url`, let every soft leave settle, and say where the player is and what mounted. */
  async function land(url: string, cut: DemoCut): Promise<{ at: string; log: string[] }> {
    const { router, log } = makeRouter(url, cut);
    await router.start();
    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
      await router.idle();
    }
    router.dispose();
    return { at: `${window.location.pathname}${window.location.search}`, log };
  }

  it.each([
    ['/mission/beit_sahwan_1_recon', '/mission/beit_sahwan_1_recon', ['mission:beit_sahwan_1_recon']],
    ['/mission/beit_sahwan_0_tutorial?tutorial=1', '/mission/beit_sahwan_0_tutorial?tutorial=1', ['mission:beit_sahwan_0_tutorial']],
    ['/mission/qasr_liwan_1_recon', '/campaign', ['campaign']],
    ['/mission/beit_sahwan_breach', '/mission/beit_sahwan_breach', ['mission:beit_sahwan_breach']],
    ['/mission/khan_rafid_1_recon', '/campaign', ['campaign']],
    ['/mission/qasr_liwan_1_recon?resume=1', '/campaign', ['campaign']],
    ['/?mission=qasr_liwan_1_recon', '/campaign', ['campaign']],
    ['/?mission=beit_sahwan_3_clearance', '/mission/beit_sahwan_3_clearance', ['mission:beit_sahwan_3_clearance']],
    ['/?campaign', '/campaign', ['campaign']],
    ['/briefing/tel_marum_1_recon', '/campaign', ['campaign']],
    ['/briefing/beit_sahwan_2_foothold', '/mission/beit_sahwan_2_foothold', ['mission:beit_sahwan_2_foothold']],
    ['/free-play', '/', ['menu']],
    ['/free-play/tel_marum', '/', ['menu']],
    ['/free-play/beit_sahwan_outskirts', '/', ['menu']],
    ['/?sandbox=tel_marum&tunnel', '/', ['menu']],
    ['/?sandboxes', '/', ['menu']],
    // A versus room boots through the sandbox route; hiding versus on desktop is not approved by the lead (20 Nov, ruling 3), so its URL is left alone.
    ['/free-play/tel_marum?net=ABCD', '/free-play/tel_marum?net=ABCD', ['sandbox:tel_marum']],
    ['/brigade', '/brigade', ['brigade']],
    ['/saves', '/saves', ['saves']],
  ])('in the demo, %s ends on %s', async (url, at, log) => {
    expect(await land(url, LEAD)).toEqual({ at, log });
  });

  it('with no cut every shipped mission mounts, by path, by briefing and by the old query', async () => {
    for (const id of ALL_MISSIONS) {
      expect(await land(`/mission/${id}`, null)).toEqual({ at: `/mission/${id}`, log: [`mission:${id}`] });
    }
    expect(await land('/briefing/qasr_liwan_1_recon', null)).toEqual({ at: '/mission/qasr_liwan_1_recon', log: ['mission:qasr_liwan_1_recon'] });
    expect(await land('/?mission=qasr_liwan_1_recon', null)).toEqual({ at: '/mission/qasr_liwan_1_recon', log: ['mission:qasr_liwan_1_recon'] });
  });
  it('with no cut Free play and every sandbox mount', async () => {
    expect(await land('/free-play', null)).toEqual({ at: '/free-play', log: ['free-play'] });
    expect(await land('/free-play/tel_marum', null)).toEqual({ at: '/free-play/tel_marum', log: ['sandbox:tel_marum'] });
    expect(await land('/?sandbox=tel_marum', null)).toEqual({ at: '/free-play/tel_marum', log: ['sandbox:tel_marum'] });
  });
  it('with no cut the routes are the same objects, and the build default is no cut', () => {
    const defs: RouteDef[] = [{ name: 'mission', pattern: '/mission/:id', mount: () => () => {} }];
    expect(gateDemoRoutes(defs, () => {}, null)[0]).toBe(defs[0]);
    expect(gateDemoRoutes(defs, () => {})[0]).toBe(defs[0]);
  });
  it('the leave target, by name', () => {
    const req = (name: string, params: Record<string, string> = {}, query = '') => ({ name, params, query: new URLSearchParams(query) });
    expect(demoLeaveFor(req('mission', { id: 'beit_sahwan_4_subterranean' }), LEAD)).toBeNull();
    expect(demoLeaveFor(req('mission', { id: 'qasr_liwan_1_recon' }), LEAD)).toBe('/campaign');
    // The briefing case on its own: the route test above reaches `/campaign` through the briefing's redirect into the
    // mission gate even without it, so only this line pins it.
    expect(demoLeaveFor(req('briefing', { id: 'qasr_liwan_1_recon' }), LEAD)).toBe('/campaign');
    expect(demoLeaveFor(req('briefing', { id: 'beit_sahwan_2_foothold' }), LEAD)).toBeNull();
    expect(demoLeaveFor(req('free-play'), LEAD)).toBe('/');
    expect(demoLeaveFor(req('sandbox', { map: 'tel_marum' }), LEAD)).toBe('/');
    expect(demoLeaveFor(req('menu'), LEAD)).toBeNull();
    expect(demoLeaveFor(req('mission', { id: 'qasr_liwan_1_recon' }), null)).toBeNull();
    expect(demoLeaveFor(req('free-play'), null)).toBeNull();
  });
});

describe('the wiring (pinned as text)', () => {
  const src = (rel: string): string => readFileSync(path.join(HERE, rel), 'utf8');
  const main = src('../main.ts');
  it('main.ts gates every route through gateDemoRoutes, and registers the names the gate keys on', () => {
    expect(main).toContain('routes: gateDemoRoutes([');
    expect(main).toContain('], (href) => void router.navigate(href, { replace: true })),');
    expect(main.match(/gateDemoRoutes\(/g)).toHaveLength(1);
    expect(main).toMatch(/name: 'mission',[\s\S]{0,200}pattern: '\/mission\/:id'/);
    expect(main).toMatch(/name: 'briefing',\s*pattern: '\/briefing\/:id'/);
    expect(main).toContain("{ name: 'free-play', pattern: '/free-play',");
    expect(main).toMatch(/name: 'sandbox',[\s\S]{0,300}pattern: '\/free-play\/:map'/);
  });
  it('main.ts and challenge.ts play the cut world, and nothing in the app reads the shipped world around it', () => {
    expect(main).toContain('const world = campaignWorldJson();');
    expect(src('../challenge.ts')).toContain('parseWorld(campaignWorldJson())');
    const appSrc = path.join(HERE, '..');
    const files = readdirSync(appSrc, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.fixture.ts'));
    const readers = files.filter((f) => /import \{[^}]*\bworld\b[^}]*\} from '@lions\/data'/.test(readFileSync(path.join(appSrc, f), 'utf8')));
    // stores-adds-view.ts reads only the mission ids, for a count in the Stores' "where you can use it" lines (no link, no route).
    expect(readers.sort()).toEqual(['shell/demo-cut.ts', 'ui/stores-adds-view.ts']);
    const constant = files.filter((f) => readFileSync(path.join(appSrc, f), 'utf8').includes('__DEMO_MISSIONS__'));
    expect(constant.filter((f) => f !== 'vite-env.d.ts')).toEqual(['shell/demo-cut.ts']);
  });
  it('demo-cut.ts stays headless-safe: it imports only @lions/data and reads nothing Vite-only but the guarded constant', () => {
    // The playtest and backtest harnesses load it under plain Node/tsx (through challenge.ts and mission-save.ts), where
    // `import.meta.env` is undefined and `shell/links.ts` throws at load. The route gate, which needs links, is demo-routes.ts.
    // Comments removed, so a comment can neither satisfy nor trip the pin.
    const pure = src('demo-cut.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // Every import, a bare side-effect one included.
    expect([...pure.matchAll(/^\s*import\b[^']*'([^']+)'/gm)].map((m) => m[1])).toEqual(['@lions/data']);
    expect(pure).not.toMatch(/\bimport\s*\(/);
    expect(pure).not.toMatch(/import\.meta/);
    expect(pure).toContain("typeof __DEMO_MISSIONS__ === 'undefined' ? null : __DEMO_MISSIONS__");
    expect(pure.match(/__DEMO_MISSIONS__/g)).toHaveLength(2);
    expect(pure).not.toMatch(/\broutes\.|from '\.\/links'|from '\.\/router'/);
  });
  it('the menu asks freePlayOpen, and the save check asks missionInDemo', () => {
    expect(src('../ui/menu.ts')).toContain("if (freePlayOpen()) addAside(t('menu.aside.freePlay'), routes.freePlay());");
    expect(src('../mission-save.ts')).toContain('Object.hasOwn(missionManifest, id) && missionInDemo(id)');
  });
});
