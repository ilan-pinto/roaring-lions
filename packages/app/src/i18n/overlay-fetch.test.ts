// GH-1406 part 4: a locale file that does not arrive is a warning that names the URL, never a silent fall back to English.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLocaleJson, resetOverlayWarnings } from './overlay-fetch';

const URL_FR = '/game/locales/fr/missions.json';
const ok = (body: unknown, status = 200): typeof fetch => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as typeof fetch;

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetOverlayWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('fetchLocaleJson', () => {
  it('returns the parsed file and says nothing', async () => {
    expect(await fetchLocaleJson('fr', URL_FR, 'mission text', ok({ m1: { name: 'X' } }))).toEqual({ m1: { name: 'X' } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('never fetches and never warns for en or either pseudo-locale (they have no file)', async () => {
    const f = vi.fn();
    for (const lang of ['en', 'pseudo', 'pseudo-rtl']) expect(await fetchLocaleJson(lang, URL_FR, 'mission text', f as unknown as typeof fetch)).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('a 404 is null and a warn naming the URL and the status', async () => {
    expect(await fetchLocaleJson('fr', URL_FR, 'mission text', ok('', 404))).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain(URL_FR);
    expect(msg).toContain('404');
    expect(msg).toContain('mission text');
    expect(msg).toContain('playing in English');
  });

  it('a 200 whose body is not JSON (the single-page-app fallback page) is null and a warn that says so', async () => {
    expect(await fetchLocaleJson('fr', URL_FR, 'mission text', ok('<!doctype html><title>x</title>'))).toBeNull();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain(URL_FR);
    expect(msg).toContain('not JSON');
    expect(msg).toContain('single-page-app fallback');
  });

  it('a request that throws is null and a warn with the reason', async () => {
    const boom = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(await fetchLocaleJson('fr', URL_FR, 'unit text', boom)).toBeNull();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain(URL_FR);
    expect(msg).toContain('offline');
  });

  it('warns once per URL a session, and again for a different URL', async () => {
    for (let i = 0; i < 3; i++) await fetchLocaleJson('fr', URL_FR, 'mission text', ok('', 404));
    expect(warn).toHaveBeenCalledTimes(1);
    await fetchLocaleJson('fr', '/game/locales/fr/units.json', 'unit text', ok('', 404));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('is a warn and never an error (`pnpm ui:routes` fails on any console error)', async () => {
    await fetchLocaleJson('fr', URL_FR, 'mission text', ok('', 500));
    await fetchLocaleJson('fr', '/b', 'mission text', ok('nope'));
    await fetchLocaleJson('fr', '/c', 'mission text', (async () => { throw new Error('x'); }) as typeof fetch);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(error).not.toHaveBeenCalled();
  });
});
