/**
 * Who a side is to the person looking (network design §5.1). Every place that
 * used to read "side 0 is the player" asks this instead, so the seat on side 1
 * sees its own force as friendly. Side 2 is civilians for every viewer.
 * Zero imports: the app's HUD and minimap call it too.
 */
export type Relation = 'own' | 'hostile' | 'neutral';

export function relationOf(side: number, viewer: number): Relation {
  if (side === 2) return 'neutral';
  return side === viewer ? 'own' : 'hostile';
}
export function isOwnSide(side: number, viewer: number): boolean {
  return side !== 2 && side === viewer;
}
export function isHostileSide(side: number, viewer: number): boolean {
  return side !== 2 && side !== viewer;
}
/** The colour slot a side draws in for this viewer: 0 friendly, 1 hostile, 2 civilian. */
export function colorSlot(side: number, viewer: number): 0 | 1 | 2 {
  const r = relationOf(side, viewer);
  return r === 'own' ? 0 : r === 'hostile' ? 1 : 2;
}
