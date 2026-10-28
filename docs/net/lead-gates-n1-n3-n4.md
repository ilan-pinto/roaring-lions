# The lead's three network gates: N1, N3, N4

One run sheet for the three gates still waiting on the lead (the network-next
spec, 28 Oct, section 1.2). None needs code. Report every result as a comment on
**GH-191** (the lane's issue); the closing line on **GH-169** is at the foot.

House format as in [N0-two-machine-test.md](N0-two-machine-test.md) and
[N1-friend-match.md](N1-friend-match.md). The AI half is
[N4-agent.md](N4-agent.md); this sheet only orders it for you.

## Before any run

- Both players on the deployed build, `https://roaring-lions.pint12.workers.dev`,
  at the same version. A mismatch is refused (`build_mismatch`; the page says
  "Your friend is on a different version: both reload the page"). The foot of
  Settings shows `Build <version>+<commit>`.
- **No merges to `main` during a run.** Every merge deploys and restarts the room;
  an order in flight can be lost (R36), and the run is no clean reading.
- Keep both windows visible. A hidden tab stalls the room.
- Music is the lead's choice here; nothing below needs it off.
- At the end of **every** match, before either window closes, run
  `__lions.net()` in each console. Pass: `desyncTick: null` on both and
  `hashOk.count` near `tickCount / 20`. Paste both on GH-191.

---

## N1. Three matches to a result, and one deliberate desync

**Proves:** the friend match works end to end, and a desync, when one happens, is
reported end to end (a visible line, a Report form, a row in D1).
**Time:** about 1 hour (three matches of 10 to 20 minutes, plus 10 minutes for
the desync).

### Setup

Two browsers on two devices (your friend's, and yours). You host. Mirror match
(your side picker on **Mirror**), on a map the lobby offers. Use a different
map for each of the three matches if you can; the lobby's map card lists the
versus maps it offers.

### Matches 1 to 3

1. Menu, **Play with a friend**. Enter your callsign, pick the map, **Open a
   room**. Send the code or the copied link.
2. Your friend opens the link (or types the code under **Join a match**), gives a
   callsign. Both press **Ready**.
3. Play to a result. Between the three matches, do each of these once:
   - **Escape** to pause (three pauses of 90 s each per seat).
   - Reload one window mid-match. It should rejoin by itself; the other shows
     "Waiting for ..." until it does. Note the time it took.
   - One match ends by **Surrender**, one by annihilation, and the third any way
     it falls (time cap at 25 minutes is a draw by force value).
4. Run `__lions.net()` in both consoles (see above) before leaving the end panel.

### The deliberate desync (match 4, or the end of match 3)

**No supported way exists.** The room, the lobby and the app have no switch that
makes two seats disagree; `roomFlags` forces every dev flag off in a room on
purpose, and the CI tests that provoke one (`tools/src/net/two-client.test.ts`)
run in Node, not in a room. What you can do today is a console trick that uses an
existing sandbox hook. It is **unsupported**, touches only your own tab's copy of
the sim, and its only effect on the room is the one you want, a void match:

1. Open a room as usual and start a match. Wait a few seconds.
2. In **one** window's console only (say, yours), run:

   ```js
   __lions.sim.debugKill(__lions.units()[0].id)
   ```

   That unit dies on your sim and nowhere else. The next hash tick (every 20
   ticks, one second of game) the two seats report different hashes.
3. Note the code and the clock on the desync line. Do not reload either window
   yet.

**Smallest safe tool, if you want this repeatable (not built; for your decision):**
a `?netfault=<tick>` URL flag, read by one seat only, that flips one bit of that
seat's own hash input at tick `<tick>` and does nothing else. It would not touch
the sim, the frames or the room, and it would let the sheet say "open the room with `&netfault=400` in window B" instead of a console
line. Say yes and it becomes one small task. Until then the console line above
is the sheet's method.

### What to look at (the desync)

- **On screen, both windows:** the status line reads "Desync at m:ss in room
  CODE. The match is void." with a **Report** button. The match halts.
- **Report:** press it in one window. It opens the feedback form with the
  first line already filled ("Desync in room CODE at m:ss (seat N)"). No replay
  is attached (a room's report withholds it on purpose, R-B16); the room already
  wrote the evidence. Send the form, or just read the draft.
- **/stats does not show it.** The `/stats` page has no desync panel. The record is
  the D1 table `match_desync`. Read it with your own login:

  ```sh
  npx wrangler d1 execute roaring-lions-telemetry --remote \
    --command "SELECT code, tick, hash_a, hash_b, frame_count, datetime(created_at/1000,'unixepoch') AS at FROM match_desync ORDER BY created_at DESC LIMIT 5"
  ```

  The same query is `-- N1b: desyncs` in `packages/worker/QUERIES.sql`.
  For the full evidence, select `config` and `frames` for your `code`.
- **Pass:** a row for your room code; `hash_a` is not `hash_b`; `tick` is the
  first hash tick after the console line (a multiple of 20, within about 20 ticks
  of when you ran it); `config` names the map and both callsigns; `frames` holds
  the orders both seats sent, `frame_count` the frames minted.

Nothing replays a stored desync yet (spec table row 9, gap 8). The row is
evidence, not a bisector.

### Record on GH-191

Per match: map, length, how it ended, every "Waiting for" line and how long it
lasted, the rejoin time. Both `__lions.net()` outputs. For the desync: room code,
tick, `hash_a`, `hash_b`, whether the line and the Report appeared, and one line
saying the console trick was the method.

---

## N3. Five KDF v Sarim matches (the start purses)

**Proves:** the asymmetric matchup is fair and fun with the purses as set, or
says which way to move them. The purses are provisional until you have played:
`logistics_start` in `data/doctrines/kdf.json` (1500) and
`data/doctrines/sarim.json` (2400), both `"status": "provisional"`.
**Time:** about 1.5 hours (five matches of 10 to 20 minutes).

### Setup

Two browsers, two devices. KDF v Sarim is offered on **Tel Marum** and **Wadi
Tarfan** only ("Camps, income and production on" shows on the card when it is
on). Host picks **Your side** KDF or Sarim before opening the room; the friend
gets the other. Play Tel Marum three times and Wadi Tarfan twice, and swap who
plays Sarim after each match, so each of you plays both sides at least twice.

### Each match

1. Menu, **Play with a friend**, callsign, pick the map and **Your side**, **Open
   a room**. The friend joins, both press **Ready**.
2. Play it as you would a real match: build from the camp, hold the income
   zones, use the Sarim tunnels. Do not play to test; play to win.
3. At the end, note the **Score** table on the end panel (destroyed, lost, force
   left) and run `__lions.net()` in both consoles.

### What to judge

After each match, one line each from both players:

- **Purse:** too small (starved, nothing to build for minutes), about right, or
  too big (queue always full).
- **Who was ahead at five minutes**, and at the end.
- **Did the Sarim tunnels matter**, and did the zones change hands.

### Pass

Five matches played to a result with equal hashes throughout. The gate is
played, not scored: the purses stay unless a pattern shows. A pattern is the
same side winning four of five, or the same complaint on three. If so, name which
purse and which direction on GH-191; changing `logistics_start` is a data PR
that someone else writes and re-probes with `pnpm versus:probe`.

### Record on GH-191

A table: match, map, who held which side, winner, length, purse verdict by each
player, any desync or long stall. Then one sentence: keep the purses (and the
`provisional` marker comes off), or move KDF or Sarim by roughly how much.

---

## N4. An advisor in a match, and a model-vs-model arena

Needs a model key. Keep it in your MCP client's own configuration; never paste
it into a command, a file in the repo or a comment. Everything below follows
[N4-agent.md](N4-agent.md); read its section 1 and 3 once.
**Time:** about 40 minutes for the advisor half; the arena half is the long one
(see the cost note).

### Part A. A match with the `assist` advisor

**Setup:** you and a friend, one match, your machine checked out at the **deployed
commit** (`Build <version>+<commit>` in Settings; the part after `+`).

1. Open a room (menu, **Play with a friend**). In the lobby, under **Invite an
   advisor**, pick **Assist**, press **Get advisor ticket**, **Copy ticket**.
2. Save it privately (`mkdir -p ~/.roaring-lions && chmod 700 ~/.roaring-lions`,
   then `(umask 077; pbpaste > ~/.roaring-lions/advisor-ticket)` and
   `chmod 600` on it). Never paste a ticket into chat or a comment.
3. Run the command the lobby printed (it is `pnpm --silent agent -- --server ...
   --code <CODE> --scope assist --ticket-file ~/.roaring-lions/advisor-ticket`),
   or register it in your MCP client as section 1, step 4 shows (absolute path
   for the ticket file).
4. Friend joins, both **Ready**, play to a result with the advisor beside you.

**What to look at:** the advisor panel under the top strip, its feed lines and
pings (also on the minimap), and for an **Assist** proposal the note, the order
in plain words and a two-second countdown.

**Pass:**
- at least one proposal **accepted** (button, or left to run out), and one
  **vetoed** (X, Veto, or Escape in the advisor box);
- your friend is told you have an advisor (the "Advisor: assist" badge);
- the match finishes normally (a result on the end panel);
- `__lions.net()` shows `desyncTick: null` on both;
- once, close the agent mid-match: your match neither stalls nor ends.

### Part B. The ten-seed arena between two models

Runs entirely on your machine against a local relay; no deploy, no row written,
no ticket secret to handle. Template and rules: N4-agent.md section 3.

```sh
pnpm arena -- \
  --a "cmd:claude -p --model <model-A-id> --mcp-config {mcp} --output-format json --allowedTools mcp__lions__* < {prompt}" \
  --b "cmd:claude -p --model <model-B-id> --mcp-config {mcp} --output-format json --allowedTools mcp__lions__* < {prompt}" \
  --seeds 10 --map tel_marum --pace 60 --round-wall-ms 20000
```

Ten seeds is twenty games (both seat orders).

**Cost note, decide before you start.** A model gets one decision per round, and a
game is up to 200 rounds at the default cap (12,000 ticks, `--pace 60`). Twenty
games is thousands of model calls on your key. Do a **one-seed trial first**
(`--seeds 1`, two games), read the usage line in the results, and scale. If it is
too dear, `--cap-ticks 6000` halves a game and is settled the same way a room
settles its own cap (larger surviving force wins); record that you used it.

**What to look at:** stdout ends with the paths of `arena-results/<date>-<a>-vs-<b>.md`
and `.jsonl`, and the tally. The `.md` has the score overall, per seat and per
faction, `n` (non-void games) and `p`.

**Pass:** the run completes with the arena exit code 0, `n` of at least 16 (voids are
results, but a run mostly voided proves nothing), and no `void/desync`. The gate is
that the machinery works with two models, not that one model wins; `p` is a
number to report, not a bar.

### Record on GH-191

Part A: what the advisor said and proposed, accepts and vetoes, anything
confusing. Part B: the command with the key and model ids left as `<...>`, `n`,
each model's score, `p`, the void count, and the token usage the results report.
Attach nothing that contains a ticket or a key.

---

## When all three are done

On **GH-169** (G5) post one line: network gates N1, N3 and N4 run, with a link to
the GH-191 comment, and close it. The co-op answer is already in the spec: not
applicable for 1v1; if you opened N5 (co-op against a mission), say so there.
