import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, it, expect } from 'vitest';
import { GPU_PATTERN, gpuFamily, isTelemetryEvent, TELEMETRY_EVENT_TYPES, TELEMETRY_ORDER_VERBS } from './telemetry';

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../data/schemas/telemetry_event.schema.json', import.meta.url)), 'utf8')
) as object;
const validate = new Ajv2020({ allErrors: true }).compile(schema);

const ENV = {
  v: 1,
  player: '0f8fad5b-d9cb-469f-a165-70867728950e',
  session: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  build: '0.78.0',
  t: 1790232694000,
};

const VALID: Record<string, unknown>[] = [
  { ...ENV, type: 'session_start', screen: 'menu', renderer: 'three', viewport: [1440, 900], returning: false },
  { ...ENV, type: 'session_start', screen: 'sandbox', renderer: 'pixi', viewport: [375, 812], returning: true, dev: true },
  { ...ENV, tester: 'dani', type: 'heartbeat', mission: 'tel_marum_3_clearance', tick: 1200 },
  { ...ENV, type: 'tutorial_step', step: 3, steps: 14, prevMs: 8123 },
  { ...ENV, type: 'tutorial_step', step: 4, steps: 9, prevMs: 8123, id: 'identify_then_shoot' },
  { ...ENV, type: 'mission_start', mission: 'beit_sahwan_breach', replay: false },
  { ...ENV, type: 'objective', mission: 'beit_sahwan_breach', objective: 'hold_gate', objectiveType: 'hold_for', primary: true, status: 'complete', tick: 4000 },
  { ...ENV, type: 'mission_end', mission: 'beit_sahwan_breach', result: 'victory', tick: 6000, roe: 94, fielded: 12, lost: 2, objectivesDone: 3, objectivesTotal: 4 },
  { ...ENV, type: 'mission_end', mission: 'wadi_halam_5_depot', result: 'defeat', cause: 'objective:raze_depot', tick: 6000, roe: 61, fielded: 9, lost: 9, objectivesDone: 0, objectivesTotal: 2 },
  { ...ENV, type: 'mission_end', mission: 'khan_rafid_1_recon', result: 'defeat', cause: 'withdrawn', tick: 14400, roe: 100, fielded: 6, lost: 1, objectivesDone: 1, objectivesTotal: 2 },
  { ...ENV, type: 'mission_end', mission: 'wadi_halam_5_depot', result: 'abandoned', tick: 900, roe: 100, fielded: 9, lost: 0, objectivesDone: 0, objectivesTotal: 2 },
  { ...ENV, type: 'campaign_progress', mission: 'beit_sahwan_breach', missionsWon: 1 },
  { ...ENV, t: 9007199254740991, type: 'mission_start', mission: 'beit_sahwan_breach', replay: false },
  { ...ENV, type: 'tutorial_step', step: 0, steps: 1, prevMs: 9007199254740991 },
  { ...ENV, type: 'mission_start', mission: 'beit_sahwan_breach', replay: false, deployed: { inf_squad: 3, mbt_lavi: 1 }, fromRoster: { inf_squad: 2 } },
  { ...ENV, type: 'mission_end', mission: 'beit_sahwan_breach', result: 'victory', tick: 6000, roe: 94, fielded: 12, lost: 2, objectivesDone: 3, objectivesTotal: 4, bought: { inf_squad: 1 }, orders: { move: 40, attackMove: 12, strike: 1 } },
  { ...ENV, type: 'mission_end', mission: 'beit_sahwan_breach', result: 'abandoned', tick: 90, roe: 100, fielded: 4, lost: 0, objectivesDone: 0, objectivesTotal: 2, bought: {}, orders: {} },
  { ...ENV, type: 'account', reason: 'mission_start', mission: 'beit_sahwan_breach', credits: 340, earned: 900, unlocks: ['mbt_lavi'], tiers: ['inf_squad.armour.2', 'inf_squad.sensors.1'] },
  { ...ENV, type: 'account', reason: 'payout', mission: 'beit_sahwan_breach', credits: 120, earned: 120, unlocks: [], tiers: [], paid: 120 },
  { ...ENV, type: 'account', reason: 'purchase', credits: 225, earned: 900, unlocks: [], tiers: ['inf_squad.armour.1'], item: 'inf_squad.armour.1', price: 115 },
  { ...ENV, type: 'account', reason: 'purchase', credits: 0, earned: 900, unlocks: ['mbt_lavi'], tiers: [], item: 'mbt_lavi', price: 900 },
  { ...ENV, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: [], tiers: [] },
  { ...ENV, type: 'client_error', name: 'TypeError', message: "Cannot read properties of undefined (reading 'x')", hash: '1a2b3c4d' },
  { ...ENV, type: 'client_error', name: 'RangeError', message: '', hash: '00000000', screen: 'mission', mission: 'tel_marum_3_clearance' },
  { ...ENV, type: 'perf_sample', mission: 'tel_marum_3_clearance', units: 266, preset: 'high', backend: 'webgl2', gpu: 'Apple M3', frames: 3600, p50: 11.2, p95: 17.4, p99: 24 },
  { ...ENV, type: 'perf_sample', mission: 'beit_sahwan_breach', units: 0, preset: 'low', backend: 'webgpu', frames: 1, p50: 0, p95: 0, p99: 10000 },
  { ...ENV, type: 'boot', ttffMs: 2310, backend: 'webgl2', preset: 'medium', gpu: 'ARM Mali' },
  { ...ENV, type: 'boot', ttffMs: 0, backend: 'webgpu', preset: 'high' },
];

const INVALID: [string, Record<string, unknown>][] = [
  ['unknown type', { ...ENV, type: 'purchase', mission: 'x' }],
  ['wrong version', { ...ENV, v: 2, type: 'mission_start', mission: 'a', replay: false }],
  ['bad player id', { ...ENV, player: 'not-a-uuid', type: 'mission_start', mission: 'a', replay: false }],
  ['tester with a space', { ...ENV, tester: 'dani cohen', type: 'mission_start', mission: 'a', replay: false }],
  ['extra field', { ...ENV, type: 'mission_start', mission: 'a', replay: false, email: 'x@y.z' }],
  ['field from another type', { ...ENV, type: 'heartbeat', mission: 'a', tick: 1, replay: false }],
  ['missing required', { ...ENV, type: 'heartbeat', mission: 'a' }],
  ['bad cause', { ...ENV, type: 'mission_end', mission: 'a', result: 'defeat', cause: 'bored', tick: 1, roe: 1, fielded: 1, lost: 1, objectivesDone: 0, objectivesTotal: 1 }],
  ['roe out of range', { ...ENV, type: 'mission_end', mission: 'a', result: 'victory', tick: 1, roe: 101, fielded: 1, lost: 0, objectivesDone: 1, objectivesTotal: 1 }],
  ['float tick', { ...ENV, type: 'heartbeat', mission: 'a', tick: 1.5 }],
  ['dev false', { ...ENV, dev: false, type: 'mission_start', mission: 'a', replay: false }],
  ['not an object', 'mission_start' as unknown as Record<string, unknown>],
  ['t exceeds MAX_SAFE_INTEGER', { ...ENV, t: 9007199254740992, type: 'mission_start', mission: 'a', replay: false }],
  ['tutorial beat id that is free text', { ...ENV, type: 'tutorial_step', step: 0, steps: 9, prevMs: 0, id: 'Look around' }],
  ['tutorial beat id of the wrong type', { ...ENV, type: 'tutorial_step', step: 0, steps: 9, prevMs: 0, id: 4 }],
  ['prevMs exceeds MAX_SAFE_INTEGER', { ...ENV, type: 'tutorial_step', step: 0, steps: 1, prevMs: 9007199254740992 }],
  ['unlock that is free text', { ...ENV, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: ['Lavi MBT'], tiers: [] }],
  ['tier 0 on the wire', { ...ENV, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: [], tiers: ['inf_squad.armour.0'] }],
  ['tier without a track', { ...ENV, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: [], tiers: ['inf_squad.2'] }],
  ['unknown account reason', { ...ENV, type: 'account', reason: 'gift', credits: 0, earned: 0, unlocks: [], tiers: [] }],
  ['negative credits', { ...ENV, type: 'account', reason: 'reset', credits: -1, earned: 0, unlocks: [], tiers: [] }],
  ['account missing tiers', { ...ENV, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: [] }],
  ['65 unlocks', { ...ENV, type: 'account', reason: 'reset', credits: 0, earned: 0, unlocks: Array.from({ length: 65 }, (_, i) => `u${i}`), tiers: [] }],
  ['item with a space', { ...ENV, type: 'account', reason: 'purchase', credits: 0, earned: 0, unlocks: [], tiers: [], item: 'mbt lavi', price: 1 }],
  ['order verb that is presentation', { ...ENV, type: 'mission_end', mission: 'a', result: 'victory', tick: 1, roe: 1, fielded: 1, lost: 0, objectivesDone: 1, objectivesTotal: 1, orders: { select: 3 } }],
  ['float count in deployed', { ...ENV, type: 'mission_start', mission: 'a', replay: false, deployed: { inf_squad: 1.5 } }],
  ['uppercase unit key in bought', { ...ENV, type: 'mission_end', mission: 'a', result: 'victory', tick: 1, roe: 1, fielded: 1, lost: 0, objectivesDone: 1, objectivesTotal: 1, bought: { INF: 1 } }],
  ['orders on mission_start', { ...ENV, type: 'mission_start', mission: 'a', replay: false, orders: { move: 1 } }],
  ['item on mission_start', { ...ENV, type: 'mission_start', mission: 'a', replay: false, item: 'mbt_lavi' }],
  ['error message over 120 characters', { ...ENV, type: 'client_error', name: 'Error', message: 'x'.repeat(121), hash: '1a2b3c4d' }],
  ['error message with a non-ASCII character', { ...ENV, type: 'client_error', name: 'Error', message: 'caf\u00e9', hash: '1a2b3c4d' }],
  ['error message with a newline', { ...ENV, type: 'client_error', name: 'Error', message: 'a\nat https://x', hash: '1a2b3c4d' }],
  ['error name with a space', { ...ENV, type: 'client_error', name: 'Type Error', message: 'm', hash: '1a2b3c4d' }],
  ['stack hash in upper case', { ...ENV, type: 'client_error', name: 'Error', message: 'm', hash: '1A2B3C4D' }],
  ['stack hash too long', { ...ENV, type: 'client_error', name: 'Error', message: 'm', hash: '1a2b3c4d5' }],
  ['client_error with a stack field', { ...ENV, type: 'client_error', name: 'Error', message: 'm', hash: '1a2b3c4d', stack: 'at x' }],
  ['client_error with a user agent', { ...ENV, type: 'client_error', name: 'Error', message: 'm', hash: '1a2b3c4d', ua: 'Mozilla/5.0' }],
  ['perf_sample with an unknown preset', { ...ENV, type: 'perf_sample', mission: 'a', units: 1, preset: 'ultra', backend: 'webgl2', frames: 1, p50: 1, p95: 1, p99: 1 }],
  ['perf_sample with an unknown backend', { ...ENV, type: 'perf_sample', mission: 'a', units: 1, preset: 'high', backend: 'canvas', frames: 1, p50: 1, p95: 1, p99: 1 }],
  ['perf_sample with a negative percentile', { ...ENV, type: 'perf_sample', mission: 'a', units: 1, preset: 'high', backend: 'webgl2', frames: 1, p50: -1, p95: 1, p99: 1 }],
  ['perf_sample with a percentile past 10 s', { ...ENV, type: 'perf_sample', mission: 'a', units: 1, preset: 'high', backend: 'webgl2', frames: 1, p50: 1, p95: 1, p99: 10001 }],
  ['perf_sample with zero frames', { ...ENV, type: 'perf_sample', mission: 'a', units: 1, preset: 'high', backend: 'webgl2', frames: 0, p50: 1, p95: 1, p99: 1 }],
  ['perf_sample missing p99', { ...ENV, type: 'perf_sample', mission: 'a', units: 1, preset: 'high', backend: 'webgl2', frames: 1, p50: 1, p95: 1 }],
  ['perf_sample with the raw renderer string (commas, a colon, a driver)', { ...ENV, type: 'perf_sample', mission: 'a', units: 1, preset: 'high', backend: 'webgl2', gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)', frames: 1, p50: 1, p95: 1, p99: 1 }],
  ['boot with a Linux renderer string (a Mesa version and a PCI id)', { ...ENV, type: 'boot', ttffMs: 1, backend: 'webgl2', preset: 'high', gpu: 'Mesa Intel(R) UHD Graphics (0x00009A49) 23.2.1-1ubuntu3.1~22.04.2' }],
  ['boot with a gpu over 40 characters', { ...ENV, type: 'boot', ttffMs: 1, backend: 'webgl2', preset: 'high', gpu: 'A'.repeat(41) }],
  ['boot with a gpu that starts with a space', { ...ENV, type: 'boot', ttffMs: 1, backend: 'webgl2', preset: 'high', gpu: ' Apple M3' }],
  ['perf_sample with a gpu that is empty', { ...ENV, type: 'perf_sample', mission: 'a', units: 1, preset: 'high', backend: 'webgl2', gpu: '', frames: 1, p50: 1, p95: 1, p99: 1 }],
  ['boot with a negative time to first frame', { ...ENV, type: 'boot', ttffMs: -1, backend: 'webgl2', preset: 'high' }],
  ['boot with a fractional time to first frame', { ...ENV, type: 'boot', ttffMs: 10.5, backend: 'webgl2', preset: 'high' }],
  ['boot with an ip', { ...ENV, type: 'boot', ttffMs: 10, backend: 'webgl2', preset: 'high', ip: '203.0.113.9' }],
  ['perf field on a boot', { ...ENV, type: 'boot', ttffMs: 10, backend: 'webgl2', preset: 'high', p50: 3 }],
];

describe('telemetry event contract', () => {
  it.each(VALID.map((e) => [e.type as string, e]))('accepts a valid %s', (_type, e) => {
    expect(validate(e), JSON.stringify(validate.errors)).toBe(true);
    expect(isTelemetryEvent(e)).toBe(true);
  });

  it.each(INVALID)('rejects %s in both the schema and the guard', (_why, e) => {
    expect(validate(e)).toBe(false);
    expect(isTelemetryEvent(e)).toBe(false);
  });

  it('covers every event type with at least one valid fixture', () => {
    expect(new Set(VALID.map((e) => e.type))).toEqual(new Set(TELEMETRY_EVENT_TYPES));
  });

  it('the schema and the guard agree on the order verbs, in order', () => {
    const verbs = (schema as { $defs: { orderVerb: { enum: string[] } } }).$defs.orderVerb.enum;
    expect(verbs).toEqual([...TELEMETRY_ORDER_VERBS]);
  });
});

describe('gpuFamily (GH-1410: the client sends the family, never the raw string)', () => {
  it.each([
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)', 'Apple M3'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'Apple M1'],
    ['Apple GPU', 'Apple (other)'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA RTX 30-series'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA GTX 16-series'],
    ['NVIDIA Quadro P400', 'NVIDIA (other)'],
    ['ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'AMD Radeon RX 6000-series'],
    ['AMD Radeon(TM) Graphics', 'AMD (other)'],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel Iris Xe'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel UHD'],
    ['ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel HD'],
    ['Intel(R) Arc(TM) A750 Graphics', 'Intel Arc'],
    ['Adreno (TM) 740', 'Qualcomm Adreno 7xx'],
    ['Mali-G78', 'ARM Mali'],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'Software (no GPU)'],
    ['llvmpipe (LLVM 15.0.7, 256 bits)', 'Software (no GPU)'],
    ['Something Entirely New 9000', 'Other'],
    ['', 'Unknown'],
    [null, 'Unknown'],
  ])('%s -> %s', (gpu, want) => {
    expect(gpuFamily(gpu)).toBe(want);
  });

  // The review of GH-1410: UNMASKED_RENDERER_WEBGL on Windows and Linux carries PCI device ids and driver versions.
  const RAW = [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002487) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.3623)',
    'NVIDIA GeForce RTX 4090/PCIe/SSE2 NVIDIA 535.129.03',
    'Mesa Intel(R) UHD Graphics (CML GT2) Mesa 23.2.1-1ubuntu3.1~22.04.2',
    'ANGLE (Intel, Mesa Intel(R) Graphics (ADL GT2), OpenGL 4.6)',
    'AMD Radeon RX 7900 XTX (radeonsi, navi31, LLVM 15.0.7, DRM 3.54, 6.2.0-39-generic)',
    'Apple M2 Max',
    'Adreno (TM) 650',
    'caf\u00e9 GPU \u{1F600}',
    'X'.repeat(500),
    '',
  ];

  it('every result satisfies the wire pattern, whatever the input', () => {
    for (const raw of RAW) expect(GPU_PATTERN.test(gpuFamily(raw)), JSON.stringify(raw).slice(0, 60)).toBe(true);
  });

  it('no device id, driver version or other raw detail survives into the family', () => {
    for (const raw of RAW) {
      const f = gpuFamily(raw);
      for (const needle of ['0x', '535', '129', '23.2', '22.04', 'ubuntu', 'radeonsi', 'navi31', 'LLVM', '6.2.0', 'D3D11', 'CML', 'ADL', 'PCIe']) expect(f, `${needle} in ${f}`).not.toContain(needle);
    }
    expect(gpuFamily(RAW[0])).toBe('NVIDIA RTX 30-series');
    expect(gpuFamily(RAW[1])).toBe('NVIDIA RTX 40-series');
  });

  it('two different cards of one family are one row', () => {
    expect(gpuFamily('NVIDIA GeForce RTX 3060')).toBe(gpuFamily('NVIDIA GeForce RTX 3090 Ti'));
    expect(gpuFamily('NVIDIA GeForce RTX 3060')).not.toBe(gpuFamily('NVIDIA GeForce RTX 4060'));
  });
});

