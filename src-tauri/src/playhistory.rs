//! Play-activity tracking: which Releases were played, when, how often, and
//! for how long.
//!
//! History is deliberately **not** part of the Catalog. The Catalog is the
//! curated, syncable library configuration; play activity is high-churn,
//! device-local state written every time a game exits. Folding it into
//! `catalog.json` would rewrite the synced file after every session and tangle
//! curation with telemetry. It lives in its own `play_history.json` beside the
//! catalog in the app data directory instead — see
//! [`docs/adr/0005-local-play-history.md`].
//!
//! The pure record-keeping ([`record_session`]) is separated from the
//! filesystem ([`load_from_path`] / [`save_to_path`]) and from Tauri
//! ([`record_session_end`]) so the accounting rules are unit-testable without
//! disk or an app handle, mirroring the `catalog` module's layout.

use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

/// File name of the play-history store inside the app data directory.
pub const HISTORY_FILE_NAME: &str = "play_history.json";

/// Sessions shorter than this are discarded rather than recorded: an emulator
/// that immediately crashes (missing BIOS, bad ROM path) should not become the
/// library's "last played" game or inflate play counts.
pub const MIN_RECORDED_SESSION: Duration = Duration::from_secs(5);

/// The Tauri event emitted to the frontend after a session is persisted, so
/// the UI refreshes play activity the moment the game exits without polling.
pub const SESSION_RECORDED_EVENT: &str = "play-session-recorded";

/// Accumulated play activity for one Release.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayEntry {
    /// How many recorded sessions this Release has had.
    pub play_count: u64,
    /// Total recorded time across all sessions, in milliseconds.
    pub total_play_ms: u64,
    /// When the most recent session ended, as Unix epoch milliseconds.
    pub last_played_ms: u64,
}

/// Play activity keyed by Release id. A `BTreeMap` keeps the JSON stably
/// ordered, so the on-disk file doesn't churn (diff-wise) between writes.
pub type PlayHistory = BTreeMap<String, PlayEntry>;

/// Failures loading or saving the play-history store. Modeled as an enum (per
/// the project's error convention) and stringified only at the IPC boundary.
#[derive(Debug)]
pub enum PlayHistoryError {
    Read {
        path: String,
        source: std::io::Error,
    },
    Parse {
        path: String,
        source: serde_json::Error,
    },
    Write {
        path: String,
        source: std::io::Error,
    },
}

impl fmt::Display for PlayHistoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PlayHistoryError::Read { path, source } => {
                write!(f, "failed to read play history '{path}': {source}")
            }
            PlayHistoryError::Parse { path, source } => {
                write!(f, "failed to parse play history '{path}': {source}")
            }
            PlayHistoryError::Write { path, source } => {
                write!(f, "failed to write play history '{path}': {source}")
            }
        }
    }
}

impl std::error::Error for PlayHistoryError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            PlayHistoryError::Read { source, .. } => Some(source),
            PlayHistoryError::Parse { source, .. } => Some(source),
            PlayHistoryError::Write { source, .. } => Some(source),
        }
    }
}

/// Fold one finished session into `history`, returning the updated entry —
/// or `None` when the session is shorter than [`MIN_RECORDED_SESSION`] and was
/// discarded. Pure over its inputs so the threshold and accumulation rules are
/// unit-testable without disk.
pub fn record_session(
    history: &mut PlayHistory,
    release_id: &str,
    duration: Duration,
    ended_at_ms: u64,
) -> Option<PlayEntry> {
    if duration < MIN_RECORDED_SESSION {
        return None;
    }
    let entry = history.entry(release_id.to_string()).or_default();
    entry.play_count += 1;
    entry.total_play_ms += duration.as_millis() as u64;
    entry.last_played_ms = entry.last_played_ms.max(ended_at_ms);
    Some(*entry)
}

/// Read the history at `path`. A missing file is an empty history, not an
/// error — the store is created lazily on the first recorded session.
pub fn load_from_path(path: &Path) -> Result<PlayHistory, PlayHistoryError> {
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(PlayHistory::new()),
        Err(source) => {
            return Err(PlayHistoryError::Read {
                path: path.display().to_string(),
                source,
            })
        }
    };
    serde_json::from_str(&contents).map_err(|source| PlayHistoryError::Parse {
        path: path.display().to_string(),
        source,
    })
}

/// Serialise `history` to `path`, creating parent directories as needed.
pub fn save_to_path(path: &Path, history: &PlayHistory) -> Result<(), PlayHistoryError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|source| PlayHistoryError::Write {
            path: parent.display().to_string(),
            source,
        })?;
    }
    let json = serde_json::to_string_pretty(history).expect("PlayHistory serialization is total");
    std::fs::write(path, json).map_err(|source| PlayHistoryError::Write {
        path: path.display().to_string(),
        source,
    })
}

/// Where the history store lives: `play_history.json` in the app data
/// directory, beside the persisted catalog.
fn history_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join(HISTORY_FILE_NAME))
}

/// Tauri command: the full play history, keyed by Release id, for the frontend
/// to hydrate its "Continue Playing" hero, card badges, and sort orders.
#[tauri::command]
pub async fn load_play_history(app: tauri::AppHandle) -> Result<PlayHistory, String> {
    let path = history_path(&app)?;
    load_from_path(&path).map_err(|e| e.to_string())
}

/// Payload of [`SESSION_RECORDED_EVENT`]: the Release that just finished and
/// its updated accumulated entry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecorded {
    pub release_id: String,
    pub entry: PlayEntry,
}

/// Record a finished session end-to-end: load the store, fold the session in,
/// persist, and notify the frontend. Called from the launch exit-watcher
/// thread, so every step is best-effort — a bookkeeping failure is logged and
/// must never disturb the just-restored window (matching `launch::log_if_err`'s
/// philosophy for hide/show).
pub fn record_session_end(app: &tauri::AppHandle, release_id: &str, duration: Duration) {
    let ended_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    if let Err(message) = try_record_session_end(app, release_id, duration, ended_at_ms) {
        eprintln!("pixelcache: failed to record play session for '{release_id}': {message}");
    }
}

fn try_record_session_end(
    app: &tauri::AppHandle,
    release_id: &str,
    duration: Duration,
    ended_at_ms: u64,
) -> Result<(), String> {
    let path = history_path(app)?;
    let mut history = load_from_path(&path).map_err(|e| e.to_string())?;
    let Some(entry) = record_session(&mut history, release_id, duration, ended_at_ms) else {
        return Ok(()); // Sub-threshold session: nothing recorded, nothing to announce.
    };
    save_to_path(&path, &history).map_err(|e| e.to_string())?;
    app.emit(
        SESSION_RECORDED_EVENT,
        SessionRecorded {
            release_id: release_id.to_string(),
            entry,
        },
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_a_first_session() {
        let mut history = PlayHistory::new();
        let entry = record_session(
            &mut history,
            "star-fox-64-ntsc",
            Duration::from_secs(90),
            1_000_000,
        )
        .expect("session above threshold is recorded");
        assert_eq!(entry.play_count, 1);
        assert_eq!(entry.total_play_ms, 90_000);
        assert_eq!(entry.last_played_ms, 1_000_000);
        assert_eq!(history.len(), 1);
    }

    #[test]
    fn accumulates_repeat_sessions() {
        let mut history = PlayHistory::new();
        record_session(&mut history, "r1", Duration::from_secs(60), 1_000);
        let entry =
            record_session(&mut history, "r1", Duration::from_secs(30), 2_000).expect("recorded");
        assert_eq!(entry.play_count, 2);
        assert_eq!(entry.total_play_ms, 90_000);
        assert_eq!(entry.last_played_ms, 2_000);
    }

    #[test]
    fn last_played_never_goes_backwards() {
        // A session ending "earlier" (clock skew, resumed suspend) must not
        // regress the most-recent timestamp the UI sorts by.
        let mut history = PlayHistory::new();
        record_session(&mut history, "r1", Duration::from_secs(60), 5_000);
        let entry =
            record_session(&mut history, "r1", Duration::from_secs(60), 4_000).expect("recorded");
        assert_eq!(entry.last_played_ms, 5_000);
        assert_eq!(entry.play_count, 2);
    }

    #[test]
    fn discards_sub_threshold_sessions() {
        let mut history = PlayHistory::new();
        let result = record_session(
            &mut history,
            "crashy",
            MIN_RECORDED_SESSION - Duration::from_millis(1),
            1_000,
        );
        assert!(result.is_none());
        assert!(history.is_empty());
    }

    #[test]
    fn threshold_session_is_recorded() {
        let mut history = PlayHistory::new();
        let result = record_session(&mut history, "r1", MIN_RECORDED_SESSION, 1_000);
        assert!(result.is_some());
    }

    #[test]
    fn history_round_trips_through_json() {
        let mut history = PlayHistory::new();
        record_session(&mut history, "r1", Duration::from_secs(61), 1_234);
        let json = serde_json::to_string(&history).expect("serializes");
        // The wire format is camelCase, matching the TypeScript mirror.
        assert!(json.contains("\"playCount\":1"));
        assert!(json.contains("\"totalPlayMs\":61000"));
        assert!(json.contains("\"lastPlayedMs\":1234"));
        let parsed: PlayHistory = serde_json::from_str(&json).expect("parses");
        assert_eq!(parsed, history);
    }

    #[test]
    fn missing_file_loads_as_empty_history() {
        let path = std::env::temp_dir().join("pixelcache-test-does-not-exist.json");
        let history = load_from_path(&path).expect("missing file is empty, not an error");
        assert!(history.is_empty());
    }

    #[test]
    fn save_and_load_round_trip_on_disk() {
        let dir = std::env::temp_dir().join(format!("pixelcache-ph-{}", std::process::id()));
        let path = dir.join("play_history.json");
        let mut history = PlayHistory::new();
        record_session(&mut history, "r1", Duration::from_secs(10), 42);
        save_to_path(&path, &history).expect("saves, creating the parent dir");
        let loaded = load_from_path(&path).expect("loads");
        assert_eq!(loaded, history);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn parse_failure_is_a_typed_error() {
        let dir = std::env::temp_dir().join(format!("pixelcache-ph-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("play_history.json");
        std::fs::write(&path, "not json").expect("write");
        let err = load_from_path(&path).expect_err("invalid JSON is an error");
        assert!(matches!(err, PlayHistoryError::Parse { .. }));
        assert!(err.to_string().contains("failed to parse play history"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
