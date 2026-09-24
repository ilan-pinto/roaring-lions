// tools/src/ui-review/board-canvases.ts
//
// The verdict for `routes-check.ts`'s deploy-screen leg: does the campaign
// board reached by Escape off the deploy screen carry the same canvases as the
// board reached by leaving a mission the ordinary way?
//
// Extracted from the route walk, which starts a dev server at import, so the
// wording has a seam `pnpm test` can reach without booting Playwright -- the
// same move `outcome-guard.ts` made for `shoot.ts`.
//
// Why it exists. The inline check this replaces read the board the moment
// `.rl-world` was in the DOM, but the diorama's canvas is not: it is appended
// by `mountWorldView` only after a dynamic import and a ~3.8 MiB Draco GLB
// have loaded -- 190-363 ms later, measured locally after an Escape. Its
// reference was read 1200 ms after the ordinary leave and always saw the
// canvas; this leg was read ~300 ms after the Escape and sometimes did not.
// Across 34 timed CI reads of this leg, the three that landed 299-327 ms after
// the navigation read 0 and all 31 at 377 ms or later read 1 -- a race, and
// main lost it (830f86c7) as well as PR #212. The inline message then called
// that 0 "an abandoned boot's renderer was never disposed" -- the one
// explanation a count BELOW the reference cannot have. A leaked renderer ADDS
// a canvas; a count that falls short is a board that has not drawn yet, or
// drew the flat fallback.
//
// So the route walk now waits for each board to settle before it counts, and
// this names which of the three failures it saw.

/** One campaign board, as the route walk read it. */
export interface BoardReading {
  /** Every `<canvas>` in the document at the moment of the read. */
  readonly canvases: number;
  /** `.rl-world`'s own `data-board` -- `'diorama'` or `'flat'`, written by
   *  `worldmap3d.ts` on both paths -- or `null` with no board at all. */
  readonly board: string | null;
  /** Whether the board had reached its own verdict before the read: the
   *  diorama's canvas in `.rl-world__canvas`, or `data-board="flat"`. */
  readonly settled: boolean;
}

const summary = (r: BoardReading): string => `data-board=${String(r.board)}, ${r.canvases} canvas(es)`;

/**
 * `null` when the board reached from the deploy screen matches the one
 * reached by an ordinary leave; otherwise a failure line that says which way
 * they differ, because the two directions have opposite causes.
 */
export function boardCanvasVerdict(fromDeploy: BoardReading, ordinary: BoardReading): string | null {
  if (!ordinary.settled) {
    return (
      `the campaign board reached by an ordinary leave never settled (${summary(ordinary)}) -- ` +
      `neither the diorama's canvas nor the flat fallback arrived, so the deploy-screen leg has no reference`
    );
  }
  if (!fromDeploy.settled) {
    return (
      `the campaign board reached from the deploy screen never settled (${summary(fromDeploy)}) -- ` +
      `neither the diorama's canvas nor the flat fallback arrived`
    );
  }
  if (fromDeploy.canvases > ordinary.canvases) {
    return (
      `leaving from the deploy screen left ${fromDeploy.canvases} canvas(es) on the settled campaign board, ` +
      `against ${ordinary.canvases} after an ordinary leave -- an abandoned boot's canvas is still in the ` +
      `document (its renderer was never disposed, or its canvas never removed)`
    );
  }
  if (fromDeploy.canvases < ordinary.canvases || fromDeploy.board !== ordinary.board) {
    return (
      `the campaign board reached from the deploy screen drew ${summary(fromDeploy)}, against ` +
      `${summary(ordinary)} after an ordinary leave -- the board drew differently, which is not a leak`
    );
  }
  return null;
}
