# Optional app mirror

Use only when the user requests or has already authorized sending canonical project notes to their GRREAT workspace. Local tracking works without sync.

The existing helper sends normalized canonical records through version-1 direct-RPC `apply_batch` commands. Markdown is authoritative; the app is a downstream mirror. Journals and arbitrary supporting files are not parsed into remote records.

From the project root, use the installed skill's actual path:

```sh
node /path/to/grreat/validate.mjs docs/grreat
node /path/to/grreat/auth.mjs set
node /path/to/grreat/sync-cli.mjs --directory docs/grreat --dry-run
node /path/to/grreat/sync-cli.mjs --directory docs/grreat
```

Issue a scoped PAT from `https://grreat.ca/app/agents`: `grreat:read` for preview, and both `grreat:read` and `grreat:write` for actual sync. `auth.mjs set` accepts it through hidden terminal input and stores it in macOS Keychain under the existing `grreat.ca` service and `grreat-project` account. On other platforms, supply `GRREAT_ACCESS_TOKEN` through the environment using the user's existing secret-management method. Never put tokens in commands, notes, or versioned configuration. `auth.mjs remove` removes the local Keychain entry.

In the GRREAT app repository the existing `npm run grreat:auth -- set` and `npm run grreat:sync` commands remain valid. Global installation requires no repository-specific npm scripts or dependencies.

The default endpoint is `https://grreat.ca/api/agent/v1/rpc`. The helper reads authenticated workspace identity before every sync, including an otherwise unchanged vault. The local `.sync.json` binds that endpoint and workspace ID to its remote IDs, versions, digests, receipts, and pending/conflict state. An account or endpoint change stops before writes, preserving the checkpoint. Keep it across retries and skill updates and ignore it in Git.

`--dry-run` prints the authenticated destination and proposed record/relation changes. It sends no record commands and does not create, repair, or update a checkpoint. An account without a workspace reports `workspaceId: null` and `requiresAllocation: true`; preview does not allocate it. An actual first sync may allocate through the existing snapshot query, then verifies the new identity before sending records. A server without the identity operation leaves sync pending rather than guessing.

An older populated checkpoint has no destination binding. First run the preview, verify the workspace corresponds to its existing remote records, then use `--bind-existing WORKSPACE_ID` with the exact ID shown. This preserves existing IDs and binds them explicitly; it cannot switch an already bound checkpoint to another account. Never delete a checkpoint merely to bypass a destination mismatch. Keep separate project records/checkpoints when intentionally targeting a different workspace.

Missing credentials leave sync pending. Conflicts remain visible for review. Retry keeps the same request ID. Never download remote content into the canonical notes, overwrite a remote version conflict, or delete/archive a record because it is missing remotely. Obverse remains embedded in its owning goal payload rather than becoming an invalid app role.

Report actual receipts and any pending/conflict result. A locally valid vault does not prove that a remote sync or deployment succeeded.
