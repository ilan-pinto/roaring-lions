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
  const gateAt = main.indexOf('const qualityEnv');
  const gate = main.slice(gateAt, at);
  it('is mounted once, after the no-graphics notice', () => {
    expect(main.match(/watchQualityHint\(\{/g)).toHaveLength(1);
    expect(at).toBeGreaterThan(main.indexOf('watchNoGpu({'));
  });
  it('is gated on the production build flag and the real hostname, and reads the cached renderer', () => {
    expect(gateAt).toBeGreaterThan(-1);
    expect(gate).toContain('prod: import.meta.env.PROD');
    expect(gate).toContain('hostname: location.hostname');
    expect(call).toContain('env: qualityEnv');
    expect(call).toContain('renderer: gpuName');
  });
  it('loads the card only past the gate, and logs a failed chunk load', () => {
    expect(gate).toContain("if (feedbackSends(qualityEnv) || qualityEnv.query.has('qualityhint')) {");
    expect(gate).toContain("import('./ui/quality-hint')");
    expect(main).not.toMatch(/^import \{ watchQualityHint \}/m);
    expect(main.slice(at, at + 1700)).toContain("console.error('[quality-hint] the card failed to load', err)");
  });
  it('writes only through the settings dependency (main.ts hands it the one writer, and the two modules call nothing else)', () => {
    expect(call).toContain('settings: settingsDeps,');
    expect(call).not.toContain('saveSettings');
    for (const file of ['./quality-hint.ts', './software-hint.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(src, file).not.toMatch(/saveSettings|localStorage|SETTINGS_KEY|lions\.settings/);
      expect(src, file).toMatch(/settings\.set\(/);
    }
  });
  it('measures and shows only on the shell screens, never on a battlefield', () => {
    expect(call).toContain("inShell: () => ['menu', 'campaign', 'brigade', 'free-play'].includes(router.current()?.name ?? '')");
    expect(call).not.toContain("'mission'");
    expect(call).not.toContain("'sandbox'");
  });
});
