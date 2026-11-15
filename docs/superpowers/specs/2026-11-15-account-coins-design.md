# Coin total and coin history on the account page (GH-1370): design

**Status:** design only. No code ships with this document.
**Issue:** GH-1370. The lead (15 Nov 2026): "In the account page, I need also to see the total of my coins and history of
purchase or grants. As a user, this is an expected function."
**Builds on:** the accounts spec (`2026-11-07-accounts-profiles-design.md`, §1.8, §1.9, §2.4, §2.5), the P7 page
(`2026-11-14-avatars-and-profile-design.md`), the admin page (`2026-11-14-admin-account-page-design.md`, D7, D14) and
the colour pass (`2026-11-15-profile-colour-design.md`, GH-1367 option C, PR 1369; its S1 is PR 1371).
**Mock sheet:** `2026-11-15-account-coins-mock.png`, beside this file.

---

## 0. Summary

- **A "Roar coins" card** on the account page, in the main column under the header card. It shows the balance with the
  Stores' own coin and digits. It reads the balance from the same `LedgerStore.readRoar()` and `spendable()` the Stores
  read, so the two cannot disagree.
- **The coin history** sits in the same card, newest first, 20 rows a page, with a "More" button. Every journal kind has
  a worded row (§2.2). An admin change reads "From the team" or "Corrected by the team". It carries a note only when the
  admin wrote one for the player. That note is a new optional field: the audit `reason` is never shown.
- **A member route**, `GET /api/account/coins?before=<id>&limit=<n>`. It returns the caller's own `coin_journal` rows
  through an allow-list of fields. It never returns `detail` verbatim, never joins `admin_action`, and returns no balance.
  It sits behind the same header, session and per-minute limiter as `GET matches`, and writes nothing.
- **The unclaimed-device hint.** A signed-in device that has not moved its guest progress shows its own coins. The card
  says so, labels the number "On this device", and calls the existing claim action. The Stores show the same line, with a
  link to the account page's claim banner.
- **Six slices** of 1–2 hours each (§5). The two Worker slices touch nothing GH-1367 touches and can merge first. The app
  slices merge after GH-1367 S1 (PR 1371) and keep their CSS in a block of their own.

## 1. How the mock was made

- **Method.** This repeats GH-1367 §1 and its Appendix A.
  - Every frame is the real `/profile` route, or `/brigade` with the Stores tab open, on the worktree dev server
    (port 5235, `?accounts`).
  - All frames were captured in one headless Chromium session: SwiftShader, device pixel ratio 1, `--ui-scale` 1, music
    off (`musicOffInitScript()`).
- **Seeds.**
  - *Claimed.* `lions.account` with `claimedAt`, plus a `lions.account.cache` shaped like `fixtures.ts`'s
    `cacheOf(confirmedState())` with `wallet.free` 1,285.
  - *Unclaimed.* `lions.account` without `claimedAt`, plus guest keys (`lions.campaign.ledger`, and `lions.roar` at 340).
    The REAL claim banner is drawn by `mountClaim`.
- **Stubs.** `open`, `me`, `matches` and `state` are answered by `page.route` stubs. A catch-all logged no unstubbed
  call, and no frame had a console error.
- **Injected, not shipped.**
  - The CSS is GH-1367 option C's four sheets, verbatim from its Appendix A, plus this design's `coins.css` (Appendix A
    here).
  - The coin card and the Stores hint are DOM injected after the page settles. `profile.ts` and `stores.ts` are
    unchanged.
  - The player, the ids and the history rows are fictional. The mission and unit names are real data, and the longest
    ones were chosen on purpose ("Shmamit Deep Recon Team", "Ein Qasab III — One Road").
- **Frames.**
  1. Desktop 1440, claimed.
  2. Desktop 1440, unclaimed.
  3. Narrow 400, claimed.
  4. Narrow 400, unclaimed.
  5. Three card states at 400: empty, a Buy still in flight, offline.
  6. The Stores head with the hint.

## 2. The coin card

### 2.1 The balance

- **Where.** In the main column, directly under the header card and above Record (frame 1). Most players play the
  campaign, not versus, so coins come before the W-L. Below 56rem the page is one column in source order, so the card
  stays second (frame 3). Lead decision D1.
- **What the number is.** `spendable(deps.coins.read())`, where `read` is `() => ledgerStore.readRoar()` passed from
  `main.ts`. That is the closure the Stores' `read()` already uses (`main.ts:1313`). One function over one store means
  the card and the Stores always show the same number:
  - claimed: the server-backed `accountLedgerStore`, which is the server's wallet as cached;
  - unclaimed: the guest `browserLedgerStore`, which is the device's wallet (§4).
- **The route carries no balance.** A second source would be a second number. The history never recomputes a balance
  from its rows either: the journal can sum differently from the device copy while a Buy is in flight.
- **Paid coins.** `wallet.paid` is fenced by `CHECK (paid = 0)` and by `walletWrite`'s throw, and `PURCHASES_OPEN` is
  false. Until ST7 lifts both, the card shows ONE number with no split. When `coins.paid > 0` can happen, the line under
  the number becomes `profile.coins.split`, "{free} earned · {paid} bought". The big number stays `spendable()`. This is
  written now so ST7 does not invent a second layout (D9).
- **Under the number.** "On your account" when the store is the account store, "On this device" otherwise.
- **Refresh.** The number is read when the card mounts and again when each history page lands (§2.3). The sync loop
  replaces `cache.confirmed` with a new object, so a re-read always sees the newest copy. There is no polling.

### 2.2 The history rows

Each row has three cells: when, what, and the signed amount.

- **When.** The date and the time, as the Stores' Receipts shelf shows them (`toLocaleDateString()` and `hh:mm`). At
  400 px the time wraps under the date.
- **What.** Built from the wire `what` (§3.2) through `t()`. A mission or unit name is resolved on the client through
  `deps.coins.names`, the same `missions[id].name` and unit data that the Stores' `missionName` and `opts.units` read.
  **A raw id is never shown.** An id the build no longer knows (a retired mission, an unknown unit) gets the generic
  wording in the "Unknown id" column.
- **Amount.** `+{n}` or `−{n}`, with U+2212, in the mono face. The sign carries the meaning, so colour is never the only
  signal.

| Journal kind | Server `what` | Row text (en.json) | Unknown id | Amount |
|---|---|---|---|---|
| `earn`, source `welcome` | `{kind:'earn', source:'welcome'}` | "Welcome issue" | — | + |
| `earn`, source `first_win` | `…, missionId` | "First win: {mission}" | "First win of a mission" | + |
| `earn`, source `star` | `…, missionId` | "New stars: {mission}" | "New star on a mission" | + |
| `earn`, source `campaign` | `{source:'campaign'}` | "Campaign complete" | — | + |
| `earn`, any other source | `{source}` | "Mission reward" | — | + |
| `backfill` (a member's first device claim) and `claim` (a later device) | `{kind:'move'}` | "Guest progress moved to your account" | — | + (or 0, see below) |
| `unit` | `{kind:'unit', unitId, moved}` | "Bought: {unit}"; with `moved`, "Carried over in the move: {unit}" | "Bought: an item" | − |
| `tier` | `{kind:'tier', unitId, track, tier, moved}` | "Bought: {unit} {track}, tier {tier}" (the Receipts' `stores.receipt.tier` inside); with `moved`, prefixed as above | "Bought: an upgrade" | − |
| `coupon` | `{kind:'coupon'}` | "Code redeemed" | — | + |
| `reset` | `{kind:'reset'}` | "Brigade reset: free coins cleared" | — | − |
| `admin`, delta > 0 | `{kind:'team', note?}` | "From the team", then the note on its own line in quotes | — | + |
| `admin`, delta < 0 | `{kind:'team', note?}` | "Corrected by the team", then the note | — | − |
| any kind a later migration adds | `{kind:'other'}` | "Coin change" | — | ± |

Notes on the table:

- **Stars.** The number of stars is not in `detail` (the receipt carries only the coins), so the row does not count them.
- **Coupons.** The coupon id (`lead_roar_coins_100k`) is internal and is never sent.
- **The move.** A claim writes one move row, plus one `unit` or `tier` row per coin purchase it carried over, all with
  the claim's `op_id`. The server marks those with `moved: true` (§3.3), so the player sees "+405 moved" and "−60
  carried over: Sniper Team" rather than a purchase they do not remember. The move row shows even at 0: the move
  happened, and the player should see it. Every other zero-amount row (a reset of an empty wallet) is dropped in SQL, so
  pages stay full (D6).
- **The note** (§2.4) is admin-typed text. It goes into the DOM as a text node, never through `t()` and never as HTML,
  as the bot-model label already does.

### 2.3 Paging, empty, pending, offline, signed out

- **Paging.** The first page loads with the card. "More" (the existing `profile.history.more`) asks for
  `before=<next>`, appends the rows and hides itself when `next` is `null`. While a page is in flight the button is
  disabled. A late answer after the disposer has run is ignored (`disposed`, as `page()` does today).
- **Empty.** No rows and `next` is `null`: "No coins yet. Win a campaign mission to earn your first Roar coins." The
  welcome issue is paid on the first victory, so a new member sees this (frame 5).
- **Pending.** A coin Buy is a barrier op, never queued. While `pendingSpends.size > 0` on the account store, the card
  shows a line above the rows: "{n, plural, one {One purchase is} other {# purchases are}} still being sent. It will show
  here once it lands." (frame 5). When the Buy lands, the next card mount reads the new balance and the new row.
- **Offline or failed.** The balance still draws, because it is the store's cached copy and needs no network. The
  history shows "Your coin history needs a connection." and a "Try again" button that re-asks the same page (frame 5).
- **429.** The page's existing `profile.result.limit` line, with "Try again".
- **401.** The card is never built: `resolveSignedIn` already turns a dead session into the signed-out view.
- **Signed out (guest).** The guest view is unchanged and shows no coin card. The Stores already show a guest their
  device coins, and the guest card is the sign-in pitch (D5).
- **Accessibility.**
  - The rows are a real `<table>` with visually hidden `<th scope="col">` headings: When, What, Coins.
  - The status lines use `aria-live="polite"`, like the page's existing status line.
  - The amounts' accessible text is the signed number. A screen reader reads U+2212 as "minus".

### 2.4 The admin note: how a reason becomes player-facing

Today `POST /stats/api/members/:id/coins` takes a required `reason` (8–200 characters). It is audit text, written for
the team ("test grant, GH-1234 repro"). The form has no way to say "the player may read this".

**The smallest change: an optional `note`, 0–80 characters, beside the reason** (D2).

- **The form** (`members-page.ts`). One more input under the reason: "Note to the player (optional, shown in their coin
  history)", with a character count. The confirm dialog adds a line: Player sees: "From the team: “…”", or "From the
  team" alone when the note is empty.
- **The route** (`admin/coins.ts`).
  - `note` is optional. It is cleaned with the same `cleanReason`.
  - Empty after cleaning means absent. More than 80 code points is 400 `{ error: 'note' }`, with nothing written.
  - It is stored as `detail.note`. `detail` is JSON, so there is **no migration**.
  - `admin_action` is unchanged. The admin journal (`api.ts`) shows the note by reading `coin_journal.detail` on
    `(member_id, op_id)`.
- **What the member route sends.** Only `detail.note`, never `detail.reason`. Rows written before this slice have no
  note, so they show "From the team" alone.
- **Why not a "show the reason" checkbox?** The reason must be at least 8 characters and is written for the audit. A
  player-facing sentence is a different text with a different reader. Two fields also make a slip impossible: ticking a
  box cannot publish an internal reason.
- **Said plainly.** `GET export` already gives the member `detail` verbatim, reason included (admin spec D14.4). The
  note is about what the PAGE shows, not about secrecy. Reasons should still be written knowing the member can download
  them.

### 2.5 The colour role (GH-1367 option C)

The issue asks the coin card to take the record card's treatment: a filled head strip with `--band-ink` text and a
matching hairline. The colour is the coin's own.

- **The head and the hairline.**
  - The head is `--card-head-coins: var(--roar-deep)` (`terracotta.2`).
  - The hairline is `color-mix(in srgb, var(--roar) 45%, transparent)`.
  - GH-1367 §3 B keeps terracotta out of Danger and Lost *because `--roar` owns that ramp*. The coin card is the ramp's
    owner, so this is the use that spec reserved it for.
- **The number** is the Stores' `--roar` mono numeral beside the same `roar_coin_48.png`. It is large text (2.25rem).
- **The rows.**
  - Amounts are in `--ink`. Incoming amounts are in `--accent`, gold, the coin colour.
  - `--good` and `--roar` are NOT used for small text: on `--card-bg` they measure 4.20:1 and 4.10:1, under AA for body
    text.
- **The hint well** is `--well`, with the claim banner's own `--band-mission` left rule, so the two read as one action
  (frame 2).
- **Contrast.** These are WCAG 2.x ratios from the palette hexes. As in GH-1367 §4, the panel over the warm ground
  lowers each by about 0.1.

| Pair | Ratio | Needs |
|---|---|---|
| `--band-ink` (`limestone.0`) on the head (`terracotta.2`) | 6.97:1 | 4.5 |
| `--roar` (`terracotta.0`) balance digits on `--card-bg` | 4.10:1 | 3 (large) |
| `--ink` row text on `--card-bg` | 13.53:1 | 4.5 |
| `--accent` (`dust.0`) incoming amount on `--card-bg` | 8.86:1 | 4.5 |
| `--ink-mute` date and "On your account" on `--card-bg` | 6.63:1 | 4.5 |
| `--ink-dim` note on `--card-bg` | 5.32:1 | 4.5 |

- **Colour vision.** The head is close in warmth to the Danger head and the Lost tile. That is acceptable, because every
  card carries its title word and the coin glyph. Nothing on the card re-points under `data-cvd`, and nothing needs to:
  no meaning is carried by hue.
- **Without option C.** If GH-1367 stops after S1 or S2, the card keeps the plain F-level title (`--ink-label` with a
  rule) and only the `--roar` numeral. Slice C5 is then not built.

## 3. The member route

### 3.1 Shape

```
GET /api/account/coins?before=<id>&limit=<n>
200 { rows: CoinRowView[], next: string | null }     cache-control: no-store
400 { error: 'query' }   401 (no or dead session)   403 (no x-rl-account)   429 { error: 'limit' }   503 (not configured)
```

The wire types live in `@lions/economy`'s `account-wire.ts`, beside `MatchesView`:

```ts
export type CoinWhat =
  | { kind: 'earn'; source: string; missionId?: string }
  | { kind: 'move' }
  | { kind: 'unit'; unitId: string; moved: boolean }
  | { kind: 'tier'; unitId: string; track: string; tier: number; moved: boolean }
  | { kind: 'coupon' }
  | { kind: 'reset' }
  | { kind: 'team'; note?: string }
  | { kind: 'other' };
export interface CoinRowView { at: number; delta: number; what: CoinWhat }
export interface CoinsView { rows: CoinRowView[]; next: string | null }
```

### 3.2 Rules

- **Whose rows.** `session.memberId` from `requireSession`, never a parameter, exactly as `matches.ts` does. No path or
  query names a member.
- **Gates.** The route needs:
  - the `x-rl-account: 1` header (`accountGuard`; a GET skips the Origin check, as every account GET does, §1.8);
  - `ACCOUNT_OP_LIMIT` at 60 a minute per IP (the dispatcher's signed-in class: `coins` is NOT added to
    `UNLIMITED_HERE`);
  - no day budget, because a read writes no row (as `matches`);
  - `accountJson`, which sets `no-store` and no CORS header.
- **Query validation.**
  - `before` must match `/^\d{1,15}$/`. `limit` must match `/^\d{1,2}$/` and lie in 1..`COINS_PAGE_MAX` (50).
  - The default `limit` is `COINS_PAGE_DEFAULT` (20). Anything else is 400 `query`.
  - The error never echoes input (the leak sweep's REQ sentinel).
- **The allow-list.** The SELECT names only `at`, `kind`, `free_delta` and seven `json_extract` paths: `source`,
  `missionId`, `unitId`, `track`, `tier`, `note`, plus the `moved` subquery.
  - `detail` itself is never selected, so `reason`, `before`, `after`, `by`, `receipt`, `ceilingCut`, `coupons`,
    `couponIds`, `earned`, `couponCoins` and `op_id` cannot reach the answer.
  - The query never touches `admin_action` or `member`, the only places an admin's identity lives.
  - Each extracted value is type-checked before it enters the wire object. A non-string `missionId` is dropped, and the
    row then words generically.
- **Damaged detail.** Every `json_extract` sits behind `CASE WHEN json_valid(j.detail)`. A row whose detail is not JSON
  becomes a row with only its kind, not a 500.
- **Cursor and order.** `ORDER BY j.id DESC`, `j.id < ?before` on the existing `coin_journal_member (member_id, id)`
  index. The query fetches `limit + 1` rows. `next` is the last returned row's id, as a string, only when the extra row
  exists, so an exact multiple of the page size gives no false "More". The journal's id is its order (append-only, and
  `ORDER BY id` is already the wallet invariant's order). A row id is not returned per row.
- **The cap.** At most 50 rows. A row is at most about 220 bytes of JSON: a 64-character id, an 80-code-point note
  (320 bytes at worst in UTF-8) and keys. **The body is bounded at 32 KiB** (`COINS_BODY_MAX`), and a test proves the
  worst case fits.

### 3.3 The query

```sql
SELECT j.id, j.at, j.kind, j.free_delta,
  CASE WHEN json_valid(j.detail) THEN json_extract(j.detail, '$.source')    END AS source,
  CASE WHEN json_valid(j.detail) THEN json_extract(j.detail, '$.missionId') END AS mission_id,
  CASE WHEN json_valid(j.detail) THEN json_extract(j.detail, '$.unitId')    END AS unit_id,
  CASE WHEN json_valid(j.detail) THEN json_extract(j.detail, '$.track')     END AS track,
  CASE WHEN json_valid(j.detail) THEN json_extract(j.detail, '$.tier')      END AS tier,
  CASE WHEN json_valid(j.detail) AND j.kind = 'admin' THEN json_extract(j.detail, '$.note') END AS note,
  EXISTS (SELECT 1 FROM coin_journal c
          WHERE c.member_id = j.member_id AND c.op_id = j.op_id AND c.kind IN ('claim', 'backfill')) AS moved
FROM coin_journal j
WHERE j.member_id = ?1 AND j.id < ?2
  AND (j.free_delta != 0 OR j.kind IN ('claim', 'backfill'))
ORDER BY j.id DESC
LIMIT ?3            -- limit + 1
```

`moved` is computed for `unit` and `tier` rows only; the mapper ignores it elsewhere. The subquery is bounded by the
member's own rows: a few hundred at most, since the earn table's lifetime ceiling is 925 coins.

### 3.4 Tests (each with the one-line mutation that must turn it red)

Worker, in `packages/worker/src/account/coin-history.test.ts`:

| # | What | Mutation that goes red |
|---|---|---|
| T1 | M sees only M's rows. A THIRD member's rows (with sentinel note and mission id) never appear | drop `j.member_id = ?1` |
| T2 | Allow-list: M's own admin row (sentinel reason, `before`, `after`) and claim row (sentinel coupon id, `ceilingCut`) produce no sentinel, `reason`, `before`, `by`, `receipt` or `op_id` in the body | return `JSON.parse(detail)` as `what`; or add `reason` to the SELECT |
| T3 | The admin's identity: an `admin_action` row for M by an admin whose public id is a sentinel; the body never holds it | join `admin_action` / `member` for the admin name |
| T4 | A note is shown only from `detail.note`: a note row has `what.note`; a reason-only row has no `note` key | map `reason` into `note` |
| T5 | Paging: 45 rows at `limit=20` give 20, 20, 5. Ids strictly fall, there are no duplicates, the union is all 45, and the last `next` is `null`. With exactly 40 rows, page 2's `next` is `null` | `<` to `<=` (duplicates); `next` from `length === limit` (false More at 40) |
| T6 | A zero-amount `claim` row is listed; a zero `reset` is not | drop the `free_delta != 0` clause, or drop the `kind IN` exception |
| T7 | `moved` is true for a `unit` row that shares its op id with a `backfill` row, and false for a plain spend | `EXISTS(...)` to `1` |
| T8 | Query bounds: `limit` 0, 51, `x`, `1e3` and `before` `abc`, `-1`, 16 digits are each 400 `query` | `COINS_PAGE_MAX` to 500 (51 passes) |
| T9 | No cookie: 401 | skip `requireSession` |
| T10 | The limiter: with `ACCOUNT_OP_LIMIT` denying, `GET coins` is 429 (this route, asserted by name) | add `'coins'` to `UNLIMITED_HERE` |
| T11 | A GET writes nothing: row counts of every member table (`DELETE_MAP`) and `rate_day` match before and after | wrap the handler in `budgetedOp` |
| T12 | The cap: 50 admin rows, each with an 80-code-point four-byte note, give a body at most `COINS_BODY_MAX` | raise the note cap in `admin/coins.ts` to 800 (the T12 fixture is built from that constant) |
| T13 | A row whose `detail` is not JSON (hand-inserted) still answers 200; the row comes back with its kind and no extracted fields, never a 500 | drop the `json_valid` guard |

**Leak sweep** (`leak-sweep.test.ts`). The generic loop picks the route up from `ACCOUNT_ROUTES` with no edit, but
vacuously: today neither M nor THIRD has a journal row. The additions:

1. **THIRD's journal.** Seed THIRD (`p1`) with an `earn` row (`missionId` `SENTINEL-THIRD-MISSION`) and an `admin` row
   (`reason` `SENTINEL-THIRD-REASON`, `note` `SENTINEL-THIRD-NOTE`). Add the three to `OTHER`. *Mutation:* drop the
   member filter, and every scenario goes red.
2. **The admin's identity.** Seed an admin member `p2` with public id `ADMN4444` in `admin_member`, plus an
   `admin_action` row about M by `p2`. Add `ADMN4444` to `OTHER`. *Mutation:* join `admin_action` for `by`.
3. **The 400 path.** Add `QUERY['coins'] = '?before=${REQ}-b&limit=${REQ}-l'`, so a 400 that echoes the query is
   caught by REQ.
4. **Not vacuous.** Add a separate `it`: signed in, `GET /api/account/coins` answers 200 with at least one row (seed M
   with an `earn` and a `spend` row). Without it, a route that always answered `{rows: []}` would pass the sweep.
5. **M's own reason** cannot go in `OTHER`: `GET export` returns it legitimately. It is covered by T2, scoped to this
   route.

App:

| # | What | Mutation |
|---|---|---|
| A1 | The card and the Stores agree: one fake store renders the Stores head and the coin card, and the numbers match. Then the store's wallet changes, and both re-reads match again | the card reads `me` or the route instead of `deps.coins.read()` |
| A2 | Wording table: one row per kind and source gives its exact en text. An unknown mission or unit id gives the generic text and never the id | fall back to the id |
| A3 | A note `<img src=x onerror=alert(1)>` renders as literal text, and the card holds no `img` but the coin | build the row with `innerHTML` |
| A4 | Paging: `client.coins` is called with `next`. "More" hides on `null`. A late answer after dispose touches nothing | drop the `disposed` check |
| A5 | Offline: a `network` answer keeps the balance, shows the offline line, and "Try again" re-asks the same cursor | clear the balance on error |
| A6 | Unclaimed: a binding without `claimedAt` gives "On this device", the hint and the shared claim button. A claimed binding gives neither | show the hint on `binding !== null` |
| A7 | Stores hint: shown only with accounts on, a binding, and no `claimedAt`; it links to `routes.profile()` | drop the `claimedAt` check |
| A8 | `?pseudo=1`: every new chrome string is bracketed; `__lionsI18n.missingKeys()` is empty | a literal string in `profile.ts` |

`pnpm validate:ui` (no colour literals, no bare chrome strings) runs on each app slice. CI's `tsc` catches every fake
`AccountClient` that lacks `coins` (most spread `unusedA2Client`, which gains `coins: unexpected('coins')`).

## 4. The unclaimed-device hint

**When it shows.** Accounts on, `readBinding()` present, and `claimedAt` undefined. That is the same test
`selectLedgerStore` uses to hand the device the guest store, so the hint shows exactly when the number is the device's.

**It stays true through every claim outcome.** `runClaim` sets `claimedAt` only on `moved`, after which the page
hard-reloads onto the account store. `kept`, `retry`, `blocked` and `failed` leave it unset, so the device is still
showing its own coins. After `kept` (a refusal the server will repeat, such as `claim_cap`), the hint's button hides,
as the banner's "Move it" already does. The text stays.

**A device with no guest progress** claims quietly on the account page (§0.41). It then reloads with `claimedAt` set,
so it sees the hint at most once, in the Stores, before it first visits the account page.

**Text** (`account.claim.deviceHint`): "This device still shows its own coins. Move your progress to see your
account's."

**On the account page** (frames 2 and 4):

- The coin card labels the number "On this device" and puts the hint in a `--well` box under it, with a "Move it"
  button.
- The button is the claim banner's own action. `mountClaim`'s `go`, `verdict` and state line become one small
  `claimControl` (`run()`, a subscriber list) created once per mount. The banner's "Move it" and the card's "Move it"
  both call `run()`, both disable while it runs, and both show the verdict.
- "Not now" removes only the banner. The card's hint stays, because it explains the number rather than asking.
- The history sub-heading becomes "Your account's coin history" (`profile.coins.historyAccount`). The rows are the
  account's, so they need not add up to the device's number (D3).

**In the Stores** (frame 6):

- The same sentence goes in a `--well` box under the wallet head (`.rl-stores__device-hint`, `role="note"`).
- Its button is a link, "Move it on your account page", to `routes.profile()`, where the banner and its "Download a
  copy first" live.
- Running the claim inside the Stores would skip that choice, and the Stores would redraw under a wallet that changes
  mid-render (D4).
- `GarageStoresOptions` gains `deviceHint?: { href: string }`, set by `main.ts` from `accountsOn` and the binding. The
  Stores read no storage themselves.

## 5. Slices

Each slice is 1–2 hours, one PR, and tests-first (the mutation in §3.4 is run and seen red before the code is written).

| # | What | Files | Overlap with GH-1367 |
|---|---|---|---|
| C1 | **The member route**: `coin-history.ts` (named apart from `admin/coins.ts`), the `routes.ts` entry, `COINS_PAGE_*` and `COINS_BODY_MAX` in `config.ts`, the wire types, T1–T11 and T13, the leak-sweep additions, the accounts-spec §2.5 row and a `shell-and-ui.md` line | `packages/worker/src/account/*`, `packages/economy/src/account-wire.ts`, docs | none |
| C2 | **The admin note**: `note` in `admin/coins.ts`, the form field and dialog line in `members-page.ts`, the note in the admin journal, T12, and the `members-page.test.ts` "renders as text" scan extended to the note | `packages/worker/src/admin/*`, `members-page.ts` | none |
| C3 | **The card and history** (frame 1): `client.coins()`, `ProfileDeps.coins` (`read`, `names`, `pending`), the card in `profile.ts`, en.json keys, A1–A5 and A8, and a coin CSS block placed AFTER the profile block in `theme.css`, using only F-level tokens | `packages/app/src/account/client.ts`, `fixtures.ts`, `ui/profile.ts`, `main.ts`, `i18n/en.json`, `theme.css` | `theme.css` and `profile.ts` |
| C4 | **The hint** (frames 2, 4 and 6): the `claimControl` extraction in `profile.ts`, the Stores box, `GarageStoresOptions.deviceHint`, A6 and A7 | `ui/profile.ts`, `ui/stores.ts`, `ui/brigade.ts`, `main.ts`, `en.json`, `theme.css` | `profile.ts` and `theme.css` |
| C5 | **The colour role** (§2.5): `--card-head-coins` and the hairline, added to S3's token group, and the §2.5 pairs added to S3's contrast test. *Mutation:* `terracotta.2` to `terracotta.1` on the head, which takes it to 4.78:1 and fails a pinned 6.5 floor | `theme.css`, S3's contrast test | rides on GH-1367 S3 |
| C6 | **Docs close-out**: the issue checklist, `HANDOVER.md` row, and the privacy page left unchanged (D14.1's line already covers admin changes appearing in the export) | docs | none |

**Order and conflicts.**

1. **C1 and C2 merge first, in either order.** They touch only `packages/worker` and `@lions/economy`, which no GH-1367
   slice touches. C2 can land before C1: nothing reads `detail.note` until C1, and nothing writes it until C2.
2. **C3 merges after GH-1367 S1 (PR 1371).** S1's `theme.css` hunks sit inside the profile block (lines 10219–10580 at
   `a566042e7`), and it adds `profile-css.test.ts`.
   - C3 adds no line inside that block. Its CSS is one new contiguous block, headed `/* Profile: Roar coins (GH-1370) */`,
     placed after the profile block's last rule.
   - C3's `profile.ts` edits add a `coinCard()` builder beside `historyCards()` and one line in `signedInBlock`. The
     GH-1367 slices are CSS-only (S4's crest keys read `data-avatar`, so it adds no TypeScript). The two cannot meet in a
     hunk.
   - If S1 is still open when C3 is ready, C3 rebases over S1 rather than the other way round. S1 is the bug fix and
     goes first.
3. **C4 follows C3** (it edits the card C3 adds). It is independent of S2–S4.
4. **C5 lands with or after GH-1367 S3**, because it joins S3's token group and contrast test. If S3 is merged, C5 is
   its own small PR. If S3 is in review, the two lines go into S3. S4 (crest) does not touch the coin card.
5. **C6** comes last.

## 6. Lead decisions (each with the recommended default)

| # | Decision | Default |
|---|---|---|
| D1 | Where the card sits | **Main column, second**: under the header card, above Record. Alternative: top of the side column |
| D2 | How an admin grant shows a player-facing reason | **A separate optional note** (0–80, `detail.note`), never the audit reason. Alternative: a "show the reason to the player" checkbox |
| D3 | On an unclaimed device, which history to show | **The account's**, headed "Your account's coin history", under the device's balance labelled "On this device". Alternative: hide the history until the move |
| D4 | What the Stores hint's button does | **Links to the account page's claim banner**, which keeps "Download a copy first". Alternative: run the claim in the Stores |
| D5 | A coin card for a signed-out guest | **No**: the guest view stays the sign-in pitch, and the Stores already show device coins |
| D6 | Zero-amount rows | **Hidden, except the move** |
| D7 | The cursor is the journal's row id, a game-wide counter. Between two of a member's rows it reveals how many coin movements happened game-wide: no member's data, but an activity count | **Accept**. Alternative: an HMAC-sealed cursor (a secret and a key rotation for little gain) |
| D8 | A "total earned / total spent" summary line | **Not now**: it needs a second aggregate query per view. It can be a later row in the card |
| D9 | Paid coins | **One number until ST7**, then "{free} earned · {paid} bought" under the same `spendable()` total |
| D10 | Row time | **Date and time**, as the Stores' Receipts show them; the time wraps under the date at narrow widths |
| D11 | The Stores' Receipts shelf (the device's last 500 receipts) | **Keep**: it is the local record and works offline. A later pass may point it at the account page when signed in |
| D12 | The card's colour | **The `--roar` ramp** (`terracotta.2` head), the coin's own colour. Alternative: the record card's olive |

## Appendix A. The mock's scratch CSS (not shipped)

Injected after GH-1367 option C's four sheets (that spec's Appendix A). Like those sheets, it names a `--rl-*` token
only in the mock-caption rule. A slice declares the two tokens in `theme.css`. The `.mock-tag` rules are frame captions,
not design.

```css
:root {
  --card-head-coins: var(--roar-deep);
  --card-coins-rule: color-mix(in srgb, var(--roar) 45%, transparent);
}
.rl-profile__card--coins { border-color: var(--card-coins-rule); }
.rl-profile__card--coins .rl-profile__card-title { background: var(--card-head-coins); color: var(--band-ink); }
.rl-profile__coins-balance { display: flex; align-items: center; gap: var(--s2); }
.rl-profile__coins-coin { flex: none; width: 2.5rem; height: 2.5rem; }
.rl-profile__coins-n { font-family: var(--font-mono); font-size: 2.25rem; font-weight: 600; line-height: 1; color: var(--roar); }
.rl-profile__coins-word { font-family: var(--font-display); font-size: var(--t-s); letter-spacing: var(--track-title); text-transform: uppercase; color: var(--ink-mute); }
.rl-profile__coins-where { margin: 0; color: var(--ink-mute); }
.rl-profile__coins-hint { display: flex; flex-direction: column; gap: var(--s2); margin: 0; padding: var(--s2) var(--s3); background: var(--well); border-left: 0.1875rem solid var(--band-mission); color: var(--ink); }
.rl-profile__coins-hint p { margin: 0; }
.rl-profile__coins-hint .rl-btn { align-self: flex-start; }
.rl-profile__coins-sub { margin: var(--s2) 0 0; padding-bottom: var(--s1); border-bottom: 1px solid var(--panel-frame); font-family: var(--font-display); font-size: var(--t-xs); letter-spacing: var(--track-title); text-transform: uppercase; color: var(--ink-label); }
.rl-profile__coins-table { width: 100%; border-collapse: collapse; }
.rl-profile__coins-table th { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.rl-profile__coins-table td { padding: var(--s1) 0; border-bottom: 1px solid var(--panel-frame); vertical-align: baseline; }
.rl-profile__coins-table tr:last-child td { border-bottom: 0; }
.rl-profile__coins-when { width: 1%; padding-right: var(--s3) !important; white-space: nowrap; font-family: var(--font-mono); font-size: var(--t-xs); color: var(--ink-mute); }
.rl-profile__coins-when span { display: block; }
.rl-profile__coins-what { color: var(--ink); overflow-wrap: anywhere; }
.rl-profile__coins-note { display: block; color: var(--ink-dim); font-style: italic; }
.rl-profile__coins-amt { width: 1%; padding-left: var(--s3) !important; white-space: nowrap; text-align: right; font-family: var(--font-mono); color: var(--ink); }
.rl-profile__coins-amt[data-sign='in'] { color: var(--accent); }
.rl-profile__coins-line { margin: 0; color: var(--ink-mute); }
.rl-profile__coins-line.rl-bad { color: var(--bad-text); }
.rl-profile__coins-foot { display: flex; flex-wrap: wrap; gap: var(--s2); align-items: center; }
.rl-stores__device-hint { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) var(--s3); margin: var(--s2) 0 0; padding: var(--s2) var(--s3); background: var(--well); border-left: 0.1875rem solid var(--band-mission); color: var(--ink); }
.rl-stores__device-hint p { margin: 0; flex: 1 1 18rem; }
.mock-tag { display: inline-block; margin: 0 0 var(--s1); padding: 0 var(--s1); background: var(--rl-dust-0); color: var(--rl-shadow-1); font: 700 11px/1.6 system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase; }
.mock-tag + .rl-profile__card-title { margin-top: 0; }
```

A shipped block would drop the two `!important`s (the scratch sheet had to outrank the cell padding shorthand) and use
the `/* px-ok */` marker on the 1px rules, as the profile block does.
