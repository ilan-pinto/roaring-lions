// `pnpm video` against a fake fetch, in a temp directory: the whole command,
// not its parts. The property that matters most is a count -- how many times
// the network was touched -- under every combination of key and --spend.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT, run, type CliDeps, type FetchLike } from './cli';
import { appendLedgerEntry, readLedger, type LedgerEntry } from './ledger';
import { CONTENT_RULES_SUFFIX } from './request';

let dir: string;
let logs: string[];
let errs: string[];

const SHOTS = {
  shots: [
    {
      id: 'veo_loop',
      group: 'tel_marum',
      title: 'Veo loop',
      still: 'still.jpg',
      loop: true,
      prompt: 'Slow drift over a ridge at dusk.',
      ships_as: 'video/x.mp4',
      explore: { model: 'veo-3.1-fast', resolution: '720p', seconds: 8, takes: 3 },
      final: { model: 'veo-3.1', resolution: '720p', seconds: 8, takes: 1 },
    },
    {
      id: 'omni_one',
      group: 'intro',
      title: 'Omni',
      still: 'still.jpg',
      loop: false,
      prompt: 'Dawn haze over a valley.',
      ships_as: 'video/intro.mp4',
      explore: { model: 'omni-flash', resolution: '720p', seconds: 8, takes: 2 },
      final: { model: 'veo-3.1', resolution: '1080p', seconds: 8, takes: 1 },
    },
  ],
};

function deps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    fetch: vi.fn<FetchLike>(() => Promise.reject(new Error('the network was touched'))),
    config: { apiKey: undefined, apiKeySource: 'none', keyFile: '/nonexistent/gemini.env' },
    repoRoot: dir,
    shotsPath: path.join(dir, 'shots.json'),
    ledgerPath: path.join(dir, 'art', 'video', 'ledger.jsonl'),
    takesDir: path.join(dir, 'takes'),
    log: (l) => logs.push(l),
    err: (l) => errs.push(l),
    sleep: () => Promise.resolve(),
    now: () => new Date('2026-10-12T09:00:00.000Z'),
    ...overrides,
  };
}

const KEY = { apiKey: 'fake-key-not-real', apiKeySource: 'env' as const, keyFile: '/nonexistent/gemini.env' };

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'video-cli-'));
  writeFileSync(path.join(dir, 'shots.json'), JSON.stringify(SHOTS));
  writeFileSync(path.join(dir, 'still.jpg'), Buffer.alloc(4096, 7));
  logs = [];
  errs = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('generate: no network without BOTH the key and --spend', () => {
  it('dry run with no key: prints the request and its price, sends nothing', async () => {
    const d = deps();
    expect(await run(['generate', '--shot', 'veo_loop', '--stage', 'explore'], d)).toBe(EXIT.ok);
    expect(d.fetch).not.toHaveBeenCalled();
    const out = logs.join('\n');
    expect(out).toContain('veo-3.1-fast-generate-preview:predictLongRunning');
    expect(out).toContain('$0.80 a take');
    expect(out).toContain('"lastFrame"'); // a loop pins both ends
    expect(out).toContain('<base64 of 4096 bytes');
    expect(out).not.toContain('BwcHBwcH'); // the raw base64 of the still is never printed
    expect(out).toContain('dry run: nothing was sent');
    expect(readLedger(d.ledgerPath)).toEqual([]);
  });

  it('dry run WITH a key: still sends nothing, and never prints the key', async () => {
    const d = deps({ config: KEY });
    expect(await run(['generate', '--shot', 'omni_one', '--stage', 'explore'], d)).toBe(EXIT.ok);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(logs.join('\n')).not.toContain('fake-key-not-real');
    expect(logs.join('\n')).toContain('/v1beta/interactions');
  });

  it('--spend with no key: refuses, exit 2, sends nothing, writes no ledger line', async () => {
    const d = deps();
    expect(await run(['generate', '--shot', 'veo_loop', '--stage', 'explore', '--spend'], d)).toBe(EXIT.noKey);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(readLedger(d.ledgerPath)).toEqual([]);
  });

  it('--spend with a key but a ledger near the cap: refuses, exit 3, sends nothing', async () => {
    const d = deps({ config: KEY });
    const prior: LedgerEntry = {
      at: '2026-10-12T08:00:00.000Z', shot: 'x', stage: 'explore', model: 'veo-3.1', model_id: 'veo-3.1-generate-preview',
      resolution: '720p', seconds_billed: 8, usd_estimated: 149.5, id: 'op-1', status: 'succeeded',
    };
    appendLedgerEntry(d.ledgerPath, prior);
    expect(await run(['generate', '--shot', 'veo_loop', '--stage', 'explore', '--spend'], d)).toBe(EXIT.budget);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(readLedger(d.ledgerPath)).toHaveLength(1);
    expect(errs.join('\n')).toMatch(/^refused: .*cap.*Nothing was sent\.$/m); // the up-front check, not the per-take one
  });

  it('re-checks the cap before EVERY take: a spend landing mid-batch stops the next take', async () => {
    const ledgerPath = path.join(dir, 'art', 'video', 'ledger.jsonl');
    const fetch = vi.fn<FetchLike>(async (url) => {
      const u = String(url);
      if (u.endsWith(':predictLongRunning')) {
        // Another process spends $149 while take 1 is in flight.
        appendLedgerEntry(ledgerPath, {
          at: '2026-10-12T09:00:01.000Z', shot: 'other', stage: 'final', model: 'veo-3.1', model_id: 'veo-3.1-generate-preview',
          resolution: '720p', seconds_billed: 8, usd_estimated: 149, id: 'op-other', status: 'submitted',
        });
        return json({ name: 'models/m/operations/one' });
      }
      if (u.endsWith('/operations/one')) {
        return json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/one:download?alt=media' } }] } } });
      }
      return new Response(Buffer.from('MP4'), { status: 200 });
    });
    const d = deps({ config: KEY, fetch });
    expect(await run(['generate', '--shot', 'veo_loop', '--stage', 'explore', '--takes', '3', '--spend'], d)).toBe(EXIT.budget);
    expect(fetch).toHaveBeenCalledTimes(3); // take 1's submit, poll and download; take 2 never sent
    expect(errs.join('\n')).toMatch(/take 2: refused/);
  });

  it('refuses more takes than the storyboard plans, before anything is priced or sent', async () => {
    const d = deps({ config: KEY });
    expect(await run(['generate', '--shot', 'veo_loop', '--stage', 'final', '--takes', '2', '--spend'], d)).toBe(EXIT.usage);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('--spend with a key and room under the cap: sends, polls, downloads, and logs the spend first', async () => {
    let ledgerAtSubmit: LedgerEntry[] = [];
    const fetch = vi.fn<FetchLike>(async (url, init) => {
      const u = String(url);
      expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('fake-key-not-real');
      if (u.endsWith(':predictLongRunning')) {
        ledgerAtSubmit = readLedger(path.join(dir, 'art', 'video', 'ledger.jsonl'));
        const body = JSON.parse(String(init?.body));
        expect(body.instances[0].prompt).toContain(CONTENT_RULES_SUFFIX.trim());
        expect(body.instances[0].lastFrame).toEqual(body.instances[0].image);
        expect(body.parameters).toMatchObject({ resolution: '720p', durationSeconds: 8, aspectRatio: '16:9' });
        return json({ name: 'models/veo-3.1-fast-generate-preview/operations/abc' });
      }
      if (u.endsWith('/operations/abc')) {
        return json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/v1:download?alt=media' } }] } } });
      }
      if (u.includes('files/v1:download')) return new Response(Buffer.from('MP4BYTES'), { status: 200 });
      throw new Error(`unexpected ${u}`);
    });
    const d = deps({ config: KEY, fetch });
    expect(await run(['generate', '--shot', 'veo_loop', '--stage', 'explore', '--spend'], d)).toBe(EXIT.ok);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(ledgerAtSubmit).toHaveLength(1); // on record BEFORE the POST went out
    expect(ledgerAtSubmit[0].status).toBe('submitted');
    const after = readLedger(d.ledgerPath);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ status: 'succeeded', id: 'models/veo-3.1-fast-generate-preview/operations/abc', usd_estimated: 0.8 });
    expect(after[0].output).toMatch(/^takes\/veo_loop\/explore-.*\.mp4$/);
  });

  it('a failed request is recorded as failed and still counts against the cap', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response('{"error":"bad"}', { status: 400 }));
    const d = deps({ config: KEY, fetch });
    expect(await run(['generate', '--shot', 'omni_one', '--stage', 'explore', '--spend'], d)).toBe(EXIT.api);
    expect(fetch).toHaveBeenCalledTimes(1);
    const after = readLedger(d.ledgerPath);
    expect(after[0].status).toBe('failed');
    expect(after[0].usd_estimated).toBeGreaterThan(1);
  });
});

describe('status and ledger', () => {
  it('status without a key sends nothing', async () => {
    const d = deps();
    expect(await run(['status', 'models/x/operations/y'], d)).toBe(EXIT.noKey);
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it('ledger and estimate never touch the network, key or not', async () => {
    const d = deps({ config: KEY });
    expect(await run(['ledger'], d)).toBe(EXIT.ok);
    expect(await run(['estimate'], d)).toBe(EXIT.ok);
    expect(d.fetch).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('$150.00 left');
  });
});

describe('estimate', () => {
  it('totals the storyboard and says it fits', async () => {
    const d = deps();
    expect(await run(['estimate', '--json'], d)).toBe(EXIT.ok);
    const out = JSON.parse(logs[0]) as { totalUsd: number; fits: boolean };
    // veo_loop: 3 x 0.80 + 1 x 3.20; omni_one: 2 x Omni(2 images? no: 1) + 1 x 3.20
    const omniTake = 1.0136 + ((1600 + Math.ceil(('Dawn haze over a valley.' + CONTENT_RULES_SUFFIX).length / 4)) * 1.5) / 1e6;
    expect(out.totalUsd).toBeCloseTo(2.4 + 3.2 + 2 * omniTake + 3.2, 6);
    expect(out.fits).toBe(true);
  });

  it('exits 1 and says DOES NOT FIT when the plan passes the cap', async () => {
    const big = { shots: [{ ...SHOTS.shots[0], final: { model: 'veo-3.1', resolution: '4k', seconds: 8, takes: 10 } }] };
    for (let i = 0; i < 4; i++) big.shots.push({ ...big.shots[0], id: `veo_loop_${i}` });
    writeFileSync(path.join(dir, 'shots.json'), JSON.stringify(big));
    const d = deps();
    expect(await run(['estimate'], d)).toBe(EXIT.usage);
    expect(logs.join('\n')).toContain('DOES NOT FIT');
  });

  it('refuses a storyboard with a bad shot, by name', async () => {
    mkdirSync(path.join(dir, 'b'));
    const bad = { shots: [{ ...SHOTS.shots[0], explore: { model: 'omni-flash', resolution: '4k', seconds: 8, takes: 1 } }] };
    writeFileSync(path.join(dir, 'shots.json'), JSON.stringify(bad));
    const d = deps();
    expect(await run(['estimate'], d)).toBe(EXIT.usage);
    expect(errs.join('\n')).toMatch(/veo_loop: explore: omni-flash 4k/);
  });
});
