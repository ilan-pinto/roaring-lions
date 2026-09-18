/**
 * `loadMeshyConfig` against an injected env object and a temp key file --
 * never the real `~/.config/roaring-lions/meshy.env` or `process.env`, and
 * no network. These tests write a fake key to a temp file to prove the
 * parser and precedence rules work; that value is not a real credential.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_USD_PER_CREDIT } from './pricing';
import { loadMeshyConfig, parseEnvFile } from './config';

describe('parseEnvFile', () => {
  it('parses KEY=VALUE lines', () => {
    expect(parseEnvFile('MESHY_API_KEY=abc123\n')).toEqual({ MESHY_API_KEY: 'abc123' });
  });

  it('ignores blank lines and # comments', () => {
    expect(parseEnvFile('# a comment\n\nMESHY_API_KEY=abc123\n')).toEqual({ MESHY_API_KEY: 'abc123' });
  });

  it('strips matching surrounding quotes', () => {
    expect(parseEnvFile('MESHY_API_KEY="abc 123"\n')).toEqual({ MESHY_API_KEY: 'abc 123' });
    expect(parseEnvFile("MESHY_API_KEY='abc 123'\n")).toEqual({ MESHY_API_KEY: 'abc 123' });
  });

  it('handles multiple assignments', () => {
    expect(parseEnvFile('MESHY_API_KEY=k\nMESHY_USD_PER_CREDIT=0.03\n')).toEqual({
      MESHY_API_KEY: 'k',
      MESHY_USD_PER_CREDIT: '0.03',
    });
  });

  it('ignores a line with no "="', () => {
    expect(parseEnvFile('not an assignment\nMESHY_API_KEY=k\n')).toEqual({ MESHY_API_KEY: 'k' });
  });
});

describe('loadMeshyConfig', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reports no key when neither env nor file has one', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'meshy-config-test-'));
    const keyFile = path.join(dir, 'meshy.env');
    const config = loadMeshyConfig({}, keyFile);
    expect(config.apiKey).toBeUndefined();
    expect(config.apiKeySource).toBe('none');
    expect(config.usdPerCredit).toBe(DEFAULT_USD_PER_CREDIT);
  });

  it('reads the key from the file when the env var is absent', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'meshy-config-test-'));
    const keyFile = path.join(dir, 'meshy.env');
    writeFileSync(keyFile, 'MESHY_API_KEY=fake-test-key-not-real\n');
    const config = loadMeshyConfig({}, keyFile);
    expect(config.apiKey).toBe('fake-test-key-not-real');
    expect(config.apiKeySource).toBe('file');
  });

  it('prefers the environment variable over the file', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'meshy-config-test-'));
    const keyFile = path.join(dir, 'meshy.env');
    writeFileSync(keyFile, 'MESHY_API_KEY=from-file\n');
    const config = loadMeshyConfig({ MESHY_API_KEY: 'from-env' }, keyFile);
    expect(config.apiKey).toBe('from-env');
    expect(config.apiKeySource).toBe('env');
  });

  it('tolerates a missing key file entirely', () => {
    const config = loadMeshyConfig({}, path.join(tmpdir(), 'meshy-config-test-does-not-exist', 'meshy.env'));
    expect(config.apiKey).toBeUndefined();
    expect(config.apiKeySource).toBe('none');
  });

  it('reads MESHY_USD_PER_CREDIT from the file, env taking precedence', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'meshy-config-test-'));
    const keyFile = path.join(dir, 'meshy.env');
    writeFileSync(keyFile, 'MESHY_API_KEY=k\nMESHY_USD_PER_CREDIT=0.03\n');
    const fromFile = loadMeshyConfig({}, keyFile);
    expect(fromFile.usdPerCredit).toBe(0.03);
    expect(fromFile.usdPerCreditSource).toBe('file');

    const fromEnv = loadMeshyConfig({ MESHY_USD_PER_CREDIT: '0.07' }, keyFile);
    expect(fromEnv.usdPerCredit).toBe(0.07);
    expect(fromEnv.usdPerCreditSource).toBe('env');
  });

  it('never includes the key in a JSON-serialised form other than apiKey itself', () => {
    // Not a security proof, just a guard against an obviously wrong future
    // refactor that flattens fileVars onto the returned object.
    dir = mkdtempSync(path.join(tmpdir(), 'meshy-config-test-'));
    const keyFile = path.join(dir, 'meshy.env');
    writeFileSync(keyFile, 'MESHY_API_KEY=fake-test-key-not-real\n');
    const config = loadMeshyConfig({}, keyFile);
    const keys = Object.keys(config);
    expect(keys).toEqual(['apiKey', 'apiKeySource', 'usdPerCredit', 'usdPerCreditSource', 'keyFile']);
  });
});
