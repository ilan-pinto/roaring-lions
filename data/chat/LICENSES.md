# data/chat: third-party word lists, sources and licences

**PROPOSED (GH-1417, item 49). Nothing from these sources is imported yet; this file records what may be, on what terms, and the
notices that must travel with any import.** Written 16 Nov 2026 from the upstream `LICENSE` files read on that date at the pinned
commits below. Not legal advice: the lead's lawyer confirms the attribution wording and the compliance for a commercial release.
The design and the reasoning are in `docs/superpowers/specs/2026-11-16-chat-filter-wordlist-proposal.md`.

Third-party material in this folder keeps its own licence. The repository's blanket "all rights reserved" for `data/`
(`data/LICENSE.md`) does **not** apply to it and must not be asserted over it: CC BY 4.0 forbids adding restrictions to the
licensed material.

## 1. LDNOOBW, "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (Shutterstock)

- Upstream: <https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words>
- Pinned commit: `5faf2ba42d7b1c0977169ec3611df25a3c08eb13` (`master`, 16 Nov 2026)
- Licence: **Creative Commons Attribution 4.0 International (CC BY 4.0)**, <https://creativecommons.org/licenses/by/4.0/>;
  the repository's `LICENSE` file is the CC BY 4.0 legal code, and its README says "© 2012-2020 Shutterstock, Inc." and "This work is
  licensed under a Creative Commons Attribution 4.0 International License".
- Files proposed (sha256 of the raw files at the pinned commit; entries counted by non-empty lines):

| language | file | entries | sha256 |
|---|---|---|---|
| English | `en` | 403 | `af851ecef1d5f212caba17339b12ac39cc2fef7d78c74876f67237644fcee8bd` |
| Simplified Chinese | `zh` | 319 (one duplicate) | `a1d9aa037c8b039ef3b40148b3364ce2ca62ce4a955b7082a16ad99f6cbd1bc0` |
| German | `de` | 66 | `ebe44d7772897390e27f7bec412fdcdf0efc294e4db157f8487c4cd8d4fabd55` |
| French | `fr` | 91 | `79763a705e08256b393952852bb63aa903f4485e0ef02f70735f5e50efff213c` |
| Spanish | `es` | 68 | `073334261cc2e7c08339faefd2f19f9623e8240a0ac18fe2a26c368b897496ce` |
| Russian | `ru` | 151 | `2598adabd2b761733d72a68d8ee4fcc1d2c38f2f85b6ff489985c6ce1d93bf75` |

**What CC BY 4.0 asks of us** (section 3(a); the lawyer confirms): keep the creator's name and copyright notice, the licence
notice, a link to the licence and the disclaimer; **indicate that we modified** the material; add no restriction on the
licensed material and no technical measure that stops others exercising the licence. An adaptation (our `hide`/`mask`
tiering, removals on review) is allowed; it is "adapted material" and must say so.

**Notice to carry with any import** (also for the credits screen):

> Word lists adapted from "List of Dirty, Naughty, Obscene, and Otherwise Bad Words", (c) 2012-2020 Shutterstock, Inc.,
> licensed under CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>). Source:
> <https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words> (commit 5faf2ba42d7b). Changes: entries
> were sorted into hide and mask tiers, some were removed on review, and matching is done by the game, not the list.

## 2. dsojevic/profanity-list (English, with severity and tags)

- Upstream: <https://github.com/dsojevic/profanity-list>
- Pinned commit: `c27924319aa9bd6f917e3782b4f4b6604a50b652` (`main`, 16 Nov 2026)
- Licence: **MIT**, "Copyright (c) 2021 David Sojevic". English only (434 entries); each entry has a `severity` (1 mild to 4
  severe) and `tags` (`general`, `lgbtq`, `racial`, `religious`, `sexual`, `shock`). `en.json` sha256
  `bcf8bfc09dd3f7480972cb041a4cba291a6ff16a6fbf29022d5d679e3c39502c`.
- Its own README warns that most entries "started their life with a Severity Level of 3 (Strong) prior to any solid
  classification", so the severity is not a trustworthy tier on its own; the tags are used instead (see the proposal).
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
