//! Launch engine.
//!
//! This module owns the logic for turning a launch request into an actual OS
//! process. It is deliberately split into layers so the decision-making is
//! unit-testable without ever spawning a real process (see the PRD's
//! "Process Launch Mocking" testing decision):
//!
//! 1. **Decision** — [`resolve_spec`] (placeholder) / [`resolve_release_spec`]
//!    (Catalog-aware): decide *what* to launch. Pure.
//! 2. [`build_command`] — assemble the argv into a [`Command`]. Pure-ish; no spawn.
//! 3. [`spawn`] — the only function that touches the OS.
//! 4. [`wait_and_restore`] — block on the child, then re-show the window on exit.
//!
//! The Execution Engine (PRD §3) also hides the Tauri window while a game runs
//! and restores it when the child exits. That "hide / wait / restore" flow lives
//! in [`launch_with`], which is generic over two injected dependencies — a
//! [`WaitableChild`] and a [`RestorableWindow`] — so the whole orchestration
//! (including the spawn-fail-safe ordering) is testable with fakes and never needs
//! a real process or a live Tauri window. Both launch commands run through it.
//!
//! The placeholder [`launch_test_game`] (used by the "Launch Test Game" button
//! during local dev) targets a harmless per-platform default overridable via
//! `PIXELCACHE_LAUNCH_CMD` / `PIXELCACHE_LAUNCH_ARGS`. The real launch path is
//! [`launch_release`], which looks a Release up in the bundled Catalog and
//! follows the [`crate::catalog::Deck`] configured for the Release's platform.
//! Release file paths resolve against `PIXELCACHE_VAULT_DIR` when set.

use crate::catalog::Catalog;
use serde::Serialize;
use std::fmt;
use std::path::Path;
use std::process::Command;

/// Environment variable overriding the program to launch.
pub const LAUNCH_CMD_ENV: &str = "PIXELCACHE_LAUNCH_CMD";
/// Environment variable overriding the arguments passed to the program.
/// Arguments are whitespace-separated (sufficient for the tracer bullet; the
/// real Deck schema carries a structured `arguments: Vec<String>`).
pub const LAUNCH_ARGS_ENV: &str = "PIXELCACHE_LAUNCH_ARGS";
/// Environment variable pointing at the local Vault root directory. Release
/// `filePath`s are resolved relative to it; when unset, they are passed to the
/// Deck executable as-is (relative to the process working directory).
pub const VAULT_DIR_ENV: &str = "PIXELCACHE_VAULT_DIR";

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
    /// The requested release id does not exist in the Catalog.
    UnknownRelease { release_id: String },
    /// The Catalog has no Deck configured for the release's platform.
    NoDeckForPlatform { platform: String },
}

impl fmt::Display for LaunchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LaunchError::Spawn { program, source } => {
                write!(f, "failed to launch '{program}': {source}")
            }
            LaunchError::UnknownRelease { release_id } => {
                write!(f, "no release '{release_id}' in the catalog")
            }
            LaunchError::NoDeckForPlatform { platform } => {
                write!(f, "no deck configured for platform '{platform}'")
            }
        }
    }
}

impl std::error::Error for LaunchError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            LaunchError::Spawn { source, .. } => Some(source),
            LaunchError::UnknownRelease { .. } | LaunchError::NoDeckForPlatform { .. } => None,
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

/// Decide what to launch for a specific Release: the Deck configured for the
/// release's platform provides the program and base arguments, and the
/// release's `filePath` — resolved against `vault_root` when one is set — is
/// appended as the final argument.
///
/// Pure over its inputs so every failure mode (unknown release, missing deck)
/// and the exact argv ordering are unit-testable without spawning anything,
/// per the PRD's "Process Launch Mocking" testing decision.
pub fn resolve_release_spec(
    catalog: &Catalog,
    release_id: &str,
    vault_root: Option<&str>,
) -> Result<LaunchSpec, LaunchError> {
    let release = catalog
        .releases
        .iter()
        .find(|r| r.id == release_id)
        .ok_or_else(|| LaunchError::UnknownRelease {
            release_id: release_id.to_string(),
        })?;

    let deck = catalog
        .decks
        .iter()
        .find(|d| d.platform == release.platform)
        .ok_or_else(|| LaunchError::NoDeckForPlatform {
            platform: release.platform.clone(),
        })?;

    let rom_path = match vault_root {
        Some(root) if !root.trim().is_empty() => Path::new(root.trim())
            .join(&release.file_path)
            .to_string_lossy()
            .into_owned(),
        _ => release.file_path.clone(),
    };

    let mut args = deck.arguments.clone();
    args.push(rom_path);

    Ok(LaunchSpec {
        program: deck.executable_path.clone(),
        args,
    })
}

/// Build (but do not spawn) the OS command for a spec.
pub fn build_command(spec: &LaunchSpec) -> Command {
    let mut command = Command::new(&spec.program);
    command.args(&spec.args);
    command
}

/// Spawn the process described by `spec`, returning the live child handle without
/// waiting for it to exit. This is the only function in the module that touches
/// the OS. Ownership of the [`Child`](std::process::Child) is handed back to the
/// caller so the exit-watcher ([`wait_and_restore`]) can block on it later.
pub fn spawn(spec: &LaunchSpec) -> Result<std::process::Child, LaunchError> {
    build_command(spec)
        .spawn()
        .map_err(|source| LaunchError::Spawn {
            program: spec.program.clone(),
            source,
        })
}

/// A spawned child process the launch engine can block on until it exits.
///
/// Abstracted into a trait so [`wait_and_restore`] and [`launch_with`] can be
/// exercised with a fake in unit tests, per the PRD's "Process Launch Mocking"
/// rule. The real implementation is [`std::process::Child`].
pub trait WaitableChild {
    /// Block until the process exits. The exit status is intentionally discarded:
    /// per issue #7 the window is restored regardless of the child's return code.
    fn wait(&mut self) -> std::io::Result<()>;
    /// The operating-system process id — returned to the frontend as the
    /// [`LaunchResult`] pid, and also used when logging a wait failure.
    fn id(&self) -> u32;
}

impl WaitableChild for std::process::Child {
    fn wait(&mut self) -> std::io::Result<()> {
        std::process::Child::wait(self).map(|_status| ())
    }

    fn id(&self) -> u32 {
        std::process::Child::id(self)
    }
}

/// A window the launch engine can hide while a game runs and re-show on exit.
///
/// Abstracted into a trait for the same testability reason as [`WaitableChild`]:
/// the real implementation is Tauri's [`tauri::WebviewWindow`], but tests inject a
/// fake that merely records the hide/show calls. Named `RestorableWindow` (not
/// `Window`) to avoid colliding with Tauri's own [`tauri::Window`] type at use
/// sites.
///
/// Failures are reported as `String` rather than a [`LaunchError`] variant on
/// purpose: they are never propagated to a caller that matches on them — every
/// call site only best-effort *logs* the message (a hidden/shown window is not
/// worth failing a launch over). So there is no typed variant for anyone to
/// consume, and the string carries no dependency on Tauri's error type. The
/// project's "typed error enum" rule (CLAUDE.md) still governs [`LaunchError`],
/// which models the real, matchable launch failures.
pub trait RestorableWindow {
    fn hide(&self) -> Result<(), String>;
    fn show(&self) -> Result<(), String>;
}

impl RestorableWindow for tauri::WebviewWindow {
    fn hide(&self) -> Result<(), String> {
        tauri::WebviewWindow::hide(self).map_err(|e| e.to_string())
    }

    fn show(&self) -> Result<(), String> {
        tauri::WebviewWindow::show(self).map_err(|e| e.to_string())
    }
}

/// Log a best-effort side-effect failure, prefixed for grep-ability.
///
/// The hide / wait / show steps are all fire-and-forget: nothing downstream can
/// act on their errors, so they are recorded here rather than propagated. Keeping
/// the format in one place stops the `pixelcache:` prefix drifting between sites.
fn log_if_err<E: fmt::Display>(context: &str, result: Result<(), E>) {
    if let Err(e) = result {
        eprintln!("pixelcache: {context}: {e}");
    }
}

/// The exit-watcher stage: block on the child, then restore the window.
///
/// Runs on a background thread so it never ties up a Tauri command slot. It is
/// deliberately dependency-injected (generic over [`WaitableChild`] +
/// [`RestorableWindow`]) and side-effect-light so it can be unit-tested
/// synchronously with fakes. Both a failed `wait` and a failed `show` are logged
/// rather than propagated — there is no caller left to handle them, and the window
/// must be re-shown on a best-effort basis no matter how the child exited.
pub fn wait_and_restore<C: WaitableChild, W: RestorableWindow>(mut child: C, window: W) {
    let pid = child.id();
    log_if_err(
        &format!("failed to wait on launched process {pid}"),
        child.wait(),
    );
    log_if_err("failed to restore window after launch", window.show());
}

/// The production exit-watcher: move the child + window onto a background OS
/// thread that blocks on the child and restores the window when it exits.
///
/// A plain OS thread (not `tauri::async_runtime::spawn`) because `Child::wait`
/// blocks the whole thread; keeping it off the async runtime avoids parking a
/// shared tokio worker for the entire game session. Injected into [`launch_with`]
/// so tests can substitute a synchronous watcher instead.
fn watch_on_thread<C, W>(child: C, window: W)
where
    C: WaitableChild + Send + 'static,
    W: RestorableWindow + Send + 'static,
{
    std::thread::spawn(move || wait_and_restore(child, window));
}

/// Orchestrate a launch with the spawn-fail-safe hide/restore ordering.
///
/// The ordering is the crux of issue #7's acceptance criteria: the window is
/// hidden **only after** the spawn succeeds, and the exit-watcher takes over from
/// there. If `spawn_child` fails, the window is never touched, so a spawn failure
/// can never leave the UI stuck in a hidden "half-state". A failed `hide` is
/// non-fatal (logged): the process is already running, so the launch still
/// succeeds and the eventual `show` on exit is simply a no-op.
///
/// `spawn_child` and `watch` are injected so the whole flow can be driven by tests
/// with fakes; in production `watch` is [`watch_on_thread`], which moves the child
/// + window onto a background thread running [`wait_and_restore`].
pub fn launch_with<C, W>(
    program: String,
    window: W,
    spawn_child: impl FnOnce() -> Result<C, LaunchError>,
    watch: impl FnOnce(C, W),
) -> Result<LaunchResult, LaunchError>
where
    C: WaitableChild,
    W: RestorableWindow,
{
    let child = spawn_child()?;
    let pid = child.id();
    log_if_err("failed to hide window on launch", window.hide());
    watch(child, window);
    Ok(LaunchResult { program, pid })
}

/// Tauri command invoked from the frontend "Launch Test Game" button.
///
/// Declared `async` so Tauri runs it on its async runtime rather than the WebView
/// event loop. Tauri injects the invoking [`tauri::WebviewWindow`] as the `window`
/// argument. On a successful spawn the window is hidden and a background thread
/// owns the child until it exits, then re-shows the window — so control returns to
/// the UI immediately (satisfying "spawns asynchronously without blocking the UI")
/// while the game runs full-screen. The typed [`LaunchError`] is stringified only
/// here, at the IPC boundary.
#[tauri::command]
pub async fn launch_test_game(window: tauri::WebviewWindow) -> Result<LaunchResult, String> {
    let spec = resolve_from_env();
    let program = spec.program.clone();
    launch_with(program, window, || spawn(&spec), watch_on_thread).map_err(|e| e.to_string())
}

/// Tauri command invoked when the user clicks Play on a Release in the Game
/// details panel. Looks the Release up in the bundled Catalog, resolves the
/// Deck for its platform, and spawns the configured executable with the release
/// file appended. As with [`launch_test_game`], the window is hidden on a
/// successful spawn and restored by the background exit-watcher when the game
/// exits (issue #7). A resolution failure (unknown release, missing Deck) returns
/// before the window is ever touched, so the UI stays visible.
#[tauri::command]
pub async fn launch_release(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    release_id: String,
) -> Result<LaunchResult, String> {
    let catalog = crate::catalog::load_bundled_catalog(&app)?;
    let vault_root = std::env::var(VAULT_DIR_ENV).ok();
    let spec = resolve_release_spec(&catalog, &release_id, vault_root.as_deref())
        .map_err(|e| e.to_string())?;
    let program = spec.program.clone();
    launch_with(program, window, || spawn(&spec), watch_on_thread).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// A minimal catalog with one game, two releases (n64 + snes), and a deck
    /// for n64 only — enough to exercise every `resolve_release_spec` branch.
    fn sample_catalog() -> Catalog {
        crate::catalog::Catalog::from_json(
            r#"{
                "games": [
                    {"id": "star-fox-64", "primaryReleaseId": "star-fox-64-ntsc", "relations": []}
                ],
                "releases": [
                    {
                        "id": "star-fox-64-ntsc",
                        "gameId": "star-fox-64",
                        "title": "Star Fox 64",
                        "platform": "n64",
                        "releaseType": "retail",
                        "filePath": "star-fox-64/ntsc.z64"
                    },
                    {
                        "id": "mario-mix",
                        "gameId": "star-fox-64",
                        "title": "Mix Hack",
                        "platform": "snes",
                        "releaseType": "hack",
                        "filePath": "hacks/mix.sfc"
                    }
                ],
                "decks": [
                    {
                        "id": "n64-mupen",
                        "platform": "n64",
                        "executablePath": "mupen64plus",
                        "arguments": ["--fullscreen"]
                    }
                ]
            }"#,
        )
        .expect("sample catalog json is valid")
    }

    #[test]
    fn release_spec_uses_deck_program_args_then_file_path() {
        let spec = resolve_release_spec(&sample_catalog(), "star-fox-64-ntsc", None)
            .expect("release resolves");
        assert_eq!(spec.program, "mupen64plus");
        assert_eq!(
            spec.args,
            vec![
                "--fullscreen".to_string(),
                "star-fox-64/ntsc.z64".to_string()
            ]
        );
    }

    #[test]
    fn release_spec_joins_file_path_onto_vault_root() {
        let spec = resolve_release_spec(&sample_catalog(), "star-fox-64-ntsc", Some("/vault"))
            .expect("release resolves");
        let rom = spec.args.last().expect("rom path appended");
        assert!(
            rom.starts_with("/vault") && rom.contains("ntsc.z64"),
            "rom path was: {rom}"
        );
    }

    #[test]
    fn release_spec_blank_vault_root_is_ignored() {
        let spec = resolve_release_spec(&sample_catalog(), "star-fox-64-ntsc", Some("   "))
            .expect("release resolves");
        assert_eq!(spec.args.last().unwrap(), "star-fox-64/ntsc.z64");
    }

    #[test]
    fn release_spec_unknown_release_is_an_error() {
        let err = resolve_release_spec(&sample_catalog(), "does-not-exist", None)
            .expect_err("unknown release should fail");
        assert!(matches!(err, LaunchError::UnknownRelease { .. }));
        assert!(err.to_string().contains("does-not-exist"));
    }

    #[test]
    fn release_spec_missing_deck_for_platform_is_an_error() {
        let err = resolve_release_spec(&sample_catalog(), "mario-mix", None)
            .expect_err("snes has no deck configured");
        assert!(matches!(err, LaunchError::NoDeckForPlatform { .. }));
        assert!(err.to_string().contains("snes"), "message: {err}");
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

    // --- Hide / wait / restore stage (issue #7) ---------------------------------
    //
    // These exercise the exit-watcher and the launch orchestration entirely with
    // fakes: no real process is spawned and no live Tauri window is created, per
    // the PRD's "Process Launch Mocking" rule.

    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;

    /// A fake child that records whether it was waited on and can simulate a
    /// `wait` failure.
    struct FakeChild {
        id: u32,
        waited: Arc<AtomicBool>,
        wait_fails: bool,
    }

    impl WaitableChild for FakeChild {
        fn wait(&mut self) -> std::io::Result<()> {
            self.waited.store(true, Ordering::SeqCst);
            if self.wait_fails {
                Err(std::io::Error::other("wait boom"))
            } else {
                Ok(())
            }
        }

        fn id(&self) -> u32 {
            self.id
        }
    }

    /// A fake window that counts hide/show calls and can simulate a `hide`
    /// failure. Counters are shared via `Arc` so assertions survive the window
    /// being moved into the watcher.
    #[derive(Clone)]
    struct FakeWindow {
        hidden: Arc<AtomicUsize>,
        shown: Arc<AtomicUsize>,
        hide_fails: bool,
    }

    impl FakeWindow {
        fn new() -> Self {
            FakeWindow {
                hidden: Arc::new(AtomicUsize::new(0)),
                shown: Arc::new(AtomicUsize::new(0)),
                hide_fails: false,
            }
        }
    }

    impl RestorableWindow for FakeWindow {
        fn hide(&self) -> Result<(), String> {
            self.hidden.fetch_add(1, Ordering::SeqCst);
            if self.hide_fails {
                Err("hide boom".to_string())
            } else {
                Ok(())
            }
        }

        fn show(&self) -> Result<(), String> {
            self.shown.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    #[test]
    fn wait_and_restore_shows_window_after_child_exits() {
        let waited = Arc::new(AtomicBool::new(false));
        let child = FakeChild {
            id: 42,
            waited: waited.clone(),
            wait_fails: false,
        };
        let window = FakeWindow::new();
        let shown = window.shown.clone();

        wait_and_restore(child, window);

        assert!(waited.load(Ordering::SeqCst), "child was not waited on");
        assert_eq!(shown.load(Ordering::SeqCst), 1, "window was not re-shown");
    }

    #[test]
    fn wait_and_restore_still_shows_window_when_wait_fails() {
        // Even if we can't observe the child's exit cleanly, the window must come
        // back — a stuck-hidden window is the worst outcome.
        let child = FakeChild {
            id: 7,
            waited: Arc::new(AtomicBool::new(false)),
            wait_fails: true,
        };
        let window = FakeWindow::new();
        let shown = window.shown.clone();

        wait_and_restore(child, window);

        assert_eq!(shown.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn successful_launch_hides_window_then_watches() {
        let window = FakeWindow::new();
        let hidden = window.hidden.clone();
        let shown = window.shown.clone();

        let result = launch_with(
            "emu".to_string(),
            window,
            || {
                Ok(FakeChild {
                    id: 1234,
                    waited: Arc::new(AtomicBool::new(false)),
                    wait_fails: false,
                })
            },
            // Run the watcher synchronously so the test can assert the restore.
            wait_and_restore,
        )
        .expect("launch should succeed");

        assert_eq!(result.program, "emu");
        assert_eq!(result.pid, 1234);
        assert_eq!(hidden.load(Ordering::SeqCst), 1, "window was not hidden");
        assert_eq!(shown.load(Ordering::SeqCst), 1, "window was not restored");
    }

    #[test]
    fn spawn_failure_leaves_window_visible() {
        let window = FakeWindow::new();
        let hidden = window.hidden.clone();
        let shown = window.shown.clone();
        let watched = Arc::new(AtomicBool::new(false));
        let watched_probe = watched.clone();

        let result = launch_with::<FakeChild, _>(
            "emu".to_string(),
            window,
            || {
                Err(LaunchError::Spawn {
                    program: "emu".to_string(),
                    source: std::io::Error::new(std::io::ErrorKind::NotFound, "no such file"),
                })
            },
            |_child, _window| watched_probe.store(true, Ordering::SeqCst),
        );

        assert!(result.is_err(), "launch should surface the spawn failure");
        assert_eq!(hidden.load(Ordering::SeqCst), 0, "window must stay visible");
        assert_eq!(shown.load(Ordering::SeqCst), 0);
        assert!(
            !watched.load(Ordering::SeqCst),
            "no watcher should start when spawn fails"
        );
    }

    #[test]
    fn launch_succeeds_even_when_hide_fails() {
        // A failed hide is non-fatal: the process is already running, so the
        // launch still reports success and the watcher still restores on exit.
        let mut window = FakeWindow::new();
        window.hide_fails = true;
        let shown = window.shown.clone();

        let result = launch_with(
            "emu".to_string(),
            window,
            || {
                Ok(FakeChild {
                    id: 99,
                    waited: Arc::new(AtomicBool::new(false)),
                    wait_fails: false,
                })
            },
            wait_and_restore,
        );

        assert!(result.is_ok(), "hide failure should not fail the launch");
        assert_eq!(shown.load(Ordering::SeqCst), 1);
    }
}
