# Versus chat safety: a minimum safe chat (design)

**Status: DESIGN FOR A LEAD DECISION. Docs only; no code, data or schema is changed by this PR.** 16 Nov 2026. Closes the gap found while drafting the GH-1417 age-rating answers: versus has text chat and player-chosen names and **no word filter, mute, block or report** (searched in `packages/net`, `packages/app/src/net`, `packages/worker/src/match`; not an exhaustive proof of absence). The GH-1417 answers are in the legal pack PR (`docs/legal/age-rating-questionnaire-draft.md`, section 7); this design is what would change them.

**Not legal advice.** Where a legal or policy question appears, it is marked for the lead's lawyer.

---

## 1. What exists today (read from the code)

| Fact | Where |
|---|---|
| Chat is **between the two seats of one room**: in the lobby (a docked log) and in the match (Enter opens an input; lines go to the HUD feed). A spectator client has no chat input and hooks no chat line, so it draws none; **but the Worker does relay chat to spectator sockets** (`match-room.ts`'s `send` broadcasts every non-lobby, non-advisor message to the watchers), so a modified spectator client could read it. | `packages/app/src/ui/net-chat.ts` header; `packages/app/src/net/spectator.ts` ("no pause, no surrender and no chat") |
| A line is cleaned by the room (control and bidi characters removed, NFKC, whitespace collapsed, 280 characters), rate-limited to one per seat per 500 ms, and **echoed to both seats**. Nothing is stored; the room keeps only each seat's last-chat time. | `packages/net/src/callsign.ts` `cleanChat`; `packages/worker/src/match/room-core.ts` (`CHAT_MIN_GAP_MS`, `lastChatMs`) |
| Chat is **outside the lockstep**: it travels as its own message (`t: 'chat'`), not in a frame, so it cannot change a match or a hash. | `packages/net/src/protocol.ts` (`ClientMsg`, `ServerMsg`) |
| There are **two places a received line reaches the screen**: the lobby log (`NetChat.receive`, `ui/versus.ts`) and the HUD feed (`chatFeedLine`, `main.ts`). Both escape the text; neither can drop a line. | `ui/versus.ts` (`onChat`), `main.ts` (`room.setHooks({ onChat ... })`), `ui/net-chat.ts` |
| A callsign is player-typed (24 characters, cleaned by the same rules) and shown to the other seat, in the lobby, the HUD and the chat feed. | `packages/net/src/callsign.ts` |
| A room is joined by **a six-character code**; no public listing or matchmaking route was found. A code posted in public still seats a stranger. | `packages/worker/src/match/code.ts`, `routes.ts` |
| A guest's persistent anonymous id is **deliberately hidden from the other seat** (per-match seat tokens), so a friend never learns it. A **member** seat shows `{ name, publicId }` in the lobby. | `packages/worker/src/match/match-room.ts` (`RoomMeta.tokens`); `packages/net/src/protocol.ts` (`SeatMember`) |
| `POST /api/feedback` is a public write endpoint: origin-checked, size-capped, rate-limited by IP, session, player and globally, with a kill switch (`FEEDBACK_CLOSED` or the D1 `flags` row `feedback`), a 180-day purge and no IP stored. Its meta is a strict schema (`category` is one of bug, balance, confusing, idea, praise, rating; `source` one of pause, debrief, menu; `text` up to 2,000 characters) with a Worker twin pinned to it. | `packages/worker/src/feedback-ingest.ts`; `data/schemas/feedback.schema.json`; `packages/worker/src/feedback-meta.ts`; `docs/superpowers/specs/2026-10-08-in-game-feedback-design.md` |
| The privacy page tells players what is stored and what the team can see; chat is not mentioned because nothing of it is stored. | `packages/worker/src/privacy-page.ts` |

Two consequences shape everything below. **First**, a safety control is the receiver's: the Worker relays text and keeps none, so moderation that needs a log has no log to read. **Second**, a guest cannot be recognised across matches by design, so a persistent block or a ban of a guest is impossible without giving up that privacy property; a member can be.

## 2. Principles

1. **The receiver decides what they see.** Mute, block and filter act on the receiving client; the sender is not told.
2. **No chat logs on the server.** The room stays a relay. A line leaves the client only when its reader reports it, and then only as many lines as the report needs.
3. **No network dependency.** The filter is a data file shipped with the game and read locally. A word list that needs a server call breaks offline, in CI and under a blocked network, and sends what players type to a third party.
4. **Presentation only.** Nothing here touches the sim, a command or a frame (invariant 4). The determinism hash cannot see any of it.
5. **A kill switch that needs no deploy**, following the feedback form's pattern.
6. **Every control is reachable by keyboard and named by `t()`**, and none uses a colour literal or a bare string (`validate:ui`).

## 3. The minimum safe chat

### 3.1 One inbox in front of both sinks

All received lines pass through **one function**, `ChatInbox.accept(seat, text) -> { show: string } | { hidden: reason }`, called by both `ui/versus.ts` (the lobby log) and `main.ts` (the HUD feed). A source-guard test pins that `NetChat.receive` and `chatFeedLine` are called from nowhere else, so a third sink cannot bypass it. The inbox applies, in order: **chat off**, **blocked or muted seat**, then the **word filter**.

### 3.2 Mute and block

- **Mute for this match** (default on a one-click row beside every other seat's name in the lobby and the match chat): hides that seat's lines for the rest of the room, session-only, forgotten when the room ends. Works for a guest, because it keys on the seat.
- **Block** (persistent): keys on the **member `publicId`**, so it works only against members. Stored locally (a new key, `lions.chat`, one reader and writer, fenced like the other storage keys); it survives reloads and new rooms. A blocked member's lines are hidden; they are not told. For a guest opponent, the control reads "Mute for this match" and says why (a guest cannot be recognised next time, by design).
- **Chat off** (Settings, Privacy): hides all lines and the input; the room is told nothing. Default **on** in a code room (a friend match), **off by default where a room is public** (section 4).
- Persistence is **local only** in v1. Syncing a block list to an account would store who a player avoids on the server; it is a decision (D5) and the privacy page would need a line.

### 3.3 The local word filter

- **A data file, not code**, in the repository's usual shape: `data/chat/filter.<lang>.json` validated by a schema under `data/schemas/`, registered in `@lions/data`'s index (an unregistered file is silently inert, as the emitters are; an index test pins it to the directory), checked by `validate:data`. One file per language the game ships.
- **Format** (illustrative):
  ```json
  { "version": 1, "lang": "en",
    "hide": ["<term>", "<term>"],
    "mask": ["<term>"],
    "allow": ["<string a hide term sits inside that is not abuse>"] }
  ```
  `hide` terms hide the whole line (a slur); `mask` terms replace only the word with `***`; `allow` is the exception list that answers the "Scunthorpe problem" (a term found inside an innocent word). Each entry is a plain word or phrase, never a regex, so the file is reviewable by a non-programmer.
- **Matching**: lowercase and Unicode-case-fold; NFKC (the room already does it, the client repeats it, because a hand-built client skips the room's cleaning); strip zero-width and combining marks; map the common look-alikes (digits and symbols for letters, Cyrillic and Greek look-alikes); collapse runs of repeated letters; match on word boundaries with Unicode segmentation. Spaced-out letters ("f u c k") are caught by a second pass over the line with spaces removed, guarded by the allow list.
- **Applied to**: incoming lines (so a hand-built client cannot bypass it) **and callsigns** shown to the other seat, **and outgoing text as a nudge** (the input refuses a send that would be hidden and says why), which keeps well-meaning players out of trouble without being the control.
- **The list itself.** It must be authored or taken from a source whose licence permits redistribution, per the repository's rule on assets (`CLAUDE.md`, "What not to do"; `CONTRIBUTING.md`); a list copied from a pack without redistribution rights cannot be committed. Writing and reviewing it is a human task (D3). **Hebrew and Arabic** are the in-world languages of the faction barks (`data/audio.json` `voices`) and slurs there carry the real-world weight the GDD's setting rules are built to avoid (`docs/GDD.md` section 2); a filter for them needs native-speaker authorship, not a translation of the English list.
- **Honest limit.** A word list is a speed bump, not a guarantee: it misses new slang, other scripts, images and context. Its job is to stop casual abuse and to give the report route something to back.

### 3.4 Report

- **Where**: a "Report" action on each received line and in the match pause and end menus. It opens a short form (reason, optional note) and sends `POST /api/feedback`, the existing path, **with its caps, origin check, per-IP/session/player/global limits and kill switch unchanged**.
- **Schema change** (a design, not made here): the strict meta gains `category: "report"` and `source: "match"`, and a `report` object of its own (`{ lines: string[] (at most 10, each at most 280), seat, reported_seat, reported_public_id?: string, room_code?: string, reason: enum }`). `feedback.schema.json` and its Worker twin `feedback-meta.ts` change together; the existing pin test fails if they drift. `text` carries the reporter's optional note.
- **Evidence is what the reporter's client saw.** It is **client-supplied and unverified**: a malicious reporter can forge lines. The triage page labels it so. A stronger v2 (D6): the room holds the last 20 lines **in memory only** (never persisted, gone with the room, which already expires at 6 hours) and attaches them to a report when its seat asks, so the evidence is the room's. That keeps "no chat logs unless reported" true and removes the forgery, at the cost of a new `report` message and a room change. The default is v1.
- **After reporting** the reporter's client hides the reported seat for the rest of the room (an automatic mute), and offers Block when the other seat is a member.
- **Triage** reuses `/stats/feedback`: a `report` row is filtered into its own list, shows the lines and the reasons, and the lead can act. Nothing is actioned automatically.
- **Rate limits**: the existing limits apply; reports add their own per-session limit (for example 5 per 10 minutes) so the endpoint cannot be used to spam the triage list. The numbers are a decision (D7).

### 3.5 Kill switch

`CHAT_CLOSED` (env) or the D1 `flags` row `chat`, read the same way as the feedback switch, plus a "Close chat" button on the stats page. When closed the room drops every chat message (and answers the sender once with a code the client turns into one line), and the client learns it at join through a `chat: false` field on the lobby message and hides the input. It needs no app deploy. A switch for **reports** is the feedback switch itself.

## 4. Friend rooms and public rooms

| | Friend room (a code shared with someone you know) | Public room (a code posted publicly, or a future listed or matched room) |
|---|---|---|
| Chat default | On, filter on | **Off, or quick phrases only** until report triage exists (D1, D10) |
| Mute for the match | Yes | Yes, and offered in the lobby before the first line |
| Block (members) | Yes | Yes |
| Word filter | Yes | Yes, with the `hide` tier on |
| Report | Yes | Yes, with the room's last lines attached when v2 lands |
| Quick chat (preset lines, no free text) | Optional | Recommended: it removes the free-text risk altogether, and its lines are localised like any other text |
| Callsign | Filtered | Filtered, and **a stranger sees only the filtered, cleaned callsign** |

A public room does not exist as a product today; the table is the bar it would have to clear. A friend room is the case in the build now, and "a friend" is a claim the code cannot check: anyone who has the code is seated.

## 5. What the Worker stores (privacy)

- **Chat text: nothing**, as today. The room keeps per-seat last-chat times for rate limiting and, in v2, an in-memory ring of at most 20 lines that is never written to storage and is discarded with the room.
- **A report**: one feedback row (the report object, the note, the build, the session and anonymous player ids the feedback form already records, no IP), kept 180 days by the existing purge, visible to the lead on `/stats/feedback`. It contains the reported lines because the reporter sent them; that is the one place chat text is kept, and only when someone chose to report it.
- **The reported player**: a member's `publicId` if the reporter's client had it; a guest is identified only by the per-match seat label, which links to nothing. **Repeat offenders among guests cannot be recognised**, by the property that protects every guest. This is a stated limit, not a bug; a lawyer should say whether it is acceptable. Action against a member (a suspension) needs a policy and a mechanism the repository does not have (D9).
- **A block list**: on the player's device only (v1).
- **Privacy page and terms**: `privacy-page.ts` gains a "Chat and reports" section (nothing stored unless reported; what a report holds; 180 days; local mute and block lists), and the terms draft (`docs/legal/terms-of-use-draft.md`, clause 7) names the report route. Both are lawyer-reviewed texts.

## 6. Effect on the age-rating answers (GH-1417)

`docs/legal/age-rating-questionnaire-draft.md` section 7 currently reads: chat between players in versus rooms, **no word filter, mute, block or report feature found**, "a gap a rating board and a lawyer will ask about". With this design built:

- "Can players communicate?" stays **Yes** (typed text in versus rooms): a moderation control does not remove the interaction, and a rating form's interactive-element question is answered on whether it exists. I make no claim about how a board treats it.
- "Is chat moderated or filterable?" changes from **no** to **a local word filter, per-match mute, persistent block for members, a report route to the team, and an operator kill switch**; it is **not** pre-moderated and the team reads nothing unless reported. The honest wording matters: a board may treat "unmoderated chat with controls" differently from "no chat", and the wording is the lawyer's.
- Quick-chat-only rooms (D1, D10) change the answer for that mode to **no free-text communication**.
- The "Language" answer in section 4 is unaffected for the game's own text; player chat is the exception it points to.

## 7. Tests and falsification (each check needs an input that makes it fail)

Per `CLAUDE.md`, every check below is met by a constructed failing input, run, before it is trusted, and the commit says so. The planned set:

| Area | Test | Falsification (one-line mutation, run red then restored) |
|---|---|---|
| Inbox | a muted seat's line reaches neither the lobby log DOM nor the HUD feed; a blocked member's line likewise; chat-off hides both | route `main.ts`'s feed around the inbox; drop the mute check; drop the block check |
| One path | source guard: `NetChat.receive` and `chatFeedLine` are called only from the inbox's two callers | add a direct call |
| Filter | a table of constructed inputs: each listed term in plain, uppercase, spaced, look-alike, zero-width-split, repeated-letter and mixed-script forms is hidden or masked; each allow-listed innocent word is not; empty list hides nothing | disable each normalisation step in turn (case fold, look-alike map, zero-width strip, repeat collapse, boundary check): each step has an input only it catches |
| Data | schema and `validate:data` reject a bad file; the index test pins `filter.*.json` to the directory | add an unregistered file; add a regex-looking entry |
| Callsign | a filtered callsign shows the fallback (`Lion`); outgoing text that would be hidden is refused | remove the callsign filter call |
| Report | the strict meta accepts a well-formed `report` and refuses extra keys, more than 10 lines or an over-long line; the schema and its Worker twin stay pinned; origin, cap, rate-limit and kill-switch tests exist for the new category | loosen one cap; drop the origin check on the new category |
| Reporter | a report auto-mutes the reported seat; Block is offered only when the seat is a member | remove the auto-mute |
| Kill switch | `CHAT_CLOSED` and the D1 flag each make the room drop chat and the client hide the input; closing needs no deploy | invert the flag read |
| Privacy | a source guard that no code path writes a chat line to D1 or Durable Object storage outside the report row | add a `put` of a line |
| Determinism | `pnpm test:determinism` unchanged (chat is not in frames) | n/a, and the golden hash must not move |
| i18n | every new control string through `t()`; `validate:ui` clean; the pseudo-locale run shows no unbracketed word | a bare string |

## 8. Work packages, smallest first

1. **S1, the inbox, mute, chat-off** (app only; no Worker, no schema). Closes the "no mute" half of the gap on its own.
2. **S2, the filter** (data file, schema, `@lions/data` registration, `validate:data`, the inbox hook, the callsign hook). Needs the list authored (D3).
3. **S3, report** (feedback schema and Worker twin, the form, triage list, auto-mute). Needs D6 and D7.
4. **S4, kill switch** (Worker flag, lobby field, client).
5. **S5, block** (member `publicId`, the local store). Needs D5.
6. **S6, privacy page and terms text** (lawyer-reviewed).

S1 and S4 are independent and cheap; S2 and S3 carry the work; none touches the sim.

## 9. Decisions

| # | Decision | Recommended default |
|---|---|---|
| D1 | Chat default | **On in a code room with the filter on; off, or quick phrases only, in any public or matched room.** |
| D2 | Filter default | **On for everyone, with a Settings toggle to turn the `mask` tier off but never the `hide` tier.** |
| D3 | Who writes the list, and its licence | **Authored in-house per language, native-speaker reviewed for Hebrew and Arabic; no list copied from a source without redistribution rights.** Ship English first; add a language with its translation. |
| D4 | Languages | The game's shipped UI languages (see the GH-1407 brief), `en` first. |
| D5 | Block persistence | **Local only, members only (by `publicId`); a guest gets per-match mute.** No server-side block list in v1. |
| D6 | Report evidence | **Client-supplied lines in v1**, labelled unverified; room-held in-memory lines as v2 if forgery shows up. |
| D7 | Report limits | The feedback limits plus one per-session report cap (for example 5 per 10 minutes); confirm after reading real triage volume. |
| D8 | Kill-switch mechanism | **D1 `flags` row plus env, like feedback**, with a stats-page button. |
| D9 | Sanctions | **Out of scope.** The lead reads reports; there is no automated action. A member suspension needs a policy and a mechanism, to be designed with the lawyer. |
| D10 | Public rooms | **Do not open public listing or matchmaking until S1 to S4 ship**; until then a posted code is the only public surface. |
| D11 | Spectators | **No chat shown** (as now). **Also stop the Worker relaying chat and quick chat to spectator sockets** (a one-line change in `match-room.ts`'s `send`), so a seat's chat is private to the two seats whatever a client does; a spectator cannot report a chat it does not see. |
| D12 | Quick chat | **Design it with S1** if D1 is accepted, since it is the one control that removes free-text risk in public rooms. |

---

*Written by Claude Code for the lead's decision. Nothing here is implemented.*
