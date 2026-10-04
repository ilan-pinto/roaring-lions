# Briefing sections and an image slot (GH-119)

2026-10-04. Closes the two gaps the 4 Oct audit left on GH-119: named sections,
and an image slot. The beats (`briefingBeats`, S3e / GH-162) stay exactly as
they are.

## Shape

Two optional mission fields, siblings of `briefing` rather than a change to its
type:

```json
"briefing": "<the whole orders text, unchanged>",
"briefing_sections": [
  { "id": "situation", "text": "...", "image": "ui/portraits/idit_zohar.png" },
  { "id": "mission",   "text": "..." },
  { "id": "execution", "text": "..." },
  { "id": "notes",     "text": "..." }
],
"briefing_image": ["ui/plates/units/mbt_lavi.jpg", "ui/plates/units/ifv_namer.jpg"]
```

- **Section ids are a closed set**: `situation`, `mission`, `execution`, `notes`,
  the short five-paragraph order. It fits the two-hander the contract already
  names ("Idit's picture, Shai's plan"): SITUATION is Idit's picture, MISSION and
  EXECUTION are Shai's plan, NOTES carries the closing cost-and-restraint line
  every shipped briefing ends on. No speaker field: the brief channel still has
  one attributed speaker (`README.md`'s contract), and the section names say
  whose voice a block is without a second attribution system.
- **Ids are unique and in that order.** A section may be skipped (most briefings
  have no separate MISSION sentence); it may not be repeated or reordered.
- **`briefing` stays the source of truth.** The section texts, joined with one
  space, must spell `briefing` exactly (whitespace-normalised). `validate:data`
  refuses drift. That keeps every other reader of `briefing` (the in-mission
  commander bar's `hud.brief`, `briefingHoldsDeployment`, the locale overlay)
  untouched, and it gives the runtime its fallback rule: **sections are used
  only while they still spell the briefing.** A locale overlay replaces
  `briefing` whole-string and has no section overlay yet, so a translated
  briefing simply renders unsectioned rather than half-English.
- **Beats live inside sections.** Each section's text goes through the same
  `briefingBeats`, so the two-sentence/240-character beat limit is unchanged and
  `.rl-loading__beat` keeps its meaning (index continues across sections).
- **Images**: `image` per section, `briefing_image` per mission, as a path under
  `assets/` restricted by the schema to `ui/portraits/` and `ui/plates/` (assets we
  ship and hold the rights to; no new art). `briefing_image` is a string or a
  non-empty array: an array is a POOL, and the deploy screen picks one at mount
  (presentation only, outside the sim, so `Math.random` is allowed; the pick
  function takes the random source as a parameter for tests). `validate:data`
  refuses a path that is not on disk, exactly as it does for `briefing_video`.
  Every image is decorative (`alt=""`): the orders are all in the text. A URL that
  fails to load removes its element.

## Rendering (deploy screen, `ui/loading.ts`)

- Unsectioned briefing: child for child what it was. No change.
- Sectioned: `.rl-loading__brief` holds one `<section class="rl-loading__section">`
  per section, each with an `<h3>` heading from `t('briefing.section.<id>')`, an
  optional thumbnail, and its beats. Each section is `tabindex="0"` and
  `aria-labelledby` its heading, so Tab walks the orders section by section and
  the scrolling container follows focus. Deploy keeps initial focus.
- The mission image is a `<figure>` at the top of the right-hand column when the
  spread is drawn, otherwise above the orders.
- Colour from semantic tokens only; everything is a child of the screen's own
  `wrap`, so the existing `dispose()` / `cleanup()` take it down with nothing new
  to register.

## Image pool used here

No new captures were needed: the commander portraits in `assets/ui/portraits/`
and the garage unit plates in `assets/ui/plates/units/` (`pnpm plates:units`)
cover the exemplars. `photographGround` returns an `ImageData` inside the
renderer and writes no file, so it is not an authorable source today.

## Exemplars

`beit_sahwan_1_recon` (four sections, Idit's portrait on SITUATION, a pool of the
attached force's plates) and `beit_sahwan_0_tutorial` (three sections, the rifle
squad's plate). Every other mission is untouched and renders as before.
