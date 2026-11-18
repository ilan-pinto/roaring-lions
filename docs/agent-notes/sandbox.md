# The sandbox and its flags

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 416-479, section "Dev instruments" -->

- Browser sandbox: `window.__lions.step(n)` fast-forwards n deterministic ticks; `__lions.sim` and `__lions.renderer` are exposed. It is defined by the battlefield alone — the menu, the campaign board, the brigade and the picker define nothing, which is how a tool tells "the app booted a mission" from "the app booted".
- `pnpm meshy -- <command>` (`tools/src/meshy/`) is the Meshy text-to-3D/image-to-3D CLI — estimate before you spend, key lives outside the repo, see `docs/ART_PIPELINE.md`'s "Meshy API — generating a base model" for the full workflow and policy.
- `?sandbox=<map id>` walks **any** shipped map with a full task force placed from
  that map's own markers — no mission needed. Bare `?sandbox` still loads
  `beit_sahwan_outskirts` unchanged. Before this, checking anything visual on a new
  map meant authoring a throwaway mission and deleting it, which is how Tel Marum's
  terrain was walked. Also on `__lions`: `goto('hollow')` jumps the camera to a
  marker, `units()` lists living units with their ids and tiles, `sel([id])` sets the
  selection, and `cursorKey()` **reads back** `canvas.dataset.cursor`. That last one
  is a DOM read rather than a recomputation on purpose — the failure worth catching
  is a cursor whose logic is right and whose wiring is not, and recomputing would
  agree with the logic and tell you nothing. Since 2026-09-15 a group order lands
  in formation (`packages/sim/src/formation.ts`), so "units stack on one tile" is
  a bug again on the sandbox force, not the default outcome of a right-click.
- **The sandbox documents itself** — `__lions.help()`, and the same text prints to
  the console on every sandbox boot: the map that loaded, which flags are on, every
  flag available, every shipped map id, and the console API. An unrecognised URL
  parameter warns by name, which is the case that matters: `&tunel` otherwise does
  nothing at all, silently, and reads as a broken feature rather than a typo. The
  flag table (`packages/app/src/sandbox-help.ts`) is the single source for all
  FOUR callers — `readFlags` parses from it, `sandboxHelp` prints from it,
  `unknownParams` checks against it, and `/free-play` (`?sandboxes`), the picker
  screen in `ui/menu.ts`, builds its checkbox list from it and its launch URLs
  through `routes.sandbox` — so a flag parsed but undocumented, or documented
  but unparsed, is not expressible.
  Prefer this over grepping this file.
- The opt-in sandbox flags, each adding only what it names, so a check for one
  subsystem is not buried under four others (`&nomesh`, the old billboard
  opt-out, and `&mesh` are accepted and do nothing since WP-A3.3). **This list goes stale; the table and `__lions.help()`
  do not** — it is here for the reasoning, not the enumeration. `&roe` supplies
  flagged ground (the map's own `clinic`/`hall`/`refuge` zone where it has
  one, otherwise a 4×4 synthesised midway between the two anchors); `&tunnel`
  appends a pre-dug route from the hostile side toward the friendly one and adds
  two `yahalom_squad`; `&sur` adds the four Sarim units no mission fields
  (`sarim_rifles` ×2, `recoilless_team`, `manpad_team`, `rocket_battery`);
  `&civ` puts eight civilians on the midpoint of the anchor axis and synthesises
  a refuge; `&ditch` cuts an anti-tank ditch across that axis. Combine them —
  `?sandbox=tel_marum&tunnel&sur&roe&civ` is the everything build, on the only map
  with relief. Every one is sandbox-only: a mission brings its own zones,
  tunnels, terrain and civilians, and a dev flag must never change how a real
  mission scores. The synthesised route is NOT identified by construction — a
  `mark_tunnel` carrier still has to see it, which is the mechanic the charge
  cursor depends on. `&kit` replaces the account's tiers with
  `SANDBOX_KIT_LEVELS` before the one `upgradePrepass` runs (`bootTiers`), so
  the sim, the HUD card and the unit icons all see the ladder together; a
  mission never takes it, and since the reinforcement dock is mission-only,
  `&kit` cannot reach it — the dock's sign is proved on plan 1's garage seed
  instead.
- **`&civ` walks the whole civilian loop, and the rule it walks is the mission's
  own.** `stepCivilians` and the arrival half of `evacuate_before` moved out of
  `MissionRuntime` into `packages/sim/src/civilians.ts` (`CivilianFlight`) so the
  sandbox drives the SAME object rather than a copy — the only two alternatives
  were a second implementation of a game rule in `packages/app`, or writing
  `alive = 0` from outside the sim, which invariant 4 forbids. `main.ts` calls
  `step` then `collect` at the same point in the tick the runtime does, and
  turns `collect`'s ids into the `evacuated` MissionEvent the renderer needs to
  tell a rescue from a killing. Four of the five maps declare a `civ_refuge`
  marker and that is preferred; Tel Marum declares none and falls back to the
  friendly anchor. The arrival ZONE is always a synthesised 4×4 built AROUND the
  refuge point, never a declared rectangle: `CivilianFlight.step` stops
  re-ordering a civilian standing on the refuge, so a point outside its own zone
  is a permanent hang rather than a miss. The civilians draw as their four
  variant meshes (`art/meshes/civilians/`, GH-149) -- there is no other path
  since WP-A3.3, and a crowd whose GLBs failed to load draws proxy boxes. Since GH-279 (#580) only ground units shepherd civilians, never aircraft, and shepherding happens only in a mission with an `evacuate_before` objective.

<!-- GH-1381, 18 Nov 2026 -->
- **Free play as Sarim (GH-1381).** `/free-play/<map>?side=sarim` (the picker's "Pick your side" group, KDF by
  default) fields the versus room's forces (PR 1507): `VERSUS_SARIM` at the friendly anchor against `VERSUS_KDF` at the
  hostile one, placed by `versusSpawns` itself (`sandbox-sarim.ts`, loaded on demand). The player is still seat 0 and
  side 0, human-held and the viewer; only which force stands where changes, so no sim or seat code learned a side.
  Seat 0's faction is Sarim's (`seatWorldFor`'s `soloFaction`), so the Sarim verbs and formations pass ownership. The
  KDF opposition fields the base ladder, never the player's bought kit. `side` is a value param in `KNOWN_PARAMS`,
  read by `sandboxSideOf` for Free play only (a mission or a room ignores it and warns), and the four `kdfOnly` flags
  (`tunnel`, `sur`, `kit`, `works`) are dropped on the Sarim side (`sideFlags`) and greyed in the picker. No `side`
  in a link is the KDF, so every existing link and every free-play baseline is unchanged. The opposition stands and
  fights where it spawns, as the Sarim opposition of a KDF Free play does: there is no computer seat in Free play.

<!-- The lead's ask of 18 Nov 2026, "bring outposts to free play / versus": the free-play half -->
- **Field works are on in every KDF Free play (18 Nov 2026).** What `&works` used to opt into is now the default:
  the dock, the five KDF works the outpost ask names plus the aid post (every buildable `kdf_` type, twice each),
  `SANDBOX_WORKS_LOGISTICS` to pay for them and the `demo_squad` that raises them (`sandbox-works.ts`,
  unchanged). The table says so (`SANDBOX_FLAGS[].freePlayDefault` on `works`), and `freePlayDefaults` applies it,
  called by `bootFlags` LAST and for a Free play boot only (no mission, no room), so neither `sideFlags` nor
  `roomFlags` warns about a default the URL never asked for. **`&works` is an accepted alias**: still parsed and
  still a known parameter, so an old link is not reported as a typo, and it changes nothing on the KDF side. The
  Sarim side is unchanged: no field works, and a `&works` it is handed is dropped with the GH-1381 warning. A
  mission never takes the default, and a versus room drops works as before (`roomFlags`, and `main.ts`'s own
  `!mission && versusWorld === null && !inRoom` guard; `raiseWorks` stays dropped in `ownership.ts`). The picker
  offers no box for it: it states it under the side pick, in its `labelKey` sentence (`freePlay.works.on`), and
  hides the line while Sarim is picked. No sim change and no tuning: the logistics are what `&works` gave. A
  free-play boot now draws the production dock and one more unit (the demolition squad at the friendly anchor
  +3,+2), so every sandbox capture that frames either moves.
