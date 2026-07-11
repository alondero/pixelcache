# CLAUDE.md

## Project Information
Pixelcache is a lightweight, cross-platform Game/Emulator Launcher built with Tauri (v2) and React/Vite. It groups regional releases, hacks, and revisions under a single canonical Game card in the UI, and supports gamepad-navigable views.

## Technology Stack
- **Backend**: Rust (Tauri commands, process execution, directory scanning)
- **Frontend**: React, Vite, Vanilla CSS
- **Media**: WebM (VP8/VP9) or WebP for game previews

## Commands
### Setup
- Initialize project: Run Tauri scaffold (e.g. `npx -y create-tauri-app`) inside the project root once ready to build.
### Development
- `npm run tauri dev`

## Coding Conventions
- **Domain Modeling**: Always refer to the glossary in [CONTEXT.md](file:///F:/src/pixelcache/CONTEXT.md). Use terms like `Game`, `Release`, `Deck`, `Catalog`, and `Vault`.
- **Architecture**: Follow the decision records in [docs/adr/](file:///F:/src/pixelcache/docs/adr/).
- **Error Handling**: Prefer custom Rust error enums for Tauri commands, return `Result<T, String>` to the frontend.
- **UI Design**: Visuals must look dark, glassmorphic, and clean. Custom animations and gamepad focus listening (via Gamepad API) are mandatory.
- **State Management**: Keep the React state simple. Load `catalog.json` once on app mount.
