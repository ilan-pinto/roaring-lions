/**
 * GH-954 P3: the public arena results page. G9 (public, cacheable, no D1, no cookie), G10 (routing: wrangler and the
 * service worker), G11 (kill switch), G12 (escaping), plus the honest empty state.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import worker from './index';
import { handleArenaResults } from './arena-results';
import { ARENA_RESULTS } from './arena-data';
import { PAGE_CSP, API_CSP } from './security-headers';
import { digestOf } from '../../../tools/validate_arena_results.mjs';
import type { ArenaResults } from '../../../tools/src/net/arena-publish';
import type { Env } from './d1';

const ORIGIN = 'https://game.example.workers.dev';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function fixture(label: string): ArenaResults {
  const model = { id: 'm1', label, scripted: false, modelId: null, games: 12, wins: 7, draws: 1, losses: 4, voids: 0, tooFew: false, score: 0.625, interval: [0.36, 0.84], bySeat: [0.6, 0.65], byFaction: { kdf: 0.6, sarim: 0.65 } };
  const section = {
    key: { pace: 1, roundWallMs: 5000, capTicks: 6000, mode: 'annihilation', promptDigest: 'a'.repeat(64) },
    builds: ['0.1.0+abc'], mixedBuilds: false, games: 12, voids: 0, models: [model], headToHead: [], byMap: [], byMatchup: [], endings: [], rubric: [], gameList: [],
  };
  const body = { version: 1 as const, generated: '2026-11-05', note: "These are results of this game's prompt, tools and build, not a general benchmark.", disclaimer: 'Model and vendor names only identify the software tested.', withheld: 0, sections: [section] };
  return { ...body, digest: digestOf(body) } as unknown as ArenaResults;
}

const ARENA_CSP_LITERAL =
  "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; " +
  "font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

/** A DB that fails the test on ANY touch. */
const throwingDb = new Proxy({}, { get: (_t, k) => { throw new Error(`the arena page touched env.DB.${String(k)}`); } });
const env = (extra: Record<string, unknown> = {}): Env =>
  ({ DB: throwingDb, ASSETS: { fetch: async () => new Response('asset') }, ...extra }) as unknown as Env;
const req = (path: string, init?: RequestInit): Request => new Request(`${ORIGIN}${path}`, init);

describe('G9: public, cacheable, no D1, no cookie', () => {
  const doc = fixture('Claude Opus 5.5 (Anthropic)');
  for (const path of ['/arena-results', '/arena-results.json']) {
    it(`${path}: 200 with no cookie, public cache, ETag = digest, no Set-Cookie`, async () => {
      const res = handleArenaResults(req(path), {}, doc);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=3600');
      expect(res.headers.get('etag')).toBe(`"${doc.digest}"`);
      expect(res.headers.get('set-cookie')).toBeNull();
    });
  }
  it('a matching If-None-Match is a 304 with the same ETag', () => {
    const res = handleArenaResults(req('/arena-results', { headers: { 'if-none-match': `"${doc.digest}"` } }), {}, doc);
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(`"${doc.digest}"`);
  });
  it('through the Worker: security headers, PAGE_CSP with no script, a throwing DB is never called', async () => {
    // The bundled data is null until P4, so drive the same handler the route calls with a document.
    const html = await worker.fetch(req('/arena-results'), env());
    expect(html.status).toBe(200);
    // PAGE_CSP, minus its inline-script allowance: nothing else differs.
    const csp = html.headers.get('content-security-policy') ?? '';
    expect(csp).toBe(ARENA_CSP_LITERAL);
    // ...and it is PAGE_CSP with only the script source changed.
    expect(csp.replace("script-src 'none'", "script-src 'unsafe-inline'")).toBe(PAGE_CSP);
    expect(html.headers.get('x-content-type-options')).toBe('nosniff');
    expect(html.headers.get('set-cookie')).toBeNull();
    const json = await worker.fetch(req('/arena-results.json'), env());
    expect(json.headers.get('content-security-policy')).toBe(API_CSP);
    expect(json.headers.get('set-cookie')).toBeNull();
  });
  it('a rendered page has no script element, no handler attribute, no link out', () => {
    const html = handleArenaResults(req('/arena-results'), {}, doc);
    return html.text().then((t) => {
      expect(t).not.toMatch(/<script|\son\w+=|href=|src=/i);
    });
  });
  it('If-None-Match: strong, weak, a list, and * all give 304; a different tag gives 200', () => {
    const d = `"${doc.digest}"`;
    for (const h of [d, `W/${d}`, `"other", ${d}`, `W/"other",W/${d}`, '*', ` ${d} `]) {
      expect(handleArenaResults(req('/arena-results', { headers: { 'if-none-match': h } }), {}, doc).status, h).toBe(304);
    }
    for (const h of ['"other"', `"${doc.digest}x"`, 'W/"other", "also"', '']) {
      expect(handleArenaResults(req('/arena-results', { headers: { 'if-none-match': h } }), {}, doc).status, h).toBe(200);
    }
  });
  it('POST is refused', () => {
    expect(handleArenaResults(req('/arena-results', { method: 'POST' }), {}, doc).status).toBe(405);
  });
});

describe('empty state: nothing published yet', () => {
  it('the page says so honestly, 200, no D1', async () => {
    const res = await worker.fetch(req('/arena-results'), env());
    // Holds while data/arena/results.json does not exist; the tripwire below covers the day it does.
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain('No results published yet.');
    expect(res.headers.get('etag')).toBe('"empty"');
  });
  it('the JSON has nothing to hand out: 404, not cached for long', () => {
    const res = handleArenaResults(req('/arena-results.json'), {}, null);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('tripwire: once data/arena/results.json exists, the Worker must bundle it (arena-data.ts)', () => {
    if (existsSync(ROOT + 'data/arena/results.json')) {
      expect(ARENA_RESULTS, 'P4: edit packages/worker/src/arena-data.ts to import the file. Then ALSO convert the two empty-state Worker tests above to the handleArenaResults(..., null) form (they assume the bundled data is null), and add a Worker-level test (worker.fetch) of a data-bearing page.').not.toBeNull();
    }
    else expect(ARENA_RESULTS).toBeNull();
  });
});

describe('G11: the kill switch', () => {
  const doc = fixture('Claude Opus 5.5 (Anthropic)');
  for (const path of ['/arena-results', '/arena-results.json']) {
    for (const v of ['1', 'true', 'yes']) {
      it(`${path} with ARENA_RESULTS_HIDDEN=${v}: 404, uncached`, () => {
        const res = handleArenaResults(req(path), { ARENA_RESULTS_HIDDEN: v }, doc);
        expect(res.status).toBe(404);
        expect(res.headers.get('cache-control')).toBe('no-store');
      });
    }
    it(`${path}: unset, empty, 0 and false leave it up`, () => {
      for (const v of [undefined, '', '0', 'false']) expect(handleArenaResults(req(path), { ARENA_RESULTS_HIDDEN: v }, doc).status).toBe(200);
    });
  }
  it('through the Worker, with the page not even empty', async () => {
    expect((await worker.fetch(req('/arena-results'), env({ ARENA_RESULTS_HIDDEN: '1' }))).status).toBe(404);
    expect((await worker.fetch(req('/arena-results.json'), env({ ARENA_RESULTS_HIDDEN: '1' }))).status).toBe(404);
  });
});

describe('G12: escaping', () => {
  const hostile = '<script>alert(1)</script>';
  const doc = fixture(hostile);
  it('a label <script> is escaped in the HTML', async () => {
    const t = await handleArenaResults(req('/arena-results'), {}, doc).text();
    expect(t).not.toContain('<script');
    expect(t).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('the JSON route is served as data, not markup', () => {
    const res = handleArenaResults(req('/arena-results.json'), {}, doc);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  });
});

describe('G10: routing', () => {
  const jsonc = readFileSync(ROOT + 'wrangler.jsonc', 'utf8');
  /** Strip // and block comments outside strings, then parse. */
  const strip = (s: string): string => s.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.startsWith('"') ? m : '')).replace(/,(\s*[}\]])/g, '$1');
  const cfg = JSON.parse(strip(jsonc)) as { assets: { run_worker_first: string[] } };
  const globToRe = (g: string): RegExp => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  it('wrangler run_worker_first sends both arena paths to the Worker', () => {
    for (const p of ['/arena-results', '/arena-results.json']) expect(cfg.assets.run_worker_first.some((g) => globToRe(g).test(p)), p).toBe(true);
  });
  it('and does not widen: an ordinary game path still goes to the assets', () => {
    expect(cfg.assets.run_worker_first.some((g) => globToRe(g).test('/mission/beit_sahwan_1_recon'))).toBe(false);
  });
});
