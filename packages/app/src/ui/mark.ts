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

/** The full menu lockup: mark, name, rule, and the formation it belongs to. */
export function wordmark(version: string): string {
  return (
    `<div class="rl-wordmark">` +
    markSvg(86, 52, 'rl-wordmark__mark') +
    `<h1 class="rl-wordmark__name">Roaring Lions</h1>` +
    `<div class="rl-wordmark__rule"></div>` +
    `<div class="rl-wordmark__unit">401<span>st</span> Ari'im Brigade` +
    (version ? ` · V ${version}` : '') +
    `</div>` +
    `</div>`
  );
}
