import { describe, expect, it } from 'vitest';
import { QUIET_SCENARIO, captureScript, layerToggleScript } from './capture-protocol';

const ROOT = '/repo';

describe('layerToggleScript on a node arm (GH-943 P1)', () => {
  it('awaits one NATIVE rAF after the toggle and BEFORE the zero-time repaint', () => {
    for (const arm of ['webgl2', 'webgpu'] as const) {
      const s = layerToggleScript('fog', false, arm);
      const toggle = s.indexOf('setDebugLayerVisible');
      const raf = s.indexOf('window.requestAnimationFrame');
      const frame = s.indexOf('frame(1, 0)');
      expect(toggle).toBeGreaterThan(-1);
      expect(raf).toBeGreaterThan(toggle);
      expect(frame).toBeGreaterThan(raf);
    }
  });
  it('legacy is untouched: no rAF, and the same script with or without the options bag', () => {
    expect(layerToggleScript('fog', false)).not.toContain('requestAnimationFrame');
    expect(layerToggleScript('fog', false, 'legacy', {})).toBe(layerToggleScript('fog', false));
  });
});

describe('--match-node (the legacy-matched arm)', () => {
  it('a plain legacy capture script carries no matching', () => {
    expect(captureScript(QUIET_SCENARIO)).not.toContain('censusUnported');
  });
  it('the matched script runs the node census on the legacy scene, switches AO off, and repaints, before the camera is read', () => {
    const s = captureScript(QUIET_SCENARIO, 'legacy', { matchNodeRoot: ROOT });
    expect(s).toContain(`/@fs${ROOT}/packages/render/src/three/backend/unported.ts`);
    expect(s.indexOf('censusUnported')).toBeGreaterThan(-1);
    expect(s.indexOf('aoPass.enabled = false')).toBeGreaterThan(-1);
    expect(s.indexOf('censusUnported')).toBeLessThan(s.indexOf('const c = window.__lions.renderer.camera'));
  });
  it('re-applies after every layer toggle (a re-shown layer would otherwise un-hide a ShaderMaterial object)', () => {
    expect(layerToggleScript('fog', true, 'legacy', { matchNodeRoot: ROOT })).toContain('censusUnported');
  });
  it('is refused on a node arm', () => {
    expect(() => captureScript(QUIET_SCENARIO, 'webgpu', { matchNodeRoot: ROOT })).toThrow(/legacy-arm/);
  });
});
