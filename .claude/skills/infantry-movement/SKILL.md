---
name: infantry-movement
description: >-
  Use this skill for ANY question or change about how soldiers or squads move, stand, fire or
  manoeuvre in Roaring Lions: gait, walk/run/sprint clips, foot sliding, kneel, prone, crawl, pinned
  or suppressed behaviour, the rush, figure spacing inside a squad, wedge/file/line formations,
  bounding overwatch, break contact or other drills, urban movement, smoke for movement, and
  mounting or dismounting APCs (Namer, M113 ramp). Trigger on clips like
  idle/move/fire/moveFire/kneel/pinned, the rig and gait passes, figure slots, and requests like
  "soldiers don't move like real soldiers" or "how far apart should the team be". It gives sourced
  soldier and small-unit movement converted to tiles, the lead's infantry realism bar, and a ranked
  list of the game's infantry gaps.
---

# Infantry movement and manoeuvre for Roaring Lions

You are making soldiers move like trained infantry while keeping the game readable and deterministic. Individual movement tells you **how one man moves**: carry, gait, the rush, the drop to cover. Small-unit doctrine tells you **how a team moves**: who leads, how far apart, who covers whom. The game's scale and the lead's standing rulings tell you which of those survive.

The sourced research, with a URL per number and ESTIMATE marks, is in `references/`:
- `references/soldier-movement.md`: speeds with and without load, gait and lean under load, carry positions, the three firing positions and transitions, the 3–5 s rush, crawls, and react to contact.
- `references/squad-tactics.md`: fire-team and squad formations with spacing and roles, the movement techniques, fire and movement, battle drills as movement sequences, danger areas, urban movement, cover and concealment, smoke, APC mount and dismount, and infantry with tanks.
- `references/game-and-animation.md`: scale, what reads at RTS distance, animation craft (cycle timing, foot planting, transitions), what the game does today, and the **ranked gaps G1–G12** (§6) with the constraints any fix must respect (§7).

## Scale facts you need first

- **1 tile = 3 m; 20 Hz sim; a 48x48 map is 144 m across.** Open-ground doctrine does not fit: a squad column is about 25 x 55 m. Urban doctrine fits almost unchanged: 3–5 m between men, and most engagements at 35 m or less.
- A Rifle Squad draws 3 figures on about 0.9 m slots. It runs at 2.7 m/s and kneels to fire in 0.2 s each way. Both values were set by the backtest and accepted by the lead: **do not change them** without a balance measurement and the lead.

## Calibration numbers (short form)

**Speeds**
- Road-march pace: 30 in at 106 steps/min, about 1.35 m/s while moving, 4.0 km/h with halts. Cross-country: 2.4 km/h.
- A 30 m sprint takes 6.2 s unloaded and 8.2 s with 21.6 kg. Half the loss is in the first 5 m, because acceleration is what load costs most.

**Loads and gait**
- Doctrine caps the fighting load at 48 lb and the approach-march load at 72 lb. Real loads ran 60–100+ lb.
- Visible cues under load: 2–11° more forward lean and about 30% longer double support (both feet down).
- A rifle held in both hands stops the arm swing, so the twist comes from the torso.

**Drills**
- **The rush:** 3–5 s up ("I'm up, he sees me, I'm down"), then plant, fall forward, roll and go prone.
- **Crawls:** low crawl about 0.1–0.3 m/s, high crawl about 0.3–0.6 m/s (estimates; no public timing exists).

**Formations**
- Fire-team wedge: about 10 m between men, team leader at the point.
- Ranger Handbook spacing: traveling 10 m between men and 20 m between teams; traveling overwatch 20/50 m.
- Urban: 3–5 m between men, about 30 cm off the wall, on the shadowed side, below windows.

**Vehicles**
- The Bradley drill standard is 30 s per fire team by the ramp and 45 s by the door.
- A Namer dismounts 9 men by its rear door-ramp. Its timing is not published.

## Rules that decide most questions

1. **The lead's realism bar comes first.** It is in memory `infantry-motion-standard` and `infantry-squad-design-rules`:
   - right-shoulder grip with recoil;
   - halt and kneel to fire;
   - squads in a wedge;
   - varied bodies, all fit;
   - every figure armed.
   A proposal that weakens any of these needs the lead. Changing the kneeling-huddle pinned pose (his 7 Oct ruling) also needs the lead.
2. **Spacing: keep the order, compress the distance.** Real metres do not fit the map. Widen figure slots on open ground (about 1.5–2.5 m) and keep them tight in streets and buildings (G5). Never let a figure leave its tile's footprint, or the selection, pick and burial checks break.
3. **One locomotion clip is not enough across speed bands.** Walk is below about 2 m/s, run 2–4 m/s, sprint above that. A single run cycle time-scaled down to a crawl-speed creep slides the feet. Choose clips by ground speed, with footfall-synced blending (G3). The cadence gate today only tests each team at its own unit speed, so a slowed Column or a pinned creep goes unchecked.
4. **Pinned men crawl; they do not slide.** A pinned unit under a move order should play a crawl, not the static huddle sliding at 1/64 speed (G1, presentation only).
5. **Prone exists in reality.** The rush ends prone, and soldiers go prone when there is no cover. The game has no prone posture for the living (G2, G7). Adding one is a presentation change, but it revisits a lead ruling, so bring it to him with a mock.
6. **Dismount from the ramp, over seconds.** Today a disembark is instant, half a tile from the hull. Real infantry leave by the rear ramp and spread to their slots over about 5–10 s at game scale (G4). Presentation first; the sim timing is optional and needs the lead.
7. **Watch sectors while moving.** Point man ahead, flanks out, last man to the rear. An upper-body or head yaw inside the existing 60° twist reads as trained infantry at almost no cost (G6).
8. **Load shows.** Heavy-weapon and crew-served teams lean more and step shorter. A per-team load class in the gait table (G10) is cheap and reads.
9. **Infantry and armour work together.** In close terrain the dismounts go ahead of the hulls, stay out of the main gun's 60° arc and are never behind the engine (G11). That is design work for formations.

## How to use this skill on a task

1. **Classify the change:**
   - **P**, presentation: clips, rig, gait table, figure slots, renderer rules. No sim change and no determinism risk.
   - **D**, data the sim already reads.
   - **S**, sim: speed, posture timing, formations, drills, dismount timing. It needs the sim-guard review, a deliberate golden-hash move in the same commit, and `pnpm balance`.
2. **Respect the pipeline order** (CLAUDE.md, "Mesh units"):
   - kit, rig, export, hands, motion, gait, encode;
   - bones and clips are authored in code, or by the Meshy pipeline for the pilot figures, never hand-posed;
   - every armed walker ships a `moveFire` clip;
   - nothing a living team draws may be under the ground;
   - the opus high-effort infantry review runs before any infantry art merges.
3. **Use the real numbers above,** converted to tiles and ticks, and say where you exaggerate for readability. Things invisible at play zoom are listed in `references/game-and-animation.md` §2; do not spend on them.
4. **Check the ranked gaps** in `references/game-and-animation.md` §6 and the constraints in §7 before proposing anything.
5. **Write the proposal as a table:** real, game now, proposed, verdict. The lead approves art and motion numbers, plus a close-up, before any render.
6. **Prove every new check can fail** with a one-line mutation, and put the falsification in the commit message.

## Pitfalls

- **Copying open-ground metres onto a 144 m map.**
- **Fixing foot-sliding by speeding up the cycle instead of choosing the right clip.**
- **Kneel and prone transitions added only in the renderer while the sim fires at 0.2 s.** The visual must finish inside the sim's window, or the shot comes from a man still falling.
- **Treating doctrine drills as scripted animations.** In the sim they are orders and formations: movement sequences with timing, not cutscenes.
