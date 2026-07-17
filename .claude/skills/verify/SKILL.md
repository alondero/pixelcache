---
name: verify
description: Self-validate Pixelcache changes before claiming work done. Use before finishing any task that touched code, when the build/test/lint status is unknown, or when asked to verify.
---

# Verifying Pixelcache changes

## Fast inner loops (while developing — cheapest check that can fail)

- One frontend test file: `npx vitest run src/catalogView.test.ts`
- All frontend tests: `npm run test`
- One Rust module: `cargo test --manifest-path src-tauri/Cargo.toml scanner::`
- Types only: `npm run typecheck`

## The green gate (mandatory before finishing)

1. Auto-fix first: `npm run format` and `npm run rust:fmt` (skips a guaranteed
   check-fail → fix → re-verify round trip).
2. `npm run verify` — fail-fast, in order: Prettier check → ESLint → Vitest →
   frontend build (tsc + Vite) → cargo fmt check → clippy (`-D warnings`) →
   cargo test.

Rules:

- **Green means green.** Pre-existing failures must be fixed too, not skipped
  or explained away.
- **Never reorder around the build**: `tauri::generate_context!` in `src-tauri`
  reads `../dist` at compile time, so clippy/cargo-test cannot run on a clean
  checkout until `npm run build` has produced `dist/`.
- Unit tests mock the Tauri bridge (`vi.mock("@tauri-apps/api/core")`) and Rust
  tests never spawn real processes — so for user-visible changes, also drive
  the running app (see the `run` skill) before calling the work verified.
