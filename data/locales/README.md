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
commit.

## Shape

One directory per shipped locale other than `en`, id-matched to
`packages/app/src/i18n/locales.ts`'s `LOCALES` table (`fr`, `he`, …), each
holding up to two files:

```
data/locales/<lang>/missions.json
data/locales/<lang>/units.json
```

`units.json` (GH-1406) is unit display text: a unit id to `{ "name"?, "blurb"? }`, nothing else. Every key must be a real unit
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
    "wave_say": { "<index in enemy.waves>": "…" }
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
