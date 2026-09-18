/**
 * CLI flag parsing for every `pnpm meshy -- <command>`. Pure: takes an argv
 * slice (and, for the two generate commands, an injected `isTTY`) and either
 * returns a typed options object or throws a plain `Error` whose message is
 * meant to be printed and exited on -- `cli.ts` does no flag interpretation
 * of its own. Kept separate from `cli.ts` so every refusal path (bad enum,
 * out-of-range polycount, over-length prompt, `--yes` missing with no TTY,
 * an unrecognised flag) is testable without a network or a real TTY.
 *
 * A bare `--` is tolerated anywhere in argv, not just at the front: pnpm's
 * own forwarding can prepend one or more (see `tools/src/meshes/wreck-pass.ts`'s
 * `parseWreckArgs` for the same trick, and the root `meshy` script's own
 * trailing `--`), and skipping every literal `--` is robust to however many
 * arrive rather than assuming an exact count.
 */
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
  PROMPT_MAX_CHARS,
  type AiModel,
  type ModelType,
  type TargetFormat,
  type TaskKind,
  type TextureResolution,
  type Topology,
} from './options';

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

export interface Tokenized {
  readonly positionals: readonly string[];
  readonly options: ReadonlyMap<string, string>;
}

/**
 * Splits argv into positionals and `--flag value` / `--flag=value` /
 * `--boolean-flag` pairs. `booleanFlags` must name every flag that takes no
 * value -- anything else with no `=value` consumes the next token, so an
 * unlisted boolean flag would silently eat the positional after it.
 */
export function tokenizeArgs(argv: readonly string[], booleanFlags: ReadonlySet<string>): Tokenized {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (key.length === 0) throw new Error(`unrecognised argument "${arg}"`);
      if (eq !== -1) {
        options.set(key, arg.slice(eq + 1));
        continue;
      }
      if (booleanFlags.has(key)) {
        options.set(key, 'true');
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('--') && next !== '--')) {
        throw new Error(`--${key} requires a value`);
      }
      options.set(key, next);
      i++;
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, options };
}

export interface FlagSpec {
  readonly boolean: ReadonlySet<string>;
  readonly valued: ReadonlySet<string>;
}

/**
 * Like `tokenizeArgs`, but every flag must be named in `spec` -- boolean or
 * value-taking -- and an unrecognised one is refused immediately. This
 * matters over "tokenize, then check the result": tokenizing alone cannot
 * tell an unknown flag from a value-taking one, so it guesses by looking at
 * the next token, and an unknown flag immediately followed by another `--`
 * flag (`image a.png --refine --yes`) would report "--refine requires a
 * value" instead of naming the real problem. Every per-command parser below
 * uses this rather than `tokenizeArgs` directly.
 */
export function parseKnownFlags(argv: readonly string[], spec: FlagSpec): Tokenized {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (key.length === 0) throw new Error(`unrecognised argument "${arg}"`);
      const isBoolean = spec.boolean.has(key);
      const isValued = spec.valued.has(key);
      if (!isBoolean && !isValued) {
        const known = [...spec.boolean, ...spec.valued]
          .sort()
          .map((k) => `--${k}`)
          .join(', ');
        throw new Error(`unrecognised flag "--${key}" -- known flags: ${known}`);
      }
      if (eq !== -1) {
        options.set(key, arg.slice(eq + 1));
        continue;
      }
      if (isBoolean) {
        options.set(key, 'true');
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('--') && next !== '--')) {
        throw new Error(`--${key} requires a value`);
      }
      options.set(key, next);
      i++;
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, options };
}

function parseIntFlag(options: ReadonlyMap<string, string>, key: string): number | undefined {
  const raw = options.get(key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`--${key} must be an integer, got "${raw}"`);
  }
  return n;
}

/** The `--yes`/TTY guard rail: refuses a spend command with no way to ask
 *  for confirmation and no explicit go-ahead. Called by `parseTextArgs` and
 *  `parseImageArgs`, never by the read-only commands. */
export function assertYesOrInteractive(yes: boolean, isTTY: boolean): void {
  if (!yes && !isTTY) {
    throw new Error(
      'refusing to run non-interactively without --yes -- pass --yes to confirm the spend, or run this from a terminal that can prompt for confirmation'
    );
  }
}

/**
 * Whether `main()` (`cli.ts`) must refuse `command` outright when no API key
 * is configured. `text`/`image` are the one pair that may run with no key at
 * all, and only when `dryRun` is true: both print the request and return
 * before ever calling the network (`runText`/`runImage` enforce this
 * themselves too, by throwing if ever called with no client outside a dry
 * run). Every other command that reaches this check always needs a real
 * key -- `estimate`, `spent` and `help` never reach it, since `cli.ts`
 * returns for those before the key check runs at all.
 */
export function commandNeedsApiKey(command: string, dryRun: boolean): boolean {
  if ((command === 'text' || command === 'image') && dryRun) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Shared "generate" flags
// ---------------------------------------------------------------------------

const GENERATE_VALUED_FLAGS: ReadonlySet<string> = new Set([
  'name',
  'model-type',
  'ai-model',
  'polycount',
  'topology',
  'tex',
  'texture-prompt',
  'formats',
]);
const GENERATE_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['ultra', 'pbr', 'yes', 'json']);

export interface GenerateCommonOptions {
  readonly name: string | undefined;
  readonly modelType: ModelType;
  readonly aiModel: AiModel;
  readonly polycount: number;
  readonly topology: Topology;
  readonly ultra: boolean;
  readonly pbr: boolean;
  readonly textureResolution: TextureResolution;
  readonly texturePrompt: string | undefined;
  readonly formats: readonly TargetFormat[];
  readonly yes: boolean;
  readonly json: boolean;
}

function parseGenerateCommon(options: ReadonlyMap<string, string>): GenerateCommonOptions {
  const modelType = options.has('model-type') ? asModelType(options.get('model-type') as string) : 'standard';
  const aiModel = options.has('ai-model') ? asAiModel(options.get('ai-model') as string) : 'meshy-6';
  const polycount = parseIntFlag(options, 'polycount') ?? defaultPolycount(modelType);
  assertPolycountInRange(polycount, modelType);
  const topology = options.has('topology') ? asTopology(options.get('topology') as string) : 'triangle';
  const textureResolution = options.has('tex') ? asTextureResolution(options.get('tex') as string) : '2k';
  const formats = options.has('formats') ? parseTargetFormats(options.get('formats') as string) : (['glb'] as const);
  return {
    name: options.get('name'),
    modelType,
    aiModel,
    polycount,
    topology,
    ultra: options.get('ultra') === 'true',
    pbr: options.get('pbr') === 'true',
    textureResolution,
    texturePrompt: options.get('texture-prompt'),
    formats,
    yes: options.get('yes') === 'true',
    json: options.get('json') === 'true',
  };
}

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

const TEXT_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([...GENERATE_BOOLEAN_FLAGS, 'refine']);

export interface TextOptions extends GenerateCommonOptions {
  readonly prompt: string;
  readonly refine: boolean;
}

export function parseTextArgs(argv: readonly string[], ctx: { readonly isTTY: boolean }): TextOptions {
  const { positionals, options } = parseKnownFlags(argv, { boolean: TEXT_BOOLEAN_FLAGS, valued: GENERATE_VALUED_FLAGS });
  if (positionals.length === 0) throw new Error('text: missing required <prompt> argument');
  if (positionals.length > 1) {
    throw new Error(`text: unexpected extra argument(s): ${positionals.slice(1).join(' ')} (quote the prompt as one argument)`);
  }
  const prompt = positionals[0];
  assertPromptLength(prompt);
  const common = parseGenerateCommon(options);
  assertYesOrInteractive(common.yes, ctx.isTTY);
  return { ...common, prompt, refine: options.get('refine') === 'true' };
}

// ---------------------------------------------------------------------------
// image
// ---------------------------------------------------------------------------

const IMAGE_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([...GENERATE_BOOLEAN_FLAGS, 'no-texture']);

export interface ImageOptions extends GenerateCommonOptions {
  readonly pathOrUrl: string;
  readonly noTexture: boolean;
}

export function parseImageArgs(argv: readonly string[], ctx: { readonly isTTY: boolean }): ImageOptions {
  const { positionals, options } = parseKnownFlags(argv, { boolean: IMAGE_BOOLEAN_FLAGS, valued: GENERATE_VALUED_FLAGS });
  if (positionals.length === 0) throw new Error('image: missing required <path-or-url> argument');
  if (positionals.length > 1) {
    throw new Error(`image: unexpected extra argument(s): ${positionals.slice(1).join(' ')}`);
  }
  const common = parseGenerateCommon(options);
  assertYesOrInteractive(common.yes, ctx.isTTY);
  return { ...common, pathOrUrl: positionals[0], noTexture: options.get('no-texture') === 'true' };
}

// ---------------------------------------------------------------------------
// estimate text|image -- same flag vocabulary, no spend and so no --yes/TTY
// gate and no positional beyond the "text"/"image" sub-kind the caller
// (`cli.ts`) has already consumed before reaching these.
// ---------------------------------------------------------------------------

export interface EstimateTextOptions {
  readonly modelType: ModelType;
  readonly aiModel: AiModel;
  readonly ultra: boolean;
  readonly refine: boolean;
  readonly textureResolution: TextureResolution;
  readonly json: boolean;
}

const ESTIMATE_TEXT_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['ultra', 'refine', 'json']);
const ESTIMATE_TEXT_VALUED_FLAGS: ReadonlySet<string> = new Set(['model-type', 'ai-model', 'tex']);

export function parseEstimateTextArgs(argv: readonly string[]): EstimateTextOptions {
  const { positionals, options } = parseKnownFlags(argv, {
    boolean: ESTIMATE_TEXT_BOOLEAN_FLAGS,
    valued: ESTIMATE_TEXT_VALUED_FLAGS,
  });
  if (positionals.length > 0) throw new Error(`estimate text: unexpected argument(s): ${positionals.join(' ')}`);
  const modelType = options.has('model-type') ? asModelType(options.get('model-type') as string) : 'standard';
  const aiModel = options.has('ai-model') ? asAiModel(options.get('ai-model') as string) : 'meshy-6';
  const textureResolution = options.has('tex') ? asTextureResolution(options.get('tex') as string) : '2k';
  return {
    modelType,
    aiModel,
    ultra: options.get('ultra') === 'true',
    refine: options.get('refine') === 'true',
    textureResolution,
    json: options.get('json') === 'true',
  };
}

export interface EstimateImageOptions {
  readonly modelType: ModelType;
  readonly aiModel: AiModel;
  readonly ultra: boolean;
  readonly noTexture: boolean;
  readonly textureResolution: TextureResolution;
  readonly json: boolean;
}

const ESTIMATE_IMAGE_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['ultra', 'no-texture', 'json']);
const ESTIMATE_IMAGE_VALUED_FLAGS: ReadonlySet<string> = new Set(['model-type', 'ai-model', 'tex']);

export function parseEstimateImageArgs(argv: readonly string[]): EstimateImageOptions {
  const { positionals, options } = parseKnownFlags(argv, {
    boolean: ESTIMATE_IMAGE_BOOLEAN_FLAGS,
    valued: ESTIMATE_IMAGE_VALUED_FLAGS,
  });
  if (positionals.length > 0) throw new Error(`estimate image: unexpected argument(s): ${positionals.join(' ')}`);
  const modelType = options.has('model-type') ? asModelType(options.get('model-type') as string) : 'standard';
  const aiModel = options.has('ai-model') ? asAiModel(options.get('ai-model') as string) : 'meshy-6';
  const textureResolution = options.has('tex') ? asTextureResolution(options.get('tex') as string) : '2k';
  return {
    modelType,
    aiModel,
    ultra: options.get('ultra') === 'true',
    noTexture: options.get('no-texture') === 'true',
    textureResolution,
    json: options.get('json') === 'true',
  };
}

// ---------------------------------------------------------------------------
// status / download / list / balance
// ---------------------------------------------------------------------------

export interface StatusOptions {
  readonly id: string;
  readonly kind: TaskKind | undefined; // undefined -> try both
  readonly json: boolean;
}

const STATUS_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['json']);
const STATUS_VALUED_FLAGS: ReadonlySet<string> = new Set(['kind']);

export function parseStatusArgs(argv: readonly string[]): StatusOptions {
  const { positionals, options } = parseKnownFlags(argv, { boolean: STATUS_BOOLEAN_FLAGS, valued: STATUS_VALUED_FLAGS });
  if (positionals.length === 0) throw new Error('status: missing required <id> argument');
  if (positionals.length > 1) throw new Error(`status: unexpected extra argument(s): ${positionals.slice(1).join(' ')}`);
  return {
    id: positionals[0],
    kind: options.has('kind') ? asTaskKind(options.get('kind') as string) : undefined,
    json: options.get('json') === 'true',
  };
}

export interface DownloadOptions {
  readonly id: string;
  readonly kind: TaskKind | undefined;
  readonly name: string | undefined;
  readonly json: boolean;
}

const DOWNLOAD_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['json']);
const DOWNLOAD_VALUED_FLAGS: ReadonlySet<string> = new Set(['kind', 'name']);

export function parseDownloadArgs(argv: readonly string[]): DownloadOptions {
  const { positionals, options } = parseKnownFlags(argv, { boolean: DOWNLOAD_BOOLEAN_FLAGS, valued: DOWNLOAD_VALUED_FLAGS });
  if (positionals.length === 0) throw new Error('download: missing required <id> argument');
  if (positionals.length > 1) throw new Error(`download: unexpected extra argument(s): ${positionals.slice(1).join(' ')}`);
  return {
    id: positionals[0],
    kind: options.has('kind') ? asTaskKind(options.get('kind') as string) : undefined,
    name: options.get('name'),
    json: options.get('json') === 'true',
  };
}

export interface ListOptions {
  readonly kind: TaskKind | undefined;
  readonly page: number;
  readonly json: boolean;
}

const LIST_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['json']);
const LIST_VALUED_FLAGS: ReadonlySet<string> = new Set(['kind', 'page']);

export function parseListArgs(argv: readonly string[]): ListOptions {
  const { positionals, options } = parseKnownFlags(argv, { boolean: LIST_BOOLEAN_FLAGS, valued: LIST_VALUED_FLAGS });
  if (positionals.length > 0) throw new Error(`list: unexpected argument(s): ${positionals.join(' ')}`);
  const page = parseIntFlag(options, 'page') ?? 1;
  if (page < 1) throw new Error(`--page must be >= 1, got ${page}`);
  return {
    kind: options.has('kind') ? asTaskKind(options.get('kind') as string) : undefined,
    page,
    json: options.get('json') === 'true',
  };
}

export interface BalanceOptions {
  readonly json: boolean;
}

const BALANCE_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['json']);
const NO_VALUED_FLAGS: ReadonlySet<string> = new Set();

export function parseBalanceArgs(argv: readonly string[]): BalanceOptions {
  const { positionals, options } = parseKnownFlags(argv, { boolean: BALANCE_BOOLEAN_FLAGS, valued: NO_VALUED_FLAGS });
  if (positionals.length > 0) throw new Error(`balance: unexpected argument(s): ${positionals.join(' ')}`);
  return { json: options.get('json') === 'true' };
}

export interface SpentOptions {
  readonly json: boolean;
}

export function parseSpentArgs(argv: readonly string[]): SpentOptions {
  const { positionals, options } = parseKnownFlags(argv, { boolean: BALANCE_BOOLEAN_FLAGS, valued: NO_VALUED_FLAGS });
  if (positionals.length > 0) throw new Error(`spent: unexpected argument(s): ${positionals.join(' ')}`);
  return { json: options.get('json') === 'true' };
}

/** Re-exported so `cli.ts` can print it in a usage/error message without a
 *  second literal 800 living outside `options.ts`. */
export { PROMPT_MAX_CHARS };
