// TEMPORARY CI probe -- reverted before merge. Three synchronous 22 s tests
// in one file (66 s with no macrotask between them) reproduce "Timeout
// calling onTaskUpdate" deterministically without vitest.setup.ts's yield.
import { it } from 'vitest';

const spin = (ms: number): void => {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy */ }
};
for (let i = 0; i < 3; i++) it(`sync ${i}`, () => spin(22_000), 60_000);
