# data/locales/

Mission TEXT in another language — everything `applyMissionLocale` can replace: `name`, `briefing` and its `sections`, `dispatch`,
`aftermath`, `hostages_place`, the two `debrief` lines, an objective's `text`, a trigger's `label` and every radio line (`say`). Nothing else: the chrome catalogue (menus, the HUD, the
brigade screen, every string that goes through `packages/app/src/i18n/t.ts`'s
`t()`) lives under `packages/app/src/i18n/` and is a separate mechanism with
its own fetch path — this directory is mission DATA, the thing CLAUDE.md
means by "Data text stays data."

## `en` is the source; its file here is a generated template, never an overlay

Every file under `data/missions/` is authored in `en` already. `mission-author` and `narrative-designer` write and edit the `en`
text in place, on the mission JSON itself, exactly as they do today. A locale overlay is a translator's *addition* layered on top
of that source at the point `@lions/app` resolves a mission, never a fork of it.

**`data/locales/en/missions.json` exists, and it is generated** (GH-1406 part 2): `pnpm locales:en -- --write` builds it from the
mission files and `pnpm locales:en` checks it. It is a **translator's template**: one entry per mission with every string the
overlay can replace (every field in the shape below), in the mission file's own order.
A translator copies it to `data/locales/<lang>/missions.json` and translates the values; the keys are exactly the ids the overlay
validator accepts. **Nobody edits it by hand and the game never fetches it** (`main.ts`'s `loadMissionOverlay` returns before any
request for `en`). `pnpm validate:data` fails on a mission, objective or trigger it lacks, on an entry for something that is gone,
and on text that has drifted from the mission file, so editing a briefing means running `pnpm locales:en -- --write` in the same
commit. **`data/locales/en/units.json` is generated the same way** (GH-1406 part 5): a unit id to its `name`, its `blurb` when it has
one, and the `src` hashes below.

## The source hash (`src`): how a translation knows it has gone stale

An overlay finds its line by KEY: an objective id, a section id, or for `wave_say` the wave's INDEX in `enemy.waves`. A key says which
line, not which sentence the translator read. So a mission that reorders its waves, or gains one ahead of a translated wave, leaves every
key valid and the player sees another wave's translation, and an English line that is reworded leaves its old translation standing,
with nothing red either way (GH-1406 part 5; the `wave_say` case was found on the part-3 review).

Every entry therefore carries a `src` block, written by the English generator and checked by `validate:data`:

```json
"src": { "name": "1687e8ef", "briefing": "a3f0c2d1", "sections.situation": "09be77a4", "wave_say.0": "5c1de2f8", "objectives.<id>": "…" }
```

- A key is the path of a string in the entry (`name`, `dispatch`, `debrief.victory`, `sections.<id>`, `objectives.<id>`,
  `objective_say.<id>`, `wave_say.<index>`, …); the value is the **first 8 hex characters of the SHA-256 of the English string**, over its
  exact UTF-8 bytes (no trimming, case and spaces count). `sourceHash` in `tools/validate_narrative.mjs` is the one definition.
- **Copy `en/missions.json`, translate the values, leave `src` alone.** It already holds the hash of the English you read, so a fresh
  translation passes with no extra step. A partial translation keeps only the `src` entries of the strings it translates.
- `validate:data` fails a translated string whose `src` entry is missing (the message prints the hash to copy), is not 8 lowercase hex
  characters, or no longer equals the hash of the mission's CURRENT English (the message prints both: re-translate the line, then set
  `src` to the new hash, which is also what `en/missions.json` now holds for it). It also fails a `src` key whose string the
  entry does not translate, so a deleted line cannot leave its hash behind.
- A string whose English the mission does not carry has nothing to be stale against and needs no hash.
- It is not text: `applyMissionLocale` and `applyUnitLocale` never read `src`, and `en`'s own copy is checked for exact parity like the rest
  of it. Editing the English of a shipped line is therefore a red build in every locale that translated it, which is the point: the
  translator is told which line, and the fix is theirs.
- A 32-bit hash is a tripwire, not a signature: an edit that happens to keep the hash is a 1 in 4.3 billion chance per edit.

`units.json` carries the same block, `"src": { "name": "…", "blurb": "…" }` per unit, with the same rules, and
`unitOverlayFailures` also refuses a `blurb` for a unit that has none.

## `de` is staged, not shipped (GH-1406, GH-1407)

`data/locales/de/missions.json`, `data/locales/de/units.json` and the chrome catalogue `packages/app/src/i18n/de.json` are the first
launch-language translation, German. **They are machine translation by Claude, in-house, with no paid service (the lead's ruling on
PR 1474), and no human has proofread them.** `de` is NOT in `LOCALES` (`packages/app/src/i18n/locales.ts`): until the lead adds it,
`?lang=de` is ignored, nothing fetches these files, and every player sees English. Adding it is the shipping step, and it should wait for a
native proofreading pass and a `ui:shots` read of the longer German strings.

How it was made, so the next language can repeat it: the English text was flattened to `path -> text`, split into slices, translated
against one brief (register: military, terse, neutral; KDF/Sarim, place names and real equipment designations unchanged; no real
places, people, operations or faiths) with one shared glossary, and merged back into the English structure with the `src` hashes
carried over untouched, so `pnpm validate:data` proves no entry is stale, missing or over a cap (trigger label 48, radio line,
dispatch and aftermath 240, hostages place 40). The chrome catalogue is checked by `tools/validate_chrome_catalogue.mjs`: exactly
`en.json`'s keys, and the same `{placeholders}` and ICU `plural`/`select` shape in every value. **Chrome strings carry their source hash in a
sidecar**, `data/locales/<id>/chrome.src.json` (`{ "<key>": "<8 hex of the English it was translated from>" }`, the same `sourceHash` the
mission and unit overlays use): an English chrome edit after translation goes red in `validate:data` with both hashes, until the string is
re-translated and the hash set. The sidecar is never served or read at runtime. `pnpm locales:chrome-src -- <lang>` lists what is missing or
stale; `--write` adds hashes for keys that have none (a new language runs it once, from the English it read) and keeps a stale entry stale on
purpose; `--rebless=key,key` refreshes named keys and is for use AFTER re-translating them.

Terms the glossary fixed, for a proofreader: Conduct is "Verhalten", a mission is an "Einsatz", a map tile is a "Feld", a squad or team
is a "Trupp", the Store is the "Depot", a garrisoned building is "besetzt".

## `fr` is staged too (GH-1406, GH-1407)

Same pattern as `de`, stacked on it: `data/locales/fr/missions.json`, `units.json`, `chrome.src.json` and `packages/app/src/i18n/fr.json`.
Machine translation by Claude, in-house, no paid service, **not proofread by a human**; `fr` is not in `LOCALES`. Register: military, terse,
neutral, formal "vous" for the player and the infinitive for UI and orders, French typography. **Terminology calls for a proofreader:**
Conduct = "Conduite" (the restraint score), rules of engagement = "règles d'engagement", mission = "mission", objective = "objectif",
tile = "case", squad = "groupe" (a rifle "section" in prose), team = "équipe", Store = "Intendance", garrisoned = "occupé", medic =
"infirmier", fire support = "appui-feu", suppression = "neutralisation par le feu", Loitering Munition = "munition rôdeuse", Suicide Squad =
"groupe kamikaze" (mission prose says "charge squad" for the same unit, rendered the same way), "technical" kept as a loanword in prose
and "pick-up armé" as the unit name, civic hall = "salle communale", Roar coin = "pièce Roar", brigade pack names Patrouille / Compagnie /
Brigade / Division, Bug = "bogue", Balance = "équilibrage", Praise = "éloge", Advise / Assist = "Conseiller" / "Assister", dock = "barre du
bas" in prose and "dock" on chips, field works = "ouvrages de campagne", checkpoint = "point de contrôle" ("pc" on chips), tiles per second
= "c/s". Three select-based messages were reworded for gender agreement (`intel.note.ready`, `alert.supply.open`, `main.note.supportCalled`):
check them in play. Both languages share one limit for a proofreader: the hostage count words (`world.hostages.n0` to `n20`) are capitalised
because the same word starts a sentence and sits mid-sentence ("Noch Zwei draußen"), which the catalogue cannot express without a second set.

## `es-ES` is staged too (GH-1406, GH-1407)

Spanish as written in Spain, stacked on `fr`: `data/locales/es-ES/missions.json`, `units.json`, `chrome.src.json` and
`packages/app/src/i18n/es-ES.json`. Machine translation by Claude, in-house, no paid service, **not proofread by a human**; `es-ES` is not in
`LOCALES`. Register: military, terse, neutral, formal "usted" for the player, the infinitive for UI and orders, «comillas angulares» and the
inverted marks. **Terminology calls for a proofreader:** Conduct = "Conducta", rules of engagement = "reglas de enfrentamiento", mission =
"misión", objective = "objetivo", tile = "casilla", squad = "escuadra" (a rifle "section" in prose = "sección"), team = "equipo", Store =
"Intendencia", garrison (verb) = "guarnecer", medic = "sanitario", fire support = "apoyo de fuego", suppression = "supresión", Loitering
Munition = "munición merodeadora", Suicide Squad = "escuadra suicida" (mission prose says "charge squad" for the same unit, rendered the same
way), "technical" kept as a loanword in prose and "pick-up armada" as the unit name, civic hall = "sala comunal", dock = "muelle" (the
reinforcements panel), checkpoint = "punto de control" ("pc" on chips), tiles per second = "c/s", Roar coin = "moneda Roar", brigade packs
Patrulla / Compañía / Brigada / División, Bug = "Error", Balance = "Equilibrio", Praise = "Elogio", Advise / Assist = "Aconsejar" /
"Asistir", Desync's Report button = "Notificar" (not "Denunciar", which is the chat report). "Old Town" and "Main Street" are rendered "casco
antiguo" and "calle Mayor" (the English uses both capitalised and lowercase forms). The slices disagreed on a few terms and were normalised
("wadi" kept, never "uadi"). Check in play: the hostage count words (`world.hostages.n0` to `n20`: "Ningún", "Un", "Dos"...) are written without
verb agreement because the same word starts a sentence and sits mid-sentence; the Delete key label stays "Del" where a Spanish keyboard shows
"Supr"; the damaged-save file name `damaged-save-{n}.txt` was translated and should probably stay as the English file name.

## Staged versus shipped: lag is reported, wrong is red (GH-1406)

A language is **shipped** when it is in `LOCALES` (`packages/app/src/i18n/locales.ts`): a player can choose it. Anything with files here and not in `LOCALES` is **staged**.

- A **shipped** language is held strictly: every chrome key present and current, every translated mission and unit string carrying the hash of the English it was read from.
- A **staged** language may **lag** the English. A chrome key main added, an English line main edited (a hash that no longer matches), a translated string with no hash yet, or a section the English gained are **reported** by `pnpm validate:data` (a `locale <id> (staged ...) lags the English by N item(s)` block, never a failure). The worklist for a translator is `pnpm locales:pending -- <id>`.
- A staged language still **fails** on what is wrong rather than stale: a key `en` does not have, a changed `{placeholder}` or ICU shape, a value that is not a string, a malformed source hash (not 8 hex characters), a hash for a string it does not translate, a mission or unit that does not exist, a trigger label over 48 characters.
- `en` is the source and is always strict. The strict gate applies the day a language ships; that is the text freeze in practice.

`tools/locale_staging.mjs` decides which is which (`shippedLocaleIds`, `isStaged`); `tools/src/locale_staging.test.ts` builds one input that is green staged and red shipped, and the staged failures that stay red.

## Shape

One directory per shipped locale other than `en`, id-matched to
`packages/app/src/i18n/locales.ts`'s `LOCALES` table (`fr`, `he`, …), each
holding up to two files:

```
data/locales/<lang>/missions.json
data/locales/<lang>/units.json
```

`units.json` (GH-1406) is unit display text: a unit id to `{ "name"?, "blurb"?, "src"? }` (`src` is the hash block above), nothing else. Every key must be a real unit
id from `data/units/`, and a value must be a non-empty string; `tools/validate_data.mjs` runs each file through
`tools/validate_narrative.mjs`'s `unitOverlayFailures`. A unit or field the file does not mention keeps its `en` text. It is applied
by `@lions/data`'s `applyUnitLocale` through `packages/app/src/unit-text.ts` (`unitName`, `unitBlurb`, `localizedUnit`), set once at
boot next to the chrome catalogue, and read at call time. Unit JSON in `@lions/data` is never edited: the net content digest hashes it,
name included, so a peer on another language must still compute the same digest. Roles and the rest of the chrome stay in `en.json`.

The rest of this page describes `missions.json`.

validated against `@lions/data`'s `MissionLocaleOverlay` shape
(`packages/data/src/index.ts`):

```json
{
  "<mission id>": {
    "name": "…",
    "briefing": "…",
    "sections": { "situation": "…", "mission": "…" },
    "dispatch": "…",
    "aftermath": "…",
    "hostages_place": "…",
    "debrief": { "victory": "…", "defeat": "…" },
    "objectives": { "<objective id>": "…" },
    "objective_say": { "<objective id>": "…" },
    "objective_say_on_fail": { "<objective id>": "…" },
    "triggers": { "<trigger id>": "…" },
    "trigger_say": { "<trigger id>": "…" },
    "wave_say": { "<index in enemy.waves>": "…" },
    "src": { "<path of each translated string>": "<8 hex of its English>" }
  }
}
```

Every field is optional and falls back to `en` per field. A `say` is replaced by its TEXT only: the speaker (`shai`, `idit`,
`net`, `enemy`) and a section's `image` are never translated. `wave_say` is keyed by the wave's index in `enemy.waves` as a string
(a wave has no id). Caps held on a translation: a trigger label 48, a radio line, `dispatch` and `aftermath` 240, `hostages_place` 40.
`sections` is all or none, must be accompanied by a `briefing`, and joined with one space must spell it exactly (the rule the
deploy screen already falls back on). `en/missions.json` carries every one of these fields for every mission that has them, so
copying it gives a translator the full list.

Every top-level key is a real mission id from `data/missions/`; every key
under `objectives`/`triggers` is a real objective/trigger id on THAT
mission. `tools/validate_data.mjs` walks every `data/locales/*/missions.json`
file through `tools/validate_narrative.mjs`'s `overlayFailures` and fails the
gate on an id that does not resolve, or a trigger label translation longer
than the 48-character cap the source label is already held to
(`triggerLabelFailures`, the same module) — a translator's typo would
otherwise ship invisibly, doing nothing, forever.

A mission, objective or trigger the overlay does not mention keeps its `en`
text. A locale that ships no file at all — every locale today, since none of
this has shipped yet — plays every mission in `en`.

## How it reaches the player

`@lions/data`'s `applyMissionLocale(mission, overlay)` returns a new mission
object with the overlay's text substituted in, id by id; the mission's own
JSON on disk is never edited. `packages/app/src/main.ts` calls it where a
mission is resolved for a battlefield, with the overlay fetched for the
CURRENT UI language (`${base}locales/${lang}/missions.json`) — `null` for
`en` or for a language nothing has shipped a file for, which
`applyMissionLocale` treats as a no-op.

### Where the file is served from, and what happens when it is not there

The loaders fetch `${base}locales/<lang>/missions.json` and `units.json`, but the app's `publicDir` is `assets/`, which holds no
locales. **`packages/app/vite-plugin-locales.ts` is the bridge**: in `pnpm dev` a middleware answers those two paths from
`data/locales/<lang>/`, and in `pnpm build` it emits every `<lang>/missions.json` and `<lang>/units.json` as `locales/<lang>/<file>`
in the output (`packages/app/dist`, which `wrangler.jsonc` serves as its static assets). The set is **derived from this directory**,
never listed: every such file except `en`'s (the generated template is never fetched, so it is not shipped), and nothing else (a
`README.md`, a stray note, anything deeper). Do not copy a translation into `assets/` by hand: a file present in both places is a build
error. A symlinked file or directory is **not** followed, in dev or in the build (one definition, `localeFiles`; dev answers only what it
lists), and the plugin works under a non-root `base` (the app prefixes the URL, the output paths stay `locales/...`).

**The chrome catalogue** (menus, the HUD) is the third file a locale has, and `loadLocale` fetches it as a flat `${base}locales/<id>.json`.
It lives beside the bundled source: add `packages/app/src/i18n/<id>.json` (the sibling of `en.json`), and the same plugin serves it at
`locales/<id>.json` and emits it in the build, derived the same way (every flat `<id>.json` in that folder but `en.json`). Nothing ships
one today. It is not a data/locales file, so `validate:data` does not read it yet.

A non-`en` locale whose file does not arrive is still a null overlay and plays in English, **but no longer silently**:
`i18n/overlay-fetch.ts` writes one `console.warn` per URL naming the URL and what came back (a status, a request that threw, or a
200 whose body is not JSON, which is how the dev server and the Worker answer a path they do not serve). `en` and the pseudo-locales
never warn. A warn and not an error because `pnpm ui:routes` fails on any console error.

