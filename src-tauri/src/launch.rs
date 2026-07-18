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

use crate::catalog::{Catalog, Deck, DeckKind, Release};
use serde::Serialize;
use std::fmt;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

/// Argument tokens replaced with the resolved ROM path when building a launch
/// spec. Either spelling works, so a Deck can read as `-L core "{rom}"` or
/// `-- {file}`. When none appear in a Deck's arguments, the ROM path is appended
/// as the final argument instead (the pre-Phase-2 behaviour, kept for backward
/// compatibility).
pub const ROM_PLACEHOLDERS: [&str; 2] = ["{rom}", "{file}"];

/// Environment variable overriding the program to launch.
pub const LAUNCH_CMD_ENV: &str = "PIXELCACHE_LAUNCH_CMD";
/// Environment variable overriding the arguments passed to the program.
/// Arguments are whitespace-separated (sufficient for the tracer bullet; the
/// real Deck schema carries a structured `arguments: Vec<String>`).
pub const LAUNCH_ARGS_ENV: &str = "PIXELCACHE_LAUNCH_ARGS";
/// Environment variable naming a fallback Vault root directory for Releases that
/// have no `vault_id` (manual additions). A Release discovered by a scan resolves
/// its `filePath` against its own [`crate::catalog::Vault`]; only manual Releases
/// consult this. When unset, such `filePath`s are passed to the Deck executable
/// as-is (relative to the process working directory).
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
    /// A Deck override (a [`Release::deck_id`] or an explicit launch-time choice)
    /// referenced a Deck id that is not in the Catalog.
    UnknownDeck { deck_id: String },
    /// A test-launch was requested for a [`DeckKind::DirectLaunch`] Deck, which
    /// has no emulator of its own to spawn without a Release.
    NotTestable { deck_id: String },
    /// A second launch request arrived while another child was still being
    /// watched. The Execution Engine intentionally supports only one in-flight
    /// game (issue #9) — overlapping launches would race to re-show the window
    /// when their respective children exit, with whichever exits first winning.
    AlreadyInFlight,
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
            LaunchError::UnknownDeck { deck_id } => {
                write!(f, "no deck '{deck_id}' in the catalog")
            }
            LaunchError::NotTestable { deck_id } => {
                write!(
                    f,
                    "deck '{deck_id}' launches the game directly and has no emulator to test"
                )
            }
            LaunchError::AlreadyInFlight => {
                write!(f, "a launch is already in flight")
            }
        }
    }
}

impl std::error::Error for LaunchError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            LaunchError::Spawn { source, .. } => Some(source),
            LaunchError::UnknownRelease { .. }
            | LaunchError::NoDeckForPlatform { .. }
            | LaunchError::UnknownDeck { .. }
            | LaunchError::NotTestable { .. }
            | LaunchError::AlreadyInFlight => None,
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

/// Substitute the ROM path into a Deck's arguments.
///
/// Every argument containing a [`ROM_PLACEHOLDERS`] token has that token replaced
/// with `rom_path`; the returned flag reports whether *any* substitution
/// happened, so the caller can decide whether to still append the ROM path (the
/// backward-compatible "append last" behaviour when a Deck carries no
/// placeholder). Pure.
fn substitute_rom_placeholder(arguments: &[String], rom_path: &str) -> (Vec<String>, bool) {
    let mut replaced = false;
    let args = arguments
        .iter()
        .map(|arg| {
            let mut out = arg.clone();
            for token in ROM_PLACEHOLDERS {
                if out.contains(token) {
                    out = out.replace(token, rom_path);
                    replaced = true;
                }
            }
            out
        })
        .collect();
    (args, replaced)
}

/// Choose the [`Deck`] a Release launches under.
///
/// Precedence: an explicit launch-time `deck_override`, then the Release's stored
/// [`Release::deck_id`], then the platform's default Deck
/// ([`crate::catalog::Deck::is_default`]), then simply the first Deck for the
/// platform. An override naming a missing Deck is an error rather than a silent
/// fall-through, so a typo surfaces instead of quietly launching the wrong core.
fn select_deck<'a>(
    catalog: &'a Catalog,
    release: &Release,
    deck_override: Option<&str>,
) -> Result<&'a Deck, LaunchError> {
    if let Some(id) = deck_override.or(release.deck_id.as_deref()) {
        return catalog
            .decks
            .iter()
            .find(|d| d.id == id)
            .ok_or_else(|| LaunchError::UnknownDeck {
                deck_id: id.to_string(),
            });
    }

    let platform_decks: Vec<&Deck> = catalog
        .decks
        .iter()
        .filter(|d| d.platform == release.platform)
        .collect();
    platform_decks
        .iter()
        .find(|d| d.is_default)
        .or_else(|| platform_decks.first())
        .copied()
        .ok_or_else(|| LaunchError::NoDeckForPlatform {
            platform: release.platform.clone(),
        })
}

/// Resolve a Release's `filePath` to an absolute ROM path.
///
/// A Release discovered by a scan carries a `vault_id`; its `filePath` resolves
/// against that [`crate::catalog::Vault`]'s `path`. A manual Release (no
/// `vault_id`) falls back to `fallback_root` (the [`VAULT_DIR_ENV`] override),
/// and failing that is passed through as-is.
fn resolve_rom_path(catalog: &Catalog, release: &Release, fallback_root: Option<&str>) -> String {
    let vault_root = release
        .vault_id
        .as_deref()
        .and_then(|id| catalog.vaults.iter().find(|v| v.id == id))
        .map(|v| v.path.as_str())
        .or(fallback_root);

    match vault_root {
        Some(root) if !root.trim().is_empty() => Path::new(root.trim())
            .join(&release.file_path)
            .to_string_lossy()
            .into_owned(),
        _ => release.file_path.clone(),
    }
}

/// Decide what to launch for a specific Release.
///
/// The Deck chosen by [`select_deck`] decides *how* the resolved ROM path is
/// used:
///
/// * A [`DeckKind::Emulator`] Deck runs its `executable_path`; the ROM path is
///   substituted into any `{rom}` / `{file}` argument placeholder, or appended as
///   the final argument when the Deck has none.
/// * A [`DeckKind::DirectLaunch`] Deck runs the ROM path *as the program* (a PC
///   game `.exe` or self-contained executable); its arguments still honour the
///   placeholder but the ROM is never appended, since it is already the program.
///
/// Pure over its inputs so every failure mode (unknown release, missing deck,
/// unknown override) and the exact argv ordering are unit-testable without
/// spawning anything, per the PRD's "Process Launch Mocking" testing decision.
pub fn resolve_release_spec(
    catalog: &Catalog,
    release_id: &str,
    fallback_root: Option<&str>,
    deck_override: Option<&str>,
) -> Result<LaunchSpec, LaunchError> {
    let release = catalog
        .releases
        .iter()
        .find(|r| r.id == release_id)
        .ok_or_else(|| LaunchError::UnknownRelease {
            release_id: release_id.to_string(),
        })?;

    let deck = select_deck(catalog, release, deck_override)?;
    let rom_path = resolve_rom_path(catalog, release, fallback_root);
    let (mut args, replaced) = substitute_rom_placeholder(&deck.arguments, &rom_path);

    match deck.kind {
        DeckKind::DirectLaunch => Ok(LaunchSpec {
            program: rom_path,
            args,
        }),
        DeckKind::Emulator => {
            if !replaced {
                args.push(rom_path);
            }
            Ok(LaunchSpec {
                program: deck.executable_path.clone(),
                args,
            })
        }
    }
}

/// Build a spec that exercises a Deck's executable *without* a real Release — the
/// "Test launch" action on the Decks settings screen, used to confirm an emulator
/// is installed and configured. The Deck's placeholder arguments are dropped
/// (there is no ROM to substitute), leaving just its fixed flags.
///
/// A [`DeckKind::DirectLaunch`] Deck has no emulator of its own, so there is
/// nothing to test — that is a [`LaunchError::NotTestable`].
pub fn resolve_deck_test_spec(deck: &Deck) -> Result<LaunchSpec, LaunchError> {
    match deck.kind {
        DeckKind::DirectLaunch => Err(LaunchError::NotTestable {
            deck_id: deck.id.clone(),
        }),
        DeckKind::Emulator => {
            let args = deck
                .arguments
                .iter()
                .filter(|arg| !ROM_PLACEHOLDERS.iter().any(|token| arg.contains(token)))
                .cloned()
                .collect();
            Ok(LaunchSpec {
                program: deck.executable_path.clone(),
                args,
            })
        }
    }
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
    /// Returns `true` if the window can still be operated on (i.e. it has not
    /// been destroyed by the user closing it mid-launch). Defaults to `true` so
    /// fakes in unit tests stay trivial; the real implementation re-probes the
    /// Tauri window registry — see the impl below. Used by the exit-watcher to
    /// deliberately skip `show()` when there is no window to restore, instead of
    /// falling through the generic "failed to restore window after launch" log
    /// line by accident (issue #9).
    fn is_alive(&self) -> bool {
        true
    }
}

impl RestorableWindow for tauri::WebviewWindow {
    fn hide(&self) -> Result<(), String> {
        tauri::WebviewWindow::hide(self).map_err(|e| e.to_string())
    }

    fn show(&self) -> Result<(), String> {
        tauri::WebviewWindow::show(self).map_err(|e| e.to_string())
    }

    fn is_alive(&self) -> bool {
        // Tauri unregisters closed windows from the app's window registry, so a
        // re-fetch by label returns `None` once the user closes the window
        // mid-launch. `get_webview_window` is the canonical "is this handle
        // still pointing at a real window?" check in Tauri v2 — there is no
        // dedicated `is_destroyed` on `WebviewWindow`.
        self.app_handle().get_webview_window(self.label()).is_some()
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
#[allow(dead_code)] // only invoked from unit tests in this crate; kept as the
                    // canonical "no on_exit hook" wrapper around `wait_and_restore_then`.
pub fn wait_and_restore<C: WaitableChild, W: RestorableWindow>(child: C, window: W) {
    wait_and_restore_then(child, window, || ());
}

/// [`wait_and_restore`] with an `on_exit` hook that runs **after** the window is
/// restored — the ordering matters: bookkeeping (like recording a play session)
/// must never delay the window coming back, and the hook still runs even when
/// the wait or the restore failed, since a session was genuinely played either
/// way.
pub fn wait_and_restore_then<C, W, F>(mut child: C, window: W, on_exit: F)
where
    C: WaitableChild,
    W: RestorableWindow,
    F: FnOnce(),
{
    let pid = child.id();
    log_if_err(
        &format!("failed to wait on launched process {pid}"),
        child.wait(),
    );
    if window.is_alive() {
        log_if_err("failed to restore window after launch", window.show());
    } else {
        // The window was destroyed while the game ran — there is nothing to
        // restore, and any call to `show()` would only land on the generic
        // "failed to restore window after launch" line by accident. Log the
        // situation deliberately so it's grep-able alongside the rest of the
        // pixelcache: prefix (issue #9).
        eprintln!("pixelcache: window closed during launch (pid {pid}); nothing to restore");
    }
    on_exit();
}

/// RAII guard for the single-launch slot. Holds the in-flight `AtomicBool`
/// while a game is being watched; drops it when the guard is dropped. The
/// three Tauri launch commands all `try_acquire` one before spawning and
/// disarm it once the exit-watcher takes over, so the flag flips on
/// exactly one boundary: acquire → watcher-spawned, watcher-spawned → exit.
///
/// Issue #9 motivated this — without it, two overlapping `launch_test_game`
/// (or any combination of the three launch entry points) would each detach
/// their own background watcher, and whichever child exited first would
/// re-show the window while the other child kept running invisibly.
///
/// [`disarm`](LaunchGuard::disarm) hands the responsibility for clearing the
/// flag to the watcher thread, so a `LaunchGuard` that survives long enough
/// to reach the watcher does not double-release.
struct LaunchGuard {
    flag: Option<Arc<std::sync::atomic::AtomicBool>>,
}

impl LaunchGuard {
    /// Try to claim the single-launch slot. Returns `None` if another launch is
    /// already in flight — the caller surfaces that as
    /// [`LaunchError::AlreadyInFlight`] without touching the flag.
    fn try_acquire(flag: Arc<std::sync::atomic::AtomicBool>) -> Option<Self> {
        use std::sync::atomic::Ordering;
        if flag
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            Some(LaunchGuard { flag: Some(flag) })
        } else {
            None
        }
    }

    /// Transfer responsibility for clearing the flag to the watcher thread.
    /// The guard must be disarmed exactly once — after this call, `Drop` does
    /// not touch the flag.
    fn disarm(mut self) -> Arc<std::sync::atomic::AtomicBool> {
        self.flag.take().expect("LaunchGuard::disarm called twice")
    }
}

impl Drop for LaunchGuard {
    fn drop(&mut self) {
        use std::sync::atomic::Ordering;
        // If `disarm` was never called, no watcher took over — release the
        // flag so a future launch can proceed. This is the safety net for
        // every path between `try_acquire` and `disarm`, including a panic in
        // the spawning code or a spawn failure that never reached the watcher.
        if let Some(flag) = self.flag.take() {
            flag.store(false, Ordering::SeqCst);
        }
    }
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
pub async fn launch_test_game(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LaunchInFlight>,
) -> Result<LaunchResult, String> {
    // Claim the single-launch slot before doing any work — a second concurrent
    // request would otherwise detach its own background watcher, and whichever
    // child exited first would re-show the window while the other child kept
    // running invisibly (issue #9).
    let guard = LaunchGuard::try_acquire(state.flag.clone())
        .ok_or_else(|| LaunchError::AlreadyInFlight.to_string())?;

    let spec = resolve_from_env();
    let program = spec.program.clone();
    launch_with(
        program,
        window,
        || spawn(&spec),
        move |child, win| {
            // Hand the flag to the watcher thread — it clears it after the
            // child exits and the window is restored. From here on, a spawn
            // failure path lets `guard`'s Drop release the flag instead.
            let flag = guard.disarm();
            std::thread::spawn(move || {
                wait_and_restore_then(child, win, move || {
                    flag.store(false, Ordering::SeqCst);
                });
            });
        },
    )
    .map_err(|e| e.to_string())
}

/// Tauri command invoked when the user clicks Play on a Release in the Game
/// details panel. Looks the Release up in the bundled Catalog, resolves the
/// Deck for its platform, and spawns the configured executable with the release
/// file appended. As with [`launch_test_game`], the window is hidden on a
/// successful spawn and restored by the background exit-watcher when the game
/// exits (issue #7). A resolution failure (unknown release, missing Deck) returns
/// before the window is ever touched, so the UI stays visible.
/// Play-session recording is layered on here (not in [`launch_test_game`] or
/// [`test_launch_deck`]): only a real Release launch counts as play activity.
/// The session clock starts at spawn and stops when the exit-watcher sees the
/// child die; [`crate::playhistory::record_session_end`] then persists the
/// session and notifies the frontend — after the window is restored, so
/// bookkeeping can never delay the UI's return.
#[tauri::command]
pub async fn launch_release(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LaunchInFlight>,
    release_id: String,
    deck_id: Option<String>,
) -> Result<LaunchResult, String> {
    // Same single-launch guard as `launch_test_game` — see that command for
    // the issue #9 rationale.
    let guard = LaunchGuard::try_acquire(state.flag.clone())
        .ok_or_else(|| LaunchError::AlreadyInFlight.to_string())?;

    let catalog = crate::catalog::load_bundled_catalog(&app)?;
    let vault_root = std::env::var(VAULT_DIR_ENV).ok();
    let spec = resolve_release_spec(
        &catalog,
        &release_id,
        vault_root.as_deref(),
        deck_id.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    let program = spec.program.clone();
    let started = std::time::Instant::now();
    launch_with(
        program,
        window,
        || spawn(&spec),
        move |child, win| {
            // Disarm the guard so its Drop doesn't race the watcher; the flag
            // is cleared in the `on_exit` hook alongside play-history recording
            // so the ordering stays "restore window first, then bookkeeping".
            let flag = guard.disarm();
            std::thread::spawn(move || {
                wait_and_restore_then(child, win, move || {
                    crate::playhistory::record_session_end(&app, &release_id, started.elapsed());
                    flag.store(false, Ordering::SeqCst);
                });
            });
        },
    )
    .map_err(|e| e.to_string())
}

/// Tauri command backing the "Test launch" button on the Decks settings screen.
/// Spawns the Deck's executable (with its fixed, non-placeholder arguments) so
/// the user can confirm an emulator is installed and configured before a real
/// game depends on it. Like [`launch_release`], a successful spawn hides the
/// window and the background exit-watcher restores it when the test process
/// exits. The Deck comes straight from the (unsaved) settings form, so a Deck can
/// be tested before it is persisted.
#[tauri::command]
pub async fn test_launch_deck(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LaunchInFlight>,
    deck: Deck,
) -> Result<LaunchResult, String> {
    // Same single-launch guard as the other two entry points — `test_launch_deck`
    // shares the Tauri window and hide/restore machinery, so it would race a
    // running game just as easily (issue #9).
    let guard = LaunchGuard::try_acquire(state.flag.clone())
        .ok_or_else(|| LaunchError::AlreadyInFlight.to_string())?;

    let spec = resolve_deck_test_spec(&deck).map_err(|e| e.to_string())?;
    let program = spec.program.clone();
    launch_with(
        program,
        window,
        || spawn(&spec),
        move |child, win| {
            let flag = guard.disarm();
            std::thread::spawn(move || {
                wait_and_restore_then(child, win, move || {
                    flag.store(false, Ordering::SeqCst);
                });
            });
        },
    )
    .map_err(|e| e.to_string())
}

/// Tauri-managed state holding the single-launch in-flight flag.
///
/// Registered with `.manage(LaunchInFlight::default())` in `lib.rs` and pulled
/// out of every launch command as `tauri::State<'_, LaunchInFlight>`. The
/// `Arc<AtomicBool>` is shared between commands and (eventually) the watcher
/// thread that clears it on child exit; `#[derive(Default)]` lets the manager
/// build it without arguments at startup.
#[derive(Default)]
pub struct LaunchInFlight {
    pub flag: Arc<AtomicBool>,
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
        let spec = resolve_release_spec(&sample_catalog(), "star-fox-64-ntsc", None, None)
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
        let spec =
            resolve_release_spec(&sample_catalog(), "star-fox-64-ntsc", Some("/vault"), None)
                .expect("release resolves");
        let rom = spec.args.last().expect("rom path appended");
        assert!(
            rom.starts_with("/vault") && rom.contains("ntsc.z64"),
            "rom path was: {rom}"
        );
    }

    #[test]
    fn release_spec_blank_vault_root_is_ignored() {
        let spec = resolve_release_spec(&sample_catalog(), "star-fox-64-ntsc", Some("   "), None)
            .expect("release resolves");
        assert_eq!(spec.args.last().unwrap(), "star-fox-64/ntsc.z64");
    }

    /// A catalog whose n64 Release belongs to a Vault, exercising per-Vault
    /// `filePath` resolution.
    fn vault_catalog() -> Catalog {
        crate::catalog::Catalog::from_json(
            r#"{
                "releases": [
                    {
                        "id": "star-fox-64-ntsc", "gameId": "star-fox-64",
                        "title": "Star Fox 64", "platform": "n64",
                        "releaseType": "retail", "vaultId": "n64-vault",
                        "filePath": "star-fox-64/ntsc.z64"
                    }
                ],
                "decks": [
                    {"id": "n64-mupen", "platform": "n64",
                     "executablePath": "mupen64plus", "arguments": ["--fullscreen"]}
                ],
                "vaults": [
                    {"id": "n64-vault", "platform": "n64", "path": "/mnt/roms/n64"}
                ]
            }"#,
        )
        .expect("vault catalog json is valid")
    }

    #[test]
    fn release_spec_resolves_file_path_against_its_vault() {
        // The Release's own Vault path wins even over the env fallback root.
        let spec =
            resolve_release_spec(&vault_catalog(), "star-fox-64-ntsc", Some("/ignored"), None)
                .expect("release resolves");
        let rom = spec.args.last().expect("rom path appended");
        assert!(
            rom.starts_with("/mnt/roms/n64") && rom.contains("ntsc.z64"),
            "rom path was: {rom}"
        );
    }

    #[test]
    fn release_spec_falls_back_to_env_root_for_manual_releases() {
        // sample_catalog's Release has no vault_id, so the env fallback applies.
        let spec = resolve_release_spec(
            &sample_catalog(),
            "star-fox-64-ntsc",
            Some("/fallback"),
            None,
        )
        .expect("release resolves");
        let rom = spec.args.last().expect("rom path appended");
        assert!(rom.starts_with("/fallback"), "rom path was: {rom}");
    }

    #[test]
    fn release_spec_unknown_release_is_an_error() {
        let err = resolve_release_spec(&sample_catalog(), "does-not-exist", None, None)
            .expect_err("unknown release should fail");
        assert!(matches!(err, LaunchError::UnknownRelease { .. }));
        assert!(err.to_string().contains("does-not-exist"));
    }

    #[test]
    fn release_spec_missing_deck_for_platform_is_an_error() {
        let err = resolve_release_spec(&sample_catalog(), "mario-mix", None, None)
            .expect_err("snes has no deck configured");
        assert!(matches!(err, LaunchError::NoDeckForPlatform { .. }));
        assert!(err.to_string().contains("snes"), "message: {err}");
    }

    // --- Phase 2: placeholders, direct launch, deck selection -------------------

    /// A catalog whose n64 Deck uses a `{rom}` placeholder mid-command (like
    /// RetroArch's `-L <core> "<rom>"`), plus a spare deck for override tests.
    fn placeholder_catalog() -> Catalog {
        crate::catalog::Catalog::from_json(
            r#"{
                "releases": [
                    {"id": "sf64", "gameId": "g", "title": "Star Fox 64",
                     "platform": "n64", "releaseType": "retail",
                     "filePath": "star-fox-64/ntsc.z64"}
                ],
                "decks": [
                    {"id": "n64-retroarch", "platform": "n64",
                     "executablePath": "retroarch",
                     "arguments": ["-L", "mupen64plus_next.so", "{rom}"]}
                ]
            }"#,
        )
        .expect("placeholder catalog json is valid")
    }

    #[test]
    fn release_spec_substitutes_rom_placeholder_in_place() {
        let spec = resolve_release_spec(&placeholder_catalog(), "sf64", Some("/vault"), None)
            .expect("release resolves");
        assert_eq!(spec.program, "retroarch");
        // The placeholder is replaced in place; the ROM is NOT also appended.
        assert_eq!(spec.args.len(), 3);
        assert_eq!(spec.args[0], "-L");
        assert_eq!(spec.args[1], "mupen64plus_next.so");
        assert!(
            spec.args[2].starts_with("/vault") && spec.args[2].contains("ntsc.z64"),
            "rom arg was: {}",
            spec.args[2]
        );
    }

    #[test]
    fn release_spec_accepts_the_file_placeholder_spelling() {
        let catalog = crate::catalog::Catalog::from_json(
            r#"{
                "releases": [
                    {"id": "r", "gameId": "g", "title": "T", "platform": "ps1",
                     "releaseType": "retail", "filePath": "game.chd"}
                ],
                "decks": [
                    {"id": "duck", "platform": "ps1", "executablePath": "duckstation",
                     "arguments": ["--", "{file}"]}
                ]
            }"#,
        )
        .expect("valid catalog");
        let spec = resolve_release_spec(&catalog, "r", None, None).expect("resolves");
        assert_eq!(spec.args, vec!["--".to_string(), "game.chd".to_string()]);
    }

    #[test]
    fn release_spec_direct_launch_runs_the_rom_as_the_program() {
        let catalog = crate::catalog::Catalog::from_json(
            r#"{
                "releases": [
                    {"id": "witness", "gameId": "g", "title": "The Witness",
                     "platform": "pc", "releaseType": "retail",
                     "filePath": "The Witness/witness.exe"}
                ],
                "decks": [
                    {"id": "pc-direct", "platform": "pc", "kind": "directLaunch",
                     "arguments": ["--fullscreen"], "default": true}
                ]
            }"#,
        )
        .expect("valid catalog");
        let spec = resolve_release_spec(&catalog, "witness", Some("/games"), None)
            .expect("release resolves");
        // The ROM itself is the program; args are the deck's own, ROM not appended.
        assert!(
            spec.program.starts_with("/games") && spec.program.ends_with("witness.exe"),
            "program was: {}",
            spec.program
        );
        assert_eq!(spec.args, vec!["--fullscreen".to_string()]);
    }

    /// A catalog with two n64 decks — a default and an alternative — plus a
    /// release that overrides to the alternative by id.
    fn multi_deck_catalog() -> Catalog {
        crate::catalog::Catalog::from_json(
            r#"{
                "releases": [
                    {"id": "plain", "gameId": "g", "title": "Plain",
                     "platform": "n64", "releaseType": "retail", "filePath": "plain.z64"},
                    {"id": "pinned", "gameId": "g", "title": "Pinned",
                     "platform": "n64", "releaseType": "hack", "filePath": "pinned.z64",
                     "deckId": "n64-alt"}
                ],
                "decks": [
                    {"id": "n64-alt", "platform": "n64", "executablePath": "parallel-launcher"},
                    {"id": "n64-default", "platform": "n64",
                     "executablePath": "mupen64plus", "default": true}
                ]
            }"#,
        )
        .expect("multi-deck catalog json is valid")
    }

    #[test]
    fn release_spec_prefers_the_platform_default_deck() {
        // `n64-default` is listed second but is marked default, so it wins over
        // the first-listed `n64-alt`.
        let spec =
            resolve_release_spec(&multi_deck_catalog(), "plain", None, None).expect("resolves");
        assert_eq!(spec.program, "mupen64plus");
    }

    #[test]
    fn release_spec_honours_a_stored_release_deck_override() {
        let spec =
            resolve_release_spec(&multi_deck_catalog(), "pinned", None, None).expect("resolves");
        assert_eq!(spec.program, "parallel-launcher");
    }

    #[test]
    fn release_spec_explicit_override_beats_default_and_stored() {
        // The launch-time override wins even over the release's own deckId.
        let spec = resolve_release_spec(&multi_deck_catalog(), "pinned", None, Some("n64-default"))
            .expect("resolves");
        assert_eq!(spec.program, "mupen64plus");
    }

    #[test]
    fn release_spec_falls_back_to_first_deck_when_none_is_default() {
        // No deck is marked default, so the first-listed platform deck is used.
        let spec =
            resolve_release_spec(&placeholder_catalog(), "sf64", None, None).expect("resolves");
        assert_eq!(spec.program, "retroarch");
    }

    #[test]
    fn release_spec_unknown_deck_override_is_an_error() {
        let err = resolve_release_spec(&multi_deck_catalog(), "plain", None, Some("nope"))
            .expect_err("unknown deck override should fail");
        assert!(matches!(err, LaunchError::UnknownDeck { .. }));
        assert!(err.to_string().contains("nope"), "message: {err}");
    }

    #[test]
    fn deck_test_spec_runs_executable_without_placeholder_args() {
        let deck = Deck {
            id: "n64".to_string(),
            platform: "n64".to_string(),
            executable_path: "retroarch".to_string(),
            arguments: vec!["-L".to_string(), "core.so".to_string(), "{rom}".to_string()],
            kind: DeckKind::Emulator,
            is_default: true,
        };
        let spec = resolve_deck_test_spec(&deck).expect("emulator deck is testable");
        assert_eq!(spec.program, "retroarch");
        // The `{rom}` placeholder arg is dropped — there is no ROM to test with.
        assert_eq!(spec.args, vec!["-L".to_string(), "core.so".to_string()]);
    }

    #[test]
    fn deck_test_spec_rejects_a_direct_launch_deck() {
        let deck = Deck {
            id: "pc".to_string(),
            platform: "pc".to_string(),
            executable_path: String::new(),
            arguments: vec![],
            kind: DeckKind::DirectLaunch,
            is_default: true,
        };
        let err = resolve_deck_test_spec(&deck).expect_err("direct launch has nothing to test");
        assert!(matches!(err, LaunchError::NotTestable { .. }));
        assert!(err.to_string().contains("pc"), "message: {err}");
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
    /// failure or a mid-launch close. Counters are shared via `Arc` so assertions
    /// survive the window being moved into the watcher. `alive` defaults to
    /// `true` so existing tests keep working unchanged; the closed-mid-launch
    /// test flips it via [`FakeWindow::close_mid_launch`].
    #[derive(Clone)]
    struct FakeWindow {
        hidden: Arc<AtomicUsize>,
        shown: Arc<AtomicUsize>,
        hide_fails: bool,
        alive: Arc<AtomicBool>,
    }

    impl FakeWindow {
        fn new() -> Self {
            FakeWindow {
                hidden: Arc::new(AtomicUsize::new(0)),
                shown: Arc::new(AtomicUsize::new(0)),
                hide_fails: false,
                alive: Arc::new(AtomicBool::new(true)),
            }
        }

        /// Simulate the user closing the Tauri window mid-launch: from this
        /// point on, [`RestorableWindow::is_alive`] returns false.
        fn close_mid_launch(&self) {
            self.alive.store(false, Ordering::SeqCst);
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

        fn is_alive(&self) -> bool {
            self.alive.load(Ordering::SeqCst)
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
    fn wait_and_restore_then_runs_hook_after_window_restore() {
        let child = FakeChild {
            id: 9,
            waited: Arc::new(AtomicBool::new(false)),
            wait_fails: false,
        };
        let window = FakeWindow::new();
        let shown = window.shown.clone();
        let shown_when_hook_ran = Arc::new(AtomicUsize::new(usize::MAX));
        let observed = shown_when_hook_ran.clone();
        let shown_for_hook = shown.clone();

        wait_and_restore_then(child, window, move || {
            // Capture how many `show` calls had happened by hook time: exactly
            // one proves the ordering "restore first, bookkeeping second".
            observed.store(shown_for_hook.load(Ordering::SeqCst), Ordering::SeqCst);
        });

        assert_eq!(shown_when_hook_ran.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn wait_and_restore_then_runs_hook_even_when_wait_fails() {
        // A session was still played even if observing the exit failed; the
        // recording hook must not silently vanish with it.
        let child = FakeChild {
            id: 10,
            waited: Arc::new(AtomicBool::new(false)),
            wait_fails: true,
        };
        let hook_ran = Arc::new(AtomicBool::new(false));
        let flag = hook_ran.clone();

        wait_and_restore_then(child, FakeWindow::new(), move || {
            flag.store(true, Ordering::SeqCst);
        });

        assert!(hook_ran.load(Ordering::SeqCst));
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

    // --- Single-launch guard + mid-launch close (issue #9) ------------------
    //
    // The Execution Engine has three entry points (test game / release play /
    // deck test launch) that all share the same Tauri window and hide/restore
    // machinery. Without a guard, two overlapping launches race each other to
    // re-show the window — whichever child exits first wins, and the later
    // child is left unmanaged. The guard below owns a single in-flight slot and
    // is the unit-testable seam every Tauri command goes through.

    #[test]
    fn launch_guard_acquires_when_flag_is_free() {
        let flag = Arc::new(AtomicBool::new(false));
        let guard = LaunchGuard::try_acquire(flag.clone()).expect("flag was free");
        // The guard must have flipped the flag to true; dropping it clears.
        assert!(flag.load(Ordering::SeqCst));
        drop(guard);
        assert!(!flag.load(Ordering::SeqCst));
    }

    #[test]
    fn launch_guard_rejects_a_second_acquire_while_in_flight() {
        // First acquire succeeds; second one — from the same "concurrent
        // caller" — must observe the flag and back off without flipping it
        // back to false (a guard dropped mid-flight would unblock the next
        // launch before the watched child exits).
        let flag = Arc::new(AtomicBool::new(false));
        let _first = LaunchGuard::try_acquire(flag.clone()).expect("first acquire");
        let second = LaunchGuard::try_acquire(flag.clone());
        assert!(second.is_none(), "second acquire should be rejected");
        assert!(
            flag.load(Ordering::SeqCst),
            "a rejected acquire must not clear the flag"
        );
    }

    #[test]
    fn launch_guard_allows_a_new_acquire_after_drop() {
        // Once the watcher is done and its guard drops, a fresh launch must
        // be allowed again — that's the whole point of releasing on Drop.
        let flag = Arc::new(AtomicBool::new(false));
        drop(LaunchGuard::try_acquire(flag.clone()).unwrap());
        LaunchGuard::try_acquire(flag.clone()).expect("flag was free again");
    }

    #[test]
    fn launch_guard_disarm_transfers_responsibility_to_the_caller() {
        // The watcher thread takes ownership of clearing the flag (so it
        // clears at exactly the right moment — after the child exits and the
        // window is restored). `disarm` must prevent Drop from racing that
        // and clearing the flag too early.
        let flag = Arc::new(AtomicBool::new(false));
        let guard = LaunchGuard::try_acquire(flag.clone()).unwrap();
        let _transferred = guard.disarm();
        // Drop runs now (disarmed) and must NOT clear the flag.
        assert!(
            flag.load(Ordering::SeqCst),
            "disarmed guard must not clear the flag on drop"
        );
    }

    #[test]
    fn wait_and_restore_then_skips_show_when_window_was_closed_mid_launch() {
        // The user closed the Tauri window while the game was running. The
        // exit-watcher must deliberately skip the restore path — not call
        // `show()` on a destroyed window and trip the generic
        // "failed to restore window after launch" log line by accident.
        let child = FakeChild {
            id: 123,
            waited: Arc::new(AtomicBool::new(false)),
            wait_fails: false,
        };
        let window = FakeWindow::new();
        window.close_mid_launch();
        let shown = window.shown.clone();

        wait_and_restore_then(child, window, || {});

        assert_eq!(
            shown.load(Ordering::SeqCst),
            0,
            "show() must be skipped when the window was closed mid-launch"
        );
    }

    #[test]
    fn wait_and_restore_then_still_runs_on_exit_hook_when_window_was_closed_mid_launch() {
        // Closing the window mid-launch must not silently swallow bookkeeping
        // (e.g. play-history recording) — the hook is the same fire-and-forget
        // shape it always was.
        let child = FakeChild {
            id: 124,
            waited: Arc::new(AtomicBool::new(false)),
            wait_fails: false,
        };
        let window = FakeWindow::new();
        window.close_mid_launch();
        let hook_ran = Arc::new(AtomicBool::new(false));
        let probe = hook_ran.clone();

        wait_and_restore_then(child, window, move || {
            probe.store(true, Ordering::SeqCst);
        });

        assert!(hook_ran.load(Ordering::SeqCst));
    }
}
