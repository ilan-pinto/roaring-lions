/**
 * GH-330: the store's per-campaign pay figure is a COPY of `pnpm playtest`'s
 * ladder pin, and this spec is what keeps the copy honest. Read as TEXT on
 * both sides -- the harness is a CLI that runs every mission on import, so it
 * cannot be imported -- the way `units/missiles.ts`' copied `PROJ_SPEED` is
 * pinned against `tuning.ts`. Its predecessor, `LIFETIME_CREDITS`, sat at 5,849
 * for days after GH-345 moved the ladder to 5,736, because nothing read both.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAMPAIGN_CREDITS } from '../../packages/app/src/ui/stores-model';

const root = resolve(__dirname, '../..');

function pinned(file: string, name: string): number {
  const text = readFileSync(resolve(root, file), 'utf8');
  const m = new RegExp(`^(?:export )?const ${name} = (\\d+);`, 'm').exec(text);
  if (m === null) throw new Error(`${file}: no "const ${name} = <integer>;" line`);
  return Number(m[1]);
}

describe('CAMPAIGN_CREDITS follows LADDER_CREDITS (GH-330)', () => {
  it('the store quotes exactly what the ladder pins', () => {
    const ladder = pinned('tools/src/backtest/playtest.ts', 'LADDER_CREDITS');
    expect(pinned('packages/app/src/ui/stores-model.ts', 'CAMPAIGN_CREDITS')).toBe(ladder);
    expect(CAMPAIGN_CREDITS).toBe(ladder);
  });
});
