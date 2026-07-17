---
name: ship-feature
description: End-to-end workflow for building any Pixelcache feature or fix — from GitHub issue to verified PR. Use when starting a coding task in this repo, before writing any code.
---

# Shipping a Pixelcache feature

## 1. Understand before coding

- `gh issue view <n>` for the spec; ask only if the code + issue can't answer.
- Speak the domain language from `CONTEXT.md`: Game, Release, Deck, Catalog,
  Vault — never Title/ROM/Emulator/Config-file.
- Check `docs/adr/` before making an architectural choice; add a new ADR when
  you make one.

## 2. Test first (mandatory)

Write the failing test, watch it fail, then implement.

- **Pure frontend logic** → extract into a plain `.ts` module with a Vitest
  test (pattern: `gridNavigation.ts`, `catalogView.ts`). Keep components thin.
- **Components** → React Testing Library; mock the bridge with
  `vi.mock("@tauri-apps/api/core", () => ({ invoke }))` and assert the command
  name + payload and the UI's reaction to success/failure.
- **Rust** → `#[cfg(test)]` unit tests in the same module. Test command logic
  as pure functions (e.g. argv assembly in `launch.rs`); never spawn real
  processes in tests.

## 3. Implement

- New Tauri commands: own module in `src-tauri/src/`, custom error enum with
  `Display`, `Result<T, String>` at the command boundary, register in
  `lib.rs`'s `generate_handler!`.
- Schema changes: `src/catalog.ts` and `src-tauri/src/catalog.rs` are mirrors —
  always change both (see the `catalog-domain` skill).
- UI: dark, glassmorphic, reuse the CSS custom properties in `App.css`.
  Gamepad focus goes through `useGridFocus`; because the Gamepad API is
  polled, any additional focus hook MUST take an `enabled` flag so two hooks
  never fight over focus.

## 4. Self-validate (no human in the loop)

- Run the `verify` skill: `npm run format` + `npm run rust:fmt`, then
  `npm run verify` — must be fully green, including pre-existing failures.
- For UI-visible changes, run the `verify-ui` skill: drive the app in a
  browser, exercise the change, and **share a screenshot with the user** —
  unit tests mock the bridge and render no pixels, so the image is the proof.

## 5. PR

- Branch off `main`; commit style from history: `feat:`/`fix:`/`refactor:` +
  one plain-English sentence.
- `gh pr create` referencing the issue (`Closes #n`). CI runs the same
  `npm run verify` on Windows and Linux — if verify is green locally, CI
  should be too.
