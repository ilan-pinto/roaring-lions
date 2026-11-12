# Player accounts and profiles (GH-1075): design

**Status:** design, revised 7 Nov after the lead's rulings (every decision but L1 is ruled, §8) and
the CodeRabbit review of PR 1101. Nothing here is built.
**Issue:** GH-1075, queued by the lead on 6 Nov 2026.
**Author:** Opus design agent, 7 Nov 2026.
**Touches when built:** `packages/worker` (new routes, a new D1 database), `packages/app`
(a server-backed `LedgerStore`, a claim, a prompt, a profile screen), a new pure package for
the coin rules, and `packages/worker/src/match` (records). The sim is untouched.

Read with:

- `docs/superpowers/specs/2026-09-24-telemetry-design.md` (the Worker, D1, the off switch);
- `docs/superpowers/specs/2026-10-08-in-game-feedback-design.md` (public write endpoints, retention);
- `docs/superpowers/specs/2026-11-04-roar-coin-wallet-design.md` (the wallet and its guards);
- `docs/superpowers/specs/2026-10-28-public-matchmaking-design.md` (agreed match results, `pid`).

---

## 0. In one page

- **What the player gets.** One optional step, "Save your progress", turns this browser's
  campaign, brigade, save slots and Roar coins into an account held by the game's own server.
  Signing in on another device brings them back. Clearing site data no longer loses them. A player
  who never takes that step plays exactly as today.
- **Identity: linked providers (§1.3).** A member has one `member_identity` row per way in: a
  passkey, a recovery code, a SteamID, and later an email or an OAuth subject. Steam is a
  first-class provider. "Sign in through Steam" (OpenID 2.0) on the web and Steamworks session
  tickets in a Steam build both give the same SteamID, so one member covers the web and the Steam
  build with no linking step. Linking Steam to a passkey member later is a new row, never a
  migration. No email and no password. **Steam login is not required:** a player with no Steam
  account plays everything as a guest, as today. **L1 is open.** The recommendation (§1.4) is
  **Steam + guest first, with the passkey linked later as the second provider.** The main reason
  is that a SteamID is not bound to a hostname and a passkey is, and the hostname (L2) is ruled
  "later".
- **Storage: the Worker we already run, plus a second D1 database, `roaring-lions-accounts`.** It
  lives beside the telemetry database and is never joined to it. There is no Supabase. That
  reverses the 24 Sep note in the telemetry spec ("two backends"), which assumed a Colyseus relay
  that the Durable Object room has since replaced. This is decision L4.
- **Coins are the server's.** Once an account exists, the coin balance can change only by rules
  the server applies itself: the earn table, coupons it checks, and prices it computes. A request
  never carries an amount. The `paid` half is fenced by a `CHECK (paid = 0)` in the schema until
  ST7. The campaign ledger, the brigade account and the slots are stored and synced, but they are
  trusted from the client, as they are today. §2.4 says why that line sits there.
- **Migration is the existing back-payment, run on the server.** A claim re-derives coins from what
  the device holds, with the same difference rule as `roarBackfill`. The server runs it against
  the member's **claim record**, `earn_lifetime`, which a brigade reset never empties. Running a
  claim twice pays only what the account has not already been paid, whether from two devices,
  after a slot import or after a reset. The client's own balance is read as a ceiling and never as
  a credit (§3).
- **Versus records attach to an account seat** through the session cookie at create and join,
  never through the body's `player` field. A guest opponent shows as their callsign during the
  match and as "Guest" in history. Nothing that identifies a guest is stored (§5).
- **Privacy.** There is no email, no IP and no user agent. A Steam member's SteamID is stored, and
  it is personal data. The privacy page says so, and no persona name or profile is fetched.
  Telemetry stays anonymous and is never linked to an account. Export and delete work from the
  first phase that stores anything, and they keep working when the account switch is closed.
  Deletion writes a tombstone that holds only a hash. It is kept in Workers KV, outside the D1
  database that a Time Travel restore rewinds (§6).
- **Real-money packs stay off.** `PURCHASES_OPEN` stays false in the app, and the server has no
  route that can raise `paid`.
- **Five phases, each shippable** (§7): A0, the shared coin rules; A1, identity, export and delete
  behind a closed switch; A2, claim and sync; A3, versus records and the profile; A4, opening.
  Every test is listed with the input that makes it fail.

---

## 1. Identity

### 1.1 What the account has to survive

- **A device change, and cleared site data.** These are the problems GH-1075 names.
- **The Steam build.** ST2 (Tauri) and ST5 bring a Steam-validated id. A player who signs in on the
  web and then in the Steam build must be one member, never two.
- **A hostname that is not settled.** L2 is ruled "later" (7 Nov). Whatever ships first must
  survive a move to a custom domain.
- **A free, private-by-link test build.** The Worker is on Workers Free (D1 Free's 100,000 rows
  written a day is the binding limit, as the matchmaking spec measured). The host is
  `roaring-lions.pint12.workers.dev`, and `preview_urls` is off, so there is one origin.
- **No secrets without the lead.** Every option that needs one is marked.

### 1.2 The options

| | Passkey (WebAuthn) | Steam (OpenID 2.0 on the web; session tickets in a Steam build) | Email magic link | OAuth (Google, GitHub, Apple) | Device-bound anonymous account |
|---|---|---|---|---|---|
| **What the player does** | Taps "Save your progress" and confirms with a fingerprint, face or device PIN. Signs in on a new device the same way. A synced passkey (iCloud Keychain, Google Password Manager, 1Password) follows the player. | Clicks "Sign in through Steam" and approves on `steamcommunity.com`, in a popup or a full-page redirect. In a Steam build, nothing: the client is already signed in to Steam. | Types an email address, then opens a link or types a 6-digit code. | Picks a provider, then approves a consent screen. | Nothing. The server mints an account on first use and holds it with a cookie. |
| **Survives a device change** | Yes with a synced passkey, or with the QR cross-device flow. Otherwise the recovery code. | Yes, on any device where the player can sign in to Steam. Steam's own recovery and Steam Guard cover a lost device. | Yes. | Yes. | **No.** The cookie is the account. Clearing site data loses it, which is today's problem with a server in the middle. |
| **What the server stores** | A credential id, a public key, a sign counter and transport hints. Nothing personal. | The SteamID64. It resolves to the player's public Steam profile, so it is personal data. Nothing else: no persona name and no profile fetch. | An email address, which is personal data. | The provider's subject id, and usually an email. | A random id. |
| **Secrets and accounts the lead must make** | **None.** | **Web: none.** OpenID is verified by a keyless `check_authentication` POST back to Steam. **Steam build:** a publisher Web API key (a Worker secret) and the app id, from ST5's Steamworks account. | **An email provider** (Resend, Postmark or SES) and its API key as a Worker secret. Cloudflare's own send-email binding only reaches verified addresses. | **One client id and secret per provider.** Google needs a consent screen with a privacy-policy URL. Apple needs a paid developer membership (99 USD a year) and a verified domain. | None. |
| **Domain dependence** | **Strong.** A passkey is bound to its RP ID, the hostname. Moving to a custom domain later breaks every passkey unless Related Origin Requests are set up, and only some browsers honour them. | **None for the identity.** `openid.realm` and `return_to` name today's host. Changing them strands nothing, because the SteamID is the same from any host. | Strong. Sending mail that arrives needs SPF and DKIM on a domain we own. `workers.dev` cannot carry them. | Medium. The redirect URIs are registered per hostname, and can be changed. | None. |
| **Steam wrapper** | Weak. A Tauri webview's WebAuthn support is uneven, and its origin is not the RP ID. The desktop build signs in with Steam instead, as a second identity on the same member. | **Native.** `GetAuthTicketForWebApi` and `ISteamUserAuth/AuthenticateUserTicket` give the same SteamID as the web sign-in. | Works in any webview. | Works through the system browser with a loopback or deep-link redirect. | Works. |
| **Abuse surface** | Low. A registration costs a user gesture and an authenticator. Credentials are phishing-resistant. | Low to medium. A Steam account is free, but Valve limits new free accounts, and that cost sits with Valve. | Mail bombing of third parties, and link-scanner prefetch that spends the link (the fix is a code or a POST confirm step). | Low. The cost sits with the provider. | High. Accounts are free to mint. |
| **CSP and pages** | No change. `connect-src 'self'` covers it. | A popup or a top-level navigation to `steamcommunity.com`, and one return route. `connect-src` is unchanged, because the verify POST is made by the Worker. | No change. | `form-action` and top-level redirects to three providers. | No change. |
| **Build cost (estimate)** | About 4 agent-days with a maintained library (`@simplewebauthn/server`, MIT, runs on Web Crypto in Workers), plus about 1 for the recovery-code handover (§1.6). A spike confirms the bundle first. | About 2 agent-days for the web. The OpenID verify is about 100 lines and needs no library. About 1 more for tickets at ST5. | About 3 agent-days, plus the lead's provider and DNS work. | About 2 agent-days for each provider, plus the lead's app registrations. | About 1 agent-day. |
| **Running cost** | 0. | 0. | 0 at test scale. Free tiers run about 100 mails a day. | 0, plus Apple's 99 USD a year. | 0. |

### 1.3 Identity is a set of linked providers

A `member` is the person. A `member_identity` row is one way in. A member has one or more of them,
and every route that signs in resolves an identity to its member.

| Provider | `subject` | How many per member | Notes |
|---|---|---|---|
| `passkey` | the WebAuthn credential id | any number ("Add this device") | Carries `public_key`, `sign_count`, `transports`, `backed_up`. |
| `recovery` | `sha256(code)` | at most one `active` and one `pending` | Made with the first passkey, or on request from the profile (§1.6). |
| `steam` | the SteamID64, as a decimal string | at most one | Written by the web OpenID route and by the Steam build's ticket route alike, so the two are the same identity. |
| later: `email`, `github`, `google` | the address or the provider's subject | one each | Each is its own phase (A5, A6). |

- **One identity, one member.** `UNIQUE (provider, subject)` means a SteamID or a passkey can belong
  to only one member.
- **Linking** is done by a signed-in member with a fresh session (§1.7), from the profile: "Link
  Steam" or "Add a passkey". If the identity already belongs to another member, the link answers
  `identity_taken`, and nothing moves. **Two members are never merged.** A merge would move coins
  between members, which §2.4 forbids. A player who wants one account deletes the other first.
- **Unlinking** (`DELETE identity/:id`, fresh session) is refused when no identity that can sign
  in would be left. A pending recovery code does not count. An active one does.
- **A new identity that belongs to no one** signs in by making a new member, but only while the
  switch is open, as passkey registration does.
- **Adding Steam needs no migration.** `steam` is in the `provider` CHECK, and the `steam-*`
  challenge purposes are in `auth_challenge`, from `0001_members.sql`. The Steam routes are code.
  A provider that is not listed yet (email, OAuth) needs one table rebuild, in its own phase.
- **The session does not record which provider signed it in.** Only the identity row's
  `last_used_day` moves.

### 1.4 L1: Steam + guest, or passkey now and Steam later

**Steam login is not required.** Nothing in the game needs it. A guest plays the campaign, the
brigade, the Stores and a friend's versus room exactly as today, and signing in only adds the
server copy. So the question is not whether to require Steam. It is which provider ships first,
with the other one linked later.

| | **S: Steam + guest** (Steam first, passkey linked later) | **P: passkey now, link Steam later** |
|---|---|---|
| Who can save progress at A1 | Anyone with a Steam account, on any browser or device. Everyone else stays a guest until P's passkey ships. | Anyone whose browser has WebAuthn. Everyone else uses a recovery code. |
| **The hostname (L2)** | **Not needed.** A SteamID is not bound to a hostname. A1 could ship on `workers.dev`, and a move later strands no one. | **Needed first.** A passkey is bound to its RP ID. A1 holds until L2, as the 7 Nov ruling says. |
| Recovery | Steam's: account recovery and Steam Guard. No code of ours to lose. | Ours: the recovery code and its handover (§1.6), two of the review's security gaps. |
| Personal data on the server | The SteamID (§6.1). The privacy page must name it. | None. |
| Secrets | None for the web. The Web API key arrives with ST5's tickets. | None. |
| Build cost to the first sign-in | About 2 agent-days. | About 5 agent-days. |
| The Steam build (ST5) | The same identity. The ticket route is one more way to reach the existing `steam` row. | The member links Steam once on the web, or signs in with the recovery code in the Steam build. Passkeys in a Tauri webview are uneven. |
| Third-party dependence | Valve's OpenID 2.0 endpoint, a legacy protocol with no SLA. A Steam outage blocks new sign-ins only. A signed-in device keeps its 30-day session and keeps playing from its cache. | None. |
| What a later switch costs | The passkey is added as a provider. No migration, and no member is re-made. | Steam is added as a provider. No migration. |

**Recommendation: S, Steam + guest first, with the passkey as the second provider, linked later.**

- **It is the only way A1 does not wait on L2.** The lead ruled L2 "later". A passkey made on
  `workers.dev` and then moved to a custom domain is re-enrolled, or survives only through Related
  Origin Requests, which only some browsers honour. A SteamID moves with the player.
- **The game is going to Steam (ST2 to ST7).** A web member who signs in through Steam is already
  the same member in the Steam build, so ST5 has no linking step and no second-account case.
- **It carries less of our own security code.** There is no recovery code to issue, hand over or
  keep out of the op log. Steam carries account recovery, second factors and the cost of minting
  accounts.
- **What it gives up.** The server then holds one piece of personal data, the SteamID, and the
  privacy page must say so. A player without Steam cannot save progress until the passkey ships,
  though they still play everything as a guest. And web sign-in depends on Valve keeping OpenID 2.0
  up.
- **What would flip it.** If the lead settles L2 on a custom domain soon and wants the server to
  hold nothing personal, P is the better first provider. The schema, the routes outside the
  provider group and every test are the same either way. Only the order of the provider phases
  changes (§7).
- **The 7 Nov hold.** The ruling holds A1 until L2 is settled. Under S, A1 no longer needs L2,
  because only the passkey provider does. Lifting the hold is the lead's call, and it belongs to
  L1 (§8).

**Rejected for the first provider:**

- **The device-bound anonymous account.** By itself it does not solve the issue. It would also
  mint a server row for every visitor, against a row budget that the telemetry already spends. Its
  one strength, a server session for someone who has no credential yet, is not needed: guests stay
  local (§4).
- **Email (A5) and OAuth (A6).** Each is a later phase with its own lead step, and each adds a
  provider value.

### 1.5 The Worker's role

The Worker is the whole backend: the routes in §2.5, the session check, the coin rules and the
records. It owns no game logic beyond the pure coin rules it shares with the app (§2.6). A new file
group, `packages/worker/src/account/`, holds the routes. `index.ts` sends `/api/account/*` there
before the static assets, and `wrangler.jsonc`'s `run_worker_first` already covers `/api/*`.

**WebAuthn parameters.**

- `rp.id` is the request's hostname, checked against a pinned list, `ACCOUNT_RP_IDS`. The client
  data's `origin` is a scheme, host and port, so it is checked against its own pinned list,
  `ACCOUNT_ORIGINS` (`https://roaring-lions.pint12.workers.dev` today), and each origin's host must
  equal an `rp.id`. A hostname list cannot match an origin string.
  `rp.name` is "Roaring Lions".
- `user.id` is 16 random bytes, `member.user_handle`, and never the internal id.
- `residentKey: 'required'`, so sign-in needs no username.
- `userVerification: 'preferred'`, and `attestation: 'none'`.
- Algorithms ES256 (-7) and RS256 (-257). RS256 is for Windows Hello.
- Verification checks:
  - the client data's `type`, `challenge` and `origin` (exact, against `ACCOUNT_ORIGINS`);
  - the `rpIdHash`;
  - the UP flag;
  - the signature.
- A sign count of 0 is accepted, because synced passkeys report 0. A count that goes backwards
  from a non-zero value is refused, and the refusal is logged.
- A challenge is 32 random bytes. It is stored hashed in `auth_challenge` with a 5-minute expiry,
  consumed once, and swept by the daily cron.

**Steam parameters (web, OpenID 2.0).**

- **`POST steam/start`** takes a purpose: `steam-login`, or `steam-link` with a fresh session. It
  mints a challenge and sets a pre-auth cookie,
  `__Host-rl_pre=<32 random bytes>; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=300`, whose
  hash is stored on the challenge. It answers with the Steam URL:
  - `https://steamcommunity.com/openid/login`, with `openid.mode=checkid_setup`;
  - `openid.ns=http://specs.openid.net/auth/2.0`;
  - `identity` and `claimed_id` set to `http://specs.openid.net/auth/2.0/identifier_select`;
  - `openid.realm` set to the origin;
  - `openid.return_to` set to `<origin>/api/account/steam/return?c=<challenge>`.

  The client opens it in a popup on the click, and falls back to a full-page redirect. The guest
  keys are written before any prompt shows, so leaving the page loses nothing.
- **`GET steam/return` is the one account GET that writes.** It is a top-level navigation back
  from Steam, so it carries no `Origin` and no `SameSite=Strict` cookie. It requires all of these:
  - the challenge `c`, unexpired and unconsumed;
  - the `__Host-rl_pre` cookie, matching the challenge. It is `Lax`, so it arrives on this
    navigation. This stops login CSRF, where an attacker's finished Steam sign-in is replayed into
    a victim's browser;
  - `openid.return_to`, equal to the URL that was sent;
  - `openid.op_endpoint`, exactly `https://steamcommunity.com/openid/login`;
  - `openid.claimed_id`, matching `^https://steamcommunity\.com/openid/id/(\d{17})$`;
  - a `check_authentication` POST of the same fields to Steam, which must answer `is_valid:true`.

  It then consumes the challenge, resolves the `steam` identity, or makes a member (only while
  open), or links it (`steam-link`). It sets `__Host-rl_session`, clears the pre cookie, and
  answers 303 to `/`, or a close page in the popup. A `Strict` cookie can be set on this response;
  `Strict` governs only when it is sent.
- **Never fetched:** a persona name, an avatar or a friends list. `GetPlayerSummaries` is never
  called (test A1-10).

**Steam parameters (a Steam build, ST5).** `POST steam/ticket` `{ticket}` takes the hex ticket from
`GetAuthTicketForWebApi('roaring-lions')`. The Worker calls `ISteamUserAuth/AuthenticateUserTicket/v1`
with the secret `STEAM_WEB_API_KEY`, the app id and `identity=roaring-lions`. It requires
`result: 'OK'`, and reads `steamid`, never a SteamID sent by the client. Under Family Sharing the
member is `steamid`, the person playing, not `ownersteamid`. This resolves the same `steam` row
that the web route writes.

### 1.6 The recovery code (the passkey provider)

- **What it covers:** a lost passkey, and a browser or webview with no WebAuthn. It is shown once,
  as 20 Crockford base32 characters in five groups (100 bits of entropy). The player can copy it or
  save it as a file. The server stores only its SHA-256. Its entropy is too high to brute-force, so
  it needs no slow hash and no pepper.
- **When one is made.** One is made with the member's first passkey. A Steam-only member can make
  one from the profile ("Make a recovery code, in case you lose Steam"), but is never asked to.
- **A second passkey** ("Add this device") is one tap from the profile while signed in. This is the
  normal way onto a second device that does not share a passkey store.

**The handover: a lost response never leaves the player with neither code.**

1. A route that issues a code writes the new code's hash as a `recovery` identity in state
   `pending`, and returns the plaintext once. Three routes do this: `passkey/register/verify`,
   `recovery/login` and `recovery/rotate`. **None of them retires the `active` code.**
2. The pending code becomes `active`, and the old active code is deleted, in one batch, by either
   of two things:
   - `POST recovery/confirm {code}`, which the screen sends when the player presses "I have saved
     it", after copying it or saving the file;
   - the first sign-in with the pending code itself.
3. Until then, both codes sign in. If the response is lost, the old code still works. A retry of
   `recovery/login` with the old code replaces the pending row with a freshly minted code and
   returns that one. The lost code's plaintext was never stored, and its row is gone, so it is
   dead.
4. A pending code that is not confirmed within 7 days is deleted by the cron, and the active code is
   untouched. While one is pending, the profile shows "Your new recovery code is not confirmed",
   with "Make a new code".
5. **At registration** there is no old code, because the passkey is the way back in. A lost
   register response leaves a member with a passkey and a pending code. The register challenge is
   consumed once, so a blind retry fails. The client then signs in with the passkey, and the
   unconfirmed-code line appears.

What this keeps: a code still opens the account once. After a recovery sign-in, the code that was
used dies at confirm, or with the next sign-in on the new code. An attacker who holds the old code
gains almost nothing. The old code worked until the player used it, and it now works until the
confirm, usually a minute later and in the same session. If the player never confirms, the old code
is exactly as live as it was before the recovery began.

**No code is ever stored for a retry** (the `op_id` rule in §2.5). The three code-issuing routes
take no `op_id` and write no `account_op` row. Their retry safety is the single pending slot: a
retry mints a new code and never replays an old one. Test A1-5 searches every stored value for every
code issued.

### 1.7 Sessions

- **The cookie.**
  `__Host-rl_session=<32 random bytes, b64url>; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`.
  The `__Host-` prefix forbids `Domain` and forces `Path=/` and `Secure`. The `/stats` cookie stays
  separate, under its own path and its own secret.
- **Stateful, not signed.** The `/stats` session is a stateless HMAC, and it can be revoked only by
  rotating the password. An account must be revocable one session at a time (sign out, sign out
  everywhere, delete). So D1 holds `session(token_hash = sha256(cookie))`. A read costs one indexed
  `SELECT`, and D1 reads are plentiful.
- **Lifetime.** A session lasts 30 days from its last use and 180 days at most. The expiry is
  extended at most once a UTC day per session, so a busy player costs one row written a day.
  **When the expiry moves, the response re-sends `Set-Cookie` with a fresh `Max-Age`.** A cookie's
  own clock does not slide, so without it the browser drops the cookie 30 days after sign-in while
  the server still holds the session.
  There are at most 10 sessions per member; the oldest is evicted.
- **A fresh session** (`fresh_until`, 5 minutes after a passkey, Steam or recovery sign-in) is
  required for four things:
  - deleting the account;
  - linking an identity;
  - removing an identity;
  - making a new recovery code.

  Otherwise the screen asks the player to sign in again, through the `reauth` purpose for a
  passkey, or `steam-login` for Steam.

### 1.8 CSRF and the origin

Each layer stops the attack on its own.

1. **`SameSite=Strict`.** No cross-site request carries the cookie.
2. **The strict Origin rule** (`origin.ts`'s `originAllowed`, as `/api/feedback` and `/api/match`
   use it). Every non-GET `/api/account/*` request must carry an `Origin`, and it must be the
   Worker's own, or one listed in `ALLOWED_ORIGINS`. `/api/events`' laxer rule is not used.
3. **A non-simple request.** Every `/api/account/*` request, GET included, must send
   `content-type: application/json` (when it has a body) and `x-rl-account: 1`. A cross-site form
   or `sendBeacon` cannot set either header without a CORS preflight.
4. **No CORS, ever.** No account response carries `access-control-allow-*`, and `OPTIONS` answers
   405. A preflight therefore always fails.
5. **GET is read-only, with one named exception.** The export is a GET. It also requires the custom
   header, and it answers `application/json` with `nosniff`, so no other page can include it as a
   script. The exception is `steam/return` (§1.5). It is a top-level navigation from Steam, so it
   can carry neither header nor an `Origin`. It writes only after the one-time challenge, the `Lax`
   pre-auth cookie and Steam's own `check_authentication` have all passed.

The service worker already passes `/api/` through (`sw-policy`). A2 adds a test case for
`/api/account/`.

### 1.9 Rate limits

| Limit | Kind | Value | Why |
|---|---|---|---|
| `ACCOUNT_LIMIT` | binding, per connecting IP, namespace `1007` | 10 a minute | sign-in, registration, recovery and the challenges. The same as `/stats/login` |
| `ACCOUNT_OP_LIMIT` | binding, per connecting IP, namespace `1008` | 60 a minute | the signed-in routes: sync, victory, spend, slots |
| `acct-new-ip` | `rate_day`, keyed hash of the IP (the existing `ipKey`) | 5 new accounts a day | one household's testers |
| `acct-new-all` | `rate_day`, global | 500 new accounts a day | a breaker on the row budget |
| `acct-ops` | `rate_day`, per member | 400 writes a day | about 40 missions' worth; protects the day's rows from one script |
| `acct-all` | `rate_day`, global | 20,000 writes a day | keeps accounts under about a fifth of D1 Free beside telemetry's ~30,000 and the rooms' share |

Over a limit, the route answers 429 and writes nothing. A signed-in client then keeps its writes in
its outbox (§2.7) and tries again later. **An IP is never stored**, only the existing daily keyed
hash in `rate_day`.

---

## 2. Storage

### 2.1 A second D1 database

- **Recommended (L3): a new database, `roaring-lions-accounts`,** bound as `ACCOUNTS`, with its own
  `migrations_dir`, `packages/worker/migrations-accounts/`.
  - Telemetry is disposable and anonymous. Accounts are authoritative.
  - Keeping them apart makes "no join between telemetry and accounts" structural: no SQL
    statement can reach both.
  - A Time Travel restore of one never rolls back the other.
- **The cost.** The 100,000 rows a day on D1 Free is per Cloudflare account, not per database, so a
  second database adds no budget. Creating it, and applying each migration to production before
  merge, are lead steps.
- **The alternative** is the same database with a table prefix. It is one fewer lead step, but it
  loses the structural separation.

**The tables are named for a `member`** (a person who saved progress to the server). They are not
named for an `account`, because two things already use that word:

- the telemetry database's `accounts` table, GH-254's brigade-account snapshot;
- the app's `BrigadeAccount`.

`player` is the telemetry id's column name. Player-facing text says "account" and "profile".

### 2.2 Schema (migration `migrations-accounts/0001_members.sql`)

```sql
-- GH-1075. Applied to production by the LEAD before merge:
--   npx wrangler d1 migrations apply roaring-lions-accounts --remote
-- D1 enforces foreign keys; the delete path still deletes table by table (§6.4).

CREATE TABLE member (
  id            TEXT PRIMARY KEY,        -- 128 random bits, b64url; never leaves the server
  public_id     TEXT NOT NULL UNIQUE,    -- 8 Crockford base32 chars, shown beside the name
  id_hash       TEXT NOT NULL UNIQUE,    -- sha256(public_id): the tombstone's key (§6.4)
  user_handle   TEXT NOT NULL UNIQUE,    -- WebAuthn user.id: 16 random bytes, b64url
  created_at    INTEGER NOT NULL,
  last_seen_day INTEGER NOT NULL         -- floor(epoch ms / 86,400,000); retention (§6.3)
);

-- One row per way in (§1.3). A provider listed in the CHECK is added by code, never a migration.
CREATE TABLE member_identity (
  id            TEXT PRIMARY KEY,        -- 128 random bits, b64url; the route handle (DELETE identity/:id)
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('passkey', 'recovery', 'steam')),  -- A5 email, A6 OAuth: a rebuild in their phase
  subject       TEXT NOT NULL,           -- passkey: credential id; recovery: sha256(code); steam: SteamID64, decimal
  state         TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'pending')),  -- pending: a recovery code not yet confirmed (§1.6)
  public_key    BLOB,                    -- passkey only: COSE key
  sign_count    INTEGER NOT NULL DEFAULT 0,   -- passkey only
  transports    TEXT,                    -- passkey only: JSON array, as the browser reported it
  backed_up     INTEGER NOT NULL DEFAULT 0,   -- passkey only: the BS flag, a synced passkey
  label         TEXT,                    -- optional, typed by the player ("Laptop"); cleaned like a callsign
  created_at    INTEGER NOT NULL,
  last_used_day INTEGER,
  UNIQUE (provider, subject),            -- a SteamID or a passkey belongs to one member
  CHECK (state = 'active' OR provider = 'recovery')
);
CREATE INDEX member_identity_member ON member_identity (member_id);
-- At most one active and one pending recovery code, and at most one SteamID, per member.
CREATE UNIQUE INDEX member_identity_one_recovery ON member_identity (member_id, state) WHERE provider = 'recovery';
CREATE UNIQUE INDEX member_identity_one_steam ON member_identity (member_id) WHERE provider = 'steam';

CREATE TABLE session (
  token_hash    TEXT PRIMARY KEY,        -- sha256 of the cookie value; the value itself is never stored
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,        -- sliding, 30 days
  absolute_at   INTEGER NOT NULL,        -- created_at + 180 days
  fresh_until   INTEGER NOT NULL,        -- re-auth window (§1.7)
  last_seen_day INTEGER NOT NULL
);
CREATE INDEX session_member ON session (member_id);

CREATE TABLE auth_challenge (
  challenge_hash TEXT PRIMARY KEY,
  purpose        TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'reauth', 'add', 'steam-login', 'steam-link')),
  member_id      TEXT,                   -- set for 'reauth', 'add' and 'steam-link'
  pre_hash       TEXT,                   -- steam-*: sha256 of the __Host-rl_pre cookie (§1.5)
  expires_at     INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE profile (
  member_id     TEXT PRIMARY KEY REFERENCES member (id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,           -- 3-20 code points, the callsign cleaner (§5.3)
  show_record   INTEGER NOT NULL DEFAULT 0,   -- opponents see W-L only when 1 (L11)
  updated_at    INTEGER NOT NULL
);

-- The coins. One row, so a spend is one row written; the journal below is the history.
CREATE TABLE wallet (
  member_id     TEXT PRIMARY KEY REFERENCES member (id) ON DELETE CASCADE,
  free          INTEGER NOT NULL DEFAULT 0 CHECK (free BETWEEN 0 AND 1000000),   -- MAX_COINS
  paid          INTEGER NOT NULL DEFAULT 0 CHECK (paid = 0),   -- ST7 rebuilds this table to lift it
  earn          TEXT NOT NULL,           -- EarnRecord JSON: welcomed, campaignDone, backfilled, missions; reset-free empties it
  earn_lifetime TEXT NOT NULL,           -- the claim record (§3.2): every win and star ever credited; NOTHING lowers it
  entitlements  TEXT NOT NULL,           -- RoarWallet.entitlements JSON
  revision      INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);

-- Append-only. wallet.free = SUM(free_delta) for the member, always (test A2-8).
CREATE TABLE coin_journal (
  id            INTEGER PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('earn', 'backfill', 'claim', 'coupon', 'unit', 'tier', 'reset')),
  free_delta    INTEGER NOT NULL,
  paid_delta    INTEGER NOT NULL DEFAULT 0 CHECK (paid_delta = 0),
  detail        TEXT NOT NULL,           -- JSON: source, missionId, unitId, track, tier, couponIds, credits
  op_id         TEXT NOT NULL
);
CREATE INDEX coin_journal_member ON coin_journal (member_id, id);

CREATE TABLE coupon_use (
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  coupon_id     TEXT NOT NULL,
  at            INTEGER NOT NULL,
  PRIMARY KEY (member_id, coupon_id)     -- once per member, ever: a brigade reset does not reopen it
) WITHOUT ROWID;

-- The active campaign: the three keys a slot carries, as the client wrote them (trusted, §2.4).
CREATE TABLE campaign_state (
  member_id     TEXT PRIMARY KEY REFERENCES member (id) ON DELETE CASCADE,
  ledger        TEXT NOT NULL,           -- CampaignLedger JSON, through sanitiseLedger
  brigade       TEXT NOT NULL,           -- BrigadeAccount JSON, through migrateAccount
  tutorial_done INTEGER NOT NULL DEFAULT 0,
  bytes         INTEGER NOT NULL CHECK (bytes <= 262144),
  revision      INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE save_slot (
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  slot_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  saved_at      INTEGER NOT NULL,
  build         TEXT NOT NULL,
  origin        TEXT NOT NULL DEFAULT 'player' CHECK (origin IN ('player', 'claim', 'conflict')),
  body          TEXT NOT NULL,           -- SaveSlot JSON, through importSlot's validation
  bytes         INTEGER NOT NULL CHECK (bytes <= 262144),
  PRIMARY KEY (member_id, slot_id)       -- at most 12 'player' and, apart from them, 4 'claim'/'conflict' per member (§2.7)
) WITHOUT ROWID;

CREATE TABLE device_claim (
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  device_id     TEXT NOT NULL,           -- random, minted by the client at claim time
  at            INTEGER NOT NULL,
  result        TEXT NOT NULL,           -- JSON: coins credited, entitlements carried and not, slots made
  PRIMARY KEY (member_id, device_id)
) WITHOUT ROWID;

-- Idempotency: a write carries a client op id; a retry gets the first answer back.
-- The three routes that issue a recovery code take no op id and never write here (§1.6, §2.5).
CREATE TABLE account_op (
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  op_id         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  at            INTEGER NOT NULL,        -- swept after 30 days
  response      TEXT NOT NULL,
  PRIMARY KEY (member_id, op_id)
) WITHOUT ROWID;

-- Versus records (§5). Written by the MatchRoom only when at least one seat is a member.
CREATE TABLE match_record (
  code          TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER NOT NULL,
  map           TEXT NOT NULL,
  matchup       TEXT NOT NULL,
  win_mode      TEXT,                    -- @lions/net WIN_MODES, NULL for annihilation
  kit           TEXT NOT NULL,
  reason        TEXT NOT NULL,           -- @lions/net's ended/outcome reason, validated at write
  winner_seat   INTEGER CHECK (winner_seat IN (0, 1)),   -- NULL: a draw or a void
  ticks         INTEGER NOT NULL,
  build         TEXT NOT NULL,
  agreed        INTEGER NOT NULL CHECK (agreed IN (0, 1)),  -- 1: both seats agreed, or the room decided it
  PRIMARY KEY (code, started_at)
) WITHOUT ROWID;

CREATE TABLE match_seat (
  code          TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  seat          INTEGER NOT NULL CHECK (seat IN (0, 1)),
  member_id     TEXT REFERENCES member (id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('member', 'guest', 'bot', 'deleted')),
  side          TEXT NOT NULL,           -- the faction
  bot_label     TEXT,                    -- a bot preset's label (arena), never text a person typed
  PRIMARY KEY (code, started_at, seat)
) WITHOUT ROWID;
CREATE INDEX match_seat_member ON match_seat (member_id, started_at);

-- No tombstone table. A tombstone lives in Workers KV (ACCOUNT_TOMBSTONES), outside the
-- database a Time Travel restore rewinds: key 'tomb:' + member.id_hash, 90-day TTL (§6.4).

-- The lead's switches, as in the telemetry database. A missing 'accounts' row means CLOSED.
CREATE TABLE flags (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
```

**Sizes.**

- A campaign ledger is bounded by `ROSTER_CAP` (150 bodies, about 25 KB), plus `roster.lost`, which
  grows forever. That makes the 256 KB cap generous today. A write over the cap is refused with
  413, and the debrief says it was not saved, as a refused local write does now.
- D1's own row limit is 2 MB.
- A member at the caps (16 slots and the campaign, at 256 KB each) holds at most about 4.5 MB.

### 2.3 Which side is authoritative

| Data | Authoritative once signed in | How a write is checked |
|---|---|---|
| **Roar coins: balance, earn record, coin entitlements, coupon uses** | **The server.** | The server applies the rule itself (§2.4). The client's numbers are a display cache, replaced by every response. |
| Campaign ledger, brigade account (credits, credit unlocks, tiers), tutorial flag | The server's copy is the copy of record. Its content is **trusted from the client**, as today. | Shape (`sanitiseLedger`, `migrateAccount`), size, and a revision check (§2.7). |
| Save slots | The same. | `importSlot`'s validation, size, and a count cap. |
| Settings, hints, telemetry ids, the versus callsign, the renderer choice | **The device.** They are never synced. | None. This is the R-9 rule in `ledger-store.ts`: they are facts about the person and the device, not the campaign. |
| Guests (no account) | The device, exactly as today. | None. |

### 2.4 Why coins are server-validated and credits are not, yet

**What "localStorage cannot mint coins" means here.** Once an account exists, nothing the device
stores reaches the server balance. Editing `lions.roar` changes a display cache that the next
response overwrites. The routes take facts, never amounts:

- "I won mission M with S stars";
- "buy unit U";
- "redeem code C".

The server prices each fact with the same functions the app uses.

**What it does not mean, said plainly.** The campaign is a single-player sim that runs only in the
browser. The server cannot prove that a win happened. A forged request can claim wins, and the
earn table pays a claimed win as it would pay a real one. So the most a member can ever be paid is
the table's lifetime ceiling:

- 100 for the welcome;
- 10 for each of the 29 missions;
- 5 for each of 87 stars;
- 100 for completing the campaign.

That is **925 coins**, plus coupons. It is the same ceiling an honest player reaches by finishing
the campaign with every star. Three things keep that ceiling a ceiling:

1. **No transfer between members, ever.** There is no gifting, no trading and no merging of two
   accounts. Free accounts are cheap to make, so a per-member bound is only worth something if
   coins can never leave the member. Any later design that moves coins between members is a new
   design and needs the lead.
2. **Free coins open only what single player already opens** (wallet spec guard G3), and
   `networkView` never counts them (`net/coin-claim.test.ts`, `roar-wallet.test.ts`).
3. **`paid` is 0 by schema.** When ST7 opens real money, the paid half is the half that must be
   strictly authoritative, and it starts from a column that could not have been written.

Two cheap plausibility checks make a forged claim cost more than a script, without pretending to be
proof.

- **A start nonce.** A victory carries the `missionStart` op id the server issued when the mission
  began.
- **A floor.** The victory must arrive at least `minWinSeconds(M)` after that start: the fastest
  30-seed win in `pnpm playtest`, halved and committed as data.

Failing either check does not refuse the ledger write. It only withholds the coins, and the debrief
says nothing about it.

**Proof, later.** The sim is deterministic, so an uploaded command log could be re-simulated. On
Workers Free that cannot be done inline: there is 10 ms of CPU, and a 7-minute mission is 8,400
ticks. An offline audit can do it: a tool that re-simulates a sample of uploaded replays, using
the feedback replay's format. That belongs to ST6 (GH-205), not here.

**Credits stay trusted for now** (L5). Today they buy only single-player content, and a friend's
"bring your brigade" room is between friends. They need to be server-validated only when a
stranger's room reads them: matchmaking by brigade level (GH-687) or a public kit badge. The same
pattern then applies to `payMission`, which is already an improvement rule against a lifetime
record. The schema keeps the brigade account in its own column so that change is local.

### 2.5 Routes (`/api/account/*`)

The JSON shapes are given here in outline; the A1 and A2 plans give them in full.

| Route | Auth | Writes | Notes |
|---|---|---|---|
| `GET open` | none | 0 | `{open}` from `flags`. The menu chip reads it once a boot. |
| `POST passkey/register/options` | none | 1 | Refused while closed. Counts `acct-new-*`. |
| `POST passkey/register/verify` | challenge | about 10 | Makes `member`, a `passkey` identity, a `pending` recovery identity, `profile`, an empty `wallet` and a `session`. Answers with the recovery code ONCE (§1.6). No `op_id`. |
| `POST passkey/login/options`, `login/verify` | none / challenge | about 4 | Works while closed. |
| `POST steam/start` | none; fresh session for `steam-link` | 1 | Mints a `steam-*` challenge and the `__Host-rl_pre` cookie, and answers the Steam URL (§1.5). |
| `GET steam/return` | challenge + pre cookie + Steam's `check_authentication` | about 4; about 9 for a new member | The one account GET that writes (§1.8). Sign-in works while closed. A SteamID that belongs to no one makes a member only while open. A `steam-link` for a SteamID held by another member answers `identity_taken`. |
| `POST steam/ticket` | the Steam ticket | about 4 | ST5 only (§1.5). The same `steam` identity as the web route. |
| `POST recovery/login` | none | about 4 | Signs in, and writes a NEW `pending` code that it answers once. The `active` code stays valid until confirm (§1.6). No `op_id`. |
| `POST recovery/confirm` | session | 2 | `{code}`, the pending code. Makes it `active` and deletes the old one, in one batch. |
| `POST passkey/add`, `DELETE identity/:id` | session (fresh, to delete) | 2 | Refused if no identity that can sign in would be left (§1.3). |
| `POST recovery/rotate` | fresh session | 1 | Writes a `pending` code (§1.6). No `op_id`. |
| `POST logout`, `POST logout-all` | session | 1 or n | |
| `GET me` | session | 0 or 1 | Profile, wallet, revisions, slot list. |
| `GET state` | session | 0 | Campaign, brigade, tutorial flag, wallet, slot metadata. |
| `POST claim` | session | about 15 + slots | §3. Idempotent on `device_id`. |
| `POST mission/start` | session | 1 | Issues the start nonce (§2.4). |
| `POST victory` | session | about 6 | One D1 batch: campaign, wallet, journal, op. The mirror of `writeVictory`. |
| `PUT campaign` | session | 2; 3 on a conflict | A non-victory write, such as "New campaign", a brigade purchase or a reset. Carries the revision. A stale one answers 409, and the same batch stores the losing campaign as a `conflict` slot, or answers `held` when the system slots are full (§2.7). |
| `POST spend` | session | about 4 | `{item:'unit', unitId}` or `{item:'tier', unitId, track, tier}`. No price field exists. |
| `POST coupon` | session | about 4 | Matched against `data/coupons.json` server-side, once per member. |
| `POST reset-free` | session | about 3 | The brigade screen's reset (`resetFree`). It empties `wallet.earn` and never touches `earn_lifetime` (§3.2). Coupon uses stay. |
| `PUT slots/:id`, `DELETE slots/:id` | session | 1 | 12 player slots and 4 system slots, each counted at write (§2.7). |
| `PATCH profile` | session | 1 | Display name, `show_record`. |
| `GET matches` | session | 0 | The member's own history, paged. |
| `GET export` | session | 0 | §6.2. |
| `POST delete` | fresh session | many, plus 1 KV write | §6.4: the KV tombstone first, then one batch. **Works while closed.** |
| `POST gone` | none | 0 | `{idHash}` against the KV tombstones: 410 `{deleted: true}` or 404 (§6.4 step 5). **Works while closed.** |

**The `op_id` rule.**

- Every write carries `op_id`, a UUID from the client, and the server records it in `account_op`
  inside the same batch. A retry returns the first answer.
- **The exception: a response that carries a recovery code is never stored, so it is never
  replayed.** `passkey/register/verify`, `recovery/login` and `recovery/rotate` take no `op_id` and
  write no `account_op` row. Their retry safety is the pending slot (§1.6): a retry mints a new
  pending code, and the lost one dies with the row it replaces. `account_op.response` therefore
  never holds a code, and test A1-5 searches it.
- **D1's `batch()` is one transaction**, so a victory's campaign, wallet and journal rows land
  together or not at all. That gives the all-or-none guarantee `writeVictory` gives locally.

### 2.6 One set of coin rules, shared

`roarEarn`, `roarBackfill`, `grantFree`, `buyUnitWithCoins`, `buyTierWithCoins`, `resetFree`,
`migrateRoar`, `coinPrice`, `storeItems`, `campaignComplete` and `redeemCoupon` are pure today, but
they live in `packages/app`, which the Worker must not import.

**A0 moves them, byte for byte, into a new leaf package, `@lions/economy`** (L9). It imports
`@lions/data` and only types from `@lions/sim`. The app and the Worker both import it. Their tests
move with them. The app keeps thin re-exports, so no caller changes. A copied rule is the failure
this prevents: a server that pays by a table the app no longer shows.

A0 also splits the difference loop out of `roarBackfill` into a pure
`earnDifference(record, evidence, world) -> {coins, record}`. `roarBackfill` calls it and returns
the same wallet, byte for byte, so its tests pass unchanged. The server's claim calls it against
`earn_lifetime` (§3.2).

### 2.7 The client: a server-backed `LedgerStore`

`ledger-store.ts` is the one door to the save. ST6 was always meant to swap what sits behind it.
It is synchronous, and it stays synchronous.

- **`accountLedgerStore`** implements `LedgerStore` over a local **cache**, a single key
  `lions.account.cache` (`{version: 1, publicId, revision, walletRevision, ledger, brigade,
  tutorial, wallet, slots}`), plus an **outbox**, `lions.account.outbox`.
  - Reads answer from the cache, so every screen stays synchronous.
  - Writes update the cache, append an op, and flush in the background.
- **The cache is the server's last answer, plus the outbox replayed on top.** It holds `confirmed`,
  the state from the last response. What the screens read is `confirmed` with every op still in the
  outbox re-applied in order, by the same pure functions that applied it the first time. The
  server's numbers win, but only for what the server has seen.
  - The outbox sends **one op at a time, oldest first**. A response acknowledges exactly the op it
    answers. That op leaves the outbox, `confirmed` becomes the response's state, and the view is
    rebuilt from it plus the ops still queued. **An op appended while a request was in flight
    survives the response** (test A2-17).
  - `PUT campaign` takes its base revision when it is SENT, from `confirmed.revision`, not when it
    is queued. So a device's own earlier write never makes its next one stale, and a 409 always
    means another device wrote.
  - Queued campaign writes that sit next to each other coalesce into the last one, because each
    carries the whole campaign.
  - A queued victory's coins re-apply as provisional until it is acknowledged. Coin Buys are never
    queued (they wait, below).
- **Victory.** The debrief shows the provisional award from the same `roarEarn`. It reads "Saved
  to your account" once the server answers, or "Saved on this device, will sync" while it is
  offline.
  - If the server pays differently, the cache takes the server's figure, and the coin line
    updates in place.
  - A provisional award is never presented as final.
- **Spending needs the server.** A Buy with coins waits for `POST spend` (the button shows its
  pending state), because an entitlement handed over and then revoked is worse than a short wait.
  Offline, coin Buys are disabled with a reason line. Credit purchases, which are trusted, work
  offline and sync as a `PUT campaign`.
- **A conflict never loses a campaign.** If two signed-in devices write, the stale write gets 409.
  - **The server keeps the losing campaign, in the same batch as the 409.** It stores it as a slot
    with `origin: 'conflict'` ("From this device, 7 Nov 18:40"), and the 409 names that slot. The
    client adopts the server's campaign only after it has that answer, so there is no moment when
    the device's campaign exists nowhere.
  - **The slot caps.** A member holds at most 12 player slots and, apart from them, at most 4
    system slots (`origin` `claim` or `conflict`). A conflict or a claim never takes a player slot
    and never evicts anything.
  - **When the 4 system slots are full,** the 409 says `held` and stores nothing. The client first
    writes its campaign into `lions.account.local`, the "On this device only" list, and only then
    adopts the server's campaign. The Saves screen lists the held campaign with a reason line
    ("Free a slot to keep this on your account") and Export. When a slot frees, the client uploads
    it as a `conflict` slot, and removes it from the list only once the server's digest matches.
    If that local write is refused (storage blocked), the held campaign stays in memory for the
    page's lifetime, the screen says so, and Export is offered at once.
  - Coin ops never conflict: each one is a fact the server re-prices.
- **Off switch.** It mirrors telemetry's.
  - The account client makes **no request** from `pnpm dev`, tests or CI unless `?accounts` is on
    the URL. It is live only in a production build on a real host.
  - This is also what keeps `pnpm ui:routes` and the golden gate free of console errors.
  - `?fresh` boots the page as a guest and never reads or writes the server, so a test that uses
    it can never touch a member.
- **Storage guarded.** `lions.account` (the device binding), the cache and `lions.account.local`
  are read through the same guarded access as every other key. When storage is blocked, a signed-in player still plays
  from memory for the page's lifetime; a reload re-reads `GET state`.

---

## 3. Migration: the claim

### 3.1 What a claim carries

A claim is built by `account/claim.ts` from `LedgerStore` reads, and nothing else:

- the active ledger, brigade account and tutorial flag (`snapshotCampaign`, parsed);
- the slots (`readSlotsRaw`);
- the wallet (`readRoar`), including its `earn` record, its entitlements and its coupon receipts;
- the coupon ids in the brigade account;
- a `device_id`, minted once and kept in `lions.account`.

Before the claim, the screen offers "Download a copy first", which uses the existing slot export.

### 3.2 What the server does with it (one transaction)

1. **Idempotency.** If `device_claim(member, device_id)` exists, the stored `result` is returned
   and nothing else happens.
2. **Earn, by the back-payment.** The server builds a lifetime record from the device's evidence:
   - the wallet's `earn.missions`;
   - the active ledger's `campaign.completed_missions` and `campaign.mission_results` stars;
   - every slot ledger's.

   Each is clamped as `roarBackfill` clamps: 0 to 3 stars, and world missions only, so the
   tutorial pays nothing. It then runs **`earnDifference` (§2.6) against the member's claim
   record, `wallet.earn_lifetime`**, and never against `wallet.earn`:
   - `earn_lifetime` holds, per mission, the best `won` and `stars` ever credited to the member by
     any route (victory or claim), plus `welcomed` and `campaignDone`. Every victory and every claim
     raises it to the maximum. **Nothing lowers it.** `reset-free` empties `wallet.earn`, as the
     local `resetFree` does, and leaves `earn_lifetime` alone.
   - The claim pays only the difference between the evidence and `earn_lifetime`: a first win only
     where `won` is false there, stars only above the best held there, and the welcome and the
     campaign bonus once each. It then raises both `earn` and `earn_lifetime` to the maximum of
     themselves and the evidence.

   **Why not `earn.backfilled`, as the first draft said?** Checked against main (`roar-wallet.ts`,
   `roar-earn.ts`): `resetFree` writes
   `earn: {welcomed: false, campaignDone: false, backfilled: true, missions: {}}`, and
   `roarBackfill` itself has no `backfilled` guard. Only `loadRoar` reads the flag, and only to
   decide whether to call it. A claim run against `wallet.earn` after a reset would find an empty
   record, and a second device's claim would re-pay every win its ledger holds. The flag is not a
   claim record, so the server keeps one of its own.

   **The bound this keeps.** Since a member's last reset, the free coins credited never exceed
   925 plus coupons, the earn table's ceiling (§2.4), however many devices claim. `earn_lifetime`
   is never below `earn`, so a claim pays at most what raising `earn` to the evidence is worth.
   A victory after a reset still pays against the emptied `earn`, exactly as it does locally:
   replaying a mission after a reset earns again, which is the point of a reset. A claim never
   does, because a claim is evidence, not play (test A2-20).
3. **Coupons.** Each coupon id the device has used is checked against `data/coupons.json`, inside
   the Worker. It is credited once per member (`coupon_use`), and only for the coins its entry
   grants.
4. **Coin entitlements.** The device's coin-bought units and tiers are carried in receipt order.
   Each is charged at today's `coinPrice` against the coins credited so far. One the balance cannot
   cover is listed as "not carried" in the result, with the reason.
5. **The ceiling.** The balance credited is
   `min(device coins.free, earned + coupons - charged)`.
   - The device's own balance is read only as a ceiling, so an honest device that spent coins is
     not over-credited.
   - A forged balance is never more than the rules allow (test A2-3).
   - `coins.paid` is ignored. It is 0 on every honest device, because `migrateRoar` clamps it.
6. **The campaign and the slots. Every input is accounted for.** The result lists the device's
   campaign and each of its slots, by the device's own slot id, as either `stored` (with the new
   server id and a digest) or `rejected` (with a reason: `cap`, `size` or `invalid`).
   - If the member has no `campaign_state` yet, the device's becomes it.
   - If it has one (this is a second device), the device's campaign is saved as a system slot with
     `origin: 'claim'` ("From another device, <date>"), and the member's stays active. The player
     can load it from the Saves screen. If the 4 system slots are full, the campaign is `rejected:
     cap` like a slot, and the member's campaign stays active.
   - Device slots are stored as player slots under new ids, newest first, while the 12 cap allows.
     The rest are `rejected: cap`. Nothing already on the server is evicted.
7. **Records.** One `coin_journal` row of kind `claim` (or `backfill` for the first), the
   `device_claim` row with its result, and an `account_op` row.

### 3.3 After the claim, on the device

The response carries the inventory of step 6, with a SHA-256 digest of each blob the server
stored. The client compares the digests with its own, and checks that every campaign and slot it
sent is in the inventory, stored or rejected.

- **Rejected items are kept first.** Before any guest key is removed, every `rejected` slot, and a
  rejected claim campaign, is copied byte for byte into `lions.account.local`, the "On this device
  only" list (§2.7). Only after that write succeeds may `lions.saves` go. The Saves screen lists
  them, with the reason, Export, and "Save to my account" once a slot frees. If the write is
  refused, nothing is removed, the claim is retried later (step 1 makes that harmless), and the
  screen offers Export of the rejected slots at once.
- **If every stored digest matches, the inventory is complete and the rejected items are kept,**
  it removes the five guest keys:
  - `lions.campaign.ledger`,
  - `lions.brigade.account`,
  - `lions.tutorial.done`,
  - `lions.saves`,
  - `lions.roar`.

  It then writes `lions.account` (`{version: 1, publicId, deviceId, claimedAt}`), and the
  server-backed store takes over. The progress has **moved**, once.
- **If any digest differs, an item is missing from the inventory, or the response never comes,**
  nothing is removed. The claim is retried later under the same `device_id`, which step 1 makes
  harmless.

Signing out removes the cache. The device is then a guest with no campaign. It never falls back to
the pre-claim keys, so there is no stale copy to claim into a second account. `lions.account.local`
stays, because it is on no server, and signing out offers its Export first.

### 3.4 Two devices that both hold progress

- **Coins merge by difference.** Device B's claim pays only for wins and stars that device A's
  claim, and the member's later play, have not already paid. Two devices that each finished the
  same missions are paid once. This is the improvement rule, applied across devices.
- **Coin entitlements from B** are carried while the balance covers them (step 4). In the worst
  case two devices spent the same lifetime coins on different units, and B's are listed as not
  carried. This is rare (two devices, both played through, both spent), and the list says why.
- **The campaign from B becomes a slot** and never overwrites A's (step 6). Credits ride inside that
  slot, as a slot's brigade account does today. Loading it is the player's choice, and it behaves
  as a slot load does now.
- **The alternative (L6)** is to refuse a second claim, and offer B only a file export of its
  progress. It is simpler, but it throws away B's coins for missions only B won.

### 3.5 Why this cannot double-pay

The claim record, `earn_lifetime`, is per member, every coin credit raises it, and nothing lowers
it. The device id, the digest and the op id each stop a retry, but none of them is what stops
double pay. The claim record does. So a claim still finds the difference already paid when it
comes from a cleared and re-imported device, from a third browser, after a brigade reset, or
replayed by hand. Test A2-2 falsifies this by running the back-payment against an empty record
instead, and A2-20 by running it against `wallet.earn`, which a reset empties.

---

## 4. Guest play

**Unchanged.** A guest's game reads and writes the same keys, through the same `LedgerStore`,
with the same `?fresh` rules. The same coins are earned locally under the wallet spec's guards.
No request is made to `/api/account/*` except the one `GET open` that decides whether the menu
shows the entry point. That request is also skipped under the off switch.

### The "Save your progress" prompt

- **Where it can appear.**
  - Never before the first campaign victory.
  - Never in the tutorial, in a mission, in the versus lobby, or over the pause menu.
- **When.** It is an **inline line on the debrief**, with one button, "Save your progress", and
  one link, "Not now". It is not a modal. It can appear at three moments only:
  - the first campaign victory;
  - the first completed town;
  - the campaign's completion.

  That makes **at most three times ever**. "Not now" counts as one. "Don't ask again" stops it for
  good.
- **What it remembers.** It keeps its own key, `lions.account.prompt` (`{version: 1, shown, never}`),
  outside `lions.settings`, which stays the settings module's alone. With storage blocked, it
  appears at most once per page load. Blocked storage is the case where progress is most at risk,
  so it is not suppressed.
- **The quiet way in.** It is always there and never animated: a profile chip in the main menu
  ("Save your progress" for a guest, the display name when signed in), and a line on the Saves
  screen.
- **What the copy says.** It names the gain, "Keep your campaign and Roar coins if you change
  device or clear this browser", and that no email is asked for. Every string goes through `t()`
  and `pnpm validate:ui`.
- **What it leaves alone.** Saying no changes nothing, and earns or costs no coins. There is no
  countdown, no badge and no "you will lose your progress" warning.

---

## 5. Versus and arena records

### 5.1 How a seat becomes a member's

Today `POST /api/match` and `/api/match/:code/join` take `body.player`, the anonymous
`lions.versus.player` UUID, and sign it into the seat ticket. Anyone can send any string.

- **With accounts,** the route also reads `__Host-rl_session`. These are same-origin fetches, so
  the cookie travels, and `SameSite=Strict` holds.
- **If the session is valid,** the ticket gains `member: <public_id>`, and the room keeps it in the
  seat's config. **The body's `player` is never trusted as a member.** A body that names someone
  else's public id is ignored (test A3-2).
- **A seat with no session** is a guest, exactly as today. A seat whose client asserts
  `kind: 'bot'` (the arena and `pnpm bot`, which run from Node with no cookie) is a bot.

### 5.2 Which results are recorded

The room records a result in the accounts database only when **at least one seat is a member**,
and only a result the server can stand behind. This reuses the matchmaking spec's P0 rule
(`2026-10-28-public-matchmaking-design.md` §1.3):

- **A result the room decided itself** (`surrender`, `forfeit`, `left`) names the seat. It is
  recorded with `agreed = 1`.
- **A result decided in the clients** (annihilation, a win mode, a stalemate, the cap) is recorded
  only when both seats send the same `over{tick, result}`, and the hash at or before that tick
  agreed. Two honest lockstep sims always agree. A modified client can void a match, but it cannot
  win one by lying.
- **One-sided reports** (the other seat gone before it reported) are recorded with `agreed = 0`.
  They show in the member's history as "unconfirmed", and they never count in a W-L.
- **Coins.** Versus pays 0, as the wallet spec ruled. A record never touches the wallet (test A3-7).
  Agreed records are the prerequisite for any later versus pay. That is the lead's call, not this
  spec's.

If matchmaking P0 has not landed by A3, A3 builds `over{tick, result}` itself, to that spec's
tests. The telemetry database's `match_result` (for `/stats`) and this table are written by the same
room code path, so they cannot disagree.

### 5.3 What each kind of opponent shows

| Opponent | In the lobby and the match (live) | In history (stored) |
|---|---|---|
| **Member** | display name and public id ("Ilan · K7Q2"); W-L if their `show_record` is on | display name as it is NOW (a rename follows), and the result |
| **Guest** | their callsign, as today, with a small "Guest" tag | **"Guest"**. The callsign is not stored: it is typed by a person and may be a real name (the matchmaking spec's §3.3 rule) |
| **Bot** (`kind: 'bot'`) | "Bot", plus the preset label when the arena gives one ("Sonnet 5.5") | "Bot · <label>" (`bot_label`, a preset's text, never typed by a player) |
| **Deleted member** | n/a | "Deleted player". The seat's `member_id` is set to NULL and its kind to `deleted`. The match stays in the other member's history |

A display name is cleaned by the callsign cleaner (`@lions/net`'s `cleanCallsign`: NFKC, control and
format characters dropped, capped by code point), is 3 to 20 code points, and is not unique. The public id
tells two people apart. The lead can blank a name from `/stats` (A3). Moderation beyond that is out
of scope.

### 5.4 Arena records

- **A human against a bot** (`pnpm bot`, as in GH-973's room KNNK5Z) is a versus match. The human's
  seat records to their profile, against "Bot · <model>".
- **Bot against bot** (`pnpm arena`, GH-954) attaches to no member's W-L. Its results stay where
  they are: `data/arena/results.json`, published by the lead (D-P2), and `/arena-results`.
- **When W4's public arena exists,** the member who set a match up sees it under an "Arena" tab of
  their own profile, as the operator, not as wins. That is W4's design to confirm.

### As built in A3

The code follows `docs/superpowers/plans/2026-11-11-accounts-a3.md`, whose section 0 lists where it departs from this
section. In short:

- **The ticket does not gain `member`** (section 5.1). The Worker hands the cookie's member to the room in its own
  room request, and the room keeps it in its meta. Member labels travel in the `lobby` message only and never in
  `MatchConfig`, so a public id or display name cannot reach the desync log, a replay or a feedback report.
- **`over` carries `{tick, result}`** (matchmaking P0's rule, built here). The telemetry `match_result` of section 5.2
  is not written: it is P0's, and must take its result from the same `recordOf` draft.
- **Agreed also means a compared hash** within one cadence of the result tick. Matching reports with no compared hash
  record nothing, and the room ignores an `over` whose tick is not a hash-window tick (PR 1280). A lone report is stored
  `agreed = 0`.
- **W-L counts every agreed result**, guests and bots included (lead ruling, 11 Nov); the two-tab risk is accepted.
- **`match_seat.bot_label` now holds the model the bot's operator declared**, `id:<listed id>` or `other:<typed name>`,
  a label only. **The column comment in `0001_members.sql` ("a bot preset's label (arena), never text a person typed")
  is therefore stale.** The file is not edited: A3 adds no migration and no binding. The lead can blank a typed name from
  `/stats`.
- **The public id is shown whole** (8 characters), not four. The history page cursor is the string
  `<started_at>.<code>`.

---

## 6. Privacy

### 6.1 What is stored, and what is not

**Stored, per member:**

- a random internal id, a random public id and a random WebAuthn user handle;
- the display name the player typed;
- passkey public keys with their counters, transport hints and an optional label;
- the hash of the recovery code, and of a pending one (§1.6);
- **the SteamID64, for a member who signs in through Steam.** It is a public identifier that
  resolves to the player's Steam profile, so it is personal data, and the privacy page names it. It
  is shown to no other player, it is never sent to telemetry, and it is never written to a match
  record;
- session token hashes, with day-granular times;
- coins, the earn record, coin entitlements, the coin journal and coupon uses;
- the campaign ledger, the brigade account and the slots. Soldier names in these are generated by
  the game, not typed by a person;
- versus records, with the member's seat and their opponents' kinds;
- the claim results.

**Never stored:**

- email, phone, a real name, an IP address (only the existing daily keyed hash in `rate_day`), a
  user agent, a location or `request.cf` data;
- a guest's callsign or UUID;
- a Steam persona name, avatar, friends list or session ticket;
- the recovery code itself, including in `account_op` (§2.5);
- the session cookie's value.

**Telemetry stays anonymous and unlinked** (L10).

- No telemetry event, feedback context or `/stats` query carries a member id, a public id, a
  display name or a session.
- The telemetry `player` id and the member are never joined. The second database makes the join
  impossible in SQL, and test A1-10 makes it impossible in the payloads.
- `/stats` may show an aggregate, such as members created per day, read from the accounts database
  as a count.
- This reverses the 24 Sep spec's aside that "a Supabase account can later be linked to the
  anonymous telemetry id". Linking would turn anonymous play data into personal data, for no
  question the lead has asked.

### 6.2 Export

`GET /api/account/export` answers one JSON document. Every table that holds the member is listed
in `EXPORT_MAP` (§7, test A1-8):

- profile;
- identities, as metadata only (provider, label, created, last used, synced). A SteamID is
  included in full, because it is the player's own. No key bytes and no code hashes;
- sessions, as created and last-seen days;
- wallet, journal and coupon uses;
- campaign, brigade and slots, in the formats the game imports;
- matches;
- claims.

The profile screen offers it as a file download: "Download my data".

### 6.3 Retention

| Data | Kept |
|---|---|
| Member and everything attached | While the member uses the account. **After 36 months with no sign-in, the daily cron deletes it** through the same delete path (L8). |
| Sessions | 30 days idle, 180 days at most. Expired rows are swept daily. |
| Challenges | 5 minutes. Swept daily. |
| A pending recovery code | 7 days unconfirmed, then swept. The active code is untouched (§1.6). |
| `account_op` | 30 days. |
| Tombstones | 90 days, which is longer than D1 Time Travel's 30. Held in Workers KV with a 90-day `expirationTtl`, never in the accounts D1 (§6.4). |
| Match records | While either seat is a member. A record whose seats are all deleted or guests is deleted. |
| `rate_day` | As today: older than yesterday is swept. |

### 6.4 Deletion

1. **The player asks for it.** "Delete my account" is on the profile screen. It needs a fresh
   session (a passkey, Steam or recovery sign-in within 5 minutes), and it asks for the confirmation
   "This cannot be undone". It offers "Download my data" first.
2. **The tombstone is written first, out of band.** The Worker writes
   `tomb:<member.id_hash>` = `{deletedAt}` to the KV namespace `ACCOUNT_TOMBSTONES`, with a 90-day
   `expirationTtl`. KV is a separate store, so a D1 Time Travel restore cannot rewind it. If the KV
   write fails, nothing is deleted and the route answers 503, so a deletion can never exist without
   its tombstone.
3. **Then the server deletes,** in one D1 batch, table by table through `DELETE_MAP`, without
   relying on the foreign-key cascade alone:
   - every session, identity and challenge;
   - wallet, journal, coupon uses, campaign, slots, claims and ops;
   - the profile and the member.

   Match seats are set to `member_id NULL, kind 'deleted'`. Match records left with no member seat
   are deleted. If the batch fails after the KV write, the client retries. The daily cron also
   finishes any delete whose tombstone exists while its member does: it lists the `tomb:` keys and
   runs `DELETE_MAP` for each matching `id_hash`. A tombstone with a live member is always a delete
   that did not finish, and finishing it is what the player asked for.
4. **This device** removes the cache, the outbox and `lions.account`, and boots as a fresh guest.
   It offers to keep a local copy of the campaign as guest data: the default is no, and the
   download in step 1 is the recommended way to keep one.
5. **Other devices** get 401 on their next request. A device that held a session then asks
   `POST /api/account/gone` (no auth) with `{idHash: sha256(publicId)}`, the `publicId` it keeps in
   `lions.account`. The Worker reads KV and answers 410 `{deleted: true}` if a tombstone matches, and
   404 otherwise. A public id is 40 bits and is already shown beside the name, so its hash reveals
   nothing a stranger could not already read.
   - **On 410,** the device clears its cache and outbox and says, through `t()`, that the account
     was deleted. It does not re-upload its outbox.
   - **On 404,** the device cannot tell an expired session from a deletion older than the 90-day
     tombstone, so it assumes neither. It becomes **signed out**. It keeps its cache and outbox,
     read-only and bound to that `publicId`, uploads nothing, and the menu says "Signed out. Sign
     in to keep syncing". If the player signs in to the same `publicId`, the outbox flushes as
     usual. If they sign in to a different member, or there is no such member any more, the device
     never uploads into it. It offers the same choice as step 4: keep the progress as guest data
     (default no), or remove it. KV's eventual consistency is the same case: a 404 read seconds
     after a delete leaves the device signed out, and its next boot asks again.
6. **Restores.** If the lead ever restores the accounts database from Time Travel, the re-apply
   script (`tools/accounts-reapply-tombstones.mjs`) runs before the switch reopens. **It reads the
   tombstones from KV, never from the restored database.** For each `tomb:` key it runs
   `DELETE_MAP` for the member whose `id_hash` matches. Every deletion a restore could revive is at
   most 30 days old, so its 90-day tombstone is still in KV. The runbook says so (test A4-5).
7. **Telemetry from this device (optional).** A checkbox, "Also delete this browser's anonymous
   play statistics", sends this device's telemetry `player` id in the same request. The Worker
   deletes the `event_batch`, `events`, `players`, `accounts` and `feedback` rows for that id. The
   id is used once and never stored beside the member.

**The account switch never blocks deletion or export.** Both work while `flags.accounts` is closed,
and they work with any closed switch the lead adds later (test A4-3).

### 6.5 What the lead must provide (marked LEAD in §7)

- **A privacy page,** linked from the menu and from the "Save your progress" prompt. It covers:
  - what is stored and why (§6.1);
  - the lawful basis, which is providing the service the player asked for;
  - retention (§6.3), export and deletion;
  - that telemetry is anonymous and unlinked, and how to opt out (`?notrack`, GPC, DNT);
  - a contact;
  - a minimum age.

  This spec drafts the text in A4. Publishing it is the lead's.
- **The telemetry consent gate** decided on 24 Sep, "(a) a menu notice before public launch", is
  due at the same moment, A4. One notice can serve both.

---

## 7. Rollout

Each phase is shippable and leaves `main` green. Every test is listed with the **input that makes
it fail**. Each one is run red once, and its falsification goes in the commit message (CLAUDE.md,
"Every check gets an input that makes it fail"). An implementing plan per phase follows this
spec's approval.

### A0: shared coin rules (about 1.5 agent-days, no behaviour change)

- Move the pure functions of §2.6 into `packages/economy` (`@lions/economy`). The app re-exports
  them, and the Worker gains the dependency, used by nothing yet.

| Test | What it pins | Input that makes it fail |
|---|---|---|
| A0-1 | The moved tests pass unchanged, and `pnpm test:determinism` is untouched | Change one earn literal in the moved module (`EARN.star` 5 to 6): `roar-earn` tests go red |
| A0-2 | One copy of the rules: no file under `packages/worker` or `packages/app` declares the earn table or `coinPrice` (a source scan for the declarations) | Paste a copy of `EARN` into `packages/worker/src/account/` |
| A0-3 | `@lions/economy` imports nothing from `app`, `render` or `worker` (eslint `no-restricted-imports`) | Add `import { t } from '@lions/app/...'` |
| A0-4 | `roarBackfill` is `earnDifference` plus `grantFree`: the moved `roarBackfill` tests pass unchanged, and `earnDifference` on a record that is `welcomed` and holds mission 1 at 1 star, with evidence of missions 1 and 2 at 2 stars each, pays the literal 5 + 10 + 10 = 25 | Make `earnDifference` pay every held star again instead of only the stars above the held best |

### A1: the identity core and the first provider (L1); export, delete; the switch closed

About 4.5 agent-days with Steam first (the recommendation), or about 6 with the passkey first.

- **The core, whichever provider is first:** `member`, `member_identity`, sessions, CSRF, logout,
  `me`, `export`, `delete`, `gone`, `open`, identity link and unlink, the migration, the cron sweeps
  (including the KV reconcile of §6.4), the rate limits, and the `ACCOUNTS` and
  `ACCOUNT_TOMBSTONES` bindings.
- **The first provider's route group.** Under S, Steam OpenID: `steam/start` and `steam/return`.
  Under P, the passkey: register, login, add, and the recovery code with its handover (`recovery/*`).
  The other provider is "the second provider" in the Later list below. Rows marked **[Steam]** or
  **[passkey]** are built with that provider, in whichever phase it lands.
- App: the profile screen and the chip, behind `?accounts` until A4. No progress sync.
- **LEAD:**
  - decide L1;
  - only if the passkey is first: decide the hostname that will carry passkeys (L2). The 7 Nov
    ruling holds A1 until L2 either way, until the lead lifts it;
  - create `roaring-lions-accounts` and put its id in `wrangler.jsonc`;
  - create the KV namespace `roaring-lions-account-tombstones` and put its id in `wrangler.jsonc`;
  - apply `0001_members.sql` with `--remote` before merge;
  - add the two rate-limit namespaces.

  **No secret is needed.** Steam OpenID is keyless.

| Test | What it pins | Input that makes it fail |
|---|---|---|
| A1-1 | Cookie flags: `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no `Domain` | Drop `HttpOnly` from the cookie builder |
| A1-2 | CSRF: a POST with `Origin: https://evil.example`, with no Origin, or without `x-rl-account` answers 403 and writes 0 rows | Use `/api/events`' lax origin rule (null allowed) |
| A1-3 | No CORS: no `/api/account/*` response carries `access-control-allow-origin`; `OPTIONS` answers 405 | Add `access-control-allow-origin: *` to the JSON helper |
| A1-4 | **[passkey]** WebAuthn verify refuses: a wrong origin, a wrong challenge, a reused challenge, a wrong `rpIdHash`, UP clear, a bad signature, a counter going backwards. A software authenticator in the test (a Web Crypto ES256 key) signs the fixtures | Remove each check in turn: seven mutations, seven reds, counts in the commit |
| A1-5 | **[passkey]** The recovery code is never stored or replayed. `passkey/register/verify`, `recovery/login` and `recovery/rotate` are each run once, then retried with the same `op_id` and with the first response dropped. Every bound SQL value the test D1 records, `account_op.response` included, and every log line, is searched for every code literal issued, and each retry answers a NEW code | Two mutations, two reds: store the code instead of its hash; store the route's response in `account_op` and replay it on the retry |
| A1-6 | Revocation: after `logout-all`, the old cookie gets 401 | Replace the session table with a signed stateless cookie (the `/stats` pattern) |
| A1-7 | Account-creation ceilings: the 6th from one IP key in a day, and the 501st overall, answer 429 | Change `n < cap` to `n <= cap` in the check |
| A1-8 | Export and delete cover every table: the test reads the migration's `CREATE TABLE` names, and every table with a `member_id` column must appear in `EXPORT_MAP` and `DELETE_MAP` | Add a table to the migration without mapping it |
| A1-9 | Delete leaves zero rows for the member in every table (walked from the same list) and writes one KV tombstone | Leave `coin_journal` out of `DELETE_MAP` |
| A1-10 | Telemetry is unlinked: with a signed-in state holding a sentinel public id, display name, token and SteamID, every telemetry builder's output, the feedback context, the `match_seat` rows and the opponent's lobby message are searched for all four, and the test's fetch stub records no `GetPlayerSummaries` call | Two mutations, two reds: add `member: publicId` to the boot event; add `steamId` to the seat config |
| A1-11 | Off switch: booting under jsdom without `?accounts` makes zero `/api/account` fetches | Remove the `?accounts` and production gate |
| A1-12 | A throwing storage: `lions.account` and `lions.account.prompt` reads fall back to guest with no throw | Remove the `try` around the property access |
| A1-13 | Closed means closed: with no `flags.accounts` row, `register/options`, and a `steam/return` for an unknown SteamID, make no member (404), while sign-in for an existing identity, `export` and `delete` work | Read a missing row as open (the feedback default) |
| A1-14 | A valid origin passes and a wrong scheme, host or port fails against `ACCOUNT_ORIGINS`, while the same host with the wrong port still has a valid `rp.id` | Compare the origin to `ACCOUNT_RP_IDS` |
| A1-15 | A session whose expiry moves answers with `Set-Cookie` carrying a fresh `Max-Age`; one that does not move sends none | Drop the `Set-Cookie` on the slide |
| A1-16 | After delete, `POST gone` with `sha256(publicId)` answers 410 and with an unknown hash 404, with the switch closed | Key the tombstone by the internal member id |
| A1-17 | **[passkey]** The recovery handover. Drop the response of `recovery/login`: the old code still signs in, a retry issues a fresh pending code, and the dropped one fails. `recovery/confirm` with the new code retires the old one (it now fails). In a second run, a sign-in with the pending code retires the old one too. A pending code older than 7 days is swept, and the active one still signs in | Retire the active code inside `recovery/login`, as the first draft did |
| A1-18 | Linked providers: a member with a Steam identity and a passkey reaches the same member through either one. A `steam-link` for a SteamID that belongs to another member answers `identity_taken` and changes no row in either member. Removing the last identity that can sign in is refused, and a pending recovery code does not count as one | Three mutations, three reds: drop `UNIQUE (provider, subject)`; merge on a taken link; count a pending code in the last-identity check |
| A1-19 | **[Steam]** `steam/return` refuses each of these, against a stubbed Steam: a wrong `op_endpoint`; a `claimed_id` off the pattern; a `return_to` that differs; a consumed or expired challenge; a missing or wrong `__Host-rl_pre`; and a `check_authentication` answer of `is_valid:false`. A correct return writes a session | Remove each check in turn: six mutations, six reds, counts in the commit |
| A1-20 | The tombstone is out of band: delete writes `tomb:<id_hash>` to KV before the D1 batch. A forced KV failure leaves every row in place and answers 503. A forced D1 failure after the KV write is finished by the cron's reconcile. `gone` answers from KV with the accounts D1 emptied | Two mutations, two reds: write the tombstone to D1 instead; write KV after the batch |
| A1-21 | A returning device after a 404 from `gone`: with a cache and a queued outbox, it uploads nothing, shows "Signed out", and flushes only after a sign-in to the same `publicId`. A sign-in to a different member offers keep-or-remove and sends no outbox op | Flush the outbox to whichever member signs in next |

### A2: claim, sync, server coins, the prompt (about 7 agent-days)

- Routes: `state`, `claim`, `mission/start`, `victory`, `campaign`, `spend`, `coupon`, `reset-free`,
  `slots`.
- App: `accountLedgerStore`, the outbox, the claim screen with "Download a copy first", the
  debrief prompt, and the Stores' pending Buy.
- **LEAD:** apply any A2 migration (indexes only, if the plan needs them) before merge.

| Test | What it pins | Input that makes it fail |
|---|---|---|
| A2-1 | A repeated claim with the same `device_id` returns the first result; the wallet and journal are unchanged | Remove the `device_claim` lookup |
| A2-2 | No double pay across devices: a claim of the SAME ledger from a second `device_id` credits 0 | Run the back-payment against an empty record instead of the member's `earn_lifetime` |
| A2-3 | A forged balance: `coins.free: 1000000` with two missions won (1 and 2 stars) credits exactly 100 + 20 + 15 = 135 (a literal) | Credit the device's `coins.free` |
| A2-4 | A forged earn record (all 29 missions at 3 stars, campaign done) credits at most 925 (a literal: 100 + 290 + 435 + 100). A second assertion that `world.json` still names 29 missions fails loudly instead of letting the bound drift | Drop the 0-3 star clamp |
| A2-5 | `paid` stays 0: a claim carrying `coins.paid: 500` leaves `wallet.paid = 0`, and a direct `UPDATE wallet SET paid = 1` in the test D1 is refused by the CHECK | Remove `CHECK (paid = 0)` from the migration |
| A2-6 | Earn is lifetime: a second victory on a mission (new op id, same stars) pays 0; one star higher pays 5 | Drop the held-best comparison |
| A2-7 | The server prices a spend: a request carrying an extra `coins: 1` for a unit is charged the literal `coinPrice` of that unit's JSON price | Read a price from the body |
| A2-8 | The journal balances: after 200 seeded random ops, `wallet.free = SUM(free_delta)` for the member | Skip the journal insert in `spend` |
| A2-9 | A victory is all or none: a forced failure of the wallet statement leaves `campaign_state` at its old revision | Split the batch into two awaits |
| A2-10 | A stale `PUT campaign` (old revision) answers 409, and the same batch stores the losing campaign as an `origin: 'conflict'` slot that the 409 names. A forced failure of the slot statement leaves both campaigns where they were | Two mutations, two reds: last write wins; store the conflict slot in a second await after the 409 |
| A2-11 | A coupon is once per member, even after a reset: redeem, `reset-free`, redeem again answers `used` | Key `coupon_use` on the brigade blob's `coupons` |
| A2-12 | The guest keys are removed only after the digests match: a response with one wrong digest, or an inventory that omits one sent slot, leaves all five keys in place and `lions.account.local` unwritten | Two mutations, two reds: remove the keys before comparing; skip the inventory completeness check |
| A2-13 | The prompt: absent before the first campaign victory and in the tutorial; at most three showings; `never` stops it | Show it on the menu at boot |
| A2-14 | Guests are untouched: with accounts off, every existing `ledger-store`, `roar-wallet`, `roar-earn`, `profile` and `save-reliability` test passes, and `?fresh` leaves `lions.roar` and `lions.brigade.account` byte-identical (G-S3) | Route guest reads through `accountLedgerStore` |
| A2-15 | `sw-policy`: `/api/account/state` passes through | Cache `/api/account/` GETs |
| A2-16 | The win floor: a victory sooner than `minWinSeconds` after its start nonce records the ledger and pays no coins | Skip the floor check |
| A2-17 | The cache rebases: op A (a brigade purchase) is in flight, and op B (another purchase) is appended. A's response, which knows nothing of B, arrives. The view still shows B, B is still queued, and B is sent next with the revision A's response returned, and it is not answered 409 | Two mutations, two reds: replace the cache wholesale with the response; fill the revision at queue time |
| A2-18 | A conflict at the caps: a member with 12 player and 4 system slots gets a stale `PUT campaign`. The 409 says `held` and stores nothing. The device's campaign is byte-identical in `lions.account.local` before the server's is adopted, and the Saves screen lists it. Deleting one slot uploads it, and it leaves the list only after the digest matches. In a second run with free system slots, no player slot is used | Three mutations, three reds: adopt the server's campaign before the local write; count conflict slots in the 12; evict the oldest slot instead of holding |
| A2-19 | A claim at the slot cap: a device with 14 slots claims into a member with none. 12 are `stored` and 2 `rejected: cap`, and the inventory lists all 14. After the digests match, the 2 are byte-identical in `lions.account.local` before `lions.saves` is removed. With that local write refused, every guest key stays | Remove `lions.saves` once the stored digests match, without keeping the rejected slots |
| A2-20 | No re-pay after a reset: device A claims a ledger with missions 1 and 2 won (1 and 2 stars), credited 135. Then `reset-free`, then device B claims the SAME ledger: it is credited 0. Mission 3 won on B only (1 star) pays the literal 15 | Run the claim's difference against `wallet.earn` (which `reset-free` empties) instead of `earn_lifetime`: B is credited 135 |
| A2-21 | The bound holds: over 50 seeded runs of random victories, claims from three devices and resets, the free coins credited since the last reset never exceed 925 plus the coupons redeemed, and `earn_lifetime` never decreases | Let `reset-free` empty `earn_lifetime` too |

### A3: versus records and the profile (about 4 agent-days)

- The seat ticket gains `member`, the room writes `match_record` and `match_seat`, the profile shows
  history and W-L, the lobby and end screen show members, guests and bots as §5.3 says, and the
  lead gets a name-blanking action in `/stats`.
- **LEAD:** apply the A3 migration, if any, before merge. One friend match between two members,
  played by the lead, as the gate.

| Test | What it pins | Input that makes it fail |
|---|---|---|
| A3-1 | Agreed results only: one seat reports a win and the other a loss, so no record is written (void) | Accept the first `over` report |
| A3-2 | The member comes from the cookie: a create with `body.player` set to another member's public id and no cookie makes a guest seat; with a cookie, the body is ignored | Read `member` from the body |
| A3-3 | Nothing identifies a guest: written rows are searched for the guest's sentinel callsign and UUID | Store the callsign in `match_seat` |
| A3-4 | History shows a guest as the "Guest" catalogue key, never a callsign | Render the live callsign in history |
| A3-5 | Deleting member A keeps member B's history: B's record count is unchanged, and the seat reads "Deleted player" | Cascade-delete the match |
| A3-6 | A bot-vs-bot arena match writes no `match_record` (no member seat) | Record every ended room |
| A3-7 | Versus pays 0: a recorded win leaves the journal's row count unchanged | Add a win payout |
| A3-8 | `show_record` off hides W-L from the opponent's lobby message | Send the record unconditionally |

### A4: opening (about 2 agent-days)

- The privacy page text, the menu notice (the telemetry consent gate), the `?accounts` flag
  retired, and the runbook (switch, restore, tombstone re-apply).
- **LEAD:**
  - publish the privacy page;
  - take Workers Paid (L7, ruled 7 Nov);
  - flip `flags.accounts` to `open`.

| Test | What it pins | Input that makes it fail |
|---|---|---|
| A4-1 | Every new string is in `en.json`, and bracketed in a `?pseudo=1` capture of the profile, the claim and the prompt (CI's `ui:shots`) | Inline one English string |
| A4-2 | The privacy route answers 200 with no script (`script-src 'none'`, as `/arena-results`) | Add an inline script |
| A4-3 | `export` and `delete` work with the switch closed, and also with an invented second switch closed | Gate `delete` on `flags.accounts` |
| A4-4 | The retention cron deletes a member last seen 36 months and one day ago, through `DELETE_MAP`, and keeps one seen 36 months ago | `<` for `<=` on the cutoff |
| A4-5 | The tombstone re-apply survives a restore: given a restored D1 fixture that still holds member M and all its rows, and a KV fixture holding M's tombstone, `tools/accounts-reapply-tombstones.mjs` leaves zero rows for M and touches no other member | Read the tombstones from the restored D1 instead of KV: M survives |

### Later, each with its own design and lead step (not built from this spec)

- **The second provider (L1).** Under S, the passkey with its recovery code and handover (§1.5,
  §1.6; tests A1-4, A1-5, A1-17), after L2 is settled, and before A4's opening if the private test
  shows players without Steam. Under P, Steam OpenID (§1.5; test A1-19). Either is one route group
  and no migration.
- **ST5 (GH-204), Steamworks session tickets** on the same `steam` identity: `POST steam/ticket`
  (§1.5). A member who signed in through Steam on the web is already the same member. A
  passkey-only member links Steam once, on the web or in the Steam build. **LEAD:** the publisher
  Web API key (`STEAM_WEB_API_KEY`) and the app id.

  | Test | What it pins | Input that makes it fail |
  |---|---|---|
  | ST5-1 | A ticket for SteamID S, against a stubbed `AuthenticateUserTicket`, resolves the same member as a web OpenID sign-in for S. A stub answering an error, or a ticket made for another `identity`, signs nothing in. A `steamid` field in the request body is ignored | Two mutations, two reds: read the SteamID from the body; drop the `identity` parameter |
- **A5, email magic link,** as a provider for players with neither Steam nor a passkey. **LEAD:** a
  domain, a provider and its API secret, and an amended privacy page.
- **A6, OAuth** (GitHub first, for this audience). **LEAD:** app registrations and secrets.
- **ST6 (GH-205), the offline replay audit, and server-validated credits** if GH-687 needs a
  trusted brigade level.
- **ST7 (GH-206), paid coins:** rebuild `wallet` and `coin_journal` without the `paid = 0` checks,
  and set `PURCHASES_OPEN` true in the same reviewed change.

### Cost on Workers Free

These are estimated rows written, including index entries:

| Action | Rows |
|---|---|
| Making an account | about 9 (10 with a passkey and its pending code) |
| Signing in | about 4 |
| Deleting an account | many rows, plus 1 KV write (Workers KV Free: 1,000 writes a day) |
| A victory | about 6 |
| A spend | about 4 |
| A claim | about 15, plus 1 a slot |
| A recorded match | about 5 |
| A day's sessions | 1 each |

A signed-in player who plays five missions a day writes about 40 rows. The `acct-all` breaker,
20,000 a day, therefore holds about **500 active members a day** beside telemetry and the rooms.
That is ample for the private test. A public launch should take Workers Paid, at 5 USD a month
with 50 million rows written a month included (L7). The breaker answers 429, and clients keep
their outboxes, so hitting it costs a delay, not data.

---

## 8. Decisions for the lead

**Ruled on 7 Nov** (GH-1075): every decision but L1. L1 is the one open decision.

### Open

1. **L1, identity. OPEN.** The lead asked whether a Steam login is needed. **It is not required**:
   guests play everything, and signing in only adds the server copy. It is worth designing for,
   and the spec now does (§1.3): identity is a set of linked providers, one `member_identity` row
   per provider. Steam is first-class. Web "Sign in through Steam" and a Steam build's session
   tickets give the same SteamID, and adding Steam needs no migration.
   - **Recommended: S, Steam + guest first, and the passkey linked later as the second provider**
     (§1.4). A SteamID is not bound to a hostname, so under S, A1 no longer needs L2. A passkey is
     hostname-bound. S also carries no recovery code of ours, and it is already the identity the
     Steam build (ST5) will use. It costs one stored identifier (the SteamID, which is personal
     data and named on the privacy page), and a dependence on Valve's OpenID 2.0.
   - *Alternative:* **P, passkey now and Steam linked later.** It stores nothing personal and
     excludes no one with a modern browser, but A1 then waits for L2, and the recovery-code
     handover ships with it.
   - *Also asked of the lead with L1:* under S, may A1 be released from the 7 Nov L2 hold?
   - *Rejected for the first provider:* email first (a domain, a provider and a **LEAD** secret, and
     it stores email); GitHub or Google OAuth (**LEAD** app secrets and a consent screen with a
     privacy URL); Apple (99 USD a year).

### Ruled

2. **L2, the hostname. LEAD.** **Ruled: decide later. A1 holds until it is settled; A0 does not
   depend on it.** Only the passkey provider is bound to the hostname (§1.4). Moving after
   passkeys exist means Related Origin Requests (partial browser support), or re-enrolment.
3. **L3, a second D1 database, `roaring-lions-accounts`.** **Ruled: as recommended.** **LEAD:**
   create it, and apply every migration with `--remote` before merge. Telemetry and accounts can
   never be joined or restored together.
4. **L4, the backend.** **Ruled: as recommended.** The Worker and D1, retiring the 24 Sep
   "Supabase for ST5/ST6" note. The tombstones add one Workers KV namespace (§6.4), which is still
   the same Worker.
5. **L5, what the server validates.** **Ruled: coins are server-strict. The campaign, credits and
   save slots sync, but are trusted from the client** until a stranger's room reads them
   (GH-687).
6. **L6, a second device's progress.** **Ruled: as recommended.** Coins merge by difference,
   against the claim record (§3.2). Coin entitlements carry while affordable, and the campaign
   arrives as a slot, or is held on the device when the system slots are full (§3.3).
7. **L7, the plan. LEAD (cost).** **Ruled: Workers Free for the private test, behind the `acct-all`
   breaker; Workers Paid (5 USD a month) at A4's public opening.**
8. **L8, privacy and retention.** **Ruled: as recommended.** **LEAD:** publish the privacy page and
   set the minimum age. Members are deleted after 36 months with no sign-in, tombstones are kept
   for 90 days (in KV), and one notice serves both the privacy page and the telemetry consent
   gate (a). Under S, the page also names the SteamID.
9. **L9, a new package, `@lions/economy`.** **Ruled: as recommended**, which changes CLAUDE.md's
   package layout. It also holds `earnDifference` (§2.6).
10. **L10, telemetry linkage.** **Ruled: as recommended.** The telemetry id is never linked to a
    member, and neither is a SteamID (test A1-10).
11. **L11, what opponents see.** **Ruled: as recommended.** A member's name is shown, and their W-L
    is hidden until they turn on "Show my record".
12. **L12, the switch.** **Ruled: as recommended.** **LEAD:** flip `flags.accounts` to `open` at A4.
    It is closed by default, and a missing row means closed. Sign-in, export and delete never
    close.
13. **Unchanged, and restated so nothing drifts.** `PURCHASES_OPEN` stays false. No route can raise
    `paid`. Versus pays 0 coins. Settings, hints and device facts are never synced.

**Lead steps in order:**

1. L1, the first provider, and whether A1 may leave the L2 hold under S.
2. L2, the hostname: needed before the passkey provider ships, and before A1 while the hold stands.
3. L3, create the database and add its id.
4. Create the KV namespace `roaring-lions-account-tombstones` and add its id.
5. Apply `0001_members.sql` (A1) to production before A1 merges.
6. Add the two rate-limit namespaces.
7. Apply the A2 and A3 migrations before each merges.
8. Play the A3 friend match.
9. Publish the privacy page (L8).
10. Take Workers Paid at the opening (L7).
11. Flip the switch (L12).

**No secret is needed through A4**, under either L1 choice: Steam OpenID is keyless. Secrets arrive
only with A5, A6 or ST5's tickets, and each is the lead's.
