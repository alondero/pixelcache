---
name: run
description: Launch Pixelcache to see a change working in the real app. Use when asked to run, screenshot, or demo the app, or to confirm a UI/launch change end-to-end after tests pass.
---

# Running Pixelcache

## Two modes

1. **Frontend only** — `npm run dev` → http://localhost:1420 (`strictPort`:
   if 1420 is busy, it fails — reuse the running server). Starts in seconds.
   The Rust bridge is mocked in a plain browser (`src/dev/mockTauri.ts`): the
   grid shows the bundled sample catalog and Play "succeeds" with a fake pid.
   Use for layout/CSS/navigation checks and browser-driven screenshots (see
   the `verify-ui` skill); it cannot prove real launching/scanning.
2. **Full desktop app** — `npm run tauri dev`. First Rust compile takes
   minutes; run it in the background. Real catalog load and process launch.
   **The window intentionally hides while a launched game runs and restores
   when the child exits — this is a feature, not a crash.**

## Environment overrides (PowerShell: `$env:NAME = "value"` before launching)

- `PIXELCACHE_VAULT_DIR` — root directory that Release `filePath`s and the
  Vault scanner resolve against.
- `PIXELCACHE_LAUNCH_CMD` / `PIXELCACHE_LAUNCH_ARGS` — dev override for the
  test-launch plumbing (whitespace-separated args).

## Gotchas

- **Catalog precedence**: `load_catalog` prefers `<app-data>/catalog.json`
  (written by a previous Vault scan) over the bundled sample. If the app shows
  stale or unexpected games, delete the app-data catalog to fall back to the
  bundled one.
- Deck entries in the sample catalog name bare executables (`snes9x`,
  `mupen64plus`); Play only succeeds if they are on `PATH`.
- Keyboard arrow keys mirror the gamepad D-pad in grid navigation, so gamepad
  flows can be smoke-tested without a controller.
- Preview media is served from `public/media/` in dev; paths in the catalog
  are catalog-relative.
