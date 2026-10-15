// Strip inline source maps out of the scripts the dev server serves, before
// the page ever sees them -- `pnpm perf:memory`'s default since #611's
// follow-up (see docs/PERFORMANCE.md, "The CI gate").
//
// Why: the memory gate measures the DEV server, and under vite 8 every module
// it serves ends in `//# sourceMappingURL=data:application/json;base64,...`.
// The page keeps each script's source text alive for as long as the module
// is, so those maps sat in the JS heap the gate judges: 14.0 of the menu's
// 77 MiB on Metal (#611), dev-only payload no player downloads. They raised
// every JS ceiling with them, and -- worse -- the first-menu baseline the leak
// percentage is taken of, so "+20%" stopped resolving an ~11 MiB leak and
// started letting ~15 MiB through.
//
// Pure, so `strip-inline-maps.test.ts` can drive it without a browser.

/** A `//# sourceMappingURL=data:...` line (JS) or a
 *  `/*# sourceMappingURL=data:... *\/` block (CSS served as a module), with
 *  the newline in front of it -- at the END of the file only, which is where
 *  every tool puts one. Anchoring there is what keeps a module that merely
 *  CONTAINS the text (a library that builds maps, a string in a test helper)
 *  from being cut mid-expression. Only `data:` URLs: a map in its own file
 *  costs the page nothing unless devtools fetch it, and is left alone. `@` is
 *  the pre-2013 spelling some tools still emit. */
const TRAILING_MAP = /(?:\r?\n)?(?:\/\/[#@][ \t]*sourceMappingURL=data:[^\r\n]*|\/\*[#@][ \t]*sourceMappingURL=data:[^*]*\*\/)\s*$/;

export interface Stripped {
  text: string;
  /** UTF-16 code units removed -- for the page, the characters it will not
   *  keep (a base64 map is ASCII, so this is also its byte count). */
  removed: number;
  /** How many inline maps were removed. */
  maps: number;
}

export function stripInlineSourceMaps(text: string): Stripped {
  let out = text;
  let maps = 0;
  for (let m = TRAILING_MAP.exec(out); m; m = TRAILING_MAP.exec(out)) {
    out = out.slice(0, m.index);
    maps++;
  }
  return { text: out, removed: text.length - out.length, maps };
}

/** Running totals over a walk, printed at the end and written into the JSON,
 *  so a strip that silently matched nothing is visible -- and refused: see
 *  `memory.ts`. */
export interface StripTally {
  /** Script responses the route looked at. */
  scripts: number;
  /** ...of which carried at least one inline map. */
  withMaps: number;
  maps: number;
  removed: number;
}

export function emptyTally(): StripTally {
  return { scripts: 0, withMaps: 0, maps: 0, removed: 0 };
}

export function addToTally(t: StripTally, s: Stripped): void {
  t.scripts++;
  if (s.maps > 0) t.withMaps++;
  t.maps += s.maps;
  t.removed += s.removed;
}
