import type { TelemetryEvent } from '@lions/data/telemetry';

export interface Transport {
  /** Fire-and-forget POST. Must not throw and must not be awaited by the caller. */
  post(body: string): void;
  /** `navigator.sendBeacon`; false when the browser refused to queue it. */
  beacon(body: string): boolean;
}

/** An in-memory queue flushed in batches. A failed batch is dropped, never
 *  retried in a loop: telemetry must never cost the game anything (spec §2). */
export class Sender {
  private queue: TelemetryEvent[] = [];

  constructor(
    private readonly transport: Transport,
    private readonly maxBatch = 50,
    private readonly maxQueue = 500
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
      const batch = this.queue.splice(0, this.maxBatch);
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
    beacon: (body) => navigator.sendBeacon(url, new Blob([body], { type: 'application/json' })),
  };
}
