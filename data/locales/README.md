# data/locales/

Mission TEXT in another language — `name`, `briefing`, an objective's `text`,
a trigger's `label`. Nothing else: the chrome catalogue (menus, the HUD, the
brigade screen, every string that goes through `packages/app/src/i18n/t.ts`'s
`t()`) lives under `packages/app/src/i18n/` and is a separate mechanism with
its own fetch path — this directory is mission DATA, the thing CLAUDE.md
means by "Data text stays data."

## `en` is the source, never an overlay

Every file under `data/missions/` is authored in `en` already, and `en` is
never a subdirectory here — there is no `data/locales/en/missions.json` to
maintain in parallel with the mission files it would duplicate.
`mission-author` and `narrative-designer` write and edit the `en` text in
place, on the mission JSON itself, exactly as they do today. A locale
overlay is a translator's *addition* layered on top of that source at the
point `@lions/app` resolves a mission, never a fork of it.

## Shape

One directory per shipped locale other than `en`, id-matched to
`packages/app/src/i18n/locales.ts`'s `LOCALES` table (`fr`, `he`, …), each
holding exactly one file:

```
data/locales/<lang>/missions.json
```

validated against `@lions/data`'s `MissionLocaleOverlay` shape
(`packages/data/src/index.ts`):

```json
{
  "<mission id>": {
    "name": "…",
    "briefing": "…",
    "objectives": { "<objective id>": "…" },
    "triggers": { "<trigger id>": "…" }
  }
}
```

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
