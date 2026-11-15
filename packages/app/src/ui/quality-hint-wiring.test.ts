// How the slow-frames suggestion is wired in `main.ts`, pinned as text the way the repo pins a copy (`no-gpu-wiring.test.ts`). The
// behaviour is in `quality-hint.test.ts`; this guards what it cannot see: that the call site passes the production flag and the
// real hostname (which keeps CI and every SwiftShader harness from ever meeting the card), that the only write is the settings
// dependency's own `set`, and that a mission is not a place the suggestion may measure or show.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('wiring in main.ts (pinned as text)', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  const at = main.indexOf('watchQualityHint({');
  const call = main.slice(at, at + 1400);
  it('is mounted once, after the no-graphics notice', () => {
    expect(main.match(/watchQualityHint\(\{/g)).toHaveLength(1);
    expect(at).toBeGreaterThan(main.indexOf('watchNoGpu({'));
  });
  it('is gated on the production build flag and the real hostname, and reads the cached renderer', () => {
    expect(call).toContain('prod: import.meta.env.PROD');
    expect(call).toContain('hostname: location.hostname');
    expect(call).toContain('renderer: gpuName');
  });
  it('writes the preset only through the settings dependency, and only the quality field', () => {
    expect(call).toContain('setQuality: (q) => settingsDeps.set({ ...settings, video: { ...settings.video, quality: q } })');
    expect(call).not.toContain('saveSettings');
  });
  it('measures and shows only on the shell screens, never on a battlefield', () => {
    expect(call).toContain("inShell: () => ['menu', 'campaign', 'brigade', 'free-play'].includes(router.current()?.name ?? '')");
    expect(call).not.toContain("'mission'");
    expect(call).not.toContain("'sandbox'");
  });
});
