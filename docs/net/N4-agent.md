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

### Play against a bot

Open a versus room in the browser (menu → **Play with a friend**, pick a map,
**Open a room**), then, from a checkout:

```sh
pnpm bot -- --room ABC123 --model sonnet
```

If the host opened the room with a win mode (the "How to win" group, Points race), name it: `pnpm bot -- --room ABC123 --mode=points`.
The standing prompt then says how that mode is won and what to defend, and the harness refuses a room that plays another mode.
Without `--mode` the prompt describes annihilation and the model reads the real `mode` from its first `observe`.

That is the whole of the steps below in one command. It first **joins the room
itself** (the same `POST /api/match/<code>/join` as `--join`), so a wrong or
expired code (404), a taken seat (409) or an ended room (410) is reported before
any model starts and costs no tokens. It then writes the ticket (a 0600 file),
the MCP config and the standing prompt to a private temp directory, runs
`claude -p` with the harness on `--scope command --ticket-file <that file>`,
prints the result and the token use, and removes the directory however it ends (Ctrl-C stops the client cleanly; a second
Ctrl-C exits at once). `--model` is `sonnet`, `opus`, `haiku` or a full model id;
`--server`, `--callsign` and `--client` (the CLI to run, default `claude`) are
optional. Because the client prints one JSON result when it finishes, the live
output is only its stderr; the result and tokens arrive at the end.

Every run leaves two files in `bot-results/` (git-ignored) under the directory
you ran `pnpm bot` from (a run that took a seat also leaves `<date>-<room>-<model>-scores.json`,
the scoring record below), and prints the first two paths when it starts and when it ends:

- `<date>-<room>-<model>.log`: the harness's and the client's stderr and stdout,
  each line timestamped. It never holds the environment or the ticket. The
  harness is the client's child, so `pnpm bot` cannot see its exit code or its
  stderr: it is started with `--log-file <this log>` and appends its own lines
  (marked `har`). That is how a **build refusal** (`build_mismatch`, found only at
  the socket's hello) reaches the bot, which then prints the build message and
  exits 2 even if the client itself exited cleanly. A harness that wrote nothing
  never came up: the bot says "the game connection (harness) stopped" and names
  the log.
- `<date>-<room>-<model>-report.md`: a header (room, model, server, build, result,
  tokens), then the model's final message. The bot's prompt asks the model to keep
  notes of anything odd as it plays and to end with a report under two headings,
  **Conclusion** (what happened, why it won or lost, its key decisions) and
  **Bugs noticed** (refused orders, tool errors, inconsistent `observe` data, or
  `none`). The addendum is the bot's alone; the arena's prompt is unchanged. If the
  client dies before a report, the file says no report was produced and why.

- **A seat must survive a restart of the harness.** Claude CLI starts an MCP server
  to probe it, closes it, and starts it again, so the harness cannot own the
  join (`--join` in the server broke on the second start: HTTP 429, then 409).
  `pnpm bot` joins once and every start of the harness presents the same ticket,
  which the room takes as the same seat coming back. The harness sends `bye` (a
  surrender; in the lobby, a leave) only after the match has started **and** a
  tool has been called; closed before that it just drops its socket. A seat that
  rejoins a lobby where the other seat readied while it was away says ready again,
  so the match still starts.
- **The harness stays up after the match.** On a result (or the room ending) it
  says so once and keeps answering with the final result until its MCP client goes,
  because a server that exits is started again, and a start into an ended room
  replays the match from the room's log. If that happens anyway (a crash), the
  respawned harness lets the replay run to its end before it answers: `wait`
  returns `ended`/`result` at the final tick, and `order` says `match over`, never
  `match not started`.
- **A casualty is not a unit.** `observe` lists wounded men under `casualties`
  (`mine`, and `theirs` in sight), apart from `units` and `contacts`; they take no
  order. An `attack` the sim will not take (the enemy left sight, died, or cannot
  be hurt) shows `dropped` with a `reason` in `orders`, not `applied`.
- **Both players are scored (GH-973, the lead's ruling of 3 Nov).** At the end of
  the match the bot scores **both** players, itself included: 1-10 on five criteria
  (fewer deaths; wounded treatment and evacuation; force preservation; tempo and
  initiative; adaptation), a **one-line reason** for each, and an overall score. It
  does so through two extra harness tools, offered to a `pnpm bot` seat only (the
  harness is started with `--score-file`; the arena's players are scored by a judge
  instead, section 3):
  - `match_stats`: the **referee's end-of-match stats for both seats**, not
    fog-limited: units lost with their value, enemy units destroyed, wounded who
    fell / were rescued / died / are still down, idle time, orders sent and the first
    order and first loss of each seat, and a 30-second timeline. It answers `match
    not over` until the match has a result, so it can never be used to see through
    the fog.
  - `submit_score`: the scores, validated strictly (`match-score.ts`): exactly
    `seat0` and `seat1`, each with the five criteria and an `overall`, every score a
    whole number 1-10, every reason one non-empty line of at most 240 characters. A
    score that fails is refused with **every** problem listed, so the model fixes and
    resubmits; a later valid submission replaces an earlier one.

  Why tools and not a final prompt turn: `claude -p` is one session, so a second turn
  would need `--resume` and a second spend; a tool keeps the scoring inside the one run
  and lets the validator answer the model. The harness is the client's child, so it
  leaves the referee's stats and the accepted scores in `bot-results/<date>-<room>-<model>-scores.json`,
  and `pnpm bot` reads that file back, **validates it again**, puts a `## Scores`
  section (both players' tables, every reason, the referee's numbers; the bot is "you")
  into the report and rewrites the file as the JSON record (`status`: `scored`,
  `invalid` or `missing`, with the problems or the reason). **A missing or invalid
  score is recorded as such, never invented**, and scoring changes nothing else: not
  the result, not the exit code (D7).
- **A bot that is killed still leaves a file.** The report is written as soon as
  the run starts (result `unfinished`: still running, or killed outright) and
  replaced when it ends; SIGINT, SIGTERM and SIGHUP (a closed terminal) all stop
  the client and write the log and the real report.
- **The runner must be installed.** If `tools/node_modules/.bin/tsx` is missing the bot says so (run `pnpm install` in this checkout) before it takes a seat.
- **The build must match, and the bot tells you which.** The room refuses a
  different build (`build_mismatch`), and the site redeploys on every merge, so a
  room opened before the latest merge keeps its older build. The game shows only
  `Build <version>` in its footer, never the commit, so you do not look it up: the
  bot's join names its build and the room refuses a mismatch with **its own**
  (before it takes the seat, so a retry still finds it free; a refusal at the
  harness's hello carries the same build). The bot prints, for example:

  ```
  bot: this room runs 0.129.24+abc1234, this checkout is 0.129.25+31c732f; ...
    git -C ~/dev/roaring-lions-bot fetch origin && git -C ~/dev/roaring-lions-bot checkout --detach <sha> && pnpm --dir ~/dev/roaring-lions-bot install
  ```

  (the path is this checkout's), or says to open a new room, which runs the
  current deploy. A refusal that only shows later, in the harness's log, stops the
  model at once (the bot watches the log), so no more tokens are spent.
- **`wait` blocks in a lobby.** Until the match starts, `wait` waits (up to ten
  minutes, then answers `match not started: still waiting for the other player to
  press Ready`), because the human may take a while to press Ready; the bot's
  prompt says to keep calling it.
- **Run it from macOS Terminal, not inside the Claude desktop app.** Inside the
  app the inherited `CLAUDE_CODE_*` / `ANTHROPIC_BASE_URL` environment breaks a
  child CLI (the bot warns when `CLAUDE_CODE_ENTRYPOINT` is set). If it reports an
  authentication failure, run `claude`, type `/login`, and try again.

The manual form, for any other MCP client:

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

### What a model can order (GH-954, D-W8)

A model has the orders a human has in a versus room, bar two. `order` takes a
`verb`; the verbs are `ORDER_VERBS` in `tools/src/net/mcp-tools.ts`, which is
every command kind except those listed in `ORDER_WITHHELD`, each with its reason:

| Verb | Arguments | Where |
|---|---|---|
| `move`, `attackMove`, `halt`, `smoke`, `garrison`, `load`, `unload`, `demolish`, `chargeTunnel`, `attack`, `rescue` | `ids` plus the verb's own (`x`/`y`, `target`, `structure`, `carrier`, `tunnel`) | every versus room |
| `setStance` | `ids`, `stance` = `hold`, `ambush` (optional `radius`, integer tiles 1-10, default 3) or `patrol` (`waypoints`, 2-4 tiles `[x, y]`) | every versus room |
| `build` | `unit` (an id from `economy.menu`), optional `line` (default: the shortest queue) | KDF against Sarim |
| `cancelBuild` | `line`, `index` (-1 is the item in production, 0 upward those waiting) | KDF against Sarim |
| `setRally`, `clearRally` | `line` (and `x`, `y` for `setRally`) | KDF against Sarim |

The four production verbs carry no `ids`: the side is the seat's own, read from
its view, so a model cannot name the other one. **Withheld on purpose:** fire
support (`support`, `callStrike`, `reveal`; LD5, dropped in every versus room),
field works (dropped in versus), and `enterTunnel` and `vent`, because `observe`
shows a seat neither its tunnel routes nor its buried units yet.

**Legality is the room's.** Every order goes through the same `validateCommand`
the room runs; the tools add no legality rule of their own, only argument-shape checks (a stance name, a radius or waypoint count, a line or index in range, a tile on the map) that give a refusal its specific `detail`; `cleanCommand` stays authoritative. A refusal says why:

- `invalid` with a `detail`: the arguments are malformed, or the room has no
  production (`observe` shows no `economy`).
- `refused` with a `detail`, for the four production verbs, when ownership accepts
  the order but the economy runtime's own pre-check (`canBuild`,
  `buildBlockedReason`, `canSetRally`, the dock's line snapshot) would set it aside
  unspent: `not enough logistics (costs 906, you have 594)`, `population cap
  reached (22/40)`, `production queue full (16)`, `no such line`, `that camp has
  fallen`, `the rally point must be an open tile`, `nothing is queued at index 3`.
  This is advisory, as every pre-check here is: the authoritative drop is
  `applyQueued`'s, a frame later. A build is paid when it runs, so two builds sent
  in one round are each checked against the purse as it stands, not as the first
  will leave it; `observe`'s `economy.purse` is what to read before the next.

**`moving` is not progress (GH-1098).** `moving` is the sim's order flag: an
immobilised tank given an `attackMove` reads `moving` and goes nowhere. A unit
that is held back reads `held` in its row (`routed`, `immobilised`, `garrisoned`,
`pinned`, `checkpoint`; absent means nothing holds it), from the sim's public
reads only (`view.ts` `heldReasonOf`). An `applied` move, attackMove or attack in
the order log lists the held units it went to as `holding: [{id, held}]`.

**`observe` shows what these verbs need.** Each own unit has `stance` (`free`,
`ambush` with `radius`, `patrol` with `points`; a held unit reads `free`, since
`hold` is a halt and keeps no state) and the view lists `stances`. In an economy
room it also has `economy`: `purse`, `perMin`, `population` against its cap, each
camp's `lines` (`building`, `progress`, `secondsLeft`, `contested`, `queued`,
`rally`) and the `menu` (`cost`, `population`, `buildSeconds`, and `blocked` with
the reason while a `build` would be refused). All of it is the seat's own side:
nothing of the other side's purse, queue or menu is read. (`contested` is the strip's own flag, not fogged: an enemy ground unit stands at the exit of the seat's own camp, where its own units see.)

**The pin.** `tools/src/net/order-verbs.test.ts` asks `validateCommand` which
command kinds a versus room accepts (a sample of every kind, in a mirror room and
in the economy room from each seat) and fails on one that is neither an
`ORDER_VERB` nor in `ORDER_WITHHELD`; the test's own literal names the two that may
be (`enterTunnel`, `vent`). It replaces the old `toolsFor` pin, which filtered the
kinds out by name and so could not go red when one was missing (spec §11c.8).
It also fails if `arena-prompt.md` does not name every verb.

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
Ctrl-C or SIGTERM: the arena then starts nothing new, stops every command it
started, removes those directories and exits 130 (143 for SIGTERM). A second
Ctrl-C while it does exits at once, leaving that cleanup unfinished; the seat's ticket is only ever in that
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

### A judge for the arena (GH-973)

```sh
pnpm arena -- --a "cmd:<player A>" --b "cmd:<player B>" --seeds 5 \
  --judge "cmd:claude -p --model <model-id> --output-format json < {prompt}"
```

`--judge` is a **third model** that scores both players of each finished game on
the same rubric the bot uses (five criteria, 1-10, a one-line reason each, an
overall). Its value is a `cmd:` template in the players' own form: split by the
arena, never through a shell, run with your environment unchanged. **The arena
never reads a key and none belongs in a template** (it is written into the
results). Placeholders: `{prompt}` (the judge's prompt: the rubric, what the stats
mean, the **referee's stats for both seats** and the event timeline, and the exact
reply format; use `< {prompt}` for stdin) and `{stats}` (the stats alone, as a JSON
file). There is no MCP config: the judge plays nothing. It runs in a temp directory
of its own (0700, files 0600, removed when it ends and on a signal), so use absolute
paths; its stdout and stderr go to `<out>/<date>-<a>-vs-<b>-game<n>-judge.log`.
`--judge-timeout-ms` (default 180,000) bounds each call.

- **The referee's stats are in every record** (`referee` in the `.jsonl`), judged or
  not: per seat, units lost and destroyed with their value, the force left, wounded
  who fell / were rescued / died / are still down, `deaths` (units lost + wounded who
  died), the idle share of unit-seconds, orders sent (by verb), the tick of the first
  order and of the first loss, and a timeline every 30 game seconds. They are read from
  the reading seat's sim, after the verdict, and write nothing.
- **The reply is parsed strictly**: one JSON object (or one fenced block), exactly
  `seat0` and `seat1`, every criterion present, every score a whole number 1-10, every
  reason one line. Anything else is recorded as `invalid` with the problems; a judge
  that fails to start, exits non-zero, times out or reports an error is `failed`; a
  void game is `skipped`. The `.md` has a **Scores** section with one row per judged
  player, each player's mean per criterion, and each game's reasons beside its
  referee numbers. **Without `--judge` that section says "Not judged".**
- **Scores never change a result (D7).** The judge runs after the game's relay is
  closed; its outcome goes only into the record's `judge` field. No outcome, tally,
  gate or exit code reads it.

## 4. What the harness trusts

- **The `Origin` header** (decision D9): the harness sends the server's own
  origin, because the room requires one; it is a browser's cross-site guard,
  not authentication, and the seat ticket is what admits you.
- **Fog is a courtesy** (decision D10): the harness shows the model only what
  its side sees, but every socket receives the full frame stream, so a modified
  harness could see through fog exactly as a modified browser could; versus is
  for friends (decision 22).
