/**
 * GH-974 review: `pnpm perf:instancing` refuses the lead's port 5177 however it arrives -- `--port=5177`,
 * `INSTANCING_AB_PORT=5177`, or a default that ever became 5177. Pure: it never starts a server or opens a port.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSTANCING_DEFAULT_PORT, instancingPortRefusal } from './instancing-port';

describe('instancingPortRefusal', () => {
  it('refuses 5177 by flag and by INSTANCING_AB_PORT', () => {
    expect(instancingPortRefusal(['--port=5177'], {})).toContain('refusing port 5177');
    expect(instancingPortRefusal([], { INSTANCING_AB_PORT: '5177' })).toContain('refusing port 5177');
  });
  it('lets the flag override the env both ways, and the default and other ports through', () => {
    expect(instancingPortRefusal(['--port=5190'], { INSTANCING_AB_PORT: '5177' })).toBeNull();
    expect(instancingPortRefusal(['--port=5177'], { INSTANCING_AB_PORT: '5190' })).not.toBeNull();
    expect(instancingPortRefusal([], {})).toBeNull();
    expect(instancingPortRefusal(['--port=5190'], {})).toBeNull();
  });
  it('the default is not the lead\'s and not another harness\'s', () => {
    expect(INSTANCING_DEFAULT_PORT).not.toBe(5177);
    expect(INSTANCING_DEFAULT_PORT).not.toBe(5186); // bloom-census
  });
  it('the script asks it before it claims a port', () => {
    const src = readFileSync(join(__dirname, 'instancing-ab.ts'), 'utf8');
    const ask = src.indexOf('instancingPortRefusal(');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(src.indexOf('await claimPort('));
    // ...and acts on the answer (exits) before the claim, not after it.
    const exits = src.indexOf('if (refusal !== null)');
    expect(exits).toBeGreaterThan(-1);
    expect(exits).toBeLessThan(src.indexOf('await claimPort('));
  });
});
