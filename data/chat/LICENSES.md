# data/chat: the chat word lists, their sources and licences

The versus chat filter (GH-1417 S2, `docs/superpowers/specs/2026-11-16-versus-chat-safety-design.md` section 3.3) reads
`data/chat/filter.<lang>.json`. Each file is **adapted material** from one open-licence source, recorded here. Lead ruling D3
(16 Nov 2026): start from an existing open-licence word list, with its redistribution rights recorded, extended in-house; nothing
copied without rights. Not legal advice: the lead's lawyer confirms the attribution wording and the compliance for a commercial
release. The sources, the terms and the reasoning were first set out in
`docs/superpowers/specs/2026-11-16-chat-filter-wordlist-proposal.md` (PR 1484).

**Third-party material in this folder keeps its own licence.** The repository's blanket "all rights reserved" for `data/`
does **not** apply to it and must not be asserted over it: CC BY 4.0 forbids adding restrictions to the licensed material.
`data/LICENSE.md` says so in its exception paragraph (the lead's ruling, 16 Nov 2026). The `in_house` entries of each filter file are
the project's own and stay all rights reserved.

`pnpm validate:data` (`tools/validate_chat_filters.mjs`) refuses a filter file whose source folder is not named in this file, whose
pristine copy does not match its pinned sha256, or whose entries are not exactly the upstream entries plus declared `in_house` ones.

## 1. LDNOOBW, "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (Shutterstock)

- Upstream: <https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words>
- Pinned commit: `5faf2ba42d7b1c0977169ec3611df25a3c08eb13` (read 16 Nov 2026). A re-import is a reviewed PR, never an automatic update.
- Licence: **Creative Commons Attribution 4.0 International (CC BY 4.0)**, <https://creativecommons.org/licenses/by/4.0/>. The
  upstream `LICENSE` file is the CC BY 4.0 legal code and is kept unchanged at `third_party/ldnoobw/LICENSE`; the upstream README says
  "© 2012-2020 Shutterstock, Inc." and "This work is licensed under a Creative Commons Attribution 4.0 International License".
- The pristine copies, unchanged, are in `third_party/ldnoobw/` (entries are non-empty lines):

| language | pristine copy | entries | sha256 | filter file | tiered |
|---|---|---|---|---|---|
| English | `third_party/ldnoobw/en` | 403 | `af851ecef1d5f212caba17339b12ac39cc2fef7d78c74876f67237644fcee8bd` | `filter.en.json` | in-house: 49 hide, 322 mask, 32 dropped |
| German | `third_party/ldnoobw/de` | 66 | `ebe44d7772897390e27f7bec412fdcdf0efc294e4db157f8487c4cd8d4fabd55` | `filter.de.json` | not yet: all mask |
| Spanish (Spain) | `third_party/ldnoobw/es` | 68 | `073334261cc2e7c08339faefd2f19f9623e8240a0ac18fe2a26c368b897496ce` | `filter.es-ES.json` | not yet: all mask |
| French | `third_party/ldnoobw/fr` | 91 | `79763a705e08256b393952852bb63aa903f4485e0ef02f70735f5e50efff213c` | `filter.fr.json` | not yet: all mask |
| Russian | `third_party/ldnoobw/ru` | 151 | `2598adabd2b761733d72a68d8ee4fcc1d2c38f2f85b6ff489985c6ce1d93bf75` | `filter.ru.json` | not yet: all mask |

**Not imported:** Chinese (`zh`, 319 entries, one duplicate; sha256 of the raw upstream file at the pinned commit
`a1d9aa037c8b039ef3b40148b3364ce2ca62ce4a955b7082a16ad99f6cbd1bc0`, no copy in this folder). It is held out until segmentation is decided (proposal W4): Chinese has no spaces, so
whole-word matching does not apply and a substring match would hide ordinary lines. `validate:data` refuses a `filter.zh*.json`.
No other LDNOOBW language is imported.

**What CC BY 4.0 asks of us** (section 3(a)): keep the creator's name and copyright notice, the licence notice, a link to the
licence and the disclaimer; **say that the material was modified**; add no restriction on the licensed material and no technical
measure that stops others exercising the licence. Our tiering, removals and additions make the filter files adapted material.

**Disclaimer of warranties** (CC BY 4.0 section 3(a)(1)(A)(iv) asks us to keep "a notice that refers to the disclaimer of
warranties" if the licensor supplied one). Checked at the pinned commit on 16 Nov 2026: **upstream supplies no disclaimer notice of
its own.** Its README carries only the copyright line ("© 2012–2020 Shutterstock, Inc."), the licence badge and the licence notice,
plus two content caveats ("Obvious warning: These lists contain material that many will find offensive" and "Miscellaneous caveat:
Clearly, what goes in these lists is subjective"), which are not warranty disclaimers. The only disclaimer is the licence's own,
Section 5 ("Disclaimer of Warranties and Limitation of Liability": the licensor offers the material as-is and as-available and makes
no representations or warranties of any kind), which ships unchanged in `third_party/ldnoobw/LICENSE`. We refer to it here: the
lists are provided as-is, under that Section 5.

**The notice** (shown on the credits screen, `credits-data.ts`, and carried here):

> Word lists adapted from "List of Dirty, Naughty, Obscene, and Otherwise Bad Words", © 2012-2020 Shutterstock, Inc., licensed under
> CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>). Source:
> <https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words> (commit 5faf2ba42d7b). Changes: entries were
> sorted into hide and mask tiers, some were removed on review and some were added, and the matching is done by the game, not the
> list.

**The changes, per file.** `filter.en.json`: `hide` holds slurs aimed at a group of people, hate slogans, and sexual-violence and
child-abuse terms; `mask` the rest; `dropped` the upstream entries that are ordinary words in an RTS chat (for example "escort",
"domination", "tied up"); `in_house` the inflections and common words the list lacks; `allow` innocent words that contain a long
`hide` entry, and innocent phrases that contain a `hide` word ("chink in the armour", "gypsy moth"). The lead's ruling of 16 Nov
moved "lolita", "shota", "fucktards", "neonazi" and "swastika" to `hide` and added "chink", "dyke", "dykes", "gypsy", "ching chong"
and "heil hitler" (hide) and "kys" (mask) in-house. The four other files are the upstream list unchanged in `mask`, with an empty `hide` until a native reader reviews
them (lead ruling; proposal W5).

## 2. dsojevic/profanity-list (English, with severity and tags): considered, not used

Proposed for tiering English (PR 1484, proposal W1) but not ruled on, so **nothing is taken from it** and no copy of it is in this
folder: the English tiers above are in-house. It is recorded here, at the commit that was read, so a later import starts from
known terms; its MIT notice must travel with any such import.

- Upstream: <https://github.com/dsojevic/profanity-list>
- Pinned commit: `c27924319aa9bd6f917e3782b4f4b6604a50b652` (`main`, 16 Nov 2026)
- Licence: **MIT**, "Copyright (c) 2021 David Sojevic". English only (434 entries); each entry has a `severity` (1 mild to 4
  severe) and `tags` (`general`, `lgbtq`, `racial`, `religious`, `sexual`, `shock`). `en.json` sha256
  `bcf8bfc09dd3f7480972cb041a4cba291a6ff16a6fbf29022d5d679e3c39502c`.
- Its own README warns that most entries "started their life with a Severity Level of 3 (Strong) prior to any solid
  classification", so the severity is not a trustworthy tier on its own; the proposal would tier by the tags instead.
- MIT asks that the copyright notice and permission notice be included in copies or substantial portions. The full text,
  as shipped upstream:

```text
MIT License

Copyright (c) 2021 David Sojevic

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 3. Considered and not used

- `leo-profanity` (MIT, read: a code wrapper that bundles the LDNOOBW dictionaries for en, fr and ru), `badwords` (MIT, read: code)
  and the npm `naughty-words` package (a packaging of the LDNOOBW lists; its own licence was not read): they add a loader we do not
  need and no list we do not already take directly.
- Sources whose licence was **not assessed** (an `obscenity` and a `profane-words` repository returned no `LICENSE` at the paths
  tried; lists linked from `leo-profanity`'s README, such as a CMU bad-words text, state no licence that I read): not used. A
  list with no stated licence is not redistributable.
