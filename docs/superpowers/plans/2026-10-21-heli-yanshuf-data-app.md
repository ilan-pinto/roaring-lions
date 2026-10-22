# UH-60 Yanshuf (`heli_yanshuf`, GH-698): data and app lanes. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (lean: one fresh implementer per task, one reviewer, push after each task). Steps use checkbox (`- [ ]`) syntax.

**Goal:** the Yanshuf becomes a real unit: buildable from the dock on a `resources` mission once the brigade has Conduct 84 and paid 500 credits, drawn with its GLB, readable on the HUD (seats, flight state), and measured by a report-only air-assault probe. It stays OFF the versus menu.

**Spec:** `/Users/ilpinto/dev/roaring-lions-ep/_coord/blackhawk/spec.md` (lead rulings at top, binding). **Sim:** landed in #713 (plan `2026-10-18-heli-yanshuf-sim.md`): `airState`/`airTimer`/`airWant`, `isAirCarrier`, `isAirborne`, deferred hash fold (`airLive`, set when an air-carrier TYPE is registered). **Art:** landed in #701, the GLB is in `HELD_MESH_FILES`; the portrait already exists.

**Base:** `origin/main` @ `33a30adcb`. Worktree `/Users/ilpinto/dev/roaring-lions-ep/yanshuf-data`, branch `feat/yanshuf-data`. Ledger `/Users/ilpinto/dev/roaring-lions-ep/_coord/yanshuf-data-progress.md`.

## Pre-flight finding (measured before writing this plan)

**Registering the type in `@lions/data`'s `units` moves the three versus/net hash pins** (`580559085`, `1260439781`, `3043363756`), because `buildMatchWorld` (`packages/app/src/net/match-world.ts`), `versus-world.test-helper.ts` and `tools/src/backtest/versus-probe.ts` register EVERY unit in `units`, and a registered air carrier turns on the air block's hash fold. Measured: with the JSON appended at the END of `units` (so no later type index shifts) and `transport_slots: 6`, 13 net specs fail, three of them hash pins; with `transport_slots: 0` only the 10 roster-count literals fail and every hash pin holds. So the move is the fold, not the type count.

**Resolution in this plan (reported to the lead, reversible in one line):** the versus registry holds the Yanshuf out, since it cannot be fielded there anyway (off the menu, spec Q9). One named set, `VERSUS_HELD_UNITS` (`packages/app/src/net/versus-roster.ts`), read by all three registration sites through one helper `versusRoster()`; the roster-count literals and the hash pins then stay exactly as they are. When the probe earns it a menu place, deleting the id moves the pins in that commit, which is the right time. If the lead prefers the pins to move now, the set is emptied and the pins re-measured.

## Global constraints

- Four invariants (CLAUDE.md). No sim code change in this plan; if a task appears to need one, stop and report.
- **STOP-and-report** on any move of `LADDER_CREDITS`, `ROSTER_MAX`, a `pnpm playtest` outcome, the versus/net pins, `pnpm balance` §5.7, or the determinism goldens.
- Never `git add -A`; `git commit -F <msg> -- <paths>`. Never `git checkout <file>`. Never pkill/killall. Commits end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push the branch after each task.
- No local `ui:routes`, `golden-baseline`, `ui:shots`. Browser tools run with music off (`musicOffInitScript`), on their own port, never 5177.
- Strings through `t()` with keys in `en.json`; no world status marks (status goes on the card/icons).
- Every new check is seen red once (a one-line mutation), quoted in the commit body.
- Gates before each commit: `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data` (+ `pnpm test:determinism`, `validate:ui`, `validate:meshes`, `balance`, `playtest` where the task says).

## Task 1: land the unit (data + mesh, one commit)

**Files:** `data/units/kdf/heli_yanshuf.json` (spec §3 verbatim, `voice: "air"`), `packages/data/src/index.ts` (import + `units` entry appended LAST), `packages/app/src/net/versus-roster.ts` (new) + the three registration sites, `packages/app/src/mesh-catalogue.ts` (out of `HELD_MESH_FILES`, into `VEHICLE_UNIT_MESHES` beside `heli_peten`), and every roster pin that enumerates KDF/air/vehicle ids (follow `ba79894c9`, the E5 landing, as the template): `readability.ts` (0.9 like the Peten), `vehicle-weight-params.ts` + its roster test, `data/audio.json` engine family `rotor`, `voice/lines.test.ts`, `packages/worker/src/match/kit-tracks.ts`, brigade/garage tests, `e5_staged`-style guards if any name it, garage plate `assets/ui/plates/units/heli_yanshuf.jpg` + manifest.

- [ ] JSON + registration; `pnpm validate:data`.
- [ ] `versusRoster()` and `VERSUS_HELD_UNITS`; net specs green with NO literal changed. Falsify: empty the set -> the three hash pins go red.
- [ ] Mesh out of held, into the catalogue; the held/landed guard tests updated.
- [ ] Unit is NOT in `data/doctrines/kdf.json`.
- [ ] Cost curve: `python3 tools/validate_balance.py` plain and `--max-tier` (and whatever extra flags CI passes, read from `ci.yml`). Record power/cost/curve/deviation for the Yanshuf (spec expects ~+14% / ~+17%).
- [ ] Garage plate: `pnpm plates:units -- --only=heli_yanshuf --metal --port=<free, not 5177>` (music off is the harness default; confirm). Plate + manifest committed.
- [ ] `git status art/meshes/` clean of strays, then `pnpm validate:meshes`.
- [ ] `pnpm playtest` and `pnpm balance` byte-identical to base (save base outputs first; wall-clock line excepted). `pnpm test:determinism`.

## Task 2: the air-assault probe (report-only, spec §4)

**Files:** `tools/src/backtest/air-assault-probe.ts` (+ a small `.test.ts` that pins the harness's own mechanics, not the numbers), modelled on `saddle-price.ts`. Registers the unit JSON through `units`.

- Maps `tel_marum`, `qarn_hadid`; 10 seeds per arm; entity ids fixed across arms (`debugKill`, never deleting a placement).
- Arms: 6 `inf_squad` on foot / by 1 `apc_kipod` / by 1 Yanshuf to one objective tile; Yanshuf into a cold LZ / LZ inside a `manpad_team`'s envelope / inside a `gun_truck`'s / MANPAD+ZU with a `heli_peten` escort.
- Report per arm: time to objective (median), squads lost, Yanshufs lost, airborne vs landed kills, plus the time spent LANDING/LIFTING.
- Bar (spec proposal): hot LZ (MANPAD+ZU, no escort) kills the Yanshuf in >= half the seeds; cold LZ beats the Kipod by >= 2x on time.
- Land/lift: rerun the hot-LZ arm at 40/20 (shipped) and at two alternatives through a probe-local override if the sim exposes none (do NOT change `tuning.ts`); report the recommendation. Changing the constants is a sim/lead call.
- Script entry `pnpm --filter @lions/tools exec tsx src/backtest/air-assault-probe.ts`; output summary into the commit body and the PR.

## Task 3: the app (HUD card, verbs, symbol, landed descent)

- **Unit card** (`packages/app/src/ui/hud.ts`): for any carrier, seats as `n/slots` pips filled by `sim.passengerCount(i)`, and the riders' role chips; for an air carrier, a flight line from `sim.state.airState`: Airborne / Landing / On the ground / Lifting off (`hud.card.air.*`). No string names `airState`.
- **Verbs** (`packages/app/src/input/intents.ts` `resolveKeyVerb`): mount onto an air carrier reads "landing to take them aboard"; dismount from an air carrier reads "landing to unload"; same intents, same commands (the sim lands then unloads). The world needs an `isAirCarrier(id)` read.
- **Unload at a clicked point: DEFERRED** (needs an `x/y` on the `unload` command and the net codec, a separate decision). Say so in the PR.
- **Symbol** (`packages/app/src/ui/symbol.ts`): an air transport gets `AIR_FRAME` (a `transportAir` glyph or a flag), only if it is a small change; otherwise defer and say so.
- **Landed descent** (`packages/render/src/three/ThreeRenderer.ts`, the `AIR_LIFT_PX` sites): an air carrier's lift eases to 0 over LANDING, is 0 LANDED, and eases back over LIFTING, read from `state.airState`/`airTimer` (presentation only, no sim read-back). One pure helper `airLiftFrac(state, timer)` with tests; every lift site reads it.
- **Feed line** on an airborne kill ("Yanshuf down, N aboard lost") if `destroyed` events plus `carriedBy` at the kill tick suffice; otherwise defer.
- Gates incl. `pnpm validate:ui`.

## Task 4: whole-branch gates and the PR

All gates in the brief; PR (not draft) listing what shipped, the versus hold, the probe readings and recommendation, and what stays deferred (unload-at-point, mission placements, versus menu).
