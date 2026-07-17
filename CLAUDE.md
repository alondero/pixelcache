# CLAUDE.md

## Project Information

Pixelcache is a lightweight, cross-platform Game/Emulator Launcher built with
Tauri (v2) and React/Vite. It groups regional releases, hacks, and revisions
under a single canonical Game card in the UI, and supports gamepad-navigable
views.

## Technology Stack

- **Backend**: Rust (Tauri commands, process execution, directory scanning)
- **Frontend**: React, Vite, Vanilla CSS
- **Media**: WebM (VP8/VP9) or WebP for game previews

## Commands

Full command reference: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

- `npm run tauri dev` — full desktop app; `npm run dev` — frontend only.
- `npm run verify` — **the green gate**. Must pass before any work is called
  done. Run `npm run format` + `npm run rust:fmt` first (auto-fix beats
  check-fail). A PostToolUse hook auto-formats edited files, so this is
  usually already satisfied.

## Project skills — invoke BEFORE doing the matching work

- `ship-feature` — end-to-end workflow for any coding task (issue → TDD →
  verify → PR)
- `verify` — self-validate changes before finishing (static gate)
- `verify-ui` — visually verify UI changes in a browser and share a
  screenshot with the user before finishing (mandatory for UI features)
- `run` — launch/drive the app to confirm a change works for real
- `catalog-domain` — catalog.json schema, load precedence, scanner invariants

## Coding Conventions

- **Domain Modeling**: Always refer to the glossary in [CONTEXT.md](file:///F:/src/pixelcache/CONTEXT.md). Use terms like `Game`, `Release`, `Deck`, `Catalog`, `Playlist`, and `Vault`.
- **Architecture**: Follow the decision records in [docs/adr/](file:///F:/src/pixelcache/docs/adr/).
- **Error Handling**: Prefer custom Rust error enums for Tauri commands, return `Result<T, String>` to the frontend.
- **Schema mirroring**: `src/catalog.ts` mirrors the serde structs in `src-tauri/src/catalog.rs` — always change both together.
- **UI Design**: Visuals must look dark, glassmorphic, and clean. Custom animations and gamepad focus listening (via Gamepad API) are mandatory. The Gamepad API is polled, so any focus hook beyond `useGridFocus` must take an `enabled` flag so two hooks never fight over focus.
- **Testing**: TDD by default — failing test first, then code. Frontend tests mock the Tauri bridge; Rust tests never spawn real processes. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for testing philosophy and the green-gate sequence.
- **State Management**: Keep the React state simple. Load `catalog.json` once on app mount.
