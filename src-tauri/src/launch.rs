//! Launch engine (tracer-bullet stage).
//!
//! This module owns the logic for turning a launch request into an actual OS
//! process. It is deliberately split into three layers so the decision-making is
//! unit-testable without ever spawning a real process (see the PRD's
//! "Process Launch Mocking" testing decision):
//!
//! 1. [`resolve_spec`]   — decide *what* to launch (pure).
//! 2. [`build_command`]  — assemble the argv into a [`Command`] (pure-ish; no spawn).
//! 3. [`spawn`]          — the only function that touches the OS.
//!
//! For this first issue (#1) there is no Catalog or Deck yet, so the launch
//! target is a hardcoded, harmless placeholder standing in for a real emulator +
//! ROM. It can be overridden at runtime via environment variables, which lets a
//! developer point it at a real emulator without recompiling:
//!
//! ```text
//! PIXELCACHE_LAUNCH_CMD="C:\\RetroArch\\retroarch.exe"
//! PIXELCACHE_LAUNCH_ARGS="-L cores/snes9x_libretro.dll C:\\roms\\game.sfc"
//! ```
//!
//! When the real Execution Engine + `Deck` (per `docs/prd-mvp.md`) land, this
//! placeholder resolution is replaced by looking the command up from the Deck
//! configuration for the host platform.

use crate::catalog::{Catalog, Deck, Release};
use serde::Serialize;
use std::fmt;
use std::process::Command;

/// Environment variable overriding the program to launch.
pub const LAUNCH_CMD_ENV: &str = "PIXELCACHE_LAUNCH_CMD";
/// Environment variable overriding the arguments passed to the program.
/// Arguments are whitespace-separated (sufficient for the tracer bullet; the
/// real Deck schema carries a structured `arguments: Vec<String>`).
pub const LAUNCH_ARGS_ENV: &str = "PIXELCACHE_LAUNCH_ARGS";

/// A resolved decision about what to launch: the executable and its arguments.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LaunchSpec {
    pub program: String,
    pub args: Vec<String>,
}

/// The outcome of a successful launch, returned to the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LaunchResult {
    /// The program that was launched.
    pub program: String,
    /// The operating-system process id of the spawned child.
    pub pid: u32,
}

/// Errors that can occur while launching a process.
///
/// Per the project's error-handling convention (see `CLAUDE.md`), Tauri commands
/// model their failures as a dedicated error enum and only stringify it at the
/// IPC boundary. Keeping a typed error means callers inside Rust can match on the
/// variant, and new failure modes (missing Deck, unknown platform, …) get added
/// here as the launch engine grows.
#[derive(Debug)]
pub enum LaunchError {
    /// The operating system refused to spawn the process (not found, no
    /// permission, etc.).
    Spawn {
        program: String,
        source: std::io::Error,
    },
    /// No [`Release`] in the catalog has the requested id.
    ReleaseNotFound { release_id: String },
    /// The Release's platform has no matching [`Deck`], so there is no
    /// executable to run it with.
    NoDeckForPlatform {
        release_id: String,
        platform: String,
    },
}

impl fmt::Display for LaunchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LaunchError::Spawn { program, source } => {
                write!(f, "failed to launch '{program}': {source}")
            }
            LaunchError::ReleaseNotFound { release_id } => {
                write!(f, "no release found with id '{release_id}'")
            }
            LaunchError::NoDeckForPlatform {
                release_id,
                platform,
            } => {
                write!(
                    f,
                    "no deck configured for platform '{platform}' (needed to launch '{release_id}')"
                )
            }
        }
    }
}

impl std::error::Error for LaunchError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            LaunchError::Spawn { source, .. } => Some(source),
            LaunchError::ReleaseNotFound { .. } | LaunchError::NoDeckForPlatform { .. } => None,
        }
    }
}

/// The harmless per-platform default used when no environment override is set.
///
/// These are intentionally *not* real emulators — they are visible, always-present
/// system programs that prove the spawn plumbing works end-to-end on a fresh
/// machine. They will be replaced by real Deck lookups in a later issue.
fn default_spec() -> LaunchSpec {
    if cfg!(target_os = "windows") {
        LaunchSpec {
            program: "notepad.exe".to_string(),
            args: vec![],
        }
    } else if cfg!(target_os = "macos") {
        LaunchSpec {
            program: "open".to_string(),
            args: vec!["-a".to_string(), "TextEdit".to_string()],
        }
    } else {
        // Linux / SteamOS: open the user's home directory in the default handler.
        LaunchSpec {
            program: "xdg-open".to_string(),
            args: vec![".".to_string()],
        }
    }
}

/// Decide what to launch, honouring the environment overrides if present.
///
/// Pure with respect to the two arguments — the real Tauri command passes the
/// live environment, while tests pass explicit values. Each field falls back
/// independently: the program comes from `cmd_override` (when non-blank) or the
/// platform default, and the arguments come from `args_override` (when non-empty)
/// or whatever args that program's default carries.
pub fn resolve_spec(cmd_override: Option<String>, args_override: Option<String>) -> LaunchSpec {
    let mut spec = match cmd_override {
        Some(program) if !program.trim().is_empty() => LaunchSpec {
            program: program.trim().to_string(),
            args: vec![],
        },
        _ => default_spec(),
    };

    let overridden_args = parse_args(args_override.as_deref());
    if !overridden_args.is_empty() {
        spec.args = overridden_args;
    }

    spec
}

/// Decide what to launch for a specific [`Release`] using its [`Deck`].
///
/// Pure: the program is the Deck's `executable_path`, and the arguments are the
/// Deck's configured `arguments` followed by the Release's `file_path` (the ROM
/// or game file to open). This is the real-Deck counterpart to [`resolve_spec`]'s
/// tracer-bullet resolution, and — being free of IO — is where the "correct Deck
/// is used" behaviour is unit-tested.
pub fn resolve_release_spec(release: &Release, deck: &Deck) -> LaunchSpec {
    let mut args = deck.arguments.clone();
    args.push(release.file_path.clone());
    LaunchSpec {
        program: deck.executable_path.clone(),
        args,
    }
}

/// Resolve the [`LaunchSpec`] for a Release id against a whole [`Catalog`].
///
/// Ties the two lookups together: find the Release, then find the Deck for its
/// platform, then format the command. Returns a typed [`LaunchError`] for each
/// way this can fail so the caller can report a precise message. Pure over the
/// catalog, so both the happy path and the two not-found paths are unit-tested
/// without any filesystem or process involvement.
pub fn resolve_launch(catalog: &Catalog, release_id: &str) -> Result<LaunchSpec, LaunchError> {
    let release = catalog
        .find_release(release_id)
        .ok_or_else(|| LaunchError::ReleaseNotFound {
            release_id: release_id.to_string(),
        })?;
    let deck = catalog
        .find_deck_for_platform(&release.platform)
        .ok_or_else(|| LaunchError::NoDeckForPlatform {
            release_id: release_id.to_string(),
            platform: release.platform.clone(),
        })?;
    Ok(resolve_release_spec(release, deck))
}

/// Split a whitespace-separated argument string into individual arguments.
fn parse_args(raw: Option<&str>) -> Vec<String> {
    raw.map(|s| s.split_whitespace().map(str::to_string).collect())
        .unwrap_or_default()
}

/// Read the live environment and resolve the launch spec from it.
fn resolve_from_env() -> LaunchSpec {
    resolve_spec(
        std::env::var(LAUNCH_CMD_ENV).ok(),
        std::env::var(LAUNCH_ARGS_ENV).ok(),
    )
}

/// Build (but do not spawn) the OS command for a spec.
pub fn build_command(spec: &LaunchSpec) -> Command {
    let mut command = Command::new(&spec.program);
    command.args(&spec.args);
    command
}

/// Spawn the process described by `spec`, returning immediately without waiting
/// for it to exit. This is the only function in the module with side effects.
pub fn spawn(spec: &LaunchSpec) -> Result<LaunchResult, LaunchError> {
    let child = build_command(spec)
        .spawn()
        .map_err(|source| LaunchError::Spawn {
            program: spec.program.clone(),
            source,
        })?;
    Ok(LaunchResult {
        program: spec.program.clone(),
        pid: child.id(),
    })
}

/// Tauri command invoked from the frontend "Launch Test Game" button.
///
/// Declared `async` so Tauri runs it on its async runtime rather than the WebView
/// event loop. The spawn itself does not wait for the child to exit, so control
/// returns to the UI as soon as the process is created — satisfying the "spawns
/// asynchronously without blocking the UI" acceptance criterion. The typed
/// [`LaunchError`] is stringified only here, at the IPC boundary.
#[tauri::command]
pub async fn launch_test_game() -> Result<LaunchResult, String> {
    let spec = resolve_from_env();
    spawn(&spec).map_err(|e| e.to_string())
}

/// Tauri command invoked when the player launches a specific Release (e.g. from a
/// Playlist). Loads the Catalog, resolves the Release's Deck, and spawns it.
///
/// This is the real-Deck launch path that Playlist navigation (issue #5) needs:
/// unlike [`launch_test_game`]'s hardcoded placeholder, the executable and its
/// arguments come from the [`Deck`] configured for the Release's platform. The
/// typed errors are stringified only here, at the IPC boundary.
#[tauri::command]
pub async fn launch_release(
    app: tauri::AppHandle,
    release_id: String,
) -> Result<LaunchResult, String> {
    let catalog = crate::catalog::load_catalog(app).await?;
    let spec = resolve_launch(&catalog, &release_id).map_err(|e| e.to_string())?;
    spawn(&spec).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::ReleaseType;

    fn release(id: &str, platform: &str, file_path: &str) -> Release {
        Release {
            id: id.to_string(),
            game_id: "game".to_string(),
            title: id.to_string(),
            region: None,
            platform: platform.to_string(),
            revision: None,
            release_type: ReleaseType::Retail,
            publisher: None,
            file_path: file_path.to_string(),
            media: None,
        }
    }

    fn deck(platform: &str, executable: &str, arguments: &[&str]) -> Deck {
        Deck {
            id: format!("{platform}-deck"),
            platform: platform.to_string(),
            executable_path: executable.to_string(),
            arguments: arguments.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn catalog_with_snes() -> Catalog {
        Catalog {
            releases: vec![release("smb3-mix", "snes", "smb3/mix.sfc")],
            decks: vec![deck("snes", "snes9x", &["--fullscreen"])],
            ..Catalog::default()
        }
    }

    #[test]
    fn resolve_release_spec_uses_deck_executable_then_deck_args_then_file() {
        let r = release("smb3-mix", "snes", "smb3/mix.sfc");
        let d = deck("snes", "snes9x", &["--fullscreen"]);
        let spec = resolve_release_spec(&r, &d);
        assert_eq!(spec.program, "snes9x");
        assert_eq!(
            spec.args,
            vec!["--fullscreen".to_string(), "smb3/mix.sfc".to_string()]
        );
    }

    #[test]
    fn resolve_launch_builds_spec_for_a_known_release() {
        let catalog = catalog_with_snes();
        let spec = resolve_launch(&catalog, "smb3-mix").expect("release is launchable");
        assert_eq!(spec.program, "snes9x");
        assert_eq!(spec.args.last().map(String::as_str), Some("smb3/mix.sfc"));
    }

    #[test]
    fn resolve_launch_errors_when_release_is_unknown() {
        let catalog = catalog_with_snes();
        let err = resolve_launch(&catalog, "does-not-exist").expect_err("unknown release errors");
        assert!(matches!(err, LaunchError::ReleaseNotFound { .. }));
    }

    #[test]
    fn resolve_launch_errors_when_no_deck_matches_the_platform() {
        // A release whose platform has no configured Deck cannot be launched.
        let catalog = Catalog {
            releases: vec![release("orphan", "gamecube", "gc/game.iso")],
            decks: vec![deck("snes", "snes9x", &[])],
            ..Catalog::default()
        };
        let err = resolve_launch(&catalog, "orphan").expect_err("missing deck errors");
        match err {
            LaunchError::NoDeckForPlatform {
                release_id,
                platform,
            } => {
                assert_eq!(release_id, "orphan");
                assert_eq!(platform, "gamecube");
            }
            other => panic!("expected NoDeckForPlatform, got {other:?}"),
        }
    }

    #[test]
    fn launch_error_messages_name_the_release_and_platform() {
        let not_found = LaunchError::ReleaseNotFound {
            release_id: "ghost".to_string(),
        }
        .to_string();
        assert!(not_found.contains("ghost"), "message was: {not_found}");

        let no_deck = LaunchError::NoDeckForPlatform {
            release_id: "orphan".to_string(),
            platform: "gamecube".to_string(),
        }
        .to_string();
        assert!(no_deck.contains("gamecube"), "message was: {no_deck}");
        assert!(no_deck.contains("orphan"), "message was: {no_deck}");
    }

    #[test]
    fn resolves_to_platform_default_when_no_override() {
        let spec = resolve_spec(None, None);
        assert_eq!(spec, default_spec());
    }

    #[test]
    fn default_program_is_present_and_non_empty() {
        let spec = resolve_spec(None, None);
        assert!(!spec.program.trim().is_empty());
    }

    #[test]
    fn command_override_replaces_program() {
        let spec = resolve_spec(Some("retroarch".to_string()), None);
        assert_eq!(spec.program, "retroarch");
        assert!(spec.args.is_empty());
    }

    #[test]
    fn command_override_is_trimmed() {
        let spec = resolve_spec(Some("  retroarch  ".to_string()), None);
        assert_eq!(spec.program, "retroarch");
    }

    #[test]
    fn blank_command_override_falls_back_to_default() {
        let spec = resolve_spec(Some("   ".to_string()), None);
        assert_eq!(spec, default_spec());
    }

    #[test]
    fn args_override_is_whitespace_split() {
        let spec = resolve_spec(
            Some("emu".to_string()),
            Some("-L core.dll /roms/game.sfc".to_string()),
        );
        assert_eq!(
            spec.args,
            vec![
                "-L".to_string(),
                "core.dll".to_string(),
                "/roms/game.sfc".to_string()
            ]
        );
    }

    #[test]
    fn args_override_applies_to_default_program() {
        let spec = resolve_spec(None, Some("extra".to_string()));
        assert_eq!(spec.program, default_spec().program);
        assert_eq!(spec.args, vec!["extra".to_string()]);
    }

    #[test]
    fn launch_error_display_names_the_program() {
        let err = LaunchError::Spawn {
            program: "retroarch".to_string(),
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "no such file"),
        };
        let message = err.to_string();
        assert!(message.contains("retroarch"), "message was: {message}");
        assert!(message.contains("no such file"), "message was: {message}");
    }

    #[test]
    fn build_command_carries_program_and_args() {
        let spec = LaunchSpec {
            program: "emu".to_string(),
            args: vec!["-L".to_string(), "game.sfc".to_string()],
        };
        let command = build_command(&spec);
        assert_eq!(command.get_program(), "emu");
        let args: Vec<_> = command.get_args().map(|a| a.to_string_lossy()).collect();
        assert_eq!(args, vec!["-L", "game.sfc"]);
    }
}
