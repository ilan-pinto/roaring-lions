/**
 * The ONE colour every order's ground route and order marker draw in, as a
 * `data/palette.json` key: tracer lime, whatever the order (VR-33, the lead's
 * "lime everywhere" ruling on PR 457). Cyan and the attack-move red were tried
 * on the ground and read too faint on sand, so the ground keeps the lime it
 * always had and the MOVE cursor took the same key instead
 * (`packages/app/src/ui/order-sight.ts`'s `ORDER_FAMILY_COLOR_KEY.manoeuvre`;
 * `order-sight.test.ts` holds the two equal).
 *
 * Zero imports, so the barrel can export it without pulling three.js in, the
 * way `QUALITY_PRESETS` and `unitIsObserved` are.
 */
export const ORDER_GROUND_COLOR_KEY = 'vfx.tracer';
