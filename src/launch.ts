/**
 * Frontend mirror of the Rust launch commands' success payload
 * (`src-tauri/src/launch.rs`'s `LaunchResult`), shared by every view that can
 * spawn a process (`GamesView`, `PlaylistsView`).
 */
export interface LaunchResult {
  program: string;
  pid: number;
}

/**
 * The status of a launch action, shared by every view that spawns a process
 * (`GamesView`, `PlaylistsView`). The `Launching` type parameter carries any
 * extra data a view needs while a launch is in flight — `PlaylistsView` passes
 * `{ releaseId: string }` so it can disable just the card being launched, while
 * `GamesView` needs nothing extra and uses the default.
 */
export type LaunchStatus<Launching = unknown> =
  | { kind: "idle" }
  | ({ kind: "launching" } & Launching)
  | { kind: "launched"; result: LaunchResult }
  | { kind: "error"; message: string };
