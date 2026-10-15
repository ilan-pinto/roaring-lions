# S-F: on-loan polish (the three minors left on #641) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The capped tile's accessible name says the unit once; a focused card flag (the "On loan" stamp,
the PINNED flag) keeps the same DOM node across the card's 4 Hz rebuild, so it is not re-announced;
and a campaign-locked dock tile shows its lock sentence in the rich tip, as a capped one now does.

**Architecture:** Stacked on `feat/sf-on-loan` (#641). App only. The card keeps its string renderer
(`cardHtml`) but applies the result with a small in-place patch instead of `innerHTML`, so unchanged
structure keeps its nodes (focus, hover and `aria-describedby` survive) and only text and attributes
that changed are written.

**Spec:** #641's PR body "Left for later (minor)"; the on-loan mock's `questions.md` Q7
(`/Users/ilpinto/dev/roaring-lions-ep/_coord/on-loan-mock/`); F3 plan ruling 8 (one deny path, the
lock's sentence).

## Global Constraints

- App only; never `packages/sim` or `data/missions`. Strings through `t()`; `pnpm validate:ui` passes.
- No visual change except the new tip line on a locked tile (one `.rl-warn` line, the same treatment
  the capped line already has).
- Every new check is seen red by a one-line mutation of the implementation.

## Review Focus

1. **A card whose structure changes** (a unit becomes pinned, or the selected unit changes to one of
   another type): the patch replaces what differs and the old refocus-by-key still restores focus when
   the focused node itself was replaced. Task 2.
2. **The card's hp bar / status text changing every tick:** the stamp node is the same object before
   and after (`===`), and it keeps focus. Task 2.
3. **A tile both locked and over the cap:** the tip shows the lock sentence, not the cap line (lock
   outranks cap). Task 1.

---

### Task 1: the dock's refusal wording (accessible name and the lock's tip line)

**Files:** `packages/app/src/ui/production.ts` (`refresh` ~L524-540: the tile `title`/`aria-label`;
`unitTipHtml` ~L434-450), `packages/app/src/i18n/en.json`, `packages/app/src/ui/production.test.ts`.

- A capped tile's `title`/`aria-label` must name the unit once. Today it is `dock.tile.titleLocked`
  (`{name} — {reason}`) with `reason` = `capped.full`, and for the "needs" case that sentence already
  contains the name ("Population 11/12. Eitan APC needs 2."). Fix by giving the capped title
  the NAMELESS sentence: a new key `dock.cap.needTitle` = `Population {used}/{cap}; needs {need}.` used
  only in the title/aria-label (the rich tip and the click note keep `dock.cap.need` with the name). The
  at-cap line (`dock.cap.full`) has no name and is unchanged.
- The rich tip (`unitTipHtml`) adds one `.rl-warn` line for a LOCKED tile too: `state.lock.full` (the
  gate sentence, or the runtime's camp reason), escaped, in the same place the capped line sits. Lock
  outranks cap: at most one refusal line.

- [ ] **Step 1: failing tests:** a capped "needs" tile's `aria-label` contains the unit name exactly once;
  a locked tile's rich tip contains its gate sentence in a `.rl-warn` line; a locked-and-over-cap tile's
  tip shows the lock sentence and no cap line; an open tile's tip has no `.rl-warn` line.
- [ ] **Step 2:** run, see red. **Step 3:** implement. **Step 4:** `pnpm lint && pnpm typecheck && pnpm
  test && pnpm validate:ui`. **Step 5:** see red by a mutation. **Step 6:** commit
  `app: the dock's refusal wording — one name in a capped tile's label, the lock's sentence in its tip (S-F)`.

### Task 2: the card updates in place

**Files:** Create `packages/app/src/ui/dom-patch.ts` (+ `dom-patch.test.ts`); modify
`packages/app/src/ui/hud.ts` (`renderCard` ~L2104-2117), `packages/app/src/ui/hud.test.ts`.

```ts
// dom-patch.ts
/** Make `target`'s children match `html`, reusing every existing node whose position, node type
 *  and tag match: attributes are set/removed to match, text nodes get new `data` only when it
 *  differs, and children are patched recursively. A node that differs in type or tag is replaced
 *  (and everything after an inserted/removed child is replaced too: positional, no keys). Never
 *  touches `target` itself. Returns true if anything was written. */
export function patchChildren(target: Element, html: string): boolean;
```

`renderCard`'s single-unit branch calls `patchChildren(this.cluster, this.cardHtml(sel[0]))` instead of
assigning `innerHTML`, but only when the previous render of the cluster was ALSO a single-unit card (the
chips branch keeps `innerHTML` — out of scope); when switching from chips to a card, assign `innerHTML`
as today. Keep the existing refocus-by-`data-tip`-key as the fallback for a focused node the patch had to
replace (structure change), and drop it to a no-op when the focused node survived (`document.activeElement`
is still inside the cluster after the patch).

- [ ] **Step 1: failing tests:** `dom-patch.test.ts` — identical html writes nothing and returns false;
  changed text keeps the element node (`===`) and updates `data`; a changed attribute is updated and a
  removed one removed; a different tag replaces that node only; an appended child is added. `hud.test.ts`
  — with a lent unit selected, focus the stamp, change the unit's hp (or anything in the card) and run the
  4 Hz rebuild twice: the stamp element is `===` the original and `document.activeElement` is it, with no
  focus/blur events fired (listen for `focusout` on the cluster: zero) (Review Focus 2); select a unit of
  another type and the card still renders correctly (Review Focus 1).
- [ ] **Step 2:** run, see red. **Step 3:** implement. **Step 4:** `pnpm lint && pnpm typecheck && pnpm
  test && pnpm validate:ui && pnpm build`. **Step 5:** see red by a mutation (e.g. make `patchChildren`
  always replace). **Step 6:** commit `app: the unit card updates in place, so a focused flag is not re-announced (S-F)`.

## Controller close-out

Pins unchanged (no sim edit); one browser on a free port, music off: Tel Marum III, select a Lavi, Tab to
the stamp, wait 3 s, read back that the same node holds focus (tag it with a property first); hover a
locked dock tile and read its tip line. Ready PR with base `feat/sf-on-loan`, titled to merge after #641.
