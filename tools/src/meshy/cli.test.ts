/**
 * `runText`/`runImage` (`cli.ts`) against a fake client -- no network, no
 * real `art/meshy/` writes (a temp `paths` override is passed explicitly to
 * every call here). Covers two review findings that only show up in the
 * orchestration `cli.ts` does, not in any pure module:
 *
 * - Important 1: after a task reaches SUCCEEDED, the ledger line written
 *   before the poll must be PATCHED with the real `credits_consumed` Meshy
 *   reports, and a run that never reaches SUCCEEDED must leave the
 *   estimate-only line untouched.
 * - Minor 2: under `MESHY_DRY_RUN=1`, `text`/`image` must run with no API
 *   key configured at all -- the dry-run branch prints the request and
 *   returns before ever touching `client`.
 *
 * `MeshyClient` itself can't be faked with a plain object literal (it has a
 * private `apiKey` field, so TS requires nominal compatibility); `client.ts`
 * exports `TextTaskClient`/`ImageTaskClient`, the narrower structural
 * interfaces `runText`/`runImage` actually depend on, exactly so a fake can
 * satisfy them.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageToThreeDTask, SubmitTaskResponse, TextToThreeDRequest, TextToThreeDTask } from './api-types';
import type { ImageOptions, TextOptions } from './args';
import type { ImageTaskClient, TextTaskClient } from './client';
import type { MeshyConfig } from './config';
import { runImage, runText } from './cli';
import { readLedger, summarizeLedger } from './ledger';

const CONFIG: MeshyConfig = {
  apiKey: 'fake-test-key-not-real',
  apiKeySource: 'env',
  usdPerCredit: 0.02,
  usdPerCreditSource: 'none',
  keyFile: '/dev/null',
};

const NO_KEY_CONFIG: MeshyConfig = { ...CONFIG, apiKey: undefined, apiKeySource: 'none' };

function baseTextOptions(overrides: Partial<TextOptions> = {}): TextOptions {
  return {
    name: undefined,
    modelType: 'standard',
    aiModel: 'meshy-6',
    polycount: 30000,
    topology: 'triangle',
    ultra: false,
    pbr: false,
    textureResolution: '2k',
    texturePrompt: undefined,
    formats: ['glb'],
    yes: true, // skip the stdin confirmation prompt
    json: false,
    prompt: 'a test prompt',
    refine: false,
    ...overrides,
  };
}

function baseImageOptions(overrides: Partial<ImageOptions> = {}): ImageOptions {
  return {
    name: undefined,
    modelType: 'standard',
    aiModel: 'meshy-6',
    polycount: 30000,
    topology: 'triangle',
    ultra: false,
    pbr: false,
    textureResolution: '2k',
    texturePrompt: undefined,
    formats: ['glb'],
    yes: true,
    json: false,
    pathOrUrl: 'https://example.com/source.png', // http -- resolveImageUrl passes it through, no file read
    noTexture: false,
    ...overrides,
  };
}

/** Task responses with no `model_urls`/`thumbnail_url`/`texture_urls`, so
 *  `downloadTaskOutputs` finds nothing to fetch and makes no network call. */
function textTask(id: string, extra: Partial<TextToThreeDTask> = {}): TextToThreeDTask {
  return { id, status: 'SUCCEEDED', progress: 100, ...extra };
}
function imageTask(id: string, extra: Partial<ImageToThreeDTask> = {}): ImageToThreeDTask {
  return { id, status: 'SUCCEEDED', progress: 100, ...extra };
}

describe('runText / runImage ledger patch and dry-run wiring', () => {
  let dir: string;
  let paths: { artDir: string; ledgerPath: string };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'meshy-cli-test-'));
    paths = { artDir: path.join(dir, 'art'), ledgerPath: path.join(dir, 'ledger.jsonl') };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('Important 1 -- the ledger records consumed credits', () => {
    it('(a) a successful preview-only run leaves exactly one line, carrying both the estimate and credits_consumed', async () => {
      const client: TextTaskClient = {
        submitTextTask: vi.fn(async (): Promise<SubmitTaskResponse> => ({ result: 'preview-task-1' })),
        getTextTask: vi.fn(async (id: string): Promise<TextToThreeDTask> => textTask(id, { consumed_credits: 18 })),
      };

      const code = await runText(client, CONFIG, baseTextOptions(), paths);

      expect(code).toBe(0);
      const entries = readLedger(paths.ledgerPath);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: 'preview-task-1', credits_estimated: 20, credits_consumed: 18 });
      const summary = summarizeLedger(entries);
      expect(summary.creditsEstimated).toBe(20);
      expect(summary.creditsConsumed).toBe(18);
    });

    it('(a) a successful text+refine run patches both the preview and the refine line (cli.ts:279/:310 sites)', async () => {
      const client: TextTaskClient = {
        submitTextTask: vi.fn(async (body: TextToThreeDRequest): Promise<SubmitTaskResponse> => ({
          result: body.mode === 'preview' ? 'preview-task-2' : 'refine-task-2',
        })),
        getTextTask: vi.fn(async (id: string): Promise<TextToThreeDTask> =>
          id === 'preview-task-2' ? textTask(id, { consumed_credits: 19 }) : textTask(id, { consumed_credits: 9 })
        ),
      };

      const code = await runText(client, CONFIG, baseTextOptions({ refine: true }), paths);

      expect(code).toBe(0);
      const entries = readLedger(paths.ledgerPath);
      expect(entries).toHaveLength(2);
      expect(entries.find((e) => e.id === 'preview-task-2')).toMatchObject({ credits_estimated: 20, credits_consumed: 19 });
      expect(entries.find((e) => e.id === 'refine-task-2')).toMatchObject({ credits_estimated: 10, credits_consumed: 9 });
    });

    it('(a) a successful image-to-3d run patches its ledger line (cli.ts:402 site)', async () => {
      const client: ImageTaskClient = {
        submitImageTask: vi.fn(async (): Promise<SubmitTaskResponse> => ({ result: 'image-task-1' })),
        getImageTask: vi.fn(async (id: string): Promise<ImageToThreeDTask> => imageTask(id, { consumed_credits: 33 })),
      };

      const code = await runImage(client, CONFIG, baseImageOptions(), paths);

      expect(code).toBe(0);
      const entries = readLedger(paths.ledgerPath);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ id: 'image-task-1', credits_estimated: 30, credits_consumed: 33 });
    });

    it('(b) a run that fails before success leaves the estimate-only line intact', async () => {
      const client: TextTaskClient = {
        submitTextTask: vi.fn(async (): Promise<SubmitTaskResponse> => ({ result: 'preview-task-failed' })),
        getTextTask: vi.fn(
          async (id: string): Promise<TextToThreeDTask> => textTask(id, { status: 'FAILED', progress: 40, task_error: { message: 'boom' } })
        ),
      };

      const code = await runText(client, CONFIG, baseTextOptions(), paths);

      expect(code).toBe(1);
      const entries = readLedger(paths.ledgerPath);
      expect(entries).toHaveLength(1);
      expect(entries[0].credits_estimated).toBe(20);
      expect(entries[0].credits_consumed).toBeUndefined();
    });

    it('(b) a run interrupted mid-poll (network error) leaves the estimate-only line intact', async () => {
      const client: TextTaskClient = {
        submitTextTask: vi.fn(async (): Promise<SubmitTaskResponse> => ({ result: 'preview-task-crash' })),
        getTextTask: vi.fn(async (): Promise<TextToThreeDTask> => {
          throw new Error('simulated network crash mid-poll');
        }),
      };

      await expect(runText(client, CONFIG, baseTextOptions(), paths)).rejects.toThrow(/simulated network crash/);

      const entries = readLedger(paths.ledgerPath);
      expect(entries).toHaveLength(1);
      expect(entries[0].credits_estimated).toBe(20);
      expect(entries[0].credits_consumed).toBeUndefined();
    });
  });

  describe('Minor 2 -- dry run needs no client and no key', () => {
    const originalDryRun = process.env.MESHY_DRY_RUN;

    afterEach(() => {
      if (originalDryRun === undefined) delete process.env.MESHY_DRY_RUN;
      else process.env.MESHY_DRY_RUN = originalDryRun;
    });

    it('runText prints the request and returns 0 with no client and no key under MESHY_DRY_RUN=1', async () => {
      process.env.MESHY_DRY_RUN = '1';
      const code = await runText(undefined, NO_KEY_CONFIG, baseTextOptions(), paths);
      expect(code).toBe(0);
      expect(readLedger(paths.ledgerPath)).toEqual([]); // nothing was spent, nothing was logged
    });

    it('runImage prints the request and returns 0 with no client and no key under MESHY_DRY_RUN=1', async () => {
      process.env.MESHY_DRY_RUN = '1';
      const code = await runImage(undefined, NO_KEY_CONFIG, baseImageOptions(), paths);
      expect(code).toBe(0);
      expect(readLedger(paths.ledgerPath)).toEqual([]);
    });

    // Defensive: this shape only actually arises if `main()`'s own
    // MESHY_DRY_RUN gate (see args.ts's `commandNeedsApiKey`, used by
    // cli.ts's main()) is wrong and hands runText/runImage an undefined
    // client outside a dry run. Watched red: with the `if (!client) throw`
    // guard removed from runText, this test fails with a TypeError from
    // `client.submitTextTask` instead of the intended internal error.
    it('runText throws a clear internal error if ever given no client outside a dry run', async () => {
      delete process.env.MESHY_DRY_RUN;
      await expect(runText(undefined, NO_KEY_CONFIG, baseTextOptions(), paths)).rejects.toThrow(/no client outside MESHY_DRY_RUN/);
    });

    it('runImage throws a clear internal error if ever given no client outside a dry run', async () => {
      delete process.env.MESHY_DRY_RUN;
      await expect(runImage(undefined, NO_KEY_CONFIG, baseImageOptions(), paths)).rejects.toThrow(/no client outside MESHY_DRY_RUN/);
    });
  });
});
