/**
 * GH-984 N2: `pnpm nature:capture` refuses the lead's port 5177 however it arrives -- `--port=5177` or
 * `NATURE_CAPTURE_PORT=5177`, with or without `--attach` -- and defaults to 5182. Pure: it never starts a server,
 * opens a port or spawns the real tool.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NATURE_DEFAULT_PORT, naturePortRefusal } from './nature-port';

describe('naturePortRefusal', () => {
  it('refuses 5177 by flag, by NATURE_CAPTURE_PORT, and with --attach', () => {
    expect(naturePortRefusal(['--port=5177'], {})).toContain('refusing port 5177');
    expect(naturePortRefusal([], { NATURE_CAPTURE_PORT: '5177' })).toContain('refusing port 5177');
    expect(naturePortRefusal(['--attach'], { NATURE_CAPTURE_PORT: '5177' })).toContain('refusing port 5177');
  });
  it('lets the flag override the env both ways, and the default and other ports through', () => {
    expect(naturePortRefusal(['--port=5182'], { NATURE_CAPTURE_PORT: '5177' })).toBeNull();
    expect(naturePortRefusal(['--port=5177'], { NATURE_CAPTURE_PORT: '5182' })).not.toBeNull();
    expect(naturePortRefusal([], {})).toBeNull();
    expect(naturePortRefusal(['--port=5190'], {})).toBeNull();
  });
  it('defaults to 5182', () => {
    expect(NATURE_DEFAULT_PORT).toBe(5182);
    const src = readFileSync(join(__dirname, 'nature-captures.ts'), 'utf8');
    expect(src).toContain("claimPortOrAttach(TAG, 'NATURE_CAPTURE_PORT', NATURE_DEFAULT_PORT)");
  });
  it('the script asks it before it claims a port', () => {
    const src = readFileSync(join(__dirname, 'nature-captures.ts'), 'utf8');
    const ask = src.indexOf('naturePortRefusal(');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(src.indexOf('await claimPortOrAttach('));
  });
  it('a malformed port is an error, not a fall-through to the default', () => {
    expect(() => naturePortRefusal(['--port=abc'], {})).toThrow();
    expect(() => naturePortRefusal([], { NATURE_CAPTURE_PORT: 'x' })).toThrow();
  });
});
