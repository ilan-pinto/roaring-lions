// A lazy route chunk that fails to load (a dropped connection, or a stale chunk after a deploy) is retried ONCE and then
// reported as a `ChunkLoadError`, which the router turns into the shell's error card instead of a blank stage. The retry
// cannot always help -- a browser may remember a failed module fetch, and a chunk a deploy removed is gone -- which is why
// the card's way out is a reload.

/** Wait before the one retry: long enough for a dropped connection to come back, short enough not to look stuck. */
export const CHUNK_RETRY_DELAY_MS = 400;

/** A route chunk that failed twice. `reason` is the second failure, whatever the loader threw. */
export class ChunkLoadError extends Error {
  readonly reason: unknown;
  constructor(reason: unknown) {
    super('a route chunk failed to load');
    this.name = 'ChunkLoadError';
    this.reason = reason;
  }
}

/** Run a dynamic import, retrying once after `delayMs`. A second failure throws `ChunkLoadError`; a success returns the module. */
export async function importWithRetry<T>(load: () => Promise<T>, delayMs: number = CHUNK_RETRY_DELAY_MS): Promise<T> {
  try {
    return await load();
  } catch {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    try {
      return await load();
    } catch (second) {
      throw new ChunkLoadError(second);
    }
  }
}
