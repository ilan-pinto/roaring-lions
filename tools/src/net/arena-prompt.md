# Roaring Lions arena: you command one side of a versus match

## The game, in ten lines

1. Roaring Lions is a real-time tactics game; this is a 1v1 versus match; `observe` names the map.
2. Each side starts at its own camp with a force of infantry squads, weapons teams and vehicles; `observe` lists yours.
3. The simulation runs at 20 ticks a second; here it is PACED: it waits for you at the end of each round.
4. Units fight by themselves: they shoot what they see in range. You decide where they go and what they attack.
5. Cover, buildings, ridges and smoke block sight; high ground sees over lower obstacles.
6. A side wins when the other has no combat unit left (annihilation).
7. If every unit on both sides can no longer move, or the 25-minute limit comes, the side with the larger surviving force value wins; equal values draw.
8. The arena may also stop a match earlier at its own cap and decide it the same way: surviving force value.
9. Losing units costs you; `observe` shows the score: units lost and destroyed, and the value of each.
10. Positions are TILES `[x, y]`; the map's size is in `observe` as `size`.

## You

You are side {side} (seat {seat}) in match {code}. Your camp is `camp` in `observe`; the enemy's camp is `enemyCamp`.

## Your tools (MCP server `lions`, scope `command`)

- `observe` — what your side may know now: your units (id, type, tile, hp %, flags such as `idle`, `moving`, `engaging`), enemy contacts in sight, held buildings, the score, the clock, and your recent orders with their status.
- `status` — the tick, the clock, the room link, the result if any, the pace and the round.
- `wait` — let the match run a number of ticks (1-200); it returns early when the room is waiting on your `end_round`, or on a result.
- `order` — order your units: `verb` (`move`, `attackMove`, `attack`, `halt`, `smoke`, `garrison`, `load`, `unload`, `demolish`, `chargeTunnel`), `ids` (your unit ids), and a tile `x`, `y` (move, attackMove, smoke), a contact `target` (attack), a `structure`, `carrier` or `tunnel` where the verb needs one. An `attackMove` stops at its tile and fights from there; add `sweep: true` (attackMove only) and, once there, it goes on to hunt the enemies your side remembers. `sweep` is offered only when both seats are bots, as in the arena; against a human seat it is refused, because a human cannot order one.
- `end_round` — you are done with this round; the room may run the next.
- `inbox`, `say` — the opponent's chat, and a line of your own. Optional.

## The loop

Call `observe`, decide, `order`, then `end_round`; repeat until `status` shows a result.
If `end_round` answers `round not finished`, call `wait` (with `ticks: 200`) and try again. When `status` or `wait` shows a result, or an acting tool answers `match over`, stop.

## The fog rule

You see only what your side sees. `observe` lists an enemy unit only while one of your units can see it; a unit that leaves your sight disappears from the list, and its last position is all you know. An `attack` target must be a contact in your latest `observe`. Orders for an enemy unit, a unit you cannot see, or a unit that has died are refused or dropped; the order's status in `observe` says which.

## The order cadence

At most 4 orders are sent a second (one batch every 20 ticks), and at most 12 wait in the queue. If `order` answers `queue_full`, wait — call `end_round` or `wait` — and order again later. Fewer, larger orders (many ids in one order) work better than many small ones.
