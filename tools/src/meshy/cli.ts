/**
 * `pnpm meshy -- <command>` -- a token-disciplined proxy over the Meshy
 * text-to-3D, image-to-3D and remesh APIs. See `docs/ART_PIPELINE.md`'s
 * "Meshy API" section for the workflow and policy this enforces: estimate
 * before you spend, announce the plan, download into `art/meshy/`, log every
 * spend to `art/meshy/ledger.jsonl`.
 *
 * This file is the only one in the package that does network I/O, reads the
 * key, writes files, or prompts on stdin -- every other module here is pure
 * and independently testable. `MESHY_DRY_RUN=1` short-circuits all three
 * generate commands right before the POST that would submit a task, which is
 * the knob this file's own manual smoke tests (`MESHY_DRY_RUN=1 pnpm meshy --
 * ...`, see docs/ART_PIPELINE.md) are driven through, since a real submit
 * would spend credits. `runText`/`runImage`/`runRemesh` are additionally
 * exported and covered by `cli.test.ts` against a fake
 * `TextTaskClient`/`ImageTaskClient`/`RemeshTaskClient` (`client.ts`) and a
 * temp `MeshyPaths` override, so the ledger-patch and dry-run wiring below
 * are exercised by vitest too, still with no network.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import type { ImageToThreeDRequest, ImageToThreeDTask, RemeshRequest, RemeshTask, TextPreviewRequest, TextRefineRequest, TextToThreeDTask } from './api-types';
import {
  commandNeedsApiKey,
  parseBalanceArgs,
  parseDownloadArgs,
  parseEstimateImageArgs,
  parseEstimateRefineArgs,
  parseEstimateRemeshArgs,
  parseEstimateTextArgs,
  parseImageArgs,
  parseListArgs,
  parseRefineArgs,
  parseRemeshArgs,
  parseSpentArgs,
  parseStatusArgs,
  parseTextArgs,
  type BalanceOptions,
  type DownloadOptions,
  type ImageOptions,
  type ListOptions,
  type RefineOptions,
  type RemeshOptions,
  type SpentOptions,
  type StatusOptions,
  type TextOptions,
} from './args';
import { MeshyApiError, MeshyClient, type I2iTaskClient, type ImageTaskClient, type RemeshTaskClient, type T2iTaskClient, type TextTaskClient } from './client';
import { loadMeshyConfig, type MeshyConfig } from './config';
import {
  appendLedgerEntry,
  LEDGER_RELATIVE_PATH,
  patchLedgerCreditsConsumed,
  readLedger,
  summarizeLedger,
  type LedgerEntry,
} from './ledger';
import { isHttpUrl, resolveImageUrl, taskDirName } from './naming';
import { poseModeFor, TERMINAL_STATUSES, type TaskKind, type TaskStatus } from './options';
import { estimateCredits, estimateUsd, formatUsd, IMAGE_PRICING_SOURCE, PRICING_SOURCE } from './pricing';
import { buildProvenanceLine } from './provenance';
import {
  buildI2iRequest,
  buildImageProvenanceLine,
  buildT2iRequest,
  effectiveImageModel,
  loggableI2i,
  parseEstimateImageGenArgs,
  parseI2iArgs,
  parsePlan,
  parseT2iArgs,
  resolveReference,
  sha256,
  type I2iOptions,
  type ImageGenTask,
  type ResolvedReference,
  type T2iOptions,
} from './images';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ART_DIR = path.join(REPO_ROOT, 'art', 'meshy');
const LEDGER_PATH = path.join(REPO_ROOT, LEDGER_RELATIVE_PATH);
const POLL_INTERVAL_MS = 5000;

/** Where output and the ledger live. Defaulted to the real repo paths above
 *  everywhere `main()` calls in; overridable so `runText`/`runImage` are
 *  testable against a temp directory instead of the real `art/meshy/`. */
interface MeshyPaths {
  readonly artDir: string;
  readonly ledgerPath: string;
}
const DEFAULT_PATHS: MeshyPaths = { artDir: ART_DIR, ledgerPath: LEDGER_PATH };

// ---------------------------------------------------------------------------
// Small IO helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollTask<T extends { status: TaskStatus; progress: number; id: string }>(
  fetchTask: () => Promise<T>,
  label: string
): Promise<T> {
  for (;;) {
    const task = await fetchTask();
    console.log(`  ${label}: ${task.status} (${task.progress}%)`);
    if (TERMINAL_STATUSES.has(task.status)) return task;
    await sleep(POLL_INTERVAL_MS);
  }
}

function extFromUrl(url: string): string {
  try {
    const ext = path.extname(new URL(url).pathname);
    return ext.length > 0 ? ext : '.bin';
  } catch {
    return '.bin';
  }
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${url} -> HTTP ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/** Every format in `model_urls`, the thumbnail(s), and every texture map --
 *  whatever the finished task actually carries, nothing hardcoded to one
 *  format list. */
async function downloadTaskOutputs(task: TextToThreeDTask | ImageToThreeDTask | RemeshTask, dir: string): Promise<readonly string[]> {
  mkdirSync(dir, { recursive: true });
  const jobs: { url: string; filename: string }[] = [];

  if (task.model_urls) {
    for (const [format, url] of Object.entries(task.model_urls)) {
      if (typeof url === 'string' && url.length > 0) jobs.push({ url, filename: `model.${format}` });
    }
  }
  if (task.thumbnail_url) jobs.push({ url: task.thumbnail_url, filename: `thumbnail${extFromUrl(task.thumbnail_url)}` });
  if (task.alpha_thumbnail_url) {
    jobs.push({ url: task.alpha_thumbnail_url, filename: `alpha_thumbnail${extFromUrl(task.alpha_thumbnail_url)}` });
  }
  if ('thumbnail_urls' in task && task.thumbnail_urls) {
    task.thumbnail_urls.forEach((url, i) => {
      if (url) jobs.push({ url, filename: `thumbnail_${i}${extFromUrl(url)}` });
    });
  }
  if (task.texture_urls) {
    task.texture_urls.forEach((set, i) => {
      for (const [map, url] of Object.entries(set)) {
        if (typeof url === 'string' && url.length > 0) jobs.push({ url, filename: `texture_${i}_${map}${extFromUrl(url)}` });
      }
    });
  }

  for (const job of jobs) await downloadFile(job.url, path.join(dir, job.filename));
  return jobs.map((j) => j.filename);
}

function writeTaskJson(dir: string, data: Readonly<Record<string, unknown>>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'task.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function confirmSpend(credits: number, usd: number, alreadyYes: boolean): Promise<boolean> {
  console.log(`about to spend: ${credits} credits (~${formatUsd(usd)})`);
  if (alreadyYes) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('Proceed? [y/N] ');
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

function priceCaption(credits: number, usdPerCredit: number): string {
  const usd = estimateUsd(credits, usdPerCredit);
  return `${credits} credits (~${formatUsd(usd)} at ${formatUsd(usdPerCredit)}/credit, ${PRICING_SOURCE.url} quoted ${PRICING_SOURCE.quotedAt})`;
}

// ---------------------------------------------------------------------------
// estimate
// ---------------------------------------------------------------------------

function runEstimate(rest: readonly string[], usdPerCredit: number): number {
  const subkind = rest[0];
  if (subkind === 't2i' || subkind === 'i2i') return runEstimateImageGen(subkind, rest.slice(1), usdPerCredit);
  if (subkind !== 'text' && subkind !== 'image' && subkind !== 'remesh' && subkind !== 'refine') {
    console.error('estimate: expected "text", "image", "remesh", "refine", "t2i" or "i2i" as the first argument');
    return 1;
  }
  if (subkind === 'refine') {
    const opts = parseEstimateRefineArgs(rest.slice(1));
    const credits = estimateCredits('text-refine', { textureResolution: opts.textureResolution });
    if (opts.json) {
      console.log(JSON.stringify({ kind: 'refine', credits, usd: estimateUsd(credits, usdPerCredit), usdPerCredit, source: PRICING_SOURCE }));
    } else {
      console.log(`estimate: refine ${priceCaption(credits, usdPerCredit)}`);
    }
    return 0;
  }
  if (subkind === 'remesh') {
    const opts = parseEstimateRemeshArgs(rest.slice(1));
    const credits = estimateCredits('remesh');
    if (opts.json) {
      console.log(JSON.stringify({ kind: 'remesh', credits, usd: estimateUsd(credits, usdPerCredit), usdPerCredit, source: PRICING_SOURCE }));
    } else {
      console.log(`estimate: remesh ${priceCaption(credits, usdPerCredit)}`);
    }
    return 0;
  }
  if (subkind === 'text') {
    const opts = parseEstimateTextArgs(rest.slice(1));
    const previewCredits = estimateCredits('text-preview', { modelType: opts.modelType, aiModel: opts.aiModel, ultra: opts.ultra });
    const refineCredits = opts.refine ? estimateCredits('text-refine', { textureResolution: opts.textureResolution }) : 0;
    const credits = previewCredits + refineCredits;
    const usd = estimateUsd(credits, usdPerCredit);
    if (opts.json) {
      console.log(JSON.stringify({ kind: 'text', previewCredits, refineCredits, credits, usd, usdPerCredit, source: PRICING_SOURCE }));
    } else {
      console.log(
        `estimate: text preview ${previewCredits} credits` +
          (opts.refine ? ` + refine ${refineCredits} credits` : '') +
          ` = ${priceCaption(credits, usdPerCredit)}`
      );
    }
    return 0;
  }
  const opts = parseEstimateImageArgs(rest.slice(1));
  const credits = estimateCredits('image', {
    modelType: opts.modelType,
    aiModel: opts.aiModel,
    ultra: opts.ultra,
    shouldTexture: !opts.noTexture,
    textureResolution: opts.textureResolution,
  });
  if (opts.json) {
    console.log(JSON.stringify({ kind: 'image', credits, usd: estimateUsd(credits, usdPerCredit), usdPerCredit, source: PRICING_SOURCE }));
  } else {
    console.log(`estimate: image-to-3d ${priceCaption(credits, usdPerCredit)}`);
  }
  return 0;
}

function imagePriceCaption(credits: number, usdPerCredit: number): string {
  const usd = estimateUsd(credits, usdPerCredit);
  return `${credits} credits (~${formatUsd(usd)} at ${formatUsd(usdPerCredit)}/credit, ${IMAGE_PRICING_SOURCE.url} quoted ${IMAGE_PRICING_SOURCE.quotedAt})`;
}

function runEstimateImageGen(kind: 't2i' | 'i2i', rest: readonly string[], usdPerCredit: number): number {
  const opts = parseEstimateImageGenArgs(rest, kind);
  const eff = effectiveImageModel(opts.model, opts.pose);
  const each = estimateCredits(kind === 't2i' ? 'text-to-image' : 'image-to-image', { imageModel: eff });
  const credits = each * opts.count;
  if (opts.json) {
    console.log(JSON.stringify({ kind, model: opts.model, runsAs: eff, each, count: opts.count, credits, usd: estimateUsd(credits, usdPerCredit), usdPerCredit, source: IMAGE_PRICING_SOURCE }));
  } else {
    console.log(
      `estimate: ${kind === 't2i' ? 'text-to-image' : 'image-to-image'} ${opts.model}${eff !== opts.model ? ` (runs as ${eff})` : ''}` +
        `${opts.count > 1 ? ` ${each} x ${opts.count} attempts` : ''} = ${imagePriceCaption(credits, usdPerCredit)}`
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------
// spent
// ---------------------------------------------------------------------------

function runSpent(opts: SpentOptions): number {
  const summary = summarizeLedger(readLedger(LEDGER_PATH));
  if (opts.json) {
    console.log(JSON.stringify(summary));
  } else {
    console.log(
      `spent: ${summary.count} task(s) -- ${summary.creditsEstimated} credits estimated, ` +
        `${summary.creditsConsumed} consumed (as reported by Meshy), ~${formatUsd(summary.usdEstimated)} estimated`
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------
// balance
// ---------------------------------------------------------------------------

async function runBalance(client: MeshyClient, opts: BalanceOptions): Promise<number> {
  const res = await client.getBalance();
  if (opts.json) console.log(JSON.stringify(res));
  else console.log(`balance: ${res.balance} credits`);
  return 0;
}

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

function buildPreviewRequest(opts: TextOptions): TextPreviewRequest {
  return {
    mode: 'preview',
    prompt: opts.prompt,
    ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
    model_type: opts.modelType,
    ai_model: opts.aiModel,
    ...(opts.ultra ? { ultra_mode: true } : {}),
    topology: opts.topology,
    target_polycount: opts.polycount,
    pose_mode: poseModeFor(opts.pose),
    target_formats: opts.formats,
    origin_at: 'bottom',
  };
}

function buildRefineRequest(opts: TextOptions, previewTaskId: string): TextRefineRequest {
  return {
    mode: 'refine',
    preview_task_id: previewTaskId,
    ...(opts.pbr ? { enable_pbr: true } : {}),
    texture_resolution: opts.textureResolution,
    ...(opts.texturePrompt ? { texture_prompt: opts.texturePrompt } : {}),
  };
}

function ledgerEntry(kind: TaskKind, mode: LedgerEntry['mode'], id: string, opts: { name?: string; prompt?: string }, creditsEstimated: number, usdPerCredit: number, plan?: string): LedgerEntry {
  return {
    at: new Date().toISOString(),
    kind,
    mode,
    id,
    name: opts.name,
    prompt: opts.prompt,
    credits_estimated: creditsEstimated,
    usd_estimated: estimateUsd(creditsEstimated, usdPerCredit),
    // GH-933: the plan tier each spend ran under, from MESHY_PLAN; 'unknown' when it is not named. Old rows have no field.
    plan: plan?.trim().toLowerCase() || 'unknown',
  };
}

export async function runText(
  client: TextTaskClient | undefined,
  config: MeshyConfig,
  opts: TextOptions,
  paths: MeshyPaths = DEFAULT_PATHS
): Promise<number> {
  const previewCredits = estimateCredits('text-preview', { modelType: opts.modelType, aiModel: opts.aiModel, ultra: opts.ultra });
  const refineCredits = opts.refine ? estimateCredits('text-refine', { textureResolution: opts.textureResolution }) : 0;
  const totalCredits = previewCredits + refineCredits;

  console.log(`plan: text-to-3d preview "${opts.prompt}" (${opts.aiModel}, ${opts.modelType}, ${opts.polycount} tri budget${opts.pose !== 'none' ? `, ${opts.pose}` : ''})${opts.refine ? ' + refine' : ''}`);
  console.log(`estimate: ${priceCaption(totalCredits, config.usdPerCredit)}`);

  const previewBody = buildPreviewRequest(opts);

  if (process.env.MESHY_DRY_RUN === '1') {
    console.log('MESHY_DRY_RUN=1 -- printing the request and stopping before any POST:');
    console.log(JSON.stringify(previewBody, null, 2));
    if (opts.refine) console.log('(refine would follow, against whatever preview id the real submit returns)');
    return 0;
  }

  if (!client) {
    // Unreachable from `main()`: it only omits the client when
    // MESHY_DRY_RUN=1, which already returned above.
    throw new Error('internal: runText called with no client outside MESHY_DRY_RUN=1');
  }

  if (!(await confirmSpend(totalCredits, estimateUsd(totalCredits, config.usdPerCredit), opts.yes))) {
    console.log('aborted -- nothing was spent');
    return 1;
  }

  const submitted = await client.submitTextTask(previewBody);
  const previewId = submitted.result;
  appendLedgerEntry(paths.ledgerPath, ledgerEntry('text', 'preview', previewId, opts, previewCredits, config.usdPerCredit, config.plan));
  console.log(`submitted preview task ${previewId}`);

  const finalPreview = await pollTask(() => client.getTextTask(previewId), `preview ${previewId}`);
  if (finalPreview.status !== 'SUCCEEDED') {
    console.error(`preview task ${previewId} ended ${finalPreview.status}: ${finalPreview.task_error?.message ?? '(no message)'}`);
    return 1;
  }
  if (finalPreview.consumed_credits !== undefined) {
    patchLedgerCreditsConsumed(paths.ledgerPath, previewId, finalPreview.consumed_credits);
  }

  const dirName = taskDirName(opts.name ?? opts.prompt, previewId);
  const dir = path.join(paths.artDir, dirName);
  await downloadTaskOutputs(finalPreview, dir);
  writeTaskJson(dir, {
    request: previewBody,
    response: finalPreview,
    consumed_credits: finalPreview.consumed_credits,
    timestamps: {
      created_at: finalPreview.created_at,
      started_at: finalPreview.started_at,
      finished_at: finalPreview.finished_at,
      expires_at: finalPreview.expires_at,
    },
    usd_estimated: estimateUsd(previewCredits, config.usdPerCredit),
  });
  console.log(`downloaded preview outputs into ${path.relative(REPO_ROOT, dir)}`);

  let finalDir = dir;
  if (opts.refine) {
    const refineBody = buildRefineRequest(opts, previewId);
    const submittedRefine = await client.submitTextTask(refineBody);
    const refineId = submittedRefine.result;
    appendLedgerEntry(paths.ledgerPath, ledgerEntry('text', 'refine', refineId, opts, refineCredits, config.usdPerCredit, config.plan));
    console.log(`submitted refine task ${refineId}`);

    const finalRefine = await pollTask(() => client.getTextTask(refineId), `refine ${refineId}`);
    if (finalRefine.status !== 'SUCCEEDED') {
      console.error(`refine task ${refineId} ended ${finalRefine.status}: ${finalRefine.task_error?.message ?? '(no message)'}`);
      return 1;
    }
    if (finalRefine.consumed_credits !== undefined) {
      patchLedgerCreditsConsumed(paths.ledgerPath, refineId, finalRefine.consumed_credits);
    }
    finalDir = path.join(dir, 'refine');
    await downloadTaskOutputs(finalRefine, finalDir);
    writeTaskJson(finalDir, {
      request: refineBody,
      response: finalRefine,
      consumed_credits: finalRefine.consumed_credits,
      timestamps: {
        created_at: finalRefine.created_at,
        started_at: finalRefine.started_at,
        finished_at: finalRefine.finished_at,
        expires_at: finalRefine.expires_at,
      },
      usd_estimated: estimateUsd(refineCredits, config.usdPerCredit),
    });
    console.log(`downloaded refine outputs into ${path.relative(REPO_ROOT, finalDir)}`);
  }

  const glbPath = path.relative(REPO_ROOT, path.join(finalDir, 'model.glb'));
  const provenance = buildProvenanceLine({
    kind: 'text',
    glbPath,
    aiModel: opts.aiModel,
    refined: opts.refine,
    pose: opts.pose,
    taskId: previewId,
    promptOrSource: opts.prompt,
    generatedAt: new Date().toISOString().slice(0, 10),
  });
  console.log('');
  console.log('Paste into docs/ASSET_PROVENANCE.md:');
  console.log(provenance);
  return 0;
}

// ---------------------------------------------------------------------------
// image
// ---------------------------------------------------------------------------

function buildImageRequest(opts: ImageOptions, imageUrl: string): ImageToThreeDRequest {
  return {
    image_url: imageUrl,
    model_type: opts.modelType,
    ai_model: opts.aiModel,
    ...(opts.ultra ? { ultra_mode: true } : {}),
    should_texture: !opts.noTexture,
    ...(opts.pbr ? { enable_pbr: true } : {}),
    texture_resolution: opts.textureResolution,
    ...(opts.texturePrompt ? { texture_prompt: opts.texturePrompt } : {}),
    topology: opts.topology,
    target_polycount: opts.polycount,
    // Sent only when asked for: an image task's body has never carried it.
    ...(opts.pose !== 'none' ? { pose_mode: poseModeFor(opts.pose) } : {}),
    target_formats: opts.formats,
    origin_at: 'bottom',
  };
}

export async function runImage(
  client: ImageTaskClient | undefined,
  config: MeshyConfig,
  opts: ImageOptions,
  paths: MeshyPaths = DEFAULT_PATHS
): Promise<number> {
  const credits = estimateCredits('image', {
    modelType: opts.modelType,
    aiModel: opts.aiModel,
    ultra: opts.ultra,
    shouldTexture: !opts.noTexture,
    textureResolution: opts.textureResolution,
  });

  console.log(
    `plan: image-to-3d from ${opts.pathOrUrl} (${opts.aiModel}, ${opts.modelType}, ${opts.polycount} tri budget${opts.pose !== 'none' ? `, ${opts.pose}` : ''}${opts.noTexture ? ', no texture' : ''})`
  );
  console.log(`estimate: ${priceCaption(credits, config.usdPerCredit)}`);

  const imageUrl = resolveImageUrl(opts.pathOrUrl);
  const body = buildImageRequest(opts, imageUrl);

  if (process.env.MESHY_DRY_RUN === '1') {
    console.log('MESHY_DRY_RUN=1 -- printing the request and stopping before any POST:');
    const loggable = isHttpUrl(imageUrl) ? body : { ...body, image_url: `<data-uri, ${imageUrl.length} chars, not printed>` };
    console.log(JSON.stringify(loggable, null, 2));
    return 0;
  }

  if (!client) {
    // Unreachable from `main()`: it only omits the client when
    // MESHY_DRY_RUN=1, which already returned above.
    throw new Error('internal: runImage called with no client outside MESHY_DRY_RUN=1');
  }

  if (!(await confirmSpend(credits, estimateUsd(credits, config.usdPerCredit), opts.yes))) {
    console.log('aborted -- nothing was spent');
    return 1;
  }

  const submitted = await client.submitImageTask(body);
  const id = submitted.result;
  appendLedgerEntry(paths.ledgerPath, ledgerEntry('image', 'image', id, { name: opts.name }, credits, config.usdPerCredit, config.plan));
  console.log(`submitted image-to-3d task ${id}`);

  const finalTask = await pollTask(() => client.getImageTask(id), `image ${id}`);
  if (finalTask.status !== 'SUCCEEDED') {
    console.error(`image task ${id} ended ${finalTask.status}: ${finalTask.task_error?.message ?? '(no message)'}`);
    return 1;
  }
  if (finalTask.consumed_credits !== undefined) {
    patchLedgerCreditsConsumed(paths.ledgerPath, id, finalTask.consumed_credits);
  }

  const dirName = taskDirName(opts.name ?? path.basename(opts.pathOrUrl), id);
  const dir = path.join(paths.artDir, dirName);
  await downloadTaskOutputs(finalTask, dir);
  writeTaskJson(dir, {
    request: { ...body, image_url: isHttpUrl(imageUrl) ? imageUrl : '<local file, base64-encoded at submit time>' },
    response: finalTask,
    consumed_credits: finalTask.consumed_credits,
    timestamps: {
      created_at: finalTask.created_at,
      started_at: finalTask.started_at,
      finished_at: finalTask.finished_at,
      expires_at: finalTask.expires_at,
    },
    usd_estimated: estimateUsd(credits, config.usdPerCredit),
  });
  console.log(`downloaded outputs into ${path.relative(REPO_ROOT, dir)}`);

  const glbPath = path.relative(REPO_ROOT, path.join(dir, 'model.glb'));
  const provenance = buildProvenanceLine({
    kind: 'image',
    glbPath,
    aiModel: opts.aiModel,
    refined: false,
    pose: opts.pose,
    taskId: id,
    promptOrSource: opts.pathOrUrl,
    generatedAt: new Date().toISOString().slice(0, 10),
  });
  console.log('');
  console.log('Paste into docs/ASSET_PROVENANCE.md:');
  console.log(provenance);
  return 0;
}

// ---------------------------------------------------------------------------
// remesh
// ---------------------------------------------------------------------------

function buildRemeshRequest(opts: RemeshOptions): RemeshRequest {
  return {
    input_task_id: opts.inputTaskId,
    target_formats: opts.formats,
    topology: opts.topology,
    target_polycount: opts.polycount,
  };
}

export async function runRemesh(
  client: RemeshTaskClient | undefined,
  config: MeshyConfig,
  opts: RemeshOptions,
  paths: MeshyPaths = DEFAULT_PATHS
): Promise<number> {
  const credits = estimateCredits('remesh');

  console.log(
    `plan: remesh ${opts.inputTaskId}${opts.kind ? ` (${opts.kind} source)` : ''} -> ${opts.polycount} tri, ${opts.topology} topology`
  );
  console.log(`estimate: ${priceCaption(credits, config.usdPerCredit)}`);

  const body = buildRemeshRequest(opts);

  if (process.env.MESHY_DRY_RUN === '1') {
    console.log('MESHY_DRY_RUN=1 -- printing the request and stopping before any POST:');
    console.log(JSON.stringify(body, null, 2));
    return 0;
  }

  if (!client) {
    // Unreachable from `main()`: it only omits the client when
    // MESHY_DRY_RUN=1, which already returned above.
    throw new Error('internal: runRemesh called with no client outside MESHY_DRY_RUN=1');
  }

  if (!(await confirmSpend(credits, estimateUsd(credits, config.usdPerCredit), opts.yes))) {
    console.log('aborted -- nothing was spent');
    return 1;
  }

  const submitted = await client.submitRemeshTask(body);
  const id = submitted.result;
  appendLedgerEntry(paths.ledgerPath, ledgerEntry('remesh', 'remesh', id, { name: opts.name }, credits, config.usdPerCredit, config.plan));
  console.log(`submitted remesh task ${id}`);

  const finalTask = await pollTask(() => client.getRemeshTask(id), `remesh ${id}`);
  if (finalTask.status !== 'SUCCEEDED') {
    console.error(`remesh task ${id} ended ${finalTask.status}: ${finalTask.task_error?.message ?? '(no message)'}`);
    return 1;
  }
  if (finalTask.consumed_credits !== undefined) {
    patchLedgerCreditsConsumed(paths.ledgerPath, id, finalTask.consumed_credits);
  }

  const dirName = taskDirName(opts.name ?? opts.inputTaskId, id);
  const dir = path.join(paths.artDir, dirName);
  await downloadTaskOutputs(finalTask, dir);
  writeTaskJson(dir, {
    request: body,
    response: finalTask,
    consumed_credits: finalTask.consumed_credits,
    timestamps: {
      created_at: finalTask.created_at,
      started_at: finalTask.started_at,
      finished_at: finalTask.finished_at,
    },
    usd_estimated: estimateUsd(credits, config.usdPerCredit),
  });
  console.log(`downloaded outputs into ${path.relative(REPO_ROOT, dir)}`);
  return 0;
}

// ---------------------------------------------------------------------------
// refine (standalone, against an existing preview task)
// ---------------------------------------------------------------------------

function buildStandaloneRefineRequest(opts: RefineOptions): TextRefineRequest {
  return {
    mode: 'refine',
    preview_task_id: opts.previewTaskId,
    ...(opts.pbr ? { enable_pbr: true } : {}),
    texture_resolution: opts.textureResolution,
    ...(opts.texturePrompt ? { texture_prompt: opts.texturePrompt } : {}),
  };
}

/**
 * The refine half of `runText` on its own: the preview already exists on
 * Meshy's side (B2's figures, 2026-09-30), so this buys its bake without a
 * second preview. Outputs land in their own `art/meshy/<name>-<date>-<id>/`
 * folder (a refine task has its own id); the ledger line is `kind: text,
 * mode: refine`, exactly what `text --refine` writes for the same spend.
 */
export async function runRefine(
  client: TextTaskClient | undefined,
  config: MeshyConfig,
  opts: RefineOptions,
  paths: MeshyPaths = DEFAULT_PATHS
): Promise<number> {
  const credits = estimateCredits('text-refine', { textureResolution: opts.textureResolution });
  console.log(`plan: refine preview ${opts.previewTaskId} (${opts.textureResolution}${opts.pbr ? ', pbr' : ''})`);
  console.log(`estimate: ${priceCaption(credits, config.usdPerCredit)}`);

  const body = buildStandaloneRefineRequest(opts);

  if (process.env.MESHY_DRY_RUN === '1') {
    console.log('MESHY_DRY_RUN=1 -- printing the request and stopping before any POST:');
    console.log(JSON.stringify(body, null, 2));
    return 0;
  }
  if (!client) {
    throw new Error('internal: runRefine called with no client outside MESHY_DRY_RUN=1');
  }
  if (!(await confirmSpend(credits, estimateUsd(credits, config.usdPerCredit), opts.yes))) {
    console.log('aborted -- nothing was spent');
    return 1;
  }

  const submitted = await client.submitTextTask(body);
  const id = submitted.result;
  appendLedgerEntry(paths.ledgerPath, ledgerEntry('text', 'refine', id, { name: opts.name }, credits, config.usdPerCredit, config.plan));
  console.log(`submitted refine task ${id}`);

  const finalTask = await pollTask(() => client.getTextTask(id), `refine ${id}`);
  if (finalTask.status !== 'SUCCEEDED') {
    console.error(`refine task ${id} ended ${finalTask.status}: ${finalTask.task_error?.message ?? '(no message)'}`);
    return 1;
  }
  if (finalTask.consumed_credits !== undefined) {
    patchLedgerCreditsConsumed(paths.ledgerPath, id, finalTask.consumed_credits);
  }

  const dirName = taskDirName(opts.name ?? opts.previewTaskId, id);
  const dir = path.join(paths.artDir, dirName);
  await downloadTaskOutputs(finalTask, dir);
  writeTaskJson(dir, {
    request: body,
    response: finalTask,
    consumed_credits: finalTask.consumed_credits,
    timestamps: {
      created_at: finalTask.created_at,
      started_at: finalTask.started_at,
      finished_at: finalTask.finished_at,
      expires_at: finalTask.expires_at,
    },
    usd_estimated: estimateUsd(credits, config.usdPerCredit),
  });
  console.log(`downloaded refine outputs into ${path.relative(REPO_ROOT, dir)}`);
  return 0;
}

// ---------------------------------------------------------------------------
// t2i / i2i (image generation, GH-746 SC2)
// ---------------------------------------------------------------------------

async function downloadImageOutputs(task: ImageGenTask, dir: string): Promise<readonly string[]> {
  mkdirSync(dir, { recursive: true });
  const names: string[] = [];
  const urls = task.image_urls ?? [];
  for (let i = 0; i < urls.length; i++) {
    const name = `image_${i}${extFromUrl(urls[i]) === '.bin' ? '.png' : extFromUrl(urls[i])}`;
    await downloadFile(urls[i], path.join(dir, name));
    names.push(name);
  }
  return names;
}

interface ImageGenRun {
  readonly kind: 't2i' | 'i2i';
  readonly label: string;
  readonly model: string;
  readonly effectiveModel: string;
  readonly credits: number;
  readonly plan: string | undefined;
  readonly yes: boolean;
  readonly name: string | undefined;
  readonly prompt: string;
  readonly aspect: string | undefined;
  readonly references: readonly ResolvedReference[];
  /** The request as it may be printed or written to disk (no data URIs). */
  readonly loggable: unknown;
  readonly submit: () => Promise<{ result: string }>;
  readonly fetch: (id: string) => Promise<ImageGenTask>;
}

async function runImageGen(run: ImageGenRun, hasClient: boolean, config: MeshyConfig, paths: MeshyPaths): Promise<number> {
  console.log(`plan: ${run.label} (plan tier recorded: ${run.plan ?? '(unset)'})`);
  console.log(`estimate: ${imagePriceCaption(run.credits, config.usdPerCredit)}`);

  if (process.env.MESHY_DRY_RUN === '1') {
    console.log('MESHY_DRY_RUN=1 -- printing the request and stopping before any POST:');
    console.log(JSON.stringify(run.loggable, null, 2));
    return 0;
  }
  if (!hasClient) {
    // Unreachable from `main()`: it only omits the client when MESHY_DRY_RUN=1, which already returned above.
    throw new Error(`internal: ${run.kind} called with no client outside MESHY_DRY_RUN=1`);
  }
  if (!run.plan) {
    // G-C5: every card records the plan tier it was generated under. A spend that cannot say so does not start.
    console.error('refusing to spend with no plan recorded -- pass --plan <tier> or set MESHY_PLAN (env or the key file); a store card records its plan (G-C5)');
    return 1;
  }
  if (!(await confirmSpend(run.credits, estimateUsd(run.credits, config.usdPerCredit), run.yes))) {
    console.log('aborted -- nothing was spent');
    return 1;
  }

  const submitted = await run.submit();
  const id = submitted.result;
  const entry: LedgerEntry = {
    ...ledgerEntry(run.kind, run.kind, id, { name: run.name, prompt: run.prompt }, run.credits, config.usdPerCredit),
    plan: run.plan,
    model: run.effectiveModel,
    ...(run.aspect ? { aspect_ratio: run.aspect } : {}),
    prompt_sha256: sha256(run.prompt),
    ...(run.references.some((r) => r.sha256) ? { reference_sha256: run.references.flatMap((r) => (r.sha256 ? [r.sha256] : [])) } : {}),
  };
  appendLedgerEntry(paths.ledgerPath, entry);
  console.log(`submitted ${run.kind} task ${id}`);

  const finalTask = await pollTask(() => run.fetch(id), `${run.kind} ${id}`);
  if (finalTask.status !== 'SUCCEEDED') {
    console.error(`${run.kind} task ${id} ended ${finalTask.status}: ${finalTask.task_error?.message ?? '(no message)'}`);
    return 1;
  }
  if (finalTask.consumed_credits !== undefined) {
    patchLedgerCreditsConsumed(paths.ledgerPath, id, finalTask.consumed_credits);
  }

  const dir = path.join(paths.artDir, taskDirName(run.name ?? run.prompt, id));
  const files = await downloadImageOutputs(finalTask, dir);
  writeTaskJson(dir, {
    request: run.loggable,
    response: finalTask,
    plan: run.plan,
    model_requested: run.model,
    model_run: run.effectiveModel,
    prompt_sha256: sha256(run.prompt),
    references: run.references.map((r) => ({ source: r.source, sha256: r.sha256, bytes: r.bytes })),
    files,
    consumed_credits: finalTask.consumed_credits,
    timestamps: {
      created_at: finalTask.created_at,
      started_at: finalTask.started_at,
      finished_at: finalTask.finished_at,
      expires_at: finalTask.expires_at,
    },
    usd_estimated: estimateUsd(run.credits, config.usdPerCredit),
  });
  console.log(`downloaded ${files.length} image(s) into ${path.relative(REPO_ROOT, dir)}`);
  console.log('');
  console.log('Paste into docs/ASSET_PROVENANCE.md:');
  for (const f of files) {
    console.log(
      buildImageProvenanceLine({
        kind: run.kind,
        imagePath: path.relative(REPO_ROOT, path.join(dir, f)),
        model: run.effectiveModel,
        plan: run.plan,
        taskId: id,
        promptSha256: sha256(run.prompt),
        referenceSha256: run.references.flatMap((r) => (r.sha256 ? [r.sha256] : [])),
        generatedAt: new Date().toISOString().slice(0, 10),
      })
    );
  }
  return 0;
}

/**
 * The plan a spend is recorded under: `--plan`, else `MESHY_PLAN` from the config. BOTH go through `parsePlan`, so a
 * `free` or malformed plan is refused whichever way it arrived (G-C5; free-plan output is Meshy-owned). Returns the
 * plan (undefined when none is named: a real spend then refuses in `runImageGen`) or an error message.
 */
function resolvePlan(optsPlan: string | undefined, config: MeshyConfig): { plan: string | undefined } | { error: string } {
  try {
    return { plan: parsePlan(optsPlan ?? config.plan) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runT2i(client: T2iTaskClient | undefined, config: MeshyConfig, opts: T2iOptions, paths: MeshyPaths = DEFAULT_PATHS): Promise<number> {
  const resolved = resolvePlan(opts.plan, config);
  if ('error' in resolved) {
    console.error(resolved.error);
    return 1;
  }
  const eff = effectiveImageModel(opts.model, opts.pose);
  const body = buildT2iRequest(opts);
  return runImageGen(
    {
      kind: 't2i',
      label: `text-to-image "${opts.prompt.slice(0, 60)}${opts.prompt.length > 60 ? '...' : ''}" (${opts.model}${eff !== opts.model ? `, runs as ${eff}` : ''}${opts.aspect ? `, ${opts.aspect}` : ''})`,
      model: opts.model,
      effectiveModel: eff,
      credits: estimateCredits('text-to-image', { imageModel: eff }),
      plan: resolved.plan,
      yes: opts.yes,
      name: opts.name,
      prompt: body.prompt,
      aspect: opts.aspect,
      references: [],
      loggable: body,
      submit: () => (client as T2iTaskClient).submitT2iTask(body),
      fetch: (id) => (client as T2iTaskClient).getT2iTask(id),
    },
    client !== undefined,
    config,
    paths
  );
}

export async function runI2i(client: I2iTaskClient | undefined, config: MeshyConfig, opts: I2iOptions, paths: MeshyPaths = DEFAULT_PATHS): Promise<number> {
  const resolved = resolvePlan(opts.plan, config);
  if ('error' in resolved) {
    console.error(resolved.error);
    return 1;
  }
  const refs = opts.references.map(resolveReference);
  const body = buildI2iRequest(opts, refs);
  const eff = effectiveImageModel(opts.model, 'none');
  return runImageGen(
    {
      kind: 'i2i',
      label: `image-to-image (${opts.model}${opts.aspect ? `, ${opts.aspect}` : ''}) from ${opts.fromTask ? `task ${opts.fromTask}` : `${refs.length} reference(s): ${refs.map((r) => r.source).join(', ')}`}`,
      model: opts.model,
      effectiveModel: eff,
      credits: estimateCredits('image-to-image', { imageModel: eff }),
      plan: resolved.plan,
      yes: opts.yes,
      name: opts.name,
      prompt: body.prompt,
      aspect: opts.aspect,
      references: refs,
      loggable: loggableI2i(body),
      submit: () => (client as I2iTaskClient).submitI2iTask(body),
      fetch: (id) => (client as I2iTaskClient).getI2iTask(id),
    },
    client !== undefined,
    config,
    paths
  );
}

// ---------------------------------------------------------------------------
// status / download / list
// ---------------------------------------------------------------------------

async function fetchTaskByKind(client: MeshyClient, id: string, kind: TaskKind): Promise<TextToThreeDTask | ImageToThreeDTask | RemeshTask | ImageGenTask> {
  if (kind === 'text') return client.getTextTask(id);
  if (kind === 'image') return client.getImageTask(id);
  if (kind === 't2i') return client.getT2iTask(id);
  if (kind === 'i2i') return client.getI2iTask(id);
  return client.getRemeshTask(id);
}

async function fetchEitherKind(
  client: MeshyClient,
  id: string,
  kind: TaskKind | undefined
): Promise<{ kind: TaskKind; task: TextToThreeDTask | ImageToThreeDTask | RemeshTask | ImageGenTask } | undefined> {
  const kinds: readonly TaskKind[] = kind ? [kind] : ['text', 'image', 'remesh'];
  for (const k of kinds) {
    try {
      const task = await fetchTaskByKind(client, id, k);
      return { kind: k, task };
    } catch (err) {
      if (err instanceof MeshyApiError && err.status === 404) continue;
      throw err;
    }
  }
  return undefined;
}

async function runStatus(client: MeshyClient, opts: StatusOptions): Promise<number> {
  const found = await fetchEitherKind(client, opts.id, opts.kind);
  if (!found) {
    console.error(`no ${opts.kind ?? 'text, image or remesh'} task found for id ${opts.id}`);
    return 1;
  }
  const { kind, task } = found;
  if (opts.json) {
    console.log(JSON.stringify({ kind, ...task }));
  } else {
    console.log(`${kind} task ${task.id}: ${task.status} (${task.progress}%)`);
    if (task.task_error) console.log(`  error: ${task.task_error.message}`);
    if (task.consumed_credits !== undefined) console.log(`  consumed: ${task.consumed_credits} credits`);
  }
  return 0;
}

async function runDownload(client: MeshyClient, opts: DownloadOptions): Promise<number> {
  const found = await fetchEitherKind(client, opts.id, opts.kind);
  if (!found) {
    console.error(`no ${opts.kind ?? 'text, image or remesh'} task found for id ${opts.id}`);
    return 1;
  }
  const { kind, task } = found;
  if (task.status !== 'SUCCEEDED') {
    console.error(`${kind} task ${opts.id} is ${task.status}, not SUCCEEDED -- nothing to download`);
    return 1;
  }
  const dirName = taskDirName(opts.name ?? opts.id, task.id);
  const dir = path.join(ART_DIR, dirName);
  if (kind === 't2i' || kind === 'i2i') await downloadImageOutputs(task as ImageGenTask, dir);
  else await downloadTaskOutputs(task as TextToThreeDTask | ImageToThreeDTask | RemeshTask, dir);
  writeTaskJson(dir, { response: task, downloaded_via: 'meshy download' });
  console.log(`downloaded ${kind} task ${task.id} into ${path.relative(REPO_ROOT, dir)}`);
  return 0;
}

async function listTasksByKind(client: MeshyClient, kind: TaskKind, pageNum: number): Promise<readonly { id: string; status: string; progress: number }[]> {
  if (kind === 'text') return client.listTextTasks({ pageNum });
  if (kind === 'image') return client.listImageTasks({ pageNum });
  if (kind === 't2i') return client.listT2iTasks({ pageNum });
  if (kind === 'i2i') return client.listI2iTasks({ pageNum });
  return client.listRemeshTasks({ pageNum });
}

/** Defaults to `text`+`image` with no `--kind`, same as before `remesh`
 *  existed -- `--kind remesh` opts in explicitly rather than every listing
 *  growing a third request. */
async function runList(client: MeshyClient, opts: ListOptions): Promise<number> {
  const kinds: readonly TaskKind[] = opts.kind ? [opts.kind] : ['text', 'image'];
  for (const kind of kinds) {
    const tasks = await listTasksByKind(client, kind, opts.page);
    if (opts.json) {
      console.log(JSON.stringify({ kind, tasks }));
    } else {
      console.log(`${kind} (page ${opts.page}): ${tasks.length} task(s)`);
      for (const t of tasks) console.log(`  ${t.id}  ${t.status}  ${t.progress}%`);
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

const USAGE = `pnpm meshy -- <command> [options]

Commands (network, need a key):
  balance                       credit balance
  text "<prompt>" [options]     text-to-3d, preview (+ --refine; --negative "..." = negative_prompt)
  image <path-or-url> [options] image-to-3d
      text/image: --pose a-pose|t-pose|none   pose_mode sent to Meshy (default none;
                                              a-pose is what a figure needs to be rigged)
      text/image: --model-type standard|smart-topology (default standard; lowpoly retired 2026-10-30)
                  --ai-model  standard: meshy-6 (default), meshy-6-lite, meshy-7.1, meshy-7, latest
                              smart-topology: meshy-t2.5 (default), meshy-t2  -- a mismatched pair is refused
                  5-credit previews: meshy-6-lite, meshy-t2, meshy-t2.5; the rest 20
  t2i "<prompt>" [options]      text-to-image (--model nano-banana-2|gpt-image-2|..., --aspect 4:3|3:2|..., --negative "...",
                                --plan <tier>, --name ...); no reference image
  i2i --prompt "<text>" <ref.png>... [options]   image-to-image from 1-5 reference images, or --from-task <id> (not both)
      t2i/i2i: the paid plan tier is recorded per task (--plan or MESHY_PLAN), --yes is required off a terminal,
               MESHY_DRY_RUN=1 prints the request (data URIs elided) and stops with no key and no spend
  remesh <input-task-id> --polycount N [options]  retopologize a finished task
  refine <preview-task-id> [--tex 2k|4k|8k] [--pbr] [--texture-prompt ...]
                                texture an EXISTING preview task (the --refine half alone)
  status <id> [--kind text|image|remesh]
  download <id> [--kind ...] [--name ...]
  list [--kind ...] [--page N]

Local only (no key needed):
  estimate text|image|remesh|refine|t2i|i2i [options]  credit/USD cost, no API call (t2i/i2i: --model, --count N attempts)
  spent                                 sums art/meshy/ledger.jsonl

Every command accepts --json. See docs/ART_PIPELINE.md's
"Meshy API -- generating a base model" section for the full workflow.`;

function noKeyMessage(keyFile: string): string {
  return `no Meshy API key found.\nSet MESHY_API_KEY in the environment, or put it in ${keyFile} as MESHY_API_KEY=... (mode 600).`;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const command = argv[0];
  const rest = argv.slice(1);

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return command ? 0 : 1;
  }

  const config = loadMeshyConfig();

  if (command === 'estimate') return runEstimate(rest, config.usdPerCredit);
  if (command === 'spent') return runSpent(parseSpentArgs(rest));

  const dryRun = process.env.MESHY_DRY_RUN === '1';

  if (command === 'text' || command === 'image' || command === 'remesh' || command === 'refine' || command === 't2i' || command === 'i2i') {
    // The trio of commands that may run without a key: MESHY_DRY_RUN=1
    // prints the request and stops before any POST (see `commandNeedsApiKey`),
    // so `client` stays undefined rather than forcing a key nobody is about
    // to use -- `runText`/`runImage`/`runRemesh` never touch it past that
    // point. `MeshyClient` satisfies `TextTaskClient`, `ImageTaskClient` and
    // `RemeshTaskClient` structurally, so the same instance serves all three.
    if (!config.apiKey && commandNeedsApiKey(command, dryRun)) {
      console.error(noKeyMessage(config.keyFile));
      return 1;
    }
    const client = config.apiKey ? new MeshyClient(config.apiKey) : undefined;
    const ctx = { isTTY: process.stdin.isTTY === true };
    if (command === 'text') return runText(client, config, parseTextArgs(rest, ctx));
    if (command === 'image') return runImage(client, config, parseImageArgs(rest, ctx));
    if (command === 'refine') return runRefine(client, config, parseRefineArgs(rest, ctx));
    if (command === 't2i') return runT2i(client, config, parseT2iArgs(rest, ctx));
    if (command === 'i2i') return runI2i(client, config, parseI2iArgs(rest, ctx));
    return runRemesh(client, config, parseRemeshArgs(rest, ctx));
  }

  if (!config.apiKey) {
    console.error(noKeyMessage(config.keyFile));
    return 1;
  }
  const client = new MeshyClient(config.apiKey);

  switch (command) {
    case 'balance':
      return runBalance(client, parseBalanceArgs(rest));
    case 'status':
      return runStatus(client, parseStatusArgs(rest));
    case 'download':
      return runDownload(client, parseDownloadArgs(rest));
    case 'list':
      return runList(client, parseListArgs(rest));
    default:
      console.error(`unknown command "${command}"\n`);
      console.error(USAGE);
      return 1;
  }
}

// Only when this file is the process entry point -- never on import (none of
// this package's tests import cli.ts; they exercise the pure modules it
// orchestrates).
const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  );
}
