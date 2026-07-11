# Direct Launch from Local Vault without Caching for MVP

Since the MVP only supports local directory vaults, we decided to launch games directly from their paths in the Vault rather than implementing local caching. This removes the need for copy operations, cache state tracking, and eviction logic in the first release, deferring these features to post-MVP when network vaults are introduced.
