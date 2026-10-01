# WP-G-G0 · Skirmish AI spike report (GH-187)

Scratch branch `spike/skirmish-g0`. Throwaway: nothing here lands. The report feeds
G4 (#168, early November) and G3 (#167, 30 October).

## 1. Criteria, fixed before the build

Written and committed before any commander code existed. They come from the ledger
(G3 question 6, G4's issue text): the commander must **contest income ground**,
**answer a flank**, and **lose to a good plan without a script**. Each is scored
headlessly over ten seeds against four scripted player plans in the style of
`tools/src/backtest/playtest.ts`: `passive` (no orders), `naive` (everything
attack-moves straight up the pass at the battery), `flank` (the foot walks the
narrow corridor to the battery while the armour holds back), and `good`
(recon, a pin at the pass with the armour, the foot through the corridor, then
converge).

### Skirmish rules the criteria are scored against

The economy (WP-G-F) does not exist, so income ground is a **zone-hold proxy**.
Four income zones on the map. Every second, a side earns one point per zone it
holds **exclusively**: at least one of its living ground units stands inside, and
no living ground unit of the other side does. Air units hold nothing. A
contested zone pays nobody. The commander's wave budget is fed by the same
points (see §3), so income ground is also what buys it reinforcements.

The game lasts seven minutes (8,400 ticks, the GDD's 5-7 minute unit of content).
It ends early when the KDF destroys the Sarim rocket battery (the commander's HQ;
KDF wins), when the KDF has no ground unit left (Sarim wins), or when Sarim has no
unit left (KDF wins). At seven minutes the higher score wins; a tie goes to Sarim,
the defender.

### C1 · Contest income ground

- **C1a, take uncontested ground.** Against `passive`, by 120 s the commander
  holds at least 3 of the 4 income zones, including at least one SOUTH of the
  wall (the commander starts in none of them), in at least 9 of 10 seeds.
- **C1b, dispute what the player takes.** Against `naive`, `flank` and `good`:
  every time the player comes to hold a zone exclusively, does the commander
  order units at that zone (a `commit` naming it) within 30 s, unless its
  doctrine has written the zone off as lost to a superior force (a logged
  `withdraw` decision counts as an answer, a silence does not)? Score = answered
  captures / all captures. Pass at 75% or more.
- **C1c, out-earn a bad player.** Against `naive`, the commander's share of all
  points earned is above 50% in at least 7 of 10 seeds.

### C2 · Answer a flank

Scored on the `flank` plan, with a **static control**: the same Sarim force,
placed where Tel Marum III's garrison stands, with no commander. That control is
what the existing vocabulary does today, and the doctrine test already measured
that it cannot see or answer the corridor.

- **C2a, react.** The commander orders units at the threatened ground (the west
  income zone at the corridor's north exit, or the battery) within 30 s of first
  having contact on a flanker north of the wall, in at least 8 of 10 seeds.
- **C2b, make it cost.** The flank party's mean HP lost with the commander is at
  least twice the static control's.
- **C2c, the flank alone is not the answer.** `flank` wins strictly fewer seeds
  than `good`.

### C3 · Lose to a good plan without a script

- **C3a, beatable.** `good` wins at least 7 of 10 seeds.
- **C3b, a skill gradient.** `passive` wins 0 of 10 and `naive` wins at most 3 of
  10.
- **C3c, no script on the commander's side.** The commander's force carries no
  timed wave and no trigger: every move and every wave comes from the utility
  pass. And its decisions are not one fixed script: across the ten `good` seeds
  the commander's decision traces are pairwise distinct in at least 8 of 10.
- **C3d, no script needed on the player's side.** The `good` plan's timings
  shifted 15 s early and 15 s late (every order) still win at least 6 of 10 seeds
  each, so the win comes from the plan's shape, not from hitting a frame the
  commander happens to leave open.

### Also measured, not gating

- `pnpm test:determinism`, and a skirmish replay: two runs of the same seed must
  produce the same sim hash, score and decision trace.
- Per-tick cost at 300 living units: the sim tick, and the commander's thinking
  pass amortised per tick.
