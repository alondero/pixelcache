# Pixelcache MVP Product Requirements Document (PRD)

## Problem Statement

Game and emulator launchers (like Launchbox, EmulationStation, etc.) are often bloated, difficult to configure across multiple devices (like Steam Deck and Windows PC), and handle ROM hacks, translations, and regional variations poorly by treating them as entirely separate game cards that clutter the user interface. Furthermore, configuring these launchers typically requires tedious manual data entry or complex server setups.

## Solution

Pixelcache is a lightweight, cross-platform launcher built with Tauri and React. It groups regional variations, beta builds, and ROM hacks under a single canonical Game card in the UI, enabling a clean and clutter-free interface. For the MVP, Pixelcache operates entirely offline-first, launching games directly from local per-platform folders (Vaults) and automatically populating the game library by scanning and parsing ROM filenames.

## User Stories

1. As a retro gamer, I want a single canonical Game card for *Star Fox 64* that groups both the North American version and the European version (*Lylat Wars*), so that my game grid remains uncluttered.
2. As a player, I want to hover over a Game card and see a drop-down or side panel of its releases (official, hacks, translations), so that I can easily select and play a ROM hack like *Super Mario Bros. 3 Mix* directly from the parent game.
3. As a handheld player on my Steam Deck, I want to navigate the entire launcher interface using the D-pad and buttons on my controller, so that I don't need a keyboard or mouse.
4. As a player, I want to hover over a ROM hack and immediately see preview video footage of that specific hack, so that I can remember what the hack looks like before playing it.
5. As a homelab user, I want to point Pixelcache at a per-console folder (a Vault) for each of my platforms — each on whatever local or network drive it lives — so that it automatically scans the matching files, detects the titles and regions from the filenames, and adds them to my catalog without manual configuration.
6. As a PC gamer playing on a lower-spec device, I want the launcher to consume minimal RAM and CPU while my game is running, so that it does not impact the game's performance.
7. As a multi-platform gamer, I want to share the same game list structure on both my Windows desktop and my Steam Deck, so that I have a consistent library configuration on all my machines.
8. As a gamer who enjoys curated categories, I want to create Playlists containing specific ROM hacks from different games, so that I can directly boot my favorite hacks from a dedicated screen.

## Implementation Decisions

### Modules to Build

1. **Catalog Module (Rust)**
   - Responsible for reading, writing, and validating the `catalog.json` file.
   - Manages the domain entities (`Game`, `Release`, `Deck`, `Playlist`) and queries them.
2. **Import Scanner Module (Rust)**
   - Crawls each configured platform-scoped `Vault`, taking the platform from the Vault and including files that match its extension pattern.
   - Parses filenames using common retro-naming conventions (e.g. `Title (Region) (Revision).ext`) and maps them to logical `Release` and `Game` entities.
   - Reconciles the results into the Catalog, preserving manually added Releases, Playlists, Decks, and curated Game metadata.
3. **Execution Engine (Rust)**
   - Handles spawning emulator/game child processes according to the `Deck` settings for the host platform.
   - Temporarily hides the Tauri window on launch, and restores it when the child process exits.
4. **Client UI (React/Vite/HTML/CSS)**
   - Renders a visually rich, dark-themed, glassmorphic layout.
   - Handles video preview elements (using VP8/VP9 WebM or WebP) when focusing on releases.
   - Implements a gamepad focus-navigation system via the HTML5 Gamepad API.

### Schema Definitions (Simplified Catalog Schema)

- **Game**: `id` (required, string), `developer` (optional, string), `primaryReleaseId` (string), `relations` (optional array of game relations).
- **Release**: `id` (required, string), `gameId` (required, string), `title` (required, string), `region` (optional, string), `platform` (required, string), `revision` (optional, string), `releaseType` (required, enum: retail/beta/hack/translation/homebrew), `publisher` (optional, string), `vaultId` (optional, string — the Vault this Release was scanned from; absent for manual additions), `filePath` (required, string), `media` (optional object with `video` and `image` paths).
- **Deck**: `id` (required, string), `platform` (required, string), `executablePath` (required, string), `arguments` (optional, array of strings).
- **Vault**: `id` (required, string), `platform` (required, string), `path` (required, string), `pattern` (optional, string — comma/space-separated extension override; defaults to the platform's extension set).

## Testing Decisions

- **Catalog Serialization Tests**: Ensure that empty/null fields on the Catalog schema serialize and deserialize correctly in Rust, preventing data-loss during imports.
- **Filename Parser Tests**: Test the Import Scanner against a suite of standard No-Intro/TOSEC filenames to verify that regions, revisions, and titles are correctly extracted.
- **Process Launch Mocking**: Unit test the Deck argument formatting and command generation in isolation without spawning actual executables.
- **External UI Behavior**: Focus tests on the frontend to ensure controller events correctly shift focus between elements.

## Out of Scope (Post-MVP)

- **Cloud/Network Vaults**: Syncing files from remote SFTP, WebDAV, or S3/MinIO servers.
- **Cloud Config Syncing**: Hosting the Catalog on a remote database or remote VPS.
- **Automatic Metadata Scraping**: Downloading metadata/artwork from public APIs (IGDB, ScreenScraper, etc.).
- **Automatic ROM Patching**: Applying `.ips`/`.bps` patches on the fly to base ROMs.
- **Save Game / Save State Syncing**: Syncing save files automatically after game exits.

## Further Notes

- Media files (gameplay videos) should be formatted as `.webm` (VP8 or VP9) or animated `.webp` to ensure out-of-the-box hardware-accelerated playback on Linux/SteamOS WebKit WebViews.
