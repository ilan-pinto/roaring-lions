# The chat filter's word list: open-licence sources and a hide/mask split (GH-1417, proposal)

**Status: A PROPOSAL FOR THE LEAD. Docs and one licence note only: no filter code, no word list is imported, nothing is built.**
16 Nov 2026. This changes decision **D3** of `2026-11-16-versus-chat-safety-design.md` (PR 1476): that design said the lists
would be authored in-house per language; the lead has ruled that an existing **open-licence** list is to be found first. This
document records what exists, on what terms, how good it is, and a proposed `hide`/`mask` split. The licence record is
`data/chat/LICENSES.md`.

**Not legal advice.** The licence readings below are mine, from the `LICENSE` files themselves; the lead's lawyer confirms
the attribution wording and the compliance for a commercial release.

**How this was checked.** Each source's `LICENSE` and README were fetched on 16 Nov from `raw.githubusercontent.com` and the
upstream commit read with `git ls-remote`; the lists for the five launch languages and English were downloaded to a scratch
folder and **counted and cross-tabulated, not committed**. Entries are described here by count and shape, not quoted. No
personal data was sent anywhere.

---

## 1. What a source must be

The game ships commercially, its code is source-available (PolyForm Noncommercial) and its data is all rights reserved
(`data/LICENSE.md`, `CONTRIBUTING.md`). A word list can come in only if it is:

1. **Redistributable in a paid game and in a public repository.** No non-commercial licence, no "no licence stated".
2. **Not share-alike.** CC BY-SA or GPL would pull our derived list, and arguably the data around it, into the same terms.
3. **Attribution-only at most.** CC BY and MIT qualify; the cost is a notice (section 3).
4. **Reviewable as plain data**, so a native reader can approve each entry (the design's rule: plain words, never a regex).

## 2. What exists

| source | licence | languages | size | useful for |
|---|---|---|---|---|
| **LDNOOBW**, "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (Shutterstock), commit `5faf2ba4` | **CC BY 4.0** (verified: the repo `LICENSE` is the CC BY 4.0 legal code, the README says "(c) 2012-2020 Shutterstock, Inc." and "licensed under a Creative Commons Attribution 4.0 International License") | 28, **including all five launch languages** (`zh`, `ru`, `de`, `fr`, `es`) and English | en 403, zh 319, ru 151, fr 91, es 68, de 66 | the base list for every launch language |
| **dsojevic/profanity-list**, commit `c2792431` | **MIT** (verified: "Copyright (c) 2021 David Sojevic") | **English only** | 434 entries, each with `severity` 1 to 4 and `tags` | **tiering the English list** (section 5) |
| `leo-profanity`, `badwords` (npm; `naughty-words`, a packaging of LDNOOBW, was not read) | MIT (read for the first two) | wrappers around the LDNOOBW dictionaries (en, fr, ru) or code | n/a | **not needed**: they add a loader, not a list |
| other lists seen (a CMU bad-words text; an `obscenity` and a `profane-words` repository) | **not assessed** or no `LICENSE` found at the paths tried | n/a | n/a | **not used**: a list with no stated licence is not redistributable |

**No open Hebrew list turned up** (LDNOOBW has no `he`); LDNOOBW does carry Arabic (`ar`), which I did not examine. Neither
language is in the first wave (GH-1407 brief), so this is a note and not a gap.

## 3. What the licences ask, and how it is met

- **CC BY 4.0 (LDNOOBW).** Keep the creator's name and notice, the licence notice, a link to the licence and the disclaimer;
  say that the material was modified; add no restriction on it. An adaptation is allowed. So: the pristine upstream files live
  unchanged under `data/chat/third_party/ldnoobw/`, with their own licence file; the game's tiered output is a separate,
  generated file marked "adapted from"; and **`data/LICENSE.md` gets one sentence** carving third-party material in
  `data/chat/third_party/` out of the blanket "all rights reserved" (a licence statement is the lead's to write, so it is
  proposed here and not edited). Attribution surfaces: `data/chat/LICENSES.md` (written, with the exact notice) and a line on
  the credits screen (`ui/credits.ts`); whether the store page also needs it is the lawyer's call.
- **MIT (dsojevic).** Keep the copyright and permission notice with any copy or substantial portion: the full text is in
  `data/chat/LICENSES.md`.

## 4. How good they are (an honest reading)

- **LDNOOBW is a search-suggestion list, not a chat-abuse list.** Its README says what goes in is subjective and the test is
  "what wouldn't we want to *suggest* that people look at". It has **no tiers and no categories**, and its sizes are uneven:
  German (66), Spanish (68) and French (91) are short against English (403). Expect gaps in slang and in anything newer than
  2020 (its copyright years are 2012 to 2020).
- **Chinese is a different shape.** 277 of its 319 entries are three characters or fewer, and Chinese has no spaces, so
  **substring matching would hide innocent lines** (a two-character word sits inside many others). Chinese needs a
  segmentation decision before it can ship (W4 below).
- **English phrases:** 124 of its 403 entries are phrases with spaces, so the matcher must handle phrases, not only words.
- **dsojevic's severity is not trustworthy on its own.** Its README says most entries started at severity 3 "prior to any solid
  classification". The cross-tab agrees: **all 74 `lgbtq`-tagged entries sit at severity 3** and 331 of 434 entries share
  that one value. The **tags** are the better signal, and they are what the proposal below uses.
- **Neither list has look-alike or obfuscation handling**; that is the filter's normalisation (design section 3.3), not the data.
- A word list is a speed bump: it will miss new slang, other scripts and context. Its job is to stop casual abuse and to back
  the report route.

## 5. The proposed split

The design's two tiers: **`hide`** hides the whole line (a slur); **`mask`** replaces only the word with asterisks; an **`allow`**
list names innocent strings a term sits inside.

### English (from dsojevic's tags and severity, 434 entries)

| tier | rule | entries |
|---|---|---|
| **`hide`** | tagged `racial`, `religious` or `lgbtq` at severity 2 or more (terms aimed at a group of people), **plus** every severity-4 entry | **149** (121 identity-tagged, 28 more at severity 4) |
| **`mask`** | everything else at severity 2 or 3 (ordinary profanity and sexual terms) | **257** |
| **not filtered by default** | non-identity entries at severity 1 (the mildest words) | **20** |
| **sent to a human** | identity-tagged entries at severity 1 (a mild group-aimed term is a judgement, not a rule) | **8** |

The identity tags decide because they describe **who is targeted**, which is what makes a line unfit to show a stranger; and the
design's `hide` tier exists for exactly that. The 20 not-filtered words are those a player would call banter; a stricter
"family" setting could switch them on later without a new list.

### The five launch languages (LDNOOBW has no tiers)

**Default every entry to `mask`, and let a native reviewer move entries to `hide` or drop them.** The lists give no signal to tier
automatically, and an automatic guess would be worse than no tier: a slur masked is a slur shown with its first letters. So:
`data/chat/review/<lang>.tsv`, one row per entry (`entry`, `decision`: `mask`, `hide`, `drop`), reviewed once per language, and
the build reads the decisions. Until a language is reviewed, its `hide` tier is **empty** and the filter says so in its
`validate:data` output, rather than pretending to full coverage.

## 6. How it would be built (not built here)

1. `data/chat/third_party/ldnoobw/<lang>` and `profanity-list/en.json`: pristine copies, each with a `SOURCE.json` (upstream URL,
   commit, sha256) that a test checks against the file, so a silent edit to "upstream" data is a red build.
2. `data/chat/review/<lang>.tsv`: the human decisions (section 5).
3. `tools/chat_wordlist_build.mjs`: a deterministic generator, from 1 and 2 to `data/chat/filter.<lang>.json` in the design's format,
   plus a header naming the sources and "adapted from". A test pins the generated files byte for byte to their inputs, with a
   mutation for each rule (a tag moved a tier; a decision ignored; an entry dropped).
4. `validate:data` checks that every folder under `data/chat/third_party/` is named in `data/chat/LICENSES.md`, and that a
   language with an empty `hide` tier is reported.
5. The filter itself (design S2) reads only the generated files at runtime. No network.

## 7. Decisions for the lead

| # | Decision | Recommended default |
|---|---|---|
| W1 | Sources | **LDNOOBW (CC BY 4.0) for all six languages; dsojevic (MIT) to tier English.** No other list. |
| W2 | Attribution | The notice in `data/chat/LICENSES.md`, a credits-screen line, and the one-sentence carve-out in `data/LICENSE.md`; the lawyer confirms the wording and whether the store page needs it. |
| W3 | Mildest English words | **Not filtered by default** (the 20 non-identity severity-1 entries); the 8 identity-tagged ones go to review. |
| W4 | Chinese | **Do not ship a Chinese filter until segmentation is decided.** Options: whole-token matching over `Intl.Segmenter` output (uses the browser's dictionary), or ship only entries of two or more characters on an exact-word basis with a long `allow` list. Default: hold Chinese out of the first filter and say so, because a substring match would hide ordinary lines. |
| W5 | Reviewers | **One native reviewer per launch language** to tier and prune LDNOOBW's list (they are also the language's QA reader in the GH-1407 budget, so it is one engagement, not two). Until then non-English `hide` is empty. |
| W6 | Hebrew and Arabic | Out of scope for this slice; no open Hebrew list was found. Arabic exists in LDNOOBW (not examined). Revisit with the languages decision. |
| W7 | Updates | **Pin the upstream commit; a re-import is a reviewed PR**, never an automatic update. |

## 8. What I did not verify

- **The content quality of any list.** I counted entries and read tags and severity; I did not read the lists entry by entry, and
  I make no claim about what they miss or wrongly include beyond the shape facts above.
- **The npm packages' licences** beyond the two read (`leo-profanity` and `badwords` are MIT per their `LICENSE` files; the
  `naughty-words` package was not read); and **the other lists** named in section 2 were not assessed.
- **Compliance.** Whether the credits-screen line and `data/chat/LICENSES.md` satisfy CC BY 4.0's "reasonable manner" for a
  commercial release, and the `data/LICENSE.md` carve-out, are the lawyer's to confirm.
- **Anything about languages other than the six** (the Arabic and other LDNOOBW lists were not read).

---

*Written by Claude Code for the lead's decision. Nothing here is implemented, and no word list is committed.*
