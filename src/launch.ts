/**
 * Frontend mirror of the Rust launch commands' success payload
 * (`src-tauri/src/launch.rs`'s `LaunchResult`), shared by every view that can
 * spawn a process (`GamesView`, `PlaylistsView`).
 */
export interface LaunchResult {
  program: string;
  pid: number;
}
