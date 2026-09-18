/**
 * The CLI flag parser: each command's flags with their defaults, and every
 * refusal path (bad enum, out-of-range polycount, over-length prompt, a
 * missing --yes with no TTY, an unrecognised flag, a missing/extra
 * positional). No network, no real stdin -- `isTTY` is always injected.
 */
import { describe, expect, it } from 'vitest';
import {
  assertYesOrInteractive,
  parseBalanceArgs,
  parseDownloadArgs,
  parseEstimateImageArgs,
  parseEstimateTextArgs,
  parseImageArgs,
  parseListArgs,
  parseSpentArgs,
  parseStatusArgs,
  parseTextArgs,
  tokenizeArgs,
} from './args';

const TTY = { isTTY: true };
const NO_TTY = { isTTY: false };

describe('tokenizeArgs', () => {
  it('splits positionals from --flag value pairs', () => {
    const { positionals, options } = tokenizeArgs(['a desert watchtower', '--name', 'watchtower'], new Set());
    expect(positionals).toEqual(['a desert watchtower']);
    expect(options.get('name')).toBe('watchtower');
  });

  it('accepts --flag=value form', () => {
    const { options } = tokenizeArgs(['--name=watchtower'], new Set());
    expect(options.get('name')).toBe('watchtower');
  });

  it('treats a listed boolean flag as present without consuming the next token', () => {
    const { positionals, options } = tokenizeArgs(['--yes', 'prompt text'], new Set(['yes']));
    expect(options.get('yes')).toBe('true');
    expect(positionals).toEqual(['prompt text']);
  });

  it('skips a bare "--" wherever it appears', () => {
    const { positionals, options } = tokenizeArgs(['--', '--yes', '--', 'prompt'], new Set(['yes']));
    expect(options.get('yes')).toBe('true');
    expect(positionals).toEqual(['prompt']);
  });

  it('throws when a value-taking flag has no value', () => {
    expect(() => tokenizeArgs(['--name'], new Set())).toThrow(/--name requires a value/);
  });

  it('throws when a value-taking flag is immediately followed by another flag', () => {
    expect(() => tokenizeArgs(['--name', '--yes'], new Set(['yes']))).toThrow(/--name requires a value/);
  });
});

describe('assertYesOrInteractive', () => {
  it('passes when --yes was given, TTY or not', () => {
    expect(() => assertYesOrInteractive(true, false)).not.toThrow();
    expect(() => assertYesOrInteractive(true, true)).not.toThrow();
  });

  it('passes on a TTY without --yes (the CLI will prompt)', () => {
    expect(() => assertYesOrInteractive(false, true)).not.toThrow();
  });

  it('refuses with no TTY and no --yes', () => {
    expect(() => assertYesOrInteractive(false, false)).toThrow(/--yes/);
  });
});

describe('parseTextArgs', () => {
  it('parses the prompt and applies defaults', () => {
    const opts = parseTextArgs(['a desert watchtower', '--yes'], NO_TTY);
    expect(opts.prompt).toBe('a desert watchtower');
    expect(opts.modelType).toBe('standard');
    expect(opts.aiModel).toBe('meshy-6');
    expect(opts.topology).toBe('triangle');
    expect(opts.textureResolution).toBe('2k');
    expect(opts.formats).toEqual(['glb']);
    expect(opts.ultra).toBe(false);
    expect(opts.pbr).toBe(false);
    expect(opts.refine).toBe(false);
    expect(opts.yes).toBe(true);
    expect(opts.json).toBe(false);
  });

  it('parses every documented flag', () => {
    const opts = parseTextArgs(
      [
        'a rusty watchtower',
        '--name',
        'watchtower',
        '--model-type',
        'smart-topology',
        '--ai-model',
        'meshy-7',
        '--polycount',
        '8000',
        '--topology',
        'quad',
        '--ultra',
        '--refine',
        '--pbr',
        '--tex',
        '4k',
        '--texture-prompt',
        'weathered limestone',
        '--formats',
        'glb,obj',
        '--yes',
      ],
      NO_TTY
    );
    expect(opts).toMatchObject({
      name: 'watchtower',
      modelType: 'smart-topology',
      aiModel: 'meshy-7',
      polycount: 8000,
      topology: 'quad',
      ultra: true,
      refine: true,
      pbr: true,
      textureResolution: '4k',
      texturePrompt: 'weathered limestone',
      formats: ['glb', 'obj'],
      yes: true,
    });
  });

  it('refuses a missing prompt', () => {
    expect(() => parseTextArgs(['--yes'], NO_TTY)).toThrow(/missing required <prompt>/);
  });

  it('refuses more than one positional (an unquoted prompt)', () => {
    expect(() => parseTextArgs(['a', 'watchtower', '--yes'], NO_TTY)).toThrow(/unexpected extra argument/);
  });

  it('refuses a prompt over 800 chars', () => {
    expect(() => parseTextArgs(['x'.repeat(801), '--yes'], NO_TTY)).toThrow(/800/);
  });

  it('refuses --polycount outside the documented range', () => {
    expect(() => parseTextArgs(['p', '--polycount', '99', '--yes'], NO_TTY)).toThrow(/out of range/);
    expect(() => parseTextArgs(['p', '--polycount', '300001', '--yes'], NO_TTY)).toThrow(/out of range/);
    expect(() => parseTextArgs(['p', '--model-type', 'smart-topology', '--polycount', '15001', '--yes'], NO_TTY)).toThrow(
      /out of range/
    );
  });

  it('refuses an unknown --model-type / --ai-model / --topology / --tex', () => {
    expect(() => parseTextArgs(['p', '--model-type', 'bogus', '--yes'], NO_TTY)).toThrow(/model-type/);
    expect(() => parseTextArgs(['p', '--ai-model', 'bogus', '--yes'], NO_TTY)).toThrow(/ai-model/);
    expect(() => parseTextArgs(['p', '--topology', 'bogus', '--yes'], NO_TTY)).toThrow(/topology/);
    expect(() => parseTextArgs(['p', '--tex', 'bogus', '--yes'], NO_TTY)).toThrow(/tex/);
  });

  it('refuses an unrecognised flag', () => {
    expect(() => parseTextArgs(['p', '--bogus-flag', 'x', '--yes'], NO_TTY)).toThrow(/unrecognised flag/);
  });

  it('refuses to run non-interactively without --yes', () => {
    expect(() => parseTextArgs(['a watchtower'], NO_TTY)).toThrow(/--yes/);
  });

  it('does not require --yes on a TTY (the CLI prompts instead)', () => {
    expect(() => parseTextArgs(['a watchtower'], TTY)).not.toThrow();
  });
});

describe('parseImageArgs', () => {
  it('parses the path/URL and applies defaults', () => {
    const opts = parseImageArgs(['./source.png', '--yes'], NO_TTY);
    expect(opts.pathOrUrl).toBe('./source.png');
    expect(opts.noTexture).toBe(false);
    expect(opts.modelType).toBe('standard');
    expect(opts.formats).toEqual(['glb']);
  });

  it('parses --no-texture and the rest of the flag set', () => {
    const opts = parseImageArgs(
      ['https://example.com/a.png', '--no-texture', '--ultra', '--ai-model', 'meshy-7', '--yes', '--json'],
      NO_TTY
    );
    expect(opts.noTexture).toBe(true);
    expect(opts.ultra).toBe(true);
    expect(opts.aiModel).toBe('meshy-7');
    expect(opts.json).toBe(true);
  });

  it('refuses a missing path/URL', () => {
    expect(() => parseImageArgs(['--yes'], NO_TTY)).toThrow(/missing required <path-or-url>/);
  });

  it('refuses more than one positional', () => {
    expect(() => parseImageArgs(['a.png', 'b.png', '--yes'], NO_TTY)).toThrow(/unexpected extra argument/);
  });

  it('refuses --polycount outside range for the chosen model-type', () => {
    expect(() => parseImageArgs(['a.png', '--model-type', 'smart-topology', '--polycount', '20000', '--yes'], NO_TTY)).toThrow(
      /out of range/
    );
  });

  it('refuses to run non-interactively without --yes', () => {
    expect(() => parseImageArgs(['a.png'], NO_TTY)).toThrow(/--yes/);
  });

  it('refuses an unrecognised flag (no --refine on image)', () => {
    expect(() => parseImageArgs(['a.png', '--refine', '--yes'], NO_TTY)).toThrow(/unrecognised flag/);
  });
});

describe('parseEstimateTextArgs', () => {
  it('applies defaults with no flags', () => {
    const opts = parseEstimateTextArgs([]);
    expect(opts).toEqual({ modelType: 'standard', aiModel: 'meshy-6', ultra: false, refine: false, textureResolution: '2k', json: false });
  });

  it('parses every flag it accepts', () => {
    const opts = parseEstimateTextArgs(['--model-type', 'smart-topology', '--ai-model', 'meshy-7', '--ultra', '--refine', '--tex', '8k', '--json']);
    expect(opts).toEqual({
      modelType: 'smart-topology',
      aiModel: 'meshy-7',
      ultra: true,
      refine: true,
      textureResolution: '8k',
      json: true,
    });
  });

  it('takes no positional argument (the "text" sub-kind is consumed by the CLI dispatcher)', () => {
    expect(() => parseEstimateTextArgs(['unexpected'])).toThrow(/unexpected argument/);
  });

  it('does not require --yes (estimate never spends)', () => {
    expect(() => parseEstimateTextArgs([])).not.toThrow();
  });
});

describe('parseEstimateImageArgs', () => {
  it('applies defaults and parses --no-texture', () => {
    expect(parseEstimateImageArgs([])).toMatchObject({ modelType: 'standard', noTexture: false });
    expect(parseEstimateImageArgs(['--no-texture']).noTexture).toBe(true);
  });

  it('refuses an unrecognised flag such as --refine (image has none)', () => {
    expect(() => parseEstimateImageArgs(['--refine'])).toThrow(/unrecognised flag/);
  });
});

describe('parseStatusArgs / parseDownloadArgs / parseListArgs / parseBalanceArgs / parseSpentArgs', () => {
  it('status requires an id and accepts --kind/--json', () => {
    expect(() => parseStatusArgs([])).toThrow(/missing required <id>/);
    const opts = parseStatusArgs(['task-123', '--kind', 'text', '--json']);
    expect(opts).toEqual({ id: 'task-123', kind: 'text', json: true });
  });

  it('status defaults --kind to undefined (try both)', () => {
    expect(parseStatusArgs(['task-123']).kind).toBeUndefined();
  });

  it('status refuses an unknown --kind', () => {
    expect(() => parseStatusArgs(['task-123', '--kind', 'bogus'])).toThrow(/kind/);
  });

  it('download requires an id and accepts --kind/--name/--json', () => {
    expect(() => parseDownloadArgs([])).toThrow(/missing required <id>/);
    const opts = parseDownloadArgs(['task-123', '--name', 'watchtower']);
    expect(opts).toEqual({ id: 'task-123', kind: undefined, name: 'watchtower', json: false });
  });

  it('list defaults to page 1 and accepts --kind/--page/--json', () => {
    expect(parseListArgs([])).toEqual({ kind: undefined, page: 1, json: false });
    expect(parseListArgs(['--page', '3']).page).toBe(3);
  });

  it('list refuses a page below 1', () => {
    expect(() => parseListArgs(['--page', '0'])).toThrow(/--page must be >= 1/);
  });

  it('list refuses a stray positional', () => {
    expect(() => parseListArgs(['bogus'])).toThrow(/unexpected argument/);
  });

  it('balance takes only --json', () => {
    expect(parseBalanceArgs([])).toEqual({ json: false });
    expect(parseBalanceArgs(['--json'])).toEqual({ json: true });
    expect(() => parseBalanceArgs(['bogus'])).toThrow(/unexpected argument/);
  });

  it('spent takes only --json', () => {
    expect(parseSpentArgs([])).toEqual({ json: false });
    expect(parseSpentArgs(['--json'])).toEqual({ json: true });
  });
});
