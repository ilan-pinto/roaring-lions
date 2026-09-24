import { describe, it, expect } from 'vitest';
import { telemetryEnabled, type SwitchEnv } from './enabled';

const base: SwitchEnv = { prod: true, hostname: 'roaring-lions.example.workers.dev', query: new URLSearchParams(), gpc: false, dnt: false, optedOut: false };

describe('telemetryEnabled', () => {
  it('is on for a production build on a real host', () => expect(telemetryEnabled(base)).toBe(true));
  it('is off in dev', () => expect(telemetryEnabled({ ...base, prod: false })).toBe(false));
  it.each(['localhost', '127.0.0.1', '[::1]', 'mac.local'])('is off on %s even in a prod build', (hostname) =>
    expect(telemetryEnabled({ ...base, hostname })).toBe(false));
  it('?telemetry forces it on in dev', () =>
    expect(telemetryEnabled({ ...base, prod: false, hostname: 'localhost', query: new URLSearchParams('telemetry') })).toBe(true));
  it.each(['gpc', 'dnt', 'optedOut'] as const)('%s wins over everything, including ?telemetry', (k) =>
    expect(telemetryEnabled({ ...base, query: new URLSearchParams('telemetry'), [k]: true })).toBe(false));
});
