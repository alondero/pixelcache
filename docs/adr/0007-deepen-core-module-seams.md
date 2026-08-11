# Deepen the Catalog Store, Launch Plan, and Import Plan Modules

## Status

Accepted.

## Context

Three of Pixelcache's most frequently changed Rust modules had accumulated
multiple independent implementation secrets:

- `catalog.rs` defined the Catalog schema but also owned app-data path policy,
  missing-file behaviour, JSON IO, and atomic replacement;
- `launch.rs` both decided how a Release maps to a Deck command and coordinated
  process/window lifecycle;
- `scanner.rs` both traversed Vaults and interpreted filenames, generated stable
  identities, reconciled Catalog state, selected canonical Releases, and seeded
  Decks.

Those modules had broad interfaces and mixed pure decisions with IO. Tests could
exercise the pure functions, but maintainers still had to navigate unrelated
rules and callers reached through domain modules for persistence behaviour.

## Decision

Create three deep modules with explicit seams:

- `catalog_store` owns durable Catalog loading and atomic saving. `catalog`
  retains the schema and domain mutations.
- `launch_plan` accepts a Catalog/Deck and returns a fully resolved program and
  argument list or a planning error. `launch` owns spawning, single-flight
  coordination, and window restoration.
- `import_plan` accepts discovered Vault files and returns a reconciled Catalog.
  `scanner` owns filesystem traversal, media discovery, and Tauri command wiring.

Callers and tests use the same interfaces. Internal helper functions remain
private. The Catalog store uses a process id plus monotonic write id for temporary
files so concurrent writers never share a temporary path.

## Consequences

- Catalog persistence changes are local to one module and reused by scan, scrape,
  media, launch, and settings flows.
- Launch planning can evolve independently of OS/window execution and has a
  dedicated error vocabulary.
- A future remote Vault adapter can produce discovered files and reuse the same
  Import plan without importing filesystem traversal.
- The Tauri command names and frontend payloads are unchanged; this ADR changes
  internal module seams, not player-facing behaviour.
