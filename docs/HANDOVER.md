# HANDOVER — Roaring Lions programme ledger

Updated: 2026-09-18 (G0 answered) · main: 27b96bea (v0.71.1 + ledger) · plan: https://claude.ai/artifact/SND5uxua1RtGy82cxR3JC7 · stage: 0 · next milestone: M1 30 Oct · GitHub: milestones EP M1–M4 (3–6), gate issues #164–#169, package issues #170–#191

Rules: under 200 lines, one line per item, edited per section. Details live in the spec, the plan or the SDD ledger a line links to. Updated at every landing and every gate answer. Committed with a pathspec from a main worktree, never from the shared tree.

## 1. Now — what is in flight (one line per lane; empty means idle)

| Lane | WP | Branch · worktree | Spec · plan · SDD ledger | State | Next action |
|---|---|---|---|---|---|
| A (packages/app) | — | — | — | idle | write the shell Phase 2 plan (open with the `MissionEvent` audit); WP-L1 licence change (#192) and the eight blurbs are two small tasks beside it |
| B (render · art · data) | — | — | — | idle | before-captures of the mortar impact and a vehicle death (still + 10 s); apply G-E1 (#173): floors to 70–90, re-pin |
| C (packages/sim) | — | — | — | closed until Stage 4 | — |

## 2. Next — ordered; a fresh session starts at the top of its lane

- A: L1 #192 licence (2 tasks) · S2a #170 → S2b #171 (one branch, one bless) → S3e #178 app half → S3e scene host (after A1.3 lands) → S3a #180 → S-F #184, A4 #186
- B: A1.2 #172 blast → G-E1..E4 #173–#176 → A1.3 #177 vehicle weight → A3.1 #179 bible + Meshy batches → G-E5 #181 → A2 #182 → A3.2 #185
- C: G-F #183 (four plans) after G3 on 2 Nov → G-G0 #187 spike 30 Nov → G-G #188 → G-H0 #190 spike 25 Jan → G-H #191

## 3. Gates — open decisions, defaults, dates, answers

G0 #164 answered 18 Sep and closed. Answer the rest on their issues: G1 #165 · G2 #166 · G3 #167 · G4 #168 · G5 #169. Answers are copied here with the date, then the issue is closed.

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

## 4. Landed — append-only, newest first

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
- Shell Phase 4 platform (Steam Deck, controller) · product track · G2
- Shell deferred minors 9/10/13/15/17/20 and twelve task minors · spec §10 · 2026-09-18
- Art Phase 1 follow-ups: RPG-team Meshy importer WIP; mortar team dies by a 150 ms blend; civilians never show `down` · 2026-09-17
- Map variants for mission I of each town and First Light yard obstacles · lead's call · 2026-09-06

## 6. Risks and debts — one line each, owner, when it bites

- E5 is three units (~12 tasks), not two · Stage 3 lane B is heavier; its buffer absorbs it or A2's second plan slips a week · R1
- `ThreeRenderer.ts` is shared by both lanes · schedule interleave (A1.2 → S2b; A1.3 → scene host) · every stage
- Meshy balance 454 credits vs ~540 for eighteen bakes · G1 · Stage 2
- Fable weekly cap · switch the session to Opus at 90%, findings written first · any long run
- Cross-OS visual equivalence never diffed · per-environment baselines stay · any bless
- Playtest harness is single-seed (424242) · a second seed flips three lines · Stage 4 re-pins
- `vehicle` thresholds calibrated against the old noise, not re-derived at the new zero floor · a decision · any bless of `vehicle`

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
HANDOFF — Roaring Lions · 2026-09-18 · from session "Execution plan"
GOAL: run gamification E–I, shell 2–4 and art 1–4 on one schedule. M1 commander's HUD + one register 30 Oct ·
      M2 economy with decisions 27 Nov · M3 skirmish 22 Jan 2027 · M4 play with a friend 26 Mar 2027.
PLAN: https://claude.ai/artifact/SND5uxua1RtGy82cxR3JC7 · LEDGER: docs/HANDOVER.md on main · GitHub synced 18 Sep (milestones EP M1–M4, issues #164–#191)
STATUS: Stage 0 · nothing from this plan in flight · main dd7097bb (v0.71.1) · CI green on main
        shell Phase 1 landed 274e35b5 · art infantry animation v0.69.0 · economy step 3 v0.67.0
        the shared tree /Users/ilpinto/dev/roaring-lions is on feat/terrain-tiles and stale: never work there
DECISIONS THIS SESSION: G0 all fourteen answered 18 Sep (§3): defaults on 2–10, 12–14; #1 → PolyForm NC + CLA (WP-L1 #192); #11 → three units.
NEXT STEP (exact):
  1. G0 is done. Lane A: WP-L1 #192 (licence files + CLA.md + README/credits) and the eight unit blurbs, then the Phase 2 plan
  2. Lane A: write docs/superpowers/plans/2026-09-2x-shell-upgrade-phase-2.md (WP-S2a #170 + S2b #171), opening with the MissionEvent audit
     Lane B: before-captures of the mortar impact and a vehicle death (still + ten seconds) for WP-A1.2 #172; apply G-E1 #173 when #9 answers
  3. At the first landing: refresh this file §1/§4/§8 AND the plan page's status board in the same step
CONSTRAINTS: §7 above; the shell spec §10 file boundary; blesses one per landing; ThreeRenderer.ts one lane at a time
READ FIRST: docs/superpowers/specs/2026-09-16-shell-upgrade-design.md §6 Phase 2 + §10 · gamification page §Phase E ·
            art page §Phase 1 · CLAUDE.md "The three.js backend" and "Mesh units" ·
            memory: land-commits-through-a-main-worktree · concurrent-sessions-share-this-working-tree ·
            subagent-model-tiering · meshy-api-policy · hud-changes-move-the-visual-gate
VERIFY BEFORE BELIEVING: pnpm lint && pnpm typecheck && pnpm test && pnpm test:determinism && pnpm validate:data
                         && pnpm validate:ui && pnpm playtest && pnpm balance · gh run list --branch main --workflow ci.yml --limit 3
OPEN FOR THE LEAD: G0 #11 special-forces concepts (needed by 19 Oct) · G1 Meshy top-up (by 2 Oct)
```
