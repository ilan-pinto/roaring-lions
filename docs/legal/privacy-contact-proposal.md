# Privacy contact: a proposal (DRAFT)

**DRAFT. NOT LEGAL ADVICE. A proposal for the lead; nothing here is configured.** Written 15 Nov 2026.

## What is there today

`packages/worker/src/privacy-page.ts` serves `/privacy` and gives, as the way to make a privacy request:

```
open an issue titled "Privacy" at https://github.com/ilan-pinto/roaring-lions/issues
```

(`PRIVACY_CONTACT`). The page is deliberately fail-closed: it answers 503 until both the contact and the minimum age are real, and `privacyValues` rejects a contact that is empty or contains `TBD`, `TODO`, `<lead>` or `example`. So there is no "placeholder until later" path: the value must be a real, working contact before the page can be served.

## Why the current contact should change before launch

1. **It is public.** A GitHub issue on a public repository is visible to everyone and indexed. A person asking for their data to be deleted, or reporting that their data was exposed, would be posting that in public, and the request itself can identify them (their Player ID or display name, which `privacy-page.ts` says can be looked up by the team).
2. **It needs a GitHub account.** The players the page addresses sign in with Google or Steam, not GitHub.
3. **It names a person's repository.** If the repository moves, is renamed or goes private, the contact on the privacy page silently stops working.
4. **A regulator or a platform expects a monitored mailbox** for privacy requests. [Lawyer to confirm for each market; I am not asserting a rule.]

## The proposal: a role address, never a personal one

| Address | Purpose | Notes |
|---|---|---|
| `privacy@[GAME DOMAIN]` | Data access, export, deletion and correction requests; questions about this page. This is the only address that goes on `/privacy`. | The address on the page. |
| `legal@[GAME DOMAIN]` | Terms, takedowns, rights holders, rating bodies, the lawyer. | Referenced from the terms. |
| `support@[GAME DOMAIN]` | General player help. | Optional. |
| `security@[GAME DOMAIN]` | Vulnerability reports (a `security.txt` can point to it). | There is no `SECURITY.md` in the repository today. |

Rules for the set:

- **Role names only.** No first name, no initials, no personal mailbox, on the page, in the terms, in store listings or in the repository.
- **Forwarding, not a login.** Use the domain's email routing to forward to a mailbox the lead (and later a deputy) reads. If the operator already runs Cloudflare for the game (`wrangler.jsonc`), Cloudflare Email Routing can forward role addresses without a mail server; whether it fits [OPERATOR] is the lead's call.
- **A named owner and a deputy** who both receive it, so a request is not lost when one person is away. Written down off-repository.
- **A response promise the operator can keep:** the page should say a time only if someone will meet it. [Lawyer: any statutory deadline per market.]
- **No personal data in the repository.** The address is a role, so committing it is fine; the mailbox contents never go anywhere near the repo.
- **A game domain first.** Today the game lives at `roaring-lions.pint12.workers.dev` (`README.md`); role addresses need a domain the operator owns. [LEAD: decide the domain, or whether launch uses a different one.]

## The code change it implies (not made here)

One constant, one commit, to be made when the lead supplies the address:

```ts
// packages/worker/src/privacy-page.ts
export const PRIVACY_CONTACT: string | null = 'email privacy@[GAME DOMAIN]';
```

and `PRIVACY_UPDATED` set to the merge date. The existing `privacy-page.test.ts` asserts `privacyValues(PRIVACY_CONTACT, PRIVACY_MIN_AGE)` is not null and rejects an `example.com` address, so the test will keep guarding it. The wording on the page ("Questions or requests about your data: ...") reads naturally with either form. Do **not** use `example.com`/`example.org` in a real address or the validator will refuse it.

Other places that should carry the same address once chosen: the terms (`terms-of-use-draft.md`, clauses 10 and 16), the Steam store page's support/contact fields, and any rating-body submission. The in-game feedback form does not need it (it is a one-way report; its contact field is optional and for follow-up).

## Decisions for the lead

| # | Decision | Recommended default |
|---|---|---|
| C1 | Contact form | A role address, `privacy@[GAME DOMAIN]`, replacing the GitHub-issue sentence. |
| C2 | Domain | A domain the operator owns, bought before launch; role addresses forward from it. |
| C3 | Owner and deputy | Two named people who both receive it, recorded outside the repo. |
| C4 | Interim | Until C2 exists, **keep** the GitHub-issue contact and add a plain sentence that requests including personal identifiers should not be posted publicly [lawyer to word]; do not invent an address. |
| C5 | Security contact | Add `security@` and a `security.txt`/`SECURITY.md` pointer at the same time. |
