const KEY = 'lions.versus.player';
let sessionOnly: string | null = null;

/** The anonymous player id a seat ticket carries (network design §4). Its own
 *  key, so the telemetry opt-out stays honest. ST5 replaces it with a
 *  Steam-validated id in the same ticket field. A blocked or full store still
 *  yields an id, the same one for the rest of the page. */
export function playerId(
  store: Pick<Storage, 'getItem' | 'setItem'> | null,
  mint: () => string = () => crypto.randomUUID()
): string {
  try {
    const have = store?.getItem(KEY);
    if (have) return have;
    const id = mint();
    if (store === null) throw new Error('no store');
    store.setItem(KEY, id);
    return id;
  } catch {
    sessionOnly ??= mint();
    return sessionOnly;
  }
}
