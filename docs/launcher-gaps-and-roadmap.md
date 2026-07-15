# Launcher Gap Analysis & Roadmap

_Comparison of Pixelcache against established launchers (LaunchBox / Big Box,
GameEx, EmulationStation / ES-DE), scoped to the three focus areas for the next
version: **launch configuration**, **media**, and **search / filtering**._

## How the reference launchers work

| Capability | LaunchBox / Big Box | GameEx | EmulationStation / ES-DE | Pixelcache today |
| --- | --- | --- | --- | --- |
| **Emulator config** | Per-platform default emulator + unlimited extra emulators; per-game override; command-line params with a ROM placeholder; associated platforms | Per-emulator config with romlist + command template | `es_systems.cfg` command with `%ROM%` substitution; curated list of *alternative emulators* per system (RetroArch cores + standalone) | One `Deck` per platform, first match wins; ROM always appended **last** |
| **Vanilla / direct launch** | "None" emulator = run the file itself; PC games launch an `.exe` directly | Yes | Yes (command can be the app itself) | Not expressible — `filePath` is always an *argument* |
| **Media types** | Box front/back, cart, clear logo, marquee, screenshot, fanart, video, manual | Artwork + video snaps | image, thumbnail, marquee, video, fanart | One `image` + one `video` per Release |
| **Metadata scraping** | LaunchBox DB + EmuMovies | Bundled DB | ScreenScraper / TheGamesDB | None (filename parse only) |
| **Search** | Live search box | Search | Text quick-search / jump-to | **None** |
| **Filtering** | Platform, genre, play mode, rating, series, playlists | Category/list | Genre, players, favorite, completed, hidden, custom collections | **None** |
| **Sorting** | Title, release date, rating, last played, most played… | Several | Title, rating, release date, times played… | Catalog order only |
| **Collections** | Auto + manual playlists | Lists | Auto collections (favorites/recent/all) + custom | Manual `Playlist`s only |
| **Controller UI** | Big Box | Yes | Yes | Roving-focus grid (D-pad/stick) ✅ |

## Core gaps, by focus area

### 1. Launch configuration
Pixelcache has a working `Deck` execution engine (hide window → spawn → restore),
but the model is the thinnest possible:

- **No ROM placeholder in arguments.** `resolve_release_spec` always pushes the
  ROM path as the *final* arg. Real emulator invocations need it mid-command —
  RetroArch is `-L <core> "<rom>"`, DuckStation is `-- "<rom>"`, etc. Today
  those are impossible to express.
- **No vanilla / direct launch.** A PC game or a self-contained executable can't
  be "the thing that runs" — `filePath` is always an argument to a separate
  program.
- **One Deck per platform, no override.** `find(|d| d.platform == …)` takes the
  first. No default-plus-alternatives, no per-Release choice (e.g. run one hack
  under a different core).
- **No configuration UI.** Decks are hand-edited JSON; the scanner emits none, so
  a freshly scanned library launches nothing until the user edits the file.
- **No working directory / env / pre-launch hooks.**

### 2. Media
- **Only two slots** (`image`, `video`) and only at the Release level — no
  game-level fallback, no logo/marquee/screenshot/box art.
- **No scraping** and **no manual media-assignment UI**; media must be dropped
  into `public/media` and referenced by hand.
- Served from the frontend `media/` root rather than the Vault via a Tauri asset
  protocol (already flagged as a TODO in `catalogView.mediaUrl`).

### 3. Search / filtering
- **Entirely absent.** `GameGrid` renders every card in catalog order. There is
  no search box, no platform/type filter, no sort, no favorites, no auto
  collections. A real single-platform Vault is thousands of titles, so the grid
  is unusable past the demo catalog. **This is the largest absolute gap** — the
  others are limited-but-present; this one does not exist.

## Roadmap

Phased so each step is shippable and independently testable, following the
repo's existing split of *pure logic (unit-tested)* from *IO / UI glue*.

**Phase 1 — Search & filtering (this session).** Live title search, platform
filter, release-type filter, and sort, over the Games grid. Pure filtering
module + filter-bar UI + focus/empty-state integration. _Biggest gap, no backend
risk, fully unit-testable._

**Phase 2 — Launch configuration.**
- Add a `{rom}` / `{file}` placeholder to `Deck.arguments`; substitute in
  `resolve_release_spec`, falling back to append-last when absent (backward
  compatible).
- Add a `directLaunch` Deck kind (run the Release file itself; ROM path becomes
  the program).
- Allow multiple Decks per platform with a `default` flag + optional
  `Release.deckId` override; thread a chosen deck through `launch_release`.
- A Decks/Emulators settings screen (list, add, edit, test-launch).
- Have the scanner seed a placeholder Deck per discovered platform so a scanned
  library is launchable.

**Phase 3 — Media.**
- Expand `Media` to logo / marquee / screenshot / boxart / fanart, with
  game-level fallback.
- Serve media from the Vault via a Tauri asset protocol.
- Manual media-assignment UI; (post-MVP) optional scraper behind the existing
  "no automatic scraping in MVP" ADR.

**Cross-cutting (later):** favorites + auto collections (recent / most-played),
play-count / last-played tracking, richer metadata (genre, players, rating) to
power more filters.

## This session

Implemented **Phase 3 — Media.** Media grew from "one `image` + one `video` per
Release, served from the frontend `media/` root" to the richer artwork set
established launchers use, served from the Vault:

- **Expanded `Media`.** Added `logo`, `marquee`, `screenshot`, `boxart`, and
  `fanart` alongside the existing `image` / `video` slots, in both the Rust
  `catalog::Media` struct and its `src/catalog.ts` mirror. Every slot is
  optional and omitted from JSON when unset, so pre-Phase-3 catalogs are
  unchanged.
- **Game-level fallback.** `Game` gained an optional `media` object; a Release
  that leaves a slot unset inherits it from its Game. The rule lives once in the
  pure `media::resolved_slot` (backend) and `resolveMedia` (`src/media.ts`,
  frontend), so a shared logo or box art can be set on the Game instead of on
  every regional Release.
- **Vault asset protocol.** A `pixelcache-media://` URI scheme (registered in
  `lib.rs`, handled by `media::respond`) streams a Release + slot's file from
  the Release's Vault, falling back to `PIXELCACHE_MEDIA_DIR` and finally the
  bundled resource `media/` directory (where the demo catalog's artwork now
  ships). The frontend addresses artwork by `mediaSrc(releaseId, slot)` rather
  than a hand-built `media/` path. Path resolution, MIME guessing, and request
  parsing are pure and unit-tested; only the file read touches disk.
- **Media everywhere it's shown.** Game cards now render a still cover
  (`GameGrid`), and the details panel resolves the highlighted Release's preview
  through the fallback, both over the protocol.
- **Media settings screen.** A new "Media" tab (`src/MediaView.tsx` + the pure
  `src/media.ts`) assigns artwork per Release or per Game (as a fallback),
  persisted via the `save_media` command (with the pure `catalog::apply_media` /
  `setReleaseMedia` / `setGameMedia` update rules). Automatic scraping stays
  deferred per the "no automatic scraping in MVP" ADR.

### Previous sessions

Implemented **Phase 2 — Launch configuration.** The Deck model grew from
"one Deck per platform, ROM always appended last" to a configurable launch
engine: a `{rom}` / `{file}` argument placeholder substituted by
`resolve_release_spec` (append-last when absent), a `DeckKind::DirectLaunch`
kind that runs the Release file itself, multiple Decks per platform with a
`default` flag and a `Release.deckId` override resolved by `select_deck`, a Decks
"Settings" tab (`src/DecksView.tsx` + pure `src/decks.ts`) persisting via
`save_decks` with a `test_launch_deck` action, and scanner seeding of a
placeholder default Deck per discovered platform.

Implemented **Phase 1 — Search & filtering** (see `src/gamesFilter.ts`,
`src/GamesFilterBar.tsx`, and the Games view wiring). Search matches a game's
title, any of its peer Releases' titles, and its developer; platform and
release-type filters and four sort orders are applied on top; the roving grid
focus and an empty-state message adapt to the filtered set.
