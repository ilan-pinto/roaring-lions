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
- **No merges to `main` during a run.** Every merge deploys, and every deploy
  restarts the room: both seats reconnect and the room revives, but orders in
  flight at that moment can be lost (R36), so a run that spans a deploy is not
  a clean reading. Agree a window with anyone who might merge.
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
- The room compares hashes every 20 ticks. On agreement nothing is shown on
  screen, but each seat counts it: `__lions.net().hashOk` (below) is the
  positive evidence that hashes were compared at all. The one HUD line reads,
  when it has something to say:
  - `Waiting for {seat}: behind` / `Waiting for {seat}: connection lost` (a stall)
  - `Desync at {time}. The match is void; report it.` ({time} is the match
    clock as m:ss; the console adds `[net] DESYNC at tick N`)
  - a closed room says why: `The other seat left the match`, `Match void`,
    `The room expired`, or `This seat was opened in another tab`.
- **At the end, BEFORE either seat leaves, run `__lions.net()` in EACH
  console** and copy the output into the report. The seat that leaves loses
  `__lions` with its battlefield, so read both first. It returns:
  - `seat`, `room`, `tickCount`, `status`;
  - `hashOk: { count, lastTick }` -- hashes the room paired and found equal;
  - `stalls: { behind, gone, connecting }`, each `{ count, longestMs }`;
  - `reconnects: { count, lastOutageMs, lastReplayMs }` -- drops that came
    back, the last one's outage (drop to the room's `log`) and its replay
    (the `log` run down to the buffer);
  - `desyncTick` -- `null` unless the room reported a desync.

  A pass reads, on BOTH machines: `desyncTick: null`, and `hashOk.count` close
  to `tickCount / 20` (a 10-minute run is about 600). The two machines are
  never on the same tick at the same moment, so do not compare `tickCount` or
  `__lions.sim.hash()` across them; compare the `hashOk` counts, which differ
  by the one or two in flight when each was read, plus any the room sent
  while a seat was reconnecting (that seat never receives them). A
  `hashOk.count` of 0 after minutes of play means nothing was compared: that
  run FAILS, whatever the screen showed.
- Round trip: the transport does not measure it. Estimate it from devtools →
  Network → the `/ws` socket → Messages: the time between a command you send
  (`"t":"cmd"`) and the first frame the room sends back carrying it (clients
  send commands and acks, never frames).
- One run of the ten: unplug B's network for 10 s mid-fight. Expected: A's
  line most likely reads `Waiting for {seat}: behind` (`Waiting for B: behind`),
  not "connection lost". An unplugged cable does not close B's socket at the
  room, and the room checks "behind" (40 ticks without an ack, about 2 s)
  before silence, so "behind" trips first and the room's clock stops there.
  It changes to `Waiting for {seat}: connection lost` only once the room sees
  B's socket close, which may never happen if B is back within 10 s. Then B
  reconnects by itself, both continue, and the hashes still agree.
  `__lions.net().stalls.behind` counts it on A; B's `reconnects` counts it only
  if its socket actually dropped.
- **A "behind" that does not clear for ~100 s after a network change** can be
  a dead TCP connection, not a slow seat: neither side sends while the room is
  stalled, so nothing notices the dead socket until it times out and closes
  (then B reconnects by itself). Wait it out once and note it; it is not a
  desync.

## Known N0 limits (not failures)

- Orders given while a seat is reconnecting are lost on both machines. Nothing
  desyncs.
- A background tab stalls the room for both players.
- Restart is not available in a room.
- A page reload cannot rejoin a room (N1). After `?net=new` the host's URL
  carries `&seat=0`, so a reload is refused on its boot-failure card with "a
  reload cannot rejoin a running room in N0; open a new room (?net=new)",
  rather than taking the guest's seat and wedging the room. Open a new room.

## Report (append to #190)

Every column but the round trip is read off `__lions.net()` on the two
machines (A / B):

| Run | Machines / networks | `tickCount` (A / B) | `hashOk.count` (A / B) | `desyncTick` | Stalls: `behind` / `gone` / `connecting`, count and `longestMs` | Reconnects: count, `lastOutageMs` + `lastReplayMs` | Round trip (ms, devtools estimate) |
|---|---|---|---|---|---|---|---|

Also: the Durable Object usage for the session (Cloudflare dashboard → Durable
Objects → roaring-lions), and anything that surprised you.
