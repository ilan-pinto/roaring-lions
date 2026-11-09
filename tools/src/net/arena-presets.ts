/**
 * Model presets for the arena (GH-954 W2, decisions D-W6): `~/.roaring-lions/arena-players.json`, a private file of
 * TEMPLATES, so that the setup screen names a model by an id (`opus-5.5`) and never carries a command line.
 *
 * ```json
 * {"players": {
 *   "opus-5.5": {"label": "Claude Opus 5.5", "usage": "claude-json",
 *                "template": "cmd:claude -p --model <pinned id> --mcp-config {mcp} --output-format json --allowedTools mcp__lions__* < {prompt}",
 *                "judgeTemplate": "cmd:claude -p --model <pinned id> --output-format json < {prompt}"}}}
 * ```
 *
 * - `template` is a player (`{mcp}`, `{prompt}`, `{seat}`, `{code}`), `judgeTemplate` a judge (`{prompt}`,
 *   `{stats}`): a preset may be either or both, and at least one. Each is checked with `parseTemplate` when the file
 *   is read, so a template the arena cannot run is refused before any room.
 * - `usage` is optional and only `claude-json` (the one shape `usageOf` reads); it is a note, not a switch.
 * - The file must be mode 0600 (no group or world bit). A file anyone else can read is REFUSED, not warned about:
 *   `loadPresets` throws and the server does not start. A missing file is simply no presets.
 * - There is no key in it, and the arena reads none from it: a private token is the setup screen's, in memory for
 *   one run (`arena-control.ts`).
 * - A template is never sent anywhere: `catalogueOf` is what the screen is told (`{id, label, kind}`), and a
 *   `kind` says what a preset can do without showing how.
 */
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { JUDGE_PLACEHOLDERS } from './judge';
import { parseTemplate } from './external-player';

/** The scripted controls, which are not presets and need no file. */
export const SCRIPTED = ['passive', 'rush'] as const;

/** An id a preset may have: it ends up in file names, so no separators. */
export const PRESET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export interface Preset {
  id: string;
  label: string;
  /** A player template (`cmd:...`), or null: not a player. */
  template: string | null;
  /** A judge template (`cmd:...`), or null: not a judge. */
  judgeTemplate: string | null;
  usage: 'claude-json' | null;
}

export interface Presets {
  /** Where they were read from (a message names it; a response never does). */
  readonly file: string;
  readonly byId: ReadonlyMap<string, Preset>;
}

/** What a preset can do, for the screen: the three built-in/model kinds, never a template. */
export type PlayerKind = 'scripted' | 'model' | 'judge' | 'model_judge';

/** One row of `GET /arena/api/players`. */
export interface PlayerRow { id: string; label: string; kind: PlayerKind }

export class PresetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresetsError';
  }
}

export const defaultPresetsFile = (): string => join(homedir(), '.roaring-lions', 'arena-players.json');

/** Why `mode` is too open for a private file, or null. Pure, so a spec calls it with numbers. */
export function modeRefusal(mode: number): string | null {
  return (mode & 0o077) === 0 ? null : `is readable by its group or by everyone (mode ${(mode & 0o777).toString(8).padStart(3, '0')}); run chmod 600 on it`;
}

const KEYS = new Set(['label', 'template', 'judgeTemplate', 'usage']);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A parsed file's presets, or what is wrong with it. `file` is for the message only. */
export function parsePresets(text: string, file: string): Presets {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new PresetsError(`${file} is not JSON`); }
  if (!isRecord(raw) || !isRecord(raw.players) || Object.keys(raw).some((k) => k !== 'players')) throw new PresetsError(`${file} must be {"players": {...}}`);
  const ids = Object.keys(raw.players);
  if (ids.length > 64) throw new PresetsError(`${file} names more than 64 presets`);
  const byId = new Map<string, Preset>();
  for (const id of ids) {
    const where = `${file}: preset "${id}"`;
    if (!PRESET_ID.test(id) || (SCRIPTED as readonly string[]).includes(id)) throw new PresetsError(`${where} is not a usable id (letters, digits, . _ -, up to 32; not passive or rush)`);
    const p = raw.players[id];
    if (!isRecord(p)) throw new PresetsError(`${where} must be an object`);
    for (const k of Object.keys(p)) if (!KEYS.has(k)) throw new PresetsError(`${where} has an unknown field "${k}"`);
    if (typeof p.label !== 'string' || p.label.trim() === '' || p.label.length > 48) throw new PresetsError(`${where} needs a label of 1-48 characters`);
    const cmd = (field: 'template' | 'judgeTemplate'): string | null => {
      const v = p[field];
      if (v === undefined) return null;
      if (typeof v !== 'string' || !v.startsWith('cmd:')) throw new PresetsError(`${where}: ${field} is "cmd:<template>"`);
      try { parseTemplate(v, field === 'template' ? undefined : JUDGE_PLACEHOLDERS); } catch (e) { throw new PresetsError(`${where}: ${field}: ${e instanceof Error ? e.message : String(e)}`); }
      return v;
    };
    const template = cmd('template');
    const judgeTemplate = cmd('judgeTemplate');
    if (template === null && judgeTemplate === null) throw new PresetsError(`${where} has neither a template nor a judgeTemplate`);
    if (p.usage !== undefined && p.usage !== 'claude-json') throw new PresetsError(`${where}: usage is "claude-json"`);
    byId.set(id, { id, label: p.label.trim(), template, judgeTemplate, usage: p.usage === 'claude-json' ? 'claude-json' : null });
  }
  return { file, byId };
}

/**
 * The presets file, or none when there is no file. THROWS `PresetsError` for a file that is not a regular file, is
 * readable by group or world, or is malformed: the server (and `--a preset:...`) then refuses to start rather than
 * run on a file anyone could have changed or read.
 */
export function loadPresets(file: string = defaultPresetsFile()): Presets {
  let st;
  try {
    st = statSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { file, byId: new Map() };
    throw new PresetsError(`${file} cannot be read: ${(e as NodeJS.ErrnoException).code ?? 'error'}`);
  }
  if (!st.isFile()) throw new PresetsError(`${file} is not a regular file`);
  const why = modeRefusal(st.mode);
  if (why !== null) throw new PresetsError(`${file} ${why}`);
  return parsePresets(readFileSync(file, 'utf8'), file);
}

/** Every player a screen may pick, scripted first, then the presets in file order. No template. */
export function catalogueOf(presets: Presets): PlayerRow[] {
  const rows: PlayerRow[] = [
    { id: 'passive', label: 'passive', kind: 'scripted' },
    { id: 'rush', label: 'rush', kind: 'scripted' },
  ];
  for (const p of presets.byId.values()) {
    rows.push({ id: p.id, label: p.label, kind: p.template !== null && p.judgeTemplate !== null ? 'model_judge' : p.template !== null ? 'model' : 'judge' });
  }
  return rows;
}

/** A spec on the command line for a preset: `preset:<id>`. */
export const presetSpec = (id: string): string => `preset:${id}`;
/** The id out of a `preset:<id>` spec, or null. */
export function presetIdOf(spec: string): string | null {
  return spec.startsWith('preset:') && PRESET_ID.test(spec.slice(7)) ? spec.slice(7) : null;
}
