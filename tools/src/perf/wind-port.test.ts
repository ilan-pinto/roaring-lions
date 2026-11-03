/**
 * GH-984 N1 review: `pnpm wind:capture` refuses the lead's port 5177 however it arrives -- `--port=5177` or
 * `WIND_CAPTURE_PORT=5177`, with or without `--attach`. Pure: it never starts a server or opens a port.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { windPortRefusal } from './wind-port';

describe('windPortRefusal', () => {
  it('refuses 5177 by flag, by WIND_CAPTURE_PORT, and with --attach', () => {
    expect(windPortRefusal(['--port=5177'], {})).toContain('refusing port 5177');
    expect(windPortRefusal([], { WIND_CAPTURE_PORT: '5177' })).toContain('refusing port 5177');
    expect(windPortRefusal(['--attach'], { WIND_CAPTURE_PORT: '5177' })).toContain('refusing port 5177');
  });
  it('lets the flag override the env both ways, and the default and other ports through', () => {
    expect(windPortRefusal(['--port=5181'], { WIND_CAPTURE_PORT: '5177' })).toBeNull();
    expect(windPortRefusal(['--port=5177'], { WIND_CAPTURE_PORT: '5181' })).not.toBeNull();
    expect(windPortRefusal([], {})).toBeNull();
    expect(windPortRefusal(['--port=5190'], {})).toBeNull();
  });
  it('the script asks it before it claims a port', () => {
    const src = readFileSync(join(__dirname, 'wind-captures.ts'), 'utf8');
    const ask = src.indexOf('windPortRefusal(');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(src.indexOf('await claimPortOrAttach('));
  });
});
