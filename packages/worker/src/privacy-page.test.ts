/** GH-1075 A1 task 1.10: the privacy page for what accounts store. */
import { describe, expect, it } from 'vitest';
import worker from './index';
import { PRIVACY_CONTACT, PRIVACY_MIN_AGE, handlePrivacy, privacyValues, renderPrivacy } from './privacy-page';
import type { Env } from './d1';

const GET = (): Request => new Request('https://game.example.workers.dev/privacy');
const fixtureValues = { contact: 'fixture-contact', minAge: 15 };

describe('the privacy page', () => {
  it('the page names what A1 stores', () => {
    const html = renderPrivacy(fixtureValues);
    for (const m of ['SteamID64', 'SteamID', 'display name', 'Player ID', 'session', 'last signed in', 'sign-in challenge', 'keyed hash', 'Cloudflare', '36 months', '90 days', 'Download my data', 'Delete my account', 'anonymous', '?notrack', '15', 'fixture-contact']) {
      expect(html, m).toContain(m);
    }
  });

  it('A2-32 names_the_a2_data: the coin journal, the save slots, the device id and 30 days', () => {
    const html = renderPrivacy(fixtureValues);
    for (const m of ['coin journal', 'save slots', 'device id', '30 days']) expect(html, m).toContain(m);
    // '30 days' is also the session rule below, so the request-log item is pinned by its own words.
    expect(html).toContain('For 30 days, a log of recent requests');
    expect(html).not.toContain('An empty coin wallet');
  });

  it('the guest sentence does not deny the anonymous data the page goes on to list (A1 follow-up 5)', () => {
    const html = renderPrivacy(fixtureValues);
    expect(html).not.toContain('stores nothing about you');
    expect(html).toContain('no personal details');
  });

  it('it never promises what is not true', () => {
    const html = renderPrivacy(fixtureValues);
    expect(html).not.toContain('email address we store');
    const never = html.split('What is never stored')[1]?.split('</ul>')[0] ?? '';
    expect(never).toContain('IP address');
  });

  it('escapes the contact', () => {
    expect(renderPrivacy({ contact: '<b>x</b>', minAge: 16 })).not.toContain('<b>x</b>');
  });

  it('the page runs no script (A4-2, brought forward)', async () => {
    const res = handlePrivacy(GET(), fixtureValues);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("script-src 'none'");
    const body = await res.text();
    expect(body).not.toMatch(/<script/i);
    expect(body).not.toMatch(/ on[a-z]+=/i);
    expect(handlePrivacy(new Request(GET(), { method: 'POST' }), fixtureValues).status).toBe(405);
  });

  it('fails closed without the lead\'s values', async () => {
    const res = handlePrivacy(GET(), null);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('privacy page not ready');
    expect(privacyValues('x@y', null)).toBeNull();
    expect(privacyValues('', 16)).toBeNull();
    expect(privacyValues('TBD', 16)).toBeNull();
    expect(privacyValues('me@example.com', 16)).toBeNull();
    expect(privacyValues('TODO', 16)).toBeNull();
    expect(privacyValues('a@b', 12)).toBeNull();
    expect(privacyValues('a@b', 19)).toBeNull();
    expect(privacyValues('a@b', 16.5)).toBeNull();
    expect(privacyValues('a@b', 16)).not.toBeNull();
  });

  it('is routed by the worker, with no D1 touch', async () => {
    const env = { DB: new Proxy({}, { get: () => { throw new Error('touched DB'); } }), ASSETS: { fetch: async () => new Response('asset') } } as unknown as Env;
    // The real constants are null at merge time, so the routed answer is the closed one; the point is it is not the asset.
    const res = await worker.fetch(GET(), env);
    expect(await res.text()).not.toBe('asset');
  });

  // EXPECTED-FAIL while either constant is null (the lead supplies BOTH the contact and the minimum age).
  // WHEN THE LEAD FILLS BOTH CONSTANTS this goes red ("expected to fail"): change `it.fails` to `it` in the same
  // commit. A contact alone leaves it failing, as it should.
  it.fails('the lead\'s values are filled', () => {
    expect(privacyValues(PRIVACY_CONTACT, PRIVACY_MIN_AGE)).not.toBeNull();
  });
});
