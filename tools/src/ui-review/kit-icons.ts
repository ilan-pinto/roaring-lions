// The reference-free verdict `routes-check.ts`'s K1-K6 legs drive (WP-S3g plan
// 2b, Task 7): every rule the kit sign on a unit's icon must satisfy, held here
// as data and a pure function, so each rule can be falsified without a
// browser -- the golden picture answers "does it look right"; this answers
// "is the DOM actually built the way the spec says", off a plain rectangle
// read, on any surface the sign appears on: the selection chip, the unit
// card, the dock tile and the garage rail.
//
// `kit-sign.ts` draws every sign the SAME markup regardless of surface
// (`kitIconSignHtml`/`withKitSign` take no `surface` argument -- a review
// round on Task 3 reverted that, precisely so a call site cannot silently
// pick the wrong size). What differs per surface is CSS alone: the chip's art
// is followed by its sign inside `.rl-kit-host`, and `theme.css` sizes that
// one pairing up to `KIT_ICON_SIGN.chip`; the card frame, the dock tile and
// the garage rail all draw at the base `.rl-kit-icon svg` rule,
// `KIT_ICON_SIGN.small`. Since the lead's "Bigger stars" (2026-09-27, after
// G-P3) the sign is NOT square: its height is one Star of David (0.625rem on
// the chip, 0.5rem elsewhere) and its width is `kitSignAspect(level)` times
// that -- the row of stars grows leftward from the top-right corner.
// Corner placement is the other per-surface fact: the card frame and the
// dock tile are already positioned elements with their own 1px border, so
// their sign steps in by that border plus the corner margin their own mark
// uses (`SIGN_INSET`); the chip and the rail have no border to step past.
import { KIT_ICON_SIGN, kitSignAspect } from '../../../packages/app/src/ui/kit-sign';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One icon read off the live DOM. `sign` is `null` when the sign is absent
 *  or not drawn (`display: none` reads as width 0, per a locked tile).
 *  `icon` is the chip or rail host, or the art when unkitted, or the card
 *  frame, or the tile -- whatever box the sign's corner is measured against. */
export interface IconRead {
  readonly surface: 'chip' | 'card' | 'tile' | 'rail';
  readonly type: string;
  readonly kit: string | null;
  readonly sign: Rect | null;
  readonly icon: Rect;
  readonly locked?: boolean;
}

/** The corner inset each surface's sign steps in by, in rem plus a flat
 *  border pixel -- `theme.css`'s own `.rl-card__frame > .rl-kit-icon` and
 *  `.rl-tile > .rl-kit-icon` rules. The chip and the rail sit inside a bare
 *  `.rl-kit-host` with no border of its own, so both are zero. */
export const SIGN_INSET: Readonly<Record<IconRead['surface'], { rem: number; px: number }>> = {
  chip: { rem: 0, px: 0 },
  rail: { rem: 0, px: 0 },
  card: { rem: 0.1875, px: 1 },
  tile: { rem: 0.125, px: 1 },
};

/** The sign's HEIGHT per surface (one star), in rem -- `KIT_ICON_SIGN.chip` on the
 *  selection chip alone (`.rl-chip__art + .rl-kit-icon svg`), and
 *  `KIT_ICON_SIGN.small` on the card, the tile and the rail, which draw at
 *  the base `.rl-kit-icon svg` rule with no size class of their own. */
const SIGN_REM: Readonly<Record<IconRead['surface'], number>> = {
  chip: KIT_ICON_SIGN.chip.rem,
  card: KIT_ICON_SIGN.small.rem,
  tile: KIT_ICON_SIGN.small.rem,
  rail: KIT_ICON_SIGN.small.rem,
};

function near(a: number, b: number, tolerance = 1): boolean {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Every failure in words, `[]` when all is well, and `['no icons were read']`
 * on an empty read -- a check that silently passes because it found nothing
 * to check is worse than one that fails loudly.
 *
 * One read, one failure at most: presence, then level, then size, then
 * corner, in that order, so a wrong level never also complains about a size
 * it never got to compare.
 */
export function kitIconFailures(
  reads: readonly IconRead[],
  expected: Readonly<Record<string, number>>,
  rootPx: number
): string[] {
  if (reads.length === 0) return ['no icons were read'];

  const out: string[] = [];
  for (const read of reads) {
    const { surface, type, kit, sign, icon, locked } = read;
    const label = `${surface} ${type}`;
    const want = locked === true ? 0 : (expected[type] ?? 0);

    if (want === 0) {
      if (sign !== null) out.push(`${label}: a sign drawn, want none`);
      continue;
    }
    if (sign === null) {
      out.push(`${label}: no sign, want kit ${want}`);
      continue;
    }

    const gotLevel = kit === null ? null : Number(kit);
    if (gotLevel !== want) {
      out.push(`${label}: kit ${kit ?? 'null'}, want ${want}`);
      continue;
    }

    const wantH = SIGN_REM[surface] * rootPx;
    const wantW = wantH * kitSignAspect(want as 1 | 2 | 3);
    if (!near(sign.w, wantW) || !near(sign.h, wantH)) {
      out.push(
        `${label}: sign ${sign.w}x${sign.h} px, want ${wantW.toFixed(1)}x${wantH.toFixed(1)} ` +
          `(${want} star(s), ${SIGN_REM[surface]}rem tall at ${rootPx} px)`
      );
      continue;
    }

    const inset = SIGN_INSET[surface].rem * rootPx + SIGN_INSET[surface].px;
    const wantX = icon.x + icon.w - inset;
    const wantY = icon.y + inset;
    const gotX = sign.x + sign.w;
    const gotY = sign.y;
    if (!near(gotX, wantX) || !near(gotY, wantY)) {
      out.push(
        `${label}: sign top-right at (${Math.round(gotX)},${Math.round(gotY)}), ` +
          `want (${Math.round(wantX)},${Math.round(wantY)})`
      );
    }
  }
  return out;
}
