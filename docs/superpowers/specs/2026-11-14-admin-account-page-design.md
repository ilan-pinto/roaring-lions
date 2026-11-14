# Admin account page: credits and Roar coins (GH-695): design

**Status:** draft for the lead, 14 Nov 2026. Docs only; no code ships with this spec.
**Ask (lead, 14 Nov):** "design admin account page, it should allow me to control my credits and roaring lion coins."
**Issue:** GH-695 (the lead's 18 Oct "admin website: store credit allocation, user management"), the first slice of it.
It builds on the accounts work in GH-1075 (spec `2026-11-07-accounts-profiles-design.md`, plans `2026-11-08-accounts-a0-a1.md`,
`2026-11-09-accounts-a2.md`, `2026-11-11-accounts-a3.md`) and on the `/stats` admin area (WP-T1, GH-464, GH-254).
**Mock:** `2026-11-14-admin-account-page-mock.html` (same folder). Every id and name in it is invented.
**No sim change.** The sim never reads credits or coins, and nothing here changes that.

---

## 0. In one page

- **There are two currencies, and they live in different places with different authority** (section 1). **Roar coins** are
  server-authoritative for a signed-in member: one `wallet` row plus an append-only `coin_journal`, with one writer
  (`coin.ts`). **Brigade credits** live in the browser for a guest. For a signed-in member they are also kept in D1, in
  `campaign_state.brigade`, and the server's copy is the copy of record, but its CONTENT is trusted from the client (L5).
  No journal records credits. The only history is the `grants` array inside the brigade JSON.
- **Neither currency can be touched for a guest.** A guest's credits and coins are `localStorage` keys on their device
  (`lions.brigade.account`, `lions.roar`). The page controls signed-in members only, and says so.
- **Recommended shape.** One page at **`/stats/members`**, served by the Worker beside `/stats/feedback`, with a JSON API
  under `/stats/api/members/*` that reads and writes the ACCOUNTS database only (D4). Seeing the page needs the existing
  `/stats` password session. Writing needs that session AND the admin's own signed-in member session, where the member is
  listed in a new `admin_member` table (D1). Writes stop when `flags.admin` is closed, and a missing row means closed (D3).
- **Coins first, credits second** (D7, D8). Coins already have a journal, a single writer and a revision guard. An admin
  grant becomes one more journal kind (`admin`), written by `walletWrite` in the same batch as the balance. Credits need a
  guarded `campaign_state` write. That write moves the campaign revision under a player who is online, and their device
  then parks its newer campaign in a conflict slot (`sync.ts:11-13`). So the credits route ships second, behind an
  activity guard, and the spec is honest that a credit deduction is advisory while credits stay client-trusted.
- **Every change is audited** (D9): an append-only `admin_action` row holds who, when, the target, the currency, the mode,
  the delta, the balance before and after, the reason and the op id. It is written atomically with the balance change,
  in one D1 batch, under a revision guard and an idempotency key.
- **Seven slices of 1 to 2 hours each** (section 6). The coin path (S1 to S5) deploys inert until the lead applies
  migration `0003`, adds his member row and opens the flag. Credits (S6) wait for the lead's ruling on D8. No new secret
  is needed.

---

## 1. What exists today (the facts the design starts from)

### 1.1 Brigade credits

| Fact | Where |
|---|---|
| The shape: `balance`, `earned_total`, `paid`, `campaign_paid`, `unlocks`, `upgrades`, `grants`, `coupons`. | `packages/economy/src/brigade.ts:35-56` |
| Earned by a won mission: `creditsFor` (100 a win, 40 a carrying secondary, 10 a unit home, 1 a Conduct point). The sim never calls it. | `packages/sim/src/credits.ts:1-12`, `:38-50` |
| Guest storage: `localStorage['lions.brigade.account']`. `brigade-account.ts` is the only reader and writer. | `packages/app/src/brigade-account.ts:41`, `:48-59` |
| Member storage: D1 `campaign_state.brigade` (BrigadeAccount JSON through `migrateAccount`), with a `revision` and `updated_at`. | `packages/worker/migrations-accounts/0001_members.sql:94-103` |
| Authority: the server copy is the copy of record, but the client writes the content (shape, size and revision are checked, not the numbers). | accounts spec §2.3 and §2.4 (L5) |
| Server writers today: `PUT campaign` (`putCampaign`), the coupon route (a `granted` Grant plus the balance), and `reset-free` (empties the brigade). All use `campaignWrite`'s revision guard. | `packages/worker/src/account/campaign.ts:70`, `:167`; `spend.ts:170-177`, `:197-218` |
| The bound: `migrateAccount` cuts `balance` down to the sum of `grants` (earned plus granted) whenever the save carries a grants log. A raised balance with no matching Grant is cut back on the next read. | `brigade.ts:149-176` |
| A Grant amount is a non-negative integer, `source: 'earned'` (with `missionId`) or `'granted'` (optional `missionId`, `couponId`). Unknown fields are dropped. | `brigade.ts:30-33`, `:75-96` |
| History: none on the server. `grants` lists credits IN (earned and coupon), but spending writes no row. | `brigade.ts:214-237` comments |

### 1.2 Roar coins

| Fact | Where |
|---|---|
| Guest storage: `localStorage['lions.roar']`. `roar-wallet.ts` is the only reader and writer. | `packages/app/src/roar-wallet.ts:10-12` |
| Member storage: one `wallet` row. `free` is checked to 0..1,000,000 (`MAX_COINS`), `paid` is checked to 0, and there is a `revision`. | `0001_members.sql:62-72`; `packages/economy/src/wallet.ts:18` |
| History: `coin_journal`, append-only, with `free_delta`, `detail` JSON and `op_id`. The `kind` CHECK allows `earn, backfill, claim, coupon, unit, tier, reset`. Invariant: `wallet.free = SUM(free_delta)` (test A2-8). | `0001_members.sql:74-85` |
| One writer: `walletWrite` is the only `UPDATE wallet` and the only `INSERT INTO coin_journal` (test A2-27). It guards on the revision it read: a stale write sets `free = -1` and trips the CHECK, which rolls back the whole batch. | `packages/worker/src/account/coin.ts:1-6`, `:19`, `:92-131` |
| Authority: server-authoritative for members. The routes take facts, never amounts. The client's numbers are a cache, and `writeRoar` throws when signed in. | `spend.ts:2-6`; accounts spec §2.3; `docs/agent-notes/shell-and-ui.md` "Accounts A2" |
| A player's own `reset-free` sets `free` to 0. Granted coins go too, as coupon coins do. | `wallet.ts:307-324` |
| The lifetime ceiling the accounts spec promises is 925 coins plus coupons, with no transfer between members, ever. | accounts spec §2.4 |

### 1.3 Who can change them today, and how it is audited

- **A player** changes coins only through `victory`, `claim`, `spend`, `coupon` and `reset-free`, each of which is journaled.
  For credits, a player can write any brigade they like through `PUT campaign`, because the content is trusted, and no
  journal records it.
- **The lead** has two levers: a coupon in `@lions/data` (GH-755 granted 100,000 coins that way), and raw SQL through
  `wrangler d1 execute`. The SQL path bypasses `walletWrite`, so it would break `wallet.free = SUM(free_delta)` unless he
  writes the journal row by hand.
- **`/stats`** can blank a display name and nothing else (`packages/worker/src/stats.ts:378-412`).

### 1.4 The admin area the page joins

- **Login.** One shared password (`STATS_PASSWORD`). The session is stateless: an HMAC-signed expiry in the cookie
  `stats_session`, with `HttpOnly; Secure; SameSite=Strict; Path=/stats`, for 7 days. Rotating the password revokes every
  session (`packages/worker/src/auth.ts:1-8`, `:31-61`). Login is rate-limited by `LOGIN_LIMIT` and checks Origin
  (`stats.ts:335-369`).
- **Writes** are POST only. They require `Origin` to equal the Worker's own origin exactly, and a JSON `content-type`
  (`stats.ts:371-384`, `feedback-triage.ts:317-331`).
- **The kill-switch pattern** is a `flags` row (`feedback-triage.ts:304-312` for `feedback`; `member.ts:9-18` for
  `accounts`), with a page button to close it (`/stats/feedback`'s "Close feedback").
- **The page CSP** is `FEEDBACK_PAGE_CSP` (`packages/worker/src/feedback-page.ts:8-10`). It allows inline script, so
  every player-typed string must be rendered with `textContent`.
- **`/stats/api/accounts` is TAKEN.** It is the telemetry brigade view of GH-254 and reads `env.DB`
  (`stats.ts:454-455`). The new routes use `members`, following `/stats/api/members/blank`.
- **The member session cookie** is `__Host-rl_session` with `Path=/` (`account/config.ts:6`, `account/session.ts:20`), so
  it reaches every `/stats/*` request from a browser that is signed in to the game.

---

## 2. Decisions (each with a recommended default)

### D1. Who is an admin, and how that is proven

**Recommended: both factors, split by risk.**
- **Reading the page** requires a valid `stats_session`, as every `/stats` page does today.
- **Every write** also requires:
  - a valid member session (`__Host-rl_session`, resolved by `requireSession`'s lookup, never by trusting a client field);
  - that the member has a row in a new table, `admin_member (member_id PRIMARY KEY REFERENCES member ON DELETE CASCADE,
    added_at)`.
- The lead adds himself once, with a `wrangler d1 execute` that selects his own row by public id (section 6, lead steps).
- The audit's "who" is the admin's member id. Within the audit table it shows as his public id. Nothing on the client ever
  decides who is an admin: the page asks `GET /stats/api/members/whoami`, and the server answers `{ admin: bool }`.

**Why.** GH-695 asks for "real per-admin logins (not a shared password)". The member sign-in IS a per-person login: Google
or Steam, each with its own 2-step. The password stays as a second factor that a stolen game session does not carry. The
two failure modes then need two thefts:
- a leaked `stats_session` cookie alone can read but not mint;
- a stolen game session alone opens nothing under `/stats`.

**Alternatives.**
- **(a) The password session only.** Smallest. But the audit cannot say who acted, and one leaked cookie mints coins for 7
  days. Rejected.
- **(b) The member flag only, with no password.** Per-person, but a stolen Google session is then a full admin, and
  `/stats` would grow a second way in. Rejected.
- **(c) An allow-list in `wrangler.jsonc` (`ADMIN_PUBLIC_IDS`).** It puts a member's id in the repository. Rejected.
  It could instead be a Worker secret, but that is a lead step with no benefit over a D1 row.
- **(d) Require a FRESH member session for writes** (`session.fresh_until`, `FRESH_MS` = 5 minutes, accounts spec §1.7).
  It is stronger, but forces a Google re-sign-in every 5 minutes of admin work. **Offered as an option for `set` and for
  deductions** (Q4); not the default.

### D2. CSRF, origin and transport

**Recommended: the `/stats` write rule plus the account door's custom header.** Each layer stops the attack on its own:
1. **Cookies are `SameSite=Strict`.** Both cookies already are.
2. **POST only.** A GET is read-only.
3. **Strict Origin.** `Origin` must equal the Worker's own origin exactly. `ALLOWED_ORIGINS` is NOT honoured here: admin
   writes come only from the deployed page.
4. **A non-simple request.** `content-type: application/json` and `x-rl-admin: 1`, so a cross-site form cannot send one
   without a preflight.
5. **No CORS, ever.** `OPTIONS` answers 405.
6. **Page CSP.** `FEEDBACK_PAGE_CSP` plus `form-action 'self'` (already in it) and `frame-ancestors 'none'`. Every
   member-typed string (display name, reason) is rendered with `textContent`, and a test greps the page source for
   `innerHTML` beside a member field.
7. **Bodies are capped at 2 KiB**, and all responses are `no-store`.

**Alternative.** A per-session CSRF token in the page. It adds nothing over 1 to 5 on a `SameSite=Strict`, same-origin,
JSON-only API, and it is one more thing to get wrong. Not recommended.

### D3. The kill switch

**Recommended: the `flags` row `admin` in the ACCOUNTS database.** Anything but `'open'`, including no row, is CLOSED,
which matches `accounts`, `google` and `steam`. While closed:
- every write answers 503 `{ error: 'closed' }` and writes nothing;
- lookups and the journal keep working, so the lead can still see what happened.

The page has a **"Close admin writes"** button, like "Close feedback". It can CLOSE the switch but never OPEN it: opening
is a `wrangler d1 execute` (section 6). So a stolen pair of sessions cannot reopen a switch the lead closed in a hurry.

**Alternatives.**
- The page opens and closes it (symmetric, as feedback does). Weaker for the reason above.
- An env var (`ADMIN_WRITES=1`). Changing it needs a deploy. Rejected.

### D4. Where the page lives

**Recommended: `/stats/members` (the page) and `/stats/api/members/*` (the API), served by the Worker.**
- The HTML is a constant in `packages/worker/src/members-page.ts`, styled from `STATS_STYLE_HEAD` (the palette tokens and
  self-hosted fonts already shared by `/stats` and `/stats/feedback`), with the same nav: Players · Feedback · Members ·
  Sign out.
- The API reads and writes `env.ACCOUNTS` only. It never touches `env.DB`, and the two are never joined (the GH-1075 A3
  rule; a test runs it with `DB` undefined).

**Alternative: an in-game admin screen** in `packages/app`. Rejected:
- it would ship admin code and strings to every player's bundle;
- it would need `t()` for every string, `validate:ui` palette discipline and a router path;
- it would have to talk to `/stats/api/*`, whose cookie is scoped to `/stats`.

If it is ever wanted, the rules are: strings through `t()` in `en.json`, colours from semantic tokens only, a `Disposer`,
and no new storage key.

### D5. What the page does: look up a member

- **Search** takes one of three inputs:
  - a **public id**: 8 Crockford characters, upper-cased, exact match;
  - a **display name**: a case-insensitive prefix of at least 3 characters, at most 20 results, newest sign-in first;
  - **"Me"**: the member behind the request's own `__Host-rl_session`, resolved server-side. No id is stored anywhere. With
    no member session the button is disabled, and its tooltip says "Sign in to the game in this browser first".
- A **result row** shows:
  - the display name and public id;
  - the day the account was created and the day it was last seen;
  - the sign-in KINDS (Google, Steam, passkey) as words only;
  - the coin balance and the credit balance.
- **Never shown:** an identity `subject` (Google `sub`, SteamID64, credential id), `member.id`, the `id_hash`,
  `user_handle`, session rows, slot bodies, device ids, the campaign ledger.

### D6. What the page does: the member card and the journal

- **The card** holds:
  - **Coins:** free, the paid half (0 and display-only, as `PURCHASES_OPEN` is false), the wallet revision, and the last
    change.
  - **Credits:** balance, `earned_total`, granted total (the sum of `granted` grants), the campaign revision, and
    `campaign_state.updated_at` as "last synced N minutes ago". When there is no `campaign_state` row: "No campaign on the
    server yet: credits cannot be set".
- **The journal** is one table, newest first, 50 rows a page, filterable by currency. It merges two sources:
  - every `coin_journal` row for the member: earn, backfill, claim, coupon, unit, tier, reset and admin. The lead sees the
    player's own history beside his grants;
  - every `admin_action` row for the member: coins, credits and the switch.
- **Journal columns:** when, currency, kind, delta, before → after, reason, by, op id (shortened). Rows written by the
  player show "player" in the **by** column. An admin row shows the admin's public id.

### D7. Controlling coins (slices S4 and S5)

**Recommended:** three modes, `grant +n`, `deduct -n` and `set =n`. The server computes the delta; the client never sends
a balance it computed. The rules:
1. **A reason is REQUIRED**: 8 to 200 characters after trimming, cleaned like a callsign for control characters.
2. **The range is pre-validated.** `0 <= after <= MAX_COINS` (1,000,000). Outside it the answer is 409 `{ error: 'range' }`
   and nothing is written. It is checked BEFORE the batch because an out-of-range `free` trips the same CHECK that the
   revision guard uses, and `isCasFailure` cannot tell the two apart (`coin.ts:155`).
3. **There is a per-action cap**: `|delta| <= 100,000`. This is the size of the GH-755 coupon, the largest grant ever made
   (Q2).
4. **The expected revision.** The form carries the `wallet.revision` the card showed. If the wallet moved since, the answer
   is 409 `{ error: 'moved', wallet }` and nothing is written. The page redraws the card and asks again. This matters
   most for `set`, where a concurrent earn would otherwise be erased silently.
5. **The write** is `walletWrite(db, before, after, [entry])` with `kind: 'admin'`, `receipt: null`, and
   `detail: { mode, reason, before, after, by: <admin public id> }`. It runs in ONE batch with the `admin_action` insert
   and the `account_op` insert. `wallet.free = SUM(free_delta)` holds by construction.
6. **`earn`, `earn_lifetime` and `entitlements` are left as they are.** An admin grant is not an earned coin, and does not
   change what the earn table will still pay.
7. **No receipt** (`receipt: null`, as `reset` has). The player's Stores history therefore does not list the grant; the
   balance simply moves. A `grant` receipt kind would be a change to `@lions/economy` and to the client's `migrateRoar`
   (Q5).
8. **The player's own `reset-free` zeroes admin-granted coins**, exactly as it zeroes coupon coins (`wallet.ts:318`).
   Both moves appear in the journal (Q6).

**The client sees it** on its next account response or `GET state`, because the wallet is replaced by every answer.
Nothing on the device has to change.

### D8. Controlling credits (slice S6, after the lead rules)

**The honest position.**
- **Guests are unreachable.** A guest's credits are their device's `localStorage`.
- **For a member, the server copy can be written**, but the CONTENT is client-trusted (L5). The device can `PUT` any
  brigade on its next write. A credit deduction is therefore advisory, not enforced. A grant does stick, because the device
  adopts the server's campaign.
- **No journal exists for credits**, so `admin_action` becomes the only record of an admin credit change.

**Recommended: a guarded server write for members only, behind an activity guard.**
1. **Read** the `campaign_state` row. With no row, answer 409 `{ error: 'no_campaign' }`. The member has never synced a
   campaign, so there is nothing to amend.
2. **A grant** appends `{ source: 'granted', amount: n, at: now }` to `brigade.grants` and adds `n` to `balance`. The Grant
   entry is required: without it `migrateAccount` cuts the balance back on the next read (`brigade.ts:149-176`). A test
   pins this.
3. **A deduction** lowers `balance` only, floored at 0. Grants are never edited, so the bound `balance <= SUM(grants)` still
   holds. `set` becomes a grant or a deduction of the difference.
4. **Left alone:** `earned_total`, `paid`, `campaign_paid`, `unlocks`, `upgrades` and `coupons`. An admin changes a balance,
   never what a member owns.
5. **The write** is `campaignWrite(db, memberId, readRevision, body, now)` with the expected revision from the card (409
   `moved`, as D7.4), in one batch with the `admin_action` insert and the op insert.
6. **The activity guard.** The write is refused with 409 `{ error: 'active', minutes }` when `campaign_state.updated_at` is
   within the last **15 minutes**, unless the admin ticks "The player is offline; write anyway".
   - **Why.** An admin write bumps the campaign revision. A device that is playing then gets 409 `stale` on its next
     `PUT campaign` or victory. It keeps its newer campaign as a conflict slot (or on the held list) and adopts the server's
     (`packages/app/src/account/sync.ts:11-13`, `campaign.ts:167-206`).
   - **What that costs.** Nothing is lost, but the player's latest win can sit in a conflict slot until they load it, and
     loading it would undo the grant.

**Alternatives.**
- **(a) Coins only.** No credit control at all until credits become server-validated (ST6, GH-205). Smallest. But the lead
  asked for credits.
- **(b) A pending credit grant.** A `credit_grant` row is applied by the SERVER onto the next brigade the member writes,
  rebasing the incoming body. No conflict slot appears, even for an online player. It touches the hot campaign and victory
  write paths and the client's cache adoption, so it is a design of its own. It belongs with ST6.
- **(c) A coupon per grant.** Data plus a release for each grant, readable by anyone with the code. Rejected.

### D9. Integrity: the audit table and the batch

**Migration `0003_admin.sql`** (the lead applies it before merge):
- **`coin_journal`** is rebuilt to add `'admin'` to its `kind` CHECK. SQLite cannot widen a CHECK in place, so this is the
  0002 pattern: `defer_foreign_keys`, copy every row with its `id`, then drop, rename and re-index. The only readers that
  branch on `kind` are `claim.ts:242` and `spend.ts:130`, and both select `claim` and `backfill` only, so a new kind
  changes no reader.
- **`admin_member`** (D1).
- **`admin_action`**, append-only, with these columns:
  `id INTEGER PRIMARY KEY, at INTEGER NOT NULL, admin_id TEXT REFERENCES member (id) ON DELETE SET NULL,
  member_id TEXT REFERENCES member (id) ON DELETE CASCADE, action TEXT NOT NULL CHECK (action IN ('coins', 'credits',
  'switch', 'view')), mode TEXT CHECK (mode IN ('grant', 'deduct', 'set')), delta INTEGER, before INTEGER, after INTEGER,
  reason TEXT, op_id TEXT`. It is indexed on `(member_id, id)` and `(at)`.

**Rules.**
1. **One batch.** The balance write, the `coin_journal` row (coins only), the `admin_action` row and the `account_op` row
   commit together or not at all. The page never writes two batches for one change.
2. **The revision guard.** `walletWrite` and `campaignWrite` guard on the revision they read. A lost race is retried at
   most `CAS_TRIES` (3) times, re-reading each time. The admin's EXPECTED revision (D7.4) is checked first, so a retry
   never applies a change on top of a balance the admin did not see.
3. **Idempotency.** The page mints a UUID op id when the confirm dialog opens and sends it with the write. The route uses
   `withOp` keyed on the TARGET member (`op.ts:69-94`), with the kind `admin.coins` or `admin.credits`. A double click, a
   retry or a reload re-submit gets the stored answer back and writes nothing. `budgetedOp` is NOT used: it would charge
   the member's own `acct-ops` day budget for the admin's action.
4. **No negative balances.** Coins are held by the schema CHECK and checked first (D7.2). Credits are floored at 0 in code,
   and a test pins the floor.
5. **Append-only.** No route updates or deletes an `admin_action` or `coin_journal` row. A source test, like A2-27, fails if
   any file other than `admin-write.ts` contains `INSERT INTO admin_action`, or if any file contains `UPDATE admin_action`
   or `DELETE FROM admin_action` (deletion is the tables list's alone).
6. **`MEMBER_TABLES`** gains `admin_action` (exported with `by` reduced to `"admin"`, so a member's export never carries the
   lead's public id) and `admin_member` (never exported). Test A1-8 fails without them. A member's deletion takes their
   `admin_action` rows with it, like the `coin_journal`: once nothing is left to audit, nothing is kept.

### D10. Rate limits

**Recommended:**
- **Writes:** `rate_day` scope `admin-writes`, global, **50 a day**.
- **Coins:** scope `admin-coins`, global, at most **250,000 coins granted a day** (the sum of positive deltas).
- **Lookups:** scope `admin-reads`, global, **500 a day**.
- **Per minute:** the `ACCOUNT_OP_LIMIT` binding (60 a minute per IP).

Over a limit, a write answers 429 and writes nothing. An IP is never stored (the existing keyed hash only). The numbers
are deliberately far above one person's honest use, and far below what a script with stolen sessions could do in a day.

**Alternatives.** No day caps (the switch is the only brake). Or a dedicated `ADMIN_LIMIT` binding, which is a
`wrangler.jsonc` change with a new namespace id. Not needed.

### D11. Determinism and fairness

- **The sim is untouched.** `creditsFor` is never called by the sim (`credits.ts:7-8`). Coins are fenced from the sim, the
  renderer and the net package (`ROAR_FENCE`, GH-317). An admin action writes D1 rows only. No golden hash, replay or
  playtest moves.
- **Only balances change.** No admin route writes `unlocks`, `upgrades`, `entitlements`, `earn` or `earn_lifetime`.
- **Versus, said exactly:**
  - A **matched** room (`kit: 'matched'`) reads nothing from either account and stays byte for byte as it is.
  - A **"Bring your brigade"** room (`kit: 'brigade'`) fields the specials a player owns (coin-bought included) and their
    earned tiers (`packages/net/src/specials.ts:1-22`, `packages/app/src/net/match-world.ts:440-453`). A granted balance
    lets a member BUY more, exactly as a coupon does today. That room is between friends by design (GH-1102), so this is
    accepted and written down, not hidden.
  - The page has **no "give a member a unit" action**.
- **No transfer between members** (accounts spec §2.4, rule 1). The page has no "move from A to B". The §2.4 ceiling
  becomes "925 plus coupons plus admin grants, every one of them journaled". That spec's text is amended in S7.

### D12. The confirm step

Every write goes through a modal dialog (`<dialog>`, focus trapped, Escape cancels). It shows:
- the member (name and public id) and the currency;
- the balance **before → after**, the delta, and the reason.

The primary button names the action, for example "Grant 500 coins". Two further guards:
- A **deduction or a `set`** also needs the member's public id typed into the dialog. A grant needs only the click.
- A **credits write past the activity guard** repeats the warning in the dialog.

While the request is in flight the dialog's buttons are disabled. On success the dialog closes and the new journal row is
highlighted.

### D13. Accessibility

- Every input has a `<label>`.
- Status lines use `aria-live="polite"` and errors use `role="alert"`.
- The journal is a real `<table>` with `<th scope>`.
- Colour is never the only signal: deltas carry a sign and a word ("+500 grant").
- The dialog returns focus to the button that opened it.
- The layout works at 360 px: the journal scrolls inside its own wrapper.

### D14. Privacy

Viewing members' data is processing personal data, so:
1. **The privacy page** (`packages/worker/src/privacy-page.ts`, pinned by `privacy-page.test.ts`) gains two lines:
   - "The Roaring Lions team can view your display name, Player ID, balances and their history, and can correct your coin
     or credit balance. Every view and every change is logged with the reason, and the change appears in your export."
   - "What the team sees never includes your Google or Steam account number."
2. **Access logging.** Every member card opened writes `admin_action (action 'view', member_id, admin_id, at)`. Lookups
   that list several members log nothing per row, but count toward `admin-reads`. View rows older than 180 days are swept
   by the daily cron, which matches feedback retention. Change rows stay while the member does.
3. **Minimum display** (D5): no identity subject, no internal id, no session, no slot, no ledger.
4. **The member's export** includes the admin changes made to them, with the reason, `by: "admin"` and no admin id.
5. **Telemetry stays out.** The page never writes `env.DB`, so nothing about a lookup lands in telemetry.

---

## 3. Routes (for the plan; the exact shapes are settled in S2 and S3)

| Method and path | Needs | Does |
|---|---|---|
| `GET /stats/members` | `stats_session` | the page (CSP as D2) |
| `GET /stats/api/members/whoami` | `stats_session` | `{ admin, publicId \| null, open }` |
| `GET /stats/api/members/find?q=` | `stats_session` | up to 20 rows (D5); `q=me` resolves the member cookie |
| `GET /stats/api/members/:publicId` | `stats_session` | the card (D6); logs a `view` |
| `GET /stats/api/members/:publicId/journal?before=&currency=` | `stats_session` | 50 journal rows |
| `POST /stats/api/members/:publicId/coins` | both sessions, an admin, `flags.admin` open | `{ op_id, mode, amount, reason, revision }` (D7) |
| `POST /stats/api/members/:publicId/credits` | the same | `{ op_id, mode, amount, reason, revision, force_offline? }` (D8) |
| `POST /stats/api/members/switch` | both sessions, an admin | `{ open: false }` only (D3) |

`/stats/api/members/blank` keeps its path and behaviour.

---

## 4. UI (see the mock)

The visual direction is that of `/stats/feedback`:
- limestone ground and surface, shadow ink, gunmetal rules, olive accent, terracotta for "bad", scrub for "good";
- Big Shoulders Display for headings, Barlow for text, IBM Plex Mono for ids and numbers;
- flat 1 px rules and no shadows.

The page is laid out top to bottom:
1. **Header**: the nav, with Members marked current. An "admin writes: OPEN" chip and the "Close admin writes" button sit
   on the right.
2. **Find a member**: one input, a Find button and a Me button, then the results table.
3. **The member card**: two balance blocks side by side (Roar coins, Brigade credits), each with its revision and last
   change. Below them is a strip of sign-in kinds as words.
4. **Change a balance**: a currency toggle, a mode toggle (grant, deduct, set), the amount, the reason (required, with a
   character count), a preview line ("12,400 → 12,900") and a Review button that opens the dialog.
5. **The journal table**.
6. **The confirm dialog**.

---

## 5. Proofs (every gate gets an input that makes it fail)

Each slice lands with its tests AND the mutation that turns each one red, recorded in the commit message (CLAUDE.md,
"Every check gets an input that makes it fail").

| Check | Test | Falsifying mutation |
|---|---|---|
| `wallet.free = SUM(free_delta)` after admin writes | a random sequence of earns, spends and admin grant/deduct/set, then the sum compared to the row | write the journal delta as `amount` instead of `after - before` on `set` |
| Exactly one write per op id | the same body POSTed twice: one journal row, two identical answers | call `build` without `withOp` |
| Stale expected revision refuses | a card read, then a victory, then a write: 409 `moved`, no rows | drop the expected-revision comparison |
| Range is 409 `range`, not 500 | `set` to 1,000,001 and `deduct` past 0 | remove the pre-validation (the CHECK then answers 500) |
| Reason required | an empty reason, 7 characters, 201 characters | lower the minimum to 0 |
| Writes need both sessions and an admin row | four requests, each missing one factor: 401 or 403 | drop the `admin_member` lookup |
| Switch closed means no write | `flags.admin` missing, then `'closed'`: 503 | read the flag with `!== 'closed'` instead of `=== 'open'` |
| The page can close but not open | POST `{ open: true }`: 400 | accept a boolean |
| Strict Origin | a missing, foreign or `ALLOWED_ORIGINS` origin: 403 | call `originAllowed` (which honours `ALLOWED_ORIGINS`) |
| Never reads `env.DB` | every route with `DB` undefined succeeds | a stray `env.DB` count in the card |
| Never returns an identity subject | a member with Google and Steam; the answer JSON has no `sub`/SteamID text | select `subject` in the kinds query |
| Credits grant survives `migrateAccount` | `migrateAccount(after).balance === before + n` | omit the `granted` Grant entry |
| Credits activity guard | `updated_at` 5 minutes ago: 409 `active`; with `force_offline`: 200 | compare against 15 seconds |
| `admin_action` append-only | a source scan, like A2-27 | add an `UPDATE admin_action` anywhere |
| Tables list complete | A1-8, extended | remove `admin_action` from `MEMBER_TABLES` |
| Export hides the admin id | the export of a granted member has `by: "admin"` | export the raw `admin_id` |
| Member strings render as text | a source scan of `members-page.ts` for `innerHTML` near a name or reason | build the results rows with `innerHTML` |

`pnpm test:determinism` is not affected: no file under `packages/sim` changes.

---

## 6. Slices (1 to 2 hours each), order, and what merging deploys

**Merging to `main` deploys** (the Worker builds from `main`). Every slice is inert until the lead's steps are done.

| # | Slice | Depends on | Deploys |
|---|---|---|---|
| S1 | Migration `0003_admin.sql` (`coin_journal` rebuild, `admin_member`, `admin_action`), `JournalKind` gains `admin`, `MEMBER_TABLES` and the export, A1-8 extended. No route. | none | nothing visible; the **lead applies the migration BEFORE this merges** |
| S2 | `adminGuard`: the stats session, the member session, `admin_member`, `flags.admin`, Origin, the header, content-type and body cap; `whoami`; the switch (close only) | S1 | `whoami` answers `admin: false` until the lead's row exists |
| S3 | Read API: `find` (id, name prefix, `me`), the card, the journal (coin plus admin, paged), `view` logging, day caps for reads | S2 | read-only lookups for a password session |
| S4 | Coin write route: modes, reason, range, per-action and day caps, expected revision, `walletWrite` plus `admin_action` plus `withOp` in one batch, CAS retry | S3 | coin writes, once the lead's row exists and `flags.admin` is open |
| S5 | The page `/stats/members` (`members-page.ts`): lookup, card, form, dialog, journal, Close button, CSP, nav link from `/stats` and `/stats/feedback` | S3 (S4 for the form) | the page |
| S6 | Credits write route (D8) with the activity guard, the Grant entry and the floor, plus the credits half of the form | S4 and S5, and **the lead's ruling on D8** | credit writes |
| S7 | Privacy page lines (D14), the 180-day `view` sweep in `scheduled`, docs: `shell-and-ui.md` "Admin members page", the CLAUDE.md dev-instruments line, the accounts spec §2.4 ceiling text | S4 | the privacy text; it ships no later than S4 goes live |

Order: S1 → S2 → S3 → (S4 ∥ S5) → S7 → S6. A reviewer for each of S2, S4 and S6, because they hold the security and money
rules.

**The lead's steps** (the agent never runs `wrangler`):
1. Before S1 merges: `npx wrangler d1 migrations apply roaring-lions-accounts --remote`.
2. After S2 is deployed, sign in to the game in the browser you use for `/stats`, then add yourself (your public id is
   shown on your profile):
   `npx wrangler d1 execute roaring-lions-accounts --remote --command "INSERT INTO admin_member (member_id, added_at) SELECT id, unixepoch() * 1000 FROM member WHERE public_id = '<YOUR-PUBLIC-ID>'"`
3. After S4 and S7 are deployed, open the writes:
   `npx wrangler d1 execute roaring-lions-accounts --remote --command "INSERT INTO flags (name, value, updated_at) VALUES ('admin', 'open', unixepoch() * 1000) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"`
4. No new secret. `STATS_PASSWORD` is unchanged; rotating it still signs every admin out.

---

## 7. Risks and open questions (each with a recommended default)

1. **Q1. Are credits in scope now, given they are client-trusted?** *Default: yes, as D8, shipped second (S6), with the
   activity guard.* Alternative: coins only until ST6 (GH-205) makes credits server-validated.
2. **Q2. The per-action and daily caps.** *Default: 100,000 coins per action (the GH-755 coupon), 250,000 a day; credits
   100,000 per action.* Alternative: no cap below `MAX_COINS`.
3. **Q3. The audit for a member who deletes their account.** *Default: the `admin_action` rows go with the member (D9.6).*
   Alternative: keep them with `member_id` NULL and the reason blanked, as `match_seat` keeps an anonymous seat. That
   keeps "how much was granted in total" at the cost of a row that outlives its member.
4. **Q4. A fresh re-sign-in for deductions and `set`.** *Default: not required.* Alternative: require
   `session.fresh_until` (5 minutes) on those two modes only.
5. **Q5. Should a grant show in the player's Stores history?** *Default: no receipt (`receipt: null`); the balance moves
   and the journal and export explain it.* Alternative: a `grant` receipt kind in `@lions/economy` and `migrateRoar`, as a
   separate client change.
6. **Q6. A player's `reset-free` wipes admin-granted coins.** *Default: accept, as for coupon coins.* Alternative: count
   admin grants as coupon-like, so a reset keeps them. That changes `resetFree` in `@lions/economy`.
7. **Q7. A credits write while the player is online parks their newer campaign in a conflict slot.** *Default: the
   15-minute activity guard plus an explicit override (D8.6).* Alternative: the pending-grant design (D8 alternative b),
   with ST6.
8. **Q8. A credit deduction is advisory** (the device can re-`PUT` its old balance). *Default: say so on the page beside
   the credits form.* No alternative short of ST6.
9. **Q9. Two admins.** *Default: the lead only; the table allows more, and adding one is a `wrangler` row.* Roles
   (read-only, grant-only) wait for GH-695's next slice.
10. **Q10. "Bring your brigade" rooms can field what a grant buys.** *Default: accepted, written down (D11), as with
    coupons.* Alternative: refuse admin-granted coins for bought-only specials. That is a new entitlement source flag, and
    a design of its own.
11. **Q11. The §2.4 coin ceiling no longer holds.** *Default: amend the text in S7 to "plus admin grants, journaled".*
12. **Q12. Does the "Me" shortcut read the member cookie on a `/stats` request?** *Default: yes, read-only; it resolves to
    a public id and is never stored.* Alternative: the lead types his own public id.
13. **R1. Two sessions stolen together** (one shared browser) mint up to the daily cap. Mitigations: the day caps, the
    journal, and the Close button, which a stolen session cannot undo.
14. **R2. The `coin_journal` rebuild copies every row.** At today's volume that is seconds. The migration keeps `id`, so
    `ORDER BY id` and receipt order are unchanged. It is checked against a copy in the S1 test (`test-d1.ts` runs the real
    migrations).
15. **R3. A typo in a `set`** can erase a balance. Mitigations: the public-id confirmation (D12), the journal (the before
    value is kept, so it can be set back), and the expected revision.
