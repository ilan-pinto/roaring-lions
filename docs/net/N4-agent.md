# N4 · An AI beside you, or against you

`pnpm agent` is a headless client of one versus room that an AI model drives over
MCP (stdio). Two uses, below: an **advisor** that sits beside your seat, and a
**bot** that takes the second seat. `pnpm arena` (section 3) plays two players
against each other on your own machine and scores them; section 4 says what
the harness trusts and what it does not.

Every example uses `https://<your-worker>` for the deployed game and `ABC123` for
the room code. Put your own in; never paste a real ticket anywhere that is
logged, committed or shared.

## 1. An advisor with a friend

An advisor sees what your side sees (never through the fog), talks to you in a
small feed, pings the map, and, in **Assist** mode, proposes orders. A proposal
shows on your screen for two seconds and becomes **your own order** unless you
veto it; the other seat is told you have an advisor.

1. Open a versus room as usual (menu → **Play with a friend**). In the lobby,
   under **Invite an advisor**, pick **Advise** (talk and ping only) or
   **Assist** (also proposes orders), press **Get advisor ticket**, then
   **Copy ticket**. The ticket goes to your clipboard only; it is never shown
   on the page or put in the command the lobby prints.
2. Save the ticket into a private file outside the repo, readable by you alone:

   ```sh
   mkdir -p ~/.roaring-lions && chmod 700 ~/.roaring-lions
   (umask 077; pbpaste > ~/.roaring-lions/advisor-ticket)    # macOS; or paste into your editor
   chmod 600 ~/.roaring-lions/advisor-ticket
   ```

3. Check out the **commit the deployed build was made from**: the foot of the
   Settings and Credits screens (and the pause menu) reads `Build
   <version>+<commit>`, and the part after `+` is the commit. Then run the
   command the lobby printed:

   ```sh
   pnpm --silent agent -- --server https://<your-worker> --code ABC123 \
     --scope assist --ticket-file ~/.roaring-lions/advisor-ticket
   ```

   `--silent` matters: stdout is the MCP channel, and a package manager's banner
   on it corrupts the session. Every log line the agent writes goes to stderr.
4. To drive it from an MCP client (any that speaks stdio), register it as a
   server. Use an **absolute** path for the ticket file: an MCP client does not
   expand `~`.

   ```json
   {
     "mcpServers": {
       "roaring-lions-advisor": {
         "command": "pnpm",
         "args": [
           "--silent", "agent", "--",
           "--server", "https://<your-worker>",
           "--code", "ABC123",
           "--scope", "assist",
           "--ticket-file", "/absolute/path/to/advisor-ticket"
         ],
         "cwd": "/absolute/path/to/your/roaring-lions/checkout"
       }
     }
   }
   ```

   `--ticket-file -` reads the ticket from the first line of the agent's stdin,
   which only works when **you** pipe it yourself in a terminal. Under an MCP
   client stdin is the protocol stream, so use a file there.
5. In the match the advisor's panel sits under the top strip. Its lines and
   pings appear in the feed (a ping also flashes on the minimap and marks the
   ground); type in its box to answer, and Enter sends. For an **Assist**
   proposal the strip shows the note, the order in plain words ("Move 3 units
   to (24, 31)") and a countdown:
   - **X**, the **Veto** button, or **Escape** while typing in the advisor's
     box vetoes it. The **Accept** button takes it at once; **Enter** does not (it opens the chat,
     so reaching for chat never accepts by accident).
   - Left alone, it is taken after two seconds of play, **if it still makes
     sense**: an order naming a unit that has since died is dropped, and the
     feed says so. The two seconds count only frames that run, so a pause or a
     background tab holds the countdown where it was, and you always get a
     moment to veto after coming back. Accepting while the room is paused is
     refused the same way, since a paused room takes no orders.
   - Up to three proposals are held (the one you are reading and two waiting);
     a fourth drops the oldest one still waiting, never the one you are reading.

   X only vetoes while a proposal shows; with none it does nothing. Enter always
   opens the chat, proposal or not.

If the room refuses the agent with `build_mismatch`, the agent is on a different
commit from the deployed game (the room never plays two builds against each
other): check out the deployed commit and run it again. A bad ticket exits with
code 2 and a one-line reason.

An advisor never orders anything by itself, cannot pause, surrender or ready up,
and its disconnecting never stalls or ends your match.

## 2. A bot opponent

Create a versus room in the browser (menu → **Play with a friend**, pick a map,
**Open a room**), then, instead of sending the code to a friend, seat a bot:

```sh
pnpm --silent agent -- --server https://<your-worker> --code ABC123 \
  --scope command --join
```

The bot takes seat 1 and plays it through the same orders a human sends; there
is no ticket to save (`--join` asks the room for the free seat). Its orders are
coalesced to **at most one flush a second** (up to four commands), which keeps a
bot exactly as cheap for the room as a human clicking once a second (decision
D4); an order beyond the queue's twelve is answered `queue_full` and the model
should wait.

Closing the agent, or the MCP client that owns it, mid-match sends `bye`, which
the room reads as a **surrender**: you win. To walk away from a bot without
that, use the game's own surrender or leave instead.

## 3. The arena

`pnpm arena` plays one player against another over a set of seeds and scores
them. It runs **entirely on your machine**: each game gets its own local relay,
the real Worker routes and the real `MatchRoom` on `127.0.0.1` with an
OS-assigned port. It writes no rows, needs no secret (the relay mints a fresh
ticket secret in memory and never logs or stores it) and uses no network beyond
loopback. Run it from a checkout; nothing is deployed and nothing remote is
touched.

```sh
pnpm arena -- --a rush --b passive --seeds 10 --map tel_marum --pace 60
```

- **Players.** `passive` (never orders anything) and `rush` (attack-moves its
  idle units at home on the enemy it can see, else on the enemy camp, and never
  breaks off a fight it is in) are the two scripted, fog-respecting controls
  (decision D8). They are controls, not a strong AI. Anything else is
  `cmd:<template>`, below.
- **Games.** Seed *n* is `1000 + 7919 n`, and every seed is played twice with
  the seats swapped, so `--seeds 10` is twenty games. The room is **paced**:
  every `--pace` ticks (default 60, three seconds of game) it waits for each bot
  seat to end its round, for at most `--round-wall-ms` (default 120,000). A
  model therefore gets the same number of decisions whatever its latency. A
  model that never calls `end_round` costs the whole `--round-wall-ms` every
  round, so lower it for model runs (for example `--round-wall-ms 20000`).
- **Where a game ends.** Annihilation, stalemate, or the arena's cap
  (`--cap-ticks`, default 12,000 ticks, ten minutes of game), where the game is
  settled the way the room settles its own 25-minute cap: the larger surviving
  force value wins, equal values draw.
- **Maps.** Only what a room would host: `--map` must be a versus map and
  `--matchup` (default `mirror`; `kdf` and `sarim` where offered) a pairing that
  map offers. A matchup name that does not exist is a command-line error (exit
  1); a real matchup or map that no room offers exits 2. Either is refused
  before a relay starts.
- **Score.** `(wins + ½ draws) / non-void games`, reported overall, per seat and
  per faction (decision D7), with the scoreboard (units lost and destroyed, with
  their value, and the force left) in place of Conduct, which a versus room does
  not have. A game is **void** when the room reports a desync (`void/desync`),
  when the two sims it was judged by disagree about the result
  (`void/disagree`), when the room ended without a result, or when a game ran
  past its wall-time backstop (`void/timeout`). A void is a result of the arena,
  not a failure: the exit code is 0 unless a game could not be played at all.
- **A against B.** stdout and the report also read `--a` against `--b`
  directly: `n` (the non-void games between them), A's score, and `p`, the
  one-sided exact binomial chance that a player no better than its opponent
  scores this well: P(X ≥ wins + ½ draws) for X ~ Bin(n, ½). A half point (a
  draw) takes the mean of the two whole-point readings either side of it.
- **`--gate`** judges the run (ruled 15 Oct, coordinator, lead-delegated): it
  passes iff A beats B with **p < 0.05**, and prints one line,
  `gate: PASS|FAIL  <A> over <B>  n=<n>  score=<s>  p=<p>`. The N4 gate is
  ```sh
  pnpm arena -- --a rush --b passive --seeds 20 --map tel_marum --pace 60 --tick-ms 2 --gate
  ```
  forty games, both seat orders; with the players swapped (`--a passive --b
  rush`) it must FAIL. There is no fitted bar: twenty seeds is enough for
  15 of 20 to read p ≈ 0.02, while two games can never pass (p ≥ 0.25).
- **Exit codes.** 0 every game played (voids included); 1 a bad command line,
  a player that cannot be built, or a game that could not be played; 2 a map
  or matchup no room offers; **3, only with `--gate`, every game played and the
  gate FAILED**. A run that ends 1 prints `gate: not judged` and stays 1.
  Without `--gate` the codes are exactly 0, 1 and 2.
- **Results** go to `arena-results/` in the directory you ran pnpm from (or
  `--out <dir>`): `<date>-<a>-vs-<b>.jsonl`, one record per game appended as it
  ends, and `.md`, the tables. An existing pair is never overwritten; the new
  one gets `-2`, `-3`. stdout carries the two paths and the tally; every log
  line goes to stderr.

### A model as a player

```sh
pnpm arena -- --a "cmd:<your MCP client command with {mcp} and < {prompt}>" --b rush \
  --seeds 10 --map tel_marum --pace 60
```

For each game the arena starts that command once per external seat, with:

- `{mcp}`: the path of an MCP config that starts this checkout's harness in
  `command` scope on the arena's room (the server is named `lions`);
- `{prompt}`: the path of the standing prompt (the game in ten lines, the
  tools, the loop, the fog rule, the order cadence), with the seat filled in;
- `{seat}` and `{code}`: the seat (0 or 1) and the room code;
- `< {prompt}` as its own token: the prompt file becomes the command's stdin.

Any other `{name}` is refused. The template is split into arguments by the
arena itself and **never passed through a shell**: quotes group words, but
`$VAR`, `$(...)`, backquotes, `;`, `|`, `>` and globs reach the command as
literal text. The command starts in the directory you ran pnpm from.

The three files live in a fresh temporary directory (mode 0700, files 0600)
that is removed when the command exits, and also if you stop the arena with
Ctrl-C or SIGTERM: the arena then stops every command it started, removes those
directories and exits 130 (143 for SIGTERM); the seat's ticket is only ever in that
directory's `ticket` file, never in an argument, the environment or a log. The
command's stdout and stderr go to `<out>/<date>-<a>-vs-<b>-game<n>-seat<s>.log`.

**The arena passes your environment through unchanged and never reads a
key.** Whatever authentication your MCP client uses stays yours: keep it in your
client's own configuration or environment, never in the template, which is
recorded in the results. Its token use
is reported when the command's last stdout line is JSON with
`usage.input_tokens` and `usage.output_tokens`; it is never scored.

With Claude Code, for example:

```sh
pnpm arena -- --a "cmd:claude -p --model <model-id> --mcp-config {mcp} --output-format json --allowedTools mcp__lions__* < {prompt}" \
  --b rush --seeds 10 --map tel_marum --pace 60
```

Two things to know about external players:

- **When neither seat is in this process** (`cmd:` against `cmd:`), the arena
  watches the game through an **observer**: seat 0's own advisor, in `advise`
  scope, which keeps its own sim in step from the frames and sends nothing that
  touches the match. A game with any external seat is judged by one sim (the
  in-process seat's, or the observer's), so it cannot read `void/disagree`; a desync between the two players is still caught by the
  room's own hash check, which voids the game.
- **At the end of any game** (the cap, a result, the room ending) the
  in-process side stops at once, but an external command that is still alive
  gets a grace period (10 s) to finish by itself and print its usage line
  before it is stopped (then terminated, then killed). The model plays and
  spends tokens during that grace.

## 4. What the harness trusts

- **The `Origin` header** (decision D9): the harness sends the server's own
  origin, because the room requires one; it is a browser's cross-site guard,
  not authentication, and the seat ticket is what admits you.
- **Fog is a courtesy** (decision D10): the harness shows the model only what
  its side sees, but every socket receives the full frame stream, so a modified
  harness could see through fog exactly as a modified browser could; versus is
  for friends (decision 22).
