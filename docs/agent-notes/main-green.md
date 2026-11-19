# Holding main green (GH-1409)

`main` is production and moves only by the weekly promotion PR from `dev` (CONTRIBUTING.md, "The pipeline"). A promotion lands on whatever `main`
already is, so `main` must be green before it moves again. This is the whole rule; the rest is how it is reported.

## The rule

- **A red `ci` run on `main` is fixed before the next promotion is merged.** The fix is an ordinary PR into `dev` (or a revert of the change that
  broke it), then a promotion that carries it. Nothing lands on `main` any other way.
- **Report, not gate.** Nothing in CI blocks the merge button. The lead reads the report and decides; the line below makes the state impossible to
  miss, and the lead's ruling on blocking merges (if any) is theirs to write down here.

## The report

1. **The promotion PR's body** (`promotion-pr` workflow, `mainLine` in `tools/ci/promotion-pr.mjs`) carries one line under the dev CI line:
   - `**Main CI:** green.` only when the newest `ci` push run on `main` finished `success`;
   - `**Main CI: NOT GREEN.**` for `failure`, `timed_out`, `cancelled` or a finished run with no conclusion, with the conclusion, the sha and the run link;
   - `**Main CI:** the newest ... is **in_progress** (not finished)` while it runs: wait for it;
   - `**Main CI:** unknown.` when the read failed. Never rounded to green.
   The workflow reads the run with `gh api .../ci.yml/runs?branch=main&event=push&per_page=1`. A promotion PR opened with `GITHUB_TOKEN` has no `ci` run
   of its own (the body says so), so this line, and the dev line above it, are the only CI evidence on the PR.
2. **The share of red runs on `main`**: `npx tsx tools/src/ci/main-red-share.ts [--days=7]` prints one line (red of finished `ci` push runs, target under
   3%). Paste it into the weekly ledger line in `docs/HANDOVER.md`. It reads `gh api`, writes nothing and gates nothing.

## When the line is red

1. Open the run it links and find the first red job. A `version` job that never ran because `gates` or `visual` was red also means **no release was cut**.
2. Look at whether the same tip was green on `dev` (the dev CI line): a red that only happens on `main` is an environment or merge-commit difference
   (the merge commit is the only thing `main` has that `dev` has not run), not a flaky test, until shown otherwise.
3. Fix on `dev`, wait for green there, and let the next promotion carry it. Do not re-run a red `main` run until it is green and call that a fix:
   a rerun that passes is a flake report, to be filed against the test, not a repair.

## Tests

`tools/src/ci/promotion-pr.test.ts` (`mainLine`, the body order, the CLI with and without `--ci`) and a pin that the workflow reads `branch=main`.
