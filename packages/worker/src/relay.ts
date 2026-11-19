/**
 * GH-1397: the relay Worker's entry (`wrangler.relay.jsonc`, script `roaring-lions-relay`). It hosts the
 * `MatchRoom` Durable Object class and nothing else, so a deploy of the game Worker (`index.ts`, every merge to
 * main) no longer restarts the script that holds the live rooms. Design:
 * `docs/superpowers/specs/2026-11-15-relay-worker-split-design.md` (D-R2: a second entry file over the same
 * modules, so no match code moves).
 *
 * Every `/api/match*` route, the limiters, the Origin rule and ticket SIGNING stay in the game Worker, which
 * reaches this class through a Durable Object binding with `script_name` (`match/routes.ts`'s `roomsOf`). The
 * relay has no public URL (D-R3: `workers_dev` and `preview_urls` off, no routes), so its own `fetch` is never
 * reached from the internet and answers 404 to anything that does reach it.
 *
 * Keep this file to these two exports: `relay-config.test.ts` (F8) holds the bundle's import closure to the
 * room's, and the relay's Workers Builds watch paths are derived from that closure.
 */
export { MatchRoom } from './match/match-room';

export default {
  fetch(): Response {
    return new Response('not found', { status: 404 });
  },
};
