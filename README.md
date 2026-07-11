# Pixelcache

A lightweight, cross-platform game/emulator launcher built with **Tauri v2** and
**React + Vite**. It groups regional releases, hacks, and revisions under a
single canonical Game card and supports gamepad-navigable views.

See [`CONTEXT.md`](./CONTEXT.md) for the domain glossary,
[`docs/prd-mvp.md`](./docs/prd-mvp.md) for the MVP scope, and
[`docs/adr/`](./docs/adr/) for architectural decisions.

## Quick start

```bash
npm install
npm run tauri dev      # run the full desktop app
```

## Common commands

- `npm run tauri dev` — full desktop app with live reload
- `npm run dev` — frontend only (Vite) for quick UI iteration
- `npm run test` — frontend tests; `npm run rust:test` — Rust tests
- `npm run verify` — the full green gate (format, lint, tests, build)

Full details, the testing philosophy, and the dev-emulator override are in
[`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md).

## Status

Early development. Issue #1 (scaffold + hardcoded launch tracer bullet) is the
current baseline: a "Launch Test Game" button that spawns a process via the Rust
backend.
