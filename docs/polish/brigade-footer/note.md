# Brigade and screen footers: mock (GH-498)

**Date:** 9 Oct 2026 · **Build:** `c439fd7c` (`main`) · **Sheet:** [`sheet.jpg`](sheet.jpg)

This is a mock only. Each direction was injected as CSS and DOM into the real screens on a dev server (Metal, music off, `garage-seed.ts` account), at 1920×1080 and 1440×900. It uses tokens only, and nothing in this branch changes the game.

## Recommendation: A, the foot band

- **One footer row on every screen that has one.** A rule runs across the frame, like the garage header's. The way back sits on the left: **"← Campaign map"** and **"Main menu"**. Forward actions sit on the right. On the brigade screen the left edge lines up with the rail and the right edge with the board, so the footer follows the screen's grid instead of floating in the middle.
- **Every control in the row has the same height, with its label centred.** Navigation stays `.rl-btn`: body face, sentence case. That keeps VR-20/21 as #448/#454 resolved them.
- **Reset is a danger control, set apart.** It sits alone at the far right, smaller, with a dashed outline in `--bad-text`. On the first click it turns into a filled `--bad` button reading "Click again to reset — this cannot be undone". A "Keep the brigade" button appears beside it as a way out; that button is new behaviour, and it is optional.
- **Specification: no inner scroll.** The six rows go in two columns, with the kit figure inline ("3750 +750 kit") instead of on a second line. At 1440 all six rows show, against two before.

**B (tiles)** reads more like the main menu, but it dresses a way back as a destination. VR-20/21 reserve tiles for going forward, so B would undo the register that just landed.

**C (back above the title, no footer)** gives the bay about 60 px more height. The cost is a second header row, and the debrief and campaign board could not follow it, because they have no header of that kind.

## Root causes (fix once, every screen)

1. **`.rl-btn` has no box of its own.** It is an inline `<a>`/`<button>` with `padding: 0.3125rem …` and nothing that centres its content. In a flex row with the default `align-items: stretch` (`.rl-aar__nav`, `.rl-endnav`), it is stretched to the height of the stamp beside it, and its text stays at the top. That is the lead's debrief screenshot exactly, reproduced at 1920. The fix is `display: inline-flex; align-items: center; justify-content: center; gap: var(--s1)` on `.rl-btn`, plus a shared minimum height for footer rows.
2. **`.rl-menu__nav > .rl-btn[data-kind='back'] { align-self: flex-start }`** (theme.css ~3834). It was written for column navs. In the campaign board's footer the nav is a row, so the same rule pins "← main menu" to the top at its own short height, beside a taller tile.
3. **The labels are lowercase in `en.json`, not in CSS.** The keys are `nav.campaignMap` "campaign map", `nav.menu` "menu", `nav.backToMenu` "main menu", `nav.backToCampaignMap`, `garage.reset.button` "reset brigade account" and `garage.reset.confirm` "click again…". `debrief.replay` is already "Replay", which is why the debrief mixes cases. `chrome-register.test.ts` checks CSS only, so it cannot see the case of a label. A small spec that runs every string reaching an `.rl-btn` through the real catalogue would hold it. Also, `nav.menu` and `nav.backToMenu` name one place two ways. Make it "Main menu" everywhere.
4. **There is no shared footer.** The brigade screen borrows `.rl-endnav` (centred, from the old end panel). The debrief has `.rl-aar__nav` (flex-end), and the campaign board has its own centred `.rl-menu__nav` row. One `.rl-foot` rule (rule above, back group left, forward group right, one height) would replace all three.

## Survey of the other footers (1920, `main`)

| Screen | Footer today | Mismatch |
|---|---|---|
| Debrief | "Replay", "campaign map", "menu" + the display-face stamp | labels top-aligned, shorter than the stamp, mixed case. **Applied A on the sheet.** |
| Campaign board | Next tile + "← main menu" | two heights (cause 2), lowercase. **Applied A on the sheet.** |
| Saves | "← main menu" at the panel's foot | lowercase only; height and alignment fine |
| Settings, Credits | "← main menu" at the end of a long body | lowercase; the way back is below the fold on Settings |
| Free Play picker | "← main menu" under the full map list | lowercase; below the fold, after every card |

Settings and Free Play would also gain from a foot that stays visible instead of one at the end of the scroll. That is a layout change, so it is listed here and not mocked.

## Not in this mock

- The spec panel moved under the upgrade tracks in the board column (that column has room). This was considered and not mocked, because a unit with open rungs makes the board much taller.
- Nothing ships. The mock scripts live in the session scratchpad, not in the repository.
