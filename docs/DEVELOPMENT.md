# Development Guide

How to build, test, run, and verify Pixelcache locally. This is the reference
for both humans and automated (LLM) sessions.

## Prerequisites

- **Node.js** 20+ (developed on 24) and npm
- **Rust** stable toolchain (`rustc`, `cargo`) — developed on 1.95
- **Platform WebView deps**:
  - Windows: WebView2 (preinstalled on Windows 10/11)
  - Linux/SteamOS: `webkit2gtk-4.1`, `libappindicator`, `librsvg`, `patchelf`
    (see the CI workflow `.github/workflows/ci.yml` for the exact apt list)

First-time setup:

```bash
npm install
```

## Everyday commands

| Command             | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `npm run tauri dev` | Full desktop app with live reload (Rust + WebView).                 |
| `npm run dev`       | Frontend only (Vite) at http://localhost:1420 — no Rust backend.    |
| `npm run test`      | Frontend unit/component tests (Vitest), single run.                 |
| `npm run test:watch`| Frontend tests in watch mode — the fast TDD loop.                   |
| `npm run rust:test` | Rust unit tests (`cargo test`).                                     |
| `npm run verify`    | **The full green gate.** Run before calling any work done.          |
| `npm run build`     | Type-check + production frontend build into `dist/`.                |
| `npm run tauri build` | Full installable desktop bundle for the host OS.                  |

## The green gate: `npm run verify`

`scripts/verify.mjs` runs, in order and fail-fast:

1. Prettier format check
2. ESLint
3. Frontend unit tests (Vitest)
4. Frontend build (`tsc` type-check + Vite build → produces `dist/`)
5. Rust format check (`cargo fmt --check`)
6. Rust clippy with warnings denied
7. Rust unit tests (`cargo test`)

> The frontend build runs before the Rust steps deliberately: `generate_context!`
> in `src-tauri` reads `frontendDist` (`../dist`) at compile time, so the Rust
> crate can't compile until `dist/` exists.

Auto-fix formatting/lint issues with `npm run format` and `npm run lint:fix`.

## Testing philosophy (TDD by default)

Write the test first, watch it fail, then make it pass. The test pyramid:

- **Rust unit tests** (widest base) — pure logic in `src-tauri/src/*.rs` under
  `#[cfg(test)]`. Fast, no process spawning. Example: `launch.rs` tests command
  resolution/argv assembly without launching anything (per the PRD's
  "Process Launch Mocking" decision).
- **Frontend component tests** — Vitest + React Testing Library in
  `src/**/*.test.tsx`. The Tauri `invoke` bridge is mocked, so we assert the UI
  calls the right command and reacts to success/failure.
- **Manual / visual verification** — spin up `npm run dev` and check the UI in a
  browser (the WebView is just Chromium/WebKit). Full end-to-end WebDriver tests
  are deferred until there is more UI to drive.

## Launching a real emulator (dev override)

For issue #1 the launch target is a harmless placeholder (Notepad on Windows,
`xdg-open .` on Linux, TextEdit on macOS) that proves the spawn plumbing. Point
it at a real emulator without recompiling via environment variables:

```bash
# Windows (PowerShell)
$env:PIXELCACHE_LAUNCH_CMD = "C:\RetroArch\retroarch.exe"
$env:PIXELCACHE_LAUNCH_ARGS = "-L cores/snes9x_libretro.dll C:\roms\game.sfc"
npm run tauri dev
```

Arguments are whitespace-separated. This override is a temporary dev convenience;
it will be superseded by the Catalog/Deck configuration in a later issue.
