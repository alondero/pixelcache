# Play History Stored Locally, Outside the Catalog

Play activity (play counts, total play time, last-played timestamps per Release) is stored in its own `play_history.json` in the app data directory, not in `catalog.json`.

The Catalog is the curated, syncable library configuration shared across devices; play activity is high-churn, device-local state written every time a game exits. Folding it into the Catalog would rewrite the synced file after every session, create needless sync churn/conflicts, and tangle curation with telemetry. Favorites, by contrast, are curation and therefore live on the `Game` in the Catalog.

Sessions are measured by the launch exit-watcher (spawn to child exit) and recorded only for real Release launches, only when they last at least 5 seconds — so a crashing emulator never becomes the "last played" game. The backend emits a `play-session-recorded` event after persisting, so the UI updates without polling. Cross-device merging of play history is deferred to post-MVP alongside cloud sync.
