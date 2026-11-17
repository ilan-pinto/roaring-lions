# Roaring Lions: Roadmap (DRAFT, HOLD FOR LEAD)

> **Status: draft for the lead. Not published, not linked from the game or the site.**
> Nothing here is posted until the lead publishes it. Three things need the lead's eye before it goes out:
> the grouping of work under the two dated milestones (see "Notes for the lead" at the end), the wording in
> "What we are not planning", and the choice of community channel.

Roaring Lions is a real-time strategy game about the Kedem Defence Force (KDF) and the Sarim militias,
inspired by modern Middle East conflicts. This page says what we are working on and what we are not. We
promise only what is written here, and only the two dates given.

## The two dates

| Milestone | What it is | Target date |
|---|---|---|
| **Skirmish** | Play a full match against the computer | **12 February 2027** |
| **Play with a friend** | Matches against a friend online, and with a friend against the computer | **16 April 2027** |

No other item on this page has a date. "Later" means after those two, in the order listed, not on a
schedule. If a date moves, this page changes first.

## Toward Skirmish (12 February 2027)

Play a match against the computer without needing a friend.

- **A computer opponent in the versus lobby.** Start a versus match offline against a computer seat, from
  the lobby or from free play, with no hidden switch. It is labelled plainly as a basic opponent.
- **Three difficulty levels for the computer.** Each level is shown to you as what it is (for example, a
  handicap on starting money or force size). The computer never gets extra sight.
- **The computer can play either side** (KDF or Sarim) on every open versus map and in every win mode.
- **Sarim on every versus map and in free play.** Today some maps and win modes are KDF-versus-Sarim only
  in a limited form. The goal is to open them all. One part of this (the points and flag modes for a
  KDF-versus-Sarim match) depends on a fairness check and may stay closed if it fails.

## Toward Play with a friend (16 April 2027)

- **Co-op against the computer.** Two players share a room against one or two computer commanders. It is
  offered in the lobby with no switch, and reconnecting after a drop works as it does in a one-on-one
  match.
- **Rooms stay connected through game updates.** A game update will not drop a match in progress.

## Later, in this order, with no dates

### Campaign: missions that make you spend and choose

- **Income and production on at least half the missions.** Holding ground earns money and builds units on
  at least 15 of the 30 missions. The work is under way; the count is rising batch by batch.
- **Objectives where saving everything stops working.** On the economy missions, hoarding money and doing
  nothing should lose, and calling in fire support should be worth the cost.
- **A few missions where the enemy has a camp of its own** and builds against you. Only in missions that
  declare it.
- **Beit Sahwan II asks something of you.** A player who gives no orders will lose it instead of winning by
  waiting. This is a content change to the mission's objective and waves.
- **A second campaign arc of about ten missions** in two or three towns, aiming for six hours or more of
  campaign in total.
- **Three campaign difficulty settings**, chosen per campaign and changeable between missions.
- **Replay value.** Optional modifiers on won missions and a third star for a named challenge.
- **Either/or upgrade branches** on at least ten unit types, with the Garage showing what you give up.
- **Save and resume in the middle of a mission.**
- **Why did that unit die?** A one-line cause (weapon, which side was hit, whether it penetrated, whether it
  was pinned) on the unit card and in the debrief.
- **A better first hour.** We are fixing what stalls first-time players in the tutorial, from watching new
  testers.

### Factions and the computer commander

- **Sarim grows to 15 playable unit types** with their own production menu, including an armoured vehicle
  that KDF weapons must actually penetrate.
- **Doctrines.** Three per side; you pick one before a match. Each changes your unit menu, your cap and one
  signature call.
- **A smarter commander.** It scouts before committing, changes its build to answer what it sees, defends its
  camp and income, and pulls back from a losing fight.

### Online

- **A ranked one-on-one queue** with a rating and a penalty for leaving, once results can be trusted from the
  server. Ranked will be described in the game only once it is open.

### Language, sound and look

- **Launch languages:** English plus Simplified Chinese, Russian, German, French and Spanish (Spain).
  Brazilian Portuguese follows right after launch. Unit names and mission text are being moved into the
  language files first.
- **Spoken briefings and radio lines** with captions.
- **Ambience.** The ambience beds have been off since 9 October. They return only after a redesign and a
  mix pass, and only if the lead approves them by ear.
- **Dusk that reads as clearly as day.**
- **Ground beyond the edge of every map**, instead of an abrupt edge.
- **One art style for props and terrain dressing.**
- **Finished features that are switched off today** get a decision each: switched on, or removed.

### Getting the game to more players

- **Performance.** A tested minimum spec, a notice if your browser is drawing in software, and a suggestion
  (never an automatic change) to lower the quality preset if frames run slow. We will not claim "300 units
  at 60 fps" anywhere until measured figures support it.
- **A free demo on Steam**, a trailer and store screenshots.
- **Cosmetics that buy no power.** A first shelf of things such as emblems, colour sets and banners. Nothing
  you can buy changes how a unit fights.
- **Crash reporting**, with an opt-out, and clearer terms and privacy pages.

## What we are not planning

- **No selling of power.** At launch, paid coins buy cosmetics only. The lane that would sell units or
  upgrade tiers stays closed. Units and tiers are earned with in-game credits, and the intended pace is about
  twelve full campaigns to own everything.
- **No third playable side for now.** There are two: KDF and Sarim.
- **No playable opposition sides in the campaign.** Sarim and any other opposing side are playable in
  versus, skirmish and free play only.
- **No combat rebalancing before late spring 2027.** Core combat balance is deliberately paused until its
  scheduled window; until then we add content and fix what is broken, but do not retune how units fight.
  (New units that already fit the current cost band, and mission objectives, can still be added.)
- **No named real-world war, people, place, operation or faith.** The game is set in an invented region.

## Community channels

*For the lead to choose. No channel is open, and nothing is promised to players yet. The decision to open
one, and which, is the lead's.*

**Source status.** The web pages cited below could not be opened from the drafting session (the sandbox
blocks those hosts). The platform facts below are therefore the drafter's recollection of each vendor's
public terms, marked **[verify]**. The lead, or a later session with network access, should open each URL
and confirm before this section is published or acted on. The repository facts (no code of conduct, no
report feature, the draft sign-in age) were read from the repository.

### Summary

| | Discord | Steam community forum (Steam Community hub) | GitHub Discussions |
|---|---|---|---|
| Cost | Free to host a server **[verify]** | Free; the hub comes with a Steam app page **[verify]** | Free on public repositories **[verify]** |
| Exists today | No | No: needs the store page (GH-203) and a Steam app first | No (a repository setting to switch on); the repository is already public |
| Who needs an account | A Discord account | A Steam account | A GitHub account |
| Moderation tooling | Roles, AutoMod, audit log, verification levels **[verify]** | Developer and community moderators, flag and delete tools **[verify]** | Maintainer moderation: lock, delete, block, report **[verify]** |
| Real-time chat | Yes | No (threaded forum) | No (threaded) |
| Fit with players | Largest gaming chat audience | Players who already own or wishlist the game | Developers, bug reporters and contributors |

### Discord

- **Cost.** Free to create and run a server. Paid Nitro and server boosts are optional extras and are not
  needed. **[verify]**
- **Moderation.** Someone has to be present. It needs at least one trusted moderator plus the lead as
  backstop, written rules, a rules channel, a report path, and a place for patch notes (an announcement
  channel). Tooling: roles and permissions, AutoMod keyword and spam rules, timeouts and bans, an audit log,
  and a server verification level. **[verify]** Discord's Community features have setup requirements such as
  a verification level and a content filter. **[verify]** The time a real-time server needs is not published
  by Discord; the hours a week depends on server size and is **not stated here because no source supports a
  number**. The lead should decide how many hours someone is willing to be present, since real-time chat
  invites real-time problems.
- **Code of conduct.** The repository has none today. A written code of conduct would be needed before
  opening, and Discord's own Community Guidelines would apply on top.
- **Privacy and age.** Discord's terms set a minimum age of 13 in most places and higher in some countries
  **[verify]**. The draft terms for this game set 16 as the age to sign in, so a Discord server could admit
  players the game's own sign-in does not. Players' Discord identities and messages are held by Discord, not
  by us; a server with minors needs an explicit policy on direct messages. Our privacy contact should be a
  private address, not a public repository issue (the repository's own privacy-contact proposal says so).
- **Fit for a small team.** Strongest for live play, quick answers and a feeling of presence. Highest
  ongoing cost in attention, and the only option here with real-time moderation duty.

### Steam community forum

- **Cost.** Free; every Steam app has a community hub with discussions, announcements, reviews and
  screenshots. **[verify]** It exists only after the app and store page exist, so it cannot open before the
  store page (GH-203) does.
- **Moderation.** The developer can moderate their own hub (delete, lock, ban from the hub), and can appoint
  community moderators. Steam's content rules apply on top. **[verify]** The team still reads and answers it,
  but a forum is asynchronous, so there is no live chat to cover. As with Discord, no vendor publishes a
  weekly hours figure; none is claimed here.
- **Code of conduct.** None in the repository. Steam's own rules apply, and the team could pin short
  community rules as a post.
- **Privacy and age.** Players post under their Steam persona, which is Steam's data. Steam accounts have
  their own age rules (13 or older in most places **[verify]**). This is the audience closest to the people
  who wishlist and buy the game. Steam also provides announcements, which can carry patch notes.
- **Fit for a small team.** Good for patch notes and support once on Steam, with the lowest moderation load of
  the chat-style options. Cannot start early.

### GitHub Discussions

- **Cost.** Free on public repositories; a repository setting turns it on. **[verify]** The repository is
  already public (the audit that started this work found no external issue authors yet).
- **Moderation.** Maintainers moderate: categories, announcements, locking, deleting, blocking users and
  reporting abuse to GitHub. **[verify]** It is threaded and asynchronous. The repository already has
  contributor documents and a contributor licence agreement, but no code of conduct, and one would need to
  be added to give moderation something to point at.
- **Privacy and age.** Posts are public and indexed, tied to a GitHub account. GitHub's terms set a minimum
  age (13 in most places **[verify]**). Players of this game sign in with Google or Steam, not GitHub, so
  most players do not already have an account there. Reports about personal data must not go here, for the
  same reason the privacy-contact proposal gives for issues.
- **Fit for a small team.** Lowest overhead, same place as the code and the issues, good for patch notes,
  bug reports and a public roadmap thread. Smallest gaming audience.

### Common to all three

- All are free at the scale of a small project **[verify]**.
- None can serve as the private support or privacy contact. That should be a private address either way.
- The game has no in-game report, mute or block feature for chat (read from the draft terms), so a community
  space will see problems the game cannot yet help with.
- The channels are not exclusive. The facts above support choosing one, or combining a threaded one for patch
  notes and support with a live one for chat. This page does not choose.

### Sources (open and confirm before relying on them)

- Discord Terms of Service: https://discord.com/terms
- Discord, enabling a Community server: https://support.discord.com/hc/en-us/articles/360047132851-Enabling-Your-Community-Server
- Discord AutoMod FAQ: https://support.discord.com/hc/en-us/articles/4421269296535-AutoMod-FAQ
- Discord Community Guidelines: https://discord.com/guidelines
- Steamworks, community documentation: https://partner.steamgames.com/doc/community
- Steam Subscriber Agreement: https://store.steampowered.com/subscriber_agreement/
- GitHub Docs, about Discussions: https://docs.github.com/en/discussions/collaborating-with-your-community-using-discussions/about-discussions
- GitHub Docs, moderating Discussions: https://docs.github.com/en/discussions/managing-discussions-for-your-community/moderating-discussions
- GitHub Terms of Service: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
- Repository facts: `docs/legal/privacy-contact-proposal.md`, `docs/legal/terms-of-use-draft.md`, `CONTRIBUTING.md`

---

## Appendix for maintainers (remove before publishing)

### Basis

Built only from the lead's rulings of 16 Nov 2026 on GH-1378 (all twelve) and from the open issues of the
"80 programme". Issue GH-1420 sets the constraint: the roadmap promises only what a ticket covers. There is
no GitHub label `roadmap-80` (the label list has none); the programme issues were found by the sentence
"reach 80 on all twelve audit dimensions" in their bodies. They carry a phase (P1 to P6) in their body, not a
GitHub milestone.

### Dates

- M3 (milestone "EP M3 · Skirmish") 12 Feb 2027 and M4 ("EP M4 · Play with a friend") 16 Apr 2027: GH-1378
  ruling 1, and the GitHub milestone due dates agree.
- Not dated on purpose: M5 (Steam free-to-play) is a placeholder date of 25 Jun 2027 per its milestone text;
  GH-1378 ruling 2 puts sim balance in "phase 5, 10 May to 20 Jun 2027", rendered here as "late spring 2027"
  without a day. The lead may prefer the dates stated or removed.

### Ruling to page-text map (GH-1378)

| Ruling | Used for |
|---|---|
| 1 | The two dates |
| 2 | "No combat rebalancing before late spring 2027" |
| 3 | The note under that bullet (objective design and a unit that fits the cost band may proceed) |
| 4 | "Income and production on at least half the missions" |
| 5 | "A few missions where the enemy has a camp" |
| 6 | "No selling of power"; about twelve campaigns |
| 7 | Launch languages (the gate A14 wishlist figure is internal and left off the page) |
| 8 | The premise line and the no-real-names rule; no store copy is written here |
| 9 | Ambience beds |
| 10 | "No third playable side", "No playable opposition sides in the campaign" |
| 11 | Informs GH-1381 only (report-only probe for new maps and sides); not stated to players |
| 12 | "Beit Sahwan II asks something of you" |

### Issues used (open on 17 Nov 2026)

- **Toward Skirmish:** GH-1388, GH-1389, GH-1390, GH-1381
- **Toward Play with a friend:** GH-1392, GH-1397
- **Campaign:** GH-1386, GH-1387, GH-1396, GH-1394, GH-1395, GH-1384, GH-1393, GH-1380, GH-1408; ruling 12 work
  (Beit Sahwan II, change in review on GH-1378)
- **Factions and commander:** GH-1382, GH-1383, GH-1391
- **Online:** GH-1399
- **Language, sound, look:** GH-1406, GH-1407, GH-1404, GH-1405, GH-1403, GH-1402, GH-1401, GH-1400
- **Getting the game out:** GH-1411, GH-1412, GH-1413, GH-1418, GH-1419, GH-1416, GH-1414, GH-1410, GH-1417,
  GH-1415
- **Left off the page as internal:** GH-1378 (rulings), GH-1379 (lead paperwork), GH-1385 (checks that cannot
  fail), GH-1409 (CI), GH-1422 (Meshy identifier), GH-1420 (this page)

### Judgement calls to confirm

1. Which issues sit under the two dated milestones is the drafter's reading of each issue's text (for
   example GH-1388 names the skirmish half of a gate). The issues do not name M3 or M4. Moving an item under
   a date is a promise, so the lead should confirm each, or collapse both sections into the undated list.
2. Ranked play (GH-1399) is phase 6 and listed as later, undated.
3. Voiced briefings (GH-1404) is a large item with no ruling; kept, undated.
4. Whether to name the languages and Steam publicly before the store page exists.
