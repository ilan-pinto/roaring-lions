# Generative video for cinematics: research (GH-135)

Written 2026-10-11, a report and nothing else: no account was opened, no
generation was run, no money was spent. Every vendor page below was read on
**2026-10-11** unless a different date is given. Where a page could not be
read (BytePlus's terms pages render their text with JavaScript, and a plain
fetch gets only the navigation), this report says "not read" rather than
guess. Not legal advice: it is the checklist, filled in as far as public pages
allow.

## The answer, short

1. **Use Google, through the paid Gemini API, for cinematics.** Gemini Omni
   Flash 1.1 for most shots, Veo 3.1 where a shot needs its first and last
   frame pinned (a seamless loop). Of the three generators the issue names,
   Google's terms are the only ones with no non-commercial default, no brand
   labelling duty, and no licence back to the vendor over what we upload or
   generate on the paid tier.
2. **Kling is a usable second choice on a paid membership**, with conditions:
   its base terms forbid commercial use without written permission and its
   paid-member terms grant it. **Seedance is not usable today**: the consumer
   route (Dreamina) is non-commercial by its own terms, and the API route's
   terms could not be read.
3. **Recommended use:** one 20 to 30 s intro or trailer cinematic plus one
   briefing backdrop per town (seven), people-free, made image-to-video from
   our own renders. **Estimated cost $45 to $115, with a cap of $150.**
4. **For in-game assets the answer is no**, and the reasons are specific to
   this game (section 6): nothing in the 3D world can take a video. The one
   plausible pipeline use is reference motion for the mocap retarget, and that
   is a separate spike, not this one.

---

## 1. What changed since the issue was written

The issue is from the sprite era and several of its premises no longer hold.
The recommendations here are written against the tree as it is.

| Issue says | Now (`origin/main`, `551b2671`) |
|---|---|
| Sprites, the 36-colour palette gate, `validate:assets` | Sprites retired in WP-A3.3 (2026-10-04); `validate:assets` deleted; `tools/sprites_retired.py` refuses to recreate `assets/sprites/`. The per-pixel palette rule was retired 2026-09-14. **No palette exemption is needed for video**: there is no gate left for it to be exempt from. |
| #119 briefings never rendered | Rendered since 2026-10-04 (beats, sections, `briefing_image`). |
| #114, #94 | Both closed. |
| Title screen is a wordmark on a panel | `/` draws a live three.js diorama behind the menu (the scene host, #232), with `menu_host_plate.jpg` as the still fallback. A title-loop video would now compete with the real renderer, not with a panel. |
| GitHub Pages deploy, 62 MB `assets/` | Cloudflare Workers since 2026-09-24; `assets/` is 113 MB; Workers static assets allow 25 MiB per file ([limits](https://developers.cloudflare.com/workers/platform/limits/)). |
| Sublicensing under CC BY-SA 4.0 | Art and data are **all rights reserved** since 2026-08-30 (`ART_PIPELINE.md` §8). |
| Video is new | **Two briefing videos already ship**: `assets/video/tel_marum_{2,3}_briefing.mp4`, 1280x720, 24 fps, 10.0 s, H.264 + AAC, 3.2 and 2.8 MB, container encoder tag `Google`. Played by `ui/loading.ts` above the briefing at `max-height: min(24vh, 16.25rem)`, about 260 px tall. Their provenance is `ASSET_PROVENANCE.md` open item 4. |

Two consequences. The display slot is small, so 720p is already more than
enough and the cheap tiers are the right ones. And Lane A is not new work: the
`briefing_video` field, its schema pattern and its existence check are in place,
and the open question is provenance, not plumbing.

---

## 2. Comparison

Prices are per second of output, from each vendor's own page where it was
readable, otherwise marked as a third-party figure.

| | **Gemini Omni Flash 1.1** (Google) | **Veo 3.1** (Google) | **Kling 3.0** (Kuaishou) | **Seedance 2.0 / 2.5** (ByteDance) |
|---|---|---|---|---|
| Route | Gemini API, paid tier only; also Google Flow | Gemini API paid tier (`veo-3.1-generate-preview`, `-fast-`, `-lite-`); Vertex AI; Flow (Google AI Pro/Ultra) | kling.ai membership; Kling API (separate prepaid packages) | Dreamina (CapCut) app; BytePlus ModelArk API; resellers (fal, Atlas Cloud, ...) |
| Price | ~$0.10/s at 720p (Google's own token estimate: 5,792 output tokens/s at $17.50 per 1M) | Lite $0.05 (720p) / $0.08 (1080p); Fast $0.10 / $0.12, $0.30 4K; Standard $0.40 / $0.40, $0.60 4K | 6 credits/s at 720p no audio, 12 at 1080p with audio, 30 at 4K; top-up $1 per 66 credits, so ~$0.09 to $0.18/s (third party, CloudZero, 2026-09-18); plans $10 / $37 / $92 / $180 a month | BytePlus bills by token; ~$0.11 to $0.15/s at 720p (third parties, Aug to Sep 2026) |
| Clip length | 3 to 10 s; extend by 10 s to 40 s total | 4, 6 or 8 s; extend by 7 s up to 148 s (720p, Standard/Fast only) | 5 to 10 s; extend in 5 s segments (third party) | not read from an official page |
| Resolution | 720p native; 1080p and 4K **upscaled** | 720p, 1080p, 4K (1080p/4K need 8 s) | up to native 4K | 720p to 1080p (leaderboard entries) |
| Frame rate | not stated | 24 fps | not read | not read |
| Image-to-video | yes | yes | yes | yes |
| First + last frame | yes ("advanced interpolation") | yes (`lastFrame` with `image`) | yes (start/end frame, third party) | not read |
| Reference images | subject references (no maximum stated), up to 3 reference clips of 3 s | up to 3 ("style and content references"; Standard/Fast, 8 s only) | yes (Omni variant) | yes |
| Audio | generated by default, steerable by prompt | always on | optional (credit price differs) | yes |
| Watermark | SynthID (invisible) | SynthID; Flow adds a **visible** mark on Pro, not Ultra (third party) | visible brand mark for non-members only | not read |
| Ranking ([AA image-to-video](https://artificialanalysis.ai/video/leaderboard/image-to-video), [text-to-video](https://artificialanalysis.ai/video/leaderboard/text-to-video)) | I2V #4 (Elo 1178); T2V #8 | I2V #12 (1082) | T2V #15 (1015), not in I2V top 12 | I2V #5 (2.0, 1176); T2V #3 (2.5) and #7 (2.0) |
| Commercial licence | **Yes** (section 3.1) | **Yes** (section 3.1) | **Members only** (section 3.2) | **No** on Dreamina; API terms not read (section 3.3) |

Sources: [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing),
[Veo docs](https://ai.google.dev/gemini-api/docs/veo),
[Omni docs](https://ai.google.dev/gemini-api/docs/omni),
[Flow models page](https://support.google.com/flow/answer/16352836),
[CloudZero on Kling](https://www.cloudzero.com/blog/kling-ai-pricing/),
[Atlas Cloud on Seedance](https://www.atlascloud.ai/blog/guides/seedance-2-cost-per-second).

**"Clearly stronger" options, checked and set aside.** The leaderboards are led
by models the issue does not name: Wan 3.0 (Alibaba, T2V #1), MiniMax H3 (I2V
#1 and #2), Vidu Q4 Preview (I2V #3). Wan 3.0 is closed (the open Wan line stops
at 2.2, Apache-2.0, July 2025: [the Next Web](https://thenextweb.com/news/alibaba-wan3-video-model-after-share-sale)),
and none of the three had its terms read here. Gemini Omni Flash sits within a
few Elo points of them on image-to-video, which is the mode this project would
use, under terms that were read, so nothing stronger is worth the extra
licence exposure. Two more for the record: **Sora is gone** (OpenAI announced
the discontinuation on 2026-03-24 and scheduled the API off for 2026-09-24:
[laozhang](https://blog.laozhang.ai/en/posts/sora-2-pricing), unconfirmed on
OpenAI's own page), which is the argument for never depending on a vendor at
runtime. **Runway** owns nothing it makes for you and allows commercial use
([terms](https://runway.com/terms-of-use), updated 2026-09-15, §4.4), but takes
a perpetual, irrevocable, sublicensable licence to inputs and outputs and may
train on them. **Adobe Firefly Video** is the only one with vendor IP
indemnity for its own model, at a 5 s native clip and lower quality, and the
indemnity does not cover the partner models (Veo, Kling) Firefly also hosts
([chatforest review](https://chatforest.com/reviews/adobe-firefly-video-commercially-safe-ai-video-generation-creative-cloud/)).

---

## 3. Licence findings

What each vendor says on four questions: who owns the output, may it be used
commercially, what licence does the vendor take back, and does the output
have to carry the vendor's mark.

### 3.1 Google (Veo, Gemini Omni)

- **Gemini API Additional Terms** ([link](https://ai.google.dev/gemini-api/terms),
  last updated 2026-04-28, effective 2026-03-23): "Google won't claim ownership
  over that content." The services are for "professional or business
  purposes" and "not for consumer use"; 18 or over. No non-commercial clause,
  no labelling duty. Google "may generate the same or similar content for
  others". Content sent to **unpaid** services may be used to train and may be
  read by human reviewers; Veo and Omni **have no free tier**
  ([pricing](https://ai.google.dev/gemini-api/docs/pricing)), so a Veo/Omni
  call is always on the paid side.
- **Google Terms of Service** ([link](https://policies.google.com/terms),
  effective 2026-07-30), which govern Flow: the same "won't claim ownership"
  line, plus a ban on "misleading others into thinking that generative AI
  content was created by a human". Flow's data page says outputs may be used to
  improve Google products when "Help improve Google Flow" is on (it can be
  switched off) ([link](https://support.google.com/flow/answer/17025472)).
- **Prohibited Use Policy** ([link](https://policies.google.com/terms/generative-ai/use-policy),
  last modified 2024-12-17): bars violence "or the incitement of violence" and
  impersonation "in order to deceive"; weapons are not named; exceptions are
  possible "based on educational, documentary, scientific, or artistic
  considerations". A fictional battlefield backdrop is not incitement, but
  Veo's filters are automated: Vertex's Veo page (updated 2026-10-09) lists
  **Violence**, Dangerous content, Celebrity, Child and Third-party content
  among the categories that silently drop outputs, each with support codes
  ([link](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/responsible-ai-and-usage-guidelines)).
  Expect some combat prompts to come back empty; prompt for aftermath and
  terrain, not for firefights.
- **People.** Veo's image-to-video, interpolation and reference modes accept
  only `personGeneration: "allow_adult"`, and in the EU, UK, CH and **MENA**
  that is the only value at all ([Veo docs](https://ai.google.dev/gemini-api/docs/veo)).
  Whether an account in Israel resolves to MENA was not established. It does
  not matter for the recommended use, which has no people in it.
- **Indemnity.** Google Cloud indemnifies Veo outputs on Vertex AI for
  **generally available** model versions only
  ([archived list, 2026-04-22](https://cloud.google.com/archive/terms/generative-ai-indemnified-services-20260422)).
  The current page could not be read. The Gemini API's Veo 3.1 ids all end in
  `-preview`, so assume **no indemnity** on the recommended route.
- **Verdict: commercial use permitted** for output in a sold game and its
  marketing, on the paid Gemini API. Record the plan, date and model id per
  file.

### 3.2 Kling (Kuaishou)

- **Terms of Service** ([link](https://kling.ai/docs/user-policy), effective
  2026-04-21, Singapore law): "You own all intellectual property rights ... in
  and to the Content", and "We do not claim ownership". But §4.6: without
  Kling's written permission you may not "use, reproduce, distribute, and
  create derivative works of" output for commercial purposes; §3.1(e) bars use
  "for any political, commercial or unauthorized purpose" without written
  consent; §4.5 requires output to be **labelled with Kling's brand** (or "Kling
  AI" stated prominently) unless Kling permits otherwise. §4.7.1 grants Kling a
  "non-exclusive, royalty-free right and license during the operational period
  of its business" over **inputs and outputs**, and §4.7.2 lets it use them for
  promotion and product improvement.
- **Terms of Paid Service** ([link](https://kling.ai/docs/payment-policy),
  **released 2026-10-10**, the day before this was read): Art. 3.1.2,
  "KLING AI members' use of the Output for commercial purposes is not
  restricted", including derivative works, except for building a competing
  product; watermark removal is a member benefit; the labelling duty (Art. 7.2)
  falls on non-members. So the paid terms are the written permission the base
  terms require.
- **The API is a separate contract** (prepaid resource packages) and its terms
  were not read.
- **Verdict: commercial use permitted on a paid membership**, subject to
  two cautions: the paid terms were re-issued a day before this read, so they
  must be snapshotted on the day of generation; and every still we upload for
  image-to-video (our own all-rights-reserved renders) is licensed back to
  Kling for as long as it operates.

### 3.3 Seedance (ByteDance)

- **Dreamina Terms of Service** ([link](https://www.capcut.com/clause/dreamina-terms-of-service?region=IL&lang=en),
  the Israel-region page, last updated 2026-01-22, Bytedance Pte. Ltd.,
  Singapore law): §8, "you own the Inputs you upload, and the Outputs";
  but §2, "Our Services are generally provided for private, non-commercial
  use", and §7 forbids use "for any commercial or unauthorized purposes". §8
  also takes "a perpetual, irrevocable, worldwide, non-exclusive, transferrable,
  no-charge, royalty-free, and sub-licensable" licence "to use your Assets for
  any purpose", where Assets include outputs, surviving termination. Dreamina's
  help page answers "Can I use my creations commercially?" only by pointing
  back at the terms ([link](https://dreamina.capcut.com/resource/about-dreamina-terms-of-service),
  2026-08-31). Third-party claims that a paid plan adds a commercial licence
  could not be tied to an official page.
- **BytePlus ModelArk** (the API): "Specific Terms for the BytePlus Video
  Generation Model Services" (last updated 2026-09-08) cover Seedance 2.0 and
  later and prevail over the general ModelArk terms (2026-08-31), with a
  separate "Copyright and Portrait Feature Usage Rules" page (2026-08-04).
  **None of their text could be read** ([link](https://docs.byteplus.com/en/docs/ModelArk/Specific_Terms_for_the_BytePlus_Video_Generation_Model_Services)).
  The ModelArk *Playground* terms, which may not govern API calls, limit use to
  "private and non-commercial" (search summary of
  [the playground ToS](https://docs.byteplus.com/en/docs/legal/tos_modelark_playground)).
- **IP history.** Disney, Paramount and the MPA sent cease-and-desist letters
  over Seedance 2.0 in February 2026, and ByteDance said it would "strengthen
  current safeguards" ([Variety](https://au.variety.com/2026/film/news/bytedance-safeguards-seedance-disney-legal-threat-ip-violations-33139/)).
  Not our problem directly (we would prompt nothing copyrighted), but a
  generator under that cloud is a poor first vendor for a commercial release.
- **Verdict: not usable today.** The consumer route is non-commercial by its
  own text, and the API route is unverified. Revisit only if someone reads the
  BytePlus video terms and they grant commercial use without a broad licence
  back.

### 3.4 The project's own rules, applied

| Rule | What it means for video |
|---|---|
| `CONTRIBUTING.md` AI policy: permitted, **disclosed in the PR** | Every video PR names the generator, model id, plan and date. |
| Setting standards: fictional, doctrine only, never ethnicity, nationality or religion | Backdrops are terrain, weather, architecture and machinery, with **no people**. That is also the configuration Veo's people filters never touch. |
| Art and data **all rights reserved** | Holds only as far as the output is ours to reserve; see risk 1. Google and Kling (members) do not claim ownership; Dreamina keeps a perpetual sublicensable licence, which an "all rights reserved" claim cannot override. |
| `ASSET_PROVENANCE.md`: a row per file; Meshy (item 1) and ElevenLabs (item 2) wait on a confirmed commercial licence before shipping | Same bar: a video ships in a commercial build only once its row records the tool, model id, plan, the date the terms were read, and the two answers (commercial use, redistribution in a binary). Item 4 (the two Tel Marum videos) is exactly this gap, already open. |
| Steam disclosure | Valve's January 2026 rewrite covers "marketing and concept assets" players see, and pre-generated content generally ([VGC](https://videogameschronicle.com/news/valve-has-significantly-rewritten-steams-rules-for-how-developers-much-disclose-ai-use)). A generated trailer goes in the store-page disclosure. |
| Issue's honesty rule | A cinematic is never cut into gameplay footage unmarked. Keep it a separate segment, or label it on screen. Google's own terms forbid passing generated content off as human-made. |

---

## 4. Recommended use

**Make:** one intro/trailer cinematic of 20 to 30 s (three or four 8 to 10 s
shots), and seven town backdrops of 8 to 10 s, one per town (Beit Sahwan, Wadi
Halam, Tel Marum, Umm Zeitoun, Qarn Hadid, Deir Amun, Khan Rafid), played
through the existing `briefing_video` field on each town's first mission (or on
all of a town's missions, which costs nothing extra).

**Do not make (yet):** a title-screen loop, since the scene host already draws
the live game there; per-mission backdrops for all 27 missions (section 5
prices them, if wanted later); victory and defeat stings, which compete with
the debrief's own text and audio.

**How, so it holds our look.**

1. **Image-to-video from our own frames, never text-to-video alone.** Feed a
   still from the game: a lit renderer capture (`pnpm plates:units`, the
   scene host plate, or a sandbox screenshot at a chosen camera) or a
   Blender portrait. The first frame is then our dimetric lighting and our
   Meshy-textured buildings by construction, and the model only has to move it.
   It also gives the clip a human-authored input, which matters for risk 1.
2. **Pin both ends for a loop.** Veo's `image` plus `lastFrame` (or Omni's
   two-image interpolation) with the *same* still at both ends gives a clip
   that returns to its start, which is the issue's "seamless loop" without a
   crossfade in post.
3. **Keep each shot short.** Drift away from the input grows with length;
   8 to 10 s is the native clip, and nothing here needs an extension.
4. **Prompt for terrain, light and weather.** "Dawn haze over a ridge, slow
   push-in, no people, no text, no flags, no insignia." Use the
   style references (Veo up to 3, Omni subject references) for the palette
   mood, and grade in post toward `data/palette.json`'s hues as a style-bible
   line, not a gate.
5. **Strip the audio** (`ffmpeg -an`) unless a clip's sound is wanted on
   purpose. Veo always generates sound; an unexamined soundtrack is a second
   provenance question (item 4 already has it).
6. **Encode once, small:** 1280x720 H.264 MP4 at about 1.2 Mbit/s with
   `+faststart`, which plays everywhere the game does and is about 1.5 MB per
   10 s, half the current files. WebM is allowed by the schema; a second
   format is not needed for H.264.

**Size budget:** 7 backdrops at ~1.5 MB plus a 30 s intro at ~4.5 MB is
about **15 MB**, 13% on top of today's 113 MB `assets/`, every file far under
the Workers 25 MiB limit. Nothing joins the boot wait: the deploy screen
already loads its video after the mission click and works without it.

---

## 5. Cost estimate

Assumptions, stated because none of them is measured: 8 s shots; **five
exploratory takes per kept shot** at the cheap tier, then **two final takes**
at the quality tier; 720p is enough for the 260 px slot, 1080p only for the
trailer master.

| Item | Exploration (Omni Flash or Veo Fast, 720p, ~$0.10/s) | Finals (Veo 3.1 Standard, 1080p, $0.40/s) | Total |
|---|---|---|---|
| Intro/trailer, 4 shots | 4 x 5 x 8 s x $0.10 = **$16** | 4 x 2 x 8 s x $0.40 = **$26** | $42 |
| 7 town backdrops | 7 x 5 x 8 s x $0.10 = **$28** | 7 x 2 x 8 s x $0.40 = **$45** | $73 |
| **Recommended set** | $44 | $71 | **$115** |
| Same set, finals also at the cheap tier | | | **$45 to $60** |
| Optional: all 27 missions instead of 7 towns | +$80 | +$128 | +$208 |

The Lite tier ($0.05/s at 720p) halves the exploration column if its quality
is enough, but it has no reference images. **Proposed cap: $150** for the
recommended set, which covers twice the assumed takes at the cheap tier. On
Kling instead, the same set costs about the same per second (~$0.09 to $0.18/s
from credit top-ups) plus one month of the Pro membership ($37, $25.99 the
first month, per CloudZero) to get the commercial terms.

---

## 6. Lane B: can any of them feed the art pipeline?

**No for anything drawn in the game world.** The issue's own table argued it
for sprites; the game has no sprites now, and the 3D pipeline closes the
remaining doors more firmly. Each candidate, with the reason it has no
consumer:

| Candidate | Why it does not work here | Evidence |
|---|---|---|
| Animated sprite-like loops | Nothing draws a 2D unit any more; the sprite renderers refuse to write sheets. | WP-A3.3; `tools/sprites_retired.py` |
| Unit or vehicle models | Units are GLBs with clips authored as Python tables and a source beside every mesh. A video is not geometry, has no source to re-export, and image-to-3D (Meshy) already takes a still, so a turntable video adds nothing a multi-view still does not. | `ART_PIPELINE.md` §8, "no binary-only art"; `tools/units/rig.py` |
| Skybox or sky plate | The dimetric camera never sees a sky: the frame behind the ground is a flat `scene.background` colour, and the campaign board renders on a transparent canvas. There is nowhere to put one. | `ThreeRenderer.ts` (`scene.background = new THREE.Color(...)`), the campaign board section of `CLAUDE.md` |
| VFX flipbooks (fire, smoke, dust) | Effects are particle emitters in JSON whose colours must be palette keys ("Raw hex is rejected by CI"). Video has no alpha channel to composite with, and a baked colour stream is the thing the schema exists to prevent. | `data/schemas/vfx_emitter.schema.json` |
| Ground textures | Ground albedo is a seamless still, used as a ratio to its own mean. A still-image generator does this; motion is worthless on the ground. | `terrain/surface.ts`, `SURFACE_SHADING_EXEMPTION` |
| Animated in-world video (TV screens, billboards) | No such surface exists in the game. | |

**Maybe for UI and marketing, which is section 4:** deploy-screen
backdrops (already a live surface), a trailer, store-page clips.

**The one plausible pipeline use, not investigated here: reference motion.**
Infantry clips are partly retargeted mocap (`art/mocap/*.json`, through
`tools/units/mocap.py`). A generated clip of a figure kneeling to fire, run
through markerless pose estimation, could in principle become another JSON in
that directory, which then passes the same gait, hold and ground gates as any
other clip. Nothing here tested that a generated video yields a usable pose
track, at what cost, or under which licence the derived motion falls. It is a
candidate for its own time-boxed spike, after #123's cheaper lane (more frames
through the existing rig) has been taken. It does not close #37 or #44.

**Concept reference** remains allowed and useful: a clip used to decide how a
`.blend` should look, which never ships, needs no provenance row and (since
January 2026) no Steam disclosure.

---

## 7. Risks

1. **The raw output may not be ours to reserve.** In the US a work must have a
   human author: the D.C. Circuit held so in *Thaler v. Perlmutter* and the
   Supreme Court declined review on 2026-03-02
   ([Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2026/03/supreme-court-denies-review-in-ai-authorship-case)),
   and the Copyright Office's January 2025 report treats prompts as
   unprotectable instructions. A purely prompted trailer shot could be lifted
   by anyone. Mitigation: image-to-video from our own renders, a human edit,
   titles and composite; claim the cut, not the frames.
2. **Terms move.** Kling re-issued its paid terms a day before this read;
   Sora's API lasted about a year. Save a PDF of the terms page with each
   batch, and never call a generator at runtime.
3. **Uploading our art licenses it out.** Image-to-video uploads our
   all-rights-reserved renders. Kling (§4.7.1) and Dreamina (§8, perpetual and
   sublicensable) take a licence over inputs; Runway may train on them. The
   paid Gemini API does not use content to train. This alone rules the
   Chinese consumer apps out for anything built from our frames.
4. **Meshy inheritance.** A video made from a render of a Meshy-derived
   building inherits `ASSET_PROVENANCE.md` item 1. Settle item 1 first, or
   make backdrops from frames with no Meshy asset in them.
5. **The setting rule.** Left unspecified, a model fills a Middle-East-like
   town with a real-looking population, real flags and real uniforms. People-free
   prompts and a review checklist (no faces, flags, insignia, real places, or
   text) per clip, before commit.
6. **Combat prompts get filtered.** Veo drops outputs in its Violence and
   Dangerous-content categories with a support code; budget takes for it and
   prompt aftermath (smoke on a ridge, spoil in gravel) rather than fire.
7. **No gate sees video provenance.** `validate_data.mjs` checks that a
   `briefing_video` file exists and nothing else. The two shipped files have
   no recorded generator (item 4), and a commercial build would ship them.
8. **Honesty.** A trailer that cuts cinematic into gameplay unlabelled
   misrepresents the game, and Steam disclosure now covers marketing.

---

## 8. Decisions for the lead

1. **Generator and spend.** Approve the paid Gemini API (a Google Cloud
   billing account in your name; this report opened none) as the one
   generator for cinematics, Omni Flash 1.1 plus Veo 3.1, with a **$150 cap**.
   Seedance stays out until someone reads the BytePlus video terms; Kling only
   as a fallback, on a paid membership, with its terms saved on the day.
2. **Scope.** The intro/trailer plus seven town backdrops, or also the 27
   per-mission backdrops (+~$210), or the intro alone. And confirm the
   title screen keeps the live scene host rather than a video.
3. **The two Tel Marum videos (provenance item 4).** Which tool, plan and date
   made them, and is the AAC track generated? If the answer is Flow on Google
   AI Pro, Google's consumer terms also permit commercial use, but record it;
   if it cannot be established, regenerate them under decision 1 and replace
   them.
4. **A provenance gate for video.** Add `license`, `source`, `generator`
   (tool, model id, plan) and `terms_read` per file, plus a per-file (4 MB) and
   total (20 MB) size budget and a poster frame, checked by `validate:data` the
   way `validate:audio` checks voices, with a `--commercial` mode that drops
   unconfirmed files. And adopt the honesty rule: a cinematic is labelled or
   kept as its own segment in any trailer.
5. **Lane B.** Accept "no for in-game assets" and strike it from #135. Decide
   whether video-to-mocap reference motion is worth a separate, time-boxed
   spike (after #123's cheap lane), or drop it.
