# Pixelcache

A cloud-configured game launcher that caches online-hosted games and manages game hacks, homebrew, and configurations across multiple platforms.

## Language

**Game**:
The logical representation of a specific title (e.g., *Super Mario World*, *Cyberpunk 2077*). It groups all straight ports, regional releases, and revisions of that title, and holds cross-release metadata like developer.
_Avoid_: Title, Item

**Release**:
A specific playable version or variant of a Game (e.g., original NTSC ROM, PAL translation, Japanese v1.1 revision, homebrew hack, or PS2 port). It holds release-specific metadata like publisher, region, and platform.
_Avoid_: Variant, Hack, ROM

**Asset Manifest**:
A list of physical files, directories, sizes, and content hashes that constitute a specific Release.
_Avoid_: File list, manifest file

**Cache State (Post-MVP)**:
The tracking record of which files from the Asset Manifest are present in the local storage, their integrity validation, and eviction metadata. (Deferred for MVP since it launches directly from the local Vault).
_Avoid_: Cache folder, cache log

**Deck**:
The logical engine or execution environment configuration used to run a specific Release (e.g., `snes`, `dolphin`, `steam`, `pc`). On each device, a Deck maps to a local executable or command prefix.
_Avoid_: Runner, Emulator, Console

**Playlist**:
A player-curated collection that references specific Releases by id (e.g., a "ROM Hacks" list mixing hacks across Games). It holds only references — the Releases themselves live once in the Catalog — so a Release can appear in many Playlists without duplication.
_Avoid_: Collection, Category, Folder

**Catalog**:
The centralized master directory containing all Game, Release, Deck, and Playlist definitions, acting as the syncable configuration.
_Avoid_: Database, Config File

**Vault**:
A storage location (local directory for MVP, remote S3/SFTP post-MVP) that hosts the physical files defined in the Asset Manifests.
_Avoid_: Repository, Server, Host
