export type TesterLinkResult = { ok: true; url: string } | { ok: false; reason: string };

/** The exact refusal text `testerLink` returns for an invalid name. The
 *  function carries its own copy of this literal rather than reading this
 *  constant, for the same self-containment reason the pattern below is a
 *  literal too -- `tester-link.test.ts` pins the two equal so they cannot
 *  drift apart. Exported so a caller can assert against it without
 *  hand-copying the string a second time. */
export const TESTER_NAME_REFUSAL = 'Tester names may only use letters, digits, and _ . - (up to 32 characters).';

/**
 * Pure link builder for "Share with a tester" (issue #230): `<origin>/?tester=<name>`,
 * nothing more -- no `?telemetry`, since telemetry is on by default on the deployed
 * host and that param would read as a dev flag in a player's URL. `identity.ts`
 * reads `?tester=` once and then persists it to the browser's own storage
 * (`TESTER_KEY`), so the link labels whichever BROWSER opens it, permanently,
 * not just for one visit -- send each tester their own link.
 *
 * This function reads NOTHING from outside its own parameters and literals --
 * on purpose, and the name pattern below is a MIRROR of `@lions/data/telemetry`'s
 * `TESTER_PATTERN`, not an import of it, even though `@lions/worker` already
 * depends on that package (`ingest.ts` imports it). `stats-page.ts` serialises
 * this whole function with `.toString()` into the `/stats` page's inline
 * `<script>`, so the browser runs the SAME logic instead of a hand-kept second
 * copy -- and that only works if lifting the function out of this module loses
 * nothing. It does not survive closing over an import: tried first, and
 * falsified by hand -- under this repo's own test runner (vitest/vite-node),
 * a function that reads an imported `TESTER_PATTERN` has that reference
 * rewritten to a `__vite_ssr_import_0__.TESTER_PATTERN`-style namespace access
 * before `.toString()` ever sees it, so the serialised copy throws
 * `ReferenceError: __vite_ssr_import_0__ is not defined` the moment it runs
 * anywhere else -- and nothing about a bundler's import-lowering is proof
 * against the same failure shape in the real deployed Worker. A function with
 * only parameters and literals in its body has no such risk in any bundler.
 * `tester-link.test.ts` pins the mirrored pattern and refusal text below
 * character-for-character against the real `TESTER_PATTERN` and proves the
 * serialised function still works once lifted out with zero free variables
 * supplied -- so a future edit that drifts the mirror, or that reaches back
 * into an import, fails a test instead of silently breaking the page copy.
 */
export function testerLink(origin: string, name: string): TesterLinkResult {
  if (!/^[A-Za-z0-9_.-]{1,32}$/.test(name)) {
    return { ok: false, reason: 'Tester names may only use letters, digits, and _ . - (up to 32 characters).' };
  }
  const base = origin.replace(/\/+$/, '');
  return { ok: true, url: `${base}/?tester=${encodeURIComponent(name)}` };
}
