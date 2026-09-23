# HANDOVER — Roaring Lions programme ledger

Updated: 2026-09-23 (Phase 2 complete; three lanes executing) · main: adb6ab7f (PR #210 + bless) · plan: https://claude.ai/artifact/SND5uxua1RtGy82cxR3JC7 · stage: 1 (ahead: S3e opened early) · next milestone: M1 30 Oct · GitHub: milestones EP M1–M5 (3–7), gate issues #164–#169 + G7 #199, package issues #170–#192 + Steam WP-ST1–ST8 #200–#207

Rules: under 200 lines, one line per item, edited per section. Details live in the spec, the plan or the SDD ledger a line links to. Updated at every landing and every gate answer. Committed with a pathspec from a main worktree, never from the shared tree.

## 1. Now — what is in flight (one line per lane; empty means idle)

| Lane | WP | Branch · worktree | Spec · plan · SDD ledger | State | Next action |
|---|---|---|---|---|---|
| A (packages/app) | S3e #178 app half (Phase 3 Tasks 1–10; 11–12 after G1) | `feat/shell-phase-3-app` · `.claude/worktrees/ep-s3e` | plan `docs/superpowers/plans/2026-09-19-shell-upgrade-phase-3-app.md` · SDD ledger in the worktree, mirrored to the session scratchpad | 23 Sep: opened ahead of Stage 2 (5 Oct) because its real entry condition, Phase 2 Tasks 15–16, landed; pre-flight scan running | Task 9 (pin hover) first, disjoint from E2/E4 → after E2/E4 lands, merge origin/main → 1→2→3→4 (Task 1 takes `ROSTER_CAP`) → 8→5→6→7→10; one bless budgeted (Task 10 touches `hud.ts`) |
| B (render · art · data) | G-E2 #174 + G-E4 #176 (one plan) · A1.3 #177 vehicle weight | `feat/gamification-e2e4` · `.claude/worktrees/ep-e2` · `feat/art-vehicle-weight` · `.claude/worktrees/ep-a13` | plans `docs/superpowers/plans/2026-09-20-gamification-e2-e4.md` (8 tasks) · `docs/superpowers/plans/2026-09-20-art-vehicle-weight.md` (7 tasks) | 23 Sep: E2/E4 Tasks 1–5 done (LedgerStore seam, roster total 30 → cap 150, slots, reserve split, lost and replaced), Task 6 in flight · A1.3 Task 1 instrument done + one fix round (pump every tick), before-set being re-taken | E2/E4 Tasks 6–8 → final review → one PR · A1.3 Tasks 2–5, then Task 6 on `ThreeRenderer.ts` (unblocked now that #210 landed; merge origin/main first) → Task 7 after-set → one PR |
| C (packages/sim) | — | — | — | closed until Stage 4 | — |

## 2. Next — ordered; a fresh session starts at the top of its lane

- A: S3e #178 app half (Tasks 1–10 now, 11–12 after G1) → S3e scene host (after A1.3 lands) → S3a #180 → S-F #184, A4 #186
- B: G-E2/E4 #174/#176 → A1.3 #177 vehicle weight → A3.1 #179 bible + Meshy batches → G-E5 #181 → A2 #182 → A3.2 #185
- C: G-F #183 (four plans) after G3 on 2 Nov → G-G0 #187 spike 30 Nov → G-G #188 → G-H0 #190 spike 25 Jan → G-H #191
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
| G1 | — | Meshy credit top-up (454 vs ~540 needed) | top up for 18 bakes; previews only for props | 2 Oct | — |
| G1 | — | Style bible + prompt template; symbol sheet; board route; vehicle numbers; portrait rig | as on the plan page | 2 Oct | — |
| G2 | — | Retire Pixi + sheets; Steam page timing; bless via PR; platform | go · flag · restore PR · unscheduled | 30 Oct | — |
| G3 | — | Economy shape (intel by doing, held-line income, production, population, starting_force) + skirmish fun criteria | as on the plan page | 30 Oct | — |
| G4 | — | Skirmish go/no-go from five games | — | 14 Dec | — |
| G5 | — | Transport, input delay, co-op rules | Colyseus relay · 3 ticks · shared Conduct/grade/credits | 5 Feb 2027 | — |
| G7 | #199 | What does the sold currency buy? Brigade credits buy units, upgrade tiers and E5 today; the roadmap's Phase 4 forbids selling a competitive advantage | TWO currencies: brigade credits stay earned-only and are never sold; a new cosmetic currency ("marks") is what Steam Wallet sells, spending only on liveries, badges and operation passes | 30 Oct | — |

## 4. Landed — append-only, newest first

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
- Phase 2 landing-2 parked: the capture-twice bless rule is a manual step, not in `three-baseline-gate.ts`; `main.ts`'s minimap flip memo has no test (`bootBattlefield` untestable as written); Pixi now polls a no-op ground ask at 4 Hz; `above = 120` duplicates `camera.ts`'s `CAMERA_DISTANCE` · 2026-09-23
- Art Phase 1 follow-ups: RPG-team Meshy importer WIP; mortar team dies by a 150 ms blend; civilians never show `down` · 2026-09-17
- Map variants for mission I of each town and First Light yard obstacles · lead's call · 2026-09-06

## 6. Risks and debts — one line each, owner, when it bites

- The Conduct floors cannot spread on the optimal ladder (mission 1 scores 97): measure against a middling-player ladder first, change the gate shape only if that shows no spread either · G1 #165 · 2 Oct
- E5 is three units (~12 tasks), not two · Stage 3 lane B is heavier; its buffer absorbs it or A2's second plan slips a week · R1
- The `version` CI job races when PRs merge minutes apart (2026-09-18: one cut v0.72.0, two failed on the tag) · merge one PR at a time and wait for `version`; a concurrency group on that job is a small CI fix worth queuing · every landing
- `ThreeRenderer.ts` is shared by both lanes · schedule interleave (A1.2 → S2b; A1.3 → scene host) · every stage
- Meshy balance 454 credits vs ~540 for eighteen bakes · G1 · Stage 2
- Fable weekly cap · switch the session to Opus at 90%, findings written first · any long run (hit 20 Sep; the session moved to Opus 5.5 on 23 Sep)
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
HANDOFF — Roaring Lions · 2026-09-23 · from session "Execution plan"
GOAL: run gamification E–I, shell 2–4 and art 1–4 on one schedule. M1 commander's HUD + one register 30 Oct ·
      M2 economy with decisions 27 Nov · M3 skirmish 22 Jan 2027 · M4 play with a friend 26 Mar 2027 · M5 Steam F2P (after G7).
PLAN: https://claude.ai/artifact/SND5uxua1RtGy82cxR3JC7 · LEDGER: docs/HANDOVER.md on main · GitHub synced (EP M1–M5, #164–#207)
STATUS: Stage 1 · main adb6ab7f · shell Phase 2 COMPLETE (PR #197 Tasks 1–14, PR #210 Tasks 15–16, bless adb6ab7f) · three SDD loops open:
        A · S3e #178 on feat/shell-phase-3-app (.claude/worktrees/ep-s3e) — pre-flight scan, then Task 9
        B · E2/E4 #174/#176 on feat/gamification-e2e4 (ep-e2) — Tasks 1–5 done, Task 6 in flight
        B · A1.3 #177 on feat/art-vehicle-weight (ep-a13) — Task 1 instrument + fix round done, before-set re-take running
        each loop's ledger: <worktree>/.superpowers/sdd/<plan>/progress.md, mirrored to the session scratchpad ledgers/
DECISIONS THIS SESSION: S3e opened before Stage 2's date because its entry condition (Phase 2 Tasks 15–16) is met; its Task 1 waits
        for E2/E4 (it takes ROSTER_CAP). LedgerStore stays a synchronous seam (ST6 = sync façade over a boot-hydrated cache).
        The A1.3 instrument pumps the frame clock on every tick and records model_ms per cell (a rung was 418–450 ms before).
NEXT STEP (exact):
  1. `git worktree list` — if a lane worktree is missing, `git worktree add .claude/worktrees/<name> <branch>` + pnpm install, restore its ledger from the scratchpad copy
  2. Resume each loop at the first task without a "Task N: complete" line; ONE PR merged at a time, wait for `version`
  3. E2/E4 lands first → S3e merges origin/main → Tasks 1–4; A1.3 Task 6 merges origin/main before touching ThreeRenderer.ts
  4. G1 #165 on 2 Oct: Meshy top-up, style bible, symbol sheet (unblocks S3e 11–12), board route, vehicle numbers, portrait rig
CONSTRAINTS: §7 above; blesses one per landing from CI numbers only; ThreeRenderer.ts one lane at a time; merge ONE PR at a time
READ FIRST: each plan's head + the ledger · CLAUDE.md "The three.js backend" · memory: clean-worktrees-get-removed · land-commits-through-a-main-worktree
VERIFY BEFORE BELIEVING: pnpm lint && pnpm typecheck && pnpm test && pnpm test:determinism && pnpm validate:data
                         && pnpm validate:ui && pnpm playtest && pnpm balance · gh run list --branch main --workflow ci.yml --limit 3
OPEN FOR THE LEAD: G1 items (by 2 Oct) · G7 #199 (by 30 Oct) · A1.3 open questions (wheel/track art deferral, turret feel, parameter home)
```
