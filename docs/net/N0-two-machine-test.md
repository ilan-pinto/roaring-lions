# N0 · The two-machine test

**What it proves:** two machines run one sandbox battle in lockstep through the
deployed `MatchRoom`, with equal hashes every 20 ticks for ten minutes, ten
times. The gate on issue #190.

The three-engine half of the same claim (Chromium, Firefox and WebKit, one
hash at tick 600) is not part of this run: CI's `visual` job checks it on every
push (`pnpm net:engines`).

## Before the first run (lead)

- **`TICKET_SECRET`: done.** Set on the live Worker by the lead on 2026-10-11.
- **Merge `feat/net-n0`.** Merging deploys the `MatchRoom` Durable Object with
  its migration `net-v1`; until then `/api/match` does not exist on the live
  site.
- **Workers Free is enough.** A room writes about one SQLite row a second while
  a match runs (measured in a simulated 60 s match: 1.00 rows/s steady, 0.92
  with a flapping slow seat), so Free's 100,000 rows a day hold about 27 hours
  of play a day. Ten ten-minute runs use about 6,000.

## Setup

1. Both machines on the deployed build, `https://roaring-lions.pint12.workers.dev`,
   at the same version. The room refuses a mismatch (`build_mismatch`) and the
   page shows its boot-failure card.
2. Machine A opens `/free-play/beit_sahwan_outskirts?net=new&callsign=A`. The
   URL rewrites to `?net=<CODE>&seat=0`, and the console prints
   `[net] Room <CODE> · seat 0 · waiting for the other seat`.
3. Machine B opens `/free-play/beit_sahwan_outskirts?net=<CODE>&callsign=B`.
4. The match starts when both seats are in. Both machines command the same KDF
   force. Expect a short "Waiting for A: behind" (or B) at the start while
   meshes load, then a catch-up; that is not a fault.

## The run (×10)

- Play for ten minutes (12,000 ticks): both order units, fight the Sarim force,
  pause nothing. Keep both tabs in the foreground (see the limits below).
- The room compares hashes every 20 ticks. On agreement nothing is shown. The
  one HUD line reads, when it has something to say:
  - `Waiting for {seat}: behind` / `Waiting for {seat}: connection lost` (a stall)
  - `Desync at {m:ss}. The match is void; report it.` (the console adds
    `[net] DESYNC at tick N`)
  - a closed room says why: `The other seat left the match`, `Match void`,
    `The room expired`, or `This seat was opened in another tab`.
- At the end, read in each console: `__lions.sim.tickCount` and
  `__lions.sim.hash()`. They must match across the two machines.
- Round trip: the transport does not log it. Estimate it from devtools →
  Network → the `/ws` socket → Messages: the time between a frame you send and
  the next frame the room sends back.
- One run of the ten: unplug B's network for 10 s mid-fight. Expected: A's
  line reads `Waiting for B: connection lost` (B's own line may say the same
  once its socket drops), B reconnects by itself, both continue, and the hashes
  still agree.

## Known N0 limits (not failures)

- Orders given while a seat is reconnecting are lost on both machines. Nothing
  desyncs.
- A background tab stalls the room for both players.
- Restart is not available in a room.
- A page reload cannot rejoin a running match (N1).

## Report (append to #190)

| Run | Machines / networks | Ticks | Desync? | Stalls (count, longest) | Round trip (ms, estimate) | Reconnect (s) |
|---|---|---|---|---|---|---|

Also: the Durable Object usage for the session (Cloudflare dashboard → Durable
Objects → roaring-lions), and anything that surprised you.
