/**
 * Where the Gemini API key comes from.
 *
 * The key lives OUTSIDE the repo: `~/.config/roaring-lions/gemini.env`
 * (mode 600) holding `GEMINI_API_KEY=...`, or the `GEMINI_API_KEY`
 * environment variable, which wins when both are set. Same shape and the same
 * parser as the Meshy key (`../meshy/config.ts`). This module never prints,
 * logs or returns the value through anything but `VideoConfig.apiKey`, and
 * `cli.ts` passes it only into the `x-goog-api-key` request header.
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnvFile } from '../meshy/config';

export const KEY_ENV_VAR = 'GEMINI_API_KEY';
export const DEFAULT_KEY_FILE = path.join(os.homedir(), '.config', 'roaring-lions', 'gemini.env');

export interface VideoConfig {
  readonly apiKey: string | undefined;
  readonly apiKeySource: 'env' | 'file' | 'none';
  readonly keyFile: string;
}

/** `env` and `keyFile` are injectable so tests never read the real file. */
export function loadVideoConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  keyFile: string = DEFAULT_KEY_FILE
): VideoConfig {
  if (env[KEY_ENV_VAR]) return { apiKey: env[KEY_ENV_VAR], apiKeySource: 'env', keyFile };
  if (existsSync(keyFile)) {
    try {
      const vars = parseEnvFile(readFileSync(keyFile, 'utf8'));
      if (vars[KEY_ENV_VAR]) return { apiKey: vars[KEY_ENV_VAR], apiKeySource: 'file', keyFile };
    } catch {
      // An unreadable key file is the same as no key: nothing is sent.
    }
  }
  return { apiKey: undefined, apiKeySource: 'none', keyFile };
}
