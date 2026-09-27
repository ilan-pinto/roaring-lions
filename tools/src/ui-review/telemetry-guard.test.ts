import { describe, expect, it } from 'vitest';
import { isTelemetryRequest, watchTelemetry } from './telemetry-guard';

describe('isTelemetryRequest (GH-254: the off switch, proved by the run)', () => {
  it('matches the ingest path on any origin and base', () => {
    expect(isTelemetryRequest('http://localhost:5211/api/events')).toBe(true);
    expect(isTelemetryRequest('http://localhost:5211/roaring-lions/api/events?x=1')).toBe(true);
  });
  it('does not match lookalikes', () => {
    expect(isTelemetryRequest('http://localhost:5211/api/events.json')).toBe(false);
    expect(isTelemetryRequest('http://localhost:5211/src/telemetry/events.ts')).toBe(false);
    expect(isTelemetryRequest('not a url')).toBe(false);
  });
});

describe('watchTelemetry', () => {
  it('records only telemetry requests from whatever it is attached to', () => {
    const handlers: ((r: { url(): string }) => void)[] = [];
    const sink: string[] = [];
    watchTelemetry({ on: (_ev, fn) => handlers.push(fn) }, sink);
    for (const u of ['http://h/api/events', 'http://h/assets/a.png']) for (const h of handlers) h({ url: () => u });
    expect(sink).toEqual(['http://h/api/events']);
  });

  it('counts a request once when the same target is watched twice', () => {
    const handlers: ((r: { url(): string }) => void)[] = [];
    const target = { on: (_ev: 'request', fn: (r: { url(): string }) => void) => handlers.push(fn) };
    const sink: string[] = [];
    watchTelemetry(target, sink);
    watchTelemetry(target, sink);
    for (const h of handlers) h({ url: () => 'http://h/api/events' });
    expect(sink).toEqual(['http://h/api/events']);
  });
});
