# Release notes: drafting `next.json` (GH-1622)

Each release on `main` publishes player-facing notes in two places: the in-game panel and the GitHub release. They are
drafted on `dev` in `data/release-notes/next.json` before each promotion. **The lead approves the wording inside the
promotion PR** (its diff shows the file, and its body has a "Release notes" line with the counts). An agent drafts it
and never approves it.

## The file

```json
{
  "version": "next",
  "units": ["The Namer carrier joins the KDF camp menu."],
  "rules": ["Smoke now blocks sight for 30 seconds after it lands."],
  "fixes": ["Tanks no longer spin on the spot before reversing."]
}
```

- `units`: new units a player can field or meet. Shown under **New units**.
- `rules`: new or changed rules, features, screens and options. Shown under **Rules and features**.
- `fixes`: bugs a player would have noticed. Shown under **Fixes**.
- Each entry is one line of 1 to 160 characters with no leading or trailing space. Any section may be empty, and no
  other key is allowed (`data/schemas/release_notes.schema.json`). If all three are empty, the release says "No
  player-facing changes".
- You only ever edit `next.json`. The release step on `main` renames it to `v<X.Y.Z>.json`, rewrites its `"version"`,
  writes a fresh empty `next.json` in the same bump commit, and publishes the GitHub release from it
  (`tools/ci/release-notes-md.mjs`). Never hand-edit a released `v<X.Y.Z>.json`.

## How to draft it

1. **Start from a `dev` that has `main` merged back in.** The release step empties `next.json` on `main`, not on
   `dev`. If `main` has released since `dev` last merged it, `dev`'s `next.json` still holds the entries that already
   shipped. The promotion PR's line flags any entry that is word for word one from a released file on `main`
   ("N of them already shipped"). Merging `main` into `dev` is the lead's or the steward's step, not yours: if it has
   not happened, say so and draft only what is new.
2. **List what is going out:** `git log --first-parent --format='%h %s' origin/main..origin/dev`. That is one line per
   merged PR, the same range the promotion PR's changelog reads.
3. **Keep only what a player can see or feel:** a new unit, a new or changed rule, a screen or an option, a balance
   change that shows in play, or a bug a player would have hit. Drop docs, specs, tests, CI and tooling, refactors,
   build and hosting work, translations still staged, and anything shipped OFF behind a flag. For a fix, check the PR
   body to see whether it was ever live for players. A regression that never reached `main` is not a fix to them.
4. **Write each entry in plain player English:**
   - say what changed for the player, in game words they already know ("the camp menu", "smoke", "the Garage"), not
     how it was built;
   - one fact per entry, present tense, a full sentence with a full stop;
   - use the unit's display name ("Namer"), never its file id;
   - numbers are fine; write a long one with separators ("1,500,000").
5. **Run `pnpm validate:data`.** Its filter gate (`tools/validate_release_notes.mjs`) names the file, the section, the
   index and the offending word.
6. **Commit `next.json` on its own branch and open a PR to `dev`.** Put "HOLD FOR LEAD: copy" in its title, like any
   other player-facing copy. The lead can reword it there or in the promotion PR.

## Never in an entry

- **Ids, refs or hashes:** no PR or issue number ("PR 1547", "GH-1622", a hash sign and digits), no git hash, no
  snake_case id (`mbt_lavi`, `time_limit_s`, anything with an underscore), no file path, no @handle.
- **Administration, legal, telemetry or sensitive data:** nothing about accounts' storage, analytics, stats pages,
  admin tools, privacy, licences, contributor agreements, passwords, tokens or secrets. This holds even when a change
  touches them: if a player-visible part remains ("You can now delete your account from Profile"), say only that.
- **How the game is built or run:** hosting, the Worker, databases, migrations, CI, workflows, deploys, the people and
  agents who make it.

### The filter gate, and its word-boundary decision

The gate refuses these words, case-insensitive: worker, telemetry, D1, privacy, legal, licence, license, CLA, secret,
password, token, stats, CI, workflow, deploy, wrangler, Cloudflare, migration, admin, steward, agent.

They match **whole words, plus a simple plural** ("-s" or "-es"). A word is a run of letters and digits, so:

- "agents", "workers", "tokens" and "admins" are refused, and so are "agent's" and "CI-only", because an apostrophe
  or a hyphen ends a word;
- "civilians" (CI), "illegal" (legal), "status" (stats), "agency" and "secretly" pass, because the denied word is only
  part of a longer word;
- other inflections are **not** caught: "deployed", "deploying", "licensed", "administration". The gate is a net, not
  the review. Do not write them either.

Some denied words have a game sense. Rephrase rather than fight the gate: "deploy your mortars" becomes "set up your
mortars", "unit stats" becomes "unit figures" or "the unit card", and a "secret objective" becomes a "hidden objective".

It also refuses "PR" or "GH" followed by digits, a hash sign followed by digits, a run of 7 to 40 hex characters with
at least one digit in it (a git hash; "defaced" is hex but has no digit and passes, while "1500000" is refused, so
write "1,500,000"), any underscore, and any "@".

## Good and bad

| Bad | Why | Good |
|---|---|---|
| `app: the lobby seats the computer on 25 of the 31 versus cells, either faction (GH-1390) (PR 1595)` | a commit subject: its prefix, its refs, and "cells" is our word, not the player's | "You can now play the computer on most versus maps, as either side." |
| "Fixed `mbt_lavi` turret slew regression from f9b59a582." | id, hash, and builder's words ("slew", "regression") | "The Lavi's turret turns smoothly again." |
| "Telemetry events now go to D1 through the Worker, and the stats page has an admin login." | telemetry, D1, Worker, stats, admin: nothing a player sees | (nothing: leave it out) |
| "The relay split moves match rooms onto a second worker; agents ran a staging migration." | hosting work, worker, agents, migration | (nothing: leave it out) |
| "Beit Sahwan IV: civilians moved clear of the force, grown to fifteen, with musters." | a design note, with "musters" as jargon | "Beit Sahwan IV: fifteen civilians now gather away from your troops at the start." |

## Where it is checked

- Schema: `data/schemas/release_notes.schema.json`. Filter gate and filename rule: `tools/validate_release_notes.mjs`,
  tested in `tools/src/validate_release_notes.test.ts`. Both run in `pnpm validate:data`.
- The promotion PR line: `notesLine` in `tools/ci/promotion-pr.mjs`, which only counts entries and never quotes them.
- The release step: the `version` job in `.github/workflows/ci.yml`, with `tools/ci/release-notes-md.mjs` (tested in
  `tools/src/ci/release-notes-md.test.ts`).
