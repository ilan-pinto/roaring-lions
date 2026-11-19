# The first cosmetics shelf (GH-1416) — design for the lead

> **Superseded in part, 18 Nov 2026:** the lead ruled "I want users to be able to use coins to buy new units. That's the leading rule." (relayed on GH-1378 and GH-1415; it reverses the 16 Nov GH-1378 item 6, "paid coins buy cosmetics only at launch"). The power-lane ruling this design waits on (§0) is made: coins buy units. The first shelf stays cosmetic; the section this design names as the one that moves with the ruling (§0) is the one to revisit, and §5's never-power guard holds for cosmetics only, not for what coins may buy. The current rule is `docs/GDD.md` §9: Roar coins buy units and upgrade tiers as brigade credits do, coins bought with money included once purchases open; credits are still never sold. A second ruling the same day answers where they may be used: "coin-bought units work EVERYWHERE, PvP included; the 29 Sep 'no pay-to-win' (G7) rule is RETIRED" (`docs/HANDOVER.md`, rows G7 and G7-R); its scope is set by a third ruling the same day: "standard-kit rooms stay EQUAL (no owned kit, coins or credits); coin-bought units reach PvP only through 'Bring your brigade' rooms. No code change.". The body below is kept as history.

**Date:** 2026-11-15 · **Status:** a proposal for the lead to approve before any build. Docs only: no code, no data, no
render and no Meshy call; the sim is untouched.
**Builds on, and does not replace:** `2026-10-11-monetisation-content-plan.md` (WP-ST8 rev. 2: the principles, the
store-item test T1–T11, the whole catalogue, the guards S1–S12), `2026-11-04-roar-coin-wallet-design.md` (the free/paid
wallet, GH-317), `2026-10-01-roar-coin-shop-design.md` (the packs). Where this note says "ST8", it means the first.
**What this adds:** ST8 designed the whole store. This note is the **first shelf**: the smallest set that can be built
today, in the pipeline that exists today, behind the closed purchase flag (`PURCHASES_OPEN = false`), with a never-power
guard that has a mutation for every wall. It also says what the first shelf leaves out and why.

---

## 0. The ruling this waits on

GH-1416 depends on "the power-lane ruling" in *Rule on the open decisions of the 80 programme*. I could not read that
document from here. This design assumes the ST8 lane stands as ruled on 11 Oct (D1–D5): single-player early access
fenced, **cosmetics horizontal**, no paid art shipped before D5. Everything below is cosmetic, so it holds under either
reading of the power lane; if the ruling changes what coins may buy, only §5 (spend rules) moves.

**D5 is the real gate on shipping anything** (ST8 F5): the repository is public and the art is all rights reserved, so a
paid asset committed beside the free art is downloadable though not licensed. This note's first shelf is deliberately
small SVGs, tokens and one JSON preset so that the exposure is a few kilobytes, and §7 asks the lead to rule on it.

## 1. What the first shelf sells

Seven kinds were considered. Four are on the first shelf; three wait or are refused.

| Kind | First shelf? | Why |
|---|---|---|
| **Profile crests** (the roundel beside a name) | **Yes** | A member already has one (`data/avatars/presets.json`, GH-1075 P5). The pipeline is 12 static SVGs and a preset list; "adding to presets is free". Most-seen, cheapest, furthest from play |
| **Crest frames** (a ring or border round the roundel) | **Yes** | One CSS attribute on `.rl-avatar`, no new image. Doubles the crest SKUs for almost nothing |
| **Unit badges** (company tab, crew plate, brigade patch) | **Yes** | On the unit's **icons only**: the dock tile, selection chip, HUD card, garage rail. The lead's 27 Sep ruling: no mark in the world. Same SVG pattern as the kit emblems (`currentColor`, 24-unit viewBox) |
| **Menu banner** (a re-staged diorama and its plate) | **Yes, two** | `data/front/menu_diorama.json` variants plus `pnpm plate:host`. The player sees it on every launch, which is what a shelf needs to be worth looking at |
| **Briefing folder styles** (the deploy screen's paper and stamp) | Later | Theme tokens only (cheap) but they touch `validate:ui`'s palette gate and every `ui:shots` screen; do after the banner proves the path |
| **Unit camo / liveries** | **Second shelf** | Real, but a second base-colour texture for each of 19 KDF types: 5–8 days, about 20 MB, the S9 legibility render pass, and the plates re-shot. It is the item that needs D5 most (20 MB of paid art in a public repo) |
| **Team-colour sets** | **Never** | See below |

**Why team colours are not sold.** The four team-colour sets (`reserved.team.variants`, D-22) are the colour-vision
accessibility variants, and the colour that says *friend or foe* on every unit. ST8 §1.1 item 7 already says
accessibility and colour-vision variants are never sold, and T5 says a cosmetic must not make a unit harder to read.
Selling a recolour of the friend/foe signal fails both. What can be sold instead is **accent** colour on the *badge*, which
is a decoration and not the signal; it is part of the badge SVG, not a palette change. If the lead wants a team-colour
product anyway it has to be a ruling against D-22 and T5, not a shelf item.

### 1.1 The first shelf, itemised

All KDF side, all Kedem-layer fiction (GDD §2, storyline §2.4): fictional insignia only, no real unit, faith, people or
place, enemies by doctrine only. Names are placeholders for the narrative designer.

| # | Item | Kind | Count | Band |
|---|---|---|---|---|
| 1 | Brigade crests: Ari'im lion in three frames (roundel, shield, tab) | crest | 3 | Small |
| 2 | Front crests: Marj, Sur, Naharin (a geographic mark, not an honour) | crest | 3 | Micro |
| 3 | Crest frames: plain steel, olive wreath, rope | frame | 3 | Micro |
| 4 | Company tabs: Alef, Bet, Gimel of the 401st | unit badge | 3 (one set) | Small |
| 5 | Crew nameplate set: a plate for a Lavi *Ari 1*, a Namer *Sahar*, in the materiel register | unit badge | 1 set | Small |
| 6 | Front tapes: MARJ, SUR, NAHARIN | unit badge | 3 | Micro |
| 7 | Menu banner: dawn parade, winter laager | menu banner | 2 | Standard |

That is **16 SKUs** from **15 drawn SVGs** (6 crests, 9 badges), three CSS frames and two re-staged scenes. It matches the shape ST8 §6.3 planned for launch
(12 badges, 4 dressing items) at roughly half the size, because the liveries and half the dressing wait.

## 2. How each item renders in the existing pipeline

Nothing here adds a renderer path. Everything draws in the DOM, apart from the menu banner, which is a scene the menu
host already knows how to stage.

| Kind | Source | Drawn by | Where it shows | Never |
|---|---|---|---|---|
| Crest | `assets/ui/avatars/crests/<id>.svg` + an entry in `data/avatars/presets.json` (`family`, `label` key) | `ui/avatar.ts` `avatarElement`, through its fallback ladder (the avatar, the default crest, the chevrons) | account page, lobby, scoreboard, chip | in the world; never the Roar coin's Hex Seal |
| Frame | one `data-frame` attribute on `.rl-avatar`, styled in `theme.css` with semantic tokens | CSS | wherever an avatar shows | an image, a hex literal (`validate:ui`) |
| Unit badge | `assets/ui/badges/<id>.svg`, `currentColor`, 24-unit viewBox, in the **opposite corner** from the kit sign | the `kitIconSignHtml` pattern in `ui/kit-sign.ts` | dock tile, selection chip, HUD card, garage rail | in the world (the lead rejected a world kit mark on sight); sharing the kit sign's shape, the chip border tint or the veterancy chevrons |
| Menu banner | a variant of `data/front/menu_diorama.json` (`map`, `camera`, `units`, `plate`) and its re-shot `assets/ui/menu_host_plate_<id>.jpg` (the current plate is 430 KB) | the menu scene host, unchanged; reduced-motion and the failure paths already fall back to the plate | `/` only | the cursor, symbols, HUD colours, anything with a colour-vision variant |

A crest the viewer has not fetched, or an id the viewer does not know, **falls to the default crest**: `avatarChain`
already guarantees the element never ends empty. A cosmetic that cannot load is invisible, never an error.

**Other players see ids, not pixels.** A selection crosses a lobby as an id; a replay records commands, never cosmetics,
and plays back identically with or without the viewer's inventory (ST8 §5). The "Show standard liveries" setting belongs
to the second shelf; this shelf has nothing in the world to switch off.

## 3. A mock of the shelf

The Stores gains one tab. Everything on it says what it is, what it costs, and that it is kept.

```
Stores   [ Units ]  [ Upgrades ]  [ Shelf ]  [ Coin packs ]                       ◈ 340 coins

 THE SHELF — looks, not power.  Nothing here changes how a unit fights, what a mission pays, or who wins.

 ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
 │   ( lion )   │ │   ( Marj )   │ │   [ A ]      │ │  dawn parade │
 │              │ │              │ │              │ │ (menu banner)│
 │ Ari'im crest │ │ Marj crest   │ │ Company tabs │ │              │
 │ roundel      │ │              │ │ Alef Bet Gim.│ │              │
 │ PERMANENT    │ │ PERMANENT    │ │ PERMANENT    │ │ PERMANENT    │
 │ ◈ 100  Buy   │ │ ◈ 50   Buy   │ │ ◈ 150  Buy   │ │ ◈ 300  Buy   │
 └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
   Preview shows exactly what you get.  Bought items are yours for good and stay on your account.

 [ Preview on my card ]   Free coins and paid coins both work here; free coins are spent first.
```

The mock is a layout of strings and slots, not a finished visual; the visual mock for the lead (one frame per kind, on
the real card, from the real SVGs) is the first deliverable of ticket C0 below, before any build.

## 4. Pricing bands

Prices are multiples of 50 coins so every pack spends to zero (ST8 §6.2). The packs are the coin shop spec's:
500 / 1,100 / 2,400 / 6,500 coins at $4.99 / $9.99 / $19.99 / $49.99 (about $0.01 a coin at the smallest). The GH-206
issue text still lists three packs at 500 / 1,200 / 2,500; the spec's four packs are used here because they are the ones
ruled on 1 Oct, and the pack list should be fixed in the issue when ST7 is picked up.

| Band | Coins | ≈ USD | First-shelf items |
|---|---|---|---|
| Micro | 50 | $0.50 | front crests, crest frames, front tapes |
| Small | 100–150 | $1.00–1.50 | each brigade crest (100), the company tabs (150), the nameplate set (150) |
| Standard | 300 | $3.00 | one menu banner |
| Whole shelf | | | 3 × 100 + 3 × 50 + 3 × 50 + 150 + 150 + 3 × 50 + 2 × 300 = **1,650 coins ≈ $16** |

A player who buys the whole first shelf spends about **$16**; against ST8's year-one target of one premium RTS plus an
expansion (≈ $55–65) this is a quarter of it, which leaves room for the second shelf and the passes. No-orphan check:
500 = one banner (300) + the company tabs (150) + one micro (50); 1,100 = two banners (600) + the tabs (150) + the
nameplates (150) + one brigade crest (100) + two micros (100) = 1,100. Every price is a multiple of 50, so a pack can always
be spent to zero.

**Accepting free coins (decision D-C1).** The wallet already spends free coins first, and a free player earns about 830
coins over the whole campaign (GH-317). Recommended: **both coins buy the shelf, with no special case.** A free player
can dress their account from play alone, which is the clearest possible answer to "would paying help you win?" and to the
Stormgate-style complaint that the store is the whole game. The cost is some revenue from the Micro and Small items. The
alternative, paid coins only for the shelf, is one `if` in the buy path and the lead may prefer it for the second shelf.

## 5. The never-power guard

ST8 §7 gave guards S1–S12 and marked them "none exists yet". The first shelf builds the ones it needs and adds two the
issue asks for. **Each row has the one-line mutation that must turn it red, and the commit that builds it must carry the
red run (CLAUDE.md, "Every check gets an input that makes it fail").**

| # | Guard | Enforced by | Red by (mutation) |
|---|---|---|---|
| C1 | **A cosmetic carries no number the sim reads.** `data/cosmetics/*.json` validates against `cosmetic.schema.json`, `additionalProperties: false`, a closed `kind` enum. A spec computes the intersection of its property names with `unit.schema.json`'s and requires it empty (ST8 S1) | `pnpm validate:data`; a spec | add `hp` to the cosmetic schema |
| C2 | **No cosmetic id reaches `@lions/sim`.** eslint `no-restricted-imports` over `packages/sim/**`, `mission-start.ts`, the seat builder and `cleanCommand`'s file, naming the cosmetics modules (ST8 S4). **Plus a runtime form**: a spec feeds `sim.queueCommand` a command carrying a cosmetic field and requires `cleanCommand` to drop it, so a room cannot smuggle one | `pnpm lint`; a spec | import a cosmetics module from the seat builder; stop `cleanCommand` dropping the unknown field |
| C3 | **Owning everything changes no outcome.** The golden replay (`determinism.test.ts`) and one `pnpm playtest` mission run twice, empty account vs every shelf item owned and selected: byte-identical state hash and debrief (ST8 S6) | `pnpm test:determinism`, `pnpm playtest` | thread a selected crest id into one unit type before `addUnitType` |
| C4 | **Two players with different shelves compute the same match digest.** `content-digest.ts` hashes `units`, `maps`, `doctrines` and so on; a spec computes it with two different selections and requires equality. Without this, a cosmetic would split lockstep rooms (the same digest that GH-1406's unit-name overlay is kept out of) | a spec | add the selected crest to the digest input |
| C5 | **A store item grants only a cosmetic.** `store_item.schema.json`: `grants` is a discriminated union whose only branch here is `cosmetic:<id>`. No `credits`, `conduct`, `stars`, `mission`, `roster` or `time` branch exists to write; no `weight`/`chance`/`pool` key (ST8 S2, S3) | `pnpm validate:data` | add `{ "credits": 500 }` to one item; add `"chance": 0.1` |
| C6 | **Credits are never sold, and coins never become credits.** A spec walks every shelf purchase and requires `balance`, `earned_total` and `creditsFor` byte-identical before and after (ST8 S7, wallet G3) | a spec | make a shelf buy push a credit grant |
| C7 | **Every item says it is permanent.** The shelf card renders a `shelf.permanent` string (through `t()`, in `en.json`); a UI spec requires it on every item's card, and `data/store/shipped.lock` lists every id ever sold so a catalogue cannot drop one (ST8 S11) | a UI spec; a spec on `shipped.lock` | remove the label from one card; delete an id from the catalogue |
| C8 | **A badge never looks earned.** Badge SVGs use badge tokens only (no `--commend`, no `--roar`); a shape check refuses any closed path with five or more alternating outer points (a star), a hexagram (the kit sign) or a stacked V (a chevron) (ST8 S10). Heuristic: a reviewer still signs T6 | `pnpm validate:ui` | add a five-point-star badge |
| C9 | **Nothing on the shelf is drawn in the world.** A spec scans the renderer (`packages/render/`) for any import of the cosmetics modules and for `badge`/`crest` ids, and requires none (the kit-mark ruling) | a spec | import a badge module from `packages/render/src/three/units/` |
| C10 | **The shelf is closed.** While `PURCHASES_OPEN` is false the buy path refuses; `paid` stays clamped to 0 (G-M1); the Buy button is disabled with the honest line | existing wallet specs plus one on the shelf | set the flag true without ST6/ST7 |

C1, C2, C3, C5, C6, C7 and C8 are ST8 S1, S4, S6, S2/S3, S7, S11 and S10. C4, C9 and the runtime half of C2 are new
here; they close the two ways a "harmless" cosmetic could still touch play, by a lockstep digest and by a command field.

## 6. Cost of the art

Estimates for the lead to approve. **No Meshy call has been or will be made on this note's authority**; the lead approves
art numbers before any render or Meshy call (CLAUDE.md house rules). Agent time is agent-days of one lane, review
excluded; the lead's review is about a day per kind.

| Work | Agent time | Meshy credits (estimate) | Basis |
|---|---|---|---|
| 6 crests (SVG, 24-unit viewBox, tokens only) | 1 day | 0 | hand-drawn like the kit emblems and the 12 shipped crests, about 1–2 h each |
| 3 frames (CSS attribute, 3 token sets) | 0.5 day | 0 | no image |
| 9 unit badges (3 tabs, 3 tapes, 3 plate styles) | 1.5 days | 0 | SVG at 16/24/48 px, S10 check |
| 2 menu banners (re-stage + `pnpm plate:host` + review) | 2 days | **0 base; up to 60 if a new plinth prop is wanted** | a prop is a Meshy preview at 5 (`meshy-6-lite`) plus a 15-credit textured image-to-3D = about 20 each, at most 3. Only if the lead asks for a genuinely new object; announced first |
| Schema, loader, ownership model, Shelf tab, strings, pseudo capture | 6–8 days | 0 | the engineering, sliced below |
| Guards C1–C10 with their mutations | 3 days | 0 | 31 mutations is the repository's own precedent |
| **Total** | **≈ 14–16 agent-days** | **0 (60 at most)** | |

Compare ST8 §8: a livery is 5–8 days and about 20 MB by itself. The first shelf is about 2 days of art because it
chooses the cheap kinds on purpose. Every generated or AI-assisted asset carries disclosure in its PR and a row in
`docs/ASSET_PROVENANCE.md`; any Meshy-origin asset is added to `art/ATTRIBUTION.md`.

## 7. Decisions for the lead

| # | Decision | Recommendation |
|---|---|---|
| D-C1 | Do free (earned) coins buy shelf items? | **Yes, no special case** (§4). Revisit for the second shelf |
| D-C2 | Is the first shelf the seven kinds in §1, with team colours refused and liveries second? | **Yes.** A team-colour product needs a D-22 and T5 ruling of its own |
| D-C3 | **D5 for small art.** May the first shelf's SVGs, tokens and one preset file live in the public repo, hidden behind the closed flag, under the all-rights-reserved licence the art already has? | **Yes, for these** (about 100 KB of SVG, no textures). Liveries (≈ 20 MB) still wait for D5's storage ruling. If the lead says no, the first shelf waits for the Steam stage |
| D-C4 | The permanence line: "Permanent: yours for good, and kept on your account." Wording and where it sits | for the narrative designer; the guard C7 only requires that it exists |
| D-C5 | May a new plinth prop be bought with up to 60 Meshy credits for the menu banners? | **No by default**; use re-staged units and existing props, ask only if the mock needs it |

## 8. How it slices

An epic, so these are tickets of 1–5 days, in order. Each ends with its guards red-then-green.

| # | Ticket | Days | Notes |
|---|---|---|---|
| C0 | **Mock**: one frame per kind on the real card, from the six real SVGs; lead approves §1 and §3 | 1–2 | the "mock for the lead" the issue asks for; no code |
| C1 | `cosmetic.schema.json`, `data/cosmetics/`, the loader, `shipped.lock`; guards C1, C5, C7 (lock half) | 3 | no UI yet |
| C2 | The fences: C2, C4, C9 and the determinism run C3 | 2 | the guards come before the shelf, so the shelf cannot be built without them |
| C3 | Crests and frames: 6 + 3 items, the preset list, the avatar ladder, ownership check on `me` (GH-1075) | 4 | needs the server to hold the entitlement before it resolves a paid crest |
| C4 | Unit badges on the icons; C8 | 3 | opposite corner from the kit sign; four surfaces |
| C5 | Menu banners; re-shot plates; reduced-motion plate path per variant | 3 | |
| C6 | The Shelf tab, the permanence label, preview on my card, strings and the pseudo capture; C6, C10 | 3 | closed behind `PURCHASES_OPEN` |
| C7 | Close-out: a tester session script for "would paying help you win?" | 1 | the done-means criterion (session 5) is the testers' |

Nothing here opens purchases. **Do not open purchases before the server holds the ledger (GH-205)**, and no item is sold
before ST6/ST7 exist; the shelf ships dark.

## 9. What this note does not do

- It does not set final prices: ST7 fixes them against Valve's catalogue and regional table, item prices before pack prices.
- It does not touch the second shelf (liveries, passes, voice sets, briefing folders). Those are ST8 §3.1, §3.3–3.5.
- It does not decide the power lane. The first shelf is cosmetic whichever way that goes.
- The "would paying help you win?" criterion (a majority of testers answer no, session 5) is the testers' result and cannot be met by a document.
