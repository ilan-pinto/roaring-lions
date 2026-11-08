import { describe, expect, it } from 'vitest';
import { QUIET_SCENARIO, captureScript, layerToggleScript, matchNodeSettleScript, nodeCensusStatements } from './capture-protocol';

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

describe('the node arm re-runs its census after a toggle (R9: the re-shown decal ShaderMaterials)', () => {
  it('toggle, THEN census, THEN the native rAF and the repaint, on both node arms and both directions', () => {
    for (const arm of ['webgl2', 'webgpu'] as const) {
      for (const visible of [true, false]) {
        const s = layerToggleScript('decals', visible, arm, { nodeCensusRoot: ROOT });
        const toggle = s.indexOf('setDebugLayerVisible');
        const census = s.indexOf('censusUnported');
        expect(census).toBeGreaterThan(toggle);
        expect(s.indexOf('window.requestAnimationFrame')).toBeGreaterThan(census);
        expect(s.indexOf('frame(1, 0)')).toBeGreaterThan(census);
        expect(s).toContain(`/@fs${ROOT}/packages/render/src/three/backend/unported.ts`);
        // The node arm runs the backend's OWN census: no ported-key exemption (that is the legacy-matched arm's).
        expect(s).not.toContain('PORTED_MATERIAL_KEYS');
      }
    }
  });
  it('without the option, and on legacy, the toggle script is unchanged', () => {
    expect(layerToggleScript('decals', true, 'webgpu')).not.toContain('censusUnported');
    expect(layerToggleScript('decals', true, 'legacy', { nodeCensusRoot: ROOT })).toBe(layerToggleScript('decals', true));
    expect(nodeCensusStatements(ROOT)).toContain('censusUnported');
  });
});

describe('--match-node (the legacy-matched arm)', () => {
  it('a plain legacy capture script carries no matching', () => {
    expect(captureScript(QUIET_SCENARIO)).not.toContain('censusUnported');
  });
  it('the matched script runs the node census on the legacy scene and repaints, before the camera is read', () => {
    const s = captureScript(QUIET_SCENARIO, 'legacy', { matchNodeRoot: ROOT });
    expect(s).toContain(`/@fs${ROOT}/packages/render/src/three/backend/unported.ts`);
    expect(s.indexOf('censusUnported')).toBeGreaterThan(-1);
    expect(s.indexOf('censusUnported')).toBeLessThan(s.indexOf('const c = window.__lions.renderer.camera'));
  });
  it('matched L keeps its AO ON (T7 gave the node chain AO): nothing in the matched scripts touches the AO pass', () => {
    // Falsify: put `if (_r.aoPass) _r.aoPass.enabled = false;` back into `matchNodeStatements` and both assertions go red.
    expect(captureScript(QUIET_SCENARIO, 'legacy', { matchNodeRoot: ROOT })).not.toMatch(/aoPass/);
    expect(layerToggleScript('fog', true, 'legacy', { matchNodeRoot: ROOT })).not.toMatch(/aoPass/);
  });
  it('re-applies after every layer toggle (a re-shown layer would otherwise un-hide a ShaderMaterial object)', () => {
    expect(layerToggleScript('fog', true, 'legacy', { matchNodeRoot: ROOT })).toContain('censusUnported');
  });
  it('the settle script runs the matched census, then repaints, and reads back the tick', () => {
    const s = matchNodeSettleScript(ROOT);
    expect(s).toContain('PORTED_MATERIAL_KEYS');
    expect(s.indexOf('censusUnported')).toBeGreaterThan(-1);
    expect(s.indexOf('frame(1, 0)')).toBeGreaterThan(s.indexOf('censusUnported'));
    expect(s).toContain('tickCount');
  });
  it('is refused on a node arm', () => {
    expect(() => captureScript(QUIET_SCENARIO, 'webgpu', { matchNodeRoot: ROOT })).toThrow(/legacy-arm/);
  });
});
