/** Whether the account client may talk to the server (GH-1075 A1). A4 replaces this with the real switch. */
export function accountsEnabled(query: URLSearchParams): boolean {
  return query.has('accounts') && !query.has('fresh');
}
