//! Pure launch planning for a Release or Deck.
//!
//! This module hides Deck precedence, Vault path resolution, placeholder
//! substitution, direct-launch semantics, and test-launch filtering. The
//! execution engine receives only a fully resolved [`LaunchPlan`].

use crate::catalog::{Catalog, Deck, DeckKind, Release};
use serde::Serialize;
use std::fmt;
use std::path::Path;

pub const ROM_PLACEHOLDERS: [&str; 2] = ["{rom}", "{file}"];
pub const LAUNCH_CMD_ENV: &str = "PIXELCACHE_LAUNCH_CMD";
pub const LAUNCH_ARGS_ENV: &str = "PIXELCACHE_LAUNCH_ARGS";
pub const VAULT_DIR_ENV: &str = "PIXELCACHE_VAULT_DIR";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LaunchPlan {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchPlanError {
    UnknownRelease { release_id: String },
    NoDeckForPlatform { platform: String },
    UnknownDeck { deck_id: String },
    NotTestable { deck_id: String },
}

impl fmt::Display for LaunchPlanError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownRelease { release_id } => {
                write!(f, "no release '{release_id}' in the catalog")
            }
            Self::NoDeckForPlatform { platform } => {
                write!(f, "no deck configured for platform '{platform}'")
            }
            Self::UnknownDeck { deck_id } => write!(f, "no deck '{deck_id}' in the catalog"),
            Self::NotTestable { deck_id } => write!(
                f,
                "deck '{deck_id}' launches the game directly and has no emulator to test"
            ),
        }
    }
}

impl std::error::Error for LaunchPlanError {}

pub(crate) fn default_plan() -> LaunchPlan {
    if cfg!(target_os = "windows") {
        LaunchPlan {
            program: "notepad.exe".to_string(),
            args: vec![],
        }
    } else if cfg!(target_os = "macos") {
        LaunchPlan {
            program: "open".to_string(),
            args: vec!["-a".to_string(), "TextEdit".to_string()],
        }
    } else {
        LaunchPlan {
            program: "xdg-open".to_string(),
            args: vec![".".to_string()],
        }
    }
}

pub fn resolve_test_plan(
    command_override: Option<String>,
    arguments_override: Option<String>,
) -> LaunchPlan {
    let mut plan = match command_override {
        Some(program) if !program.trim().is_empty() => LaunchPlan {
            program: program.trim().to_string(),
            args: vec![],
        },
        _ => default_plan(),
    };
    let arguments = parse_args(arguments_override.as_deref());
    if !arguments.is_empty() {
        plan.args = arguments;
    }
    plan
}

pub fn resolve_test_plan_from_env() -> LaunchPlan {
    resolve_test_plan(
        std::env::var(LAUNCH_CMD_ENV).ok(),
        std::env::var(LAUNCH_ARGS_ENV).ok(),
    )
}

pub fn resolve_release_plan(
    catalog: &Catalog,
    release_id: &str,
    fallback_root: Option<&str>,
    deck_override: Option<&str>,
) -> Result<LaunchPlan, LaunchPlanError> {
    let release = catalog
        .releases
        .iter()
        .find(|release| release.id == release_id)
        .ok_or_else(|| LaunchPlanError::UnknownRelease {
            release_id: release_id.to_string(),
        })?;
    let deck = select_deck(catalog, release, deck_override)?;
    let release_path = resolve_release_path(catalog, release, fallback_root);
    let (mut args, replaced) = substitute_release_placeholder(&deck.arguments, &release_path);

    match deck.kind {
        DeckKind::DirectLaunch => Ok(LaunchPlan {
            program: release_path,
            args,
        }),
        DeckKind::Emulator => {
            if !replaced {
                args.push(release_path);
            }
            Ok(LaunchPlan {
                program: deck.executable_path.clone(),
                args,
            })
        }
    }
}

pub fn resolve_deck_test_plan(deck: &Deck) -> Result<LaunchPlan, LaunchPlanError> {
    match deck.kind {
        DeckKind::DirectLaunch => Err(LaunchPlanError::NotTestable {
            deck_id: deck.id.clone(),
        }),
        DeckKind::Emulator => Ok(LaunchPlan {
            program: deck.executable_path.clone(),
            args: deck
                .arguments
                .iter()
                .filter(|argument| {
                    !ROM_PLACEHOLDERS
                        .iter()
                        .any(|token| argument.contains(token))
                })
                .cloned()
                .collect(),
        }),
    }
}

fn parse_args(raw: Option<&str>) -> Vec<String> {
    raw.map(|value| value.split_whitespace().map(str::to_string).collect())
        .unwrap_or_default()
}

fn substitute_release_placeholder(arguments: &[String], path: &str) -> (Vec<String>, bool) {
    let mut replaced = false;
    let args = arguments
        .iter()
        .map(|argument| {
            let mut output = argument.clone();
            for token in ROM_PLACEHOLDERS {
                if output.contains(token) {
                    output = output.replace(token, path);
                    replaced = true;
                }
            }
            output
        })
        .collect();
    (args, replaced)
}

fn select_deck<'a>(
    catalog: &'a Catalog,
    release: &Release,
    deck_override: Option<&str>,
) -> Result<&'a Deck, LaunchPlanError> {
    if let Some(id) = deck_override.or(release.deck_id.as_deref()) {
        return catalog
            .decks
            .iter()
            .find(|deck| deck.id == id)
            .ok_or_else(|| LaunchPlanError::UnknownDeck {
                deck_id: id.to_string(),
            });
    }

    catalog
        .decks
        .iter()
        .filter(|deck| deck.platform == release.platform)
        .find(|deck| deck.is_default)
        .or_else(|| {
            catalog
                .decks
                .iter()
                .find(|deck| deck.platform == release.platform)
        })
        .ok_or_else(|| LaunchPlanError::NoDeckForPlatform {
            platform: release.platform.clone(),
        })
}

fn resolve_release_path(
    catalog: &Catalog,
    release: &Release,
    fallback_root: Option<&str>,
) -> String {
    let vault_root = release
        .vault_id
        .as_deref()
        .and_then(|id| catalog.vaults.iter().find(|vault| vault.id == id))
        .map(|vault| vault.path.as_str())
        .or(fallback_root);
    match vault_root {
        Some(root) if !root.trim().is_empty() => Path::new(root.trim())
            .join(&release.file_path)
            .to_string_lossy()
            .into_owned(),
        _ => release.file_path.clone(),
    }
}
