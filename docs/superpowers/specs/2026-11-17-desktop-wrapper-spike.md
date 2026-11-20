# Desktop wrapper spike: Electron, Tauri or NW.js (GH-1418, B5-2)

**Lead ruling (19 Nov 2026): Electron.** The lead chose the wrapper this document recommends (section 4). The other
open questions in section 5 stay open. Nothing here signs, uploads, publishes or registers anything, and no app code
changed.

**The packaged demo build (19 Nov 2026) is section 9**: `pnpm desktop:package` replaced `pnpm desktop:spike`, and
section 7's carry-over list is built there except the two items that need a lead decision. Sections 1 to 8 are the
spike's record as it was written; where they name `desktop:spike`, read `desktop:package`.

- Issue: GH-1418 (the demo: its own appID, a packaged build, a Next Fest registration). No comments and no linked PRs
  at the time of writing (`gh api search/issues "repo:ilan-pinto/roaring-lions 1418 is:pr"` returns nothing).
- Prototype: `pnpm desktop:spike`, now `pnpm desktop:package` (section 9) (`tools/desktop/build-local.mjs` + `tools/desktop/main.mjs`), output in
  `dist-desktop/` (gitignored; eslint already ignores `**/dist-*/**`).
- Conventions: every claim carries its source URL. **(est.)** marks an estimate or inference of mine. **(measured)**
  marks a number from the spike run in section 2, with its conditions. Three documentation hosts were not reachable
  from the session that wrote this (`www.electronjs.org`, `v2.tauri.app`, `webkitgtk.org`); where their pages are
  cited, the text was read from the same docs' GitHub source or from a search-result excerpt, and that is said.

---

## 1. What the game needs from a wrapper (facts from this repository)

These decide the comparison more than any benchmark does.

| Need | Fact in the repo | Consequence |
|---|---|---|
| WebGL2 | The shipping renderer is three.js on WebGL2. WebGPU is a sandbox-only opt-in (`?gpu=webgpu`, `packages/app/src/main.ts` near the `backend:` telemetry field). | WebGL2 is the hard requirement. WebGPU is a "later" requirement. |
| One engine | Every visual gate (`pnpm golden-baseline`), `ui:shots`, `ui:routes` and the perf tools run on Chromium (Playwright). | A wrapper that ships Chromium runs the engine the game is tested on. Any other engine is an untested target. |
| Absolute asset paths | `vite.config.ts` builds with `base: '/'`; chunks, GLBs, textures, audio and the Draco decoder load from `/assets/`, `/meshes/`, `/draco/`... | `file://` breaks every one of them. The wrapper needs a custom scheme (or a local server) whose `/` is the build. |
| Decoders | Draco only: one `draco_decoder.wasm` (with its `draco_wasm_wrapper.js`) in `assets/draco/`, which Vite's `publicDir` (`assets/`, `packages/app/vite.config.ts`) copies to `/draco/`; Rapier's wasm is inlined as base64 in its JS chunk, so the build emits no other `.wasm` (read from the build config and sources, not from a build). 172 GLBs use `KHR_draco_mesh_compression`. No GLB uses `KHR_texture_basisu` and no `.ktx2` ships, so there is **no Basis/KTX2 transcoder to bundle today**. | The scheme must serve `application/wasm` and allow `'wasm-unsafe-eval'` (the CSP in `assets/_headers` already does). |
| Audio | `audio.ts` plays OGG Vorbis first and falls back to `.m4a` only when OGG is unplayable. | Any Chromium plays OGG; the 5.64 MiB (5.9 MB) of `.m4a` is dead weight in a Chromium bundle (not pruned by the spike). |
| Network | Telemetry, accounts and feedback call relative `/api/...` and switch off on a `*.local` host (`telemetry/enabled.ts` `LOCAL`, `account/enabled.ts`, `feedback/gate.ts`). Versus rooms are **not** gated: the lobby opens a room with `origin: location.origin` (`packages/app/src/main.ts`, the `versusDeps.open` call) and `net/connect.ts` POSTs `${origin}/api/match` whatever the host. | The spike's origin is `app://roaring-lions.local`, so telemetry, accounts and feedback stay off with no app change. A versus room's POST lands on the bundle's own scheme, which answers every `/api/` path with a 404 (`tools/desktop/resolve.mjs`), so the lobby fails cleanly instead of reading `index.html`. The menu still offers versus (`ui/menu.ts` adds it unconditionally): the demo build must hide or disable it explicitly (open question 3, section 7). |
| Size | `pnpm build` output: 180.4 MiB of file bytes as staged (section 2); `du -sh packages/app/dist` read 183M, which is allocated disk blocks in MiB (every file rounded up to a block), not bytes. By the same `du`: meshes 109M, assets (JS/wasm) 28M, ui 20M, audio 14M, textures 8.6M. | The game payload, not the runtime, dominates any installer. |

## 2. What the spike built and measured

`pnpm desktop:spike --smoke` (Electron 45.2.1, `@electron/packager` 20.3.0, linux-x64, asar off, no signing):

| Measure | Value | Conditions |
|---|---|---|
| Staged web build | 180.4 MiB | `packages/app/dist` at `e049ba7` (origin/dev), copied unchanged |
| Bundle on disk | **453.8 MiB** (Electron runtime 273.4 MiB + game 180.4 MiB) | `dist-desktop/out/Roaring Lions-linux-x64/` |
| `tar.gz` of the bundle (installer stand-in) | **275.0 MiB** (runtime 118.0 MiB + game 156.9 MiB, compressed separately) | `tar -czf`, gzip default level |
| Headless launch | **PASS**: `app://roaring-lions.local/` loaded, title "Roaring Lions", secure context, WebGL2 context created, the menu diorama drew (screenshot `dist-desktop/smoke.png`), **0 console errors** | Xvfb 1600x900x24, 4-core container, no GPU: WebGL on ANGLE/SwiftShader (Vulkan 1.3.0, SwiftShader driver), Chromium 156.0.8078.75, `--no-sandbox` because the container runs as root |
| WebGPU | `navigator.gpu` present, `requestAdapter()` returned null | Same: no GPU, so this says nothing about real hardware |
| Deep routes | `/free-play` and `/mission/beit_sahwan_0_tutorial` both loaded through the SPA fallback; the tutorial's briefing drew its ground photograph (the battlefield renderer booted), 0 console errors | Same, 40 s settle |

All numbers are **(measured)** once on the conditions above; SwiftShader is a software rasteriser, so none of this is a
performance number.

**The gate was watched going red** (CLAUDE.md, "every check gets an input that makes it fail"), each mutation run
against the packaged bundle and then restored:

1. `web/index.html` removed: `RL_SMOKE pass:false, reason did-fail-load -9 ERR_UNEXPECTED`, exit 1.
2. The two SwiftShader switches deleted from the bundled `main.mjs`: `webgl2:false, pass:false`, exit 1 (the game
   itself fell back to its flat menu plate with no console error, which is the intended no-WebGL path).
3. Restored: `pass:true`, exit 0.

Observed, cause not investigated: `--disable-webgl` and `--disable-3d-apis` passed on the Electron command line did
**not** disable WebGL (the probe still read `webgl2:true`). A Chromium switch the game needs on Steam (for the
overlay, section 3.5) should be appended in `main.mjs` with `app.commandLine.appendSwitch`, not left to a launch
option.

How the prototype serves the build (`tools/desktop/main.mjs`): a privileged standard scheme
(`protocol.registerSchemesAsPrivileged`, `standard`/`secure`/`supportFetchAPI`/`corsEnabled`/`stream`) and
`protocol.handle` returning files from the bundled `web/` through `net.fetch(pathToFileURL(...))`, with a path-escape
guard, explicit MIME types, the `_headers` CSP applied to every response, a 404 for every `/api/` path, and `index.html`
for any other extension-less path (the router's screens); the path rules are the pure `tools/desktop/resolve.mjs`,
tested in `tools/src/desktop_serve.test.ts`. This is the pattern Electron's own protocol doc shows: "Registering a
scheme as standard allows relative and absolute resources to be resolved correctly when served", and its `app://`
example serves a bundle with `net.fetch(pathToFileURL(pathToServe).toString())` behind a check "for paths that escape
the bundle" (https://github.com/electron/electron/blob/main/docs/api/protocol.md). Service workers are deliberately not
allowed on the scheme: the files are already on disk, and `registerServiceWorker` warns and carries on (its documented
contract). The window runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no preload.

## 3. The comparison

### 3.1 Installer and on-disk size

| | Runtime cost | With this game (180 MiB payload) |
|---|---|---|
| Electron | 273.4 MiB on disk, 118.0 MiB gzipped **(measured, linux-x64, 45.2.1)**. Community empty-app benchmark: about 263-266 MB on Windows x64 and Linux x64 (https://github.com/Elanis/web-to-desktop-framework-comparison, read through a search excerpt). | 454 MiB on disk, 275 MiB `tar.gz` **(measured)** |
| Tauri | About 1-2 MB for an empty app in the same benchmark (same URL); other same-app comparisons put Tauri installers in single- to low-double-digit MB against Electron's 85-320 MB (https://hackernoon.com/six-months-with-tauri-the-benefits-and-the-bill, https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/). The Tauri docs give no number ("by default provides very small binaries", https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/concept/size.mdx). | About 185-200 MiB on Windows/macOS **(est.)**. On Linux under Steam it would have to carry its own WebKitGTK (3.2), which takes most of the advantage back **(est.)**. |
| NW.js | About 404-474 MB for an empty app in the same community benchmark (same URL). | About 590-650 MiB on disk **(est.)** |

Reading: the runtime is 118 MiB of a 275 MiB download for Electron **(measured)**. Tauri saves that 118 MiB at most;
the game's own 157 MiB (compressed) is the floor for every option. Steam downloads compressed chunks and patches by
chunk, so a later update costs what changed, not the whole bundle **(est.**: the only passage read, through a search
excerpt of https://partner.steamgames.com/doc/sdk/uploading, is "SteamPipe is the game/application content system that
powers Steam", which does not say how it downloads or patches**)**.

### 3.2 WebGL2 and WebGPU

| | WebGL2 | WebGPU |
|---|---|---|
| **Electron** (bundled Chromium; 45.2.1 = Chromium 156, measured) | Chromium's, on every OS: the engine every gate runs. **(measured** on SwiftShader above). | Follows Chromium: shipped on Windows, macOS and ChromeOS since 113; on Linux shipped for Intel Gen12+ (144) and NVIDIA 535.183.01+ on Wayland (147), other Linux "behind a flag" (`--enable-unsafe-webgpu`) (https://github.com/gpuweb/gpuweb/wiki/Implementation-Status, edited 2 Oct 2026). Electron can append that flag itself. Steam Deck (AMD, Linux) is in the flag group **(est.** from the table**)**. |
| **Tauri, Windows** (WebView2, Chromium-based) | Chromium's, evergreen: "WebView2 can update itself, you are guaranteed a relatively recent chromium build on all Windows targets" (https://v2.tauri.app/reference/webview-versions/, read through a search excerpt). | Works when `--enable-unsafe-webgpu` is injected through `additionalBrowserArgs`, "Windows-only" (Tauri maintainer, https://github.com/tauri-apps/tauri/issues/6381). |
| **Tauri, macOS** (WKWebView) | WebKit's, tied to the OS: "unsupported macOS versions do not receive WebKit updates" (same webview-versions page, search excerpt). | Safari/WebKit ships WebGPU in the 26 releases (gpuweb status page above). Tauri maintainer: it "should work out of the box on macos/ios 26+"; a user reports it works in production builds but not dev builds (issue 6381). Nothing before macOS 26. |
| **Tauri, Linux** (WebKitGTK, the distro's version) | WebKitGTK's, whatever the distro ships. Tauri's own Linux graphics page says WebGL "can silently land on a slow path", that NVIDIA setups range from a blank window to subtle problems (the workaround, `WEBKIT_DISABLE_DMABUF_RENDERER`, "disables a faster path for everyone"), and that `WEBGL_debug_renderer_info` reports "Apple GPU" on every Linux machine (https://v2.tauri.app/develop/debug/linux-graphics/, search excerpt). That last one blinds this game's software-renderer notice (`ui/no-gpu.ts` reads the unmasked renderer string). An open WebKit bug reports slow WebGL framerates on GTK (https://bugs.webkit.org/show_bug.cgi?id=278695). | Not listed at all on the gpuweb status page; Tauri maintainer, asked whether it would be supported for "wkwebview/webkitgtk": no (issue 6381). Treat as absent **(est.)**. |
| **NW.js** (bundled Chromium; v0.120.0 = Chromium 157, 12 Nov 2026, https://github.com/nwjs/nw.js) | Chromium's, every OS. | Follows Chromium, as Electron. |

Reading: Electron and NW.js give one engine and one WebGL2 on all three OSes. Tauri gives three engines, two of
which (WKWebView, WebKitGTK) nothing in this repository has ever been tested on, and one of which (WebKitGTK) is
documented by Tauri itself as the weak spot for WebGL. A Tauri maintainer, asked whether Electron is the better
option for cross-platform WebGPU, answered "yes" (issue 6381).

### 3.3 Offline assets (the Vite `dist`, GLB, audio, Draco)

- **Electron**: proved by the spike, with zero app changes: a privileged `app://` scheme serves the untouched build,
  absolute paths resolve, the Draco wasm decodes, the router's paths fall back to `index.html` (section 2).
- **Tauri**: serves the frontend from its own custom protocol by default (an assumption from Tauri's architecture,
  not verified in this session: the Tauri docs host was unreachable) **(est.)**. Absolute paths would resolve the same
  way. Untested here; the risk is not the protocol but the engines in 3.2. WKWebView's OGG support is not verified
  here; the `.m4a` fallback covers it.
- **NW.js**: can load the app from the package directory; with Node in the page there are more ways to read files,
  but the same absolute-path issue applies and needs the same answer **(est.)**. Its prebuilt binary also ships
  without patented codecs: "Due to licensing issues, the pre-built binary doesn't ship with the necessary codecs for
  patented media formats" (https://github.com/nwjs/nw.js/wiki/Using-MP3-&-MP4-(H.264)-using-the--video--&--audio--tags.).
  This game plays OGG Vorbis, which that list includes, so it costs nothing here.

### 3.4 Licence

| | Licence | Note |
|---|---|---|
| Electron | MIT (https://github.com/electron/electron) | The bundle carries Chromium's third-party notices (`LICENSES.chromium.html`, 5.4 MiB, measured in the bundle) and must keep shipping it. |
| Tauri | "MIT or MIT/Apache 2.0 where applicable" (https://github.com/tauri-apps/tauri) | The system webview is not redistributed (except WebKitGTK on Linux if bundled, LGPL **(est.)**). |
| NW.js | MIT for the repository code; redistributing the binary "is covered separately in the wiki" (https://github.com/nwjs/nw.js) | Patented codecs need a self-built ffmpeg, and the wiki warns that GPL ffmpeg codecs would pull the app under the GPL (wiki page above). |

None conflicts with the game's PolyForm Noncommercial licence for the source **(est.;** a lead/legal call for the
commercial demo**)**. `@electron/packager` is BSD-2-Clause (its `package.json` `license` field, read in this session); it is a
build tool and is not in the shipped bundle.

### 3.5 Steamworks hookup

| | Binding | Overlay |
|---|---|---|
| **Electron** | `steamworks.js`, MIT, "A modern implementation of the Steamworks SDK for HTML/JS and NodeJS based applications" that replaces greenworks (https://github.com/ceifa/steamworks.js). `greenworks`, MIT, Steamworks SDK v1.62, Electron v1.0.0+, "maintained on a best-effort basis" (https://github.com/greenheartgames/greenworks). | `require('steamworks.js').electronEnableSteamOverlay()` at the end of `main.js` (steamworks.js README). Community notes add `in-process-gpu` and `disable-direct-composition` switches; reports conflict on whether both are still needed (https://github.com/ceifa/steamworks.js/issues/95, https://github.com/JamesMoulang/electron-steam-notes, via search excerpts). Needs testing on real GPUs. |
| **Tauri** | `steamworks-rs`, MIT/Apache-2.0, crate 0.13.0 on SDK 1.64 (https://github.com/Noxime/steamworks-rs). | **The overlay does not hook WebView2.** WebView2 runs as a child HWND and "does not create a D3D Device in the application process"; Steam only adds the overlay for rendering in the main process, and `--in-process-gpu` alone was not enough (Microsoft and Construct, https://github.com/MicrosoftEdge/WebView2Feedback/discussions/4019). Construct's WebView2 workaround works only with an opaque background and breaks Steam Recordings, Remote Play and Broadcast (https://construct.net/en/blogs/ashleys-blog-2/trying-show-steam-overlay-1861). A third-party fix was posted in July 2026 and is unverified (same discussion). |
| **NW.js** | greenworks (built for NW.js first, above). | Same Chromium process model as Electron; the overlay is reported to work for Chromium-based NW.js and Electron, not WebView2 (Construct, same blog, search excerpt) **(est.** for current versions**)**. |

Security note for Electron: steamworks.js's README tells you to set `contextIsolation: false` and
`nodeIntegration: true` so the renderer can `require` it. That is not necessary: keep the page sandboxed, call
steamworks.js from the main process, and expose the handful of calls (achievements, overlay, user) through a preload
with `contextBridge` **(est.;** the design choice for the real integration, not tried in the spike**)**.

Linux under Steam: Steam-launched Electron apps have been reported to fail at startup because the Steam Linux
Runtime's sandbox collides with Chromium's, with `--no-sandbox` as the usual workaround (community reports,
https://docs.hagicode.com/en/faq/steam-linux-startup/ and https://steamcommunity.com/app/1675200/discussions/1/3416557114747120335,
via search excerpts). A Tauri Linux build has the opposite problem: it links against the system `libwebkit2gtk-4.1`,
which the Steam Linux Runtime container is not known to provide (SteamOS does not ship WebKit2GTK, per a search
excerpt from the same search) **(est.)**, so it would have to bundle WebKitGTK.

### 3.6 Auto-update

On Steam, **Steam is the updater**: a build uploaded through SteamPipe and set live on a branch reaches players
through the client ("Once your update is live, players will see the game update in their Steam client",
https://partner.steamgames.com/doc/store/updates, search excerpt). The demo needs no in-app updater, and the spike
ships none. For an off-Steam download later:

- Electron: built-in `autoUpdater` on macOS (Squirrel.Mac) and Windows (Squirrel.Windows or MSIX); "There is no
  built-in support for auto-updater on Linux"; "Your application must be signed for automatic updates on macOS"
  (https://github.com/electron/electron/blob/main/docs/api/auto-updater.md).
- Tauri: `tauri-plugin-updater` on Windows, macOS and Linux (AppImage), from a static JSON or a server; its own
  update signature is mandatory and "cannot be disabled", and losing the private key strands existing installs
  (https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/updater.mdx).
- NW.js: nothing built in; third-party `nwutils/updater` (https://github.com/nwutils/updater); the older
  `nwjs-builder-phoenix` is read-only since February 2021 (https://github.com/codekiln/nwjs-builder-phoenix, search
  excerpt).

### 3.7 Code signing

The same for all three, because it is an OS rule, not a wrapper rule:

- **macOS**: sign with an Apple Developer certificate and notarise; "Squirrel.Mac requires the app to be signed for
  automatic updates to work at all" (https://github.com/electron/electron/blob/main/docs/tutorial/code-signing.md).
  Steam's platform page states Steam "will require all new macOS Applications to be 64-bit and notarized by Apple"
  from 14 Oct 2019 (https://partner.steamgames.com/doc/store/application/platforms, search excerpt); developers
  disagree on whether it is enforced (https://ebitengine.org/en/blog/steam.html), so treat it as required.
  Needs a Mac for the build step **(est.)** and an Apple Developer Program membership.
- **Windows**: OV certificates no longer help ("Windows will treat your app as completely unsigned"); EV certificates
  live on hardware; Microsoft's cloud signing (Azure Artifact Signing) is "the cheapest option for code signing on
  Windows, and it gets rid of SmartScreen warnings", available in certain countries (Electron code-signing doc above).
  A Steam-installed Windows game is not downloaded through a browser, so SmartScreen's download check should not
  fire; an unsigned Steam build is common **(est.**, not verified against a Valve requirement**)**.
- **Linux**: no OS signing. Steam verifies its own depots.

Electron's tooling covers all of this (`@electron/osx-sign`, `@electron/notarize`, `@electron/windows-sign`, already
in the packager's dependency tree); Tauri has its own signing guides (not read: host unreachable); NW.js has none
first-party (the nwjs-builder-phoenix signing feature was never finished, search excerpt above).

## 4. Recommendation

**Electron**, for the demo and the game. The lead ruled for Electron on 19 Nov 2026.

1. It ships the engine the game is tested on. Every visual gate, capture and perf number in this repository is
   Chromium; Electron puts that same Chromium on Windows, macOS, Linux and the Deck. Tauri would put three engines
   under the game, two never tested, one (WebKitGTK) documented by Tauri itself as a WebGL problem and blind to the
   renderer string the game's no-GPU notice reads.
2. The Steam overlay works with it (with switches to test), and does not work with Tauri's Windows webview without a
   workaround that breaks Steam Recordings and Remote Play. Windows is the demo's target (GH-1418: "a Windows
   executable installs and starts from the Steam client").
3. It works today with no app change: the spike's bundle loads the menu, the free-play picker and a mission briefing
   offline from a custom scheme with zero console errors **(measured)**.
4. Tauri's one real advantage, size, is about 118 MiB compressed against a 157 MiB game that every option must ship,
   and Steam patches by chunk **(est.,** section 3.1**)**. NW.js gives the same engine as Electron with a larger
   runtime, no first-party packaging, signing or update tooling, and a weaker maintenance story for its Steam binding.

Costs to accept: about 118 MiB more download and 273 MiB more disk than the game itself **(measured, Linux)**, more
RAM than a system webview **(est.)**, and an upgrade duty: Electron releases a major every 8 weeks and supports the
latest three ("The latest three _stable_ major versions are supported",
https://github.com/electron/electron/blob/main/docs/tutorial/electron-timelines.md), so a shipped build must be
re-packaged on a schedule to stay inside security support.

## 5. Open questions for the lead

1. **The choice itself.** Answered: the lead ruled for Electron on 19 Nov 2026.
2. **Platforms for the demo.** Windows only (the issue's done-line), or Windows + Linux native for the Deck? A
   Windows Electron build under Proton is the other Deck path; untested **(est.)**.
3. **Should the desktop build talk to the Worker?** The spike's `*.local` origin keeps telemetry, accounts and
   feedback off, which is right for an offline demo. Versus rooms are not behind that gate: the lobby POSTs
   `${location.origin}/api/match`, the bundle's scheme answers it with a 404, and the lobby fails cleanly, so "Play
   with a friend" cannot reach a room, yet the menu still offers it. **Open for the real build:** the demo must hide
   or disable versus explicitly (an app change, out of this spike's scope). Turning any of them on needs an absolute
   API origin in the app (also an app change) and a decision on what a Steam build may send (privacy page,
   `?notrack`).
4. **The Steam overlay switches** (`in-process-gpu`, `disable-direct-composition`): their frame cost and whether
   both are still needed must be measured on real Windows hardware with the overlay on.
5. **Signing money and accounts.** Apple Developer Program (if macOS ships), and whether the Windows demo is signed
   at all (Azure Artifact Signing is the cheapest route the Electron doc names). Both are lead actions.
6. **Linux sandbox under Steam.** Reported collisions between the Steam Linux Runtime and Chromium's sandbox; the
   spike ran `--no-sandbox` only because the container is root. The real build needs a decision and a test on a Deck.
7. **Bundle trimming.** Drop the 5.64 MiB (5.9 MB) of `.m4a` (Chromium plays the OGG), `sw.js` and `_headers` from the
   desktop copy; consider asar for the code and loose files for the assets. Not done: the spike copies the build
   unchanged.
8. **Commercial gate.** The demo ships only assets that pass the commercial gate (GH-1418 constraint); the spike
   bundles the whole `dist`. A demo build needs a filtered asset set and the demo slice's routes only.

## 6. What a Windows or macOS build would add (not run)

- Windows: the same staging, `platform: 'win32'` in the packager call, plus a Squirrel or NSIS/MSI maker if an
  installer is wanted outside Steam (for Steam, the packaged folder is the depot content), and `@electron/windows-sign`
  with a certificate (open question 5).
- macOS: `platform: 'darwin'`, `@electron/osx-sign` + `@electron/notarize` with Apple credentials, run on a Mac.
- Steam: `steamworks.js` (pinned) in the main process, the SDK's redistributable `steam_api` library next to the
  executable (steamworks.js README), `steam_appid.txt` for local runs, the overlay switches, then a SteamPipe
  `app_build` script per depot. None of it is in the spike, because each needs the demo appID or a secret.

## 7. Carry into the real demo build

The spike leaves these out on purpose; the demo build must not. **Built in section 9** except the last item (versus),
which needs a lead decision:

- **Permissions denied by default**: `session.setPermissionRequestHandler` and `setPermissionCheckHandler` answer no to
  everything the game does not use (camera, microphone, geolocation, notifications, ...).
- **`shell.openExternal` allow-listed by host**: today any `https://` URL from `window.open` reaches the player's
  browser; the demo opens only the hosts it names (the feedback issue's `github.com`, the store page).
- **Fail closed on a missing `_headers` or CSP**: `staticHeaders()` returns `{}` when the file is absent, so the page
  would run with no Content-Security-Policy. The real build refuses to start (or to package) without it.
- **Smoke mode gated at build time**, not by the `RL_DESKTOP_SMOKE` runtime variable: a shipped binary must not be
  switchable onto SwiftShader or a scripted run by its environment.
- **Electron fuses and asar integrity**: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` and
  `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` on (which means
  shipping an asar, open question 7).
- **The Electron download pinned**: `download.checksums` in the packager call, or the build clears
  `ELECTRON_MIRROR` / `npm_config_electron_mirror` so a mirror set in the environment cannot supply the runtime.
- **Versus disabled or hidden in the demo** (open question 3): today the lobby reaches the bundle's 404 and fails
  cleanly, which is a fallback, not a design.

## 8. Running the spike

Superseded by section 9: the command is now `pnpm desktop:package`.

## 9. The packaged demo build (GH-1418, 19 Nov 2026)

LOCAL BUILD ONLY. Nothing here signs, notarises, uploads, publishes, registers or auto-updates, and nothing reads a
secret. No app code changed: the bundle carries `packages/app/dist` exactly as `pnpm build` makes it.

### 9.1 Building it

```bash
pnpm desktop:package                                # pnpm build, then package, fuse and tar the Linux bundle
pnpm desktop:package --skip-build --smoke           # reuse packages/app/dist; then the two launch checks (9.3)
pnpm desktop:package --skip-build --report-commercial --no-tar   # also count the files the commercial gate fails
```

Output, all in `dist-desktop/` (gitignored; eslint ignores `dist-*/`): `shipped/Roaring Lions-linux-<arch>/` (run
`roaring-lions` in it), `roaring-lions-linux-<arch>.tar.gz`, and with `--smoke` `smoke.json` and `smoke.png`. The
Electron zip is cached in `dist-desktop/cache/`. Nothing in `dist-desktop/` is ever committed; delete it when done (it
is about 1 GB after a `--smoke` run). The script is Linux only and refuses another host.

What the script does, in order (`tools/desktop/build-local.mjs`):

1. `pnpm build` with `VITE_BASE` cleared (the scheme maps `/` to the build).
2. Reads the demo content cut (`tools/desktop/demo.json`, 9.4) and refuses a build whose `_headers` has no
   Content-Security-Policy for `/*`.
3. Stages the code (`main.mjs`, `policy.mjs`, `resolve.mjs`, a `package.json`, and a `desktop-build.json` manifest with
   the version, commit, Electron version and the `smoke` flag) and packages it with `@electron/packager` 20.3.0 into
   `resources/app.asar`; the web build goes beside it as loose files in `resources/web/` (`extraResource`), so a depot
   diff or a patch moves only the files that changed.
4. Downloads Electron 45.2.1 through `@electron/get` against SHA-256 sums pinned in `policy.mjs` (`ELECTRON_SHA256`,
   from the release's SHASUMS256.txt), with `ELECTRON_MIRROR` and its relatives cleared, so neither a mirror nor a
   swapped release asset can supply the runtime.
5. Flips all nine Electron fuses (`policy.mjs`'s `FUSES`, `@electron/fuses` 2.1.3, pinned) and reads the wire back,
   refusing a binary whose wire differs and a fuse list that differs from the library's.
6. Writes the tarball, the stand-in for a depot or an installer.

### 9.2 The security policy

Every rule is data or a pure function in `tools/desktop/policy.mjs`; `main.mjs` only wires it into Electron.
`tools/src/desktop_policy.test.ts` pins each rule with literal oracles AND reads `main.mjs` and `build-local.mjs`
(comments stripped) for the wiring, because neither can run under vitest.

| Rule | Where |
|---|---|
| `contextIsolation: true`, `nodeIntegration: false` (and in workers and subframes), `sandbox: true`, `webSecurity: true`, no insecure content, no `<webview>`, no preload | `WEB_PREFERENCES`, the only `webPreferences` in `main.mjs` |
| Every renderer sandboxed (`app.enableSandbox()`), unless the launch already passed `--no-sandbox` | `main.mjs` (see 9.3 for why) |
| Navigation and redirects stay on `app://roaring-lions.local`; no `<webview>`; for EVERY web contents | `isAppUrl`, `lockDown` on `web-contents-created` |
| A link opens in the player's browser only over `https:`, to an exact host on the allow-list (`github.com`, `threejs.org`, `rapier.rs`, `creativecommons.org`: the Credits screen's links; a test fails when a credit links another host), no credentials or port | `EXTERNAL_HOSTS`, `externalUrlAllowed` |
| Permissions: only `fullscreen` (the settings toggle) and `clipboard-sanitized-write` (copying a share code or public id), only for the bundle's own origin; device permissions refused | `ALLOWED_PERMISSIONS`, `permissionAllowed` |
| No CSP, no page: package time AND launch refuse a `_headers` without one | `requireCsp` |
| No application menu (no reload, devtools or zoom accelerators) | `main.mjs` |
| Fuses: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`, `LoadBrowserProcessSpecificV8Snapshot`, `GrantFileProtocolExtraPrivileges` off; `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`, `WasmTrapHandlers` on; `EnableCookieEncryption` off (the game keeps no cookies, and on Linux it asks the desktop keyring, which can prompt) | `FUSES` |
| The smoke run (SwiftShader switches, a scripted probe, a forced exit) only in a bundle PACKAGED as a smoke bundle (`desktop-build.json` `smoke: true`) AND asked for by `RL_DESKTOP_SMOKE=1`; the shipped bundle ignores the variable | `smokeAllowed` |

**The page's host, and telemetry.** The page runs at `app://roaring-lions.local`. The app's host gate
(`telemetry/enabled.ts`'s `LOCAL`, shared by `account/enabled.ts` and mirrored by `feedback/gate.ts`) reads `*.local`
as this machine, so the packaged build sends no telemetry, never reaches `/api/account/*` and never posts feedback.
`desktop_policy.test.ts` runs the three gates on the desktop host (off) and on the deployed host (on), so a gate that
read "off" for every input would fail it. Since the lead's ruling of 20 Nov 2026 the three player-facing helpers ask
the OTHER half of "a real host", `packages/app/src/shell/player-host.ts`'s `playerHost` (the deployed host, or the page
at `app:` + `roaring-lions.local` in a production build), so a desktop player gets the software-renderer notice
(`ui/no-gpu.ts`, and its one-line twin `ui/software-hint.ts`), the slow-frames Low suggestion (`ui/quality-hint.ts`)
and What's new opening on its own (`ui/whats-new.ts`). Telemetry, accounts and feedback keep the networked rule and
stay off. `shell/player-host.test.ts` runs all six gates on the web host, the desktop page, dev/CI and a production
build on localhost.

### 9.3 What was run (19 Nov 2026)

`pnpm desktop:package --smoke --report-commercial` at `a002916f3` (dev), then `--skip-build` re-runs; linux-x64,
Electron 45.2.1 (Chromium 156.0.8078.75), 4-core container, no GPU, Xvfb 1600x900x24, root, so `--no-sandbox`:

| Measure | Value **(measured)** |
|---|---|
| Web build staged | 181.9 MiB |
| Shipped bundle on disk | 455.3 MiB (runtime 273.4 MiB, `resources/` 182.0 MiB) |
| `tar.gz` | 275.8 MiB |
| Shipped bundle launch, its environment asking for the smoke run | `RL_DESKTOP_READY {"href":"app://roaring-lions.local/","smoke":false,...}`: started, served the menu, ignored the variable |
| Smoke bundle | PASS: title "Roaring Lions", secure context, WebGL2 on SwiftShader, the menu diorama drew, 0 console errors; from inside the page: no `require`/`process`/`module`, `geolocation` and `notifications` `denied`, of three `window.open` calls only the allow-listed `https://github.com/...` would have opened, `location.assign('https://example.com/')` left the page on `app://roaring-lions.local/` |
| The same smoke bundle as user `nobody`, NO `--no-sandbox` (so `app.enableSandbox()` ran) | PASS, the same readings |
| Commercial gate (report only) | 26 files under `assets/` fail it, all 26 in the build, 11.4 MB (`tools/commercial_asset_cut.py`, GH-1415). NOT stripped. |

`app.enableSandbox()` is skipped when the command line carries `--no-sandbox`: the first run called it
unconditionally, and as root with `--no-sandbox` the network service crash-looped ("Running as root without
--no-sandbox is not supported", 3,131 times in 90 s) and the page never loaded. With `--no-sandbox` Chromium's sandbox
is off whatever the app says; the same collision is the one reported for the Steam Linux Runtime (question 6).

**Watched going red** (each a one-line mutation, run, then restored by copy and `cmp`):

- `desktop_policy.test.ts`, 22 mutations, 22 red: each of `contextIsolation`, `nodeIntegration`, `sandbox` flipped in
  `WEB_PREFERENCES`; `main.mjs` overriding `webPreferences`; `enableSandbox` removed; `externalUrlAllowed` returning
  true or accepting subdomains; `isAppUrl` ignoring the host; navigation not refused; `openExternal` on any URL; `HOST`
  not `.local`; every permission granted; device permissions granted; `requireCsp` never throwing; `main.mjs` ignoring a
  missing CSP; `smokeAllowed` ignoring the manifest; `main.mjs` reading the variable alone; the shipped bundle packaged
  as a smoke bundle; `RunAsNode` on; no asar; no checksum pin; a non-null demo cut accepted.
- The packaged smoke check, one run with four mutations in `main.mjs` (Node in the page with isolation and sandbox off;
  every permission check granted; every `window.open` passed out; navigation not refused): FAIL, with
  `noNodeInPage`, `permissionsDenied`, `externalOnlyAllowListed` and `navigationRefused` each `false`
  (`node: true`, `geolocation: granted`, three URLs out, `afterNavigate: https://example.com/`).
- The shipped-bundle check with the shipped bundle packaged `smoke: true`: FAIL (`ready.smoke` true), exit 1.
- `_headers` moved out of `packages/app/dist`: the package step refused ("no Content-Security-Policy"), exit 1.

### 9.4 The demo content cut (the lead's ruling of 20 Nov 2026)

The demo plays the tutorial plus Beit Sahwan I to IV: `beit_sahwan_0_tutorial`, `beit_sahwan_1_recon`,
`beit_sahwan_2_foothold`, `beit_sahwan_3_clearance`, `beit_sahwan_4_subterranean` (GH-1379's slice). First Light
(`beit_sahwan_breach`), which opens the town in the full campaign, is not one of I to IV, so in the demo the town opens
on I. The one config point is `tools/desktop/demo.json`; `readDemoConfig` checks every id against data/missions, no
duplicates, non-empty (`null` still means the whole build).

How it reaches the app: `build-local.mjs` passes the list to `pnpm build` as `RL_DEMO_MISSIONS`;
`packages/app/vite-plugin-demo-cut.ts` bakes it in as the build-time constant `__DEMO_MISSIONS__` (`null` in every
other build, the deployed web game included) and writes `demo-cut.json` beside `index.html`; `checkBundleCut` refuses a
bundle whose file does not match `demo.json` (a `--skip-build` over a full build is caught). The app reads the constant
through ONE module, `packages/app/src/shell/demo-cut.ts`:

- the campaign world is cut to those missions (one town pin, Beit Sahwan I to IV; the other regions read "no
  operations yet") and marked `cut`, so it is never a won war (`@lions/economy`'s `campaignComplete`: no closing
  exchange, no "every front is closed" line, no campaign coin bonus). The menu's Continue, the board's Next and the
  debrief's next mission read it, so there is no next mission after IV;
- `/mission/<id>` and `/briefing/<id>` outside the cut leave softly for the campaign board (deep links, `?mission=`);
- Free play is closed (it has no mission set and fields the full task force on any map): no menu entry, and
  `/free-play`, `/free-play/<map>`, `?sandbox=` leave for the menu. A versus room's `/free-play/<map>?net=` is untouched:
  hiding versus on desktop is not approved by the lead (20 Nov, ruling 3);
- a saved mission outside the cut is refused as one this build does not ship (the Resume row offers Discard).

Not done: the asset set is not filtered (every mission's JSON and every map still ship in the bundle). Not approved by
the lead (20 Nov, ruling 3), and not done: hiding versus on desktop, the commercial strip (9.3's 26 files, GH-1415) and
a Windows build.

Telemetry, accounts and feedback are untouched by this change and keep their own gates (`telemetry/enabled.ts`,
`account/enabled.ts`, `feedback/gate.ts`; their local-host patterns differ, so they are not one function). Only the
four helper call sites read `playerHost` (`ui/no-gpu.ts`, `ui/quality-hint.ts` and its inline twin in `main.ts`,
`ui/whats-new.ts`).

### 9.5 Untested, open, and next

- **Windows and macOS: not built, not run.** The packager call differs by `platform` (`win32` cross-builds from Linux
  through `resedit`; `darwin` needs a Mac for signing), and `ELECTRON_SHA256` would gain those zips' sums. The
  `EnableEmbeddedAsarIntegrityValidation` fuse is only enforced on Windows and macOS, where the packager embeds the
  hash; it has never been launched there. GH-1418's done-line is a Windows executable: that is the next build.
- **Linux asar integrity**: Electron validates it on Windows and macOS only, so the Linux bundle's `app.asar` is not
  integrity-checked.
- **Versus** (question 3): the menu still offers Play with a friend; the lobby reaches the scheme's `/api/` 404 and
  fails cleanly. Hiding it is an app change and a lead call.
- **Notices** (9.2): built 20 Nov; the three helpers count the desktop build as a real host, telemetry does not.
- **In-app licence links**: the Credits screen opens a library's bundled licence text with `target="_blank"` on the
  app's own origin; the window-open handler drops it (it is not an external https link), so the link does nothing on
  desktop. The URI stays readable on the screen.
- **Crash reporting** (GH-1414): built, off unless packaged with `--crash-reports`, and the Worker endpoint is closed
  until the lead opens it. See 9.6.
- Real GPU, Steam overlay switches, Steam Linux Runtime and the Deck: questions 2, 4 and 6, unchanged.
- Not trimmed (question 7): the `.m4a` fallbacks and `sw.js` still ship.

### 9.6 Crash reports (GH-1414, 19 Nov 2026)

The lead's rulings: no third-party service (our own Worker, the `/api/feedback` pattern); no personal data.

**No minidump.** Electron's `crashReporter` is never started. A minidump is a copy of process memory, which holds save
data, text the player typed and file paths; scrubbing one is not possible. What is sent is a small whitelisted JSON
record, `data/schemas/crash_report.schema.json`, built by `tools/desktop/crash.mjs`:

| Field | What |
|---|---|
| `kind` | `renderer_gone`, `child_gone` (GPU, utility), `main_exception`, `main_rejection`, `page_exception`, `page_rejection` |
| `reason`, `exitCode`, `process`, `service` | a process that went away: Electron's reason (`crashed`, `oom`, ...; a clean exit is no report), its exit code, its type and service name |
| `name`, `message`, `stack` | a JavaScript error: its class name, ONE line scrubbed by rule (the twin of the app's GH-1410 scrubber, pinned on its corpus), and up to 16 frames `fn (where:line:col)` |
| `version`, `commit`, `electron`, `chrome`, `platform`, `arch` | from `desktop-build.json` and `process` |
| `gpu` | the graphics card's FAMILY (`gpuFamily`, the twin of `@lions/data`'s), never its raw string |
| `screen`, `mission` | the page path's first segment, and the mission id on `/mission/<id>`; no query |
| `launch`, `uptimeS`, `t` | a random id made at launch and kept in memory only (it groups one launch's reports), seconds since launch, the clock |

A stack location is only ever `web/<path>` (the page's own file: `app://roaring-lions.local/` and any query dropped),
`asar/<path>` (the main process's own file: everything up to `app.asar/` dropped, so the install directory and the user
name in it never leave), `node:<module>`, `<native>` or `<other>`. The Worker refuses a frame of any other shape, and a
message that still holds an email, a URL, a path of two segments or more, a drive path or a UNC share (the second lock).

**How each kind is seen, with nothing added to the page.** `app.on('render-process-gone')` and `child-process-gone`;
`process.on('uncaughtExceptionMonitor')` for the main process (it observes and changes nothing, and also sees unhandled
rejections); the page's uncaught exceptions and rejections through the DevTools protocol (`webContents.debugger`,
`Runtime.exceptionThrown`), so there is still no preload and no IPC. The graphics card is read once after the first load
from a throwaway 1x1 WebGL context (Electron 45.2.1's `app.getGPUInfo` carries no renderer string: measured, no
`glRenderer`), and reduced to its family in the main process.

**Who sends, and where.** The MAIN process POSTs (`net.request`, Origin `app://roaring-lions.local`, no cookie, no
redirect, User-Agent `roaring-lions-desktop`) to one compile-time constant, `https://roaring-lions.pint12.workers.dev/api/crash`
(pinned against the Worker's own origin). The page sends nothing and its CSP and navigation rules are unchanged.

**When.** `crashMode` sends only when EVERY one holds: a packaged app, a manifest packaged with `--crash-reports`
(`crashReports: true`; a plain `pnpm desktop:package` sends nothing), not a smoke bundle, no `CI`, no
`RL_DESKTOP_NO_CRASH_REPORTS`, no `--no-crash-reports` launch option. On top of that, the player's Settings switch
("Anonymous usage and crash reports", `lions.telemetry.optout`, GH-1410) is read from the page on every load and screen
change and every 15 s; off, no report is made and none is sent, and the outbox is emptied. A launch makes at most 6
reports (3 from the page), never the same one twice. A report waits in `crash-outbox.json` in the profile (at most 5,
7 days) when the network or the Worker cannot take it, so one made as the main process dies goes at the next launch;
410 (closed) and any 4xx drop it, 429, 5xx and a network failure keep it.

**The Worker** (`packages/worker/src/crash-ingest.ts`, `crash-meta.ts`): POST only; CLOSED unless the D1 `flags` row
`crash` reads `'open'` (no row is closed), and `CRASH_CLOSED` closes it with no database; Origin must be the desktop
build's, the Worker's own or `ALLOWED_ORIGINS`; `CRASH_LIMIT` 5 a minute per address (in the binding, used only if bound: the binding is NOT in `wrangler.jsonc`, HOLD FOR LEAD, so until the lead adds it the per-minute limit is skipped and the D1 day caps below are the only bound); a body of at most
6144 bytes of `application/json`; then 10 a day per launch, 20 per address (a keyed daily hash, `rate-day.ts`) and 200
in all. No IP and no header is stored. Rows live in `crash_report` (migration `0008_crash_report.sql`, NOT applied by
this change) for 90 days, deleted on the ingest path (25 per insert) rather than by the daily cron, whose D1 budget is
at 48 of 50. `/stats` shows the newest 50 with their stacks and a count by kind, version and GPU family.

**Measured, 19 Nov 2026** (linux-x64, Electron 45.2.1, Xvfb, SwiftShader, root so `--no-sandbox`): `pnpm desktop:package
--skip-build --smoke --smoke-crash --no-tar` against a stand-in web build (an index page whose script throws once from
`assets/boot.js`), with `RL_DESKTOP_SMOKE_CRASH_SINK` pointing at a loopback server: PASS. The run recorded and POSTed
four reports, `page_exception` (from `bootBoom (web/assets/boot.js:4:40)`), `page_exception` and `page_rejection`
(forced from the page with a home path, an email, a query and a Windows user path in their messages, all scrubbed) and
`renderer_gone` (`crashed`, exit code 2, from `forcefullyCrashRenderer`); GPU family `Software (no GPU)`. Each arrived
with `origin: app://roaring-lions.local`, `content-type: application/json`, no cookie, and each is stored by the Worker's
handler as sent (`crash-captured.test-helper.ts`, byte for byte). The shipped bundle's launch check still passed.

**Not done, and open (HOLD FOR LEAD):** opening the endpoint (apply 0008, then the `crash` flag); a privacy-page line
before it opens; the crash-free-session RATE for the desktop build needs a count of launches, which this change does not
send (telemetry is off on the desktop host, 9.2); a main-process exception was tested by unit tests only (Electron
shows its own error box, which a headless run cannot dismiss); Windows and macOS not run.

