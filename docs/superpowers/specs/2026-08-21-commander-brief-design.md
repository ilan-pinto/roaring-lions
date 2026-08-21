# The commander's brief — design

**Date:** 2026-08-21
**Follows:** #99, which gave the briefing a surface for the first time.
**Status:** approved, not yet built.

## The problem

#99 established that eleven authored briefings had never been rendered, and put them on the deploying screen. That fixed the absence. It did not make the brief *arrive from anyone* — it is a wall of prose on a loading screen, and the campaign still has no people in it at all, which is #94's item 7.

A brief is something a commander gives you. Delivering it as one should cost little and change how the war feels: you are being *sent*, by someone, repeatedly, across a campaign that has an ending.

## The character

**Colonel Idit Zohar**, commanding the KDF 401st "Ari'im" Brigade. Callsign **Ari Actual**.

- *Actual* is radio for the commander in person rather than their radio operator. The fiction is that you get the CO, not a staff officer — which is what a company-sized force being spent on a war's opening deserves.
- The callsign ties to the brigade's name and to the game's.
- The name sits in the Hebrew-derived register every other proper noun in this game uses — Lavi, Namer, Eitan, Yahalom, Peten, Shoded, Kedem, Sahar, Ari'im — and collides with no real public figure.
- One officer for the whole war, deliberately. The relationship builds, and the ending lands on somebody the player knows rather than on a narrator.

Per GDD §2 the KDF is fictional and enemies are defined by doctrine, never by a people. A named officer on the *player's* side does not touch that rule.

## The screen

The deploying box gains a portrait panel and a transmission header:

```
┌──────────┐   ARI ACTUAL · 401st "ARI'IM"          ● live
│          │   ────────────────────────────────────────────
│ portrait │   Beit Sahwan — First Light
│          │
│          │   They came at dawn.▊
└──────────┘                                        [ deploy ]
```

## The interaction

The briefing splits into **beats** of a sentence or two. Each types out at reading speed.

**One press does two different things, and this is the load-bearing detail:**

1. mid-beat → completes the current beat instantly
2. beat complete → advances to the next

Impatience is never punished by having to sit through an animation whose text you have already read. This is the standard courtesy for typed dialogue and skipping it is the single most common way this pattern is got wrong.

The **deploy** control appears only on the final beat, so it cannot be hit before the orders are given. Escape still exits at any point — a player replaying for a better ROE score should not be held.

Under `prefers-reduced-motion` the text arrives whole and the beats remain, matching how `titleCard` already drops movement but never the words.

## What splits the text

`briefingBeats(text: string): string[]` — pure, tested without a DOM, the same idiom as `briefingHoldsDeployment` and `trail.ts`'s `trailTileAlpha`.

Sentence boundaries, grouped to roughly two sentences or a character budget, whichever comes first. **No re-authoring of the eleven briefings and no schema change** — the text already reads as delivered speech because it was written as tactical orders.

The longest briefing is Wadi Halam V at 1,225 characters; the shortest is Wadi Halam II at 385. Both must produce sensible beats, and a briefing with no sentence punctuation at all must produce exactly one beat rather than none.

## The art

**This spec is the art brief.** Nothing should be generated before it is approved, because a spec costs a line and a render costs fifteen minutes.

| | |
|---|---|
| file | `assets/ui/commander_portrait.png` |
| source size | 512 × 640 (4:5) |
| displayed | 200 × 250 |
| framing | chest-up, three-quarter turn, eyes to camera |
| dress | plain olive/khaki field uniform; **no insignia resembling any real force** |
| palette | the limestone/dust register — warm, desaturated, sun-bleached; no saturated colour |
| lighting | flat and frontal with a hard shadow side, matching the game's locked rig feel |
| expression | neutral, tired, professional — not heroic, not grim |
| background | transparent |
| must not | resemble any real person |

`tools/validate_assets.py` walks `assets/sprites/` only, so a UI image faces no palette, alpha or silhouette gate — the same footing as the existing `assets/ui/menu_banner.jpg`. CONTRIBUTING permits generated assets and **requires disclosure in the PR** where generative tools were used.

### The feature does not depend on the art

With no portrait file present the panel shows the callsign block and a palette-toned empty frame. The screen is complete and shippable without the image, and the image drops in later without a code change. This is deliberate: a feature blocked on an asset is a feature that does not ship.

## What this touches

| File | Change |
|---|---|
| `packages/app/src/ui/loading.ts` | portrait panel, header, beats, typing, advance |
| `packages/app/src/ui/loading.test.ts` | beats and interaction |
| `packages/app/src/ui/theme.css` | panel, header, caret, portrait frame |
| `data/campaign/commander.json` *(new)* | name, rank, callsign, unit — authored data, not a string literal in TypeScript |

No `packages/sim` change. No `packages/render` change.

The commander is content, so it is data. A name hard-coded in a `.ts` file is the thing CLAUDE.md's "content is JSON" rule exists to prevent, and a later per-front briefer would otherwise be an engine change.

## Verification

- `briefingBeats` — pure tests including both real extremes, and text with no sentence end.
- The interaction in jsdom, on `worldmap.test.ts`'s precedent: a beat completes on first press, advances on second, deploy appears only at the end, Escape exits early.
- **The typing feel, the line length and the panel at real size cannot be tested.** They need eyes on the running app, and if the browser is unavailable that must be reported as unverified rather than implied.
- `pnpm validate:ui` — the new CSS must use palette tokens only, no colour literals.
- `pnpm test:determinism` unmoved; nothing here is sim code.

## Scope

**In:** the character as data, the portrait panel with a graceful empty state, the beat split, the typing and the advance, and the art spec above.

**Out, deliberately:**

- **Audio.** M1 excludes it, and a voice is a far larger commitment than a portrait.
- **The enemy commander.** `amir_runs` in Wadi Halam III names a person the player never meets; that is #94's item 7 for the other side and a separate decision.
- **Per-front or per-phase briefers.** One officer, the whole war.
- **Portrait states** reacting to the mission or the ledger. Tempting, and it needs more art than one image.
- **Generating the portrait.** Specified here; produced outside this work.
