# In-game feedback for beta testers — design

**Status:** approved by the lead 2026-10-08, §10 as recommended, with three
rulings that override it (§12). F1 (Worker) and F3 (triage) are built on
`feat/feedback-worker`; §12 is the server contract the app side (F2) builds
against, and where it is more precise than §5 it wins.
**Builds on:** WP-T1 telemetry (`2026-09-24-telemetry-design.md`, #218), the
tester cohort (#302), `ui/pause.ts`, the debrief (`ui/debrief.ts`,
`ui/end-panel.ts`), `packages/worker`.
**Mocks:** `docs/polish/feedback/01`–`08` (§9). They are the real game
(`beit_sahwan_2_foothold`, Metal, 1920×1080, music off) with the proposed
form injected into the live pause menu and debrief, plus a static `/stats/feedback`
page built on the dashboard's own `STATS_STYLE_HEAD`. No shipped file was edited
to make them.

## Why

The lead (8 Oct): *"I want to get feedback from users ... so I can get and
address it. Especially for beta users."* Telemetry already says what testers
did; it cannot say what they thought, what confused them, or what broke. The
goal: a tester tells us something from inside the game in a few seconds, and
the lead reads it in `/stats` with enough context to reproduce it, and files
it as a GitHub issue in one click.

## Four facts that shaped the design

1. **The repository is public** (`gh repo view`: `PUBLIC`). Anything filed as a
   GitHub issue is published. So filing must be a step the lead reads and
   edits, never automatic, and no tester name, contact or player id may reach
   an issue body (§6.4).
2. **Typing in the pause modal moves the camera today.** The pause modal's
   capture guard deliberately lets pan keys through (`pause.ts`,
   `onCaptureKey`: panning is presentation-only). Measured on this branch: a
   `<textarea>` mounted in the pause panel, `d` held for 600 ms and then
   *"the squad would not hold the wadi when asked"* typed. The textarea
   received every character, the sim tick stayed at 97 (still paused), and
   `renderer.camera` moved from (4, 23) to (15.2, 12.5), because `w`, `a`, `s`
   and `d` in the sentence panned the map. A feedback form needs the guard to
   yield **every** key to a focused text field (§3.3).
3. **`photographGround` is the wrong picture.** It renders the map top-down,
   orthographic, with units and overlays hidden and no fog pass: a minimap
   photo. The pattern is right (render target, then `OutputPass`, then
   `readRenderTargetPixels`; `preserveDrawingBuffer` stays off); the camera and
   layer set are not. Feedback needs a sibling, `captureView(maxWidth)`, that
   renders the *player's* view (§4.2).
4. **There is no command log today, and the sim is fixed-seed.** `Sim` is
   built with `seed: 20260727` (`main.ts`), and every player order goes
   through one function, `dispatch` → `applyIntent` → `sim.queueCommand`
   (`main.ts`, ~L3245). The dock's `requestBuild` is the other player input.
   So a log is an app-side recorder at those call sites. No sim change is
   needed. Measured size: §4.3.

## 1. Where it lives

| Entry | What it opens | Why |
|---|---|---|
| **Pause menu, third tab "Feedback"** (mock 01–04) | The full form, inside the same modal | The sim is already stopped there. The modal's focus trap, scrim and capture guard already exist. A tab is the VR-20 tab register the pause menu uses for Objectives and Settings. |
| **Debrief prompt** (mock 05–06) | "How was that mission?" 1–5, then one optional line | The one moment a player has just formed an opinion of a mission. It sits in the debrief foot above the nav, so it never scrolls away. It never takes focus: Enter still answers the primary (Try again / Next mission). |
| **Main menu aside, "Feedback"** (not mocked) | The same form in a `.rl-confirm`-family modal, without the picture or replay options | Bugs on the campaign board, in the garage or in the brigade screen have no pause menu. It is one more link beside Saves · Settings · Credits. |

**Rejected:**
- *A hotkey* (e.g. F8). Every global key enters the rebinding table and its
  collision tests (`input/keymap.ts`), and F1 is already the keys overlay.
  Esc then one click is fast enough for a beta. It can come later as a
  rebindable "Open feedback" action.
- *A "Send feedback" action button that opens a second modal over the pause
  menu.* Stacked modals and Escape ordering are the defect class `pause.ts`'s
  header spends a page on. A tab adds no stacking at all.
- *Always-visible HUD button.* It costs HUD space in every frame of every
  mission for a few uses per session.

**How often the debrief asks.** At most **once per mission id per player**,
on that mission's first debrief, win or lose. It does not ask again on a
replay of a rated mission. After **3 asks in a row go unanswered**, it stops
asking until the next build (`APP_BUILD` changes). It never asks in a sandbox,
and it asks on the tutorial too, because the tutorial is the funnel's biggest
question. State lives in `localStorage['lions.feedback']`
(`{ rated: string[], ignored: number, build: string }`), guarded like every
other storage read. A rating click alone is a deliberate act: leaving the
debrief after clicking a number sends the rating without the line.

## 2. What the player gives

| Field | Pause / menu form | Debrief prompt |
|---|---|---|
| Category | **Required**, one of Bug · Balance · Confusing · Idea · Praise (radio group). No default, so the lead's filter means something. | Implicit: `rating` |
| Text | **Required**, 1–2000 characters, live counter | Optional one line, ≤ 280 characters |
| Rating | none (see D3) | **Required**, 1–5 ("poor" … "great") |
| Picture | Checkbox, **on by default**, with a thumbnail of exactly what is sent | none |
| Replay | Checkbox, enabled only for Bug, **on by default** when enabled | none |
| Contact | Optional, ≤ 120 characters ("e-mail or Discord"). **Shown only when there is no tester label**: a tester is already known by name. | none |

The form shows one line saying who it is sent as and where, e.g. *"Sent as
tester dana · build 0.122.0 · Beit Sahwan II · mission time 0:26"*. A
`<details>` element says in plain words what else is attached (§4).

**Keyboard.** Focus opens on the category group. ←/→ choose, Tab moves to the
text, **Ctrl/Cmd+Enter sends from anywhere in the form**, and Enter on the
focused Send button sends. Escape does what it does today: it closes the pause
menu and resumes. The **draft survives** that, kept in memory and mirrored to
`localStorage['lions.feedback.draft']` (debounced). Reopening the tab restores
it, and only a successful send clears it. A crash is the moment a bug report
matters most, so the draft must outlive a reload. Sending never resumes the
game: the confirmation's "Back to the game" is Resume, focused.

## 3. Behaviour rules the build must keep

1. **Never unpause.** The form is inside the pause modal and `clock.ts`'s
   `paused` input is untouched. The debrief prompt runs after the mission has
   ended.
2. **Disposer contract.** The tab's pane registers its teardown where it is
   created, inside `pauseMenu`'s own `finish`. The menu modal is a `.rl-confirm`
   sibling and goes through `closeOpenDialog()` (CLAUDE.md, "the confirm
   dialog rule"). An in-flight `fetch` carries an `AbortSignal` from
   `onAbort`, and its completion checks `disposed` before touching the DOM.
3. **No key reaches the game while a text field has focus.** `onCaptureKey`
   gains one rule above the pan exemption: if the event target is a text-entry
   element (the test `shouldYieldSpace` already makes in `input/keymap.ts`:
   `input`/`textarea`/`contenteditable`), stop propagation of everything
   except Escape and Tab, and do not prevent default. Enter must also stop
   there, so a newline never reaches a game binding. The debrief one-liner and
   the menu modal get the same rule. **Falsification for the build:** the
   probe in fact 2 above, as a `pause.test.ts` case. With the rule removed,
   the camera moves; with it, the camera does not.
4. **Tokens and `t()` only.** The mock CSS uses only semantic tokens
   (`--ink`, `--panel-frame`, `--selected-fill`, `--band-inspect`, `--good`,
   …). Every string is an `en.json` key (§8). The mission name comes from the
   localized mission overlay, like the HUD.
5. **Feedback never touches the sim.** Context is read from `sim.state`, the
   runtime's `objectiveList`, the HUD's feed model and the renderer, all
   read-only (invariant 4).

## 4. What the game attaches

### 4.1 Context (always, ≤ 8 KB JSON)

| Field | Source | Why |
|---|---|---|
| `build`, `commit` | `APP_BUILD`, plus a new `__APP_COMMIT__` define (Cloudflare Workers Builds exposes the commit SHA) | A version is bumped per release, but `main` deploys per push, so two deploys can share a version. A replay needs the exact commit. |
| `renderer`, `quality`, `gpu` | `'three'`, the quality preset, `WEBGL_debug_renderer_info` unmasked renderer | Render bugs. Measured: `ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)` |
| `viewport`, `dpr`, `locale`, `ua` | window, `?lang`/settings, `navigator.userAgent` (≤ 200 chars) | Layout and i18n bugs |
| `route` | router path (`/mission/<id>`, `/campaign`, …) | Where they were |
| `mission`, `map`, `tick`, `paused` | runtime, `sim.tickCount` | Reproduction point |
| `objectives` | `objectiveList`: `id`/`status`/`primary` | "It didn't complete" |
| `conduct`, `floor` | ROE score and the star floor | Balance notes |
| `force` | alive and lost counts, fielded types, selected types | "My squad …" |
| `camera` | x / y / zoom | Look at the same ground |
| `feed` | last 12 feed lines, as shown | What the player had just read |
| `settings` | UI scale, text size, motion, colour-vision variant | Accessibility bugs |
| `errors` | the last 5 `error` / `unhandledrejection` messages this session, ≤ 300 chars each, first stack frame only | The single most useful fact for a bug. It needs a small ring buffer installed at boot. |
| `tester`, `player`, `session` | telemetry identity | The `session` id joins the row to the `events` table, so the triage view shows the session timeline. All three are omitted under opt-out (§7). |

Measured: a realistic sample (12 feed lines, 5 error lines, 9 units) is
**1.7 KB**. The 8 KB cap leaves room, and the Worker rejects anything over it.

### 4.2 Picture (optional, on by default)

**What:** the world as the player sees it, through the full post chain
(fog, GTAO, tone mapping, SMAA), **without the DOM HUD**. A new
`Renderer.captureView(maxWidth): ImageData | null` renders the live dimetric
camera into the composer's own targets and reads the final one back. That is
`photographGround`'s render-target-plus-`OutputPass` pattern, with the view
camera and every layer left on. It is taken **when the Feedback tab opens**,
so it is the frame the player paused on. It is encoded as WebP, 1280 px wide,
q 0.75. The form shows the thumbnail, so the player sees exactly what is sent.

**Measured sizes** (the frame behind mock 03, world only, Metal):

| Width | JPEG q0.75 | WebP q0.75 |
|---|---|---|
| 1920 | 164 KiB | 90 KiB |
| **1280** | 83 KiB | **45 KiB** |
| 960 | 52 KiB | 30 KiB |

An idle frame with the HUD included read 46 KiB at 1280 WebP. A frame with a
lot of combat read 67 KiB at the same setting. Cap: **300 KiB** server-side.

**Rejected:** canvas readback (black by design); `html2canvas`-style DOM
rasterisers (a dependency that re-implements CSS, and this sheet leans on
`color-mix()`); `getDisplayMedia` (a permission prompt, and a whole-screen
capture of a tester's desktop). The HUD's facts are in the context, not the
pixels. That is decision D5 for the lead.

### 4.3 Replay log (Bug only, optional, on by default)

**What is recorded.** From mission start, in memory only, the app records
`{ tick, cmd }` at `dispatch` and `{ tick, buy }` at the dock's accepted
`requestBuild`, plus a start snapshot: mission id, commit, the ledger, the
account's tiers and unlocks, and the deploy picks, which are everything
`startMission` consumes. The `Sim` seed is a constant. Nothing the runtime
issues itself is recorded (patrols, civilian flight, triggers): those replay
themselves.

**Measured** (probe over `pnpm playtest`, wrapping `Sim.prototype.queueCommand`
and splitting plan orders from runtime orders by caller; 31 runs of 3–9 min,
median 5.5 min):

| | p50 | p90 | max |
|---|---|---|---|
| player commands per run (scripted optimal plans) | 9 | 19 | 29 |
| log JSON | 622 B | 1,269 B | 1,871 B |
| gzipped | 190 B | 231 B | 271 B |
| bytes per command | 67 | 81 | 82 |
| runtime-issued commands (not recorded) | 12 | 51 | 618 |

The plans are optimal-play proofs and issue far fewer orders than a person.
At **30–60 orders a minute**, a 6-minute mission is 180–360 commands, or
**13–29 KB** raw at about 80 B each (roughly 3–6 KB gzipped). Cap: **64 KB of
commands** (about 800 commands, 130 a minute) plus 32 KB of start snapshot.
**A log over the cap is dropped whole, never truncated**, because a replay
needs every command from tick 0.

**Proof of reproduction.** The send also attaches an FNV state hash of
`sim.state` at the send tick, computed in `app` by a small FNV-1a over
`sim.state`'s typed arrays, read-only. `packages/sim/src/hash.ts` has the same
function, but `@lions/sim` does not export it, and exporting it is a sim
change the lead would have to approve. F4 decides between a copy pinned by a
test and that export. A later `pnpm replay:feedback -- --id=N`
(F4, §11) re-runs the log headless at the recorded commit and reports
"reproduced" only when its hash equals the one sent. Its red check: drop one
command and watch the hash disagree. Until F4 exists, the log is evidence
that waits.

## 5. Where it lands

### 5.1 Storage: D1 row plus R2 objects

`packages/worker/migrations/0003_feedback.sql`:

```sql
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  received_at INTEGER NOT NULL,
  t INTEGER NOT NULL,                 -- client epoch ms
  player TEXT, session TEXT,          -- NULL under opt-out
  tester TEXT,
  build TEXT NOT NULL, "commit" TEXT,
  source TEXT NOT NULL CHECK (source IN ('pause','debrief','menu')),
  category TEXT NOT NULL CHECK (category IN ('bug','balance','confusing','idea','praise','rating')),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  text TEXT NOT NULL DEFAULT '',
  contact TEXT,
  mission TEXT, map TEXT, tick INTEGER,
  context TEXT NOT NULL,              -- JSON, ≤ 8 KB
  shot_key TEXT, log_key TEXT,        -- R2 keys; NULL when not attached
  dev INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','filed','dismissed')),
  issue INTEGER, note TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX feedback_status  ON feedback (status, received_at);
CREATE INDEX feedback_tester  ON feedback (tester, received_at);
CREATE INDEX feedback_mission ON feedback (mission, received_at);
CREATE INDEX feedback_player  ON feedback (player, received_at);
```

The picture and the replay go to an **R2 bucket** (`roaring-lions-feedback`,
binding `FEEDBACK_BLOBS`), keyed `fb/<id>/shot.webp` and `fb/<id>/replay.json`.
The lead runs `npx wrangler r2 bucket create roaring-lions-feedback` once,
beside `npx wrangler d1 migrations apply ... --remote`.

**Rejected:**
- *Inline in D1.* The telemetry database is kept forever. Cloudflare's
  published D1 limit at the time of writing is 500 MB per database on Workers
  Free (verify the current limits page). At about 50 KB a picture, images
  would eat the same headroom the events table needs.
- *No pictures.* "The squad walked to the wrong wall" is a hard report to act
  on without the ground.

R2's free tier (10 GB-month, no egress fee) holds about 200,000 pictures.

### 5.2 `POST /api/feedback`

- **Body:** `multipart/form-data`. `meta` is JSON, ≤ 24 KB, validated against
  a new `data/schemas/feedback.schema.json` shared with the client, the way
  `telemetry_event.schema.json` is. `shot` is `image/webp` or `image/jpeg`,
  ≤ 300 KB, with the magic bytes checked. `replay` is JSON, ≤ 96 KB, and is
  accepted only when `category = 'bug'`. The declared `Content-Length` must be
  ≤ 448 KB, and it is checked before the body is read, as `ingest.ts` does
  (M5).
- **Origin:** must be the site's own, with no `null` allowance. This is a
  `fetch`, not a beacon.
- **Rate limits:** a new `FEEDBACK_LIMIT` binding, **5 per minute per IP**
  (`CF-Connecting-IP`, never stored). **20 per player per 24 h** and **500 in
  total per 24 h**, both counted in D1, so a flood cannot fill R2.
- **Order of writes:** R2 objects first, then the D1 row. If the row fails,
  the objects are deleted (best effort).
- **Answers:** unlike `/api/events` (always 204), the player is told whether
  it landed: `201 {"ref":"FB-0042"}`, `400` invalid, `403` origin, `413` too
  large, `429 {"retryAfter":s}`, `503` storage. The client never retries in
  a loop (telemetry's rule). A failure keeps the draft and shows a Retry
  button.

### 5.3 `/stats/feedback`: the triage view (mocks 07–08)

It sits behind the existing password login, in the same Worker, in the same
`STATS_STYLE_HEAD`. A nav link in the `/stats` header carries an **"N new"**
count. The view has:

- **Status tabs** (New / Triaged / Filed / Dismissed / All, with counts) and
  filters for tester, mission and kind. The list shows ref, time, tester,
  kind, mission, rating, the first line of the note, "picture"/"replay" tags,
  and status.
- **Detail:** the full note, the picture (served from R2 through
  `/stats/api/feedback/:id/shot`, session-gated, fixed `Content-Type`,
  `X-Content-Type-Options: nosniff`), the context as a key/value table, the
  **session timeline** (the `events` rows for that `session` plus the
  feedback row), and the actions **File as GitHub issue · Mark triaged ·
  Dismiss · Download replay · Download picture · Delete**. It also has a
  private triage note and a "Filed as issue #" field. Every string the page
  renders goes through the dashboard's existing `esc()`.
- **Delete** removes the row and its R2 objects. It is the answer to "please
  remove what I sent" (§7).

### 5.4 "File as GitHub issue": a prefilled URL the lead submits

The button opens
`https://github.com/ilan-pinto/roaring-lions/issues/new?title=…&body=…&labels=feedback,<kind>`
in a new tab and marks the row `filed`. The issue number can be typed back
into the row afterwards. A pure, tested Worker function builds the title and
body (mock 08 shows one):

- The title is `Feedback FB-0042: <first ~60 characters of the note>`.
- The body has the kind, mission and clock, build and commit,
  renderer/quality/GPU, screen and locale, whether a replay exists (with its
  `pnpm replay:feedback` line), and a link to the private `/stats` detail.
- The note is quoted **inside a fenced text block**. A note can then not
  @-mention anyone, auto-link, or load a remote image when the issue renders.
- **It never contains** the tester label, contact, player id or session id.
- The body is held under ~6 KB so the URL stays well inside GitHub's limit.
  The note is capped at 2,000 characters anyway.
- The picture is not in the URL (no API can attach one). The lead drags the
  downloaded file in if it should be public.

**Rejected: the Worker files the issue with a token it holds as a secret.**
The repo is public, so one click would publish a tester's words with no edit
step. A write-scoped GitHub token would also sit in the Worker's secrets, and
it still could not attach the picture. It is worth revisiting only if volume
makes the extra click hurt.

## 6. Who sees it, and what they see after sending

- **Superseded by the lead's ruling (§12.1): v1 is for EVERYONE.** The text
  below is the original proposal.
- **v1 is for testers.** The Feedback tab, debrief prompt and menu link appear
  when a tester label is present (`?tester=`, already persisted) or when
  `?feedback` is on the URL. `?feedback` is persisted the same way, so the
  lead can try it without a label. Everyone else sees nothing.
- **Dev, tests and CI.** The UI renders under `?feedback`, but a send on the
  dev server or any localhost origin is a **dry run**: nothing leaves the
  machine, and the confirmation says so. This keeps `pnpm ui:routes` (which
  fails on any console error) and the golden gate clean, which is the same
  airtight off switch as telemetry's `telemetryEnabled`.
- **Public launch.** Opening it to everyone is tied to the same gate as
  telemetry's consent notice (telemetry spec, decision (a)), not before.
- **After sending** (mock 04): "SENT. Thank you. We read every one." and
  "Reference FB-0042 · quote it if you write to us about this", with **Back to
  the game** focused and "Send another" beside it. The debrief prompt
  collapses to one line: "Thanks, sent." On failure: "Not sent: the server
  did not answer. Your note is kept." with Retry.

## 7. Privacy and abuse

- **Opt-out.** Feedback is an explicit act, so `?notrack`, GPC and DNT do
  **not** hide it. They make it anonymous: no `player`, `session` or `tester`
  is sent, the "Sent as" line reads "Sent anonymously", and there is no
  timeline join.
- **Consent line**, under Send (mock 02/03): *"Your note goes to the Roaring
  Lions team. We may quote it in a public bug report, never with your name."*
  The "What else is sent" details lists the context in plain words and ends
  with *"No account, no e-mail, no address."*. A licence line for ideas
  (*"By sending it you agree we may use it to improve the game"*) is the
  lead's call. It sits beside the licensing decision (PolyForm NC plus CLA,
  #192).
- **Caps:** text ≤ 2000, line ≤ 280, contact ≤ 120, context ≤ 8 KB, picture
  ≤ 300 KB, replay ≤ 96 KB. Rate limits are in §5.2.
- **Spam:** own-Origin only, schema validation, IP and player rate limits, a
  global daily ceiling, and nothing auto-publishes. Every row lands as `new`
  behind a password.
- **Retention:** the picture, replay and contact are purged **180 days** after
  receipt by a daily Cron Trigger. Text and context stay, like the telemetry
  events. Delete works at any time.
- **No IP stored**, same as telemetry.

## 8. Strings (all through `t()`)

`pause.tab.feedback`, `feedback.lede`, `feedback.kind.label`,
`feedback.kind.{bug,balance,confusing,idea,praise}`, `feedback.text.label`,
`feedback.text.placeholder`, `feedback.count`, `feedback.attach.picture`,
`feedback.attach.pictureSub`, `feedback.attach.replay`,
`feedback.attach.replaySub`, `feedback.contact.label`, `feedback.who.tester`,
`feedback.who.anonymous`, `feedback.details.summary`, `feedback.details.body`,
`feedback.send`, `feedback.cancel`, `feedback.hint.send`, `feedback.consent`,
`feedback.sent.title`, `feedback.sent.body`, `feedback.sent.ref`,
`feedback.sent.back`, `feedback.sent.another`, `feedback.failed`,
`feedback.retry`, `feedback.dryRun`, `feedback.rate.question`,
`feedback.rate.poor`, `feedback.rate.great`, `feedback.rate.line`,
`feedback.rate.thanks`, `menu.aside.feedback`. The `/stats` page is English
and lives in the Worker, like the dashboard.

## 9. Mocks

| File | Shows |
|---|---|
| `docs/polish/feedback/01-pause-entry.jpg` | Pause menu with the third tab, "Feedback" (hover) |
| `docs/polish/feedback/02-pause-form-empty.jpg` | The form, empty: Send disabled, the world-only picture thumbnail, consent line |
| `docs/polish/feedback/03-pause-form-filled.jpg` | Bug chosen, note typed, picture and replay attached, Send focused |
| `docs/polish/feedback/04-pause-form-sent.jpg` | The confirmation with reference, "Back to the game" focused |
| `docs/polish/feedback/05-debrief-prompt.jpg` | The debrief (a scripted defeat) with "How was that mission?" in the foot |
| `docs/polish/feedback/06-debrief-prompt-rated.jpg` | A 2 chosen, one line typed |
| `docs/polish/feedback/07-stats-feedback-list.jpg` | `/stats/feedback`: tabs, filters, the list |
| `docs/polish/feedback/08-stats-feedback-detail.jpg` | One row opened: note, picture, context, session timeline, the prefilled issue |

Capture conditions: an own Vite dev server on port 5233, ONE Chromium with the
Metal args (`gpuLaunchArgs('metal')`), 1920×1080 at DPR 1, `musicOffInitScript()`,
and frames frozen for each shot (`FREEZE_FOR_SCREENSHOT_SCRIPT`). The
server and browser were stopped by PID afterwards. The picture thumbnail in
02/03/08 was made world-only by hiding the DOM before the screenshot, which
stands in for `captureView`. The driver was throwaway and is not committed.

## 10. Decisions for the lead (approve item by item)

1. **D1 Entry points.** Pause-menu **tab**, a debrief **prompt**, and a main-menu
   **link**. No hotkey and no HUD button.
2. **D2 Debrief frequency.** Once per mission id per player, on the first
   debrief, win or lose. Silent after 3 ignored asks until the next build.
   The tutorial is included, sandboxes are not.
3. **D3 Rating only on the debrief.** The pause/menu form has no rating
   field, because a 1–5 means something about a mission, not about a bug.
4. **D4 Categories.** Bug · Balance · Confusing · Idea · Praise, required,
   with no default. Text required, ≤ 2000.
5. **D5 Picture.** The world as seen through the full post chain, **no HUD**,
   taken when the tab opens, 1280 px WebP q0.75 (measured 45–90 KiB), on by
   default, with a thumbnail shown.
6. **D6 Replay log.** Record player orders in memory every mission. Attach
   only to Bug (checkbox, on), capped at 64 KB of commands and dropped whole
   past it, with a state hash. The replay runner is a separate later package (F4).
7. **D7 Context.** The §4.1 list, including the last 5 errors, ≤ 8 KB.
8. **D8 Storage.** A D1 `feedback` table plus an **R2 bucket** for the picture
   and replay. You create the bucket once.
9. **D9 Endpoint.** `POST /api/feedback`, multipart, the caps and limits in
   §5.2, answering 201 with a reference.
10. **D10 Triage.** `/stats/feedback` with new / triaged / filed / dismissed,
    filters, session timeline, and delete.
11. **D11 Filing.** A **prefilled `issues/new` URL** you read, edit and
    submit. No token, and no tester name, contact or ids in the issue. The
    note goes in a fenced block.
12. **D12 Gating.** Testers (`?tester`) plus `?feedback` only. Localhost is a
    dry run. Opening it to everyone is tied to the telemetry consent notice.
13. **D13 Opt-out.** `?notrack`/GPC/DNT send anonymously rather than hiding
    the form.
14. **D14 Wording.** The consent line in §7. Whether to add the "may use it to
    improve the game" licence line is your call.
15. **D15 Retention.** Picture, replay and contact purged after 180 days.
    Delete works any time.
16. **D16 Contact field.** Shown only to players with no tester label.
17. **D17 Notification.** **None in v1** beyond the "N new" count in `/stats`.
    Optional later: a daily Slack incoming-webhook digest (counts and a link,
    no text) behind a secret. E-mail was rejected because Cloudflare Email
    Routing needs a domain zone, and the game is on `workers.dev`.
18. **D18 Key guard.** While a text field has focus, the pause modal (and every
    modal with a text field) yields every key to the field. This fixes the
    measured camera pan.

## 11. Build plan (after approval)

| WP | Scope | Proof it works (seen red first) |
|---|---|---|
| **F1 Worker** | migration 0003, R2 binding, `FEEDBACK_LIMIT`, `feedback.schema.json`, `POST /api/feedback` | Worker tests on the `node:sqlite` adapter: each cap, origin, rate limit, magic bytes, category/replay rule, R2-then-row rollback. Each is red under a one-line mutation of its own check. |
| **F2 Client** | the form component (pause tab, menu modal), debrief prompt, context collector, error ring buffer, `captureView` on `Renderer` + `ThreeRenderer`, D18 guard, gating/dry run, draft persistence, i18n | the D18 camera test; dry-run on localhost (no network request, asserted); a disposer test (leave mid-send, no DOM write); `validate:ui`; `pnpm ui:routes` on CI |
| **F3 Triage** | `/stats/feedback`, the shot proxy, status changes, delete, the issue URL builder, the 180-day purge cron | a URL-builder test that fails when a tester name or `@` reaches the body; a size test that holds the URL under the cap; the session-gate test |
| **F4 Replay** (later) | the app-side recorder (if not in F2), `pnpm replay:feedback` | record through the UI, replay headless, compare hashes; drop one command, see it red |

F1–F3 are presentation and tooling only: no sim change and no golden-baseline
move. The pause menu is not in any gated capture. `ui:shots` will show the
new tab.

## 12. Lead rulings and the server contract as built (F1 + F3)

### 12.1 Rulings (2026-10-08) that override §6, §5.2 and D12

1. **Who: everyone, not testers only.** The entry points show for every player
   in v1 and will be removed in a later version. So `POST /api/feedback` is a
   public write endpoint: strict caps, per-IP and per-session limits,
   validation, and a server-side kill switch. An untagged player is shown as
   `anonymous` (plus the session id) in the triage view.
2. **Attachments: picture plus replay**, as designed. The picture goes to R2.
3. **Filing: a prefilled `issues/new` URL**, as designed (§5.4). No token
   anywhere. The tester name and contact are never in the issue. The body is
   cut to fit a URL, with a pointer to the private detail page.

### 12.2 `POST /api/feedback`

`multipart/form-data`, at most 448 KB in all (the declared Content-Length is
checked first; the body is then read with a hard byte cap, so an absent or
lying header buffers no more). Exactly these parts, each at most once:

| Part | Content | Cap | Allowed when |
|---|---|---|---|
| `meta` | JSON, `data/schemas/feedback.schema.json` | 24 KB | always (required) |
| `shot` | a file, WebP or JPEG, **type from the magic bytes**; a declared type that disagrees is 400 | 300 KB | `source` = `pause` |
| `replay` | JSON, an object | 96 KB | `source` = `pause` and `category` = `bug` |

`meta` fields (the schema is the authority; `packages/worker/src/feedback-meta.ts`
is its Worker twin and a test pins the two):

| Field | Type | Rule |
|---|---|---|
| `v` | 1 | required |
| `t` | integer, client epoch ms | required |
| `source` | `pause` · `debrief` · `menu` | required |
| `category` | `bug` · `balance` · `confusing` · `idea` · `praise` · `rating` | required; `rating` exactly when `source` is `debrief` |
| `text` | string | forms: 1–2000 code points, not whitespace-only; debrief: 0–280, one line. No control characters but tab/newline. |
| `rating` | integer 1–5 | present exactly when `category` is `rating` |
| `contact` | string, 1–120, one line | optional |
| `build` | `0.122.0` form | required |
| `commit` | 7–40 lowercase hex | optional |
| `player`, `session` | telemetry UUIDs | optional; omitted under opt-out |
| `tester` | telemetry tester pattern | optional; omitted under opt-out |
| `mission`, `map` | `[a-z0-9_]{1,64}` | optional (absent from the main menu) |
| `tick` | integer | optional |
| `dev` | `true` | optional; never `false` |
| `context` | object, ≤ 64 keys, **≤ 8192 bytes serialised** | required (may be `{}`) |

No other field is accepted. The triage view shows `context` as a key/value
table, whatever keys it has; the issue builder reads `renderer`, `quality`,
`gpu`, `viewport` (`[w, h]`), `dpr` and `locale` when present.

`replay` is stored as sent. The triage view summarises `commands` (array
length), `hash` and `tick` when the object carries them, so F2 should send
`{ "v": 1, "start": {…}, "commands": [{ "tick", "cmd" | "buy" }], "hash", "tick" }`.

**Answers** (all JSON, `cache-control: no-store`):

| Status | Body | When |
|---|---|---|
| 201 | `{"ref":"FB-0042","id":42}` | stored |
| 400 | `{"error":"<reason>"}` | malformed, an unknown/duplicate part, a part the source may not send |
| 403 | `{"error":"origin"}` | Origin is missing or not the site's own (or `ALLOWED_ORIGINS`) |
| 405 | — | any method but GET and POST |
| 410 | `{"error":"closed"}` | the kill switch is on (checked first, before the Origin) |
| 413 | `{"error":"too large"}` | a cap above |
| 429 | `{"retryAfter":<s>}` | a rate limit (below) |
| 503 | `{"error":"storage"}` | D1 or R2 failed; nothing is left half-written |

**`GET /api/feedback`** answers `{"open":true|false}`. **This is new**: the app
asks it once per boot and hides its three entry points when it says false, so
the lead can close feedback without an app deploy.

**Rate limits.** Per IP: the `FEEDBACK_LIMIT` binding, 5 a minute
(`CF-Connecting-IP`, never stored; `retryAfter` 60). Counted in D1 on
`received_at`: **10 an hour per session**, **20 a day per player**, **500 a day
in total**, whatever ids are sent. `retryAfter` is the time until the oldest
counted note leaves its window.

**Order of writes, and one change from §5.1.** R2 first, then the row; a row
failure deletes the objects again. Because the row id does not exist yet when
the objects are written, the keys are **`fb/<random uuid>/shot.webp|jpg`** and
**`fb/<random uuid>/replay.json`**, not `fb/<id>/…`. The row stores the keys,
so nothing reads the layout.

### 12.3 The kill switch

Two halves; either one closes feedback (POST answers 410, GET `{"open":false}`):

1. **D1 `flags` row** `('feedback', 'closed')`, from migration 0003. Flipped by
   the **Close feedback / Open feedback** button on `/stats/feedback`, or by hand:
   `npx wrangler d1 execute roaring-lions-telemetry --remote --command "INSERT INTO flags (name, value, updated_at) VALUES ('feedback', 'closed', unixepoch() * 1000) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"`
   (`'open'` reopens).
2. **Env `FEEDBACK_CLOSED`** (any value but empty, `0` or `false`), set with
   `npx wrangler secret put FEEDBACK_CLOSED`. A secret survives deploys; a
   dashboard variable is replaced by the next deploy. It wins over the button.

### 12.4 `/stats/feedback` (F3)

Behind the `/stats` session, checked before any of it is reached. The page is
`/stats/feedback` and `/stats/feedback/<id>` (list on top, the opened row
below, as mocks 07–08), served with a CSP. The `/stats` header carries
**Players · Feedback [N new] · Sign out**. API, all under `/stats/api/feedback`:

| Route | |
|---|---|
| `GET ?status=&tester=&mission=&kind=` | list (newest first, ≤ 500), counts per status, filter options, switch state. `tester=*anonymous` and `mission=*none` select the empty ones. |
| `GET /count` | `{"new":N}`, the badge |
| `GET /<id>` | the row, its context, replay summary, the session timeline (`events` of that session, with that session's feedback rows interleaved) and the prefilled issue |
| `GET /<id>/shot[?download=1]` | the picture from R2: type fixed by the key, `nosniff`, `default-src 'none'; sandbox` |
| `GET /<id>/replay` | the replay as a download |
| `POST /<id>` `{"action":…}` | `triage`, `dismiss`, `reopen`, `file` (optional `issue`), `issue` (a number), `note` (≤ 2000, empty clears), `delete` (row and R2 objects; an R2 failure keeps the row) |
| `POST /switch` `{"open":bool}` | the D1 half of the kill switch |

A POST must carry the site's own Origin and a JSON body. Status transitions:

| From | May go to |
|---|---|
| new | triaged, filed, dismissed |
| triaged | new, filed, dismissed |
| filed | triaged |
| dismissed | new, triaged |

Anything else is 409. A filed note is on GitHub, so it can step back to
triaged and no further.

**The issue URL** is built by a pure function (`feedback-issue.ts`): the whole
URL is at most **7000 characters**; the note sits in a fence longer than any
backtick run inside it; every other client value outside the fence is reduced
to plain characters (no `@`, `<`, `[`, `!`, `|`, backtick); the tester label,
contact, player id and session id are never written, and a copy of any of them
(three characters or more) or any e-mail address typed into the note or a
context field is replaced by `[redacted]`.

**Retention** (D15): a daily Cron Trigger (`17 3 * * *`) drops the picture,
replay and contact 180 days after receipt; the note and context stay.

### 12.5 One-time steps for the lead, before merging

Merging deploys from `main`, and a deploy with an R2 binding to a bucket that
does not exist fails, so both of these come first:

```sh
npx wrangler r2 bucket create roaring-lions-feedback
npx wrangler d1 migrations apply roaring-lions-telemetry --remote
```

Nothing else is needed: the rate-limit namespace (`1003`) and the cron are
declared in `wrangler.jsonc`. `FEEDBACK_CLOSED` is only for closing feedback.

