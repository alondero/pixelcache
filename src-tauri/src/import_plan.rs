//! Pure Import plan: turn discovered Vault files into a reconciled Catalog.
//!
//! Filesystem traversal is an adapter owned by `scanner`. This module hides the
//! No-Intro/TOSEC interpretation, stable identity, canonical Release selection,
//! curated metadata preservation, and Deck-seeding rules behind one interface.

use crate::catalog::{Catalog, Deck, DeckKind, Game, Release, ReleaseType};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedName {
    pub title: String,
    pub region: Option<String>,
    pub revision: Option<String>,
    pub release_type: ReleaseType,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredRelease {
    pub relative_path: String,
    pub platform: String,
    pub vault_id: String,
    pub parsed: ParsedName,
}

/// Interpret a filename stem using No-Intro / TOSEC conventions.
pub fn parse_filename(stem: &str) -> ParsedName {
    let title = title_prefix(stem);
    let parens = top_level_groups(stem, '(', ')');
    let brackets = top_level_groups(stem, '[', ']');

    ParsedName {
        title,
        region: parens.iter().find(|tag| is_region(tag)).cloned(),
        revision: parens.iter().find_map(|tag| revision_of(tag)),
        release_type: classify_release_type(&parens, &brackets),
    }
}

/// Reconcile discovered Releases into the Catalog while preserving everything
/// not owned by the scanned Vaults.
pub fn reconcile(
    existing: &Catalog,
    files: &[DiscoveredRelease],
    scanned_vault_ids: &[String],
) -> Catalog {
    let owned_by_scan = |vault_id: &Option<String>| match vault_id {
        Some(id) => scanned_vault_ids.iter().any(|scanned| scanned == id),
        None => false,
    };

    let mut releases: Vec<Release> = existing
        .releases
        .iter()
        .filter(|release| !owned_by_scan(&release.vault_id))
        .cloned()
        .collect();
    let mut used_release_ids: Vec<String> = releases.iter().map(|r| r.id.clone()).collect();

    let mut files = files.to_vec();
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    for file in &files {
        let game_id = slug(&file.parsed.title);
        if game_id.is_empty() {
            continue;
        }
        releases.push(Release {
            id: unique_id(&release_base_id(file), &mut used_release_ids),
            game_id,
            title: file.parsed.title.clone(),
            region: file.parsed.region.clone(),
            platform: file.platform.clone(),
            revision: file.parsed.revision.clone(),
            release_type: file.parsed.release_type,
            publisher: None,
            vault_id: Some(file.vault_id.clone()),
            deck_id: None,
            file_path: file.relative_path.clone(),
            media: None,
        });
    }

    Catalog {
        games: group_games(&releases, &existing.games),
        decks: seed_decks(&existing.decks, &releases),
        releases,
        playlists: existing.playlists.clone(),
        vaults: existing.vaults.clone(),
    }
}

pub fn default_emulator_for_platform(platform: &str) -> Option<&'static str> {
    Some(match platform {
        "snes" => "snes9x",
        "nes" => "fceux",
        "n64" => "mupen64plus",
        "gb" | "gbc" | "gba" => "mgba",
        "genesis" | "sms" | "gamegear" | "segacd" => "blastem",
        "pcengine" | "pcenginecd" => "mednafen",
        "atari2600" => "stella",
        "wonderswan" | "neogeopocket" => "mednafen",
        "ps1" => "duckstation",
        "ps2" => "pcsx2",
        "psp" => "ppsspp",
        "gamecube" | "wii" => "dolphin-emu",
        "dreamcast" | "saturn" => "flycast",
        "3do" => "retroarch",
        _ => return None,
    })
}

fn group_games(releases: &[Release], existing_games: &[Game]) -> Vec<Game> {
    let mut games: Vec<Game> = Vec::new();
    for release in releases {
        if let Some(game) = games.iter_mut().find(|game| game.id == release.game_id) {
            let current = releases
                .iter()
                .find(|candidate| candidate.id == game.primary_release_id)
                .expect("primary release exists in the reconciled set");
            if primary_rank(release) < primary_rank(current) {
                game.primary_release_id = release.id.clone();
            }
            continue;
        }

        let (developer, relations, media, favorite) = existing_games
            .iter()
            .find(|game| game.id == release.game_id)
            .map(|game| {
                (
                    game.developer.clone(),
                    game.relations.clone(),
                    game.media.clone(),
                    game.favorite,
                )
            })
            .unwrap_or((None, Vec::new(), None, false));
        games.push(Game {
            id: release.game_id.clone(),
            developer,
            primary_release_id: release.id.clone(),
            relations,
            media,
            favorite,
        });
    }
    games
}

fn seed_decks(existing_decks: &[Deck], releases: &[Release]) -> Vec<Deck> {
    let mut decks = existing_decks.to_vec();
    let mut covered: Vec<String> = decks.iter().map(|deck| deck.platform.clone()).collect();
    for release in releases {
        if covered.iter().any(|platform| platform == &release.platform) {
            continue;
        }
        covered.push(release.platform.clone());
        decks.push(Deck {
            id: format!("{}-default", release.platform),
            platform: release.platform.clone(),
            executable_path: default_emulator_for_platform(&release.platform)
                .unwrap_or("")
                .to_string(),
            arguments: Vec::new(),
            kind: DeckKind::Emulator,
            is_default: true,
        });
    }
    decks
}

pub(crate) fn title_prefix(stem: &str) -> String {
    let end = stem
        .char_indices()
        .find(|&(_, ch)| ch == '(' || ch == '[')
        .map(|(index, _)| index)
        .unwrap_or(stem.len());
    stem[..end].trim().to_string()
}

fn top_level_groups(value: &str, open: char, close: char) -> Vec<String> {
    let mut groups = Vec::new();
    let mut depth = 0usize;
    let mut current = String::new();
    for ch in value.chars() {
        if ch == open {
            if depth > 0 {
                current.push(ch);
            }
            depth += 1;
        } else if ch == close && depth > 0 {
            depth -= 1;
            if depth == 0 {
                groups.push(current.trim().to_string());
                current.clear();
            } else {
                current.push(ch);
            }
        } else if depth > 0 {
            current.push(ch);
        }
    }
    groups
}

const REGIONS: &[&str] = &[
    "USA",
    "Europe",
    "Japan",
    "World",
    "Australia",
    "Germany",
    "France",
    "Spain",
    "Italy",
    "Netherlands",
    "Sweden",
    "Norway",
    "Denmark",
    "Finland",
    "Korea",
    "China",
    "Taiwan",
    "Asia",
    "Brazil",
    "Canada",
    "Mexico",
    "Russia",
    "Poland",
    "UK",
    "Portugal",
    "Greece",
    "Hong Kong",
    "PAL",
    "NTSC",
];

fn is_region(tag: &str) -> bool {
    let first = tag.split(',').next().unwrap_or("").trim();
    REGIONS
        .iter()
        .any(|region| region.eq_ignore_ascii_case(first))
}

fn revision_of(tag: &str) -> Option<String> {
    if tag.to_ascii_lowercase().starts_with("rev ") {
        return Some(tag.trim().to_string());
    }
    let bytes = tag.as_bytes();
    if bytes.len() >= 2 && (bytes[0] == b'v' || bytes[0] == b'V') && bytes[1].is_ascii_digit() {
        return Some(tag.trim().to_string());
    }
    None
}

fn classify_release_type(parens: &[String], brackets: &[String]) -> ReleaseType {
    let has = |needle: &str| {
        parens.iter().any(|tag| tag.eq_ignore_ascii_case(needle))
            || brackets.iter().any(|tag| tag.eq_ignore_ascii_case(needle))
    };
    let bracket_starts = |needle: char| {
        brackets.iter().any(|tag| {
            tag.chars()
                .next()
                .map(|ch| ch.eq_ignore_ascii_case(&needle))
                == Some(true)
        })
    };

    if has("Translation") || bracket_starts('T') {
        ReleaseType::Translation
    } else if has("Hack") || bracket_starts('h') {
        ReleaseType::Hack
    } else if has("Homebrew") || has("Aftermarket") || has("PD") || has("Unl") {
        ReleaseType::Homebrew
    } else if has("Beta") || has("Proto") || has("Prototype") || has("Demo") || has("Sample") {
        ReleaseType::Beta
    } else {
        ReleaseType::Retail
    }
}

fn slug(input: &str) -> String {
    let mut out = String::new();
    let mut pending_dash = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
            pending_dash = false;
        } else {
            pending_dash = true;
        }
    }
    out
}

fn release_base_id(file: &DiscoveredRelease) -> String {
    let mut parts = vec![file.parsed.title.clone()];
    if let Some(region) = &file.parsed.region {
        parts.push(region.clone());
    }
    if let Some(revision) = &file.parsed.revision {
        parts.push(revision.clone());
    }
    let base = slug(&parts.join(" "));
    if base.is_empty() {
        slug(&file.platform)
    } else {
        base
    }
}

fn unique_id(base: &str, used: &mut Vec<String>) -> String {
    let mut candidate = base.to_string();
    let mut suffix = 2;
    while used.iter().any(|used_id| used_id == &candidate) {
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
    used.push(candidate.clone());
    candidate
}

fn primary_rank(release: &Release) -> (u8, u8, u8) {
    let type_rank = match release.release_type {
        ReleaseType::Retail => 0,
        ReleaseType::Beta => 1,
        ReleaseType::Homebrew => 2,
        ReleaseType::Hack => 3,
        ReleaseType::Translation => 4,
    };
    let region_rank = match release.region.as_deref().map(first_region) {
        Some("USA") => 0,
        Some("World") => 1,
        Some("Europe") => 2,
        Some("Japan") => 3,
        Some(_) => 4,
        None => 5,
    };
    (type_rank, region_rank, release.revision.is_some() as u8)
}

fn first_region(region: &str) -> &str {
    region.split(',').next().unwrap_or(region).trim()
}
