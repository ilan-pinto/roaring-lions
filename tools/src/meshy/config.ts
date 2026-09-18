/**
 * Where the API key and the (optional) USD-per-credit override come from.
 *
 * The key lives OUTSIDE the repo on purpose: `~/.config/roaring-lions/meshy.env`
 * (mode 600), never under version control. This module reads it -- and the
 * `MESHY_API_KEY` environment variable, which wins when both are set -- and
 * never logs, prints or returns the value through anything but `MeshyConfig.apiKey`
 * itself. Callers (`cli.ts`) must keep it that way: it must never be printed,
 * written into a file under the repo, or included in a report.
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveUsdPerCredit } from './pricing';

export const KEY_ENV_VAR = 'MESHY_API_KEY';

export const DEFAULT_KEY_FILE = path.join(os.homedir(), '.config', 'roaring-lions', 'meshy.env');

export type ConfigSource = 'env' | 'file' | 'none';

export interface MeshyConfig {
  readonly apiKey: string | undefined;
  readonly apiKeySource: ConfigSource;
  readonly usdPerCredit: number;
  readonly usdPerCreditSource: ConfigSource;
  readonly keyFile: string;
}

/**
 * Minimal `KEY=VALUE` parser for the env file -- one assignment per line,
 * `#` comments and blank lines ignored, optional matching quotes stripped.
 * Not a general dotenv implementation; this file only ever holds two keys.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    if (key.length > 0) out[key] = value;
  }
  return out;
}

/**
 * Loads the key and the USD-per-credit override. `env` and `keyFile` are
 * injectable so tests never touch the real `~/.config` file or `process.env`.
 */
export function loadMeshyConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  keyFile: string = DEFAULT_KEY_FILE
): MeshyConfig {
  let fileVars: Record<string, string> = {};
  if (existsSync(keyFile)) {
    try {
      fileVars = parseEnvFile(readFileSync(keyFile, 'utf8'));
    } catch {
      fileVars = {};
    }
  }

  let apiKey: string | undefined;
  let apiKeySource: ConfigSource = 'none';
  if (env[KEY_ENV_VAR]) {
    apiKey = env[KEY_ENV_VAR];
    apiKeySource = 'env';
  } else if (fileVars[KEY_ENV_VAR]) {
    apiKey = fileVars[KEY_ENV_VAR];
    apiKeySource = 'file';
  }

  const usdPerCreditSource: ConfigSource =
    env.MESHY_USD_PER_CREDIT !== undefined ? 'env' : fileVars.MESHY_USD_PER_CREDIT !== undefined ? 'file' : 'none';
  const usdPerCredit = resolveUsdPerCredit({ MESHY_USD_PER_CREDIT: env.MESHY_USD_PER_CREDIT ?? fileVars.MESHY_USD_PER_CREDIT });

  return { apiKey, apiKeySource, usdPerCredit, usdPerCreditSource, keyFile };
}
