# HANDOVER — Roaring Lions programme ledger

Updated: 2026-09-26 (repo PUBLIC since 25 Sep, CI works again; garage uplift plan 1 #244 and ground plan 1 #249 LANDED) · main: 165eb966 (v0.84.0 + re-bless) · plan: https://claude.ai/artifact/SND5uxua1RtGy82cxR3JC7 · stage: 2 underway (G1 due 2 Oct still gates A3.1) · next milestone: M1 30 Oct · GitHub: milestones EP M1–M5 (3–7), gate issues #164–#169 + G7 #199, package issues #170–#192 + Steam WP-ST1–ST8 #200–#207 + WP-T1 #218 · art: #226 roads LANDED (in #249), #227 tunnels still queued in A3.2

Rules: under 200 lines, one line per item, edited per section. Details live in the spec, the plan or the SDD ledger a line links to. Updated at every landing and every gate answer. Committed with a pathspec from a main worktree, never from the shared tree.

## 1. Now — what is in flight (one line per lane; empty means idle)

| Lane | WP | Branch · worktree | Spec · plan · SDD ledger | State | Next action |
|---|---|---|---|---|---|
| A (packages/app) | #243 garage comparison + Shift+Tab minor · WP-S3g plan 2: kit tier mark on the map · S3e #178 Tasks 11–12 wait for G1 | `feat/garage-tier-mark` | S3g spec approved (#239, D1–D9 accepted); plan 1 landed (#244 → 115377b1) | plan 2 (map mark) being written | land S3g plan 2 before A2 plan 2 touches `ThreeRenderer.ts`; triage #243; S3e Tasks 11–12 after G1 |
| B (render · art · data) | A3.1 #179 waits for G1 · A3.2 #185 tunnel visuals #227 · #250 ATGM missile animation (after A2 plan 2) · WP-AU1 #245/#246 unit voices | — | voices: spec LANDED (#246, 25 Sep); engine plan drafting; D2 military calls only, D5 samples are ElevenLabs output pending a commercial licence | A2 ground plan 1 LANDED (#249 → 2eadc0b0); A3.1 idle until G1 | A3.1 after G1 (2 Oct); A2 plan 2 after S3g plan 2 clears `ThreeRenderer.ts`; #250 after A2 plan 2; any Meshy call is announced with a credit estimate first |
| C (packages/sim) | #247 manpad_team treated as wheeled (sim/data fix, filed 26 Sep) | — | — | closed until Stage 4 | — |

## 2. Next — ordered; a fresh session starts at the top of its lane

- A: S3g plan 2 (kit tier mark, `feat/garage-tier-mark`) → #243 garage comparison + Shift+Tab → S3e #178 Tasks 11–12 (after G1) → S3a #180 + further S3g build (Stage 3, together) → S-F #184, A4 #186
- B: A3.1 #179 bible + Meshy batches (after G1, 2 Oct) → G-E5 #181 → A2 plan 2 (after S3g plan 2 clears `ThreeRenderer.ts`) → A3.2 #185 (tunnel visuals #227) → #250 ATGM missile animation → WP-AU1 #245/#246 unit voices engine plan
- C: #247 manpad_team wheeled fix (Stage 4) → G-F #183 (four plans) after G3 on 2 Nov → G-G0 #187 spike 30 Nov → G-G #188 → G-H0 #190 spike 25 Jan → G-H #191
- D (backend · NEW lane, opens Stage 5): ST5 #204 session-ticket auth → ST6 #205 server-authoritative ledger + fraud limits → ST7 #206 Steam Wallet MTX (Stage 6). ST5 shares its Supabase/Postgres project with M4's Colyseus relay (G5 #169) — one service, not two. Steam packages outside lane D: ST1 #200 (lead action, Stage 2) and ST8 #207 (non-P2W content plan, lane A docs, Stage 2, before E5) → ST2 #201 Tauri wrapper → ST3 #202 SDK bindings (lane A, Stage 3) → ST4 #203 store page (lane B, Stage 4, after art 2–3)

## 3. Gates — open decisions, defaults, dates, answers

G0 #164 answered 18 Sep and closed. Answer the rest on their issues: G1 #165 · G2 #166 · G3 #167 · G4 #168 · G5 #169 · G7 #199. Answers are copied here with the date, then the issue is closed.

| Gate | # | Question (short) | Default | Due | Answer · date |
|---|---|---|---|---|---|
| G0 | 1 | Licence "all rights reserved" for art and data (D-16) | keep | 20 Sep | keep? NO → PolyForm Noncommercial 1.0.0 + CLA (WP-L1 #192) · 18 Sep |
| G0 | 2 | `JEEP_HULL` sheet licence unverified (D-26) | retire with the sheets in A3.3 | 20 Sep | retire with the sheets in A3.3 · 18 Sep |
| G0 | 3 | CVD team variants only 1.5 ΔE better (D-22) | keep, relabel, no perceptual claim | 20 Sep | keep, relabel "alternate team colours", no claim · 18 Sep |
| G0 | 4 | Pixi WebGL leak on soft leave (D-25) | one mission per tab; retire at A3.3 | 20 Sep | one mission per tab; retire in Stage 5 · 18 Sep |
| G0 | 5 | Eight KDF units have no `blurb` | narrative-designer writes them in Stage 1 | 20 Sep | narrative-designer, Stage 1 · 18 Sep |
| G0 | 6 | Garage Buy below the fold at 1080p | keep the fade; revisit in S3a | 20 Sep | keep the fade; revisit in S3a · 18 Sep |
| G0 | 7 | `plates:units` one browser per unit (D-24) | accept | 20 Sep | accepted · 18 Sep |
| G0 | 8 | A ★-only player never sees Shachaf/Kipod | confirm | 20 Sep | confirmed · 18 Sep |
| G0 | 9 | Nine Conduct floors open after mission one | raise to 70–90, re-pin the ladder | 20 Sep | raise to 70–90, re-pin (E1) · 18 Sep |
| G0 | 10 | `breach_team` 850 vs the 1,550 cap | keep 850, record the exception | 20 Sep | keep 850, record · 18 Sep |
| G0 | 11 | Bought-only special forces: count, bands, CONCEPTS | 2 units, 4,000–4,500 and 6,500–8,000; **concepts have no default (blocking for E5)** | 19 Oct | THREE units: deep recon team 4,000–4,500 · demolition vehicle (GH-156) ~6,500 · Peten gunship ~8,000; E5 ~12 tasks · 18 Sep |
| G0 | 12 | Roster and reserve cap | measure a ★★★ ladder first; cap above it; overflow to a reserve list | 20 Sep | measure first; cap above ★★★; reserve list · 18 Sep |
| G0 | 13 | Trim infantry falls to 0.9–1.2 s | trim inside A3.1 | 20 Sep | trim in A3.1 · 18 Sep |
| G0 | 14 | The blast's look; mortar shares it | accept the proposal; mortar shares at its own power; judge on 10 s of motion | 20 Sep | accepted; mortar shares · 18 Sep |
| G1 | — | Meshy credit top-up (454 vs ~540 needed) | top up for 18 bakes; previews only for props | 2 Oct | more credits arrive at the START OF OCTOBER; every Meshy-API task (A3.1 #179, #226 road texture, #227 tunnels, S3g kit parts) waits for them; Blender-only work proceeds · 24 Sep |
| G1 | — | Style bible + prompt template; symbol sheet; board route; vehicle numbers; portrait rig | as on the plan page | 2 Oct | — |
| G2 | — | Retire Pixi + sheets; Steam page timing; bless via PR; platform | go · flag · restore PR · unscheduled | 30 Oct | — |
| G3 | — | Economy shape (intel by doing, held-line income, production, population, starting_force) + skirmish fun criteria | as on the plan page | 30 Oct | — |
| G4 | — | Skirmish go/no-go from five games | — | 14 Dec | — |
| G5 | — | Transport, input delay, co-op rules | Colyseus relay · 3 ticks · shared Conduct/grade/credits | 5 Feb 2027 | — |
| G7 | #199 | What does the sold currency buy? Brigade credits buy units, upgrade tiers and E5 today; the roadmap's Phase 4 forbids selling a competitive advantage | TWO currencies: brigade credits stay earned-only and are never sold; a new cosmetic currency ("marks") is what Steam Wallet sells, spending only on liveries, badges and operation passes | 30 Oct | — |

## 4. Landed — append-only, newest first

- 2026-09-26 · releases v0.82.0 → v0.84.0 cut across the 24–26 Sep landings below
- 2026-09-26 · **#249 → 2eadc0b0 ground plan 1 (WP-A2)** · splat terrain, the #226 road, a decal pool, and the new gated `aftermath` scenario · visual baseline re-blessed from CI numbers at 165eb966: quiet 12222, open-ground 502, vehicle 4726, relief 704, aftermath new
- 2026-09-25 · **#248 asset-provenance fix** · TNK/JEEP sprites re-rendered from our own GLBs; Namer CC-BY credit added; Kolos FBX removed; history kept, by the lead's decision · closes the pre-public audit's one finding
- 2026-09-25 · **#246 the unit voices spec (WP-AU1, #245)** · KDF in Hebrew, others in Arabic, military calls only; samples ElevenLabs, uncommitted until a commercial licence is confirmed
- 2026-09-25 · **#244 → 115377b1 garage uplift plan 1 (WP-S3g, app lane)** · an accordion board, kit pips, a Maxed stamp, a stat panel, and purchase events with sound; one Enter press buys one tier · decisions: L1 the accordion; L2 a re-locked unit's tiers kept but dormant
- 2026-09-25 · **#242 Worker observability** · logs and traces, `redact_query_string` false, as the lead supplied
- 2026-09-25 · **#241 the ground spec (WP-A2)** · the lead approved its numbers and D8
- 2026-09-25 · the lead made the repo PUBLIC; GitHub Actions works again (it had been blocked by billing on the private repo from 24 Sep ~20:34 UTC)
- 2026-09-25 · a pre-public history audit: clean for secrets, sensitive files, personal data and large files; found unverified-licence art, fixed at HEAD by #248
- 2026-09-25 · the repo's git `user.email` is now `pint12@gmail.com` (repo-level config)
- 2026-09-24 · **#240 the garage filter fix** (closes #237)
- 2026-09-24 · **#239 the garage uplift spec (WP-S3g)** · merging it accepted D1–D9
- 2026-09-24 · **#236 win screen credits** (closes #234) · the win screen shows credits paid and the running total
- 2026-09-24 · **S3e scene host (#178 stays open for Tasks 11–12)** · PR #232 → 193f8144 (merge commit: the branch carries two main merges) · a live Beit Sahwan diorama behind the menu through a thin door (`@lions/render/three-front`) over a stock `ThreeRenderer`; a plate `menu_host_plate.jpg` from `pnpm plate:host` for Pixi, reduced motion, no WebGL2, failure or a 15 s deadline; the menu's context released on leave · gate: `menu-scene-host` path/contribution/register votes (+~42 s locally) · `ui:routes` three leaves with no WebGL/DRACO/Worker warning · 10 tasks + final opus review + one fix wave · CI `visual` GREEN on Linux on the first run, no bless · spec D-52…D-64 · memory budgets checked only through the lost-context proxy
- 2026-09-24 · **#233 (closes #229)** → 130a56c9 · the dock tooltip clears the whole dock (`computeTipPosition`); a readable "N credits" chip in the dock header; ▣ on every tile cost; "logistics"/"intel" words on the strip · `ui:routes` asserts the tip covers no tile · visual GREEN, no bless
- 2026-09-24 · **#231 (closes #230)** → 89306e89 · a Share button on `/stats` makes `<origin>/?tester=<name>`, with one builder shared by module and page and a guard against keepNames' `__name`
- 2026-09-24 · **#224 (closes #223)** → e2d2bf25 · Saves and Credits no longer collapse; one themed scrollbar everywhere (option A); `ui:routes` checks both panels' height
- 2026-09-24 · the lead said "merge all": #228, #224, #231, #233 rebase-merged, then #232 as a merge commit after two updates from main (the `routes-check.ts` conflict resolved with Saves/Credits before fast-leave legs (b) and (c), whose init script must reach only the walk's last hard navigation)
- 2026-09-24 · **WP-T1 telemetry and Cloudflare hosting (#218, closed)** · PR #225 → 042a4b56 · v0.80.0 (b48f6734) · built in the peer session "Roaring Lion GitHub Pages deployment" · a Worker at `packages/worker` serves the static build (SPA fallback: `/`, `/campaign` and `/mission/<id>` return 200, so the deep-link 404 is gone), `POST /api/events` into D1 (`events`, `players`; the deploy runs the migrations; a junk POST gets 204 and stores nothing), and `/stats` behind a password login (`/stats/api/summary` gives 401 without it) · Cloudflare deployed it at 14:55 UTC and the lead set `STATS_PASSWORD` at 15:03 · telemetry is off in dev, CI and under GPC or DNT · open: whether Workers Builds builds a `[skip ci]` release commit (the version-number question)
- 2026-09-24 · three more, merged by the lead a minute apart (#219 → 2613a6d6, #220 → 36a18362, #221 → 35b025ec) · **v0.79.0** cut from main's tip (a9f8b4b1) · **#220** an artifact upload can no longer fail `visual` (continue-on-error, 3-day retention) and `version` releases only when `origin/main` is the run's own commit · **#219** a left screen gives its WebGL context back (`disposeAndReleaseContext`; `ThreeRenderer.dispose` idempotent; the board mounts onto a signal): the menu after a mission reads 82–84 MB, down from 374–420 MB, and leaving the board before it mounts creates no context · **#221** this ledger, the scene-host spec and plan, the WP-T1 spec and plan · visual GREEN, no bless
- 2026-09-24 · four follow-ups, merged by the lead one minute apart (#214 → 51924fd4, #215 → b44c2c4d, #216 → 26710e46, #217 → c04880e1) · NO RELEASE: on all four runs the golden gate and the route walk passed but the artifact upload hit the private repo's quota, which failed `visual` and skipped `version` — PR #220 fixes it and its own run cuts the release · **#214** `ui:shots`/`ui:routes` take `--port=<n>` / `UI_SHOTS_PORT` / `UI_ROUTES_PORT` and REFUSE a busy port (exit 2; `ui:routes`' default 5177 had been walking the lead's own server) · **#215** `Renderer.reseed()` on `api.ts` replaces the three-snapshot re-seed (one `seedFromSim()` shared with `init`; `renderer.ts` +1 method, compiler-forced); the structure instancer grows to the sim (wadi_halam_2 58→59/60, qarn_hadid_2 20→21/22 under `&nomesh`); a unit spawned MID-mission no longer draws at (0,0) and slides in (a bought jeep crossed half the map at 483.7 tiles/s) — three only, Pixi keeps it (CLAUDE.md) · **#216** the campaign board's pin line is no longer clobbered by ground hover ~25 ms after the cursor arrives, nor flashed on leave · **#217** `ui:shots` photographs the victory/defeat moments again (SwiftShader screenshot 5.0–7.8 s vs the 2.6 s hold → `--gpu=metal|swiftshader`, Metal default on macOS, 115–164 ms) · all Approved after one or two fix rounds; visual GREEN on every PR, no bless
- 2026-09-24 · specs (docs only, this ledger's PR): the scene host (spec + 10-task plan, approved on recommendation; §10 numbers to the lead before Task 7) · WP-T1 telemetry + Cloudflare hosting (#218, approved by the lead; two backends DELIBERATE — D1 for telemetry, Supabase for lane D; consent DECIDED — accepted for the private test phase, a menu notice through `t()` gates public launch)
- 2026-09-24 · WP-A1.3 vehicle weight (#177, closed) · PR #213 → 9faed5f5 · v0.78.0 · seven tasks: a capture instrument with exact 200 ms rungs, a four-corner terrain conform (a wall or off-map corner falls back to the centre), a ramp-and-spring squat and dive with gain-scaled peaks, roll to the outside of a turn, authored `mobility.weight` with role defaults, speed-scaled dust, the composition with a world-space roll-sign test and no per-frame allocation, a numeric verdict on floors over three runs · after-set: Lavi launch 1.79°, dive −1.97°, lean 1.49°; Tel Marum bench 16.8° · visual GREEN, no bless · spec R-M and R-L amended
- 2026-09-24 · WP-S3e app half, Tasks 1–10 (#178 stays open for 11–12 and the scene host) · PR #212 → 65c6ea65 · v0.77.0 · deploy as a decision (DeployRosterView, a position-preserving permutation, the two-column spread with the ground; the runtime built after deploy with a renderer re-seed), the outcome moment before the debrief (carries the aftermath; the end screen keeps it), one stack-aware focus trap for four overlays, pin hover on the board, 1920/2560 layouts (D-8 = 761.6/2560 px), one HTML escaper and a strip that keeps focus · six tasks took one fix round, final review + one wave · spec D-40..D-51 · visual GREEN, no bless · CI found a pre-existing race in `ui:routes` (the board canvas counted before it drew; it had failed on main too) — fixed 20a0499c
- 2026-09-23 · WP-G-E2 #174 + WP-G-E4 #176 (closed) · PR #211 → f933477c · v0.76.0 · eight tasks + one fix wave: one `LedgerStore` seam, roster measured (largest chain 30) and capped at 150, slots that outlive their unit, overflow stands down to a reserve on write, the lost remembered and replaced, shown on the garage line, the debrief and the unit card; the final review caught two real bugs (recency by a per-mission tick; the split re-sorting who deploys) and the victory write became one tested function (`applyRosterCarryover`) · CI red once on a spec that assumed Node 25's jsdom storage, fixed b4d0a5b4 · visual GREEN, no bless · driven in a browser (garage line, deploy, card)
- 2026-09-23 · WP-S2b renderer half (#171, closed) · PR #210 → a387a6a2 · Phase 2 Tasks 15–16: the minimap photographs the lit ground through a render target, range rings are one desaturated fill · Task 16 one fix round, final review + one fix wave (a late ground texture invalidates the photograph) · visual RED as expected on all four gated scenarios, confined to the minimap box: quiet 6278 px / 0.6724, open-ground 1940 / 3.3034, vehicle 6338 / 0.6762, relief 14645 / 0.9220, 22 of 22 layer self-checks PASS · looked at (Tel Marum north at the top), captured twice (PR and main runs, minimap box identical) → bless adb6ab7f · spec D-28..D-39 · the version bump rides the next push, because a bless pushed by the workflow token cannot trigger CI
- 2026-09-20 · WP-A1.2 the blast (#172) · PR #209 → a567b892 · eight tasks + one fix wave, every review clean or closed in one round · the emitter registry never loaded `catastrophic_kill` (a kill's light/shake/hit-stop were silent) — found by measurement, fixed, every data registry pinned to its directory · visual job GREEN (R-L: `vehicle` has no blast), no bless · deferred: scorch on relief (follow-up), scorch opacity under a wreck (lead, on motion), the mortar keeps the crater column
- 2026-09-20 · WP-G-E3 content fixes (#175) · PR #208 → 9553e7a8 · six tasks + one fix wave, every review clean; six promotions grade ★★★ at both tiers; `captured` reachable via `ends_at` (the board was printing a wrong line); pins measured 6/15/22 → 5/13/19, ladder 5531 → 5849; 23 controls DEFEAT; no bless · deferred: prices.md §2/§3.4/§5–§8 on the old ladder; `chargeTunnel` drops mid-drift (sim-guard)
- 2026-09-19 · shell Phase 3 app-half PLAN (WP-S3e #178, docs only) · PR #198 → 8faccb1b · 12 tasks, 2 gated on G1 · five G1 questions posted on #165 · execution in Stage 2 after Phase 2's Tasks 15–16
- 2026-09-19 · shell Phase 2 Tasks 1–14 (S2a #170 + the app half of S2b #171) · PR #197 → 8596bc37 · 23 commits, 14 tasks, 7 fix rounds each closed in one round, final review + one fix wave · v0.73.0 · visual job GREEN, all four gated scenarios PASS against the Phase 0 baseline (the plan's hideHudExceptCanvas claim was wrong — the HUD IS in the frame — but the picture held) · no bless · deferred: Tasks 15–16 wait for A1.2; keyboard focus on the strip resets every 250 ms (Phase 3)
- 2026-09-18 · shell Phase 2 plan · PR #196 → 89e60848 · v0.72.0 cut at ef74d77a (the version job raced on three merges; two duplicate runs failed harmlessly)
- 2026-09-18 · blurbs (G0 #5) · PR #195 → 5bc04533 · no bless
- 2026-09-18 · WP-G-E1 Conduct floors 70–90 · PR #194 → a9efab12 · ladder 5531 unchanged · finding recorded on G1 #165
- 2026-09-18 · WP-L1 licence PolyForm NC + CLA · PR #193 → 40a276f9 · no bless
- 2026-09-18 · ledger 27b96bea, G0 answers 3d2a4045, Stage 1 opened 548f4f14 (docs)
- 2026-09-18 · shell Phase 1 · 274e35b5 · v0.70.0 / v0.71.0 · no bless · vehicle repaint drift closed c0044ff6 (v0.71.1) · Meshy CLI e3b5ea40
- 2026-09-17 · art Phase 1a infantry animation · 484c0589 · v0.69.0 · no bless
- 2026-09-17 · brigade economy step 3 Upgrade · ad4e65f · v0.67.0 · unit icons c88440d · v0.68.0
- 2026-09-17 · shell Phase 0 · 03fad18 · bless 495c1a4
- 2026-09-17 · brigade economy step 2 Buy · 47cb7c6 · v0.66.0
- 2026-09-16 · brigade economy step 1 Earn · 73b97f9 · infantry gait 5caa2f3
- 2026-09-15 · lit renderer (art Phase 0) · c4628dd · v0.63.0 · bless 2d7c23b · vehicle wrecks 8493fb5 · formations v0.64.0
- 2026-09-11..14 · motivation layer A, B, C · f383d31, 15a2b5c, 410b51b + bd18d73

## 5. Deferred and parked — reason and date

- Phase I paid path · until the account is server-held (E6) · 2026-09-15
- Posture change to free-to-play + Steam Wallet microtransactions (the lead's roadmap, 19 Sep): the August commercial plan's "Early Access at a price" is retired, its PPP pricing tiers and Early Access window void, its 7k wishlist floor still standing; ST5 #204, ST6 #205 and ST7 #206 are UNSCHEDULED until G7 #199 answers on 30 Oct, and G6 un-parks only when ST5+ST6 make the account server-held · 2026-09-19
- Shell Phase 4 platform (Steam Deck, controller) · product track · G2
- Shell deferred minors 9/10/13/15/17/20 and twelve task minors · spec §10 · 2026-09-18
- A1.3 parked: the Tel Marum capture subject is shot at tick ~281 (its stop lane is a known-dead lane) and every turn lane opens with a harness-made launch squat — clear the relief hostiles, hand-pump the cruise-up, retake both sets · HP bars and selection rings sit at the interpolated position while the hull draws up to `lag_tiles` behind (lead call) · on the bench climb the rear dips under the ground (pivot at hull centre) · 2026-09-24
- S3e parked: the aftermath is readable on the end screen only (2.6 s in the moment) · `campaign.ts:473` builds an English line outside `t()` · (the reseed item LANDED in #215) · 2026-09-24
- ~~The Cloudflare deploy has no SPA `not_found_handling`~~ resolved by #225 (deep links return 200 on the live site) · 2026-09-24
- 24 Sep follow-ups parked: Pixi still slides a mid-mission spawn in from (0,0) (the one-method `renderer.ts` unfreeze is reserved for compiler-forced edits) · the board's live-region hover measured 29,181 px (5.46%) against CLAUDE.md's 43,848 (7.52%), different point/bearing, unconfirmed · `pages.yml` fails on every push since the repo went private and ci.yml's `version` job re-dispatches it (WP-T1 retires both together) · 2026-09-24
- E2/E4 parked: a save from before v0.76.0 leaves no memorials in its first mission afterwards (R-7); `predecessorOf` is an O(n) scan per HUD refresh over the append-only lost list; a stale `roster-cap.test.ts` comment and an unreachable name fallback · 2026-09-23
- Phase 2 landing-2 parked: the capture-twice bless rule is a manual step, not in `three-baseline-gate.ts`; `main.ts`'s minimap flip memo has no test (`bootBattlefield` untestable as written); Pixi now polls a no-op ground ask at 4 Hz; `above = 120` duplicates `camera.ts`'s `CAMERA_DISTANCE` · 2026-09-23
- Art Phase 1 follow-ups: RPG-team Meshy importer WIP; mortar team dies by a 150 ms blend; civilians never show `down` · 2026-09-17
- Map variants for mission I of each town and First Light yard obstacles · lead's call · 2026-09-06
- Scene host parked for its final fix wave: two guard-path settle tests (Task 4), a test for the listener-removal `finally` (Task 5), the late-start test needs `await flush()` (Task 6); for Task 9: CLAUDE.md's `storedRenderer` line, ThreeRenderer.ts's two stale plate-capture comments, deviations D-52+ (main chunk +6.8 kB accepted) · 2026-09-24

## 6. Risks and debts — one line each, owner, when it bites

- The Conduct floors cannot spread on the optimal ladder (mission 1 scores 97): measure against a middling-player ladder first, change the gate shape only if that shows no spread either · G1 #165 · 2 Oct
- E5 is three units (~12 tasks), not two · Stage 3 lane B is heavier; its buffer absorbs it or A2's second plan slips a week · R1
- The `version` CI job races when PRs merge minutes apart (2026-09-18: one cut v0.72.0, two failed on the tag; 2026-09-24 again with four merges a minute apart) · each run bumps from ITS OWN commit, so only the newest can push · fix: check out `main`'s tip in that job plus a non-cancelling concurrency group, so the first run releases everything and later ones find nothing new · FIXED by PR #220 (a tip check: an older run steps aside with a notice) · every landing
- `ThreeRenderer.ts` is shared by both lanes · schedule interleave (A1.2 → S2b; A1.3 → scene host; S3g plan 2 → A2 plan 2) · every stage
- `qarn_hadid` z1.6 frame time is 14.86 ms against a 14.5 ms ceiling; the lead accepted the overage · perf-analyst · watch as more relief maps ship
- The control map's first build adds ~65 ms to boot · perf-analyst · watch on `pnpm dev` boot
- Meshy balance 454 credits vs ~540 for eighteen bakes · G1 · Stage 2
- The private repository's Actions artifact quota filled on 24 Sep ("Artifact storage quota has been hit"): the `visual` upload failed on all of that day's merges while the gate and route walk passed, which skipped `version` · FIXED by PR #220 (upload non-fatal, 3 days, not 14; v0.79.0 cut after it) · recalculated every 6–12 h; a bless still uploads its captures for 14 days · watch any bless
- The repo went private ~21–23 Sep; GitHub Pages is gone and the build deploys from Cloudflare Workers Builds (a `Workers Builds: roaring-lions` check now appears on PRs) · WP-T1 #218 LANDED (#225): `pages.yml` retired, `/stats` behind a password login because Cloudflare Zero Trust asks for payment details · the repo went PUBLIC again 25 Sep, restoring free Actions minutes · open: does Workers Builds build a `[skip ci]` release commit, so the live build carries the new version number · next release
- GitHub Actions was blocked by billing on the private repo from 24 Sep ~20:34 UTC (private repos have limited free minutes) · RESOLVED 25 Sep when the lead made the repo PUBLIC again, CI works · a pre-public history audit ran clean (secrets, sensitive files, personal data, large files); its one finding, unverified-licence art, is fixed at HEAD by #248 · 25 Sep
- Fable weekly cap · switch the session to Opus at 90%, findings written first · any long run (hit 20 Sep; the session moved to Opus 5.5 on 23 Sep)
- Local Node 25 gives vitest's jsdom a bare `{}` localStorage while CI's Node 22 gives a real Storage, so a storage spec can pass locally and fail in CI · specs install the storage shape they need · any storage test
- Clean worktrees under `.claude/worktrees/` were removed between sessions (20→23 Sep) and took the git-ignored SDD ledgers with them; branches survived · mirror every ledger to the session scratchpad, run `git worktree list` before trusting a path · every session gap
- Cross-OS visual equivalence never diffed · per-environment baselines stay · any bless
- Playtest harness is single-seed (424242) · a second seed flips three lines · Stage 4 re-pins
- `vehicle` thresholds calibrated against the old noise, not re-derived at the new zero floor · a decision · any bless of `vehicle`
- WP-G-E2 #174 and WP-G-E4 #176 must read and write the brigade account and the campaign ledger through ONE adapter (the future `LedgerStore` seam), never `localStorage` directly, or ST6 #205 reopens both screens · a ruling in both plans; S3e #178's `DeployRosterView` is already that seam · now, both about to start
- WP-G-E5 #181 sells units for brigade credits and cannot start before G7 #199 answers what the sold currency buys · Stage 3 lane B · 30 Oct
- The F2P posture voids the August commercial plan's PPP pricing and Early Access assumptions · that plan needs a rewrite before ST4 #203 writes store copy · Stage 4
- A backend is a new cost centre with NO OWNER: hosting, secrets, GDPR for EU players, Valve's MTX compliance · lane D #204–#206 · Stage 5
- Valve's 30% share plus payment fraud means the credit packages are priced LAST, after the cosmetic catalogue exists · ST7 #206 · Stage 6
- Licence is COMPATIBLE and needs no change: PolyForm Noncommercial (code) + art and data all rights reserved already reserves commercialisation to the lead · WP-L1 #192 · recorded 2026-09-19
- Shell spec "Phase 4 — platform (not scheduled)" is now ST2 #201 + ST3 #202; G0 #4 (Pixi, one mission per tab) is moot under a desktop wrapper and G2's Pixi retirement gains a reason (a second renderer is a second binary's download) · G2 #166 · 30 Oct

## 7. Protocols — never edited casually

- Landing: the `/land` checklist on the plan page §Tooling (branch check in the same call as the commit; cached-diff check; merge origin/main; full gate incl. typecheck, determinism, playtest, balance; PR for phases; CI watched)
- Bless: from CI numbers only, artifact downloaded and looked at, one in flight at a time, reason names the commit; never widen a threshold
- Worktrees: never the shared tree (`/Users/ilpinto/dev/roaring-lions`, on `feat/terrain-tiles`, stale); `/usr/bin/git`; pathspec commits; no reset/checkout/stash there; never switch worktrees while a subagent runs
- Models: haiku mechanical · sonnet implement and task review · opus sim, renderer, adversarial verification, final review; `get_usage` at session start
- Art: numbers table before any render; one unit per Meshy call; `pnpm meshy -- estimate` first and the lead's go; Blender for everything after; disclosure in `docs/ASSET_PROVENANCE.md`
- Servers: never kill a process you did not start; start on another port instead
- Community: scheduled task `community-feedback-check` (weekdays 08:30 Asia/Jerusalem, runs while the desktop app is open) reads GitHub, logs to the `community-feedback` memory, rewrites the plan page's community paragraph; read-only on GitHub, never posts
- Status board: the plan page's board and this file's §1–§3 are refreshed together at every landing and gate answer; the GitHub issues are the truth for state

## 8. Latest handoff prompt — verbatim, replaced at every handoff

```
HANDOFF — Roaring Lions · 2026-09-26 · from session "docs ledger update"
GOAL: run gamification E–I, shell 2–4 and art 1–4 on one schedule. M1 commander's HUD + one register 30 Oct ·
      M2 economy with decisions 27 Nov · M3 skirmish 22 Jan 2027 · M4 play with a friend 26 Mar 2027 · M5 Steam F2P (after G7).
PLAN: https://claude.ai/artifact/SND5uxua1RtGy82cxR3JC7 · LEDGER: docs/HANDOVER.md on main · GitHub synced (EP M1–M5, #164–#207, #218, #223, #226, #227, #236–#250)
STATUS: repo is PUBLIC again (25 Sep), CI works · main 165eb966 (v0.84.0 + re-bless) · landed 24–26 Sep: #236 win credits, #239 garage uplift spec (D1–D9), #240 garage filter fix, #241 ground spec (D8), #242 Worker observability, #244 garage uplift plan 1, #248 asset-provenance fix, #249 ground plan 1 (WP-A2, rebless 165eb966)
        IN FLIGHT: WP-S3g plan 2 (kit tier mark on the map) in `feat/garage-tier-mark` · WP-AU1 unit voices (#245; spec landed as #246) engine plan drafting
        merges: the LEAD merges
DECISIONS THIS SESSION: none — ledger update only, facts as supplied by the controller
NEXT STEP (exact):
  1. `git worktree list`; finish and land WP-S3g plan 2 (`feat/garage-tier-mark`), then sequence A2 plan 2 on `ThreeRenderer.ts`
  2. G1 #165 on 2 Oct unblocks A3.1 #179 and S3e Tasks 11–12; Meshy credits arrive early October
  3. Review #243 (garage comparison + Shift+Tab); triage #247 (manpad_team wheeled, Stage 4) and #250 (ATGM missile animation, after A2 plan 2)
CONSTRAINTS: §7 above; blesses one per landing from CI numbers only; ThreeRenderer.ts one lane at a time (S3g plan 2 before A2 plan 2)
READ FIRST: each plan's head + its SDD ledger · CLAUDE.md "The three.js backend" · memory: clean-worktrees-get-removed · land-commits-through-a-main-worktree
VERIFY BEFORE BELIEVING: pnpm lint && pnpm typecheck && pnpm test && pnpm test:determinism && pnpm validate:data
                         && pnpm validate:ui && pnpm playtest && pnpm balance · gh run list --branch main --workflow ci.yml --limit 3
OPEN FOR THE LEAD: G1 items (by 2 Oct) · G7 #199 (by 30 Oct) · WP-AU1 D5 (ElevenLabs commercial licence before committing samples)
```
