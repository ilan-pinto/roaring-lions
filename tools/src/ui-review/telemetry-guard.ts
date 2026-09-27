// The off switch, proved by the run (GH-254).
//
// `telemetryEnabled` keeps every dev and CI run silent, and a unit test proves
// the function. What no unit test proves is that nothing else in the app ever
// reaches the Sender behind it. `pnpm ui:routes` walks the real app end to end,
// so it attaches `watchTelemetry` to every browser context it opens and fails
// if a single request goes to the ingest path.
//
// The match is on the URL's PATHNAME ending `/api/events`, on any host and
// under any base, so a request with a query still counts, while a lookalike
// does not: Vite itself serves `/src/telemetry/events.ts` in dev.

const INGEST = /\/api\/events$/;

/** True for a request to the telemetry ingest endpoint on any origin. */
export function isTelemetryRequest(url: string): boolean {
  try {
    return INGEST.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

const watched = new WeakSet<object>();

/** Record into `sink` the URL of every telemetry request `target` makes. A
 *  Playwright `BrowserContext` fits the shape, and sees the requests of every
 *  page it owns, workers included.
 *
 *  Idempotent per target: `routes-check.ts` watches the first page's context
 *  explicitly AND through its `newContext` wrapper, because Playwright 1.62's
 *  `Browser.newPage` happens to call `this.newContext` (read in its bundle) and
 *  a later version need not. Watching twice must not count a request twice. */
export function watchTelemetry(
  target: { on(ev: 'request', fn: (r: { url(): string }) => void): unknown },
  sink: string[],
): void {
  if (watched.has(target)) return;
  watched.add(target);
  target.on('request', (r) => {
    const url = r.url();
    if (isTelemetryRequest(url)) sink.push(url);
  });
}
