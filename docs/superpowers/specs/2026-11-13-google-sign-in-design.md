# Google sign-in first, Steam linked later (GH-1075): design

**Status:** design, 13 Nov 2026. Nothing here is built. No code until the lead approves it.
**Issue:** GH-1075. Lead decision of 13 Nov: Google sign-in first; Steam linked later through a relay
outside Cloudflare.
**Author:** Opus design agent, 13 Nov 2026.
**Touches when built:** `packages/worker/src/account/` (a Google route pair, an ID-token verifier, the
provider lists), one accounts migration (`0002_google.sql`), `packages/worker/src/privacy-page.ts`,
`packages/app/src/account/client.ts`, `packages/app/src/ui/profile.ts` and `en.json`. The sim is untouched.

Read with:

- `docs/superpowers/specs/2026-11-07-accounts-profiles-design.md` (the accounts spec: §1.3 linked
  providers, §1.7 sessions, §1.8 CSRF, §1.9 limits, §6 privacy). This spec changes only the provider
  layer. Everything it does not mention stays as that spec and the A0-A3 plans built it.
- `docs/superpowers/plans/2026-11-08-accounts-a0-a1.md` §0 (rulings 12, 13, 14, 15, 22 are reused here).
- `docs/agent-notes/shell-and-ui.md`, "Accounts A1" and "Accounts A2".

---

## 0. In one page

- **Why.** Steam's `check_authentication` POST answers HTTP 403 (about 250 ms) to the Worker from
  Cloudflare's egress, and 200 to the identical request from a home machine (PR 1326's log line). Steam's
  OpenID refuses associations, so the server round trip cannot be avoided. Every Steam sign-in in
  production has therefore failed at `verifyOpenId`. **The code after it has never run in production.**
- **What ships.** "Sign in with Google" and "Sign up with Google" on `/profile`: OpenID Connect,
  authorization-code flow with PKCE, done entirely in the Worker. The app never holds a client secret, a
  Google token or a Google identifier. The menu chip ("Sign in") does not change.
- **What is stored.** The Google `sub` (Google's permanent account number), and nothing else from Google.
  The scope is `openid` alone, so Google sends no email, name or picture, and "No email is asked for" stays
  literally true. No Google token is kept anywhere.
- **Identity.** A new provider value, `google`, in `member_identity`, at most one per member. A member can
  hold Google and Steam together. Linking goes both ways, and a taken identity is never merged.
- **Steam.** The Steam buttons are hidden while Steam is off. The routes, the `steam` provider and the
  `steam-link` purpose stay, so the relay can turn Steam back on with a flag and no migration.
- **The gates that the Steam work did not have.** Before any code: the lead creates the Google OAuth client
  (which proves Google accepts the `workers.dev` redirect URI), and runs a 5-minute egress probe on
  Cloudflare (§1.4). Before players see the button: one real sign-in by the lead in production (§7, G9).
- **Lead setup.** One Google Cloud OAuth client, two Worker secrets (`GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`), one migration, two flag rows. With no secret set, Google is off and nothing
  calls Google. That covers CI, tests and `pnpm dev`.

---

## 1. Provider and protocol

### 1.1 Decision P1: the protocol

**Recommended: OpenID Connect, authorization-code flow, with PKCE (S256), `state` and `nonce`, as a
confidential client. All of it runs in the Worker.**

- The Worker builds the authorization URL, receives the code on its own return route, redeems it at
  Google's token endpoint with the client secret and the PKCE verifier, and verifies the ID token. The
  browser only ever sees Google's consent page, then a 303 back to `/profile` with a session cookie.
- **Alternatives, rejected.**
  - *Google Identity Services (One Tap, the `gsi/client` script).* It loads a Google script into the page.
    That breaks "no CDN", widens the CSP and adds a third-party script to every profile view. It also hands
    the ID token to the page. Rejected.
  - *Implicit or hybrid flow (`response_type=id_token`).* The token rides in the URL fragment, and the page
    must forward it. Rejected: no token in the browser.
  - *A public client with PKCE only (no secret).* Google issues web clients with a secret, and the Worker
    can keep one. Nothing is gained by dropping it.

### 1.2 The routes

Two routes, shaped like the Steam pair, so `accountGuard`, the pre-cookie and the 303 return codes are
reused:

- **`POST google/start`** `{purpose: 'google-login' | 'google-link'}`. `google-link` needs a fresh session.
  It answers `{url}`, the Google authorization URL, and sets the pre cookie.
- **`GET google/return?state&code`** (or `?state&error`). It is a top-level navigation from Google, the
  second account GET that writes. It always answers 303 to `ACCOUNT_RETURN_PATH` with `&r=<code>&p=google`
  (plan ruling 12: never a bare error page).

**The authorization URL** is `https://accounts.google.com/o/oauth2/v2/auth` with exactly these
parameters, pinned by a test:

| Parameter | Value |
|---|---|
| `client_id` | `env.GOOGLE_CLIENT_ID` |
| `response_type` | `code` |
| `scope` | `openid` |
| `redirect_uri` | `<origin>/api/account/google/return`, with **no query**. Google matches the redirect URI exactly, so the challenge cannot ride in it as Steam's `?c=` does |
| `state` | `c`, the challenge: 32 random bytes, b64url, the same shape as Steam's |
| `code_challenge` | `b64url(sha256(pre))`, where `pre` is the pre cookie's value (§1.3) |
| `code_challenge_method` | `S256` |
| `nonce` | `b64url(sha256('rl-nonce:' + pre))` (§1.3) |
| `prompt` | `select_account` |

**Never sent:** `access_type=offline` (so no refresh token is issued), `login_hint`,
`include_granted_scopes`, and any scope beyond `openid`.

`<origin>` is the request's origin, accepted only when it is in `accountOrigins(env)`, as `steamStart`
does today. The return route rebuilds the same `redirect_uri` from its own URL for the token exchange,
which Google requires to match.

### 1.3 Decision P2: where the PKCE verifier and the nonce live

**Recommended: both are derived from the pre cookie. Neither is stored.**

- The pre cookie is `__Host-rl_pre_<c16>=<32 random bytes, b64url>`, as for Steam: `Secure; HttpOnly;
  SameSite=Lax; Path=/; Max-Age=300`. Its 43 characters are a valid PKCE verifier (RFC 7636 allows 43
  to 128).
- `auth_challenge.pre_hash` already stores `sha256(pre)`. The code challenge is that same digest in b64url,
  and it is public anyway, because it is in the authorization URL.
- At the return, the verifier is the cookie itself. A code is therefore redeemable only by the browser
  that started the sign-in. That is PKCE's guarantee and the login-CSRF guard in one value.
- The nonce is a second hash of the same secret, so the return can recompute it.
- **Alternative:** a random verifier and nonce stored in two new `auth_challenge` columns. That works too,
  and costs two columns plus a secret in D1 for five minutes. It gains nothing over the cookie.

### 1.4 Decision P3: does Google answer the Worker? Prove it from Cloudflare, before any code

**Why this is not taken on trust.** Steam failed exactly here, and every Steam test was green, because
each one stubbed the fetch. Nothing can be assumed about Google from a home machine either: that is what
misled the Steam work.

**The reasoning for Google.**

- The Worker calls only two Google hosts: `oauth2.googleapis.com/token` (a POST) and
  `www.googleapis.com/oauth2/v3/certs` (a GET, the JWKS). The browser, not the Worker, visits
  `accounts.google.com`.
- These are Google's server-to-server API endpoints, built to be called from any cloud. Every
  server-side "Sign in with Google" integration on a cloud host makes the same two calls.
- `steamcommunity.com` is a consumer web site behind bot protection, and its OpenID endpoint is legacy.
- So a block is unlikely, but the ruling stands: **prove it from Cloudflare's egress.**

**The check (no OAuth client, no secret, no deploy).** In the Cloudflare dashboard's Workers playground,
which runs on Cloudflare's network, the lead runs a Worker that does three things:

- `GET https://accounts.google.com/.well-known/openid-configuration`;
- `GET https://www.googleapis.com/oauth2/v3/certs`;
- `POST https://oauth2.googleapis.com/token`, form-encoded, with `grant_type=authorization_code`,
  `code=probe`, `client_id=probe`, `client_secret=probe` and
  `redirect_uri=https://example.invalid/`.

It returns each status and the first 120 characters of each body.

- **Pass:** 200, 200, and a 400 or 401 whose body is Google's JSON OAuth error (`invalid_client` or
  `invalid_grant`). A JSON error from the token endpoint means the request reached Google's OAuth server.
- **Fail:** a 403, an HTML body, or a timeout on any of the three. The Steam failure looked exactly like
  that.

**The second gate is from the production Worker itself.** Slice G4's token exchange logs one diagnostic
line on any non-200 (status, Location host, error name, milliseconds; never a parameter), exactly as
`warnSteam` does. The lead's first real sign-in (G9) is the proof that counts: the playground's egress
is Cloudflare's, but not necessarily the production Worker's.

- **Alternative:** a `/stats`-gated probe route deployed in the Worker. That is closer to production,
  but it needs a deploy, and G9 gives the same evidence with no extra code. It is kept as the fallback if
  the playground and production ever disagree.

### 1.5 Decision P4: verifying the ID token

**Recommended: verify the signature against Google's JWKS, and check every claim, even though the token
comes straight from the token endpoint.**

- Google's own documentation says a token received directly from the token endpoint over HTTPS, with
  the client secret, can be trusted without a signature check. Verifying anyway costs one cached fetch
  and one Web Crypto `RSASSA-PKCS1-v1_5` verify. It also means the verifier stays correct if a later path
  (a native Steam-build sign-in, say) ever hands the Worker a token it did not fetch itself.
- **The JWKS** comes from `https://www.googleapis.com/oauth2/v3/certs`. It is cached in the isolate and
  in the Cache API for as long as its `Cache-Control: max-age` allows, capped at 24 hours. An unknown
  `kid` refetches once, which is how key rotation is handled, and at most once a minute per isolate. A
  JWKS fetch that fails fails the sign-in closed, with return code `google`.

**The checks, each one a mutation in G2:**

1. The header's `alg` is `RS256`, and nothing else (`none` and `HS256` are refused).
2. `kid` names a key in the JWKS.
3. The signature verifies.
4. `iss` is `https://accounts.google.com` or `accounts.google.com`.
5. `aud` equals `GOOGLE_CLIENT_ID`, as a string, or as an array whose only member it is.
6. `azp`, when present, equals `GOOGLE_CLIENT_ID`.
7. `exp` is later than now minus 60 seconds of skew.
8. `iat` is no later than now plus 60 seconds.
9. `nonce` equals the nonce derived from the pre cookie.
10. `sub` is 1 to 255 ASCII digits.

On check 10: Google documents `sub` as up to 255 case-sensitive ASCII characters, and today it is
numeric. Refusing anything else turns a format change into a loud `invalid`, never a silent new member.

- **Alternative:** skip the signature, as Google permits for this path, and keep checks 4 to 10. It is
  smaller and has no JWKS dependency. It is the fallback if the JWKS ever proves flaky from Workers.

### 1.6 Decision P5: which claims are kept

**Recommended: `sub` only.**

- With `scope=openid`, Google's ID token carries `iss`, `aud`, `azp`, `sub`, `iat`, `exp`, `nonce` and
  `at_hash`, and no `email`, `name` or `picture`. If any of those ever arrive, they are dropped unread.
- `hd`, `email_verified`, `locale` and `auth_time` are not read.
- The access token and the ID token are discarded once the request ends. They are never written to D1,
  KV, a log or a response.
- **Identities are never matched by email.** There is no email to match. A Google account and a Steam
  account become one member only through an explicit link (§3).

**One fact is not confirmed (Q2).** Google's OpenID page says the scope "must begin with `openid` and then
include `profile`, `email`, or both". An `openid`-only request is widely used and returns `sub`, but no
Google page found while writing this says so outright.

- G9 (the lead's first sign-in) confirms it: the consent screen, and a debug assertion that the verified
  payload has no `email` key.
- If Google refuses a bare `openid`, the fallback is `openid profile`, with the name and picture dropped
  unread. The consent screen then tells the player that Google shares their name and picture, so the
  privacy page must say we receive and discard them.

### 1.7 Decision P6: Discord, Apple and GitHub

**Recommended: later, each in its own slice and with its own lead step. Do not build a generic OAuth
framework now.**

- Google is written as one small config object: auth URL, token URL, JWKS URL, issuers and scope. That
  object is the seam for the next provider, and nothing more.
- **Notes the later designs must not miss:**
  - **Apple** needs the paid developer membership (99 USD a year), and a client secret that is a JWT the
    Worker signs with a `.p8` key. When name or email is requested, Apple returns by
    `response_mode=form_post`, a cross-site POST, and a `SameSite=Lax` pre cookie is NOT sent on a
    cross-site POST. Apple therefore needs a different browser binding, or no scopes, which allows the
    query mode.
  - **Discord** is plain OAuth 2.0 with PKCE. Its user id comes from `/users/@me` with the access token,
    not from an ID token.
  - **GitHub** has no OIDC for users, and the same `/user` call shape.

---

## 2. Data minimisation and privacy

### 2.1 Decision M1: what is stored

**Recommended: the `sub`, in plain text, in `member_identity.subject`, exactly as the SteamID is stored.**

The `sub` is Google's permanent, global account number. It is the same for every app the player signs in
to, so it is personal data (pseudonymous, but linkable).

| Option | For | Against |
|---|---|---|
| **Plain `sub`** (recommended) | The SteamID precedent. Export shows the player their own identifier. There is no key to lose. | A database leak reveals Google account numbers. They are not secrets and grant no access, but they can be linked to other services' leaks. |
| `HMAC(pepper, sub)`, with a new secret `ACCOUNT_SUBJECT_KEY` | A leak of D1 alone reveals nothing linkable. | **Losing or rotating the pepper strands every Google member**, because sign-in can no longer find them, with no recovery. It adds one more secret, which the lead must never lose. |
| Unkeyed `sha256(sub)` | No key to lose. | Theatre: anyone holding a candidate `sub` confirms it by hashing. Still personal data under the GDPR. |

The `sub` is never sent to the app: `GET me` reports a Google identity as `{provider: 'google'}` with no
subject. It is never logged, never sent to telemetry, and never written to a match record.

### 2.2 What is never stored

- Email, name, picture, locale or hosted domain from Google.
- Any Google token: access, ID or refresh. No refresh token is ever issued.
- The authorization code, the `state` and the PKCE verifier. The challenge row holds `sha256(c)` and
  `sha256(pre)`, as for Steam, and is consumed once.

### 2.3 Cloudflare's request logs

`wrangler.jsonc` keeps traces with `redact_query_string: false` (plan ruling 22).

- **Google's return URL** carries `state`, `code`, `scope`, and sometimes `authuser` and `prompt`. It
  carries no identifier. The code is single-use, expires within minutes, and is useless without the
  client secret and the PKCE verifier. **The Google sign-in therefore writes no personal identifier into
  Cloudflare's logs.** Steam's return URL did, through `openid.claimed_id`.
- The privacy page's Cloudflare paragraph keeps the Steam sentence only while Steam is on (§2.4).

### 2.4 The privacy page and the profile's privacy line (slice G7)

`packages/worker/src/privacy-page.ts`:

- **"What is stored"** replaces the SteamID bullet with two:
  - "If you sign in with Google: Google's account number for you (its `sub`), and nothing else from
    Google. We do not ask Google for your email, name or picture."
  - "If you link Steam: your SteamID64, which links to your public Steam profile." This line stays,
    because a member may hold one.
- **"What is never stored"** gains "Your Google email address, name and profile picture, and any Google
  sign-in token."
- **A new section, "Signing in with Google".**
  - Google handles the sign-in under its own privacy policy, and learns that you signed in to Roaring
    Lions.
  - You can remove Roaring Lions from your Google account's third-party access page at any time.
  - We hold no Google token, so there is nothing for us to revoke.
- **The Cloudflare paragraph** is reworded so it is true of both flows. The Google return carries a
  one-time code and no identifier; a Steam return, while Steam is on, carries the SteamID.
- **Unchanged:** the lawful basis, "providing the service you asked for" (GDPR Art. 6(1)(b), as today).
  Also unchanged: retention, export, deletion, the contact, and the minimum age, 16.
- `PRIVACY_UPDATED` moves to the merge date.
- **The test pins it:** the page names "Google", contains "do not ask Google for your email", and keeps
  "SteamID" while Steam is a provider.

`en.json`:

- `profile.privacy` becomes provider-neutral: "Signing in stores an account number from Google, or your
  SteamID if you link Steam, and nothing else from either. No email is asked for. Play as a guest whenever
  you like."
- **Decision M2 (the age line).** **Recommended:** `profile.signUpHint` gains the age: "You must be 16 or
  older. Your first sign-in creates your game account." No claim gives the age, so the server cannot check
  it, and the page and the sign-up line state it. *Alternative:* the privacy page only, as today.

### 2.5 Export, delete, retention and tombstones

- **Export.** `tables.ts`'s `member_identity.exportSql` gains
  `CASE WHEN provider = 'google' THEN subject END AS google_sub`. The `sub` is the player's own, as the
  SteamID is. Test A1-8 still walks the migration.
- **Delete.** No change. The identity row goes with the member through `MEMBER_TABLES`. There is nothing
  to revoke at Google.
- **Retention.** No change. The member is deleted after 36 months with no sign-in; `last_used_day` is
  stamped on each Google sign-in by `memberForIdentity`. Challenges last 5 minutes.
- **Tombstones.** No change. They are keyed by `sha256(public_id)` and know nothing of providers.
- **Telemetry stays unlinked.** Test A1-10 gains a `sub` sentinel, which must appear in no telemetry
  payload, feedback context, match row or lobby message.

---

## 3. The identity model

### 3.1 Decision I1: the table

**Recommended: rebuild `member_identity` and `auth_challenge` with wider CHECK lists, and add one partial
unique index. No new table.** The 0001 migration's own comment foresaw this: "A6 OAuth: a rebuild in
their phase".

`migrations-accounts/0002_google.sql`:

- `member_identity.provider` CHECK becomes `('passkey', 'recovery', 'steam', 'google')`. Every column,
  `UNIQUE (provider, subject)`, the `state` CHECK and the three existing indexes are recreated
  byte-for-byte.
- **New:** `CREATE UNIQUE INDEX member_identity_one_google ON member_identity (member_id) WHERE provider = 'google'`.
  That is one Google account per member, the Steam rule.
- `auth_challenge.purpose` CHECK gains `'google-login'` and `'google-link'`.
  - `auth_challenge` holds only 5-minute rows. It is dropped and recreated, not copied, and at most one
    in-flight sign-in answers `expired`.
- **The rebuild:** create `member_identity_new`, `INSERT ... SELECT` every row, drop the old table, rename
  the new one, and recreate the indexes.
  - `member_identity` references `member` and nothing references it, so dropping it breaks no foreign key.
  - The migration still opens with `PRAGMA defer_foreign_keys = true`, which is D1's documented way to
    defer enforcement inside a migration.
  - G1 confirms this against D1's "foreign keys" page before writing the SQL, not from memory.

**Alternatives:**

- *Pre-list `apple`, `discord` and `github` now*, which saves a later rebuild. Rejected for now: the CHECK
  then names providers that have no code, and a rebuild costs one slice. It is Q6 if the lead prefers it.
- *Drop the provider CHECK and validate in code.* Rejected: the CHECK is the last line against a typo
  provider.
- *Several Google accounts per member.* Rejected: there is no use for it, and it complicates "which
  account is this".

### 3.2 Every place that hard-codes Steam today, and its change

| Site | Today | Change | The mutation that must turn its test red |
|---|---|---|---|
| `identity.ts` `canSignInCount` | `provider IN ('passkey', 'steam')` | One exported `SIGN_IN_PROVIDERS` constant, interpolated into both SQL strings | Drop `google` from the constant: a Google+Steam member can never remove Steam (409 `last_identity`) |
| `identity.ts` `deleteIdentity`'s guard | the same list, a second copy | The same constant | Hand-edit one copy back to the old list: the test that removes Steam from a Google+Steam member goes red |
| `member.ts` `createMember` | `identity: { provider: 'steam'; subject }` | `provider: 'steam' \| 'google'` | — (types only) |
| `http.ts` `accountGuard` | exempts `GET steam/return` by exact path | Exempts a fixed set of return paths: `steam/return`, `google/return` | Remove `google/return`: the return answers 403 (the A1-2 CSRF tests must still pass for every other GET) |
| `routes.ts` `UNLIMITED_HERE` | the Steam routes and `gone` | Adds `google/start` and `google/return` (they take `ACCOUNT_LIMIT` themselves) | Leave them out: a sign-in costs from both limiters (a count test) |
| `profile.ts` `me` | `steamId` for a Steam row | Google rows carry no subject | Return `subject` for Google: a test that `me` never contains the `sub` sentinel |
| `tables.ts` export | `steam_id` only | adds `google_sub` | Leave it out: the export test for a Google member lacks it |
| app `client.ts` | `steamStart`, `RETURN_CODES`, `IdentityView.steamId` | `googleStart`, the codes in §3.4, `p=` read | — |
| `en.json` | `profile.signIn`/`signUp`/`signUpHint`/`privacy`/`reauth`/`result.*`, which all say Steam | §4.3 | `validate:ui` and a pseudo capture in CI |
| `privacy-page.ts` | the SteamID bullet, the Cloudflare paragraph | §2.4 | The privacy test's Google assertions |

### 3.3 Linking, conflicts and unlinking

The rules of the accounts spec §1.3 hold. They are restated here for two providers.

- **Sign in (`google-login`).**
  - The `sub` belongs to a member: a new session for that member.
  - It belongs to no one, and the switch is open: `createMember` with `{provider: 'google'}`, inside the
    `acct-new-*` budgets.
  - It belongs to no one, and the switch is closed: `r=closed`, and no member is made.
- **A Google member links Steam later** (once the relay exists): the existing `steam-link` purpose,
  unchanged. Nothing in this spec blocks it.
- **A Steam member links Google** (`google-link`, fresh session):
  - the `sub` is already on this member: `r=linked`;
  - the `sub` is on another member: `r=taken`. **Nothing moves, and the device stays signed in as the
    member it was.** It is never silently switched to the other member;
  - this member already has a different Google identity: `r=already` (new code). The player removes it
    first;
  - otherwise, insert the row: `r=linked`. A `UNIQUE` race also answers `taken`.
- **Two members are never merged.** A merge would move coins between members, which the accounts spec
  §2.4 forbids. A player who wants one account deletes the other first, and the `taken` line says so.
- **Unlinking.** `DELETE identity/:id` with a fresh session is refused (409 `last_identity`) when no way
  to sign in would be left. `SIGN_IN_PROVIDERS` counts `passkey`, `steam`, `google` and an ACTIVE
  `recovery` code.
  - **Decision I2:** while Steam is off, a Steam identity cannot sign anyone in. **Recommended:** it still
    counts as a way in. It will again once the relay ships, and refusing to remove Google from a
    Google+Steam member would strand nobody.
  - *Alternative:* count only the providers that are on. That is more honest today, but the same member's
    removable set would change with a flag.
- **Reauth (the fresh session).** Delete, link and unlink need `fresh_until` (5 minutes after a sign-in).
  A Google-only member re-auths with `google-login`, which mints a new fresh session for the same member.
  See Q4 on its strength.

### 3.4 Return codes

`RETURN_CODES` gains:

- `google`: Google did not answer, or the JWKS failed;
- `already`: this member already has a Google identity.

Everything else is reused: `ok`, `linked`, `cancelled`, `expired`, `nocookie`, `invalid`, `closed`,
`limit` and `taken`.

**The return also carries `p=google` or `p=steam`,** read against an allow-list, so the profile can say
"Google is linked" or "That Google account belongs to another player". A missing or unknown `p` falls back
to provider-neutral text.

Google's `error=access_denied` (the player pressed Cancel) maps to `cancelled`. `temporarily_unavailable`
and `server_error` map to `google`. Any other `error` maps to `invalid`.

---

## 4. UI

### 4.1 Decision U1: what the app shows, and who decides it

**Recommended: `GET open` reports the providers that work, so the buttons follow the server, and Steam
comes back with a flag and no app release.**

`GET open` answers `{open, providers}`. `providers` is an array drawn from `['google', 'steam']`:

- **`google`** is listed when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set AND
  `flags.google = 'open'`. A missing row means not listed.
- **`steam`** is listed when `flags.steam = 'open'`. A missing row means not listed, which is today's
  correct state.

`google/start` and `steam/start` answer 503 `{error: 'provider_off'}` with no challenge written:

- **Google:** when either secret is missing. A closed `flags.google` alone does NOT stop it, so the lead
  can test before opening (§4.2).
- **Steam:** when `flags.steam` is not `'open'`. A stale tab can no longer spend the sign-in budget on a
  flow that cannot finish.

### 4.2 Decision U2: the profile screen

**A guest** sees, while Google is listed:

- "Sign up with Google", only while `open` is true;
- "Sign in with Google";
- the sign-up hint, the privacy line and the privacy link, as today.

The wording follows Google's sign-in branding guidelines, which allow "Sign in with Google" and "Sign up
with Google". The button carries Google's unaltered "G" mark (§4.4).

**With no provider listed**, the guest block says "Sign-in is not open yet." (`profile.signInClosed`), and
nothing else.

**The lead's test before opening (G9).** `/profile?google` shows the Google buttons even while
`flags.google` is not `'open'`.

- It is presentation only: the routes work whenever the secrets are set, and the flag only decides
  whether a button is drawn for everyone.
- `google` joins `STICKY_QUERY_KEYS`, as `accounts` did.
- `?google` changes no scoring and no stored data. It only shows a button that works anyway.

**A signed-in member:**

- **The identity list:**
  - a Google row reads "Google" (`profile.identity.google`), with no identifier, because the app is
    never given one;
  - a Steam row reads "Steam · <SteamID>", as today.
- **"Link Google"** appears when Google is listed and the member has no Google identity. It starts
  `google-link`; with a stale session, it first asks for the fresh sign-in.
- **"Link Steam"** appears only when `steam` is listed. Today it is not.
- **`profile.reauth`** becomes "Sign in again to confirm.", with a "Sign in again" button. The button uses
  the first listed provider the member holds (Google first).

### 4.3 Decision U3: the Steam buttons while Steam is blocked

**Recommended: hide them.** No Steam button, no Steam sign-up hint, and no "coming soon" line for guests.

- A button that fails every time costs trust, and spends `ACCOUNT_LIMIT` and `acct-start-*` on nothing.
- Steam is never required, and Google is in its place.
- The relay is open-ended in time, and a "coming soon" line ages badly.
- **Who could be stranded: probably no one.** Every production Steam sign-in has failed at
  `check_authentication`, so no Steam member can have been created there. The lead confirms it with one
  read-only count (lead step L-0c). If the count is not zero, those members cannot sign in until the relay
  ships. Their data stays, export and delete need a session, and the 36-month clock is far away. The
  profile then gains one line for them only (Q8).
- *Alternative:* keep the buttons, disabled, with "Steam sign-in is coming back later". That is more
  transparent, but it is a dead control on the screen of every guest.

`en.json` changes:

- **Changed:** `profile.signIn` and `profile.signUp` become provider-scoped keys, `profile.google.signIn`
  and `profile.google.signUp`. `profile.signIn`/`signUp` are kept for Steam, with
  `profile.steam.signIn`/`signUp` as the new keys.
- **Changed:** `profile.signUpHint` (§2.4), `profile.privacy`, `profile.reauth`, and `profile.result.linked`
  and `profile.result.taken`, which become per-provider variants keyed by `p`.
- **New:** `profile.result.google` ("Google did not answer. Try again in a minute."),
  `profile.result.already`, `profile.identity.google`, `profile.link.google`, `profile.signInClosed`.
- **Unchanged:** the menu chip, `menu.profile.guest` ("Sign in").

### 4.4 Decision U4: Google's "G" mark against `validate:ui`

`validate:ui` rejects a hex literal in any `.svg` under `packages/app/src`. Google's mark has four fixed
brand colours, which must not be altered or drawn from our palette.

- **Recommended:** ship the mark as `assets/brand/google-g.svg` (Google's published file, unaltered),
  drawn by an `<img>`. Add a named exemption list, `BRAND_MARKS`, to `tools/validate_ui_palette.mjs`. It is
  pinned to that one path, and a test fails if a file is added to `assets/brand/` without being named. That
  is the repository's named-exemption idiom, not a silent scope gap.
- *Alternative:* the four colours as `reserved.brand.google.*` palette keys. That puts a third party's
  brand inside our palette, and the gate would still need to know they are fixed.
- The mark's licence is Google's brand terms, not ours. The PR names it, and `docs/` credits it.

---

## 5. Security

1. **CSRF on `google/start`:** unchanged. `x-rl-account: 1`, the strict `Origin` check, a JSON body, no
   CORS, and `OPTIONS` answering 405 (accounts spec §1.8).
2. **`google/return` is the second exempt GET,** and it writes only after all of these pass, in this
   order:
   - the `state` has the challenge shape;
   - `ACCOUNT_LIMIT` allows it;
   - the challenge exists, is unexpired and has a `google-*` purpose. It is consumed by
     `DELETE ... RETURNING`, so it is used at most once;
   - the `__Host-rl_pre_<c16>` cookie is present, and its hash equals `pre_hash`;
   - Google's `error` parameter is absent;
   - the token exchange succeeds with `code_verifier = pre`;
   - the ID token passes P4's ten checks.

   Every outcome clears that challenge's pre cookie and answers 303 with no body.
3. **Login CSRF and code injection.**
   - An attacker's finished sign-in replayed into a victim's browser fails the pre-cookie match.
   - A stolen code injected into a victim's return fails PKCE, because the victim's verifier is not the
     attacker's.
   - Both are tests in G4.
4. **Rate limits.**
   - `google/start`: `ACCOUNT_LIMIT` plus `startBudget` (`acct-start-ip`, `acct-start-all`), shared with
     Steam, because it writes a challenge row.
   - `google/return`: `ACCOUNT_LIMIT`.
   - A new member: `newAccountBudget` (`acct-new-ip` 5 a day, `acct-new-all` 500 a day).
   - No new limiter or namespace.
5. **The redirect URI allow-list.**
   - `redirect_uri` is built only from an origin in `accountOrigins(env)`. Google's client registration
     is the second allow-list: an origin not registered there is refused by Google.
   - After the return, the 303 goes only to the fixed `ACCOUNT_RETURN_PATH`. No route ever reads a
     `next` or `redirect` parameter, so there is no open redirect.
6. **The outbound calls.**
   - The token exchange uses `client_secret_post` over HTTPS, with an 8-second timeout and
     `redirect: 'manual'`. Any status other than 200 is refused.
   - The response body is read capped at 16 KiB.
   - The JWKS GET has the same timeout and a 64 KiB cap.
   - `user-agent: roaring-lions-worker`, as for Steam.
7. **Token storage: none.**
   - The browser never receives a Google token or the `sub`.
   - The Worker drops both tokens when the request ends.
   - `warnGoogle` logs a status, a Location host, an error NAME and milliseconds. It never logs a
     parameter, a code, a token, a `sub`, a cookie or an IP.
   - G4 has a test that captures `console.*` during every return path and searches it for the sentinel
     code, the token, the `sub` and the cookie.
8. **Session reuse.**
   - Every successful `google-login` mints a NEW session (`sessionFor` or `createMember`), never extends
     an old one. That is the standard defence against session fixation.
   - `fresh_until` is set 5 minutes ahead.
   - The device's previous `__Host-rl_session` cookie is overwritten. **Decision S1, recommended:** in
     the same batch, delete the previous session's row when it resolves to a DIFFERENT member, so
     switching accounts on a device leaves no live orphan session. *Alternative:* leave it to expire, as
     Steam does today.
9. **Secrets fail closed.** A missing `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` answers 503
   `provider_off` from `google/start` before any challenge is written or any fetch is made. A return that
   arrives anyway (an old tab) answers `r=google`.
10. **No test backdoor in production code.** There is no `GOOGLE_ISSUER`, `GOOGLE_FAKE` or JWKS-URL
    override in `Env`. Tests reach Google only through `AccountDeps.fetch`, the seam that `verifyOpenId`
    already uses (§6.3).

---

## 6. The lead's setup, exact and minimal

### 6.1 Before any code

**L-0a. Create the OAuth client** in Google Cloud Console, under Google Auth Platform. This is also a
gate: if Google refuses the `workers.dev` redirect URI, the plan stops at Q1.

1. Create or select a project, for example `roaring-lions`.
2. **Branding:**
   - app name "Roaring Lions";
   - user support email: an alias or a Google Group, not a personal address (Q3). Google shows it to
     players who open the app's details;
   - homepage `https://roaring-lions.pint12.workers.dev/`;
   - privacy policy `https://roaring-lions.pint12.workers.dev/privacy`;
   - authorized domain `pint12.workers.dev`;
   - **no logo.** A logo triggers Google's brand verification.
3. **Audience:** External.
4. **Data access:** no scopes added. `openid` needs none.
5. **Clients**, then Create client:
   - type: Web application;
   - name: `roaring-lions-worker`;
   - authorized JavaScript origins: none (the flow is server-side);
   - authorized redirect URIs: exactly `https://roaring-lions.pint12.workers.dev/api/account/google/return`.
6. Copy the client id and the client secret **at creation.** Google now shows a new client's secret only
   once. A lost secret is replaced by adding a second secret to the same client, not by recreating it.
7. Keep the publishing status as it is until G9 (Q5).

**L-0b. The egress probe** (§1.4), in the Cloudflare dashboard's Workers playground. It takes about 5
minutes and needs no secret and no deploy. Paste the result into GH-1075.

**L-0c. The Steam member count**, read-only:
`npx wrangler d1 execute roaring-lions-accounts --remote --command "SELECT COUNT(*) AS n FROM member_identity WHERE provider = 'steam'"`.
Expected: 0.

### 6.2 Before G1 merges

**L-1. Apply the migration:** `npx wrangler d1 migrations apply roaring-lions-accounts --remote`. Merging
deploys from `main`, and the Google code must not meet the old CHECK.

### 6.3 After G7 (the privacy page) is merged and live

**L-2. Set the two secrets.** Names only; the values come from L-0a:

- `npx wrangler secret put GOOGLE_CLIENT_ID`
- `npx wrangler secret put GOOGLE_CLIENT_SECRET`

The client id is not secret (it is in every authorization URL). It is held as a secret anyway, so the
pair is set and checked as one, and a missing pair fails closed. *Alternative:* the client id as a
`wrangler.jsonc` var. Then it is in the repository, and the pin test must check that the secret never is.

**L-3. Close the switch explicitly.** Run the flags command from `shell-and-ui.md` with
`('google', 'closed')`, and the same with `('steam', 'closed')`. A missing row already means off; the rows
make the state readable.

**L-4. G9: the lead's first sign-in** at `https://roaring-lions.pint12.workers.dev/profile?google`:

1. Sign up with a Google account.
2. Check that the consent screen asks for nothing beyond the basic sign-in.
3. Check that the profile says "Signed in" and lists "Google".
4. Check that Workers Logs show no `account: google ... failed` line.
5. Download the export, and check `google_sub` is there with no email.
6. Delete that test account if wanted.

**L-5. Open Google:** the flags command with `('google', 'open')`. No deploy is needed, and closing is the
same command with `'closed'`.

### 6.4 The test mode: CI and `pnpm dev` never call Google

- **Unit and integration tests** inject `AccountDeps.fetch`. A stub answers the token endpoint and the
  JWKS:
  - the ID tokens are signed by an RSA key pair generated with Web Crypto inside the test;
  - the stub's JWKS publishes that key's public half;
  - the stub records every request, so a test asserts the exact token-endpoint body (`grant_type`,
    `code`, `code_verifier`, `redirect_uri`, `client_id`, `client_secret`) and that no other host was
    called.
- **CI and `pnpm dev`** set no Google secret, so Google is off, `providers` omits it, `google/start`
  answers 503, and no code path builds a Google URL.
  - A source test pins it: `packages/worker/src/account/google.ts` is the only file that names
    `oauth2.googleapis.com` or `accounts.google.com`.
  - A second test, run with an `Env` holding no secrets, asserts zero calls to `deps.fetch` across start
    and return.
- **The app** in `pnpm dev` keeps accounts off unless `?accounts` is given (`accountsEnabled`). The
  profile's Google buttons are tested in jsdom with a stubbed `AccountClient`, as the Steam ones are.
- **There is no fake Google in the Worker.** A local browser walk of the full flow is not planned. The
  first real walk is G9, by the lead, in production, before the flag opens.

---

## 7. Slices

Each slice is one to two hours and one PR. Each lands green, and each test is run red once with its
mutation named in the commit message (CLAUDE.md, "Every check gets an input that makes it fail"). Opus
reviews G2, G3 and G4, the security slices, as for A1. Sonnet implements.

**What merging deploys.** `main` deploys to production. Every slice below deploys **inert** until L-2
sets the secrets: without them, `google/start` answers 503, and `providers` omits Google, so no button is
drawn. The one change players see before that is G5's: the Steam buttons disappear, which is the fix for
a flow that cannot finish.

| Order | Slice | What it builds | Proof (test, and the mutation that turns it red) |
|---|---|---|---|
| 0 | **Gates** (lead, no code) | L-0a client created, L-0b egress probe green, L-0c count | The probe's three statuses pasted into GH-1075. **No slice starts until L-0a and L-0b pass** |
| 1 | **G1: the migration and the provider list** | `0002_google.sql` (§3.1); `SIGN_IN_PROVIDERS` in both SQL strings; `createMember`'s type; the export column | (a) Apply 0001, seed a member with Steam, passkey and recovery rows, apply 0002, and require every row byte-identical. Mutation: copy one column fewer, and it goes red. (b) A second Google row for one member is refused. Mutation: drop `member_identity_one_google`. (c) A Google+Steam member removes either one but never both. Mutation: drop `google` from the constant. (d) A1-8 and A1-9 stay green (foreign keys on and off) |
| 2 | **G2: the ID-token verifier** (pure, `google-oidc.ts`) | JWT parse; RS256 by Web Crypto; the JWKS fetch and cache, with a `kid`-miss refetch at most once a minute; P4's ten checks | Ten mutations, ten reds, one per check (§1.5), each against a token signed by the test key. Plus: a token whose payload carries `email` verifies, and the verifier's result has only `sub`. Mutation: return the payload |
| 3 | **G3: `google/start` and the config** | `GOOGLE_*` in `Env`; `provider_off` 503 before any write or fetch; the challenge row; the pre cookie; the URL of §1.2 | The URL's parameters as literals, `scope === 'openid'` exactly, no `access_type`. Mutations: add `email` to the scope; send `code_challenge` as hex. With no secrets: zero rows and zero fetches; mutation: check the secrets after the insert. `google-link` without a fresh session answers 403 `reauth`. An origin outside `accountOrigins` answers 403 |
| 4 | **G4: `google/return`** | The guard exemption; the challenge consumed; the pre-cookie match; the `error` mapping; the token exchange; login, create, link, `taken`, `already`, `closed`, `limit`; `warnGoogle` | One mutation per check in §5.2, in the A1-19 style: a consumed challenge, a wrong pre cookie, a wrong verifier sent, `error=access_denied` mapped to `cancelled`, a token-endpoint 403 mapped to `google`. A `taken` link leaves both members' rows unchanged and the device still the first member's; mutation: sign in as the owner. The console capture holds no sentinel; mutation: log the token response. A code from another browser's challenge fails; mutation: send `pre_hash` as the verifier |
| 5 | **G5: providers and the Steam gate** | `GET open` gains `providers`; `flags.google` and `flags.steam`; `steam/start` answers 503 while Steam is off; the app client's `googleStart`, `RETURN_CODES` and `p` | `providers` for each of the four (secrets × flag) cases. Mutation: list Google without the flag. `steam/start` with no flag writes no challenge; mutation: gate after `startBudget`. `readReturnCode` refuses an unknown `p` |
| 6 | **G7: the privacy page** (before G6, so the page is live before the button can be) | §2.4's text; `PRIVACY_UPDATED`; `profile.privacy`; `profile.signUpHint` | The privacy test asserts "Google", "do not ask Google for your email" and the third-party-access line. Mutation: delete any one of them. `script-src 'none'` is unchanged |
| 7 | **G6: the profile UI** | §4.2 and §4.3; the strings; `assets/brand/google-g.svg` with the `BRAND_MARKS` exemption; `?google` sticky | jsdom: with `providers: []`, no sign-in button and the closed line; with `['google']`, the Google buttons and no Steam text. Mutation: render Steam unconditionally. `?google` shows the buttons with the flag closed. A new file in `assets/brand/` fails `validate:ui`. A1-10 with a `sub` sentinel. The pseudo capture is left to CI |
| 8 | **G8: the docs** | `shell-and-ui.md` (accounts: providers, flags, secrets, the runbook); CLAUDE.md's "No secrets" line for accounts, through a reviewed PR | — |
| 9 | **G9: the lead's live sign-in** (L-4), then L-5 | — | The only proof that the production Worker reaches Google. Google opens to players only after it |

**The migration** is G1's `0002_google.sql`, applied by the lead before G1 merges (L-1). No other slice
needs one.

**The size:** about 10 to 12 hours of implementation across G1 to G8, plus reviews. That is about 2
agent-days, the same estimate the accounts spec gave a web provider.

---

## 8. Risks and open questions for the lead

Each has a recommended default. Under the recommendation-default rule, the default stands unless the lead
says otherwise.

1. **Q1. Google may refuse a `workers.dev` redirect URI or authorized domain.** No Google page found while
   writing this says either way. `workers.dev` is a Cloudflare-run suffix, so the registrable domain
   should be `pint12.workers.dev`.
   - **Default:** L-0a tests it in a minute, before any code.
   - **If it is refused:** the custom domain (L2, ruled "later") becomes a prerequisite, and this plan
     waits for it. A Google identity is not hostname-bound, so a later move only adds a redirect URI and
     strands no one.
2. **Q2. `scope=openid` alone may be refused.** Google's OIDC page says the scope "must" add `profile` or
   `email`.
   - **Default:** ship `openid`, and confirm at G9.
   - **If it is refused:** `openid profile`, with the name and picture dropped unread, and §2.4's text
     amended to say we receive and discard them. `email` is never requested either way.
3. **Q3. The consent screen's user support email** is shown to players by Google. The 12 Nov ruling keeps
   personal email off our pages.
   - **Default:** a dedicated alias or Google Group.
   - *Alternative:* the lead's address, accepting that Google shows it.
4. **Q4. The strength of a "fresh" session.** Google offers `prompt` values `none`, `consent` and
   `select_account`, and no `prompt=login`. `auth_time` is returned only when requested through `claims`
   and enabled in settings.
   - So a re-auth can complete with a single account click while the player is signed in to Google. That
     is the same strength as Steam's flow, which also completes silently.
   - **Default:** accept it, with `prompt=select_account` on every start, so the player at least sees and
     picks the account.
   - *Alternative:* request `auth_time` and require it within 5 minutes for delete, link and unlink. That
     is a stronger check, but it depends on a Google setting and adds a slice.
5. **Q5. The publishing status.** In "Testing", only listed test users can sign in. "In production" with
   only `openid` should need no verification, because it is a non-sensitive scope.
   - **Default:** stay in Testing, with the lead as the test user, through G9. Then publish to In
     production before L-5.
   - If Google then asks for verification, Google stays closed until it passes.
6. **Q6. Pre-list future providers in the CHECK.**
   - **Default:** no, `google` only. Each later provider rebuilds `member_identity` again, in one slice.
   - *Alternative:* add `apple`, `discord` and `github` now.
7. **Q7. Plain `sub` or a keyed hash** (§2.1).
   - **Default:** plain, as the SteamID is. No key whose loss strands every member.
   - *Alternative:* `HMAC(ACCOUNT_SUBJECT_KEY, sub)`, a third secret the lead must never lose.
8. **Q8. Steam members, if L-0c finds any.**
   - **Default (when the count is 0):** hide Steam entirely (§4.3).
   - **If not 0:** their profile shows one line, "Steam sign-in is paused. Link Google to keep signing
     in.", when they already have a session. They cannot sign in until the relay ships.
9. **Q9. Old sessions on an account switch** (§5, S1).
   - **Default:** delete the previous member's session row on this device when a different member signs
     in.
   - *Alternative:* let it expire, as today.
10. **Q10. The age line on the sign-up hint** (§2.4, M2).
    - **Default:** add "You must be 16 or older".
    - *Alternative:* the privacy page only.
11. **Q11. Google's brand mark in the repository** (§4.4).
    - **Default:** Google's unaltered SVG under `assets/brand/`, with a named `validate:ui` exemption and
      a credit.
    - *Alternative:* a text-only button. That departs from Google's branding guidelines, which Google can
      enforce at verification.
12. **Risk R1. The playground and production can disagree** (§1.4). The playground's egress is
    Cloudflare's, but not provably the production Worker's.
    - **Mitigation:** G9 is the real gate, and the Google flag stays closed until it passes. If G9 fails
      while the playground passed, the `/stats`-gated probe is built to see why.
13. **Risk R2. Google is now a dependency for every new sign-in.**
    - A Google outage blocks new sign-ins only. A signed-in device keeps its 30-day session and plays from
      its cache, as with Steam.
    - `flags.google = 'closed'` hides the button with no deploy.
14. **Risk R3. The Steam relay design**, out of scope here. These are the seams it can use:
    - the `steam` provider and the `steam-link` and `steam-login` purposes are unchanged;
    - `verifyOpenId` already takes its `fetch` as a parameter. A relay changes the URL it posts to, adds an
      authentication header (a new secret), and keeps every check before and after the round trip;
    - `flags.steam = 'open'` puts Steam back in `providers`, and the profile shows "Link Steam" and the
      Steam sign-in with no app release;
    - one design question the relay spec must answer: the relay can lie, so it must be ours and
      authenticated. It is never a third-party proxy.

---

## 9. What this spec does not change

- The session cookie, its lifetimes, the CSRF layers, the `flags.accounts` switch, the claim, sync, coins,
  versus records, tombstones and the cron.
- `PURCHASES_OPEN` stays false. Telemetry stays unlinked. No route raises `paid`.
- No new rate-limit namespace, D1 database or KV namespace. The two new secrets are the only new
  configuration.
