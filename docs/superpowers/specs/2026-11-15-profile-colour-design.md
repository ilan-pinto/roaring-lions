# Account page colour uplift (GH-1367): design

**Status:** design only, for the lead's choice. No code ships with this document.
**Issue:** GH-1367. The lead (15 Nov 2026) says the account page "doesn't seem to have colors. It's almost all plain black."
**Builds on:** the approved GH-1075 P7 page (`2026-11-14-avatars-and-profile-design.md`, mock
`2026-11-14-profile-redesign-mock.html`).
**Mock sheet:** `2026-11-15-profile-colour-mock.png`, beside this file.

---

## 0. Summary

- **The live page does not match the approved mock.** Six accents the mock has are missing on the live page (§2).
  The issue assumed that the gold header rule and the green/red record digits had shipped. They have not.
  The CSS for both was never written, so the record digits are plain `--ink` and the header card has a 1px grey frame.
- **Why it reads as black.** Four layers stack the same colour, `shadow.1`: the page ground (`index.html`), the menu
  column (`.rl-menu`, `--panel-bg`), the panel body (`--panel-bg`) and every card (`--panel-bg`). The mock's cards are
  one step lighter (`shadow.0` at 70%), and the mock sits on a sand-to-olive frame. Live, the cards disappear into the
  panel and the panel disappears into the page.
- **Three options**, all cumulative. **A** fixes the bugs and adds a warm ground. **B** is A plus card roles, filled
  record tiles and chips, and a Steam-coloured button. **C** is B plus the crest echoed in the header card.
- **Recommended: C**, shipped as four slices so the lead can stop after any one (§5). Every option stays inside
  `palette.json` through `theme.css` tokens and `color-mix()`, with no literals, and holds WCAG AA for text (§4).

## 1. How the mock sheet was made

- **What is captured.** Every frame is the real `/profile` route on the worktree dev server (port 5231, `?accounts`).
  It was captured in one headless Chromium session: SwiftShader, device pixel ratio 1, `--ui-scale` 1, music off
  (`musicOffInitScript`).
- **The signed-in view.**
  - The binding and the `lions.account.cache` seed come from `packages/app/src/account/fixtures.ts`
    (`cacheOf(confirmedState())`).
  - `/api/account/{open,me,matches,state}` are answered by `page.route` stubs. A catch-all logged no unstubbed call.
  - The player "Nightjar", the ids and the five history rows are fictional.
- **The guest view.** `me` answers 401, and `open` lists Google and Steam.
- **Sizes.** Desktop is 1440 × 1240 (guest 1440 × 1000). Narrow is 400 px wide, under the 30rem header-stack
  breakpoint.
- **The options.** Each option's CSS is injected with `addStyleTag` after the page settles. The scratch sheets live in
  a git-ignored folder and are not the shipped change. The rules quoted in §3 are what a slice would put in `theme.css`.
- **CVD.** C is captured a second time under `data-cvd="deuteranopia"` and `"tritanopia"`.

## 2. Bugs: accents in the approved mock that the live page lacks

Each bug is a missing rule, not a redesign. Lines are at `a566042e7` (origin/main). The computed values were read
with `getComputedStyle` on the live page.

| # | Mock | Live (computed) | Where |
|---|---|---|---|
| 1 | Header card: a 3px `--accent` (gold) rule on its left edge (`.card--head`) | `border-left: 1px rgb(54,59,57)`: the plain frame | `profile.ts:454` sets `rl-profile__card--head`; `theme.css` has no rule for that class at all (the card block is 10247–10318) |
| 2 | Record digits: Won in `--good`, Lost in `--bad-text`, 32px display face, label beside the digit | All three are `--ink` at 20px, stacked | `profile.ts:367` sets `rl-profile__tile--won/--lost/--drawn`; `theme.css:10482` `.rl-profile__tile-n` is `--ink`, and no `--won`/`--lost` rule exists |
| 3 | Card ground one step above the panel: `shadow.0` at 70% | The card is `--panel-bg`, the same `shadow.1` at 92% as the panel body under it | `theme.css:10252`. *Note:* spec §P7 text says "Cards are `--panel-bg`". The mock and the text disagree, and the mock is what the lead approved by eye |
| 4 | "Show my record" is a switch whose checked track and knob are `--accent` | A native checkbox in the browser's own blue (`accent-color: auto`): an off-palette colour on the page | `profile.ts:380`; `theme.css:10493` has no `accent-color`, and the shared rule at `theme.css:4798–4802` does not list profile controls. The telemetry checkbox (`profile.ts:577`) is the same |
| 5 | "How your data is kept" link in `--ink-dim`, `--accent` on hover | The browser's default link blue, underlined: another off-palette colour | `profile.ts:220` sets `rl-profile__privacy-link`, and `theme.css` has no rule for it |
| 6 | Guest card: a large person silhouette in the roundel, and gold `›` before each perk | The silhouette draws at about 8px (1em) in a 96px roundel. Perks are `--ink-mute` with no marker | `theme.css:3143` `.rl-sym:not(.rl-badge) { width: 1em }` outranks `theme.css:4658` `.rl-avatar__glyph { width: 62% }`, because it has higher specificity. The guest mark is drawn with both classes (`avatar.ts:30`). Perks: `theme.css:10357` |

Minor divergences, smaller than the six bugs:

- The LINKED chip's frame is `--panel-frame` (`theme.css:10449`), where the mock uses `currentColor`.
- The avatar rim is 1px (`theme.css:4638`), where the mock uses 2px.
- The mock draws one frame around the panel. Live draws two: the `.rl-menu` column's own frame and padding around the
  panel's. Saves and Credits share this shape.
- The mock shows the display name in the display face at 40px, with an edit pencil. Live shows a form input. That is
  layout, not colour, so it is out of scope here and left for P7 follow-up.

**Accessibility note found on the way.** The outline chips (WON, LINKED) are `--good` small text, at 4.69:1 on
today's ground. Fixing bug 3 (the lifted card) alone drops them to 4.21:1, under AA. Option A therefore gives the
chips a `--panel-bg-solid` backing. Options B and C fill them instead.

## 3. Options

All three are cumulative: A contains the bug fixes (F), B contains A, and C contains B.

### F: the bug fixes (inside every option)

These are the six rows above, written against existing tokens plus one new token,
`--card-bg: color-mix(in srgb, var(--rl-shadow-0) 70%, transparent)`.

- The header gets its `--accent` rule.
- The digits take `--good` and `--bad-text`.
- The checkboxes take `accent-color: var(--accent)`.
- The link takes `--ink-dim`, with `--accent` on hover.
- The perks get a gold `›`.
- The glyph rule is scoped (`.rl-avatar .rl-avatar__glyph.rl-sym`).
- The chips get a `currentColor` frame on a `--panel-bg-solid` backing.

### A: fix and warm ground

The mock's own frame becomes the page ground, so the dark panel sits on warm colour, not on black.

- **Ground.** `linear-gradient(limestone.6, dust.6)`, under a `dust.3` glow at the top left and an `olive.2` shade at
  the bottom right. It is darker than the mock frame (`limestone.5 → dust.5`) so the panel edge stays crisp.
- **Scope.** `#stage:has(> .rl-menu--profile)`. The router empties `#stage` on leave, so nothing outlives the screen
  (the disposer contract).
- **One frame.** `.rl-menu--profile` drops its own background and border, so the panel is the only frame, as in the
  mock. The footer's Main menu button gets a solid backing.
- **Leaves alone.** Every card stays dark, so all the text pairs keep today's contrast.

### B: A, card roles, filled tiles

Each card says what it is in colour. The record reads at a glance.

- **Card heads.** Each card title becomes a filled strip across the top of its card:
  - record: `olive.2`;
  - history: `gunmetal.2`;
  - ways to sign in: `limestone.5`, with `shadow.1` ink;
  - your data: `water.1` (80% over `shadow.1`, the issue's "slate");
  - danger: `--bad` at 55% over `shadow.1`.

  The record, sign-in and data cards take a matching hairline.
- **Record tiles.** The tiles are filled blocks with `limestone.0` ink:
  - Won: `--good` at 55% over `shadow.1`;
  - Lost: `--bad` at 50% over `shadow.1`;
  - Drawn: `gunmetal.3`.

  The history result chips and the LINKED chip use the same three fills.
- **Steam.** The Steam buttons are filled `water.1` (75% over `shadow.1`), close to Steam's own slate.
- **Google.** The Google buttons stay on the dark neutral ground, because Google's sign-in branding allows only white,
  `#131314` or `#F2F2F2` behind its mark. Cream or olive would break it.
- **Guest card.**
  - The guest roundel takes `--avatar-ground-kdf` with an `olive.1` rim and an `olive.0` glyph.
  - The headline is in `--title-accent`.
  - The "Sign up" buttons get the mock's primary treatment: an `--accent` frame and `--accent` text. Steam keeps
    `--band-ink` text on its fill.
- **Not terracotta.** Danger and Lost deliberately do not use terracotta (the issue's idea), because `--roar` already
  owns the terracotta ramp (`theme.css:162`). They use `--bad`, which re-points under every CVD variant.

### C: B and the crest echo (recommended)

The header card takes the colour of the member's own crest, so the top-left card, the first thing read, is theirs.

- **The wash.** The header card's ground is a left-to-right wash: the crest's ground at 85%, fading to
  `--card-bg` by 80% of the width.
- **The rule and the rim.** The left rule and a larger 7rem crest rim (3px) take the crest's rim or charge colour.
- **The keys.** The crest is read from the avatar's own `data-avatar` attribute (`avatar.ts:63`), so no TS change is
  needed: twelve `:has([data-avatar=…])` rules set `--crest-ground` and `--crest-rim`.
  - `--crest-ground` is the crest's own ground from `tools/avatars/crest_geometry.mjs` (the §3.2 table). There are two
    named exceptions, because their ground would wash the card black or white: `crest-chevrons` (ground `shadow.1`)
    takes `dust.5`, and `crest-sprig` (ground `limestone.1`) takes its charge `scrub.1`.
  - `--crest-rim` is the crest's brightest tone, its charge, not its rim ring, which is often darker than the ground.
    For example the lion is `olive.2` / `dust.0` and the claw is `terracotta.1` / `terracotta.0`.
  - A shipped slice must pin the twelve pairs against `crest_geometry.mjs`'s table, with only those two exceptions, so
    a recoloured crest cannot drift from its card. A test must prove the pin fails on a one-key mutation.
- **The rest.**
  - "Member since" moves from `--ink-mute` to `--ink`.
  - The identity rows become `--well` wells with a `--good` stripe.
- **Fallbacks.** A member with no `data-avatar` match falls back to `olive.2` and `--accent`, the lion.

## 4. Token map

New semantic tokens (all in `theme.css`, the only file that names `--rl-*`):

| Token | Value | Option |
|---|---|---|
| `--card-bg` | `color-mix(in srgb, var(--rl-shadow-0) 70%, transparent)` | F |
| `--profile-ground` | `linear-gradient(var(--rl-limestone-6), var(--rl-dust-6))` | A |
| `--profile-ground-glow` | `color-mix(in srgb, var(--rl-dust-3) 40%, transparent)` | A |
| `--profile-ground-shade` | `color-mix(in srgb, var(--rl-olive-2) 55%, transparent)` | A |
| `--card-head-record` | `var(--rl-olive-2)` | B |
| `--card-head-history` | `var(--rl-gunmetal-2)` | B |
| `--card-head-signin` / `-ink` | `var(--rl-limestone-5)` / `var(--rl-shadow-1)` | B |
| `--card-head-data` | `color-mix(in srgb, var(--rl-water-1) 80%, var(--rl-shadow-1))` | B |
| `--card-head-danger` | `color-mix(in srgb, var(--bad) 55%, var(--rl-shadow-1))` | B |
| `--tile-won` | `color-mix(in srgb, var(--good) 55%, var(--rl-shadow-1))` | B |
| `--tile-lost` | `color-mix(in srgb, var(--bad) 50%, var(--rl-shadow-1))` | B |
| `--tile-drawn` | `var(--rl-gunmetal-3)` | B |
| `--tile-ink` | `var(--rl-limestone-0)` | B |
| `--steam-fill` | `color-mix(in srgb, var(--rl-water-1) 75%, var(--rl-shadow-1))` | B |
| `--crest-ground` / `--crest-rim` | per crest: its ground and its charge from `tools/avatars/crest_geometry.mjs` (e.g. lion `olive.2` / `dust.0`, claw `terracotta.1` / `terracotta.0`, wing `water.1` / `limestone.0`). Exceptions: chevrons `dust.5`, sprig `scrub.1` | C |

**Existing tokens reused:** `--accent`, `--title-accent`, `--good`, `--bad`, `--bad-text`, `--band-ink`, `--ink`,
`--ink-dim`, `--ink-mute`, `--panel-bg`, `--panel-bg-solid`, `--well`, `--avatar-ground-kdf`.

**Ramps not touched:** the `theme_only` ramps, and `reserved.vfx`, `reserved.group` and `reserved.team`, which are
used only through `--bad`.

**Contrast** (WCAG 2.x, computed from the palette hexes; text needs 4.5:1, large text and glyphs 3:1):

| Pair | Ratio |
|---|---|
| Live: `--good` small text on `--panel-bg` (WON chip, LINKED) | 4.69:1 |
| F: `--good` 2rem digits on `--card-bg` (large text) | 4.21:1 |
| F: `--bad-text` digits on `--card-bg` | 5.47:1 |
| F: `--ink-dim` link on `--card-bg` | 5.34:1 |
| B: `--band-ink` on the record head (`olive.2`) | 6.55:1 |
| B: `--band-ink` on the history head (`gunmetal.2`) | 5.13:1 |
| B: `shadow.1` on the sign-in head (`limestone.5`) | 5.69:1 |
| B: `--band-ink` on the data head (`water.1` 80%) | 5.60:1 |
| B: `--band-ink` on the danger head: default / deuteranopia and protanopia | 7.63:1 / 6.74:1 |
| B: tile ink on Won (`--good` 55%) | 6.65:1 |
| B: tile ink on Lost (`--bad` 50%): default and tritanopia / deuteranopia and protanopia | 8.26:1 / 7.36:1 |
| B: tile ink on Drawn (`gunmetal.3`) | 9.38:1 |
| B: `--ink-mute` on the paused chip (`gunmetal.3`) | 4.59:1 |
| B: `--band-ink` on the Steam fill | 6.00:1 |
| B: `--accent` on `--card-bg` (sign-up buttons) | 8.88:1 |
| B: guest glyph `olive.0` on `olive.3` (non-text) | 3.81:1 |
| C: `--ink` on the crest wash at its strongest (worst of the 12 grounds: `water.1`) | 5.24:1 |

**Colour vision.**

- `--bad` and `--bad-text` re-point under every `data-cvd` variant, so the Lost tile, the Lost chip and the danger
  head follow the variant. The sheet shows deuteranopia and tritanopia.
- `--good` is not re-pointed. That is today's behaviour for every Won and Linked mark in the game.
- No tile, chip or head relies on hue alone. Each carries its word (WON / LOST / DRAWN, LINKED, the card title), and
  the three tile fills differ in lightness as well as hue.

## 5. Slices (for the recommended C)

Each slice is a small app PR: CSS in `theme.css`, no TypeScript unless noted, `pnpm validate:ui` clean. The profile is in no
golden scenario.

| Slice | What | Test that must go red first |
|---|---|---|
| S1 | **The six bugs (F)**: header rule, coloured digits, `--card-bg`, profile `accent-color`, privacy-link colour, perks marker, the guest-glyph specificity fix, chip frame and backing | jsdom cannot compute colour, and no browser tool visits `/profile` today (`tools/src/ui-review/` and `tools/src/ci/` never name it). So the gate is a new `getComputedStyle` probe on the stubbed page this mock used: header `border-left-width` > 1px, Won digit colour ≠ `--ink`, link colour ≠ `rgb(0, 0, 238)`, glyph width > 30% of the roundel. Each check must fail on today's `theme.css`. It runs in CI only |
| S2 | **Warm ground (A)**: `#stage:has(> .rl-menu--profile)` and the single frame | The `#stage` background differs from `--panel-bg-solid` on `/profile` and is unchanged on `/` (the menu's scene host owns that ground) |
| S3 | **Roles (B)**: card heads, filled tiles and chips, the Steam fill, the guest card | A contrast test from `palette.json` over the §4 pairs, in the shape of `bad-text-contrast.test.ts`, per CVD variant. A one-step mutation (`olive.2` → `olive.1` on a head) goes red |
| S4 | **Crest echo (C)**: twelve `--crest-*` rules, the 7rem rim, identity wells | A pin of the twelve pairs against `crest_geometry.mjs`'s table, with the two named exceptions. Recolouring one crest in the table goes red |

**Stopping points.** S1 alone closes the bugs and is the honest minimum. S1 and S2 is option A. S1 to S3 is option B.

## 6. Open points for the lead

1. **Which option, A, B or C?** Recommended: C.
2. **The ground.** It is a flat palette gradient, not the menu diorama. The diorama behind the account page would mean
   a second scene host off `/`, against the scene-host rule that it lives on `/` only.
   - *Default:* the gradient.
3. **The display-name heading** (the mock's 40px name with a pencil) is a P7 layout follow-up, not part of this colour
   pass.
   - *Default:* a separate issue.
