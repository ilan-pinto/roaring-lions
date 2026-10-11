// How the no-graphics-acceleration notice is wired in `main.ts`, pinned as
// text the way the repo pins a copy (`ambience.test.ts`). The behaviour is in
// `no-gpu.test.ts`; this guards the one thing it cannot see: that the call
// site passes the production flag and the real hostname, which is what keeps
// CI and every SwiftShader test harness from ever meeting the card.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('wiring in main.ts (pinned as text, the way the repo pins a copy)', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const call = main.slice(main.indexOf('watchNoGpu({'), main.indexOf('watchNoGpu({') + 400);
  it('is mounted once, after the phone notice', () => {
    expect(main.match(/watchNoGpu\(\{/g)).toHaveLength(1);
    expect(main.indexOf('watchSmallScreen({')).toBeGreaterThan(-1);
    expect(main.indexOf('watchNoGpu({')).toBeGreaterThan(main.indexOf('watchSmallScreen({'));
  });
  it('is gated on the production build flag and the real hostname, and reads the cached feedback renderer', () => {
    expect(call).toContain('prod: import.meta.env.PROD');
    expect(call).toContain('hostname: location.hostname');
    expect(call).toContain('renderer: gpuName');
  });
});
