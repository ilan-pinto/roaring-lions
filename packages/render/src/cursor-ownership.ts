/**
 * Who owns the canvas's `cursor` property.
 *
 * Two systems want it. The app publishes one CSS rule per contextual cursor
 * (`canvas[data-cursor='move-armour']`, from `vite-plugin-cursors.ts`) and sets
 * `canvas.dataset.cursor` as the pointer moves. PixiJS's `EventSystem` also
 * considers it its own: `cursorStyles.default` ships as the string `'inherit'`,
 * and `setCursor` assigns it to `domElement.style.cursor` the first time the
 * pointer interacts with the canvas.
 *
 * An inline style outranks a stylesheet rule, so Pixi wins, and every one of
 * the twenty-seven cursors resolves to `auto` from that first click until the
 * page is reloaded. The logic stayed right the whole time -- the attribute is
 * still set, the rule still matches, the image still decodes -- which is why
 * `__lions.cursorKey()` reports the correct name while the player sees an
 * arrow, and why both cursor test suites stayed green.
 *
 * The fix is to make Pixi decline to write, rather than to fight it by
 * reasserting our own value after every event.
 */

/** The shape of `renderer.events` this needs, so a test need not build a Pixi
 *  application to describe one. */
export interface CursorOwner {
  cursorStyles: Record<string, unknown>;
}

/**
 * Hand the canvas's cursor to CSS.
 *
 * `setCursor` reads `cursorStyles[mode]`; a falsy entry falls through to a
 * branch that writes `mode` literally, but ONLY when the key is absent:
 *
 * ```js
 * const style = this.cursorStyles[mode];
 * if (style) { ...assign... }
 * else if (applyStyles && typeof mode === 'string'
 *          && !Object.prototype.hasOwnProperty.call(this.cursorStyles, mode)) {
 *   this.domElement.style.cursor = mode;
 * }
 * ```
 *
 * So the entries must be PRESENT and FALSY. `delete cursorStyles.default`
 * would take the `hasOwnProperty` guard false and make Pixi write the literal
 * string `'default'` -- worse than the `'inherit'` it replaced, because
 * `'default'` is a valid cursor keyword and would pin the arrow rather than
 * merely inherit one.
 *
 * `pointer` gets the same treatment: it is `'pointer'` out of the box, so any
 * interactive display object would take the cursor back the moment one is
 * hovered.
 */
export function releaseCursorToCss(owner: CursorOwner): void {
  for (const mode of Object.keys(owner.cursorStyles)) {
    owner.cursorStyles[mode] = undefined;
  }
}
