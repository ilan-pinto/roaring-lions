**DRAFT for the lead and his lawyer. Not legal advice.**

# Privacy contact: the paragraph (draft)

Written 18 Nov 2026 by an AI coding assistant from the repository at `origin/dev` `e1845a77e` and the head of PR 1481 (`cl/privacy-form`, `1f4e9749d`). It replaces the 15 Nov proposal (PR 1475, `privacy-contact-proposal.md`), which the lead ruled on (C1 to C5, below). Nothing here changes the Worker or the game.

**Rule for this file:** every name, route and sentence below is copied from PR 1481 (and PR 1502 for chat reports). Nothing is reworded. If a PR's wording changes before it merges, this file must follow it, not the other way round. No email address and no legal entity are invented. Brackets mark what only the lead can supply.

---

## 1. Where things stand

- **On `dev` today**, `/privacy` still says: `Questions or requests about your data: open an issue titled "Privacy" at https://github.com/ilan-pinto/roaring-lions/issues`. That is `PRIVACY_CONTACT` in `packages/worker/src/privacy-page.ts`.
- **C4 (no interim change):** the page stays like that until the form ships.
- **PR 1481** (open, HOLD FOR LEAD: privacy wording) ships the form, `SECURITY.md` and `security.txt`. Migration `0007_feedback_privacy.sql` must be applied to the telemetry D1 before it merges. The lead applies it.
- **PR 1502** (open, HOLD FOR LEAD: privacy wording; merge after 1481 and 0007) adds the chat-report paragraph.

## 2. The paragraph on `/privacy` (from PR 1481)

Heading "Contact and minimum age". The words "private request form" are the link to `/privacy/request`:

> Questions or requests about your data: use the private request form. What you send there is private, is read only by the person who runs Roaring Lions, and is never posted to GitHub. After 180 days it is cut down to the type of request (for example "Request: deletion"); your contact and everything else you wrote are removed.
>
> The minimum age to sign in is 16.

*Source:* PR 1481, `packages/worker/src/privacy-page.ts` (`PRIVACY_CONTACT = 'private request form'`, the `<a href="/privacy/request">` in "Contact and minimum age"; `PRIVACY_MIN_AGE = 16`; `PRIVACY_UPDATED` 2026-11-16, to be re-bumped at merge).

## 3. The same contact, short, for the terms and a store page

For `terms-of-use-draft.md` section 13, and a store page's privacy or support field. It only shortens section 2. It adds no promise.

> **Your data.** To ask for a copy, an export, a deletion or a correction of your data, use the private request form at [GAME ADDRESS]/privacy/request. It is read only by the person who runs Roaring Lions, and it is never posted to GitHub. If you have an account, "Download my data" and "Delete my account" on the profile screen also work. How your data is kept: [GAME ADDRESS]/privacy.
>
> **Security.** To report a vulnerability, use GitHub's private vulnerability reporting: https://github.com/ilan-pinto/roaring-lions/security/advisories/new. Please do not open a public issue. The site also serves this at /.well-known/security.txt.

*Source:* the form's intro text (`packages/worker/src/privacy-request.ts`, PR 1481); `SECURITY.md` and `packages/worker/src/security-txt.ts` (`SECURITY_REPORT_URL`, PR 1481). `[GAME ADDRESS]` is `roaring-lions.pint12.workers.dev` today (`README.md`); the lead decides whether launch uses another.

## 4. The chat-report paragraph (from PR 1502, for reference)

Its own heading on `/privacy`, "Reports of another player's chat". Its wording is also HOLD FOR LEAD:

> If you report a player from the chat box of a versus room, we keep that report for 180 days and then delete all of it. It holds the last messages your game received in that room (at most ten, including any you had muted or blocked, as your game received them and unchecked), the reason you chose and any note you typed, the map, the other player's public ID if they are a signed-in member (never anything for a guest), and the random session ID your browser uses for feedback, which is not tied to an account. Only the project lead reads reports, and nothing happens to the other player automatically. Chat messages are not stored anywhere else: a room relays them and keeps none. Your block list stays in this browser and is never sent.

**One wording mismatch to settle:** PR 1481 says "the person who runs Roaring Lions"; PR 1502 says "the project lead". They mean the same person (C3). The page should use one phrase. Which one is the lead's choice (open question 1).

## 5. Names, routes and rules (identical everywhere)

| Thing | Exact name or route | What it does | Source |
|---|---|---|---|
| Privacy page | `/privacy`, title "How your data is kept - Roaring Lions" | What is stored, for how long; script-free, cookie-free | `packages/worker/src/privacy-page.ts` |
| Request form | `/privacy/request`, title "Privacy request - Roaring Lions", heading "Send a privacy request" | Four choices: access, export, deletion, correction. Optional display name or Player ID, details, optional contact. Needs JavaScript | `packages/worker/src/privacy-request.ts` (PR 1481) |
| Where it goes | `POST /api/feedback`, `category: "privacy"`, `source: "privacy"` | Same origin check, caps, kill switch; its own 30-a-day bucket. No player, session or tester id; no picture or replay | PR 1481 (`feedback-meta.ts`, `feedback-ingest.ts`, `data/schemas/feedback.schema.json`) |
| Who reads it | "the person who runs Roaring Lions" | The lead alone (C3), on the password-protected `/stats` feedback page. Never a GitHub issue link | PR 1481 (`feedback-page.ts`, `feedback-triage.ts`) |
| Retention | 180 days, then "cut down to the type of request" | Contact, text and the lead's note removed by the daily purge | PR 1481 (`feedback-triage.ts`) |
| Reference shown | "Sent. Your reference is FB-nnnn." | The requester's receipt | `privacy-request.ts` (PR 1481) |
| Closing it | "Close feedback" on `/stats/feedback`, or `FEEDBACK_CLOSED` | Also closes the privacy form; the form then says "This form is closed for now. Please try again later." | PR 1481 |
| Security policy | `SECURITY.md` | GitHub private vulnerability reporting; data requests go to `/privacy/request` | PR 1481 |
| security.txt | `/.well-known/security.txt` | `Contact` = the advisory URL, `Policy` = `SECURITY.md`, `Expires: 2027-10-31T00:00:00.000Z`, `Preferred-Languages: en` | `packages/worker/src/security-txt.ts` (PR 1481) |

## 6. The lead's rulings this follows (GH-1417, 16 Nov 2026)

| | Ruling |
|---|---|
| C1 | A private web form replaces the GitHub-issue sentence on `/privacy`. No email address. |
| C2 | It reuses `POST /api/feedback` with a private "privacy request" category, readable only by the lead on the password-protected `/stats`, never on GitHub. Caps, origin checks, rate limit, kill switch and purge apply. No domain or email needed. |
| C3 | The lead alone receives and answers requests, for now. |
| C4 | No interim change: the page stays as it is until the form ships. |
| C5 | Add `SECURITY.md` pointing to GitHub's private vulnerability reporting, plus a `security.txt` on the site. |

**Dropped from the 15 Nov proposal:** the role addresses (`privacy@`, `legal@`, `support@`, `security@` on a game domain) and the one-line `PRIVACY_CONTACT` email change. C1 and C2 replace them.

## 7. Open questions for the lead and the lawyer

1. **One name for the reader.** "The person who runs Roaring Lions" (PR 1481) or "the project lead" (PR 1502)? Does the page need the operator's legal name as well ([OPERATOR LEGAL NAME], terms Q1)?
2. **Checking who is asking.** The form takes an optional display name or Player ID, and a Player ID is shown to other players. How is a deletion or access request matched to the real owner before anything is done? Options: point members to "Download my data" and "Delete my account" (which need a session); reply through the contact given and ask for proof; act only on requests made while signed in.
3. **A reply time.** The page promises none. Should it, and how long? A promise must be one the lead can keep alone (C3).
4. **No-JavaScript route.** The form says "This form needs JavaScript to send." Is another route needed for someone who cannot run it?
5. **What the 180-day trim keeps.** It keeps the request type only. Is that enough as a record that a request was handled?
6. **Feedback retention on `/privacy`.** The page mentions feedback only in its first paragraph. After 180 days a feedback note keeps its text and game details; the screenshot, replay, contact and ids go (`packages/worker/src/feedback-triage.ts`). Should `/privacy` say so?
7. **`security.txt` renewal.** `Expires` is 2027-10-31. Its test goes red 30 days before. Who renews it?
