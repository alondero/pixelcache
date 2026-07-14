# Local-Only Vault for MVP

We decided to support only local directory vaults for the MVP, deferring network vaults (like S3-compatible, SFTP, and WebDAV) to post-MVP development. This simplifies client networking and credentials management, allowing us to focus the first iteration entirely on the Catalog schema, local caching mechanics, UI design, and Deck execution.

> **Refined by [0004-per-platform-vaults](./0004-per-platform-vaults.md):** a Vault is scoped to a single platform, and a collection has several of them. This ADR is unchanged in substance — every Vault is still a **local** directory for the MVP; there are simply now one per platform rather than one for the whole library.
