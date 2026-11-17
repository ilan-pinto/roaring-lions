# data/store/: the Steam store page copy

**DRAFT. HOLD FOR LEAD: store copy is the lead's call.** Nothing here is published, and nothing reads these files at runtime.

`en.md` is the source (short description, long description, key features, languages, system requirements). `de.md`, `fr.md` and `es-ES.md`
are AI translations (Claude, in-house, no paid service, GH-1407 D3), **not proofread by a human**, and follow `en.md` section for section.
`tools/src/store_copy.test.ts` pins the rules below and the numbers the copy states.

## Rules the copy keeps
- **The fiction, plus one line (GH-1378 Q8, 16 Nov):** KDF, Kedem, the Sarim, real equipment names allowed, and the line "inspired by modern
  Middle East conflicts" (in each language, in the short and the long description). **No specific war, person, place, operation or faith named.**
  The copy names no Kedem town either.
- **Claim nothing the build on main cannot back.** No co-op (no co-op mode exists on main: `packages/net/src/config.ts` has none, and
  `config.test.ts` refuses `mode: 'coop'`; plan `docs/superpowers/plans/2026-10-28-coop-n5.md` did not land), no "skirmish" (M3, 12 Feb 2027, is
  not on main), nothing about controllers, Steam Deck, voice, ranked play, leaderboards or achievements.
- **Credits are never sold; paid coins buy cosmetics only at launch (GH-1378 Q6).**
- **Languages:** only what has shipped. Today that is English; the five planned are staged, not shipped (`LOCALES` in
  `packages/app/src/i18n/locales.ts`).

## Claim ledger: each claim, and where it lives on main
| # | Claim in the copy | Where it lives |
|---|---|---|
| E1 | The fiction: KDF, Kedem, the Sarim; the "inspired by" line; no real names | GH-1378 Q8 (ruling of 16 Nov); `data/campaign/world.json` (fictional regions), `docs/campaign/storyline.md` |
| E2 | Armour has a front, side and rear; cover and walls stop rounds; height decides what you see; one set of rules for both sides | `packages/sim/src/tuning.ts` (facing arcs, cover, penetration), `packages/sim/src/vehicle-health.ts`; elevation and line of sight: `data/maps/*.json` `elevation`, CLAUDE.md "A map" rules |
| E3 | Rules of engagement and a Conduct score; protected buildings and flagged streets cost Conduct | `packages/sim/src/grade.ts`, `packages/sim/src/credits.ts`, structure `roe_penalty` in `data/structures.json`; `m` civic-hall tiles on nine maps; unit blurbs in `data/locales/en/units.json` ("In a flagged street they cost Conduct") |
| E4 | Thirty missions across the Kedem towns, almost all designed for five to seven minutes; units and credits carry on | `data/missions/*.json` (30 files; the test counts them); `target_minutes` 5 to 7 in `data/schemas/mission.schema.json` (one named exemption, the 12-minute tutorial); carry-over: `docs/campaign/README.md` (ledger `requires`/`produces`), `packages/app/src/roster-carryover.ts` |
| E5 | Smoke, mortar barrage, drone sweep and precision strike, paid with intelligence earned by doing the job | `dock.support.smoke_screen` / `mortar_barrage` / `drone_sweep` / `air_strike` in `packages/app/src/i18n/en.json`; `packages/sim/src/intel-earn.ts`; GH-1378/G3 Q1 in `docs/HANDOVER.md` ("intel stays the fire-support currency") |
| E6 | Garrison a house, collapse a tunnel, bring down a wall, medic under fire, civilians to the refuge | `packages/sim/src/structures.ts` (garrison), `tunnels.ts` (Yahalom collapse), `wounds.ts` (wounds and rescue), `civilians.ts` (flight to the refuge); units `yahalom_squad`, `demo_squad`, `dozer_d9`, `inf_medic_squad` in `data/units/` |
| E7 | Column, attack formation, ambush | `data/formations/{column,attack,ambush}.json` (GH-859) |
| E8 | A persistent brigade with credits, upgrades and a garage; credits are earned and never sold | `packages/app/src/brigade-account.ts`, `packages/app/src/ui/garage-*.ts`; `packages/app/src/roar-wallet.ts` header; GH-1378 Q6 and G7 in `docs/HANDOVER.md` |
| E9 | Free play on 41 maps with a full task force | `data/maps/*.json` (41 files; the test counts them); `routes.freePlay` in `packages/app/src/shell/links.ts`; CLAUDE.md "Sandbox and console" (`?sandbox=<map id>`) |
| E10 | Friend matches with a room code, KDF against Sarim; a match against the computer | `packages/net`, `packages/app/src/ui/versus.ts`, `data/versus/*.json` (six maps and the win modes); the computer seat: `playComputer` in `packages/app/src/main.ts` and `packages/app/src/net/offline-match.ts` (GH-1388). Not described as skirmish, and not as co-op. |
| E11 | Remappable keys, colour-vision modes, text and interface size, reduced motion, three quality presets, save and resume mid-mission | `packages/app/src/settings.ts` (`colorVision`, `motion`, text size, UI scale), `packages/app/src/ui/settings-keymap.ts` (rebind), `packages/render/src/quality.ts` (`high`/`medium`/`low`), `packages/app/src/mission-save-store.ts` (GH-1393, PRs 1478 and 1485) |
| E12 | More than 40 unit types, from rifle squads to tanks and helicopters | `data/units/` (50 files; 47 once civilians and the two wounded types are left out; the test counts them); `mbt_lavi`, `heli_peten`, `heli_yanshuf`, `inf_squad` |
| E13 | **Free to play; Roar coins buy cosmetics only** | The lead's posture (`docs/HANDOVER.md`, 19 Sep: free to play plus Steam Wallet) and GH-1378 Q6. **The build does not do this yet:** `PURCHASES_OPEN` is false (`packages/economy/src/stores.ts`), the Stores' own lede says "Coins buy what credits buy" (units and tiers, `stores.lede` in `en.json`) and its cosmetics shelf is empty (`stores.empty.cosmetics`). The line is a LAUNCH GATE: close the power lane in code before the page goes live. |
| E14 | Languages: English; system requirements: placeholder only | `LOCALES` holds `en` alone; no Steam build exists (M5, `docs/HANDOVER.md`); WebGL 2 and the low preset: the no-GPU screen (`noGpu.*`) and `docs/agent-notes/webgpu-backend.md`. No figures are claimed. |

## Not claimed, and why
Co-op and skirmish (above); a Sarim campaign (opposition sides are playable in versus and free play only, GH-1378 Q10); voice (audio is postponed);
controller, Steam Deck, achievements, leaderboards, ranked play; a launch date or price; any language beyond English; hardware figures.

## For the lead
- E13 is the one claim that is ruled but not yet true in the build.
- Steam asks for an AI-content disclosure; the art, music and translation disclosures are yours to write.
- "Middle East" is the one real-world name in the copy, because you ruled the line in.
- The translations are drafts. Every non-English store page needs a native read before it goes up.
