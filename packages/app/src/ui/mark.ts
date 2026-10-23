// The mark: three swept chevrons — claw slash and rank insignia at once.
//
// The lion is implied, never illustrated. That is deliberate: a drawn animal
// has to survive being scaled to a 15px glyph in a panel's header band, and a
// mediocre lion at that size is worse than no lion. Pure geometry stays sharp
// at any size, ships as a few hundred bytes of inline SVG, and echoes the
// angular dimetric geometry of the sprites.

/** Chevron path at the shared 86×52 viewBox, swept `x` units from the left. */
function chevron(x: number): string {
  return `M${x} 2 L${x + 12} 2 L${x + 26} 26 L${x + 12} 50 L${x} 50 L${x + 14} 26 Z`;
}

/** The chevron's own lean: 14 across for every 24 up (this function's own
 *  `x + 14, 26` diagonal off the `x, 2` tip). Shared with `kit-sign.ts`'s
 *  plate bevel and `order-sight.ts`'s stadia aim (Q12, 2026-09-28's S3e
 *  symbols pre-flight) -- the one shape in that sheet with no APP-6 frame of
 *  its own to dictate an angle instead. `kit-sign.ts` re-exports this rather
 *  than keeping its own copy, so the family has one sweep, not two that
 *  happen to agree. */
export const CHEVRON_SWEEP = 14 / 24;

/**
 * The mark as inline SVG markup.
 *
 * Colours come from the theme's `--mark-*` tokens rather than attributes, so
 * the mark follows a palette revision like everything else does.
 */
export function markSvg(width: number, height: number, className = ''): string {
  const cls = className ? ` class="${className}"` : '';
  return (
    `<svg${cls} width="${width}" height="${height}" viewBox="0 0 86 52" ` +
    `aria-hidden="true" focusable="false">` +
    `<path d="${chevron(8)}" fill="var(--mark-1)"/>` +
    `<path d="${chevron(31)}" fill="var(--mark-2)"/>` +
    `<path d="${chevron(54)}" fill="var(--mark-3)"/>` +
    `</svg>`
  );
}

/** The full menu lockup: mark, name, rule, and the formation it belongs to.
 *
 *  The game's own name and its brigade's designation are proper nouns, not chrome --
 *  they do not change per locale any more than a studio's own logotype would, so they
 *  are tagged rather than routed through the catalogue. */
export function wordmark(version: string): string {
  return (
    `<div class="rl-wordmark">` +
    markSvg(86, 52, 'rl-wordmark__mark') +
    /* i18n-ok: proper noun */
    `<h1 class="rl-wordmark__name">Roaring Lions</h1>` +
    `<div class="rl-wordmark__rule"></div>` +
    /* i18n-ok: proper noun */
    `<div class="rl-wordmark__unit">401<span>st</span> Ari'im Brigade` +
    (version ? ` · V ${version}` : '') +
    `</div>` +
    `</div>`
  );
}

/**
 * Field works (GH-277): the dock tile's glyph for each buildable type, one
 * `currentColor` SVG on a 16-unit box so the tile's own state colour (ready,
 * dim, armed) paints it. Strokes only, no fill colour, no literal. A type with
 * no drawing here (the militia works are never in the dock) reads as the
 * outpost's, so a tile is never blank.
 */
const WORKS_MARK_BODY: Readonly<Record<string, string>> = {
  // A cross in a ring: aid.
  kdf_medic_station: '<circle cx="8" cy="8" r="6.5"/><path d="M8 4.5v7M4.5 8h7"/>',
  // A sandbag parapet over a doorway: a position held.
  kdf_outpost: '<path d="M2 13.5h12M3 13.5v-4h10v4M5 9.5v-3h6v3M7 6.5V4h2v2.5"/>',
  // A mast with a signal arc each side: a sensor.
  kdf_intel_centre: '<path d="M8 14V6"/><circle cx="8" cy="5" r="1.5"/><path d="M4.5 3a5 5 0 0 0 0 4M11.5 3a5 5 0 0 1 0 4M2.5 1.5a8 8 0 0 0 0 7M13.5 1.5a8 8 0 0 1 0 7"/>',
  // A tent with its flap open: the aid post (no cross, by the art rules).
  kdf_aid_post: '<path d="M2 13.5h12M3 13.5 8 3l5 10.5M6.5 13.5 8 8.5l1.5 5"/>',
  // A spanner: repair.
  kdf_workshop: '<path d="M10.5 2.2a3.3 3.3 0 0 0-3.4 4.4L2.4 11.3a1.4 1.4 0 0 0 2 2l4.7-4.7a3.3 3.3 0 0 0 4.4-3.4l-2 2-1.6-.4-.4-1.6z"/>',
};

export function worksMarkSvg(typeId: string, px: number): string {
  const body = WORKS_MARK_BODY[typeId] ?? WORKS_MARK_BODY['kdf_outpost'];
  return (
    `<svg width="${px}" height="${px}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
    `stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/** The ids that have a drawing of their own, for the test that holds all four. */
export const WORKS_MARK_IDS: readonly string[] = Object.keys(WORKS_MARK_BODY);
