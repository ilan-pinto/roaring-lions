// Yield one macrotask after every test, so a file of synchronous tests can
// never starve vitest's worker RPC.
//
// Why this exists: `@vitest/runner` reports progress through
// `onTaskUpdate`, a birpc CALL with a 60 s reply timeout, sent synchronously
// at a test boundary. Between tests the runner only awaits promises -- it
// never returns to the event loop -- so while a file's tests are CPU-bound
// the main thread's reply sits unread in the worker's queue. When the loop
// finally turns, timers run before I/O, the 60 s timer fires first, and the
// job goes red with "Timeout calling onTaskUpdate" and every test green.
// What decides it is the SUM of consecutive synchronous tests, not any one:
// ring_burial (55-61 s, fixed in 4e283f31 by yielding inside its own sweep)
// and then launcher_clearance on PR #339 (66.8 s, two mortar tests of 27.6
// and 23.4 s back to back) hit the same wall from different files.
//
// One setImmediate per test lets the reply land, so the window is bounded by
// the slowest SINGLE test instead of the slowest file. Imported from
// `node:timers` rather than read off `globalThis` so a spec that calls
// `vi.useFakeTimers()` cannot freeze it.
//
// Falsified: three synchronous 22 s tests in one file (66 s) reproduce
// "Timeout calling onTaskUpdate" without this hook and pass cleanly with it.
import { setImmediate } from 'node:timers';
import { afterEach } from 'vitest';

afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
