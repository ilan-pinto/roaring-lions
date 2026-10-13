import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { routes } from '../shell/links';
import { leaveHref } from './leave-copy';

describe('leaveHref (PA-25)', () => {
  it('sends a Free Play leave back to the picker, not the campaign map', () => {
    expect(leaveHref(true)).toBe(routes.freePlay());
    expect(leaveHref(true)).not.toBe(routes.campaign());
  });
  it('still sends a mission leave to the campaign map', () => {
    expect(leaveHref(false)).toBe(routes.campaign());
  });
});

// The two in-battle exits are wired in main.ts, which cannot be mounted in a
// unit test: pin their one shared answer as text, the way `missiles.ts`'s copy
// of PROJ_SPEED is pinned. A leave that goes back to a bare
// `req.navigate(routes.campaign())` is the defect.
describe('the in-battle exits ask leaveHref', () => {
  const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
  // The pause menu's Quit goes through `quitHref` since N1b L-3: it is
  // `leaveHref(!mission)` outside a room (pinned in room-pause.test.ts) and
  // Play with a friend inside one.
  it('the HUD leave button lands through leaveHref(!mission) and the pause menu Quit through quitHref(room !== null, !mission)', () => {
    expect(main.match(/req\.navigate\(leaveHref\(!mission\)\)/g) ?? []).toHaveLength(1);
    expect(main.match(/req\.navigate\(quitHref\(room !== null, !mission\)\)/g) ?? []).toHaveLength(1);
  });
});
