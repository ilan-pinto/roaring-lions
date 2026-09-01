/**
 * "Is this entity drawn this frame?" -- the ONE fog-of-war gate every unit
 * draw path in this backend shares.
 *
 * Before this module there were three copies of it, one per draw path, each
 * spelled `st.side[i] === 0 || this.isVisible(wx, wy)` in a different method
 * of `ThreeRenderer` (`updateUnits`'s `continue`, `updateMeshUnits`'s
 * `entity.root.visible = ...`, `updateVehicleMeshes`'s identical line). Three
 * copies agreeing today is not three copies staying in agreement, and the
 * occlusion-silhouette task made the risk concrete: a silhouette is a SECOND
 * drawing of a unit's body, and a silhouette that re-derived "may I draw
 * this?" independently would be x-ray vision through fog the first time the
 * two spellings drifted -- a strictly worse bug than the occlusion it fixes.
 *
 * So the rule lives here once, and the silhouette does not get its own copy:
 * it hangs off the result of THIS function, at the same call sites the body
 * does. `silhouette.ts`'s own top comment explains the second half of that
 * guarantee (the silhouette is a CHILD of the body's own `Object3D`, or
 * shares the body's own instance buffers, so three.js's traversal cannot
 * reach one without the other).
 *
 * Pure, and deliberately free of `Sim`, `THREE` and `ThreeRenderer` -- fog is
 * injected as a predicate so this is testable in `environment: 'node'`, the
 * same split `frame-state.ts` and `pick.ts` already draw.
 */

/**
 * True when `side`'s unit at interpolated world position (`wx`, `wy`) may be
 * drawn this frame.
 *
 * Side 0 -- the player's own -- is unconditional, matching
 * `PixiRenderer`'s own unit loop (`renderer.ts:1930-1934`, "Anyone who isn't
 * ours is only drawn while actually observed -- fog hides them, and losing
 * sight loses the contact") and `entityFrame`'s own `contactLevel`
 * short-circuit for side 0. Everything else defers to real fog of war.
 *
 * `wx`/`wy` are the INTERPOLATED position -- this frame's actual screen
 * position, not last tick's raw `curX`/`curY`. Both Pixi and this backend
 * already computed it that way before their own visibility check; passing
 * the tick position instead would let a unit's body and its fog gate
 * disagree by up to one tick of travel at a fog boundary.
 */
export function unitIsObserved(
  side: number,
  wx: number,
  wy: number,
  fogVisible: (wx: number, wy: number) => boolean
): boolean {
  return side === 0 || fogVisible(wx, wy);
}
