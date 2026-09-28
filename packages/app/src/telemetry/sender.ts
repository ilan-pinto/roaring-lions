import type { TelemetryEvent } from '@lions/data/telemetry';

export interface Transport {
  /** Fire-and-forget POST. Must not throw and must not be awaited by the caller. */
  post(body: string): void;
  /** `navigator.sendBeacon`; false when the browser refused to queue it. */
  beacon(body: string): boolean;
}

/** The Worker's own body cap (R-7). A batch never builds a body past this many
 *  bytes -- an event bigger than the cap on its own still goes, alone, rather
 *  than being silently dropped. */
export const SENDER_MAX_BYTES = 48 * 1024;

/** An in-memory queue flushed in batches. A failed batch is dropped, never
 *  retried in a loop: telemetry must never cost the game anything (spec §2). */
export class Sender {
  private queue: TelemetryEvent[] = [];

  constructor(
    private readonly transport: Transport,
    private readonly maxBatch = 50,
    private readonly maxQueue = 500,
    private readonly maxBytes = SENDER_MAX_BYTES
  ) {}

  get pending(): number {
    return this.queue.length;
  }

  push(e: TelemetryEvent): void {
    this.queue.push(e);
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue);
  }

  flush(useBeacon = false): void {
    while (this.queue.length > 0) {
      const batch: TelemetryEvent[] = [];
      let bytes = '{"events":[]}'.length;
      for (const next of this.queue) {
        const size = JSON.stringify(next).length + (batch.length > 0 ? 1 : 0);
        if (batch.length === this.maxBatch) break;
        // Never close an EMPTY batch: an event bigger than the cap goes alone.
        if (batch.length > 0 && bytes + size > this.maxBytes) break;
        batch.push(next);
        bytes += size;
      }
      // Defensive: a batch that took nothing would spin this loop forever,
      // synchronously, where no test timeout can reach it. Drop the rest
      // instead -- the class comment already allows losing telemetry.
      if (batch.length === 0) {
        this.queue.length = 0;
        break;
      }
      this.queue.splice(0, batch.length);
      const body = JSON.stringify({ events: batch });
      try {
        if (useBeacon && this.transport.beacon(body)) continue;
        this.transport.post(body);
      } catch {
        /* dropped: see the class comment */
      }
    }
  }
}

export function browserTransport(url: string): Transport {
  return {
    post: (body) => {
      void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(
        () => undefined
      );
    },
    // `text/plain`, not `application/json`: a non-simple content-type on a
    // beacon triggers a CORS preflight, which sendBeacon cannot wait for and
    // the browser instead just drops. The Worker reads the body with
    // `req.text()` and parses it itself either way (ingest.ts).
    beacon: (body) => navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' })),
  };
}
