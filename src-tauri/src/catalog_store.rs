//! Durable storage for the current [`Catalog`](crate::catalog::Catalog).
//!
//! This module hides where the Catalog lives, how a missing Catalog is treated,
//! and how JSON is replaced atomically. Domain schema and mutation rules stay in
//! `catalog`; callers that need durability cross this seam instead.

use crate::catalog::Catalog;
use std::fmt;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// Filename of the Catalog document in the app data directory.
pub const CATALOG_FILE_NAME: &str = "catalog.json";

#[derive(Debug)]
pub enum CatalogStoreError {
    Read {
        path: String,
        source: std::io::Error,
    },
    Parse {
        path: String,
        source: serde_json::Error,
    },
    Serialize {
        path: String,
        source: serde_json::Error,
    },
    Write {
        path: String,
        source: std::io::Error,
    },
}

impl fmt::Display for CatalogStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read { path, source } => write!(f, "failed to read catalog '{path}': {source}"),
            Self::Parse { path, source } => {
                write!(f, "failed to parse catalog '{path}': {source}")
            }
            Self::Serialize { path, source } => {
                write!(f, "failed to serialize catalog '{path}': {source}")
            }
            Self::Write { path, source } => {
                write!(f, "failed to write catalog '{path}': {source}")
            }
        }
    }
}

impl std::error::Error for CatalogStoreError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Read { source, .. } | Self::Write { source, .. } => Some(source),
            Self::Parse { source, .. } | Self::Serialize { source, .. } => Some(source),
        }
    }
}

/// Load a Catalog from an explicit path.
pub fn load_from_path(path: &Path) -> Result<Catalog, CatalogStoreError> {
    let contents = std::fs::read_to_string(path).map_err(|source| CatalogStoreError::Read {
        path: path.display().to_string(),
        source,
    })?;
    Catalog::from_json(&contents).map_err(|source| CatalogStoreError::Parse {
        path: path.display().to_string(),
        source,
    })
}

/// Load the current Catalog, treating a missing file as a fresh empty Catalog.
pub fn load_current(app: &tauri::AppHandle) -> Result<Catalog, CatalogStoreError> {
    use tauri::Manager;

    let Ok(directory) = app.path().app_data_dir() else {
        return Ok(Catalog::default());
    };
    let path = directory.join(CATALOG_FILE_NAME);
    if path.is_file() {
        load_from_path(&path)
    } else {
        Ok(Catalog::default())
    }
}

/// Serialize and atomically replace a Catalog at an explicit path.
pub fn save_to_path(catalog: &Catalog, path: &Path) -> Result<(), CatalogStoreError> {
    let json =
        serde_json::to_string_pretty(catalog).map_err(|source| CatalogStoreError::Serialize {
            path: path.display().to_string(),
            source,
        })?;
    write_atomic(&json, path)
}

/// Persist the current Catalog beside the rest of the application's local data.
pub fn save_current(app: &tauri::AppHandle, catalog: &Catalog) -> Result<(), CatalogStoreError> {
    use tauri::Manager;

    let path = app
        .path()
        .app_data_dir()
        .map_err(|source| CatalogStoreError::Write {
            path: CATALOG_FILE_NAME.to_string(),
            source: std::io::Error::other(source.to_string()),
        })?
        .join(CATALOG_FILE_NAME);
    save_to_path(catalog, &path)
}

fn write_atomic(json: &str, path: &Path) -> Result<(), CatalogStoreError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|source| CatalogStoreError::Write {
            path: parent.display().to_string(),
            source,
        })?;
    }
    let temp = temporary_path(path);
    std::fs::write(&temp, json).map_err(|source| CatalogStoreError::Write {
        path: temp.display().to_string(),
        source,
    })?;
    if let Err(source) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(CatalogStoreError::Write {
            path: path.display().to_string(),
            source,
        });
    }
    Ok(())
}

fn temporary_path(path: &Path) -> std::path::PathBuf {
    static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);
    let id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
    path.with_extension(format!("json.{}.{id}", std::process::id()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::Catalog;

    #[test]
    fn save_and_load_round_trip_through_the_storage_interface() {
        let dir = std::env::temp_dir().join(format!(
            "pixelcache-catalog-store-roundtrip-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("catalog.json");
        let catalog = Catalog::from_json(
            r#"{"games":[{"id":"metroid","primaryReleaseId":"metroid-us","relations":[]}]}"#,
        )
        .expect("valid catalog");

        save_to_path(&catalog, &path).expect("save");
        let loaded = load_from_path(&path).expect("load");

        assert_eq!(loaded, catalog);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn concurrent_writes_use_distinct_temporary_paths() {
        let destination = Path::new("catalog.json");

        let first = temporary_path(destination);
        let second = temporary_path(destination);

        assert_ne!(first, second);
        assert_eq!(first.parent(), destination.parent());
    }
}
