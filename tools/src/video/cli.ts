/**
 * `pnpm video -- <estimate|generate|status|ledger>` -- the cinematics route
 * on the paid Gemini API (Gemini Omni Flash and Veo 3.1), modelled on
 * `pnpm meshy` (`../meshy/cli.ts`). Approved by the lead on 2026-10-11 from
 * docs/research/2026-10-11-generative-video.md; workflow and policy in
 * docs/cinematics/README.md.
 *
 * The rules this file enforces, in the order a spend meets them:
 *
 * 1. **Dry run is the default.** `generate` builds the exact request, prints
 *    it (base64 and key redacted), prints its price and the budget verdict,
 *    and stops. Nothing is sent.
 * 2. **`--spend` is required to send**, AND a key must be configured
 *    (`GEMINI_API_KEY`, env or `~/.config/roaring-lions/gemini.env`). Either
 *    missing, and no network call is made at all.
 * 3. **The hard cap.** Every take is priced (`pricing.ts`) and checked against
 *    the ledger's running total under the $150 cap (`budget.ts`) before it is
 *    sent; a take that would pass the cap is refused, not trimmed.
 * 4. **The ledger is written before the request**, so a crash mid-request
 *    still leaves the spend on record (`ledger.ts`).
 *
 * Every network call goes through `deps.fetch`, so `cli.test.ts` drives the
 * whole command against a fake and asserts the call count; this file is the
 * only one in the package that sends anything.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBudget, HARD_CAP_USD } from './budget';
import { loadVideoConfig, type VideoConfig } from './config';
import { appendLedgerEntry, LEDGER_RELATIVE_PATH, patchLedgerEntry, readLedger, spentUsd, type LedgerEntry } from './ledger';
import { billedSeconds, formatUsd, MODELS, PRICING_SOURCE } from './pricing';
import { API_BASE, buildRequest, KEY_HEADER, mimeFor, promptFor, redactRequest } from './request';
import { estimateShot, loadStoryboard, shotTakeUsd, STAGES, type Shot, type Stage } from './shots';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface CliDeps {
  readonly fetch: FetchLike;
  readonly config: VideoConfig;
  readonly repoRoot: string;
  readonly shotsPath: string;
  readonly ledgerPath: string;
  readonly takesDir: string;
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => Date;
}

export const EXIT = { ok: 0, usage: 1, noKey: 2, budget: 3, api: 4 } as const;

const POLL_MS = 10_000;
const POLL_LIMIT = 180; // 30 min at 10 s

export const USAGE = `pnpm video -- <command>

  estimate [--shot <id>] [--json]
      Price the storyboard (docs/cinematics/shots.json), shot by shot, against
      the $${HARD_CAP_USD} cap and what the ledger has already spent. No key needed.
  generate --shot <id> --stage <explore|final> [--takes <n>] [--spend]
      Without --spend (the default): print the exact request, its price and the
      budget verdict, and send nothing. With --spend AND a configured key: send it.
  status <operation-name | interaction-id>
      Read one request's state (a GET; costs nothing). Needs the key.
  ledger [--json]
      Every take on record, the estimated spend, and what is left under the cap.

Key: GEMINI_API_KEY in the environment or ~/.config/roaring-lions/gemini.env.
Prices: ${PRICING_SOURCE.url}, quoted ${PRICING_SOURCE.quotedAt}.`;

interface Flags {
  readonly positional: string[];
  readonly values: Map<string, string>;
  readonly bools: Set<string>;
}

const BOOL_FLAGS = new Set(['spend', 'json']);

export function parseFlags(argv: readonly string[]): Flags {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (BOOL_FLAGS.has(name)) {
      if (eq !== -1) throw new Error(`--${name} takes no value`);
      bools.add(name);
    } else if (eq !== -1) values.set(name, a.slice(eq + 1));
    else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`--${name} needs a value`);
      values.set(name, next);
      i++;
    }
  }
  return { positional, values, bools };
}

function findShot(shots: readonly Shot[], id: string | undefined): Shot {
  if (id === undefined) throw new Error('--shot <id> is required');
  const shot = shots.find((s) => s.id === id);
  if (!shot) throw new Error(`no shot "${id}" in the storyboard (have: ${shots.map((s) => s.id).join(', ')})`);
  return shot;
}

// ---------------------------------------------------------------------------
// estimate
// ---------------------------------------------------------------------------

function runEstimate(flags: Flags, deps: CliDeps): number {
  const board = loadStoryboard(deps.shotsPath);
  const id = flags.values.get('shot');
  const shots = id === undefined ? board.shots : [findShot(board.shots, id)];
  const rows = shots.map((s) => ({ shot: s, est: estimateShot(s, promptFor(s).length) }));
  const total = rows.reduce((sum, r) => sum + r.est.totalUsd, 0);
  const spent = spentUsd(readLedger(deps.ledgerPath));
  const verdict = checkBudget(spent, total);
  if (flags.bools.has('json')) {
    deps.log(
      JSON.stringify({
        shots: rows.map((r) => ({ ...r.est, explore: r.shot.explore, final: r.shot.final })),
        totalUsd: total,
        capUsd: HARD_CAP_USD,
        spentUsd: spent,
        fits: verdict.allowed,
        source: PRICING_SOURCE,
      })
    );
  } else {
    deps.log('shot                 explore                          final                            total');
    for (const { shot, est } of rows) {
      const stage = (st: Stage, usd: number): string =>
        `${shot[st].takes}x ${shot[st].model} ${shot[st].resolution} ${billedSeconds(shot[st])}s ${formatUsd(usd)}`.padEnd(33);
      deps.log(`${shot.id.padEnd(20)} ${stage('explore', est.exploreUsd)}${stage('final', est.finalUsd)}${formatUsd(est.totalUsd)}`);
    }
    deps.log(`total ${formatUsd(total)} against the ${formatUsd(HARD_CAP_USD)} cap; ledger has ${formatUsd(spent)} spent, ${formatUsd(HARD_CAP_USD - spent)} left`);
    deps.log(verdict.allowed ? `fits, with ${formatUsd(verdict.remainingAfterUsd)} to spare` : `DOES NOT FIT: ${verdict.reason}`);
    deps.log(`prices: ${PRICING_SOURCE.url}, quoted ${PRICING_SOURCE.quotedAt}; Omni takes priced at their 10 s maximum`);
  }
  return verdict.allowed ? EXIT.ok : EXIT.usage;
}

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

async function apiError(res: Response, what: string): Promise<string> {
  const body = await res.text().catch(() => '');
  return `${what} -> HTTP ${res.status}: ${body.slice(0, 2000)}`;
}

/** Finds the generated video in an Omni interaction: inline base64, or a file uri. */
function omniVideo(json: unknown): { data?: string; uri?: string } | null {
  const steps = (json as { steps?: { content?: { type?: string; data?: string; uri?: string }[] }[] }).steps ?? [];
  for (const step of steps) {
    for (const c of step.content ?? []) {
      if (c.type === 'video' && (c.data || c.uri)) return { data: c.data, uri: c.uri };
    }
  }
  return null;
}

async function runGenerate(flags: Flags, deps: CliDeps): Promise<number> {
  const board = loadStoryboard(deps.shotsPath);
  const shot = findShot(board.shots, flags.values.get('shot'));
  const stageRaw = flags.values.get('stage');
  if (!(STAGES as readonly string[]).includes(stageRaw ?? '')) throw new Error('--stage must be explore or final');
  const stage = stageRaw as Stage;
  const plan = shot[stage];
  const takes = Number(flags.values.get('takes') ?? '1');
  if (!Number.isInteger(takes) || takes < 1) throw new Error('--takes must be a whole number of 1 or more');
  if (takes > plan.takes) {
    throw new Error(`--takes ${takes} is more than the ${plan.takes} the storyboard plans for ${shot.id} ${stage}; change shots.json first`);
  }

  const stillPath = path.join(deps.repoRoot, shot.still);
  const still = { mimeType: mimeFor(stillPath), bytes: readFileSync(stillPath) };
  const req = buildRequest(shot, stage, still);
  const perTake = shotTakeUsd(shot, stage, promptFor(shot).length);
  const spent = spentUsd(readLedger(deps.ledgerPath));
  const verdict = checkBudget(spent, perTake * takes);

  deps.log(`${shot.id} ${stage}: ${takes} take(s) of ${MODELS[plan.model]} at ${plan.resolution}, ${billedSeconds(plan)} s billed each`);
  deps.log(`price: ${formatUsd(perTake)} a take, ${formatUsd(perTake * takes)} in all (${PRICING_SOURCE.url}, quoted ${PRICING_SOURCE.quotedAt})`);
  deps.log(`budget: ${formatUsd(spent)} spent of ${formatUsd(HARD_CAP_USD)}; after this ${formatUsd(verdict.remainingAfterUsd)} left -- ${verdict.allowed ? 'within the cap' : `REFUSED: ${verdict.reason}`}`);
  deps.log('request:');
  deps.log(JSON.stringify(redactRequest(req), null, 2));

  if (!flags.bools.has('spend')) {
    deps.log(`dry run: nothing was sent.${deps.config.apiKey ? '' : ' (no key is configured either.)'} Add --spend to send it.`);
    return EXIT.ok;
  }
  if (!deps.config.apiKey) {
    deps.err(`--spend needs a key: set GEMINI_API_KEY or write it to ${deps.config.keyFile} (docs/cinematics/README.md, "Setting up billing and the key"). Nothing was sent.`);
    return EXIT.noKey;
  }
  if (!verdict.allowed) {
    deps.err(`refused: ${verdict.reason}. Nothing was sent.`);
    return EXIT.budget;
  }

  const key = deps.config.apiKey;
  const send = (url: string, init: RequestInit = {}): Promise<Response> =>
    deps.fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), [KEY_HEADER]: key } });

  for (let n = 1; n <= takes; n++) {
    // Re-check against the ledger as it stands NOW: a second process may have
    // spent since the verdict above was printed.
    const now = checkBudget(spentUsd(readLedger(deps.ledgerPath)), perTake);
    if (!now.allowed) {
      deps.err(`take ${n}: refused: ${now.reason}. Stopping.`);
      return EXIT.budget;
    }
    const stamp = deps.now().toISOString();
    const localId = `pending-${shot.id}-${stage}-${stamp}-${n}`;
    const entry: LedgerEntry = {
      at: stamp,
      shot: shot.id,
      stage,
      model: plan.model,
      model_id: MODELS[plan.model],
      resolution: plan.resolution,
      seconds_billed: billedSeconds(plan),
      usd_estimated: perTake,
      id: localId,
      status: 'submitted',
    };
    appendLedgerEntry(deps.ledgerPath, entry);
    let id = localId;
    const fail = (error: string): number => {
      patchLedgerEntry(deps.ledgerPath, id, { status: 'failed', error });
      deps.err(`take ${n}: ${error}`);
      return EXIT.api;
    };

    const res = await send(req.url, { method: req.method, headers: req.headers, body: JSON.stringify(req.body) });
    if (!res.ok) return fail(await apiError(res, `${req.method} ${req.url}`));
    const json: unknown = await res.json();

    let video: Buffer;
    if (req.kind === 'veo') {
      const name = (json as { name?: string }).name;
      if (!name) return fail('Veo answered with no operation name');
      patchLedgerEntry(deps.ledgerPath, id, { id: name });
      id = name;
      deps.log(`take ${n}: operation ${name}`);
      let op: { done?: boolean; error?: unknown; response?: unknown } = {};
      for (let i = 0; i < POLL_LIMIT && !op.done; i++) {
        await deps.sleep(POLL_MS);
        const r = await send(`${API_BASE}/${name}`);
        if (!r.ok) return fail(await apiError(r, `GET ${name}`));
        op = (await r.json()) as typeof op;
        deps.log(`  ${op.done ? 'done' : 'running'}`);
      }
      if (!op.done) return fail(`not done after ${(POLL_LIMIT * POLL_MS) / 60000} min; check later with: pnpm video -- status ${name}`);
      if (op.error) return fail(`Veo error: ${JSON.stringify(op.error)}`);
      const uri = (op.response as { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] } } | undefined)
        ?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!uri) return fail(`no video in the response (filtered?): ${JSON.stringify(op.response).slice(0, 1000)}`);
      // The key goes in the download's header, so only to Google's own host.
      if (!uri.startsWith('https://generativelanguage.googleapis.com/')) return fail(`refusing to send the key to ${uri}`);
      const dl = await send(uri, { redirect: 'follow' });
      if (!dl.ok) return fail(await apiError(dl, 'download'));
      video = Buffer.from(await dl.arrayBuffer());
    } else {
      const interactionId = (json as { id?: string }).id;
      if (interactionId) {
        patchLedgerEntry(deps.ledgerPath, id, { id: interactionId });
        id = interactionId;
      }
      const found = omniVideo(json);
      if (!found) return fail(`no video in the response (filtered?): ${JSON.stringify(json).slice(0, 1000)}`);
      if (found.data) video = Buffer.from(found.data, 'base64');
      else {
        const fileId = (found.uri as string).split('files/').pop()?.split(/[?:]/)[0];
        if (!fileId) return fail(`cannot read a file id from ${found.uri}`);
        let state = '';
        for (let i = 0; i < POLL_LIMIT && state !== 'ACTIVE'; i++) {
          const r = await send(`${API_BASE}/files/${fileId}`);
          if (!r.ok) return fail(await apiError(r, `GET files/${fileId}`));
          state = ((await r.json()) as { state?: string }).state ?? '';
          if (state === 'FAILED') return fail(`file ${fileId} FAILED`);
          if (state !== 'ACTIVE') await deps.sleep(POLL_MS);
        }
        const dl = await send(`${API_BASE}/files/${fileId}:download?alt=media`);
        if (!dl.ok) return fail(await apiError(dl, 'download'));
        video = Buffer.from(await dl.arrayBuffer());
      }
    }

    const dir = path.join(deps.takesDir, shot.id);
    mkdirSync(dir, { recursive: true });
    const base = `${stage}-${stamp.replace(/[:.]/g, '-')}-${n}`;
    const out = path.join(dir, `${base}.mp4`);
    writeFileSync(out, video);
    // The take's own record: what was asked of which model, when. This is the
    // raw material for the ASSET_PROVENANCE row the shipped file will need.
    writeFileSync(
      path.join(dir, `${base}.json`),
      `${JSON.stringify({ at: stamp, shot: shot.id, stage, model_id: MODELS[plan.model], id, prompt: promptFor(shot), still: shot.still, request: redactRequest(req) }, null, 2)}\n`
    );
    patchLedgerEntry(deps.ledgerPath, id, { status: 'succeeded', output: path.relative(deps.repoRoot, out) });
    deps.log(`take ${n}: saved ${path.relative(deps.repoRoot, out)} (${(video.length / 1048576).toFixed(2)} MiB)`);
  }
  return EXIT.ok;
}

// ---------------------------------------------------------------------------
// status, ledger
// ---------------------------------------------------------------------------

async function runStatus(flags: Flags, deps: CliDeps): Promise<number> {
  const name = flags.positional[0];
  if (!name) throw new Error('status needs an operation name or an interaction id');
  if (!deps.config.apiKey) {
    deps.err(`status needs a key (GEMINI_API_KEY or ${deps.config.keyFile}). Nothing was sent.`);
    return EXIT.noKey;
  }
  const url = name.includes('operations/') ? `${API_BASE}/${name}` : `${API_BASE}/interactions/${encodeURIComponent(name)}`;
  const res = await deps.fetch(url, { headers: { [KEY_HEADER]: deps.config.apiKey } });
  if (!res.ok) {
    deps.err(await apiError(res, `GET ${url}`));
    return EXIT.api;
  }
  const json = (await res.json()) as { done?: boolean; status?: string; error?: unknown };
  deps.log(JSON.stringify({ name, done: json.done ?? null, status: json.status ?? null, error: json.error ?? null }));
  return EXIT.ok;
}

function runLedger(flags: Flags, deps: CliDeps): number {
  const entries = readLedger(deps.ledgerPath);
  const spent = spentUsd(entries);
  if (flags.bools.has('json')) {
    deps.log(JSON.stringify({ entries, spentUsd: spent, capUsd: HARD_CAP_USD, remainingUsd: HARD_CAP_USD - spent }));
    return EXIT.ok;
  }
  for (const e of entries) {
    deps.log(`${e.at}  ${e.shot.padEnd(18)} ${e.stage.padEnd(7)} ${e.model_id.padEnd(30)} ${formatUsd(e.usd_estimated).padStart(7)}  ${e.status}`);
  }
  deps.log(`${entries.length} take(s), ${formatUsd(spent)} estimated, ${formatUsd(HARD_CAP_USD - spent)} left under the ${formatUsd(HARD_CAP_USD)} cap.`);
  deps.log('The estimate counts every submitted take; the bill in Cloud Billing is the truth -- compare the two after each batch.');
  return EXIT.ok;
}

export async function run(argv: readonly string[], deps: CliDeps): Promise<number> {
  let flags: Flags;
  try {
    flags = parseFlags(argv);
  } catch (e) {
    deps.err((e as Error).message);
    return EXIT.usage;
  }
  const [command, ...rest] = flags.positional;
  const sub: Flags = { ...flags, positional: rest };
  try {
    switch (command) {
      case 'estimate':
        return runEstimate(sub, deps);
      case 'generate':
        return await runGenerate(sub, deps);
      case 'status':
        return await runStatus(sub, deps);
      case 'ledger':
        return runLedger(sub, deps);
      default:
        deps.err(command === undefined ? USAGE : `unknown command "${command}"\n\n${USAGE}`);
        return EXIT.usage;
    }
  } catch (e) {
    deps.err((e as Error).message);
    return EXIT.usage;
  }
}

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function defaultDeps(): CliDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    config: loadVideoConfig(),
    repoRoot: REPO_ROOT,
    shotsPath: path.join(REPO_ROOT, 'docs', 'cinematics', 'shots.json'),
    ledgerPath: path.join(REPO_ROOT, LEDGER_RELATIVE_PATH),
    takesDir: path.join(REPO_ROOT, 'art', 'video', 'takes'),
    log: (l) => console.log(l),
    err: (l) => console.error(l),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
  };
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2), defaultDeps()).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  );
}
