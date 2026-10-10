# Roaring Lions — Commercial Polish Execution Plan

> Adopted by the lead on 6 Oct 2026 as the **polish lane** of the execution plan
> (https://claude.ai/artifact/SND5uxua1RtGy82cxR3JC7), with these adaptations:
> 1. The polish lane is presentation/UX only and runs from now; Stage 4 (economy F1–F4, Hold
>    position, from 2 Nov) stays as planned. §18's "no new systems" binds this lane, not the roadmap;
>    each new Stage 4 screen is polished to this bar when it lands.
> 2. §22 (release blockers) and §16 (score: no category below 4) are the exit criteria for
>    milestones M3 and M4; the audit is re-scored at each milestone.
> 3. Heavy checks (`pnpm ui:routes`, `pnpm golden-baseline`, full capture walks) run on CI, not on the
>    lead's machine; local browser work only when a task needs captures, one at a time, every
>    process stopped by PID afterwards. Every test browser starts with music off (tools/src/ui-review/music-off.ts).
> 4. §24's "don't ask between stages" is bounded by the lead's standing rules: art numbers and mocks
>    are approved before building; no sim change without the lead's approval; bless only from CI numbers.
> 5. The tester cohort (WP-TC #302) is the §21 human-experience gate.

## Mission

Bring Roaring Lions from "excellent technical RTS prototype" to "commercial-quality indie RTS presentation and player experience." This is a POLISH project. Do NOT turn it into a feature-development project. Do NOT add new gameplay systems merely because they would be interesting. Do NOT rewrite the engine. Do NOT weaken existing architectural invariants. The objective is to make the existing game feel deliberate, cohesive, readable, responsive, satisfying, and finished.

Target experience: a new player can launch Roaring Lions, understand what to do without outside explanation, command units confidently, understand why important events occurred, enjoy the audiovisual feedback, complete the first mission, understand the result, and immediately want to continue.

## 0. Non-negotiable repository rules

Read CLAUDE.md, docs/GDD.md, docs/HANDOVER.md, relevant specs under docs/superpowers/specs/, docs/art/, and the UI/render/audio architecture docs. Respect all invariants: fixed 20 Hz sim; deterministic fixed-point `@lions/sim`; no float or wall-clock APIs in the sim; seeded deterministic randomness; commands → sim → state/events; `app → render → sim`; missions as declarative data; no retired sprite/Pixi paths; no external engines/ECS/physics; no assets without provenance/licensing; no raw UI colour literals outside the token mechanism; never bypass or weaken validation gates.

## 1. First task: establish a baseline

Do not start coding. Run the existing checks (test, test:determinism, typecheck, lint, validate:data/ui/meshes/audio, balance, playtest; ui:routes via CI) and inspect CI. Separate failures into A (pre-existing: record, don't silently fix), B (introduced by polish: must fix), C (polish defects found: become work items).

## 2. Create a polish backlog before implementation

Create `docs/polish/commercial-polish-audit.md` with: an executive assessment; a defect table `| ID | Area | Problem | Player impact | Frequency | Severity | Cost | Priority |` (P0 blocks commercial release, P1 strongly damages perceived quality, P2 noticeable but non-blocking, P3 minor; priority = player impact × frequency × visibility, never implementation convenience); and before-screenshots of: main menu, campaign, brigade, briefing, deployment, battlefield idle, selected infantry, selected vehicle, movement command, combat, suppression/major event, objective update, alert, minimap, pause, victory, defeat, debrief, veteran/unit info, settings (existing capture tooling).

## 3. Golden principle

For every change: does it make the player's next action clearer, the previous action more understandable, or the current moment more satisfying? If not, don't implement it. Avoid decorative work.

## 4. Pass A — Input and interaction feel (first)

- **A1 Selection:** single/box/multi/clear/mixed/damaged/reselect/persistence. Improve ring visibility, size consistency, brightness hierarchy, primary vs secondary, team readability, emphasis, transitions, hover vs selected. Accept: obvious, readable on busy terrain, multi-selection legible at a glance, never overpowering.
- **A2 Cursor states:** normal, hover unit/friendly/enemy, attack, move/action, invalid, garrison, demolition, smoke/special, UI, unavailable — distinct, consistent geometry/animation/scale, no jitter. The cursor explains the click before the click.
- **A3 Command acknowledgement:** layered (immediate visual, unit response, optional audio, world response), escalating: routine = small visual; important = visual+audio; critical = visual+audio+HUD alert.
- **A4 Movement feel:** start, formation, turning, stop, avoidance, arrival, halt, regroup, infantry/vehicle sync; look for abrupt starts, unnatural stops/rotation, stretching, overlap, oscillation, indecision, sliding vehicles, gliding infantry. Prefer presentation fixes; sim changes only for a clear observable gameplay defect.
- **A5 Camera:** pan speed, acceleration/deceleration, zoom and zoom centre, transitions, centering, alert jump, control-group centering, screen edge. Predictable, smooth, fast enough, never floaty or jerky, never lose context.

## 5. Pass B — HUD and battlefield information

- **B1 Hierarchy:** Level 1 immediate (selected units, objective, major alerts, imminent threat, command result) visually dominant; Level 2 tactical (unit info, projected fire, suppression, abilities, groups); Level 3 strategic/reference (campaign, credits, secondary, diagnostics).
- **B2 Consistency:** typography, sizes, icon scale, padding, corners, borders, shadows, opacity, spacing, selected/disabled/hover states, transition timing — one design system, semantic tokens, no one-offs.
- **B3 Commander HUD:** build on the approved direction (#364); friendly units identifiable, recipients emphasised, no-visibility readable, glanceable alerts, battlefield not obscured; a command interface, not HTML panels.
- **B4 Projected-fire UI:** answer "can I make this shot effectively?" — readability, confidence, factor explanation, target relationship, friend/enemy, uncertainty, update timing, noise. Hide internals unless they improve the decision.

## 6. Pass C — Combat presentation

- **C1 Hit feedback:** was it seen, understood, did it matter, too weak/strong — tune projectiles, impact timing/effect, hit flash, camera response, sound, smoke/debris, vehicle response, suppression feedback.
- **C2 Damage states:** healthy, damaged, suppressed, mobility degraded, firepower degraded, destroyed — visually understandable, not numbers only.
- **C3 Event tiers:** minor, important, major (vehicle destroyed, objective, breakthrough, key loss), mission-defining — progressively stronger.
- **C4 Suppression:** "alive but losing effectiveness" — restrained animation, UI state, sound, subtle world response, posture; no overdone screen effects.

## 7. Pass D — Visual identity

- **D1** Create `docs/polish/visual-register.md`: colour philosophy, friend/enemy/neutral, terrain palette, lighting, material response, outlines, icons, typography, effects intensity, UI chrome, selection, damage, alert language — from existing palette/tokens.
- **D2** Unit consistency: scale, framing, silhouette, material, lighting, team ID, animation, shadows — no visible production-pass seams.
- **D3** Infantry: walk, idle, stop, turn, aim, attack, suppression, death, transitions — natural transitions over more animations.
- **D4** Vehicles: movement, suspension/pitch, turning, firing, impact, wreck, shadow, scale; never float or slide.
- **D5** Buildings/props: repetition, scale, empty space, damage readability, silhouettes, roads, rocks, trees, clutter — authored, not noisy.

## 8. Pass E — Environment and composition

Per campaign town: focal areas, clear routes, readable objective zones, terrain variation, balance, no dead areas; never sacrifice tactical readability (props covering units, shadows hiding units, foliage hiding selections, excess VFX, clutter at objectives); tune dawn/day/dusk, contrast, shadows, haze, depth for mood with clarity.

## 9. Pass F — Audio

- **F1 Hierarchy:** ambience (always, low), unit feedback, combat (dynamic, located), voice/radio (high information), UI (restrained), music (emotional).
- **F2 Voice director:** repetition, timing, interruption, priority, silence, radio effect, captions, relevance; silence is intentional.
- **F3 Missing/placeholder:** silent events, inconsistent recordings, repeated lines, placeholders, missing victory/defeat and objective cues — most visible gaps first.
- **F4 Mix:** information intelligible in combat, music ducks, voice understandable, explosions don't flatten, UI doesn't compete.

## 10. Pass G — Menus and meta-game UX

Main menu, Continue, New Campaign, Campaign, Brigade, Free Play, Saves, Settings, Controls, Credits, back navigation, pause, mission exit. Per screen: where am I, what can I do, what is primary, what does Escape do, can I go back safely, is state obvious.

## 11. Pass H — Campaign experience

- **H1 Briefing:** where, what happened, objective, what matters, what to avoid — concise.
- **H2 Deployment:** a decision, not a spreadsheet — roster clarity, veteran identity, roles, consequences, hierarchy, confirmation.
- **H3 Mission start:** briefing → deployment → transition → battlefield → first command; no abrupt UI-to-world jump.
- **H4 Mission end:** result, reason, accomplishment/failure, losses, consequences.
- **H5 Debrief:** Conduct, stars, secondaries, survival, veteran history, consequences, progression — what did I do well/poorly, what changed.
- **H6 Veterans:** name, role, service history, commendations, losses survived, state, contribution — progressive disclosure.

## 12. Pass I — Accessibility and usability

Text size, contrast, colour-only indicators, captions, keyboard navigation, rebinding, focus, pause, alerts, motion intensity, audio settings.

## 13. Pass J — Responsive/performance

Low/medium/high, large unit counts, big combat, many effects, minimap, UI-heavy moments, campaign map, transitions: frame pacing, stutters, input delay, pop-in, LOD transitions, shader stalls, audio glitches, camera hitching. Stable 60 fps over high averages with spikes.

## 14. Pass K — Error states and edge cases

No selection, invalid command, unavailable action, empty deploy slot, save/load/overwrite, leaving mission (incl. from pause), victory, defeat, retry, progression, missing optional audio, asset load failure, WebGL limits, resize, unusual resolutions. Every error says what happened, why, and what to do next; never debug language.

## 15. Pass L — First 10 minutes

"Player has never played Roaring Lions": 0–1 min (what game, who I control, what first), 1–3 (select, move, attack, feedback), 3–5 (cover, threat, positioning), 5–10 (meaningful objective, why it worked/failed, a satisfying combat moment). Record all friction; don't explain the game.

## 16. Commercial polish score

Score 1–5: input feel, selection, camera, combat feedback, HUD, visual identity, environment, audio, briefing, debrief, campaign flow, accessibility, performance. Target: no category below 4; most at 4.5+.

## 17. Implementation order

1. Interaction (cursor, selection, command feedback, movement, camera, invalid-action feedback). 2. HUD (hierarchy, commander HUD, unit info, alerts, projected fire, objectives, minimap, transitions). 3. Combat feedback (impacts, reactions, suppression, damage states, destruction, major events, sound, timing). 4. Visual register (UI, units, infantry, vehicles, buildings, environment, lighting, VFX). 5. Audio (critical cues, voice, combat mix, ambience, music transitions, victory/defeat, captions). 6. Campaign (briefing, deployment, start, end, debrief, veterans, consequences). 7. Release polish (settings, save/load, navigation, errors, resolutions, performance, accessibility, final regression).

## 18. Scope discipline (binds the polish lane)

No multiplayer, new engine, new ECS, unrelated campaign mechanics, new resource system, combat-model redesign, style rewrites of working sim, decorative asset padding, large rewrites without player benefit, test removal, weakened validation. Every change has a player-facing reason.

## 19. Commits

Small coherent commits (`polish: improve selection feedback`, …), never one giant commit. After each package: test, typecheck, lint, validate:data, validate:ui; heavier gates as the area requires (on CI).

## 20. Before/after evidence

Per package: main menu, briefing, battlefield, selected units, combat, major event, victory, debrief — same map, camera, zoom, tick and UI state where possible. Answer "is this objectively better?"

## 21. Final human-experience gate

Test A: an RTS veteran, no explanation. Test B: someone new to Roaring Lions. Test C: silent observation, write down every question. (Tester cohort #302.)

## 22. Release blockers

Not complete if: a first-timer can't understand the basic objective; selection ambiguous; important commands lack feedback; major combat events hard to perceive; HUD hierarchy inconsistent; visual styles vary across assets/screens; transitions abrupt; victory/defeat feels like a debug state; debrief fails to communicate consequences; important audio missing or placeholder; save/load unreliable; settings/navigation confusing; visible stutters; debug terminology reaches players; gates bypassed; regressions unresolved.

## 23. Definition of Done

Player experience: first 10 minutes self-explanatory; responsive controls; readable selection and commands; satisfying, understandable combat; clear HUD hierarchy; coherent identity; authored battlefields; audio supports action; briefing → mission → debrief continuous; meaningful progression; understandable veterans; professional errors. Technical: no determinism regressions, no new type/lint failures, no weakened gates, no new console errors, no leaks, no perf regressions, playtests pass, visual tests meaningful. Product: a first-time player calls it "a finished RTS," not "a really impressive RTS project."

## 24. Operation

Implementation agents don't ask between stages (within the adaptations above). Ambiguity: inspect implementation, GDD/spec, prefer consistency, smallest coherent change, document the decision. Optimise player-visible quality per change. Report each package as: WORK PACKAGE / Changed / Why / Player-visible improvement / Tests / Visual evidence / Known remaining issues / Next priority. At the end, update the audit with completed, deferred, before/after, remaining P0/P1, final score, release blockers.
