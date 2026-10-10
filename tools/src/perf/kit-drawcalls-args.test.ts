import { describe, expect, it } from 'vitest';
import { kitReadingFailure, parseKitDrawcallArgs } from './kit-drawcalls-args';

describe('parseKitDrawcallArgs', () => {
  it('defaults to the eight kit vehicles at tiers 0 and 3, 20 clones, no synthetic kit', () => {
    const a = parseKitDrawcallArgs([], 'darwin');
    // Literals, not KIT_VEHICLES: the oracle must not move with the list it checks.
    expect([...a.ids].sort()).toEqual([
      'apc_eitan',
      'apc_kipod',
      'dozer_d9',
      'heli_peten',
      'ifv_namer',
      'jeep_shoded',
      'mbt_lavi',
      'scout_shachaf',
    ]);
    expect(a.tierLevels).toEqual([0, 3]);
    expect(a.n).toBe(20);
    expect(a.gpu).toBe('metal');
    expect(a.syntheticKit).toBe(false);
  });

  it('reads every flag it documents, and tolerates the separator pnpm forwards', () => {
    const a = parseKitDrawcallArgs(
      ['--', '--ids=mbt_lavi,dozer_d9', '--tiers=2', '--n=5', '--gpu=swiftshader', '--synthetic-kit'],
      'darwin'
    );
    expect(a).toEqual({ ids: ['mbt_lavi', 'dozer_d9'], tierLevels: [2], n: 5, gpu: 'swiftshader', syntheticKit: true });
  });

  for (const argv of [['--tier=3'], ['--id=mbt_lavi'], ['mbt_lavi'], ['--synthetic'], ['--n', '5'], ['--tiers=3', '--force']]) {
    it(`refuses [${argv.join(' ')}] rather than measuring the default`, () => {
      expect(() => parseKitDrawcallArgs(argv, 'darwin')).toThrow(/unrecognised argument/);
    });
  }

  for (const [argv, error] of [
    [['--tiers=4'], /--tiers must be 0, 1, 2 or 3/],
    [['--tiers='], /--tiers must be 0, 1, 2 or 3/],
    [['--n=0'], /--n must be a positive integer/],
    [['--n='], /--n must be a positive integer/],
    [['--ids='], /--ids names no vehicle/],
    [['--gpu'], /needs a value/],
    [['--gpu=vulkan'], /not a known backend/],
  ] as const) {
    it(`refuses [${argv.join(' ')}]`, () => {
      expect(() => parseKitDrawcallArgs(argv, 'darwin')).toThrow(error);
    });
  }
});

describe('kitReadingFailure', () => {
  const reading = { id: 'mbt_lavi', level: 3, perVehicle: 12, kittedMeshes: 1, syntheticKit: false };

  it('passes 12 submissions (6 for the D9) with kit merged', () => {
    expect(kitReadingFailure(reading)).toBeNull();
    expect(kitReadingFailure({ ...reading, id: 'dozer_d9', perVehicle: 6 })).toBeNull();
  });

  it('fails any other count', () => {
    expect(kitReadingFailure({ ...reading, perVehicle: 15 })).toMatch(/15 submissions\/vehicle, want 12/);
    expect(kitReadingFailure({ ...reading, id: 'dozer_d9', perVehicle: 12 })).toMatch(/want 6/);
  });

  it('FAILS a tiers > 0 reading with no kit merged: that is the tier-0 hull read twice, not a measurement', () => {
    expect(kitReadingFailure({ ...reading, kittedMeshes: 0 })).toMatch(
      /tiers=3 but no mesh carries kit.*pnpm kit:meshes -- --id=mbt_lavi.*--synthetic-kit/
    );
    expect(kitReadingFailure({ ...reading, level: 1, kittedMeshes: 0 })).toMatch(/tiers=1 but no mesh carries kit/);
  });

  it('passes a kit-less reading at tiers 0, or with --synthetic-kit given', () => {
    expect(kitReadingFailure({ ...reading, level: 0, kittedMeshes: 0 })).toBeNull();
    expect(kitReadingFailure({ ...reading, kittedMeshes: 0, syntheticKit: true })).toBeNull();
  });
});
