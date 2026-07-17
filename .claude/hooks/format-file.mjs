#!/usr/bin/env node
// PostToolUse hook (Edit|Write).
//
// Auto-formats the file that was just written so the Prettier / cargo-fmt
// steps of `npm run verify` never fail on formatting. Saves a whole
// format-fail → format → re-verify round trip (~30s + tokens) per session.
//
// Always exits 0: a formatter problem must never block the edit itself.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const file = input?.tool_input?.file_path;
// Claude Code sets CLAUDE_PROJECT_DIR to the repo root in every session;
// fall back to cwd only when the harness doesn't set it.
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!path.isAbsolute(root)) process.exit(0);
if (!file || !existsSync(file)) process.exit(0);

const ext = path.extname(file).toLowerCase();
const PRETTIER_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".json",
  ".md",
  ".html",
  ".yml",
  ".yaml",
]);

try {
  if (ext === ".rs") {
    execFileSync(
      "cargo",
      ["fmt", "--manifest-path", path.join(root, "src-tauri", "Cargo.toml")],
      { stdio: "ignore" },
    );
  } else if (PRETTIER_EXTS.has(ext)) {
    const prettierBin = path.join(
      root,
      "node_modules",
      "prettier",
      "bin",
      "prettier.cjs",
    );
    if (existsSync(prettierBin)) {
      execFileSync(process.execPath, [prettierBin, "--write", file], {
        stdio: "ignore",
        cwd: root,
      });
    }
  }
} catch {
  // Never fail the hook — verify will still catch anything a formatter missed.
}
process.exit(0);
