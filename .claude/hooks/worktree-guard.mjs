#!/usr/bin/env node
// PreToolUse hook (Edit|Write|NotebookEdit).
//
// When a session runs inside a git worktree under <main>/.claude/worktrees/<name>,
// an absolute path pointing at the MAIN checkout silently edits (and tests) the
// wrong tree. This hook denies such edits with an actionable message.
//
// Exit codes: 0 = allow, 2 = deny (stderr is fed back to the agent).
import { readFileSync } from "node:fs";
import path from "node:path";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const file = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
if (!file) process.exit(0);

const norm = (p) => path.resolve(p).replaceAll("\\", "/").toLowerCase();
const rootN = norm(root);
const marker = "/.claude/worktrees/";
const markerIdx = rootN.indexOf(marker);
if (markerIdx === -1) process.exit(0); // not a worktree session — nothing to guard

const mainRoot = rootN.slice(0, markerIdx);
const fileN = norm(file);
if (fileN === rootN || fileN.startsWith(rootN + "/")) process.exit(0);

if (fileN.startsWith(mainRoot + "/")) {
  console.error(
    `BLOCKED: ${file} targets the main checkout, but this session runs in the worktree ${root}. ` +
      `Re-issue the edit with the equivalent path inside the worktree.`,
  );
  process.exit(2);
}

process.exit(0);
