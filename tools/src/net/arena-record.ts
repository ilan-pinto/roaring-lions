/**
 * What a game's record says about the run that made it (GH-954, public-arena P1): the build, the pace, the round wall
 * time, the cap, and a digest of what the players were told and offered. Two results are comparable only when these
 * match, and a record that lacks them is an older one: nothing here is ever guessed for it.
 *
 * `promptDigest` is the sha256 of the standing prompt as it is on disk (`arena-prompt.md`, the `{seat}` and `{code}`
 * placeholders still in it, so one run has one digest) and of the tool list a command-scope player is offered (each
 * tool's name, description and argument schema). It reads nothing about a player: no command line, template, token or
 * name goes in, so the same prompt and tools give the same digest whoever plays.
 */
import { createHash } from 'node:crypto';
import { readStandingPrompt } from './external-player';
import { toolsFor } from './mcp-tools';

/** The part of a tool a model sees. */
export interface OfferedTool { name: string; description: string; schema: Record<string, unknown> }

/** JSON with every object's keys sorted, so a reordered schema is not a changed one. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** The digest of a prompt text and a tool list; pure, so a spec can change either one. The tool order is kept: it is the order the model is shown. */
export function promptDigestOf(prompt: string, tools: readonly OfferedTool[]): string {
  const body = canonical({ prompt, tools: tools.map((t) => ({ name: t.name, description: t.description, schema: t.schema })) });
  return createHash('sha256').update(body).digest('hex');
}

/** The digest for this checkout: the prompt file and the tools a `--scope command` player is given. */
export function currentPromptDigest(): string {
  return promptDigestOf(readStandingPrompt(), toolsFor('command'));
}

/** The five fields a new record carries. */
export interface RunFields { build: string; pace: number; roundWallMs: number; capTicks: number; promptDigest: string }

/** `${version}+${commit}` (build-id.ts): a semver, a plus, and lowercase hex or nothing. A token-shaped string is not one. */
export const BUILD = /^\d+\.\d+\.\d+[0-9A-Za-z.-]{0,20}\+[0-9a-f]{0,40}$/;
const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/**
 * The five fields of a stored record, or null when any is missing or malformed (an older record, or one from some
 * other tool). Strict on purpose: a value that is not exactly the shape the arena writes is not shown, so a stray
 * string in an old file cannot reach a page through these fields.
 */
export function runFieldsOf(r: unknown): RunFields | null {
  if (typeof r !== 'object' || r === null) return null;
  const o = r as Record<string, unknown>;
  const { build, pace, roundWallMs, capTicks, promptDigest } = o;
  if (typeof build !== 'string' || !BUILD.test(build)) return null;
  if (!posInt(pace) || !posInt(roundWallMs) || !posInt(capTicks)) return null;
  if (typeof promptDigest !== 'string' || !/^[0-9a-f]{64}$/.test(promptDigest)) return null;
  return { build, pace, roundWallMs, capTicks, promptDigest };
}
