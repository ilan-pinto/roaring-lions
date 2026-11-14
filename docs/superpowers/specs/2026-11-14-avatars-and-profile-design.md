# Avatars and the profile page redesign (GH-1075): design

**Date:** 2026-11-14. **Status:** DESIGN ONLY, for the lead to approve. Nothing here has been rendered, sent to Meshy
or built. The one picture is a static mock, `2026-11-14-profile-redesign-mock.html`, beside this file. Its PNG is in
the coordination folder, not the repo.

**The ask (lead, 14 Nov):** "add user profile page an avatar, a user can pick an avatar from list of avatars or bring
his own avatar. But either way, there should be an avatar. Also, the account page needs uplift and redesign so it will
look more appealing."

**The answer in one paragraph.**
- **Every member has an avatar from the moment the account exists.** If they never choose one, it is a default crest,
  derived from their public id by a frozen rule. A guest's menu chip shows a fixed guest mark, never anything derived
  from a device.
- **The preset set is 24 tiles**: 12 crests (flat SVG emblems built from palette keys by a generator; the default pool)
  and 12 unit busts (square crops of the 512 px portrait masters already in the repo). **Neither needs a Blender render
  or a Meshy credit.**
- **A preset choice is one nullable column on `profile`**, set through the existing `PATCH profile` and returned by `me`.
- **Bring-your-own is designed in full, but ships second, behind its own flag, and only the owner sees it.** The
  browser re-encodes the picture to a 256 px WebP (or JPEG where WebP cannot be encoded), which carries no metadata.
  The Worker checks the file's structure strictly and stores it as a D1 BLOB in its own table, following the feedback
  pictures' precedent.
- **The profile becomes a two-column page of cards**: a header card with the avatar, name and Player ID, the record and
  history, ways to sign in, your data, and a separate danger zone. It uses theme tokens only and the existing `inspect`
  panel.

The numbered decisions are in section 9. The slices are in section 8.

---

## 1. What exists today (origin/main, 771e70420)

These facts constrain the design. Each was read, not assumed.

- **`packages/app/src/ui/profile.ts`** is one `panel({ rank: 'inspect', title: t('profile.title') })` holding a status
  line and one column. Signed in, the column holds:
  - the name input and Save, then the Player ID line;
  - the history block (record, "Show my record", the list, More);
  - the identity rows and the "Link Google" / "Link Steam" buttons;
  - the verbs (Sign out, Sign out everywhere, Download my data), then the privacy link;
  - the danger row (Download my data, the telemetry checkbox, Delete).

  So **"Download my data" is drawn twice**. The guest state draws the provider buttons, the sign-up note, the privacy
  line and the link. The claim panel is prepended when the device has guest progress.
- **The menu chip** (`ui/menu.ts`, `.rl-menu__acct`) is a link to `routes.profile()`: `personMark()` (an inline
  `currentColor` SVG) plus the name, or `menu.profile.guest` ("Sign in"). It takes `account.name: Promise<string | null>`.
- **The account door's guard** (`packages/worker/src/account/http.ts`, `accountGuard`) wants `x-rl-account: 1` on
  every request except the two provider return GETs, the site's Origin on writes, and `application/json` on every body
  method. **So an `<img src="/api/account/...">` is refused (403), and a raw `image/webp` PUT is refused (415).**
  Bodies are capped by `readAccountBody(req, max)`; the default cap is 4,096 bytes.
- **Storage the Worker has:** D1 `ACCOUNTS` (members, never joined to telemetry), D1 `DB` (telemetry and feedback), KV
  `ACCOUNT_TOMBSTONES` (deletion tombstones only), the Durable Object `ROOMS`, and static assets. **There is no R2**, on
  purpose.
- **The precedent for pictures:** feedback pictures (`migrations/0003_feedback.sql`, `feedback-ingest.ts`). They are
  WebP only, recognised by magic bytes and capped at 64 KB, and they live in their own D1 table so no list query ever
  reads a blob. They have a day and total byte budget (16 MiB a day, 200 MiB in total, against what the file calls
  "free tier 500 MB"). The client side (`feedback/picture.ts`) encodes to fit a quality ladder, and gives NO picture
  when the browser cannot encode WebP (`toBlob` quietly returns PNG on Safari).
- **Export and delete** are driven from `MEMBER_TABLES` (`account/tables.ts`). Test A1-8 fails if a table with a
  `member_id` column is missing from that list. **It does not see a new COLUMN** missing from a table's `exportSql`.
- **`me`** returns `publicId`, `displayName`, `showRecord`, `fresh` and `identities`. The app's client copies those
  five fields by name (`account/client.ts`, line 198), so a new field is dropped unless the client is changed too.
- **The privacy page** (`packages/worker/src/privacy-page.ts`) lists Google's picture and Steam's avatar under
  "never stored", and promises Google's `sub` only. Its minimum age is 16.
- **Lobby labels:** `SeatMember { name, publicId, record? }` (`@lions/net` protocol) travels in the `lobby` message
  only, never in `MatchConfig` (A3, section 0.14). Test A1-10 searches telemetry, feedback and seats for member data.
- **Art that already ships:** 51 unit portraits at 192 px (`assets/ui/portraits/units/`, 19 single-figure `lead/`
  variants). Their 512 px masters are tracked (`art/portraits/masters/`, 136 files). The brand mark (`ui/mark.ts`) is
  three chevrons, and its comment rules that "the lion is implied, never illustrated". The GH-1096 lion insignia is a
  design still awaiting the lead's approval (`docs/art/mocks/gh1096-*`).
- **CSP for the game** (`assets/_headers`) has `img-src 'self' data: blob:`. A blob URL is therefore allowed; another
  origin is not.

---

## 2. Constraints this design is held to

- **The four invariants are untouched.** Nothing here reaches `@lions/sim`. An avatar is presentation and account data.
- **Colour comes from `data/palette.json`.** UI source uses semantic tokens (`validate:ui`). Static art that is not UI
  source (the crest SVGs) is generated FROM palette keys, and a test pins every fill to a palette hex. **No reserved
  band** (team, vfx, group) appears in any avatar, so no avatar can read as a side or as an effect.
- **Original art only.** No paid packs and no third-party emblems. The crests are geometry authored as code by an
  agent. That is AI-assisted, so the PR that adds them says so (`CONTRIBUTING.md`).
- **The lead approves art numbers before any render.** This design needs none: the crests are generated SVG, and the
  busts are crops of existing masters. The numbers in section 3 are still the lead's to approve before either script
  runs, and a contact sheet is shown before a merge.
- **Minimal data** (the privacy page's promise). Nothing is fetched from Google or Steam. An uploaded picture is
  personal data and is treated as such (section 4.6).
- **Every chrome string goes through `t()`**, and every check arrives with the input that makes it fail (CLAUDE.md).

---

## 3. The preset set

### 3.1 Recommendation: 24 tiles, two families

| Family | Count | Made by | Role |
|---|---|---|---|
| **Crests** | 12 | `tools/avatars/build_crests.mjs` writes SVG from palette keys | The DEFAULT pool (section 3.4), and choosable |
| **Unit busts** | 12 (6 KDF, 6 Sarim) | `tools/avatars/crop_busts.py` crops the 512 px portrait masters | Choosable only |

**Why two families.** The crests read at 28 px on the menu chip; a full-body figure does not. The busts are the
game's own units, which players recognise, and they cost no new render. Sarim busts are included because versus
offers a free side pick (decision 3 asks the lead).

**Alternatives.**
- **(b) Crests only, 16.** The cheapest, and fully consistent, but the set is less personal.
- **(c) Busts only, from the existing portraits.** Zero new art, but they read poorly on the chip, and the default
  would be a unit.
- **(d) Lion insignia variants.** This waits on GH-1096's approval, and it cuts against `mark.ts`'s "implied, never
  illustrated". It is open question 2.
- **(e) New Blender busts at a portrait angle**, framed head and shoulders. This needs a render budget and approval.
  Use it only if the crops in 3.3 fail the lead's look.

### 3.2 Crest numbers (for approval)

**Geometry.** Every crest uses the same frame:
- `viewBox 0 0 256 256`;
- a roundel of radius 120, centred, filled with the GROUND;
- a rim 8 units wide in the RIM colour, at radius 116 to 124;
- one CHARGE (the motif) inside radius 96.

**Legibility floor.** At the 28 px chip, 1 unit is 0.11 px. So no stroke or gap may be under 18 units (2 px at the
chip). The generator refuses a shape that breaks this; its unit test measures each path's thinnest gap with an
erosion check on a 256 px raster (numpy).

**Colour.** At most 3 palette entries per crest (ground, rim, charge). The charge-on-ground contrast must be at least
3:1 (WCAG non-text), and a test checks it from the palette hexes.

**Size.** ≤ 3 KiB per file, with no `<image>`, no `<script>`, no `<style>` and no external reference (checked).

| # | id | Charge (motif) | Ground | Rim | Charge colour |
|---|---|---|---|---|---|
| 1 | `crest-chevrons` | The brand's three chevrons (`mark.ts` geometry, scaled) | `shadow.1` | `dust.4` | `dust.0` |
| 2 | `crest-claw` | Three parallel claw slashes, 30° lean | `terracotta.1` | `terracotta.2` | `limestone.0` |
| 3 | `crest-mane` | A 36-point sunburst ring (the GH-1096 mane outline, with no face) | `olive.2` | `olive.3` | `dust.0` |
| 4 | `crest-tower` | A crenellated masonry tower | `gunmetal.3` | `shadow.0` | `limestone.1` |
| 5 | `crest-star` | A five-point rank star | `olive.3` | `olive.1` | `dust.0` |
| 6 | `crest-wing` | One swept wing (aviation) | `water.1` | `gunmetal.3` | `limestone.0` |
| 7 | `crest-track` | Three road wheels under a track run (armour) | `shadow.0` | `gunmetal.2` | `limestone.2` |
| 8 | `crest-sprig` | An olive sprig, five leaves | `limestone.1` | `limestone.5` | `scrub.1` |
| 9 | `crest-ridge` | A twin-peak ridge (Sur) | `gunmetal.2` | `gunmetal.3` | `limestone.0` |
| 10 | `crest-wave` | Three stacked waves (the Marj coast) | `shadow.1` | `water.1` | `water.0` |
| 11 | `crest-dune` | Two dune crests under a sun disc | `dust.5` | `dust.6` | `dust.0` |
| 12 | `crest-reticle` | A ranging reticle (circle and four ticks) | `terracotta.2` | `shadow.0` | `dust.0` |

**How it is served.** The files go to `assets/ui/avatars/crests/<id>.svg`. The app imports them with
`import.meta.glob`, so Vite gives them hashed names and they are cached forever, from the same origin
(`img-src 'self'`). They are drawn by `<img>`, never inlined. That keeps their fixed hexes out of UI source, the same
way `assets/brand/` is kept out.

### 3.3 Bust numbers (for approval)

- **Source.** `art/portraits/masters/lead/<id>.png` for a figure team; `art/portraits/masters/<id>.png` for a vehicle.
  Both are 512 px, already lit and framed by the approved portrait numbers (2026-10-01).
- **The crop.** A 256 px square cut from the master at native resolution (no resampling, so nothing goes soft).
  - Figure: the square's top edge sits 12 px above the figure's alpha bounding box, centred on the head column (the
    column of the topmost 48 opaque rows). That gives chest-up framing.
  - Vehicle: the whole master is Lanczos-downscaled to 256 on premultiplied alpha, because a vehicle is already framed
    at 88%.
- **Output.** `assets/ui/avatars/units/<id>.webp`, 256 × 256, lossy at q 0.85 with lossless alpha, ≤ 24 KiB each (the
  test fails above that). The pixels are transparent outside the subject. The app draws the roundel behind each bust in
  CSS: the KDF ground is `--avatar-ground-kdf` (`olive.3`) and the Sarim ground is `--avatar-ground-sarim`
  (`dust.6`), both new semantic tokens in `theme.css`.
- **The 12.**
  - KDF: `inf_squad`, `sniper_team`, `yahalom_squad`, `inf_medic_squad`, `mbt_lavi`, `heli_peten`.
  - Sarim: `sarim_rifles`, `militia_cell`, `atgm_cell`, `rpg_team`, `technical`, `rocket_battery`.
- **The script is deterministic** (Pillow, no noise). It writes a contact sheet to the coordination folder, never to
  the repo, for the lead's look before the slice merges.

### 3.4 The catalogue

`data/avatars/presets.json` holds the list, validated against `data/schemas/avatar_presets.schema.json` and
registered in `@lions/data`:

```json
{ "version": 1,
  "defaultPool": ["crest-chevrons", "crest-claw", "crest-mane", "crest-tower", "crest-star", "crest-wing",
                  "crest-track", "crest-sprig", "crest-ridge", "crest-wave", "crest-dune", "crest-reticle"],
  "presets": [ { "id": "crest-chevrons", "family": "crest", "label": "avatar.preset.crest-chevrons" },
               { "id": "unit-mbt_lavi", "family": "unit", "side": "kdf", "unit": "mbt_lavi", "label": "avatar.preset.unit-mbt_lavi" } ] }
```

- The app and the Worker both import it: the Worker uses it to validate an id, and the app to draw.
- An id matches `^[a-z0-9_-]{3,40}$` and is never reused for a different picture.
- `label` is an `en.json` key, never text.
- A test pins every preset to a file on disk and every file to a preset, so nothing is unregistered and nothing is
  orphaned.

---

## 4. "There should always be an avatar"

### 4.1 The default: derived, frozen and total

```
defaultAvatar(publicId) = defaultPool[fnv1a32(utf8(publicId)) mod defaultPool.length]
```

- **Frozen.** `defaultPool` is version 1. It is append-never and reorder-never: adding presets to `presets` leaves
  it alone, so nobody's default ever changes. If the pool must ever change, it becomes `defaultPoolV2`, chosen by
  member creation date. That is a recorded decision, never an edit.
- **Shared.** One function in `@lions/data` (`avatar.ts`), so the Worker and the app cannot disagree. `me` returns the
  RESOLVED avatar, so the app draws whatever the server says.
- **Total.** `resolveAvatar(view)` never returns null. Its chain is: upload → chosen preset → default crest →
  `chevrons` (the last is reached only if the catalogue is corrupt). Each `<img>` carries an `onerror` that steps
  down the same chain, so a missing file or a 404 still shows a crest.
- **Why not stored at creation:** derivation needs no migration for existing members and no backfill, and two members
  created in the same second still differ.

### 4.2 The guest look

The guest chip keeps today's person silhouette, now inside the same 28 px roundel frame the members' avatars use
(ground `--panel-bg-solid`, rim `--panel-frame`, glyph `--ink-dim`). It reads "Sign in".
- **It is never derived** from the telemetry player id, a device id or anything else on the device. Such a mark would
  link a device to an account visually and break the telemetry-unlinked rule (A1-10).
- **It is never a crest.** A crest would look like an identity the guest already owns.

---

## 5. Bring your own

### 5.1 Where the bytes live: D1, in their own table (recommended)

| Option | For | Against |
|---|---|---|
| **D1 BLOB in `ACCOUNTS`, table `avatar_image`** | The feedback precedent. Delete and export already walk the database (`MEMBER_TABLES`), and it is transactional with `profile` | Counts against the accounts database's size, and Time Travel keeps deleted bytes for the retention window |
| KV value | Large values, edge-cached | Free tier allows 1,000 writes a day, shared with tombstones. It is eventually consistent (a replaced picture lingers), and it is a second store that delete must reach |
| R2 | Made for objects | Not bound, and avoided on purpose. A new binding and a new lead step |
| Cloudflare Images | It re-encodes server-side | A paid product, a third-party processor of personal data, and a new account setting |

**The size math.**
- The cap is 48 KiB a picture. A canvas WebP of a 256 px photo at q 0.8 measures roughly 12 to 25 KiB, so call it
  about 20 KiB on average. 1,000 uploaders is therefore about 20 MB, and the cap bounds it at 48 MB.
- That is small beside what the same database already holds by design: `campaign_state` up to 256 KiB a member, and
  12 slots of up to 256 KiB each.
- **The budgets**, counted in `rate_day` like the account budgets:
  - per member, 5 uploads a day (scope `acct-avatar`);
  - overall, 8 MiB of avatar bytes a day (`acct-avatar-bytes`);
  - a running total of 100 MiB (`SUM(size)` of `avatar_image`, read before each insert). Past it, uploads answer 507
    and presets still work.
- **To verify against Cloudflare's current limits page before U2** (the repo does not state them): the largest D1
  BLOB or row (believed 2 MB, far above 48 KiB), the accounts database's size ceiling on the current plan (the feedback
  code assumes 500 MB on Free), and Time Travel's retention on the current plan.

### 5.2 The upload flow

**In the browser** (`packages/app/src/account/avatar-encode.ts`):

1. **Pick.** The file picker is `<input type="file" accept="image/png,image/jpeg,image/webp">`. The type is decided by
   magic bytes, never by the extension or `file.type`, and the file is refused above 10 MB before anything is decoded.
2. **Header pre-check.** The width and height are read from the header bytes alone (PNG `IHDR`, JPEG `SOF`, WebP
   `VP8`/`VP8L`/`VP8X`). A picture above 6,000 px a side or 36 megapixels is refused before decoding, so a
   decompression bomb never allocates.
3. **Decode.** `createImageBitmap(file, { imageOrientation: 'from-image' })`, so EXIF rotation is applied and then
   discarded.
4. **Frame.** A square crop step in the picker sheet. It opens centred, and the player can zoom (1× to 3×) and drag.
   It draws on a 256 × 256 canvas over `--avatar-ground-upload`, so a transparent PNG gets a ground and the output is
   opaque.
5. **Encode to fit.** `toBlob('image/webp', q)` for q in [0.85, 0.7, 0.55]. If the browser hands back anything but
   WebP (Safari), the same ladder runs on `image/jpeg`. The first result ≤ 48 KiB is kept. **A canvas re-encode carries
   pixels only: no EXIF, GPS, XMP, ICC or camera data survives it.**
6. **Send.** `PUT /api/account/avatar` with a JSON body
   `{ op_id, format: 'webp' | 'jpeg', data: <base64> }`, capped at `AVATAR_BODY_MAX` = 70 KiB (48 KiB × 4/3 plus the
   envelope). It goes through `readAccountBody(req, AVATAR_BODY_MAX)`. **The guard is unchanged:** the custom header,
   the Origin and `application/json` all still apply.

**On the Worker** (`packages/worker/src/account/avatar.ts`), cheapest step first:

1. Session; the `avatars-upload` flag open; the per-minute limiter; the body cap; JSON.
2. **Strict structural validation, with no pixel decoding** (a Worker has nothing bound that decodes images, and a WASM
   codec would not fit Free's CPU budget):
   - **WebP.** `RIFF` size equals the length − 8, and the chunks are a subset of `{VP8X, ALPH, VP8 , VP8L}` in a legal
     order. If `VP8X` is present, its ICC, EXIF, XMP and animation flags are all clear. The dimensions parsed from
     `VP8`/`VP8L` are exactly 256 × 256. Any other chunk (`EXIF`, `XMP `, `ICCP`, `ANIM`, `ANMF`, unknown) is refused.
   - **JPEG.** `SOI`, then segments from `{APP0 (JFIF only), DQT, DHT, DRI, SOF0, SOF2}`, then `SOS`, entropy data and
     `EOI`. `SOF` gives exactly 256 × 256 with 3 components. Any `APP1` to `APP15` (EXIF, XMP, ICC, Photoshop) or `COM`
     segment is refused. Nothing may follow `EOI`.
   - The size is ≤ 48 KiB. `format` must match the magic bytes.
3. **Budgets** (section 5.1), then one batch:
   - upsert `avatar_image (member_id, format, bytes, size, sha256, updated_at)`;
   - `UPDATE profile SET avatar = 'u', avatar_rev = avatar_rev + 1`;
   - the `account_op` row (`budgetedOp`, so a retry gets the first answer).
4. The answer is `{ avatar: { kind: 'upload', rev, fallback } }`.

**What the server cannot promise, said plainly:** it cannot prove the client re-encoded. A hostile client can upload any
structurally valid 256 px WebP or JPEG. But it cannot smuggle metadata (every metadata container is refused), and
pixels are what the player chose to show themselves. If the pixels are corrupt, the `<img>` falls back to the crest
(section 4.1).

### 5.3 Reading it back

- `GET /api/account/avatar`, with the guard's header, answers the bytes with `content-type` from `format`,
  `x-content-type-options: nosniff`, `content-disposition: inline` and **`cache-control: no-store`**. The app fetches it
  and draws it through `URL.createObjectURL`. The object URL is revoked in the screen's disposer, and the chip and the
  profile share one in-memory copy per page load.
- **Why `no-store`:** the URL is the same for every member on a shared browser, so an HTTP-cached response could show
  the previous member's picture after a sign-out, and a deleted picture would linger in the cache. At about 20 KiB,
  fetched once a page load, caching buys nothing worth that. (The alternative, `private, max-age=31536000, immutable`
  on `/api/account/avatar/<publicId>/<rev>`, is decision 9's alternative.)

### 5.4 Removing, replacing, switching

- **`DELETE /api/account/avatar`** deletes the `avatar_image` row and sets `profile.avatar = NULL` (back to the
  default), in one batch.
- **Choosing a preset while an upload exists deletes the upload in the same batch.** The sheet says so before saving
  (`avatar.upload.replaceNote`). Recommended over keeping it, because one stored picture with no hidden copies is the
  simplest privacy story.
- **A new upload replaces the old row** (one row per member, keyed by `member_id`).

### 5.5 Moderation and abuse

- **The owner alone sees an uploaded picture** (section 6). That removes the harm a public image can do to others,
  and with it the need for a report flow in this phase.
- **Lead takedown** (slice U5): `/stats` gains "Clear avatar" by Player ID, beside the existing "blank a name". It
  deletes the row, sets `avatar = NULL` and writes nothing else. It covers a future widening of visibility and any
  complaint.
- **No hashing or third-party scanning.** Cloudflare's CSAM scanning tool scans cached zone content, not D1 rows, and
  any outside scanner is a new processor of personal data. **Before uploads are ever shown to another player**, a
  separate design adds a report button, a lead queue and an upload hold, and revisits scanning. That widening is
  decision 4's "not now".
- **Abuse by volume** is bounded by the budgets in 5.1, `ACCOUNT_OP_LIMIT` (60 a minute an address) and
  `opBudget`.

### 5.6 Privacy

- **The privacy page gains two lines** (the lead owns the wording; the text below is the recommendation):
  - Under what is stored: *"The avatar you pick from the game's own set (its name only)."* and *"If you upload a
    picture as your avatar: the picture, redrawn by your browser at 256 pixels, with no location or camera details.
    Only you see it. It is deleted when you remove it, choose another avatar, or delete your account."*
  - Under how long, if Time Travel retention applies: *"A removed picture can stay in the database's automatic
    backups for up to N days."*, with N as verified in 5.1.
- **"What is never stored" stays true and unchanged.** The game still never asks Google or Steam for a picture.
- `PRIVACY_UPDATED` moves in the same commit as the text. The page's test pins the new lines, with the mutation of
  removing one going red.
- **Export:** `profile`'s `exportSql` gains `avatar, avatar_rev`. A new `MEMBER_TABLES` row exports `avatar_image` as
  `format, size, sha256, updated_at, hex(bytes) AS bytes_hex`. Hex is SQL-native, so export stays driven by the table
  list. 48 KiB becomes 96 KiB of JSON. The format stays version 1, because the change is additive.
- **Delete:** the `avatar_image` row joins `MEMBER_TABLES` child-first, before `member`. A1-8 then fails if it is
  missing. Tombstones need nothing new: the bytes go with the row, and the existing reconcile finishes any delete a
  Time Travel restore brings back.
- **The minimum age stays 16.** Owner-only visibility keeps a minor's face from being shown to strangers by design.

---

## 6. Who sees what

| Viewer | Preset or default | Uploaded picture |
|---|---|---|
| The member, on `/profile` and the menu chip | yes | yes |
| A versus opponent (lobby, end screen) | **later, slice L1** (a preset id in `SeatMember`, lobby only) | **never in this design**: they see the member's `fallback` preset |
| History, leaderboards, `/arena-results` | no (later designs) | no |
| The lead, on `/stats` | no picture is shown; only the "Clear avatar" action | no |

L1 is optional and is not part of the lead's ask. It adds `avatar?: string` (a preset id, validated against the
catalogue by `@lions/net`) to `SeatMember`, never to `MatchConfig`. It extends A1-10 with a sentinel preset id that
must not appear in telemetry, feedback, replays or the desync log.

---

## 7. API and data

### 7.1 Migration `migrations-accounts/0003_avatars.sql` (presets; slice P4)

```sql
-- Applied to production by the LEAD before the PR merges (merging deploys):
--   npx wrangler d1 migrations apply roaring-lions-accounts --remote
ALTER TABLE profile ADD COLUMN avatar TEXT
  CHECK (avatar IS NULL OR avatar = 'u' OR (avatar GLOB 'p:*' AND length(avatar) <= 42));
ALTER TABLE profile ADD COLUMN avatar_rev INTEGER NOT NULL DEFAULT 0;
```

- NULL means the default. `'p:<id>'` means a preset, validated in code against the catalogue (a CHECK cannot list a
  growing set). `'u'` means an upload.
- A plain `ADD COLUMN` needs no table rebuild, unlike `0002_google.sql`. Existing rows read NULL, which is the default.

### 7.2 Migration `0004_avatar_image.sql` (uploads; slice U2)

```sql
CREATE TABLE avatar_image (
  member_id  TEXT PRIMARY KEY REFERENCES member (id) ON DELETE CASCADE,
  format     TEXT NOT NULL CHECK (format IN ('webp', 'jpeg')),
  bytes      BLOB NOT NULL,
  size       INTEGER NOT NULL CHECK (size BETWEEN 1 AND 49152),
  sha256     TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);  -- a rowid table on purpose: SQLite advises against large rows in WITHOUT ROWID tables
```

It is kept out of `profile`, so `me` and every profile query never page a blob in (the feedback rule).

### 7.3 Routes

| Route | Change | Body or answer |
|---|---|---|
| `GET me` | gains `avatar` | `{ kind: 'preset', id, chosen: boolean }` or `{ kind: 'upload', rev, fallback }` (`fallback` is the chosen preset or the default) |
| `PATCH profile` | accepts `avatar` | `avatar: '<preset id>'` sets it; `avatar: null` resets to the default; an unknown id answers 400 `{error:'avatar'}`; a preset while an upload exists deletes the upload in the same batch |
| `PUT avatar` (U2) | new | section 5.2 |
| `GET avatar` (U2) | new | section 5.3; 404 when no upload |
| `DELETE avatar` (U2) | new | section 5.4 |

- **Guard and CSRF:** unchanged. Every route above sits behind `accountGuard` (the custom header; the Origin on
  writes; JSON bodies) and `ACCOUNT_OP_LIMIT`. Writes go through `budgetedOp` with an `op_id`.
- **Caching:** JSON answers keep `no-store` (`accountJson`). Preset files are Vite-hashed static assets, cached
  forever. Upload bytes are `no-store` (5.3).
- **The flag:** `flags.avatars-upload` = `'open'` gates the three upload routes and the picker's upload tile (`GET open`
  lists it, as it lists providers). It is CLOSED when missing, like every account flag. Presets have no flag: they ship
  when accounts are on.
- **The client** (`account/client.ts`) copies `avatar` from `me`. A test fails if it is dropped (the line-198 trap).

---

## 8. The profile page redesign

### 8.1 Information architecture

The page keeps the one `panel({ rank: 'inspect', title: t('profile.title') })` (machinery, VR-24), widened to
`min(64rem, 94vw)`. The status line keeps its place under the band (`role=status`, `aria-live=polite`).

**Signed in:** two columns at ≥ 56rem; one column below that, in this order.

| Column | Card | Contents |
|---|---|---|
| Left (wide) | **Header card** | The avatar at 6rem (`--cmd-face`), with a "Change avatar" button on its lower edge. The display name in the display face at `--t-read`, with an edit button that turns it into today's input and Save. The Player ID in mono with a Copy button. A "Member since <month year>" line (`me` gains `createdDay`; the month and year only) |
| Left | **Record** | Three tiles (Won, Lost, Drawn) from `GET matches`, the "Show my record" switch and its hint |
| Left | **Versus history** | Today's rows, restyled as a table-like list (date, map, result chip in `--good`/`--bad-text`, opponent), and More |
| Right (narrow) | **Ways to sign in** | One row per provider: the mark (Google's unaltered G; Steam text), the label, the state ("Linked" / "Paused"), Remove (disabled with the "only way" hint when it is the last). Below the rows go the "Link Google" / "Link Steam" buttons, for listed providers the member does not hold. Reauth appears in place |
| Right | **Your data** | Download my data (ONCE), the privacy link, Sign out, Sign out everywhere |
| Right | **Danger zone** | A `--bad` hairline frame: the telemetry checkbox and Delete my account (confirm as today) |

The claim panel, when shown, is a full-width banner above both columns (`--band-mission` rule on its left edge),
because it is the one thing on the page that asks for action.

**Guest:** a single centred card.
- The guest mark at 6rem and the headline "Keep your campaign on every device".
- Three short lines on what an account gives: your avatar and name, your progress on every device, your versus record.
- The provider buttons ("Sign up with Google" / "Sign in with Google"; Steam only if listed), the sign-up note, the
  privacy line and link.

The **closed** state replaces the buttons with `profile.signInClosed`. **Signed out** and **deleted** keep their line
above the card.

**Avatar picker sheet:** a modal (`role=dialog`, `aria-modal`, `aria-labelledby`) built on the same dialog service as
`confirmDialog`, so `isDialogOpen()` and `closeOpenDialog()` cover it and Escape closes it.
- **Header:** a 6rem preview of the selection and its name.
- **Body:** two labelled groups, "Crests" and "Units", each a `role=radiogroup` of 4.5rem tiles. Arrow keys move,
  Space or Enter selects. The selection carries an `--accent` ring and a check, and the member's default crest carries
  a small "Default" tag.
- **The first tile of the Units group is "Upload your own"** (dashed `--panel-frame` border, upload glyph), shown only
  when `avatars-upload` is open. It opens the frame step in the same sheet. The upload note reads "Only you see your
  picture. Other players see your crest."
- **Footer:** "Use my default", Cancel, Save. Save sends one `PATCH profile` and closes on success. A failure stays
  open with the error in the sheet's own status line.
- **The disposer contract:** the sheet mounts on `document.body`, so `showProfile`'s disposer closes it (identity-scoped
  and idempotent), and any late promise checks `disposed`.

### 8.2 Visual direction

The page should look like the menu, not like a settings form:
- the shadow ground, hairline gunmetal frames, the display face for names and section titles in uppercase with
  `--track-title`;
- Barlow for body text and IBM Plex Mono for the Player ID;
- `--accent` (`dust.0`) for focus and selection, and the olive mission band only on the claim banner.

**Section titles** are small uppercase labels in `--ink-label` with a hairline rule, like the menu's "The Sahar Basin"
kicker.

**Cards** are `--panel-bg` with a 1px `--panel-frame` border, `--s4` padding and `--s3` gaps. No drop shadows: the HUD
uses none.

**New semantic tokens** (in `theme.css`, the only file that names `--rl-*`):
- `--avatar-ring` (`--panel-frame`), `--avatar-ring-selected` (`--accent`);
- `--avatar-ground-kdf` (`olive.3`), `--avatar-ground-sarim` (`dust.6`), `--avatar-ground-upload` (`shadow.1`);
- `--danger-frame` (`--bad`).

No literal colour appears anywhere (`validate:ui`).

**Resolutions** (the three `ui:shots` sizes, run in CI only):
- At 1400 × 900, the two columns are 38rem and 24rem, and the header card shows above the fold.
- At 1920 × 1080 and 2560 × 1440, `--ui-scale` already enlarges the rem, so the layout is the same, scaled.
- Below 56rem (a narrow window or a phone), one column; the record tiles wrap to three across; the picker grid wraps
  to four across.
- `ui:shots`' overflow report is the check. It is a report, not a gate.

### 8.3 Accessibility, i18n, motion

**Focus.** Every control is a real `button`, `a`, `input` or `label`, with a visible `--accent` focus ring. The sheet
traps focus, returns it to "Change avatar" on close, and opens with focus on the selected tile.

**Alt text.**
- The header avatar is decorative (`alt=""`), because the name sits beside it.
- The chip avatar is decorative, because the chip's text names it.
- Each picker tile is a radio whose accessible name is the preset's label ("Three chevrons crest", "Lavi tank").
- An uploaded picture's tile reads "Your picture".

**Contrast** comes from the palette. `--ink` on `--panel-bg` is already the shell's body pair. Each crest's
charge-on-ground pair is ≥ 3:1 (3.2). Result chips reuse `--good` and `--bad-text`, and the latter's 4.5:1 on `--bg`
is already pinned (`bad-text-contrast.test.ts`).

**i18n.** Every new string is an `en.json` key (list in 8.4). `?pseudo=1` must bracket all of them. Preset labels are
keys. A display name and the Player ID are data, set as text, never through `t()`.

**Reduced motion.** The tile hover lift and the sheet's fade are off under `data-motion="reduced"` and
`prefers-reduced-motion`. Nothing animates by default except a 120 ms opacity fade.

**Text size.** Everything is in rem, so `--text-size` and `--ui-scale` apply. Name and ID ellipsize rather than wrap
the header.

### 8.4 New `en.json` keys (draft wording)

`profile.avatar.change` "Change avatar" · `profile.name.edit` "Edit name" · `profile.copyId` "Copy" ·
`profile.copied` "Copied" · `profile.memberSince` "Member since {date}" · `profile.section.record` "Record" ·
`profile.section.signIn` "Ways to sign in" · `profile.section.data` "Your data" · `profile.section.danger` "Delete
account" · `profile.identity.linked` "Linked" · `profile.identity.paused` "Paused" · `profile.guest.headline` "Keep
your campaign on every device" · `profile.guest.perk.avatar` / `.sync` / `.record` · `avatar.picker.title` "Choose
your avatar" · `avatar.picker.crests` "Crests" · `avatar.picker.units` "Units" · `avatar.picker.default` "Default" ·
`avatar.picker.useDefault` "Use my default" · `avatar.picker.save` "Save" · `avatar.picker.cancel` "Cancel" ·
`avatar.upload.tile` "Upload your own" · `avatar.upload.note` "Only you see your picture. Other players see your
crest." · `avatar.upload.replaceNote` "Choosing this removes your uploaded picture." · `avatar.upload.type` "Use a
PNG, JPEG or WebP picture." · `avatar.upload.big` "That picture is too large to open." · `avatar.upload.failed` "The
picture could not be saved. Try again in a minute." · `avatar.upload.zoom` "Zoom" · `avatar.preset.<id>` × 24 ·
`menu.profile.avatar` (the chip's accessible name when signed in, "{name}, your account").

### 8.5 The menu chip

- **Signed in:** a 1.75rem round avatar (resolved as in 4.1), then the name.
- **Guest:** the guest mark (4.2) in the same frame, then "Sign in".
- `account.name` becomes `account.who: Promise<{ name: string; avatar: AvatarView } | null>`, and `main.ts` builds it
  from the same `me` it already reads. A guest menu still never calls `me` (A1 rule).

---

## 9. Decisions, each with a recommended default

1. **What ships first. Recommended: presets and the guaranteed default now (P slices). Uploads are designed here and
   built second (U slices), behind `flags.avatars-upload`, closed.** Alternative: both together. That doubles the
   first PR's review surface and needs the privacy text and the lead's flag before anything lands.
2. **The preset set. Recommended: 24 = 12 generated crests + 12 cropped unit busts (section 3).** Alternatives: 16
   crests only; busts only; lion variants (after GH-1096); new Blender busts.
3. **Sarim busts. Recommended: yes, 6 of the 12**, because versus has a free side pick. Alternative: 12 KDF busts.
4. **Who sees an upload. Recommended: the owner only, until a moderation design exists.** Others see the member's
   `fallback` preset. Alternative: opponents too, which needs reports, a queue and a hold first.
5. **The default. Recommended: `fnv1a32(publicId) mod 12` over the frozen crest pool, computed by one shared
   function, and resolved server-side in `me`.** Alternative: a random crest stored at creation, which needs a
   backfill and a write.
6. **The guest look. Recommended: the person silhouette in the avatar frame, fixed.** Alternatives: the chevrons
   crest (reads as owned); a per-device crest (links a device visually; refused).
7. **Upload storage. Recommended: a D1 BLOB in its own `ACCOUNTS` table, 48 KiB cap, budgets of 5 a member a day,
   8 MiB a day and 100 MiB in total.** Alternatives: KV, R2 or Cloudflare Images (section 5.1).
8. **Upload format and processing. Recommended: a client canvas re-encode to a 256 px WebP, with JPEG where WebP
   cannot be encoded; the server parses the structure strictly and refuses every metadata chunk; base64 in JSON keeps
   the guard unchanged.** Alternatives: WebP only (Safari players get no upload, as with feedback); a raw-body guard
   exemption for `image/webp`.
9. **Upload caching. Recommended: `no-store`, one in-memory blob URL a page load.** Alternative: `private, immutable`
   on `/avatar/<publicId>/<rev>`.
10. **Switching to a preset. Recommended: it deletes the upload, with a note in the sheet.** Alternative: keep the
    upload to switch back to.
11. **Moderation. Recommended: owner-only visibility, plus the lead's "Clear avatar" on `/stats`; no scanning, no
    reports in this phase.** Alternative: a report flow now.
12. **The redesign. Recommended: the section 8 IA: two columns of cards in the existing inspect panel, the duplicate
    Download removed, and a separate danger zone.** Alternatives: tabs (Profile / Sign-in / Data), which hide the
    danger zone and history one click deep; a full-screen page with no panel.
13. **"Member since". Recommended: yes, the month and year, from a `createdDay` added to `me`.** Alternative: omit it.
14. **The lobby avatar (L1). Recommended: yes, later, preset ids only, as its own small PR after P5.** Alternative:
    the profile and chip only, for now.
15. **Importing a Google or Steam picture. Recommended: never.** It contradicts the openid-only scope and the privacy
    page's promise.

---

## 10. Slices

Each slice is 1 to 2 hours, one PR, and lists its proofs. **Merging deploys to production** (Workers, from `main`).
Slices marked **LEAD** need the lead before they merge.

| # | Slice | Proof (a test) | Falsifying mutation (watched red, then reverted) | Lead |
|---|---|---|---|---|
| P0 | Approve the numbers in 3.2 and 3.3 and decisions 1 to 6 | (none) | (none) | **LEAD**: art numbers |
| P1 | `@lions/data`: `presets.json`, its schema, `defaultAvatar`, `resolveAvatar` | Literal public ids map to literal crest ids (written as literals at authoring); 10,000 random ids put every crest between 5% and 12%; every pool id is a crest preset | Change the FNV offset basis; swap two pool entries; point a pool id at a unit preset. Three mutations, three reds | |
| P2 | Crests: `tools/avatars/build_crests.mjs` writes `assets/ui/avatars/crests/*.svg` | Every fill and stroke is a palette hex and no reserved band; ≤ 3 KiB; no `image`/`script`/`style`/external href; contrast ≥ 3:1; thinnest gap ≥ 18 units; a re-run is byte-identical (`git status --porcelain -uall` is empty) | A non-palette hex in one crest; `team.kedem` as a ground; a 10-unit stroke | **LEAD**: views the crest sheet before merge; the PR discloses the AI-authored geometry |
| P3 | Busts: `tools/avatars/crop_busts.py` writes `assets/ui/avatars/units/*.webp` | 256 × 256; ≤ 24 KiB; the catalogue and the files match both ways; a re-run is byte-identical | Drop one file; raise one to 30 KiB; crop at 255 px | **LEAD**: views the contact sheet before merge |
| P4 | Worker: `0003_avatars.sql`; `PATCH profile` accepts `avatar`; `me` returns the resolved `avatar` and `createdDay`; export includes the columns | An unknown id gives 400; null resets; `me` is never without `avatar`; the export holds `avatar`/`avatar_rev`; the A1-8 table list still matches | Accept any id; return `avatar: null` for a default; drop `avatar` from `profile.exportSql` (the column-level proof A1-8 cannot give) | **LEAD**: applies the migration before merge; the privacy text (P8) lands with it |
| P5 | App: `ui/avatar.ts` (element + `onerror` chain), the client copies `avatar`, the menu chip shows it | A signed-in chip renders the preset `<img>`; a guest renders the guest mark; a dispatched `error` steps to the default, then to chevrons; the client keeps `avatar` | Remove the `onerror` step; drop `avatar` in `client.ts`; derive the guest mark from the telemetry id (A1-10 goes red) | |
| P6 | App: the picker sheet | Arrows move the selection; Escape closes; Save sends `{avatar}` once; disposing while open removes it from `body`; `isDialogOpen()` is true while open | Skip the close in the disposer; send on every arrow key; mount outside the dialog service | |
| P7 | App: the redesigned layout and CSS (cards, columns, guest card, danger zone, a single Download) | `profile.test.ts` holds the section order, ONE `profile.export` button, and the guest, closed, signed-out and deleted states; `validate:ui` is clean; `?pseudo=1` brackets every new key | Re-add the second Download; hard-code one label; one hex in `theme.css` outside the token block | |
| P8 | Privacy text for the preset line; `PRIVACY_UPDATED` | `privacy-page.test.ts` pins the line | Delete the line | **LEAD**: wording |
| U1 | Worker: the WebP and JPEG structural validators | Fixtures: a canvas WebP and JPEG pass; refused are EXIF, XMP and ICCP chunks, an `ANIM` flag, 257 px, a trailer after `EOI`, `APP1`, `COM`, a RIFF size off by one, a format that disagrees with the magic | Allow one extra chunk type; skip the dimension check; ignore the VP8X flags. Each turns a fixture red | |
| U2 | Worker: `0004_avatar_image.sql`, `PUT`/`GET`/`DELETE avatar`, the budgets, the flag, a `MEMBER_TABLES` row, hex export, delete | Closed flag gives 404; 413 over the body cap; 429 past the member budget; 507 past the total; the export's hex decodes to the stored bytes; delete leaves no row; `GET` is `no-store` and `nosniff`; a preset PATCH deletes the image | Leave the row out of `MEMBER_TABLES` (A1-8 red); `cache-control: private`; forget the image delete in the preset PATCH | **LEAD**: applies the migration; verifies the D1 limits (5.1) |
| U3 | App: `avatar-encode.ts` (magic, header pre-check, decode, crop, encode ladder, JPEG fallback) | A stub encoder returning PNG gets the JPEG ladder; 6,001 px refused before decode; output ≤ 48 KiB; the type by magic bytes, not `file.type` | Trust `file.type`; skip the pre-check; keep the first over-cap blob | |
| U4 | App: the upload tile and frame step in the sheet | The tile hidden while the flag is closed; zoom and drag clamp to the image; the replace note shows when a preset would delete an upload | Show the tile with the flag closed; let the crop leave the image | |
| U5 | `/stats` "Clear avatar"; the upload privacy text; open the flag | The stats action deletes the row and sets NULL; the privacy page pins the upload lines | Clear `avatar` but leave the bytes | **LEAD**: wording; opens `flags.avatars-upload` |
| L1 | (optional) a preset id in `SeatMember`, lobby only | `@lions/net` refuses an unknown id; A1-10 with a sentinel preset id | Put `avatar` in `MatchConfig` | |

**Order:** P0 → P1 → (P2 ∥ P3) → P4 + P8 → P5 → P6 → P7. Then, when the lead chooses: U1 → U2 → U3 → U4 → U5. L1
is independent after P5.

**What each merge deploys:**
- P1 to P3 ship data and files that nothing draws yet.
- P4 changes the API, additively: the old app ignores `avatar`.
- From P5, signed-in members see their default crest on the chip and the profile.
- U2 ships routes that answer 404 until the flag opens in U5.

---

## 11. Risks and open questions

Each has a recommended default.

1. **The default pool must never change.** A future edit to `defaultPool` would silently change every member's
   avatar. *Default:* the P1 literal-pin test, plus a comment in the JSON. A change needs a `defaultPoolV2` and a
   ruling.
2. **The lion.** Should a crest show the lion itself? *Default:* no, until GH-1096 is approved. `crest-mane` carries
   the mane silhouette with no face, which matches `mark.ts`'s "implied, never illustrated".
3. **Sarim faces as avatars.** These are fictional militants. *Default:* include them (decision 3). The lead may
   prefer vehicles only for Sarim (`technical`, `rocket_battery`, `gun_truck`, `moto_rpg`, plus two crests).
4. **Crop quality.** A 256 px native crop of a 512 px master is chest-up, not a close portrait. *Default:* accept it if
   the contact sheet reads at 4.5rem; else decision 2's alternative (e), with a render budget.
5. **Safari and WebP.** *Default:* the JPEG fallback (decision 8). Without it, Safari members could not upload.
6. **D1 limits are unverified in the repo.** *Default:* U2 is blocked on the lead confirming the BLOB, database-size and
   Time Travel numbers on the current plan. The budgets in 5.1 hold well inside the believed limits.
7. **Time Travel keeps removed bytes** for its retention window. *Default:* the privacy page says so (5.6). The
   reconcile already handles a restore that resurrects a deleted member.
8. **The accounts database's size** is driven by campaigns and slots far more than by avatars. *Default:* none for
   avatars; noted for the L7 (Workers Paid) decision.
9. **Shared browsers.** *Default:* `no-store` and one revoked blob URL a page (decision 9); sign-out reloads the app
   anyway.
10. **A hostile upload that is structurally valid** (any 256 px pixels, no metadata). *Default:* accepted risk, while
    only the owner sees it. It must be revisited before decision 4 widens.
11. **Test churn.** `profile.test.ts` holds today's DOM order. `routes-check.ts` does not visit `/profile` (checked).
    *Default:* P7 rewrites the profile tests in the same PR, and CI's `ui:shots` report is reviewed by eye.
12. **Golden baselines.** The profile is not in any golden scenario, and the menu chip is outside the battlefield
    captures. *Default:* no bless is expected. If CI's visual job goes red on P5, read the log, then bless from CI
    numbers only.
13. **Dialog stacking.** The picker and the delete confirm must never be open together. *Default:* one dialog service,
    one open dialog (the existing rule); "Change avatar" is disabled while a confirm is open.
14. **Display-name editing moves into the header.** *Default:* keep today's validation (3 to 20 code points,
    `profile.name.invalid`) and the same `PATCH`. Only the placement changes.
15. **A member with no `me` yet** (offline, or the account unreachable). *Default:* the chip shows the guest mark until
    `me` answers, as the name does today. The profile shows `account.unreachable`.

---

## 12. Out of scope

Leaderboards, avatar frames or borders earned by play, animated avatars, GIFs, a public profile page, avatars in match
history rows, and any Roar-coin pricing of presets. Each is a later design if the lead wants it.
