import { describe, expect, it } from 'vitest';
import {
  asAiModel,
  asModelType,
  asTaskKind,
  asTextureResolution,
  asTopology,
  assertPolycountInRange,
  assertPromptLength,
  defaultPolycount,
  parseTargetFormats,
  polycountRange,
  PROMPT_MAX_CHARS,
} from './options';

describe('polycountRange / assertPolycountInRange', () => {
  it('is 100-300000 for standard and lowpoly', () => {
    expect(polycountRange('standard')).toEqual({ min: 100, max: 300000 });
    expect(polycountRange('lowpoly')).toEqual({ min: 100, max: 300000 });
  });

  it('is 100-15000 for smart-topology', () => {
    expect(polycountRange('smart-topology')).toEqual({ min: 100, max: 15000 });
  });

  it('accepts the documented boundaries', () => {
    expect(() => assertPolycountInRange(100, 'standard')).not.toThrow();
    expect(() => assertPolycountInRange(300000, 'standard')).not.toThrow();
    expect(() => assertPolycountInRange(15000, 'smart-topology')).not.toThrow();
  });

  it('refuses below the floor', () => {
    expect(() => assertPolycountInRange(99, 'standard')).toThrow(/out of range/);
  });

  it('refuses above the standard ceiling', () => {
    expect(() => assertPolycountInRange(300001, 'standard')).toThrow(/out of range/);
  });

  it('refuses a standard-range value over the smart-topology ceiling', () => {
    expect(() => assertPolycountInRange(15001, 'smart-topology')).toThrow(/out of range/);
  });

  it('refuses a non-integer', () => {
    expect(() => assertPolycountInRange(1000.5, 'standard')).toThrow();
  });
});

describe('defaultPolycount', () => {
  it('is inside range for every model type', () => {
    for (const mt of ['standard', 'smart-topology', 'lowpoly'] as const) {
      expect(() => assertPolycountInRange(defaultPolycount(mt), mt)).not.toThrow();
    }
  });
});

describe('assertPromptLength', () => {
  it('accepts a prompt at the limit', () => {
    expect(() => assertPromptLength('a'.repeat(PROMPT_MAX_CHARS))).not.toThrow();
  });

  it('refuses a prompt over the limit', () => {
    expect(() => assertPromptLength('a'.repeat(PROMPT_MAX_CHARS + 1))).toThrow(/800/);
  });

  it('refuses an empty prompt', () => {
    expect(() => assertPromptLength('')).toThrow(/empty/);
  });
});

describe('enum validators', () => {
  it('accept known values', () => {
    expect(asModelType('smart-topology')).toBe('smart-topology');
    expect(asAiModel('meshy-7')).toBe('meshy-7');
    expect(asTopology('quad')).toBe('quad');
    expect(asTextureResolution('8k')).toBe('8k');
    expect(asTaskKind('image')).toBe('image');
  });

  it('reject unknown values with a message naming the valid set', () => {
    expect(() => asModelType('bogus')).toThrow(/model-type/);
    expect(() => asAiModel('bogus')).toThrow(/ai-model/);
    expect(() => asTopology('bogus')).toThrow(/topology/);
    expect(() => asTextureResolution('bogus')).toThrow(/tex/);
    expect(() => asTaskKind('bogus')).toThrow(/kind/);
  });
});

describe('parseTargetFormats', () => {
  it('parses a comma-separated list', () => {
    expect(parseTargetFormats('glb,obj,fbx')).toEqual(['glb', 'obj', 'fbx']);
  });

  it('trims whitespace around entries', () => {
    expect(parseTargetFormats(' glb , obj ')).toEqual(['glb', 'obj']);
  });

  it('de-duplicates', () => {
    expect(parseTargetFormats('glb,glb,obj')).toEqual(['glb', 'obj']);
  });

  it('refuses an unknown format', () => {
    expect(() => parseTargetFormats('glb,ply')).toThrow(/formats entry/);
  });

  it('refuses an empty list', () => {
    expect(() => parseTargetFormats('')).toThrow(/at least one/);
    expect(() => parseTargetFormats(' , ')).toThrow(/at least one/);
  });
});
