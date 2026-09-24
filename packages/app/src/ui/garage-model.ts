// The garage's decisions, as pure functions (garage uplift §3.5, §4). The DOM
// layer (`brigade.ts`) asks these and paints the answer.

/** The unit that stays in the bay across a re-render: the same one while it
 *  is still on the roster (F3: a buy used to land the bay on the first card). */
export function retainSelection(prev: string, ids: readonly string[]): string {
  return ids.includes(prev) ? prev : (ids[0] ?? '');
}

/** Where focus goes after a re-render the control with key `asked` caused
 *  (R-4). A Buy's key names its TRACK, so the same key is the next tier's
 *  Buy; when that track is maxed, the track itself; when a unit Buy has done
 *  its job, the first tier Buy the unit now shows; failing all of those, the
 *  unit's own card. */
export function restoreFocus(asked: string | null, present: readonly string[], selectedId: string): string | null {
  if (asked === null) return null;
  const has = (k: string): boolean => present.includes(k);
  if (has(asked)) return asked;
  if (asked.startsWith('buy:')) {
    const track = `track:${asked.slice(4)}`;
    if (has(track)) return track;
  }
  if (asked === 'unit-buy') {
    const firstBuy = present.find((k) => k.startsWith('buy:'));
    if (firstBuy !== undefined) return firstBuy;
  }
  const card = `card:${selectedId}`;
  return has(card) ? card : null;
}
