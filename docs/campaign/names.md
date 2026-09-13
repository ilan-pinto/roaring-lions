# The unit name table

`data/campaign/names.json` — why the three lists are the lengths they are, how every
entry was screened, and what each kind does when the counter runs past the end.

Contract: `docs/campaign/README.md` §9 · rule: `storyline.md` §2.4 · spec:
`docs/superpowers/specs/2026-09-10-motivation-layer-design.md` §4.7 · schema:
`data/schemas/names.schema.json` · issuer: `packages/app/src/names.ts`.

Sizes, 2026-09-13: **40 squads · 25 vehicles · 24 tasks**. Before: 6 · 3 · 2.

---

## 1. Why the table had to grow

A name is issued once, to a roster entry that has none, by a per-kind counter on the
ledger (`campaign.names_issued`) walking the list in table order. Nothing is ever
reclaimed: a name consumed by a unit the player then loses is spent for the run.

Since the motivation-layer branch the roster is **cumulative** — every fielded
survivor writes a fresh entry and every unfielded pool entry carries forward
unchanged — so the number of entries that ever want a name is far larger than any
single mission's force. Measured on the shipped campaign, **2026-09-11**, over the
26 campaign missions (27 files; `beit_sahwan_0_tutorial` produces no ledger keys and
names nobody):

The three lists were then walked to that draw through a replica of `nthName`, on the
old table and the new one. This is the whole case for the sizes:

| kind | a full campaign issues | old list | how the old list read at that draw | new list | now |
|---|---|---|---|---|---|
| squad | ~40 | 6 | **34 of 40** carried a numeral; the 7th squad was "Sela II" and the 40th was **"Marom VII"** | 40 | 0 numerals, last is `Kivun` |
| vehicle | ~69 | 3 | **27 of 69** carried a numeral and only **25 distinct hull numbers** covered 69 vehicles — 44 of them wore a hull another was already wearing. The 69th was **"9-4 Yated 16"** | 25 | 0 numerals, **69 distinct hulls** |
| task (drone, Peten) | ~19 | 2 | **17 of 19** carried a numeral; the 3rd drone was "Eye Two II" and the 19th was **"Eye Two X"** | 24 | 0 numerals, last is `Eye Four` |

"9-4 Yated 16" is not a typo. `ROMAN` in `names.ts` holds eleven entries and falls
through to `String(round)`, so the eleventh wrap prints a decimal — a hull number, a
Hebrew noun and an Arabic numeral in one label. Nothing was going to catch that except
walking the table to the draw the campaign actually makes.

Corroborating from this tree, `pnpm playtest`, 2026-09-13: the optimal plans hand out
rosters of 5 to 26 entries per mission, and a town's chain grows through it — Beit
Sahwan 12 → 17 → 19 → 21 → 23, Umm Zeitoun 12 → 15 → 18 → 26 (Wadi Halam dips,
4 → 9 → 9 → 13 → 12, because that arc loses vehicles). The roster is a save that grows
without bound (CLAUDE.md, "Known scaling debts"); the name table has to outlast it.

**"Sela II" and "Eye Two II" are different failures.** A squad callsign is a lineage
word — a second squad carrying a fallen squad's callsign is how callsigns actually
work, and the numeral reads correctly even if it arrives too early. A task number is
not a lineage. "Eye Two II" reads as *the second Eye Two*, which is a thing no air
tasking order has ever meant, and it breaks the one property a task number has: that
it is a number.

---

## 2. The rule

Binding on anything added to this file. `storyline.md` §2.4 rule 4 fixes the register;
this is that rule with the per-kind register written down.

- **Squads** take one common noun, never two: stone, ground, height, fortification,
  the instruments of measuring and looking. Hebrew-derived, like the materiel (Lavi,
  Namer, Eitan, Yahalom, Peten, Shoded, Ari'im, Kedem, Sahar). The schema enforces the
  one-word half (`callsign`, `^[A-Z][a-z']+$`) because a two-word callsign reads either
  as a task number or as a given name plus a surname, and §2.4 refuses both.
- **Vehicles** take a hull number and one painted name: tools, metal, running gear —
  the things a crew hits something with or rolls on. The hull is the identity and the
  painted name is what the crew answers to, so the wrap repaints the hull rather than
  numbering the name.
- **Tasks** (drones and the Peten, `kinds.task_roles`) take a two-word task number:
  a callsign block plus a number word. These are the only names in the table that are
  **not** Hebrew-derived, and that is inherited rather than coined here — the shipped
  table and spec §4.7 both use English (`Eye Two`, `Kite One`). It reads as a
  deliberate split: ground callsigns in the force's own register, air tasking in the
  shared aviation one. The block words here are the instruments of looking and the
  parts of a flown thing: Eye, Kite, Lens, Gimbal, Aperture, Spool.
- **Civilians are never named.** Spec §4.7.
- Never a real place, a faith, an ethnicity, a nationality, a real insignia, a real
  force's unit or platform, or a real public figure. Never a given name plus a surname.

---

## 3. How the 2026-09-13 entries were screened

Every new entry carries `"screened": "2026-09-13"` and each one was put through the
**English Wikipedia API** — three probes per candidate, **162 candidates, 486 queries**,
no failures, log retained for the session in the scratchpad. **60 words were accepted
into the table** (34 squad callsigns, 22 painted names, 4 new task blocks) behind 78 new
entries, and the 9 inherited names were re-screened. Of the ~93 that did not make it,
about 70 were rejected on the grounds below and the rest are clean spares held in
reserve (Chagora, Melgaz, Tzamid, Tzemer, Nasoret, Lavid, Tzipui, Rivud, Alidade). The
probes:

1. **exact title** — is there an article at exactly this word, and what is its subject
   (`action=query&prop=extracts&exintro&redirects&titles=<name>`);
2. **full-text search** for the bare word (`list=search&srsearch=<name>`), which is
   what surfaces people and places the exact title hides behind a redirect;
3. **full-text search for the word beside armed-force vocabulary**
   (`<name> (brigade OR battalion OR missile OR militia OR "armed group" OR general OR
   politician)`), which is what caught the operation names.

A candidate was **rejected** on any of four grounds:

| ground | example rejection |
|---|---|
| (a) a real person's common single-word name | **Geder** → Antônio Géder, footballer, known as Géder · **Kav** → three musicians and an activist · **Chevel** → Chevel Shepherd · **Chavit** → Chavit Singson, Filipino governor · **Kotev** → Bulgarian sportsmen |
| (b) a real force's unit, formation, operation, platform or system | **Kilshon** → Operation Kilshon, 1948 · **Avak** → Operation Avak, 1948 · **Halyard** → Operation Halyard, WWII · **Plada** → the 162nd Division's own name · **Egrof** → the 146th Division's own name · **Saf** → Singapore/Sudanese Armed Forces, and the FAMAE SAF rifle · **Bedil** → a real class of early firearms · **Spar** → SPARS, the US Coast Guard Women's Reserve |
| (c) the exact-title article is a real settlement, region or feature | **Sulam** → a village in Israel · **Maslul**, **Otzem** → moshavim · **Kalkar** → a German municipality · **Melach** → a river in Tyrol · **Dofen** → a volcano in Ethiopia · **Tikra** → an archaeological site in Peru · **Gir** → Gir National Park · **Girit** → Crete · **Melben** → Melbourne · **Kerach** → a village in Iran · **Barad** → a village in Syria |
| (d) a religious term, object, text or figure | **Galgal** → the *galgalim* of Ezekiel's vision · **Makosh** → a Slavic goddess · **Mafteach** → a rabbinic index · **Migrefa** → the Temple *magrefa* · **Nechoshet** → the *Nechushtan* · **Chomer** → Talmudic *kal va-chomer* · **Sargel** → the Torah scribe's ruling tool · **Petek** → the Breslov *Petek* · **Tzeror** → biblical hits only |

Six further rejections were on legibility rather than collision, and they are one
judgement: a word whose plain reading fights the fiction. **Gag** (the exact title is a
restraint device) and **Beton**; and four whose only search evidence pointed straight
into the real conflict this fiction is not about — **Lachatz**, **Merchav**,
**Ma'avar**, **Otem**.

**The residual risk, stated rather than hidden.** "A Hebrew common noun that nobody has
ever borne as a surname" is close to an empty set, so ground (a) is applied as
*primarily* known as a person: rejected when the exact-title article is that person or
a surname index, accepted when it is the common noun or absent. Two of the six task
blocks are accepted under the same refinement and are worth knowing about:

- **Lens** — the exact title is the optical device; Lens, Pas-de-Calais and RC Lens are
  real and well known.
- **Aperture** — clean; "Distributed Aperture System" contains the word descriptively.

**The nine inherited names were re-screened on 2026-09-13 and several would not pass
the standard above.** They are kept: they stay at the head of their lists so
already-issued names stay put, and a name is stored on the roster entry rather than
re-derived, so moving them would rename nobody and reordering them is the only thing
that could. Recorded for the lead to rule on, not silently blessed:

| name | hit |
|---|---|
| Barzel | the exact title is a Hebrew surname index; Rainer Barzel was a German federal minister. *Kipat Barzel* is Iron Dome |
| Tzur | the exact title says "a Hebrew given name and surname"; Tzvi Tzur was a chief of staff. *Ma'oz Tzur* is a liturgical hymn |
| Keshet | INS *Keshet* is a real missile boat; Keshet Media Group is a broadcaster |
| Migdal | Migdal, Israel is a real town; Zwi Migdal was a real criminal organisation |
| Marom | Eli Marom commanded a real navy |
| Sela | three public figures carry it as a surname; Sela (Edom) is a biblical site |
| Yated | *Yated Ne'eman* is a religious newspaper; Yated is a moshav |
| Ayil, Gachelet | clean |

**Screened against this tree as well**, word-for-word over `data/` and `packages/`:
none of the 60 accepted words is a unit id, map id, marker, zone, place in
`world.json`, a villain's personal name (Nadir Sahim, Karim Adhal, Jubran Hallaq) or a
KDF case name (SPADE, LANTERN, FERRY). Eight words match something in the tree and all
eight are benign: the six inherited names, already quoted in `hud.test.ts`,
`loading.test.ts` and `mission.test.ts`, and the bare English words *eye* and *kite*,
which appear in eight mission briefings as ordinary nouns ("he is not the only pair of
eyes on that ground"). That overlap is the register working, not a collision.

One candidate was dropped on this check alone. **Reticle** was accepted by Wikipedia
and rejected here: this project already calls the attack cursor and the engagement
overlay the reticle (`input/cursor.ts`, `three/units/overlays.ts`), so a drone named
`Reticle Two` would make a bug report ambiguous. **Gimbal** replaced it — cleaner on
every probe and a better word for a drone's camera mount. **Sextant** was rejected in
the same round: Sextant Avionique was a real defence-electronics firm.

---

## 4. Wrap behaviour, per kind, measured

Walked through a replica of `nthName` (`packages/app/src/names.ts`) over 130 issues.
"Ceiling" is the zero-based issue at which the kind's identity first breaks, so a draw
of that many names is still clean.

### Squads — 40 entries, ceiling 40

Issues 0–39 are the 40 callsigns in table order; issue **40 is "Sela II"** and the
lineage numeral is correct from there. A full campaign draws ~40, so a first run
should see no numeral at all and a replay-heavy run sees one that reads properly.

### Vehicles — 25 entries, ceiling **75**, and the hulls are the reason

`nthName` wraps a vehicle by adding the pass count to the hull's **first digit**
(`1-2 Ayil` → `2-2 Ayil` → `3-2 Ayil`), keeping the painted name, because two tanks
wearing one hull number is the one thing that definition cannot survive. The hull
pattern is `^[1-9]-[1-9]$`, so a company digit has nine values and the Roman numeral
only appears past nine.

That creates a collision the old three-entry table was too small to show: entry A's
pass 2 and entry B's pass 0 produce the **same hull number** whenever they share a
second digit and their first digits are 2 apart. Two *different* vehicles, one hull.
Guaranteed freedom would need every entry to hold a distinct second digit, which caps
the list at nine — the shipped three were collision-free by luck, their second digits
being 2, 1 and 4.

The 25 entries are therefore laid out so that **no two entries' first three passes can
meet**: per second digit the first digits are drawn from `{1, 4, 7}`, whose pass
windows `1-3`, `4-6`, `7-9` are disjoint and all fit under nine. The three inherited
hulls sit at first digit 1 or 2 and take the slots around them (`s=1` and `s=4` hold
two entries each rather than three, which is why the list is 25 and not 27).

Measured: **69 vehicle names → 69 distinct names and 69 distinct hull numbers, zero
Roman numerals**, the last being `9-7 Shlada`. The first repeated hull number is at
issue **75** (`4-2 Ayil` repeats `4-2 Kardom`'s hull) and the first Roman numeral at
issue **79** (`9-2 Mesor II`). Both are past a full campaign's 69, with six issues of
margin. **A heavy replayer can cross 75.** Closing that needs a two-digit company in
the hull pattern, or a cycle that skips digits the table already holds — §5.

### Tasks — 24 entries, ceiling 24, and the list *is* the scheme

The scheme is **a callsign block plus a number word**: six blocks — Eye, Kite, Lens,
Gimbal, Aperture, Spool — numbered One to Four. It is written out flat in the table,
and the order is the load-bearing part:

```
Eye One · Kite One · Lens One · Gimbal One · Aperture One · Spool One
Eye Two · Kite Two · Lens Two · Gimbal Two · Aperture Two · Spool Two
Eye Three …  Eye Four … Spool Four
```

**Across the blocks, then down the numbers.** Each new air task opens a new callsign at
One; once all six are flying, the second airframe on each line takes Two. A task number
names the task rather than the machine, which is why a drone and the Peten can carry
consecutive numbers on one line — `kinds.task_roles` is one pool, deliberately.

That order is chosen because it is exactly what the counter already computes. Issue *n*
under the current code is `tasks[n % 24]`; issue *n* under the base-word scheme in §5
would be `bases[n % 6] + NUMBER[1 + floor(n / 6)]`. **For the first 24 issues those two
produce the identical sequence.** The data shape prefigures the code shape, so adopting
§5 later changes no name a player has already been shown.

Measured: **19 task names → 19 distinct, zero Roman numerals**, last `Eye Four`. The
degenerate wrap is pushed to issue **24** (`Eye One II`), five past a full campaign.
Both spec-cited names survive as members: `Kite One` at index 1, `Eye Two` at index 6.

---

## 5. What code would have to change, and why it does not have to now

Nothing in this delivery needs `names.ts` or the schema, because the measured draw
(40 · 69 · 19) sits under every ceiling (40 · 75 · 24). Two changes would raise them,
both small, both out of scope here. Stated so the next author does not re-derive them.

**(1) The task number should be computed, not enumerated** — the durable fix for
`Eye One II`. In `names.ts`, for `kind === 'task'` only:

```
tasks[n % len].name            ->  `${base} ${NUMBER_WORD[1 + Math.floor(n / len)]}`
```

with `tasks` holding the six **base words** (`Eye`, `Kite`, `Lens`, `Gimbal`,
`Aperture`, `Spool`) and a `NUMBER_WORD` table in `names.ts` beside `ROMAN`
(`One`…`Twelve`). The Roman `suffix()` then never applies to a task at all, and the
ceiling becomes 6 × the length of `NUMBER_WORD` (72 at twelve) instead of 24. It needs
`names.schema.json` too: `tasks` would take `callsign` (one word) instead of `noun`,
and the `noun` `$def`'s comment about a task number being two words moves to the code.
Owner: whoever owns `packages/app/src/names.ts`. **Do not do it without the schema
change** — one-word entries under the current `noun` pattern validate fine and issue
bare "Eye", which is a squad callsign, not a task number.

**(2) The vehicle hull needs more room past 75.** Either widen the pattern from
`^[1-9]-[1-9]$` to allow a two-digit company, or make the pass cycle skip first digits
the table already uses for that second digit. The first is a one-line schema change and
a `HULL_TOP` that is no longer a single digit; the second keeps the pattern and puts the
knowledge in `nthName`. Neither is needed until a save can hold more than 75 vehicles.

**One thing that must NOT be done:** do not widen `tasks` past 24 by appending `Five`,
`Six` … to the flat list. It works, and it silently forks the table away from the
computed scheme in (1), so the two can no longer produce the same sequence.

---

## 6. Consequences for existing tests

`pnpm validate:data` passes (112 files). `pnpm test` is **4 failures in one file**,
`packages/app/src/names.test.ts`, all four fixture-coupled to the old 6 · 3 · 2 table —
no other consumer of `names.json` exists in 179 other test files. The numbers a fix
needs, computed against the new table:

| test | as written now | what it becomes | to keep testing the wrap |
|---|---|---|---|
| names the unnamed in table order | `…, 'Eye Two', '1-2 Ayil'` | `…, 'Eye One', '1-2 Ayil'` | — |
| continues from the counter and wraps | squad 5 → `['Migdal', 'Sela II']` | squad 5 → `['Migdal', 'Chatzatz']` | squad **39** → `['Kivun', 'Sela II']`, issued 41 |
| wraps a vehicle by cycling the hull | vehicle 0, six → wraps at 3 | vehicle 0, six → `1-2 Ayil, 2-1 Gachelet, 2-4 Yated, 4-2 Kardom, 7-2 Mesor, 5-1 Mafuach` (no wrap) | vehicle **22**, six → `1-9 Machsan, 4-9 Metach, 7-9 Mafselet, 2-2 Ayil, 3-1 Gachelet, 3-4 Yated`, issued 28 |
| reaches for the Roman only past the last digit | `nth(24/27/30)` = `9-2 Ayil{,II,III}` | the table's highest first digit is 7, at entry 4 (`7-2 Mesor`) | `nth(54/79/104)` = `9-2 Mesor`, `9-2 Mesor II`, `9-2 Mesor III` |

Two tests already pass unchanged and should stay: "gives thirty vehicles thirty
different names" (still true, and now true of the hull numbers as well) and "is pure".
Worth adding while in there, since §4 is where the design lives: **69 vehicles get 69
distinct hull numbers**, and **the first 24 task names are the base-word scheme**.

---

## 7. Adding a name later

1. Pick a concrete common noun in the kind's register (§2). Avoid abstractions; a squad
   called "Precision" is not in the register and reads as a motto.
2. Run the three probes in §3 against English Wikipedia. Reject on any of the four
   grounds. Record the rejection here so nobody re-proposes it — §3's table exists
   because "Kilshon" is a very good word for a pitchfork and a real 1948 operation.
3. **Append, never insert.** Table order is issue order and a counter on a live save is
   an index into it. Inserting renames nobody already named, but it silently re-points
   every future issue and breaks the §4 measurements.
   The `tasks` table broke this rule ONCE, on 2026-09-13, before any release: it went from
   `[Eye Two, Kite One]` to the 24-entry across-the-blocks order §4 derives, because the
   two-entry table named the third drone `Eye Two II`. A review then "restored" the two
   originals to the front and that was reverted: it put `Eye Two II` back at the wrap and
   broke the counter-shape argument above for a save-compatibility gain nobody could
   collect. What the breach costs, recorded: a save made between that day's two merges
   with `names_issued.task >= 1` re-issues `Eye Two` at issue 6, since `assignNames`
   never dedupes against the roster. Nothing may do this again.
4. A new vehicle needs a hull whose first digit is drawn from `{1, 4, 7}` for its second
   digit, or the §4 collision-free property is gone. Adding a 26th and 27th entry means
   taking the constrained `s=1`/`s=4` slots at first digit 8, whose third pass produces
   a Roman numeral — place those last.
5. `pnpm validate:data`, then `pnpm test`.
