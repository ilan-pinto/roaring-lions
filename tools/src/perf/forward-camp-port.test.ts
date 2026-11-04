/**
 * GH-277 forward camp: the browser check refuses the lead's port 5177 however it arrives -- `--port=5177` or
 * `FORWARD_CAMP_PORT=5177`, with or without `--attach` -- and defaults to 5195. Pure: it never starts a server or opens a port.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_CAMP_PORT, forwardCampPortRefusal } from './forward-camp-port';

describe('forwardCampPortRefusal', () => {
  it('refuses 5177 by flag, by FORWARD_CAMP_PORT, and with --attach', () => {
    expect(forwardCampPortRefusal(['--port=5177'], {})).toContain('refusing port 5177');
    expect(forwardCampPortRefusal([], { FORWARD_CAMP_PORT: '5177' })).toContain('refusing port 5177');
    expect(forwardCampPortRefusal(['--attach'], { FORWARD_CAMP_PORT: '5177' })).toContain('refusing port 5177');
  });
  it('lets the flag override the env both ways, and the default and other ports through', () => {
    expect(forwardCampPortRefusal(['--port=5195'], { FORWARD_CAMP_PORT: '5177' })).toBeNull();
    expect(forwardCampPortRefusal(['--port=5177'], { FORWARD_CAMP_PORT: '5195' })).not.toBeNull();
    expect(forwardCampPortRefusal([], {})).toBeNull();
    expect(forwardCampPortRefusal(['--port=5190'], {})).toBeNull();
  });
  it('the default is 5195, not the lead\'s', () => {
    expect(FORWARD_CAMP_PORT).toBe(5195);
  });
  it('the script asks it before it claims a port', () => {
    const src = readFileSync(join(__dirname, 'forward-camp-check.ts'), 'utf8');
    const ask = src.indexOf('forwardCampPortRefusal(');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(src.indexOf('await claimPortOrAttach('));
  });
});
