# Cinematics: tool, delivery and setup

What this covers: the intro, the seven town briefing backdrops and the two
Tel Marum replacements. All of them are made with the paid Gemini API, from
the game's own renders, with no people in them, under a **hard cap of $150**.
The lead approved this on 2026-10-11, from
[the research report](../research/2026-10-11-generative-video.md).
The shots, stills, prompts and costs are in [the storyboard](storyboard.md).
This page covers the tool, where the results go, and what the lead has to set
up before anything can be spent.

**State on 2026-10-11: no account, no key, no call, $0 spent.** The tool is
built and dry-runs every request. Production needs two things from the lead:
the billing setup below, and a go.

---

## The tool: `pnpm video`

It is modelled on `pnpm meshy` (`tools/src/meshy/`, `docs/ART_PIPELINE.md`,
"Meshy API"). The code is in `tools/src/video/`.

    pnpm video -- estimate [--shot <id>] [--json]
    pnpm video -- generate --shot <id> --stage <explore|final> [--takes <n>] [--spend]
    pnpm video -- status <operation-name | interaction-id>
    pnpm video -- ledger [--json]

What it enforces, in the order a spend meets the rules:

1. **Dry run is the default.** `generate` prints the exact HTTP request: the
   URL, the body, the model id, and the prompt with the content rules
   appended. The image is shown as its size and hash, and the key as a
   placeholder. It also prints the price of each take and of the batch, and
   the budget verdict. Then it stops. Nothing is sent.
2. **Sending needs `--spend` AND a key.** If either is missing, the command
   makes no network call at all (`cli.test.ts` counts the calls). A key with
   no `--spend` is still a dry run.
3. **The $150 cap is in code** (`tools/src/video/budget.ts`, `HARD_CAP_USD`).
   Editing `shots.json` cannot raise it. Every batch, and then every take
   within it, is checked against what the ledger has already spent. A take
   that would go past the cap is refused, not trimmed. Money is compared in
   integer micro-dollars, so a spend that lands exactly on $150.00 passes and
   one cent over does not.
4. **Takes are capped by the plan.** `--takes` cannot exceed what
   `shots.json` plans for that shot and stage. To spend more on a shot, change
   the plan first, in a commit.
5. **The ledger is written before the request goes out**
   (`art/video/ledger.jsonl`, tracked), and the outcome is patched in once the
   request finishes. Every submitted take is counted, including filtered and
   failed ones. Veo bills only takes that succeed, so the ledger can overstate
   the spend but never understate it.
6. **Prices are a quoted table** (`tools/src/video/pricing.ts`, from
   ai.google.dev/gemini-api/docs/pricing on 2026-10-11). An Omni take is
   priced at its 10 s maximum, because its request has no length field.
   Upscaled Omni output (1080p or 4K) is refused, because its billing is not
   published.

Each take that succeeds is downloaded to `art/video/takes/<shot>/` (git-ignored),
next to a JSON record of what was asked: the model id, the prompt, the still,
the date and the operation id. That record is the raw material for the file's
provenance entry.

The **stills** come from `pnpm stills:cinematics` (`tools/src/perf/cinematic-stills.ts`):
one browser (Metal on macOS), music off, its own port (5197, never 5177), and
units, overlays, fog, FX and HUD all hidden. See the storyboard.

### How production runs, once the lead says go

1. **One explore take first** (about $1.02), to check the request shape
   against the live API. Neither vendor page shows every combination the
   tool sends; see `request.ts`'s header. Then compare the ledger with Cloud
   Billing the next day.
2. Explore each shot (Omni Flash at 720p), review against the storyboard
   checklist, and adjust the shot's prompt in `shots.json` if a take drifts.
3. Run the finals (Veo 3.1) on the prompts that held up, and pick one take
   per shot.
4. Encode and deliver (below). Run `pnpm video -- ledger` after every batch.

---

## Delivery

### Where the files go

| What | File | Played by |
|---|---|---|
| Town backdrops | `assets/video/<town>_briefing.mp4`, for `beit_sahwan`, `khan_rafid`, `deir_amun`, `tel_marum`, `qarn_hadid`, `umm_zeitoun` and `wadi_halam` | The deploy screen (`ui/loading.ts`), through `"briefing_video": "video/<town>_briefing.mp4"` on the town's first mission. The mission JSON line is added **in the same commit as the file**, because `validate:data` refuses a `briefing_video` with no file. |
| Tel Marum replacements | `assets/video/tel_marum_2_briefing.mp4` and `assets/video/tel_marum_3_briefing.mp4`, as **new files**: the originals were removed on 2026-10-11 (the lead's request; he will make his own), so each arrives with its `data/video.json` entry **and** the `"briefing_video"` line on `tel_marum_2_foothold.json` / `tel_marum_3_clearance.json`, in the same commit | The same |
| Intro, in-game cut | `assets/video/intro.mp4`, 720p | **The menu, on a first launch** (`ui/intro.ts`, `ui/intro-overlay.ts`), and Settings' "Replay intro". Playback is built and waits for the file: nothing plays, requests or draws until `video/intro.mp4` is in `assets/video/` **and** listed in `data/video.json` (the gate holds the two together). See "Playback" below. |
| Intro, trailer master | 1080p, from the Veo 3.1 Standard finals | Store pages and the trailer. It stays **outside the repo**, because at 10-20 MB it is not game data. |

### Format and encode

Each file is 1280x720, H.264 High profile, yuv420p, 24 fps, about
1.2 Mbit/s, with **no audio track** and `+faststart`. That plays everywhere
the game does. (The schema also allows WebM, but a second format buys nothing
for H.264.)

    ffmpeg -i art/video/takes/<shot>/<take>.mp4 -an \
      -vf "scale=1280:720:flags=lanczos,fps=24" \
      -c:v libx264 -profile:v high -pix_fmt yuv420p -preset slow \
      -b:v 1200k -maxrate 1500k -bufsize 2400k -movflags +faststart \
      assets/video/<name>.mp4

`-an` strips the soundtrack Veo always generates (and Omni does by default).
An audio track nobody has listened to is a second provenance question, and
item 4 already had one. The deploy screen still tries to autoplay with sound,
so a silent file simply plays silent.

For the intro, join the three finals with 0.5 s crossfades
(`-filter_complex xfade=transition=fade:duration=0.5`) before encoding.

**Looping.** The backdrops are generated as pinned loops: the same frame at
both ends. The lead's ruling of 2026-10-11 is that the deploy screen plays the
video **once** and holds its last frame (`ui/briefing-video.ts`): no `loop`.

### Playback

The lead's rulings of 2026-10-11, as built:

- **The intro plays on a first launch only**, full screen over the menu, and
  skips at any moment: the Skip button, Escape, Space or Enter, or a click.
  Once it has played or been skipped it never auto-plays again
  (`lions.settings` -> `intro.seen`; a video that failed to load is neither,
  and is tried again next launch). The overlay mounts on `document.body`; the
  menu owns its disposer, so leaving the route mid-video takes it down.
- **Settings has "Replay intro"**, a row that exists only when an intro ships.
  It plays on request, whatever the motion or data preference says, and never
  touches `intro.seen`.
- **Each town's deploy screen plays that town's backdrop once**, then holds the
  last frame. A missing or failed video leaves the screen as it is without one.
- **Reduced motion and save-data never auto-play.** The intro is marked seen,
  unplayed. A backdrop under reduced motion sits at its first frame with
  controls; under save-data it is not fetched at all.
- **Only `data/video.json` entries are played.** An unlisted path is never
  requested, so while nothing has shipped there is no overlay, no 404 and no
  console line.

Every test browser starts with the intro already seen: `music-off.ts`'s one
seed helper (`musicOffSettings`) sets `intro.seen`, so the golden gate,
`ui:routes` and `ui:shots` open on the menu they came for.

### Size budget

`tools/validate_video.mjs` enforces two limits, both constants in code:

- **5 MiB per file.** The 24 s intro at 1.2 Mbit/s comes to about 3.6 MB.
- **15 MiB for all of `assets/video/`.** This is the report's roughly 15 MB.
  Nine 8 s backdrops at about 1.2 MB each make 10.8 MB, and the intro adds
  about 3.6 MB, for about 14.4 MB in all. Today the directory holds 6.0 MB
  (the two Tel Marum files).

Every file is far under the Workers limit of 25 MiB a file. Nothing joins the
boot wait: the deploy screen fetches its video after the mission click, and
works without it.

### Provenance: `data/video.json` and the data gate

Every file under `assets/video/` needs an entry in `data/video.json`, and
`pnpm validate:data` checks it (`tools/validate_video.mjs`, decision 4 in the
report). An entry has these fields:

| Field | Value |
|---|---|
| `what` | One line saying what the clip shows |
| `generator` | `{ "tool": "Gemini API", "model_id": "veo-3.1-fast-generate-preview", "plan": "paid tier, Cloud Billing account <name>" }`, or `"unrecorded"` |
| `source` | The input still or stills, for example `docs/cinematics/stills/tel_marum.jpg` |
| `license` | For example `"ARR; output owned per Gemini API Additional Terms (2026-04-28): Google claims no ownership"` |
| `terms_read` | The date the vendor terms were read and saved as PDF (`YYYY-MM-DD`), or `null` |
| `audio` | `"none"` (stripped), `"generated"`, or `"unrecorded"` |
| `commercial` | `"confirmed"` or `"unconfirmed"` |
| `record` | The ASSET_PROVENANCE.md row, and the take record `art/video/takes/<shot>/<take>.json` |

The gate fails on any of these:

- a file with no entry, or an entry with no file;
- a mission naming a video that has no entry;
- a missing field;
- a `"confirmed"` entry with any of generator, source, license, terms_read
  or audio unrecorded;
- a file or the directory over budget;
- anything in `assets/video/` that is not `.mp4` or `.webm`.

**`pnpm validate:data -- --commercial`** also fails every entry that is not
`"confirmed"`. This is the check a sold build has to pass. Today it fails on
exactly the two Tel Marum files, which is the truth about them.

Each delivered video also gets a row in `docs/ASSET_PROVENANCE.md`'s register,
in the "Campaign map and video" table, in the same shape as the other rows.
Its "AI-generated" column reads "Yes: Gemini API (`<model id>`), image-to-video
from a game render (Meshy-derived buildings, item 1)". Every still contains
Meshy-textured buildings, so each video inherits item 1 (report, risk 4).

### AI disclosure

- **The PR** that lands a video names the generator, the model id, the plan
  and the date (CONTRIBUTING.md).
- **The credits screen:** add one `credits.ai.*` paragraph to `en.json`
  (ASSET_PROVENANCE.md item 10 already waits on the videos). Proposed text:
  "The briefing backdrops and the intro were generated with Google's Gemini
  API (Veo 3.1 and Gemini Omni Flash), animated from the game's own renders."
- **Steam:** the store-page AI disclosure covers the backdrops and, if it is
  used, the trailer. Valve's January 2026 rules cover pre-generated content
  and marketing assets.
- **Honesty rule:** a cinematic is never cut into gameplay footage
  unlabelled. In a trailer, keep it as its own segment, or label it on
  screen. Google's terms also forbid passing generated content off as made
  by a person.

---

## Setting up billing and the key

These are the lead's steps, in order. None of them has been done. They need
the lead's own Google account and a card, so Claude cannot do them. Google's
console wording moves; if a label below does not match, the step's purpose
says what to look for.

1. **Read and save the terms.** Open the
   [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)
   (last updated 2026-04-28) and the
   [Generative AI Prohibited Use Policy](https://policies.google.com/terms/generative-ai/use-policy),
   and print each to PDF. Keep the PDFs **outside the repo** (for example in
   `~/Documents/roaring-lions/terms/`). The date you save them is the
   `terms_read` value every video's entry will carry.
2. **Open Google AI Studio.** Go to <https://aistudio.google.com> and sign in
   with the Google account that should own the spend. Accept the terms it
   shows on first use. The account must be 18 or over.
3. **Create a project and a key.** In AI Studio, open **Get API key**, then
   **Create API key**, and choose **create it in a new project** (call it
   `roaring-lions-cinematics`, so the spend is easy to find). Copy the key
   once, and do not paste it into any chat, file in the repo, or issue.
4. **Turn on billing for that project.** Veo and Omni have no free tier. On
   AI Studio's API-keys page the project shows as Free tier: use **Set up
   billing**. In the Cloud console that is **Billing**, then **Link a billing
   account**. Create a billing account with your card, or pick an existing
   one, and link it to `roaring-lions-cinematics`. The project should then
   show the paid tier ("Tier 1").
5. **Set a budget alert at $150.** In the Google Cloud console, go to
   **Billing**, then **Budgets & alerts**, then **Create budget**. Scope it to
   the `roaring-lions-cinematics` project, set the amount to $150, and set
   alerts at 50%, 90% and 100% to your email. A Cloud budget **alerts but
   does not stop spend**; the hard stop is the tool's own cap. If AI Studio
   offers a per-project spend limit on the billing page, set it to $150 as
   well, as a second stop on Google's side.
6. **Restrict the key.** In the Cloud console, go to **APIs & Services**,
   then **Credentials**, and open the key. Under **API restrictions**, choose
   **Restrict key** and tick **Generative Language API** only. A leaked key
   then cannot be used for anything else on the account.
7. **Put the key where the tool reads it, outside the repo.** In a terminal:

       mkdir -p ~/.config/roaring-lions
       read -rs KEY        # paste the key, press Enter; nothing is echoed or kept in history
       printf 'GEMINI_API_KEY=%s\n' "$KEY" > ~/.config/roaring-lions/gemini.env
       unset KEY
       chmod 600 ~/.config/roaring-lions/gemini.env

   This is the same place and shape as the Meshy key (`meshy.env`). The
   `GEMINI_API_KEY` environment variable also works, and wins if both are
   set.
8. **Check the key without spending.** Run:

       pnpm video -- status models/veo-3.1-fast-generate-preview/operations/no-such-op

   This is a free GET. A `404` / NOT_FOUND means the key works. A `400` or
   `403` naming the API key means it does not. Then run
   `pnpm video -- generate --shot tel_marum --stage explore` (no `--spend`)
   to see the first real request, priced.
9. **Say go.** Give an explicit approval in chat, naming the budget (the
   storyboard plans $82.47 and the cap is $150). The first batch is one
   explore take, checked against Cloud Billing, before the rest.

**Region note.** Image-to-video on Veo accepts only
`personGeneration: "allow_adult"`, which is what the tool sends. In some
regions (the report lists MENA) that is the only value allowed at all. It
makes no difference here, because no shot has a person in it.
