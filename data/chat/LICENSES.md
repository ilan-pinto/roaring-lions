# data/chat: the chat word lists, their sources and licences

The versus chat filter (GH-1417 S2, `docs/superpowers/specs/2026-11-16-versus-chat-safety-design.md` section 3.3) reads
`data/chat/filter.<lang>.json`. Each file is **adapted material** from one open-licence source, recorded here. Lead ruling D3
(16 Nov 2026): start from an existing open-licence word list, with its redistribution rights recorded, extended in-house; nothing
copied without rights. Not legal advice: the lead's lawyer confirms the attribution wording and the compliance for a commercial
release.

**Third-party material in this folder keeps its own licence.** The repository's blanket "all rights reserved" for `data/`
(`data/LICENSE.md`) does **not** apply to it and must not be asserted over it: CC BY 4.0 forbids adding restrictions to the licensed
material. The `in_house` entries of each filter file are the project's own.

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
| English | `third_party/ldnoobw/en` | 403 | `af851ecef1d5f212caba17339b12ac39cc2fef7d78c74876f67237644fcee8bd` | `filter.en.json` | in-house: 44 hide, 327 mask, 32 dropped |
| German | `third_party/ldnoobw/de` | 66 | `ebe44d7772897390e27f7bec412fdcdf0efc294e4db157f8487c4cd8d4fabd55` | `filter.de.json` | not yet: all mask |
| Spanish (Spain) | `third_party/ldnoobw/es` | 68 | `073334261cc2e7c08339faefd2f19f9623e8240a0ac18fe2a26c368b897496ce` | `filter.es-ES.json` | not yet: all mask |
| French | `third_party/ldnoobw/fr` | 91 | `79763a705e08256b393952852bb63aa903f4485e0ef02f70735f5e50efff213c` | `filter.fr.json` | not yet: all mask |
| Russian | `third_party/ldnoobw/ru` | 151 | `2598adabd2b761733d72a68d8ee4fcc1d2c38f2f85b6ff489985c6ce1d93bf75` | `filter.ru.json` | not yet: all mask |

**Not imported:** Chinese (`zh`, 319 entries). It is held out until segmentation is decided (proposal W4): Chinese has no spaces, so
whole-word matching does not apply and a substring match would hide ordinary lines. `validate:data` refuses a `filter.zh*.json`.
No other LDNOOBW language is imported.

**What CC BY 4.0 asks of us** (section 3(a)): keep the creator's name and copyright notice, the licence notice, a link to the
licence and the disclaimer; **say that the material was modified**; add no restriction on the licensed material and no technical
measure that stops others exercising the licence. Our tiering, removals and additions make the filter files adapted material.

**The notice** (shown on the credits screen, `credits-data.ts`, and carried here):

> Word lists adapted from "List of Dirty, Naughty, Obscene, and Otherwise Bad Words", © 2012-2020 Shutterstock, Inc., licensed under
> CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>). Source:
> <https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words> (commit 5faf2ba42d7b). Changes: entries were
> sorted into hide and mask tiers, some were removed on review and some were added, and the matching is done by the game, not the
> list.

**The changes, per file.** `filter.en.json`: `hide` holds slurs aimed at a group of people, hate slogans, and sexual-violence and
child-abuse terms; `mask` the rest; `dropped` the upstream entries that are ordinary words in an RTS chat (for example "escort",
"domination", "tied up"); `in_house` the inflections and common words the list lacks; `allow` innocent words that contain a long
`hide` entry. The four other files are the upstream list unchanged in `mask`, with an empty `hide` until a native reader reviews
them (lead ruling; proposal W5).

## 2. Considered and not used

- **dsojevic/profanity-list** (MIT, English, with severity and tags): proposed for tiering English (PR 1484, W1) but not ruled on, so
  nothing is taken from it. The English tiers are in-house.
- `leo-profanity`, `badwords`, `naughty-words` (npm): wrappers around the LDNOOBW lists or code; they add a loader and no list.
- Lists with no stated licence (an `obscenity` and a `profane-words` repository, a CMU bad-words text): not redistributable, not used.
