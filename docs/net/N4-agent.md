# N4 · An AI beside you, or against you

`pnpm agent` is a headless client of one versus room that an AI model drives over
MCP (stdio). Two uses, below: an **advisor** that sits beside your seat, and a
**bot** that takes the second seat. The two further sections (the arena and its
results) arrive with N4b.

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
   **Assist** (also proposes orders), then press **Copy ticket**. The ticket
   goes to your clipboard only; it is never shown on the page or put in the
   command.
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
   - Up to three proposals wait; a fourth drops the oldest one still waiting,
     never the one you are reading.

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
