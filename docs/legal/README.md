**DRAFT for the lead and his lawyer. Not legal advice.**

# Legal pack (GH-1417)

Everything in this folder was written by an AI coding assistant from the contents of this repository. No lawyer has read it. None of it is in force. Nothing here is wired into the game, the Worker or a store page. The lead decides what goes to the lawyer. The lawyer decides what is true in law.

Second version: 18 Nov 2026, from `origin/dev` `e1845a77e`. The first was PR 1475 (15 Nov). This version catches up with what has landed or opened since: the chat safety work (PRs 1476, 1479, 1484, 1488, 1490 merged; 1492 and 1502 open), the private privacy form (PR 1481, open) and the coins-for-cosmetics switch (PR 1565, closed unmerged on 18 Nov, when the lead ruled that coins buy units; the coin clauses follow that ruling and the same day's ruling that coin-bought units work everywhere, PvP included).

| File | What it is |
|---|---|
| `terms-of-use-draft.md` | Terms for the hosted web game: the free game, the optional Google account, Roar coins, versus and chat, conduct, feedback, the code and art licences, "as is", ending, changes, contact. Each clause names the file it rests on. 20 open questions at the end. |
| `age-rating-questionnaire-draft.md` | IARC-style answers prepared from the game's actual content, as question/answer tables with a "source in repo" column and a certainty mark. Every uncertain answer is listed again in its section 10. |
| `privacy-contact-paragraph.md` | The privacy and security contact wording, copied from PR 1481 (and PR 1502 for chat reports), the exact names and routes, the lead's rulings C1 to C5, and 7 open questions. It replaces `privacy-contact-proposal.md`. |

## How to read the citations

- A path, or a path and a symbol, is the file an answer comes from, at `e1845a77e`.
- **Open PR n** means the fact is true only once that pull request merges. Re-check it then.
- **(not verified)**, **CHECKED** or **UNCERTAIN** means I looked and could not settle it. That is weaker than a proof.
- **PLAN** (age-rating draft) marks an answer that rests on a lead ruling not yet built, such as paid coins; it is true of the game only once it ships.
- Word searches read `packages/app/src/i18n/en.json` and `data/locales/en/*.json`.

## What is deliberately blank

Brackets `[LIKE THIS]` belong to the lead or the lawyer: the operator's legal name and address, the game address at launch, governing law, the age floor per market, liability, a general contact. No placeholder may ever be committed into the Worker's privacy page: `packages/worker/src/privacy-page.ts` answers 503 unless the contact and the age are real, and it refuses text containing `TBD`, `TODO`, `<lead>` or `example`.

## Re-check this pack when

- PRs 1481, 1492 or 1502 merge, or change their wording;
- `PURCHASES_OPEN` is flipped (the lead ruled on 18 Nov 2026 that coin-bought units work everywhere, PvP included, and that standard-kit rooms stay equal; terms Q20), or the code that decides which rooms field owned kit changes;
- ragdolls are switched on in a quality preset;
- public rooms or matchmaking open (lead ruling D10);
- avatar uploads are served;
- a store build (Steam, GH-200) exists, which brings its own content survey.
