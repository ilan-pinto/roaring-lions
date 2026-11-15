# Legal pack: drafts for the lead's lawyer (GH-1417)

**DRAFT. NOT LEGAL ADVICE.** Everything in this folder was written by an AI coding assistant from the contents of this repository. None of it has been read by a lawyer, none is in force, and nothing here is wired into the game, the Worker or any store page. The lead decides what to send on; the lawyer decides what is true in law.

| File | What it is |
|---|---|
| `terms-of-use-draft.md` | A draft of the terms for the hosted game: the site, accounts, Roar coins, versus rooms, feedback. Each clause carries the repo fact it rests on. |
| `privacy-contact-proposal.md` | A proposal for the role address that replaces today's GitHub-issue contact on `/privacy`, and the one-line code change it would need. |
| `age-rating-questionnaire-draft.md` | Pre-filled answers to the usual age-rating questions (IARC-style themes), derived from the game's actual content, each with the repo fact behind it and a confidence mark. |

## How to read the citations

Every answer names the file it comes from, as `path` or `path` + a symbol. Citations are to the tree at the commit this folder was written on (15 Nov 2026, branch of `main` v0.133.10). A fact marked **(not verified)** means I looked for evidence and did not find it, which is weaker than finding that it is absent.

## What is deliberately left blank

Bracketed fields `[LIKE THIS]` are the lead's or the lawyer's: the legal name of the operator, the governing law, the jurisdiction, the real contact addresses, the age rating a board actually assigns. No placeholder is ever to be committed into the Worker's privacy page: `packages/worker/src/privacy-page.ts` fails closed (it answers 503) until both the contact and the minimum age are real, and its validator rejects text containing `TBD`, `TODO`, `<lead>` or `example`.

## Questions this pack cannot answer (for the lawyer)

1. **Who is the operator** (the contracting party in the terms, the controller in the privacy page)? The repository names `ilan-pinto` and a `workers.dev` address only.
2. **Minimum age.** The privacy page says 16 to sign in (`PRIVACY_MIN_AGE`), a number the lead set. Is 16 right for every storefront and jurisdiction the game will be sold in, and what must the terms say about guests under 16 (a guest creates no account)?
3. **Virtual currency law.** Roar coins are free today (`PURCHASES_OPEN` is false). When Steam opens paid coins, which consumer-protection, tax and refund rules apply, and does Steam's own subscriber agreement already cover the terms of sale?
4. **The story's real-world reference.** The lead's structural reference for the opening mission is a real event, transposed entirely into a fictional setting (`docs/campaign/storyline.md`, D12; `docs/GDD.md` section 2). Does that reference need anything in the terms or on the store page, and how should it be answered where a rating form asks whether content is based on real events?
5. **Open-source and commercial interplay.** Code is PolyForm Noncommercial 1.0.0 with a CLA and a DCO sign-off; art and data are all rights reserved (`LICENSE`, `CONTRIBUTING.md`, `data/LICENSE.md`). Do the terms need to say how the hosted game relates to the source-available repository?
6. **Multiplayer conduct.** Versus has text chat and player-chosen names and no report, mute or word filter that I could find. What duties does that create, and is a reporting route needed before launch?
