/**
 * GET /privacy (GH-1075 A1, task 1.10): what an account stores, in plain English. No D1, no cookie, no script.
 *
 * FAIL CLOSED. The contact and the minimum age are the lead's to supply. Both ship `null`, and `privacyValues` returns
 * null until both are real, so a build without them answers 503 and serves no page. No placeholder is ever committed:
 * nothing can pass for the lead's decision.
 */
import { PAGE_CSP } from './security-headers';

/** The lead's contact for privacy requests. `null` until the lead supplies it. */
export const PRIVACY_CONTACT: string | null =
  'open an issue titled "Privacy" at https://github.com/ilan-pinto/roaring-lions/issues';
/** The lead's minimum age (an integer 13 to 18). `null` until the lead decides it. */
export const PRIVACY_MIN_AGE: number | null = 16;
/** The date this text last changed. Set at merge. */
export const PRIVACY_UPDATED = '2026-11-14';

/** PAGE_CSP with its inline-script allowance removed: this page has no script, so it may run none. */
export const PRIVACY_PAGE_CSP = PAGE_CSP.replace("script-src 'unsafe-inline'", "script-src 'none'");

export interface PrivacyValues { contact: string; minAge: number }

/** The values, or null unless BOTH are real: a non-empty contact that is no placeholder, and an integer age 13 to 18. */
export function privacyValues(contact: string | null, minAge: number | null): PrivacyValues | null {
  if (contact === null || contact.trim() === '' || /TBD|TODO|<lead>|example/i.test(contact)) return null;
  if (minAge === null || !Number.isInteger(minAge) || minAge < 13 || minAge > 18) return null;
  return { contact: contact.trim(), minAge };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderPrivacy(v: PrivacyValues): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How your data is kept - Roaring Lions</title>
<style>
:root { color-scheme: light dark; }
body { font: 16px/1.55 system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.6rem; }
h2 { font-size: 1.15rem; margin-top: 2rem; }
</style>
</head>
<body>
<main>
<h1>How your data is kept</h1>
<p>Playing as a guest creates no account and stores no personal details on our server, unless you choose to send feedback with contact details. Anonymous play statistics and rate limiting are described below. This page is mainly about what happens if you choose to sign in, with Google or with Steam.</p>

<h2>What is stored for a signed-in player</h2>
<ul>
<li>If you sign in with Google: Google's account number for you (its "sub"), and nothing else from Google. We do not ask Google for your email, name or picture.</li>
<li>If you link Steam: your SteamID64, which links to your public Steam profile.</li>
<li>The display name you choose, and a random Player ID shown beside it.</li>
<li>The day the account was created and the day you last signed in (the 36-month rule below uses it).</li>
<li>A hash of each sign-in session, with the day it was made and the day it was last used.</li>
<li>For a few minutes while you sign in, a hash of the sign-in challenge. It is swept away after five minutes.</li>
<li>Roar coins: the balance, what was earned and how (the coin journal), the coin purchases and the coupons used.</li>
<li>The campaign, the brigade (credits, purchases, upgrades) and the save slots, with the names you give them.</li>
<li>For each device you moved progress from, a random device id, the day, and what was moved.</li>
<li>For 30 days, a log of recent requests that makes retries safe, including when each mission was started.</li>
<li>Versus matches you play while signed in: the map, the sides, the result, when it was played, and whether your opponent was a member, a guest or a bot (with the model the bot's operator declared). A guest opponent's name is never stored. Kept while either player keeps an account.</li>
</ul>

<h2>What is never stored</h2>
<ul>
<li>Email, phone number and real name.</li>
<li>IP address and user agent.</li>
<li>Location.</li>
<li>Your Google email address, name and profile picture, and any Google sign-in token.</li>
<li>Your Steam persona name, avatar and friends list.</li>
<li>The session cookie itself (only a hash of it).</li>
</ul>

<h2>Signing in with Google</h2>
<ul>
<li>Google handles the sign-in under its own privacy policy, and learns that you signed in to Roaring Lions.</li>
<li>We ask Google for the "openid" scope only. That is why it sends us an account number and nothing about who you are.</li>
<li>You can remove Roaring Lions from your Google account's third-party access page at any time.</li>
<li>We hold no Google token, so there is nothing for us to revoke.</li>
</ul>

<h2>Signing in with Steam</h2>
<p>Sign-in through Steam is paused for now. If you already linked a Steam account, what is kept about it is listed above.</p>

<h2>What rate limiting keeps</h2>
<p>A daily keyed hash of the connecting address, which cannot be turned back into the address. It is deleted after two days.</p>

<h2>What Cloudflare keeps</h2>
<p>The game runs on Cloudflare. Its request logs record the address of each request. Google's return carries a one-time code and no identifier about you. A Steam return, when Steam sign-in is on, carries your SteamID. Cloudflare keeps the logs for its own log retention period.</p>

<h2>Why</h2>
<p>The lawful basis is providing the service you asked for: keeping your progress on our server.</p>

<h2>For how long</h2>
<ul>
<li>The account, with everything listed above, stays while you use it, and is deleted after 36 months with no sign-in.</li>
<li>Sessions end 30 days after their last use, and 180 days at most.</li>
<li>After a deletion, a hash of the Player ID is kept for 90 days, so your other devices learn the account is gone.</li>
</ul>

<h2>Your copy and your deletion</h2>
<p>Use "Download my data" and "Delete my account" on the profile screen. Both work at any time. Deletion cannot be undone.</p>

<h2>Play statistics</h2>
<p>Play statistics stay anonymous and are never linked to an account. Opt out with ?notrack, Global Privacy Control or Do Not Track.</p>

<h2>Contact and minimum age</h2>
<p>Questions or requests about your data: ${esc(v.contact)}</p>
<p>The minimum age to sign in is ${v.minAge}.</p>

<p><small>Last updated ${esc(PRIVACY_UPDATED)}.</small></p>
</main>
</body>
</html>
`;
}

export function handlePrivacy(req: Request, values: PrivacyValues | null = privacyValues(PRIVACY_CONTACT, PRIVACY_MIN_AGE)): Response {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } });
  if (values === null) return new Response('privacy page not ready', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  return new Response(req.method === 'HEAD' ? null : renderPrivacy(values), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PRIVACY_PAGE_CSP, 'cache-control': 'public, max-age=300' },
  });
}
