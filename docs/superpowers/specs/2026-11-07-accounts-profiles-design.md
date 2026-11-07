# Player accounts and profiles (GH-1075): design

**Status:** design, for the lead's review. Nothing here is built.
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
- **Identity: a passkey, with a one-time recovery code.** No email, no password, no third-party
  sign-in. The server stores a public key and never anything that names a person. It needs no
  secret, no email provider and no OAuth app. Email and OAuth are compared in §1, and each one is
  kept as a later, separate phase. Steam (ST5, GH-204) arrives later as a second credential on the
  same account.
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
  the device holds, against the account's own earn record, with the same pure `roarBackfill`
  logic that PR 1064 made idempotent. Running a claim twice, from two devices or after a slot
  import, pays only what the account has not already been paid. The client's own balance is
  read as a ceiling and never as a credit (§3).
- **Versus records attach to an account seat** through the session cookie at create and join,
  never through the body's `player` field. A guest opponent shows as their callsign during the
  match and as "Guest" in history. Nothing that identifies a guest is stored (§5).
- **Privacy.** There is no email, no IP and no user agent. Telemetry stays anonymous and is never
  linked to an account. Export and delete work from the first phase that stores anything, and they
  keep working when the account switch is closed. Deletion writes a tombstone that holds only a
  hash (§6).
- **Real-money packs stay off.** `PURCHASES_OPEN` stays false in the app, and the server has no
  route that can raise `paid`.
- **Five phases, each shippable** (§7): A0, the shared coin rules; A1, identity, export and delete
  behind a closed switch; A2, claim and sync; A3, versus records and the profile; A4, opening.
  Every test is listed with the input that makes it fail.

---

## 1. Identity

### 1.1 What the account has to survive

- **A device change, and cleared site data.** These are the problems GH-1075 names.
- **The Steam wrapper.** ST2 (Tauri) and ST5 bring a Steam-validated id. The account must be able
  to take Steam as a second way in without a second account.
- **A free, private-by-link test build.** The Worker is on Workers Free (D1 Free's 100,000 rows
  written a day is the binding limit, as the matchmaking spec measured). The host is
  `roaring-lions.pint12.workers.dev`, and `preview_urls` is off, so there is one origin.
- **No secrets without the lead.** Every option that needs one is marked.

### 1.2 The four options

| | Passkey (WebAuthn) | Email magic link | OAuth (Google, GitHub, Apple) | Device-bound anonymous account |
|---|---|---|---|---|
| **What the player does** | Taps "Save your progress" and confirms with a fingerprint, face or device PIN. Signs in on a new device the same way. A synced passkey (iCloud Keychain, Google Password Manager, 1Password) follows the player. | Types an email address, then opens a link or types a 6-digit code. | Picks a provider, then approves a consent screen. | Nothing. The server mints an account on first use and holds it with a cookie. |
| **Survives a device change** | Yes with a synced passkey, or with the QR cross-device flow. Otherwise the recovery code. | Yes. | Yes. | **No.** The cookie is the account. Clearing site data loses it, which is today's problem with a server in the middle. |
| **What the server stores** | A credential id, a public key, a sign counter and transport hints. Nothing personal. | An email address, which is personal data. | The provider's subject id, and usually an email. | A random id. |
| **Secrets and accounts the lead must make** | **None.** | **An email provider** (Resend, Postmark or SES) and its API key as a Worker secret. Cloudflare's own send-email binding only reaches verified addresses. | **One client id and secret per provider.** Google needs a consent screen with a privacy-policy URL. Apple needs a paid developer membership (99 USD a year) and a verified domain. | None. |
| **Domain dependence** | **Strong.** A passkey is bound to its RP ID, the hostname. Moving to a custom domain later breaks every passkey unless Related Origin Requests are set up, and only some browsers honour them. | Strong. Sending mail that arrives needs SPF and DKIM on a domain we own. `workers.dev` cannot carry them. | Medium. The redirect URIs are registered per hostname, and can be changed. | None. |
| **Steam wrapper** | Weak. A Tauri webview's WebAuthn support is uneven, and its origin is not the RP ID. The desktop build signs in with Steam (ST5) instead, which is a second credential on the same account. | Works in any webview. | Works through the system browser with a loopback or deep-link redirect. | Works. |
| **Abuse surface** | Low. A registration costs a user gesture and an authenticator. Credentials are phishing-resistant. | Mail bombing of third parties, and link-scanner prefetch that spends the link (the fix is a code or a POST confirm step). | Low. The cost sits with the provider. | High. Accounts are free to mint. |
| **CSP and pages** | No change. `connect-src 'self'` covers it. | No change. | `form-action` and top-level redirects to three providers. | No change. |
| **Build cost (estimate)** | About 4 agent-days with a maintained library (`@simplewebauthn/server`, MIT, runs on Web Crypto in Workers). A spike confirms the bundle first. | About 3 agent-days, plus the lead's provider and DNS work. | About 2 agent-days for each provider, plus the lead's app registrations. | About 1 agent-day. |
| **Running cost** | 0. | 0 at test scale. Free tiers run about 100 mails a day. | 0, plus Apple's 99 USD a year. | 0. |

### 1.3 Recommendation

**Passkey first, with a one-time recovery code. No email and no OAuth for now. Steam linking at
ST5.**

- The passkey is the only option that adds nothing to the privacy page and needs nothing from the
  lead but a hostname decision (L2).
- **The recovery code covers a lost passkey, and a browser or webview with no WebAuthn.** It is
  shown once, when the account is made, as 20 Crockford base32 characters in five groups (100 bits
  of entropy). The player can copy it or save it as a file. The server stores only its SHA-256.
  Its entropy is too high to brute-force, so it needs no slow hash and no pepper. Using it signs
  the player in, retires it, and shows a new code at once. The screen then offers to add a
  passkey on this device.
- **A second passkey** ("Add this device") is one tap from the profile while signed in. This is the
  normal way onto a second device that does not share a passkey store.
- **The device-bound anonymous account is rejected as the primary identity.** By itself it does not
  solve the issue. It would also mint a server row for every visitor, against a row budget that
  the telemetry already spends. Its one strength, a server session for someone who has no
  credential yet, is not needed: guests stay local (§4).
- **Email (phase A5) and OAuth (phase A6)** are each a later phase with its own lead step. Each adds
  a `credential.kind` value and nothing else. The account schema does not change for either.

### 1.4 The Worker's role

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

### 1.5 Sessions

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
- **A fresh session** (`fresh_until`, 5 minutes after a passkey or recovery sign-in) is required for
  three things:
  - deleting the account;
  - removing a credential;
  - making a new recovery code.

  Otherwise the screen asks for the passkey again, through the `reauth` purpose.

### 1.6 CSRF and the origin

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
5. **GET is read-only.** The export is a GET. It also requires the custom header, and it answers
   `application/json` with `nosniff`, so no other page can include it as a script.

The service worker already passes `/api/` through (`sw-policy`). A2 adds a test case for
`/api/account/`.

### 1.7 Rate limits

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
  user_handle   TEXT NOT NULL UNIQUE,    -- WebAuthn user.id: 16 random bytes, b64url
  created_at    INTEGER NOT NULL,
  last_seen_day INTEGER NOT NULL         -- floor(epoch ms / 86,400,000); retention (§6.3)
);

CREATE TABLE credential (
  id            TEXT PRIMARY KEY,        -- the passkey's credential id; 'rc:' + sha256 for a recovery code
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('passkey', 'recovery')),  -- ST5 adds 'steam', A5 'email'
  public_key    BLOB,                    -- COSE key; NULL for a recovery code
  sign_count    INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,                    -- JSON array, as the browser reported it
  backed_up     INTEGER NOT NULL DEFAULT 0,   -- the BS flag: a synced passkey
  label         TEXT,                    -- optional, typed by the player ("Laptop"); cleaned like a callsign
  created_at    INTEGER NOT NULL,
  last_used_day INTEGER
);
CREATE INDEX credential_member ON credential (member_id);

CREATE TABLE session (
  token_hash    TEXT PRIMARY KEY,        -- sha256 of the cookie value; the value itself is never stored
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,        -- sliding, 30 days
  absolute_at   INTEGER NOT NULL,        -- created_at + 180 days
  fresh_until   INTEGER NOT NULL,        -- re-auth window (§1.5)
  last_seen_day INTEGER NOT NULL
);
CREATE INDEX session_member ON session (member_id);

CREATE TABLE auth_challenge (
  challenge_hash TEXT PRIMARY KEY,
  purpose        TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'reauth', 'add')),
  member_id      TEXT,                   -- set for 'reauth' and 'add'
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
  earn          TEXT NOT NULL,           -- EarnRecord JSON: welcomed, campaignDone, backfilled, missions
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
  PRIMARY KEY (member_id, slot_id)       -- at most 12 per member, counted at write
) WITHOUT ROWID;

CREATE TABLE device_claim (
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  device_id     TEXT NOT NULL,           -- random, minted by the client at claim time
  at            INTEGER NOT NULL,
  result        TEXT NOT NULL,           -- JSON: coins credited, entitlements carried and not, slots made
  PRIMARY KEY (member_id, device_id)
) WITHOUT ROWID;

-- Idempotency: every write carries a client op id; a retry gets the first answer back.
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

CREATE TABLE tombstone (
  id_hash       TEXT PRIMARY KEY,        -- sha256(member.public_id), the id every device holds; nothing else
  deleted_at    INTEGER NOT NULL         -- swept after 90 days (§6.4)
) WITHOUT ROWID;

-- The lead's switches, as in the telemetry database. A missing 'accounts' row means CLOSED.
CREATE TABLE flags (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
```

**Sizes.**

- A campaign ledger is bounded by `ROSTER_CAP` (150 bodies, about 25 KB), plus `roster.lost`, which
  grows forever. That makes the 256 KB cap generous today. A write over the cap is refused with
  413, and the debrief says it was not saved, as a refused local write does now.
- D1's own row limit is 2 MB.
- A member at the caps holds at most about 3.5 MB.

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
| `POST passkey/register/verify` | challenge | about 9 | Makes `member`, `credential`, `profile`, an empty `wallet` and a `session`. Answers with the recovery code ONCE. |
| `POST passkey/login/options`, `login/verify` | none / challenge | about 4 | Works while closed. |
| `POST recovery/login` | none | about 4 | Retires the code and answers with a new one. |
| `POST passkey/add`, `DELETE credential/:id` | session (fresh, to delete) | 2 | The last credential cannot be removed. |
| `POST recovery/rotate` | fresh session | 2 | |
| `POST logout`, `POST logout-all` | session | 1 or n | |
| `GET me` | session | 0 or 1 | Profile, wallet, revisions, slot list. |
| `GET state` | session | 0 | Campaign, brigade, tutorial flag, wallet, slot metadata. |
| `POST claim` | session | about 15 + slots | §3. Idempotent on `device_id`. |
| `POST mission/start` | session | 1 | Issues the start nonce (§2.4). |
| `POST victory` | session | about 6 | One D1 batch: campaign, wallet, journal, op. The mirror of `writeVictory`. |
| `PUT campaign` | session | 2 | A non-victory write, such as "New campaign", a brigade purchase or a reset. Carries the revision. |
| `POST spend` | session | about 4 | `{item:'unit', unitId}` or `{item:'tier', unitId, track, tier}`. No price field exists. |
| `POST coupon` | session | about 4 | Matched against `data/coupons.json` server-side, once per member. |
| `POST reset-free` | session | about 3 | The brigade screen's reset (`resetFree`). Coupon uses stay. |
| `PUT slots/:id`, `DELETE slots/:id` | session | 1 | |
| `PATCH profile` | session | 1 | Display name, `show_record`. |
| `GET matches` | session | 0 | The member's own history, paged. |
| `GET export` | session | 0 | §6.2. |
| `POST delete` | fresh session | many | §6.4. **Works while closed.** |
| `POST gone` | none | 0 | `{idHash}` against `tombstone`: 410 `{deleted: true}` or 404 (§6.4 step 4). **Works while closed.** |

Every write carries `op_id`, a UUID from the client, and the server records it in `account_op`
inside the same batch. A retry returns the first answer. **D1's `batch()` is one transaction**, so
a victory's campaign, wallet and journal rows land together or not at all. That gives the
all-or-none guarantee `writeVictory` gives locally.

### 2.6 One set of coin rules, shared

`roarEarn`, `roarBackfill`, `grantFree`, `buyUnitWithCoins`, `buyTierWithCoins`, `resetFree`,
`migrateRoar`, `coinPrice`, `storeItems`, `campaignComplete` and `redeemCoupon` are pure today, but
they live in `packages/app`, which the Worker must not import.

**A0 moves them, byte for byte, into a new leaf package, `@lions/economy`** (L9). It imports
`@lions/data` and only types from `@lions/sim`. The app and the Worker both import it. Their tests
move with them. The app keeps thin re-exports, so no caller changes. A copied rule is the failure
this prevents: a server that pays by a table the app no longer shows.

### 2.7 The client: a server-backed `LedgerStore`

`ledger-store.ts` is the one door to the save. ST6 was always meant to swap what sits behind it.
It is synchronous, and it stays synchronous.

- **`accountLedgerStore`** implements `LedgerStore` over a local **cache**, a single key
  `lions.account.cache` (`{version: 1, publicId, revision, walletRevision, ledger, brigade,
  tutorial, wallet, slots}`), plus an **outbox**, `lions.account.outbox`.
  - Reads answer from the cache, so every screen stays synchronous.
  - Writes update the cache, append an op, and flush in the background.
  - Each response replaces the cache wholesale. The server's numbers win.
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
  The client then saves its own campaign as a slot with `origin: 'conflict'` ("From this device, 7
  Nov 18:40") and adopts the server's. Coin ops never conflict: each one is a fact the server
  re-prices.
- **Off switch.** It mirrors telemetry's.
  - The account client makes **no request** from `pnpm dev`, tests or CI unless `?accounts` is on
    the URL. It is live only in a production build on a real host.
  - This is also what keeps `pnpm ui:routes` and the golden gate free of console errors.
  - `?fresh` boots the page as a guest and never reads or writes the server, so a test that uses
    it can never touch a member.
- **Storage guarded.** `lions.account` (the device binding) and the cache are read through the
  same guarded access as every other key. When storage is blocked, a signed-in player still plays
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
   tutorial pays nothing. It then runs **`roarBackfill` against the member's own server earn
   record**. Two properties of that function, from PR 1064, make the claim safe:
   - it pays only the difference between the evidence and what `earn` already holds (a first win
     only where `won` is false, stars only above the held best, the welcome and the campaign bonus
     only once each);
   - it sets `earn.backfilled`.

   The first claim into a new member runs it with `backfilled: false`; every later claim runs the
   same function and finds the difference already paid. **`earn.backfilled` is reused as the
   record that the account's back-payment has run.** The function's monotone difference is what
   makes a second run harmless.
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
6. **The campaign.**
   - If the member has no `campaign_state` yet, the device's becomes it.
   - If it has one (this is a second device), the device's campaign is saved as a slot with
     `origin: 'claim'` ("From another device, <date>"), and the member's stays active. The player
     can load it from the Saves screen.
   - Device slots are added under new ids, up to the cap.
7. **Records.** One `coin_journal` row of kind `claim` (or `backfill` for the first), the
   `device_claim` row with its result, and an `account_op` row.

### 3.3 After the claim, on the device

The response carries a SHA-256 digest of each blob the server stored. The client compares them
with its own.

- **If they match,** it removes the five guest keys:
  - `lions.campaign.ledger`,
  - `lions.brigade.account`,
  - `lions.tutorial.done`,
  - `lions.saves`,
  - `lions.roar`.

  It then writes `lions.account` (`{version: 1, publicId, deviceId, claimedAt}`), and the
  server-backed store takes over. The progress has **moved**, once.
- **If any digest differs, or the response never comes,** nothing is removed. The claim is retried
  later under the same `device_id`, which step 1 makes harmless.

Signing out removes the cache. The device is then an empty guest. It never falls back to the
pre-claim keys, so there is no stale copy to claim into a second account.

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

The earn record is per member, and every coin credit runs through it. The device id, the digest and
the op id each stop a retry, but none of them is what stops double pay. The earn record does. So a
claim from a cleared and re-imported device, from a third browser, or replayed by hand, still
finds the difference already paid. Test A2-2 falsifies exactly this, by running the back-payment
against an empty record instead.

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

---

## 6. Privacy

### 6.1 What is stored, and what is not

**Stored, per member:**

- a random internal id, a random public id and a random WebAuthn user handle;
- the display name the player typed;
- passkey public keys with their counters, transport hints and an optional label;
- the hash of the recovery code;
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
- the recovery code itself;
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
- credentials, as metadata only (kind, label, created, last used, synced: no key bytes);
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
| `account_op` | 30 days. |
| Tombstones | 90 days, which is longer than D1 Time Travel's 30. |
| Match records | While either seat is a member. A record whose seats are all deleted or guests is deleted. |
| `rate_day` | As today: older than yesterday is swept. |

### 6.4 Deletion

1. **The player asks for it.** "Delete my account" is on the profile screen. It needs a fresh
   session (a passkey or recovery sign-in within 5 minutes), and it asks for the confirmation
   "This cannot be undone". It offers "Download my data" first.
2. **The server deletes,** in one batch, table by table through `DELETE_MAP`, without relying on
   the foreign-key cascade alone:
   - every session, credential and challenge;
   - wallet, journal, coupon uses, campaign, slots, claims and ops;
   - the profile and the member.

   Match seats are set to `member_id NULL, kind 'deleted'`. Match records left with no member seat
   are deleted. A `tombstone(sha256(public_id))` row is written.
3. **This device** removes the cache, the outbox and `lions.account`, and boots as a fresh guest.
   It offers to keep a local copy of the campaign as guest data: the default is no, and the
   download in step 1 is the recommended way to keep one.
4. **Other devices** get 401 on their next request. A device that held a session then asks
   `POST /api/account/gone` (no auth) with `{idHash: sha256(publicId)}`, the `publicId` it keeps in
   `lions.account`. The Worker answers 410 `{deleted: true}` if a tombstone matches and 404
   otherwise (the session simply expired). A public id is 40 bits and is already shown beside the
   name, so its hash reveals nothing a stranger could not already read. On 410 the device clears its
   cache and says, through `t()`, that the account was deleted. They do not re-upload their outbox.
5. **Restores.** If the lead ever restores the accounts database from Time Travel, the tombstones
   that are still kept are re-applied by a script (`tools/accounts-reapply-tombstones.mjs`) before
   the switch reopens. The runbook says so.
6. **Telemetry from this device (optional).** A checkbox, "Also delete this browser's anonymous
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

### A1: identity, export, delete; the switch closed (about 5 agent-days)

- Routes: register, login, recovery, add and remove a credential, logout, `me`, `export`, `delete`,
  `open`. The migration, the cron sweeps, the rate limits, and the `ACCOUNTS` binding.
- App: the profile screen and the chip, behind `?accounts` until A4. No progress sync.
- **LEAD:**
  - decide the hostname that will carry passkeys (L2);
  - create `roaring-lions-accounts` and put its id in `wrangler.jsonc`;
  - apply `0001_members.sql` with `--remote` before merge;
  - add the two rate-limit namespaces.

  **No secret is needed.**

| Test | What it pins | Input that makes it fail |
|---|---|---|
| A1-1 | Cookie flags: `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no `Domain` | Drop `HttpOnly` from the cookie builder |
| A1-2 | CSRF: a POST with `Origin: https://evil.example`, with no Origin, or without `x-rl-account` answers 403 and writes 0 rows | Use `/api/events`' lax origin rule (null allowed) |
| A1-3 | No CORS: no `/api/account/*` response carries `access-control-allow-origin`; `OPTIONS` answers 405 | Add `access-control-allow-origin: *` to the JSON helper |
| A1-4 | WebAuthn verify refuses: a wrong origin, a wrong challenge, a reused challenge, a wrong `rpIdHash`, UP clear, a bad signature, a counter going backwards. A software authenticator in the test (a Web Crypto ES256 key) signs the fixtures | Remove each check in turn: seven mutations, seven reds, counts in the commit |
| A1-5 | The recovery code is never written: every bound SQL value the test D1 records is searched for the code's literal | Store the code instead of its hash |
| A1-6 | Revocation: after `logout-all`, the old cookie gets 401 | Replace the session table with a signed stateless cookie (the `/stats` pattern) |
| A1-7 | Account-creation ceilings: the 6th from one IP key in a day, and the 501st overall, answer 429 | Change `n < cap` to `n <= cap` in the check |
| A1-8 | Export and delete cover every table: the test reads the migration's `CREATE TABLE` names, and every table with a `member_id` column must appear in `EXPORT_MAP` and `DELETE_MAP` | Add a table to the migration without mapping it |
| A1-9 | Delete leaves zero rows for the member in every table (walked from the same list) and writes one tombstone | Leave `coin_journal` out of `DELETE_MAP` |
| A1-10 | Telemetry is unlinked: with a signed-in state holding a sentinel public id, display name and token, every telemetry builder's output and the feedback context are searched for all three | Add `member: publicId` to the boot event |
| A1-11 | Off switch: booting under jsdom without `?accounts` makes zero `/api/account` fetches | Remove the `?accounts` and production gate |
| A1-12 | A throwing storage: `lions.account` and `lions.account.prompt` reads fall back to guest with no throw | Remove the `try` around the property access |
| A1-13 | Closed means closed: with no `flags.accounts` row, `register/options` answers 404 while `login/*`, `export` and `delete` work | Read a missing row as open (the feedback default) |
| A1-14 | A valid origin passes and a wrong scheme, host or port fails against `ACCOUNT_ORIGINS`, while the same host with the wrong port still has a valid `rp.id` | Compare the origin to `ACCOUNT_RP_IDS` |
| A1-15 | A session whose expiry moves answers with `Set-Cookie` carrying a fresh `Max-Age`; one that does not move sends none | Drop the `Set-Cookie` on the slide |
| A1-16 | After delete, `POST gone` with `sha256(publicId)` answers 410 and with an unknown hash 404, with the switch closed | Key the tombstone by the internal member id |

### A2: claim, sync, server coins, the prompt (about 7 agent-days)

- Routes: `state`, `claim`, `mission/start`, `victory`, `campaign`, `spend`, `coupon`, `reset-free`,
  `slots`.
- App: `accountLedgerStore`, the outbox, the claim screen with "Download a copy first", the
  debrief prompt, and the Stores' pending Buy.
- **LEAD:** apply any A2 migration (indexes only, if the plan needs them) before merge.

| Test | What it pins | Input that makes it fail |
|---|---|---|
| A2-1 | A repeated claim with the same `device_id` returns the first result; the wallet and journal are unchanged | Remove the `device_claim` lookup |
| A2-2 | No double pay across devices: a claim of the SAME ledger from a second `device_id` credits 0 | Run `roarBackfill` against an empty earn record instead of the member's |
| A2-3 | A forged balance: `coins.free: 1000000` with two missions won (1 and 2 stars) credits exactly 100 + 20 + 15 = 135 (a literal) | Credit the device's `coins.free` |
| A2-4 | A forged earn record (all 29 missions at 3 stars, campaign done) credits at most 925 (a literal: 100 + 290 + 435 + 100). A second assertion that `world.json` still names 29 missions fails loudly instead of letting the bound drift | Drop the 0-3 star clamp |
| A2-5 | `paid` stays 0: a claim carrying `coins.paid: 500` leaves `wallet.paid = 0`, and a direct `UPDATE wallet SET paid = 1` in the test D1 is refused by the CHECK | Remove `CHECK (paid = 0)` from the migration |
| A2-6 | Earn is lifetime: a second victory on a mission (new op id, same stars) pays 0; one star higher pays 5 | Drop the held-best comparison |
| A2-7 | The server prices a spend: a request carrying an extra `coins: 1` for a unit is charged the literal `coinPrice` of that unit's JSON price | Read a price from the body |
| A2-8 | The journal balances: after 200 seeded random ops, `wallet.free = SUM(free_delta)` for the member | Skip the journal insert in `spend` |
| A2-9 | A victory is all or none: a forced failure of the wallet statement leaves `campaign_state` at its old revision | Split the batch into two awaits |
| A2-10 | A stale `PUT campaign` (old revision) answers 409, and the client saves its campaign as an `origin: 'conflict'` slot | Last write wins |
| A2-11 | A coupon is once per member, even after a reset: redeem, `reset-free`, redeem again answers `used` | Key `coupon_use` on the brigade blob's `coupons` |
| A2-12 | The guest keys are removed only after the digests match: a response with one wrong digest leaves all five keys in place | Remove the keys before comparing |
| A2-13 | The prompt: absent before the first campaign victory and in the tutorial; at most three showings; `never` stops it | Show it on the menu at boot |
| A2-14 | Guests are untouched: with accounts off, every existing `ledger-store`, `roar-wallet`, `roar-earn`, `profile` and `save-reliability` test passes, and `?fresh` leaves `lions.roar` and `lions.brigade.account` byte-identical (G-S3) | Route guest reads through `accountLedgerStore` |
| A2-15 | `sw-policy`: `/api/account/state` passes through | Cache `/api/account/` GETs |
| A2-16 | The win floor: a victory sooner than `minWinSeconds` after its start nonce records the ledger and pays no coins | Skip the floor check |

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
  - decide on Workers Paid (L7);
  - flip `flags.accounts` to `open`.

| Test | What it pins | Input that makes it fail |
|---|---|---|
| A4-1 | Every new string is in `en.json`, and bracketed in a `?pseudo=1` capture of the profile, the claim and the prompt (CI's `ui:shots`) | Inline one English string |
| A4-2 | The privacy route answers 200 with no script (`script-src 'none'`, as `/arena-results`) | Add an inline script |
| A4-3 | `export` and `delete` work with the switch closed, and also with an invented second switch closed | Gate `delete` on `flags.accounts` |
| A4-4 | The retention cron deletes a member last seen 36 months and one day ago, through `DELETE_MAP`, and keeps one seen 36 months ago | `<` for `<=` on the cutoff |

### Later, each with its own design and lead step (not built from this spec)

- **A5, email magic link,** as a credential for players without passkeys. **LEAD:** a domain, a
  provider and its API secret, and an amended privacy page.
- **A6, OAuth** (GitHub first, for this audience). **LEAD:** app registrations and secrets.
- **ST5 (GH-204), Steam,** as a credential on an existing member; a desktop player signs in with
  Steam and can add a passkey for the web build. **LEAD:** the Steam Web API key.
- **ST6 (GH-205), the offline replay audit, and server-validated credits** if GH-687 needs a
  trusted brigade level.
- **ST7 (GH-206), paid coins:** rebuild `wallet` and `coin_journal` without the `paid = 0` checks,
  and set `PURCHASES_OPEN` true in the same reviewed change.

### Cost on Workers Free

These are estimated rows written, including index entries:

| Action | Rows |
|---|---|
| Making an account | about 9 |
| Signing in | about 4 |
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

Each one gives the recommendation first, then the alternative. **LEAD** marks a step only the lead
can take.

1. **L1, identity.** **Recommended: a passkey plus a one-time recovery code. No email and no OAuth
   now.** It needs no secret and no email provider, and it stores no personal data. *Alternatives:*
   email magic link first (a domain, a provider and a **LEAD** secret, and it stores email);
   GitHub or Google OAuth (**LEAD** app secrets and a consent screen with a privacy URL); Apple
   (99 USD a year).
2. **L2, the hostname, before A1 ships. LEAD.** **Recommended: decide now whether the game will
   move to a custom domain, and move before passkeys exist,** because passkeys are bound to the
   hostname. *Alternative:* ship on `roaring-lions.pint12.workers.dev`, and accept Related Origin
   Requests (partial browser support) or re-enrolment at a move.
3. **L3, a second D1 database, `roaring-lions-accounts`. LEAD: create it, and apply every
   migration with `--remote` before merge.** **Recommended: yes,** so telemetry and accounts can
   never be joined or restored together. *Alternative:* the telemetry database with a table
   prefix.
4. **L4, the backend.** **Recommended: the Worker and D1, retiring the 24 Sep "Supabase for
   ST5/ST6" note.** The DO room already replaced the Colyseus relay it was paired with, and ST5's
   Steam ticket check is one Worker route. *Alternative:* keep Supabase for ST5 and ST6, which
   gives two backends and a second privacy surface.
5. **L5, what the server validates.** **Recommended: coins strictly; the campaign, credits and
   slots stored and synced but trusted, until a stranger's room reads them (GH-687).**
   *Alternative:* server-validate credits now, using the same improvement rule, which adds about
   2 agent-days to A2.
6. **L6, a second device's progress.** **Recommended: coins merge by difference, coin
   entitlements carry while affordable, and the campaign arrives as a slot.** *Alternative:* refuse
   a second claim, and offer only a file export.
7. **L7, the plan. LEAD (cost).** **Recommended: stay on Workers Free for the private test, behind
   the `acct-all` breaker, and take Workers Paid (5 USD a month) at A4's public opening.**
   *Alternative:* stay on Free and lower the breaker.
8. **L8, privacy and retention. LEAD: publish the privacy page; set the minimum age.**
   **Recommended: delete members after 36 months with no sign-in, keep tombstones for 90 days, and
   serve one notice for both the privacy page and the telemetry consent gate (a).**
   *Alternative:* no inactivity deletion (keep until asked).
9. **L9, a new package, `@lions/economy`,** which changes CLAUDE.md's package layout.
   **Recommended: yes,** so the app and the Worker run one copy of the coin rules.
   *Alternative:* the Worker imports from `packages/app/src` by relative path, as `arena-results.ts`
   does from `tools/`. This works, but it couples the Worker to app internals.
10. **L10, telemetry linkage.** **Recommended: never link the telemetry id to a member.**
    *Alternative:* link on claim, which needs a consent line and makes telemetry personal data.
11. **L11, what opponents see.** **Recommended: a member's name is shown, and their W-L is hidden
    until they turn on "Show my record".** *Alternative:* the record is shown by default.
12. **L12, the switch. LEAD: flip `flags.accounts` to `open` at A4.** **Recommended: closed by
    default.** A missing row means closed, which is the opposite of the feedback switch, because a
    switch for a public sign-up should fail shut. Sign-in, export and delete never close.
13. **Unchanged, and restated so nothing drifts.** `PURCHASES_OPEN` stays false. No route can raise
    `paid`. Versus pays 0 coins. Settings, hints and device facts are never synced.

**Lead steps in order:**

1. L2, the hostname.
2. L3, create the database and add its id.
3. Apply `0001_members.sql` (A1) to production before A1 merges.
4. Add the two rate-limit namespaces.
5. Apply the A2 and A3 migrations before each merges.
6. Play the A3 friend match.
7. Publish the privacy page (L8).
8. Decide the plan (L7).
9. Flip the switch (L12).

**No secret is needed through A4.** Secrets arrive only with A5, A6 or ST5, and each is the lead's.
