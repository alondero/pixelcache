#!/usr/bin/env node
// One-command quality gate for Pixelcache.
//
// Run manually (`npm run verify`) or by CI / future automated sessions. Every
// step must pass GREEN before work is considered done. Steps run in order and
// the script exits on the first failure with a non-zero code.
//
// The frontend is built BEFORE the Rust steps on purpose: `generate_context!()`
// in src-tauri needs `dist/` to exist at compile time, so `cargo test`/`clippy`
// cannot run until Vite has produced a build.
import { spawnSync } from "node:child_process";

const steps = [
  ["Prettier (format check)", "npm run format:check"],
  ["ESLint", "npm run lint"],
  ["Frontend unit tests (Vitest)", "npm run test"],
  ["Frontend build (tsc + vite)", "npm run build"],
  ["Rust format check", "npm run rust:fmt:check"],
  ["Rust clippy (deny warnings)", "npm run rust:clippy"],
  ["Rust unit tests", "npm run rust:test"],
];

const t0 = Date.now();
for (const [name, command] of steps) {
  console.log(`\n\x1b[1m\x1b[36m▶ ${name}\x1b[0m`);
  const result = spawnSync(command, { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(`\n\x1b[1m\x1b[31m✖ FAILED: ${name}\x1b[0m`);
    process.exit(result.status ?? 1);
  }
}

const seconds = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n\x1b[1m\x1b[32m✔ All checks passed in ${seconds}s\x1b[0m`);
