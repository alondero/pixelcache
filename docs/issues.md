# Pixelcache Project Issues

This file contains the tracked, prioritized issues for building the Pixelcache MVP. They are structured as vertical tracer bullet slices.

---

## TICKET-001: Scaffold Tauri & Launch Hardcoded ROM
* **Type**: HITL
* **Blocked by**: None

### What to build
Initialize a new Tauri v2 desktop application using React + Vite. Implement a basic window containing a single button labeled "Launch Test Game". Clicking this button invokes a Tauri command in the Rust backend that spawns a hardcoded local emulator process (e.g., RetroArch or Dolphin) with a hardcoded ROM file path.

### Acceptance criteria
- [ ] Tauri v2 project is initialized and compiles successfully on Windows and Linux (SteamOS).
- [ ] Clicking the "Launch Test Game" button spawns the emulator process.
- [ ] The app handles process spawning asynchronously without blocking the UI.
- [ ] Basic project folder structure is established.

---

## TICKET-002: Read Catalog JSON & Controller Grid Navigation
* **Type**: AFK
* **Blocked by**: TICKET-001

### What to build
Define the serialization and deserialization structs in Rust for the `catalog.json` schema. Create a mock `catalog.json` file in the application directory. Integrate a Tauri command that reads this file and passes the catalog data to the React UI on startup. Render a basic grid of Game cards. Implement Gamepad API listeners in React to support D-pad navigation to highlight/focus cards.

### Acceptance criteria
- [ ] Rust structs for `Game`, `Release`, and `Deck` schemas are defined and tested.
- [ ] On startup, the UI loads catalog data from a local JSON file.
- [ ] Games are rendered in a responsive CSS Grid.
- [ ] The player can navigate between game cards using a connected controller (D-pad/Joystick) or keyboard (Arrow keys).

---

## TICKET-003: Game Details Panel, Peer Releases & Video Previews
* **Type**: AFK
* **Blocked by**: TICKET-002

### What to build
Create a detailed layout overlay or side panel when a Game is selected. The panel must display the list of peer `Releases` (such as regional versions and hacks). When a specific release is highlighted, play its WebM video preview or display its custom cover art. Clicking "Play" on a Release launches the specific emulator configured for that release's Deck.

### Acceptance criteria
- [ ] Selecting a Game card reveals a panel showing its grouped peer Releases.
- [ ] Hovering/focusing a Release plays its associated `.webm` video preview.
- [ ] Clicking "Play" launches the game using the correct platform executable path from the logical `Deck` configuration.

---

## TICKET-004: File Import Scanner
* **Type**: AFK
* **Blocked by**: TICKET-002

### What to build
Implement a directory crawler in the Rust backend. When triggered, it walks a designated local directory (Vault) and parses ROM filenames using standard retro naming patterns (e.g., `Title (Region) (Revision).ext`). It groups ROM hacks, regional variations, and revisions under their parent Game, automatically generating a fresh `catalog.json` file.

### Acceptance criteria
- [ ] Rust function successfully walks a directory and filters by valid ROM file extensions.
- [ ] Filename parser successfully extracts title, region, revision, and platform from standard TOSEC/No-Intro filename patterns.
- [ ] The scanner outputs a valid `catalog.json` file and refreshes the UI list.

---

## TICKET-005: Playlist Navigation
* **Type**: AFK
* **Blocked by**: TICKET-003

### What to build
Implement Playlist schema parsing and create a dedicated "Playlists" view in the React UI. A playlist holds references to specific `Release` IDs. Players can browse playlists (such as "ROM Hacks") and directly launch games from this view.

### Acceptance criteria
- [ ] Playlists are successfully defined in the catalog and parsed by the backend.
- [ ] The UI renders a Playlists tab allowing the user to select from custom collections.
- [ ] Launching a release from a playlist correctly executes the associated Deck.
