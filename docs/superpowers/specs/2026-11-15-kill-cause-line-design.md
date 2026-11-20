# The kill-cause line (GH-1380)

Status: built (PR 1435, read-only on existing events), then the §5 sim step (GH-1380 follow-up: `cause` and `weaponId` on `destroyed`, §7). The lead reviews the mock and the wording.

## 1. What a player sees

One sentence, in the unit's own words, in the two places a loss is read.

**The debrief.** Under each named loss, and under a lone nameless crew of one type:

```
Barzel · Rifle Squad                          (person row)
  Lost at 5:40. Penetrated through the rear by Spike AT Team (Spike anti-tank missile). It was pinned down. Gefen takes the place.

Shoded Jeep ×1 lost (fresh crew)
  Destroyed by Rifle Squad.
```

Two or more nameless crews of one type print a tally (§7): each distinct line with its count, the commonest first, at most two, then how many more:

```
Shoded Jeep ×3 lost (fresh crew)
  2× Destroyed by Rifle Squad. 1× Caught in a blast from Spike AT Team (Spike anti-tank missile).
```

**The unit card.** The card of whoever took a fallen unit's place already says "in Barkai's place". It now says why, when the record has it:

```
in Barkai's place. Penetrated through the rear by Spike AT Team (Spike anti-tank missile).
```

A unit that fell before this shipped has no cause stored and prints the old line. No status mark in the world (the lead's standing ruling): the readout is on the card and in the debrief only.

## 2. The words

All through `t()` (`cause.*`, `aar.poor.lostAtCause`, `aar.poor.lostAtReplacedCause`, `hud.card.replacesBy`). Weapons use `weaponName`, units `unitName` (the locale overlay, GH-1406).

| Kind | Line |
|---|---|
| gun, hard hull, penetrated | Penetrated through the {front/side/rear} by {who} ({weapon}). |
| gun, soft target | Shot by {who} ({weapon}). |
| kamikaze | Struck by {who}. |
| beam | Burned down by {who} ({weapon}). |
| the kamikaze itself | Spent on its target. |
| killer known, weapon not | Destroyed by {who}. |
| nothing recorded | Cause not recorded. |
| splash (§7) | Caught in a blast from {who} ({weapon}). / … from {who}. / Caught in a blast. |
| called strike (§7) | Caught in a strike called in by {who}. / Caught in a strike. |
| bled out (§7) | Bled out from wounds dealt by {who}. / Bled out from wounds. |
| collapse, building or tunnel (§7) | Killed in a collapse brought down by {who}. / Killed in a collapse. |
| went down with its carrier (§7) | Went down with its carrier, destroyed by {who}. / Went down with its carrier. |
| victim was pinned | + "It was pinned down." |

A flank shot is the same line with `side` or `rear` in it. The line states only what an event said: it never says "not penetrated" for a death (a bounce kills nothing, since HP alone ends a vehicle, GH-560).

## 3. Where it comes from (read-only, invariant 4)

`packages/app/src/kill-cause.ts` is a tracker fed the same `SimEvent`s the app already receives. The sim is not touched.

| Fact | Event |
|---|---|
| weapon, plate hit, penetrated | `impact` (`weaponId`, `arc`, `penetrated`) |
| weapon on a soft target | `fire` with `willHit` (no `impact` exists for soft targets) |
| beam | `beam` with `phase: 'struck'` (`target >= 0`) |
| suppressed at death | `pinned` / `unpinned` |
| who | `destroyed.by`, its type read from sim state |
| kamikaze | the attacker's `abilities` (a read of the unit type) |

`destroyed` carries `{ entity, by }` and no weapon, so the cause is a join: the target's latest candidate from `shooter === by`, no older than 200 ticks (10 s). A penetration is the only candidate that survives a later `fire` from the same shooter. A kamikaze's `impact` is stamped `arc: 'side'` by the sim as a constant, so the arc is never reported for it.

## 4. Stored, and re-worded

A death in a mission is kept as structure, not text: `LostRecord.cause` (`ledger-store.ts`, optional). The next mission's card words it in the language then active. `parseKillCause` reads it back strictly (a save is untrusted), and `@lions/economy`'s `sanitiseLedger` drops a non-object `cause`. Cost: about 100 bytes per loss in `roster.lost`, which is append-only.

## 5. What the events cannot say (and the one change proposed, not made)

- A splash round, a burning hull or an indirect round that never named the victim leaves no `fire`/`impact` for it. The line then says `Destroyed by {who}`, honestly less.
- A kamikaze on a soft target pushes no `impact`; "Struck by {who}" is all there is.
- "Suppressed" is the `pinned` state, not any suppression above zero.

**Proposed, for a separate sim-guarded step:** add `weaponId: string` (and, for a splash kill, `cause: 'direct' | 'splash' | 'bleed'`) to the `destroyed` event, pushed at the one site (`Sim.destroy`, `sim.ts`). Events are not hashed, so the determinism hash is unchanged, but `sim-guard` should confirm that and the golden. It would replace the join with a field and close the three gaps above. Nothing in this change waits on it.

## 6. Tests

`kill-cause.test.ts`: the real sim run to a death for a gun penetration on the front, the rear and a flank (side) plate (the expected plate is read off the sim's own `impact`), a soft target shot, a kamikaze on a hull and on a man, the munition's own death, and a beam; the join rules by hand (bounce, next-round `fire`, someone else's hit, window edge, miss, building round, lockout, pinned, bounded memory); the parser. Each has a mutation that turns it red (commit message). The tester criterion (4 of 5 answer "why did it die" within 10 s) belongs to tester session 2 on GH-302 and is not met by this change.

## 7. The sim step (GH-1380 follow-up, after PR 1435's review)

Built: `destroyed` carries `cause: DeathCause` (always) and `weaponId` (when a weapon dealt the killing damage), pushed at the one site,
`Sim.destroy`, with every caller naming how: `direct` (a round, a beam or a kamikaze strike that named the victim), `splash`, `strike`,
`bleed`, `collapse` (a building or a tunnel), `carrier` (an air carrier shot down, or a rider's bail-out injuries), `spent` (a kamikaze, a
swarm's last dive) and `other` (a dev kill). Both fields are optional in the type only so a hand-built event stays legal. No event is folded
into `hash()`: the determinism golden did not move.

The tracker now: words every non-`direct` cause from the event alone (a blast never claims a plate, even when the same shooter holed the hull a
moment earlier); joins a `direct` one on `shooter === by` and `weapon === weaponId`; and keeps its candidates per shooter and weapon, so a second
attacker's later `fire` never hides the first one's (the review's two-attacker case), and a beam that finishes a hull holed by the same unit's gun
names the beam. An event with no `cause` (a replay from before this step) takes the old join.

Still open: the bleed and the collapse name who, never the weapon that wounded the man or brought the roof down.
