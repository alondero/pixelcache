# Use Tauri for Cross-Platform Desktop Client

We decided to use Tauri (Rust backend + HTML/CSS/JS frontend) instead of Electron or a pure Rust GUI library for the desktop client. This provides compile-time safety and a very lightweight CPU/RAM footprint on the Steam Deck, while allowing rapid iteration on a visually rich, dark-themed UI using standard web styling.
