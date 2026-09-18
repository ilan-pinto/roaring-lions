/**
 * `pnpm meshy -- <command>` -- a token-disciplined proxy over the Meshy
 * text-to-3D and image-to-3D APIs. See `docs/ART_PIPELINE.md`'s "Meshy API"
 * section for the workflow and policy this enforces: estimate before you
 * spend, announce the plan, download into `art/meshy/`, log every spend to
 * `art/meshy/ledger.jsonl`.
 *
 * This file is the only one in the package that does network I/O, reads the
 * key, writes files, or prompts on stdin -- every other module here is pure
 * and independently testable. `MESHY_DRY_RUN=1` short-circuits both generate
 * commands right before the POST that would submit a task, which is the knob
 * this file's own tests (run via `pnpm meshy`, not vitest -- see the task
 * report) were driven through instead of vitest, since a real submit would
 * spend credits.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import type { ImageToThreeDRequest, ImageToThreeDTask, TextPreviewRequest, TextRefineRequest, TextToThreeDTask } from './api-types';
import {
  parseBalanceArgs,
  parseDownloadArgs,
  parseEstimateImageArgs,
  parseEstimateTextArgs,
  parseImageArgs,
  parseListArgs,
  parseSpentArgs,
  parseStatusArgs,
  parseTextArgs,
  type BalanceOptions,
  type DownloadOptions,
  type ImageOptions,
  type ListOptions,
  type SpentOptions,
  type StatusOptions,
  type TextOptions,
} from './args';
import { MeshyApiError, MeshyClient } from './client';
import { loadMeshyConfig, type MeshyConfig } from './config';
import { appendLedgerEntry, LEDGER_RELATIVE_PATH, readLedger, summarizeLedger, type LedgerEntry } from './ledger';
import { isHttpUrl, resolveImageUrl, taskDirName } from './naming';
import { TERMINAL_STATUSES, type TaskKind, type TaskStatus } from './options';
import { estimateCredits, estimateUsd, formatUsd, PRICING_SOURCE } from './pricing';
import { buildProvenanceLine } from './provenance';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ART_DIR = path.join(REPO_ROOT, 'art', 'meshy');
const LEDGER_PATH = path.join(REPO_ROOT, LEDGER_RELATIVE_PATH);
const POLL_INTERVAL_MS = 5000;

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
async function downloadTaskOutputs(task: TextToThreeDTask | ImageToThreeDTask, dir: string): Promise<readonly string[]> {
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
  if (subkind !== 'text' && subkind !== 'image') {
    console.error('estimate: expected "text" or "image" as the first argument');
    return 1;
  }
  if (subkind === 'text') {
    const opts = parseEstimateTextArgs(rest.slice(1));
    const previewCredits = estimateCredits('text-preview', { modelType: opts.modelType, ultra: opts.ultra });
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
    model_type: opts.modelType,
    ai_model: opts.aiModel,
    ...(opts.ultra ? { ultra_mode: true } : {}),
    topology: opts.topology,
    target_polycount: opts.polycount,
    pose_mode: '',
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

function ledgerEntry(kind: TaskKind, mode: LedgerEntry['mode'], id: string, opts: { name?: string; prompt?: string }, creditsEstimated: number, usdPerCredit: number): LedgerEntry {
  return {
    at: new Date().toISOString(),
    kind,
    mode,
    id,
    name: opts.name,
    prompt: opts.prompt,
    credits_estimated: creditsEstimated,
    usd_estimated: estimateUsd(creditsEstimated, usdPerCredit),
  };
}

async function runText(client: MeshyClient, config: MeshyConfig, opts: TextOptions): Promise<number> {
  const previewCredits = estimateCredits('text-preview', { modelType: opts.modelType, ultra: opts.ultra });
  const refineCredits = opts.refine ? estimateCredits('text-refine', { textureResolution: opts.textureResolution }) : 0;
  const totalCredits = previewCredits + refineCredits;

  console.log(`plan: text-to-3d preview "${opts.prompt}" (${opts.aiModel}, ${opts.modelType}, ${opts.polycount} tri budget)${opts.refine ? ' + refine' : ''}`);
  console.log(`estimate: ${priceCaption(totalCredits, config.usdPerCredit)}`);

  const previewBody = buildPreviewRequest(opts);

  if (process.env.MESHY_DRY_RUN === '1') {
    console.log('MESHY_DRY_RUN=1 -- printing the request and stopping before any POST:');
    console.log(JSON.stringify(previewBody, null, 2));
    if (opts.refine) console.log('(refine would follow, against whatever preview id the real submit returns)');
    return 0;
  }

  if (!(await confirmSpend(totalCredits, estimateUsd(totalCredits, config.usdPerCredit), opts.yes))) {
    console.log('aborted -- nothing was spent');
    return 1;
  }

  const submitted = await client.submitTextTask(previewBody);
  const previewId = submitted.result;
  appendLedgerEntry(LEDGER_PATH, ledgerEntry('text', 'preview', previewId, opts, previewCredits, config.usdPerCredit));
  console.log(`submitted preview task ${previewId}`);

  const finalPreview = await pollTask(() => client.getTextTask(previewId), `preview ${previewId}`);
  if (finalPreview.status !== 'SUCCEEDED') {
    console.error(`preview task ${previewId} ended ${finalPreview.status}: ${finalPreview.task_error?.message ?? '(no message)'}`);
    return 1;
  }

  const dirName = taskDirName(opts.name ?? opts.prompt, previewId);
  const dir = path.join(ART_DIR, dirName);
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
    appendLedgerEntry(LEDGER_PATH, ledgerEntry('text', 'refine', refineId, opts, refineCredits, config.usdPerCredit));
    console.log(`submitted refine task ${refineId}`);

    const finalRefine = await pollTask(() => client.getTextTask(refineId), `refine ${refineId}`);
    if (finalRefine.status !== 'SUCCEEDED') {
      console.error(`refine task ${refineId} ended ${finalRefine.status}: ${finalRefine.task_error?.message ?? '(no message)'}`);
      return 1;
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
    target_formats: opts.formats,
    origin_at: 'bottom',
  };
}

async function runImage(client: MeshyClient, config: MeshyConfig, opts: ImageOptions): Promise<number> {
  const credits = estimateCredits('image', {
    modelType: opts.modelType,
    ultra: opts.ultra,
    shouldTexture: !opts.noTexture,
    textureResolution: opts.textureResolution,
  });

  console.log(
    `plan: image-to-3d from ${opts.pathOrUrl} (${opts.aiModel}, ${opts.modelType}, ${opts.polycount} tri budget${opts.noTexture ? ', no texture' : ''})`
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

  if (!(await confirmSpend(credits, estimateUsd(credits, config.usdPerCredit), opts.yes))) {
    console.log('aborted -- nothing was spent');
    return 1;
  }

  const submitted = await client.submitImageTask(body);
  const id = submitted.result;
  appendLedgerEntry(LEDGER_PATH, ledgerEntry('image', 'image', id, { name: opts.name }, credits, config.usdPerCredit));
  console.log(`submitted image-to-3d task ${id}`);

  const finalTask = await pollTask(() => client.getImageTask(id), `image ${id}`);
  if (finalTask.status !== 'SUCCEEDED') {
    console.error(`image task ${id} ended ${finalTask.status}: ${finalTask.task_error?.message ?? '(no message)'}`);
    return 1;
  }

  const dirName = taskDirName(opts.name ?? path.basename(opts.pathOrUrl), id);
  const dir = path.join(ART_DIR, dirName);
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
// status / download / list
// ---------------------------------------------------------------------------

async function fetchEitherKind(
  client: MeshyClient,
  id: string,
  kind: TaskKind | undefined
): Promise<{ kind: TaskKind; task: TextToThreeDTask | ImageToThreeDTask } | undefined> {
  const kinds: readonly TaskKind[] = kind ? [kind] : ['text', 'image'];
  for (const k of kinds) {
    try {
      const task = k === 'text' ? await client.getTextTask(id) : await client.getImageTask(id);
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
    console.error(`no ${opts.kind ?? 'text or image'} task found for id ${opts.id}`);
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
    console.error(`no ${opts.kind ?? 'text or image'} task found for id ${opts.id}`);
    return 1;
  }
  const { kind, task } = found;
  if (task.status !== 'SUCCEEDED') {
    console.error(`${kind} task ${opts.id} is ${task.status}, not SUCCEEDED -- nothing to download`);
    return 1;
  }
  const dirName = taskDirName(opts.name ?? opts.id, task.id);
  const dir = path.join(ART_DIR, dirName);
  await downloadTaskOutputs(task, dir);
  writeTaskJson(dir, { response: task, downloaded_via: 'meshy download' });
  console.log(`downloaded ${kind} task ${task.id} into ${path.relative(REPO_ROOT, dir)}`);
  return 0;
}

async function runList(client: MeshyClient, opts: ListOptions): Promise<number> {
  const kinds: readonly TaskKind[] = opts.kind ? [opts.kind] : ['text', 'image'];
  for (const kind of kinds) {
    const tasks = kind === 'text' ? await client.listTextTasks({ pageNum: opts.page }) : await client.listImageTasks({ pageNum: opts.page });
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
  text "<prompt>" [options]     text-to-3d, preview (+ --refine)
  image <path-or-url> [options] image-to-3d
  status <id> [--kind text|image]
  download <id> [--kind ...] [--name ...]
  list [--kind ...] [--page N]

Local only (no key needed):
  estimate text|image [options]  credit/USD cost, no API call
  spent                          sums art/meshy/ledger.jsonl

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

  if (!config.apiKey) {
    console.error(noKeyMessage(config.keyFile));
    return 1;
  }
  const client = new MeshyClient(config.apiKey);

  switch (command) {
    case 'balance':
      return runBalance(client, parseBalanceArgs(rest));
    case 'text':
      return runText(client, config, parseTextArgs(rest, { isTTY: process.stdin.isTTY === true }));
    case 'image':
      return runImage(client, config, parseImageArgs(rest, { isTTY: process.stdin.isTTY === true }));
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
