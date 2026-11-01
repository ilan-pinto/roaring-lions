/**
 * `t2i` / `i2i` (GH-746 SC2): the estimate rows quoted 2026-11-01, the refusals (no --yes off a terminal, a plan
 * that cannot be recorded, a reference that would be dropped, an aspect the model answers 400 to), the request
 * bodies, and `runT2i` / `runI2i` against a fake client: no network, no key, no real art/meshy/ write.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { I2iTaskClient, T2iTaskClient } from './client';
import type { MeshyConfig } from './config';
import { runI2i, runT2i } from './cli';
import {
  buildI2iRequest,
  buildImageProvenanceLine,
  buildT2iRequest,
  composePrompt,
  effectiveImageModel,
  IMAGE_MODELS,
  loggableI2i,
  parseEstimateImageGenArgs,
  parseI2iArgs,
  parseT2iArgs,
  resolveReference,
  sha256,
  type ImageGenTask,
} from './images';
import { readLedger } from './ledger';
import { estimateCredits, IMAGE_PRICING } from './pricing';

const TTY = { isTTY: true };
const NO_TTY = { isTTY: false };

const CONFIG: MeshyConfig = {
  apiKey: 'fake-test-key-not-real',
  apiKeySource: 'env',
  usdPerCredit: 0.02,
  usdPerCreditSource: 'none',
  keyFile: '/dev/null',
  plan: 'pro',
};

describe('estimate rows (docs.meshy.ai/en/api/pricing, quoted 2026-11-01)', () => {
  // every cell of the "Image generation" table, written as literals: the oracle does not read IMAGE_PRICING
  const T2I: Record<string, number> = {
    'nano-banana': 3,
    'nano-banana-2': 6,
    'nano-banana-2-lite': 3,
    'nano-banana-pro': 9,
    'gpt-image-2': 9,
    'gpt-image-2-5-flare': 9,
    'gpt-image-2-5-sunburst': 9,
  };
  const I2I: Record<string, number> = { ...T2I, 'gpt-image-2': 12, 'gpt-image-2-5-flare': 12, 'gpt-image-2-5-sunburst': 12 };

  for (const model of IMAGE_MODELS) {
    it(`${model}: text-to-image ${T2I[model]}, image-to-image ${I2I[model]}`, () => {
      expect(estimateCredits('text-to-image', { imageModel: model })).toBe(T2I[model]);
      expect(estimateCredits('image-to-image', { imageModel: model })).toBe(I2I[model]);
    });
  }

  it('has a row for every model the CLI accepts, and no more', () => {
    expect(Object.keys(IMAGE_PRICING.textToImage).sort()).toEqual([...IMAGE_MODELS].sort());
    expect(Object.keys(IMAGE_PRICING.imageToImage).sort()).toEqual([...IMAGE_MODELS].sort());
  });

  it('defaults to the pilot model, nano-banana-2 (6 / 6)', () => {
    expect(estimateCredits('text-to-image')).toBe(6);
    expect(estimateCredits('image-to-image')).toBe(6);
  });

  it('a pose on a nano-banana model is priced as nano-banana-pro', () => {
    expect(effectiveImageModel('nano-banana', 'a-pose')).toBe('nano-banana-pro');
    expect(effectiveImageModel('nano-banana-2', 'a-pose')).toBe('nano-banana-2');
    expect(effectiveImageModel('nano-banana', 'none')).toBe('nano-banana');
  });

  it('the pilot budget arithmetic in the design: 4 x nano-banana-2 + 3 x gpt-image-2 i2i = 60 credits', () => {
    expect(4 * estimateCredits('image-to-image', { imageModel: 'nano-banana-2' }) + 3 * estimateCredits('image-to-image', { imageModel: 'gpt-image-2' })).toBe(60);
  });

  it('estimate --count multiplies, and refuses a non-integer count', () => {
    expect(parseEstimateImageGenArgs(['--model', 'gpt-image-2', '--count', '3'], 'i2i')).toMatchObject({ model: 'gpt-image-2', count: 3 });
    expect(() => parseEstimateImageGenArgs(['--count', '0'], 'i2i')).toThrow(/--count/);
    expect(() => parseEstimateImageGenArgs(['--count', '2.5'], 'i2i')).toThrow(/--count/);
    expect(() => parseEstimateImageGenArgs(['--model', 'nano-banana-3'], 't2i')).toThrow(/invalid model/);
  });
});

describe('refusals', () => {
  it('t2i and i2i refuse to run off a terminal without --yes', () => {
    expect(() => parseT2iArgs(['a prompt'], NO_TTY)).toThrow(/refusing to run non-interactively without --yes/);
    expect(() => parseI2iArgs(['--prompt', 'p', 'a.png'], NO_TTY)).toThrow(/refusing to run non-interactively without --yes/);
  });

  it('--yes lets them parse off a terminal, and a terminal may prompt instead', () => {
    expect(parseT2iArgs(['a prompt', '--yes'], NO_TTY).yes).toBe(true);
    expect(parseI2iArgs(['--prompt', 'p', 'a.png', '--yes'], NO_TTY).yes).toBe(true);
    expect(parseT2iArgs(['a prompt'], TTY).yes).toBe(false);
  });

  it('refuses --plan free', () => {
    expect(() => parseT2iArgs(['p', '--yes', '--plan', 'free'], NO_TTY)).toThrow(/free plan/);
    expect(() => parseT2iArgs(['p', '--yes', '--plan', 'Pro!'], NO_TTY)).toThrow(/invalid plan/);
    expect(parseT2iArgs(['p', '--yes', '--plan', 'Pro'], NO_TTY).plan).toBe('pro');
  });

  it('3:2 is for the GPT Image models only', () => {
    expect(() => parseT2iArgs(['p', '--yes', '--aspect', '3:2'], NO_TTY)).toThrow(/GPT Image models only/);
    expect(() => parseI2iArgs(['--prompt', 'p', 'a.png', '--yes', '--model', 'nano-banana-2', '--aspect', '2:3'], NO_TTY)).toThrow(/GPT Image models only/);
    expect(parseT2iArgs(['p', '--yes', '--model', 'gpt-image-2', '--aspect', '3:2'], NO_TTY).aspect).toBe('3:2');
    expect(parseT2iArgs(['p', '--yes', '--aspect', '4:3'], NO_TTY).aspect).toBe('4:3');
  });

  it('--aspect and --multi-view together are refused (Meshy answers 400)', () => {
    expect(() => parseT2iArgs(['p', '--yes', '--aspect', '4:3', '--multi-view'], NO_TTY)).toThrow(/cannot be sent together/);
  });

  it('i2i refuses references together with --from-task (Meshy would drop the references)', () => {
    expect(() => parseI2iArgs(['--prompt', 'p', 'a.png', '--from-task', 'abc', '--yes'], NO_TTY)).toThrow(/DROPS the references/);
  });

  it('i2i needs a reference or a task, a prompt, and at most five references', () => {
    expect(() => parseI2iArgs(['--prompt', 'p', '--yes'], NO_TTY)).toThrow(/give 1-5 reference images/);
    expect(() => parseI2iArgs(['a.png', '--yes'], NO_TTY)).toThrow(/--prompt/);
    expect(() => parseI2iArgs(['--prompt', 'p', '--yes', ...['1', '2', '3', '4', '5', '6'].map((n) => `${n}.png`)], NO_TTY)).toThrow(/at most 5/);
    expect(parseI2iArgs(['--prompt', 'p', '--yes', '--from-task', 'abc'], NO_TTY).fromTask).toBe('abc');
  });

  it('t2i needs exactly one quoted prompt, and an unknown flag is named', () => {
    expect(() => parseT2iArgs(['--yes'], NO_TTY)).toThrow(/missing required <prompt>/);
    expect(() => parseT2iArgs(['two', 'words', '--yes'], NO_TTY)).toThrow(/unexpected extra/);
    expect(() => parseT2iArgs(['p', '--yes', '--reference', 'a.png'], NO_TTY)).toThrow(/unrecognised flag "--reference"/);
  });
});

describe('request bodies', () => {
  it('t2i sends only what was asked for, and no negative_prompt field (there is none)', () => {
    const opts = parseT2iArgs(['a rifle squad', '--yes', '--model', 'gpt-image-2', '--aspect', '3:2', '--negative', 'text, logos.'], NO_TTY);
    const body = buildT2iRequest(opts);
    expect(body).toEqual({ ai_model: 'gpt-image-2', prompt: 'a rifle squad\n\nAvoid: text, logos.', aspect_ratio: '3:2' });
    expect(JSON.stringify(body)).not.toContain('negative_prompt');
  });

  it('composePrompt leaves a prompt with no negative untouched', () => {
    expect(composePrompt('  a  ', undefined)).toBe('a');
    expect(composePrompt('a', '   ')).toBe('a');
  });

  it('i2i carries references as data URIs and never prints them', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'meshy-i2i-'));
    try {
      const f = path.join(dir, 'guide.png');
      writeFileSync(f, Buffer.from([137, 80, 78, 71, 1, 2, 3]));
      const opts = parseI2iArgs(['--prompt', 'paint', f, '--yes'], NO_TTY);
      const refs = opts.references.map(resolveReference);
      const body = buildI2iRequest(opts, refs);
      expect(body.reference_image_urls?.[0]).toMatch(/^data:image\/png;base64,/);
      expect(body).not.toHaveProperty('input_task_id');
      const shown = JSON.stringify(loggableI2i(body));
      expect(shown).not.toContain('base64,iVBO');
      expect(shown).toContain('not printed');
      expect(refs[0].sha256).toBe(sha256(Buffer.from([137, 80, 78, 71, 1, 2, 3])));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('i2i from a task sends input_task_id and no references', () => {
    const body = buildI2iRequest(parseI2iArgs(['--prompt', 'p', '--from-task', 'abc', '--yes'], NO_TTY), []);
    expect(body).toEqual({ ai_model: 'nano-banana-2', prompt: 'p', input_task_id: 'abc' });
  });

  it('a reference with the wrong extension is refused before anything is read into a request', () => {
    expect(() => resolveReference('/tmp/x.gif')).toThrow(/unsupported extension/);
    expect(resolveReference('https://example.com/a.png').url).toBe('https://example.com/a.png');
  });
});

describe('provenance line (G-C5)', () => {
  it('names the generator, model, plan, task, prompt hash and references, and discloses', () => {
    const line = buildImageProvenanceLine({
      kind: 'i2i',
      imagePath: 'art/meshy/x/image_0.png',
      model: 'nano-banana-2',
      plan: 'pro',
      taskId: 'task-9',
      promptSha256: 'aa',
      referenceSha256: ['bb', 'cc'],
      generatedAt: '2026-11-01',
    });
    expect(line).toContain('Meshy AI image-to-image (nano-banana-2, plan pro, prompt sha256 aa, references sha256 bb+cc)');
    expect(line).toContain('disclosed per CONTRIBUTING.md');
    expect(line).toContain('task task-9');
  });
});

function okTask(id: string, extra: Partial<ImageGenTask> = {}): ImageGenTask {
  // no image_urls, so the download step finds nothing to fetch and makes no network call
  return { id, status: 'SUCCEEDED', progress: 100, ...extra };
}

describe('runT2i / runI2i against a fake client', () => {
  let dir: string;
  let paths: { artDir: string; ledgerPath: string };
  let envDry: string | undefined;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dir = mkdtempSync(path.join(tmpdir(), 'meshy-img-test-'));
    paths = { artDir: path.join(dir, 'art'), ledgerPath: path.join(dir, 'ledger.jsonl') };
    envDry = process.env.MESHY_DRY_RUN;
    delete process.env.MESHY_DRY_RUN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (envDry === undefined) delete process.env.MESHY_DRY_RUN;
    else process.env.MESHY_DRY_RUN = envDry;
    rmSync(dir, { recursive: true, force: true });
  });

  it('a t2i spend writes ONE ledger line carrying plan, model, prompt hash, estimate and the patched consumed credits', async () => {
    const client: T2iTaskClient = {
      submitT2iTask: vi.fn(async () => ({ result: 'img-1' })),
      getT2iTask: vi.fn(async (id: string) => okTask(id, { consumed_credits: 6 })),
    };
    const code = await runT2i(client, CONFIG, parseT2iArgs(['a squad', '--yes'], NO_TTY), paths);
    expect(code).toBe(0);
    const entries = readLedger(paths.ledgerPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'img-1', kind: 't2i', mode: 't2i', plan: 'pro', model: 'nano-banana-2', credits_estimated: 6, credits_consumed: 6,
      prompt_sha256: sha256('a squad'),
    });
  });

  it('an i2i spend records the sha256 of every local reference, in order', async () => {
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.webp');
    writeFileSync(a, 'AAA');
    writeFileSync(b, 'BBB');
    const client: I2iTaskClient = {
      submitI2iTask: vi.fn(async () => ({ result: 'img-2' })),
      getI2iTask: vi.fn(async (id: string) => okTask(id)),
    };
    const opts = parseI2iArgs(['--prompt', 'p', a, b, '--model', 'gpt-image-2', '--yes', '--plan', 'studio'], NO_TTY);
    expect(await runI2i(client, CONFIG, opts, paths)).toBe(0);
    expect(readLedger(paths.ledgerPath)[0]).toMatchObject({
      kind: 'i2i', plan: 'studio', model: 'gpt-image-2', credits_estimated: 12, reference_sha256: [sha256('AAA'), sha256('BBB')],
    });
  });

  it('a spend with no plan recorded is refused BEFORE the POST, and writes no ledger line', async () => {
    const submit = vi.fn(async () => ({ result: 'never' }));
    const client: T2iTaskClient = { submitT2iTask: submit, getT2iTask: vi.fn(async (id: string) => okTask(id)) };
    const noPlan: MeshyConfig = { ...CONFIG, plan: undefined };
    const code = await runT2i(client, noPlan, parseT2iArgs(['a squad', '--yes'], NO_TTY), paths);
    expect(code).toBe(1);
    expect(submit).not.toHaveBeenCalled();
    expect(readLedger(paths.ledgerPath)).toHaveLength(0);
  });

  it('--plan wins over MESHY_PLAN', async () => {
    const client: T2iTaskClient = { submitT2iTask: vi.fn(async () => ({ result: 'img-3' })), getT2iTask: vi.fn(async (id: string) => okTask(id)) };
    await runT2i(client, CONFIG, parseT2iArgs(['a squad', '--yes', '--plan', 'max'], NO_TTY), paths);
    expect(readLedger(paths.ledgerPath)[0]).toMatchObject({ plan: 'max' });
  });

  it('MESHY_DRY_RUN=1 runs with no client and no key, prints the request, and spends and writes nothing', async () => {
    process.env.MESHY_DRY_RUN = '1';
    const log = vi.mocked(console.log);
    expect(await runT2i(undefined, { ...CONFIG, apiKey: undefined, apiKeySource: 'none', plan: undefined }, parseT2iArgs(['a squad', '--yes'], NO_TTY), paths)).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('printing the request and stopping before any POST');
    expect(readLedger(paths.ledgerPath)).toHaveLength(0);
  });

  it('a dry-run i2i prints no data URI', async () => {
    process.env.MESHY_DRY_RUN = '1';
    const f = path.join(dir, 'g.png');
    writeFileSync(f, 'PNGDATA');
    expect(await runI2i(undefined, { ...CONFIG, apiKey: undefined, apiKeySource: 'none' }, parseI2iArgs(['--prompt', 'p', f, '--yes'], NO_TTY), paths)).toBe(0);
    const out = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(out).toContain('not printed');
    expect(out).not.toContain(Buffer.from('PNGDATA').toString('base64'));
  });

  it('a failed task leaves the estimate-only line and returns 1', async () => {
    const client: T2iTaskClient = {
      submitT2iTask: vi.fn(async () => ({ result: 'img-4' })),
      getT2iTask: vi.fn(async (id: string) => okTask(id, { status: 'FAILED', task_error: { message: 'boom' } })),
    };
    expect(await runT2i(client, CONFIG, parseT2iArgs(['a squad', '--yes'], NO_TTY), paths)).toBe(1);
    const entries = readLedger(paths.ledgerPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].credits_consumed).toBeUndefined();
  });
});
