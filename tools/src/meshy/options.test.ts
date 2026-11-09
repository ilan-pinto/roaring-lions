import { describe, expect, it } from 'vitest';
import {
  asAiModel,
  asModelType,
  asTaskKind,
  asTextureResolution,
  asTopology,
  assertModelPairing,
  assertPolycountInRange,
  assertTopologyForModel,
  defaultAiModel,
  MODEL_TYPES,
  SMART_TOPOLOGY_AI_MODELS,
  STANDARD_AI_MODELS,
  assertPromptLength,
  defaultPolycount,
  parseTargetFormats,
  polycountRange,
  PROMPT_MAX_CHARS,
} from './options';

describe('polycountRange / assertPolycountInRange', () => {
  it('is 100-300000 for standard', () => {
    expect(polycountRange('standard')).toEqual({ min: 100, max: 300000 });
    expect(polycountRange('standard', 'meshy-6-lite')).toEqual({ min: 100, max: 300000 });
  });

  it('is 100-15000 for smart-topology with no model named, and for meshy-t2', () => {
    expect(polycountRange('smart-topology')).toEqual({ min: 100, max: 15000 });
    expect(polycountRange('smart-topology', 'meshy-t2')).toEqual({ min: 100, max: 15000 });
  });

  it('is 100-30000 for meshy-t2.5', () => {
    expect(polycountRange('smart-topology', 'meshy-t2.5')).toEqual({ min: 100, max: 30000 });
    expect(() => assertPolycountInRange(30000, 'smart-topology', 'meshy-t2.5')).not.toThrow();
    expect(() => assertPolycountInRange(30001, 'smart-topology', 'meshy-t2.5')).toThrow(/out of range/);
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
    for (const mt of MODEL_TYPES) {
      expect(() => assertPolycountInRange(defaultPolycount(mt), mt)).not.toThrow();
      expect(() => assertPolycountInRange(defaultPolycount(mt), mt, defaultAiModel(mt))).not.toThrow();
    }
  });
});

describe('the model lists (pricing and text-to-3d pages, 2026-11-09)', () => {
  it('has no retired lowpoly model type', () => {
    expect(MODEL_TYPES).toEqual(['standard', 'smart-topology']);
    expect(() => asModelType('lowpoly')).toThrow(/model-type/);
  });

  it('accepts every current ai_model id', () => {
    for (const m of ['meshy-6-lite', 'meshy-6', 'meshy-7.1', 'meshy-7', 'latest', 'meshy-t2', 'meshy-t2.5']) {
      expect(asAiModel(m)).toBe(m);
    }
  });

  it('pairs each model with exactly one model type', () => {
    for (const m of STANDARD_AI_MODELS) {
      expect(() => assertModelPairing('standard', m)).not.toThrow();
      expect(() => assertModelPairing('smart-topology', m)).toThrow(/not a smart-topology model/);
    }
    for (const m of SMART_TOPOLOGY_AI_MODELS) {
      expect(() => assertModelPairing('smart-topology', m)).not.toThrow();
      expect(() => assertModelPairing('standard', m)).toThrow(/not a standard model/);
    }
  });

  it('defaults each model type to a model of its own', () => {
    expect(defaultAiModel('standard')).toBe('meshy-6');
    expect(defaultAiModel('smart-topology')).toBe('meshy-t2.5');
  });

  it('refuses quad under smart-topology only', () => {
    expect(() => assertTopologyForModel('smart-topology', 'quad')).toThrow(/triangles only/);
    expect(() => assertTopologyForModel('smart-topology', 'triangle')).not.toThrow();
    expect(() => assertTopologyForModel('standard', 'quad')).not.toThrow();
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
