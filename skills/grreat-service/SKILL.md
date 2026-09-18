---
name: grreat-service
description: Use when an agent needs to connect to a GRREAT workspace, inspect its goals and records, make scoped changes, or work with versioned proposals through the GRREAT MCP/RPC service.
---

# GRREAT service

GRREAT is a private, workspace-scoped system for Goals, Research, Roadmap, Execution, Analysis, and Time. Its canonical agent boundary is the authenticated MCP/RPC service at `https://grreat.ca/mcp`.

## Connect safely

1. Add `https://grreat.ca/mcp` to an OAuth-capable MCP client.
2. Let the client discover OAuth metadata and use Dynamic Client Registration.
3. Sign in to GRREAT and request only the scopes needed: `grreat:read`, then `grreat:write` when mutation or proposal decisions are required. `offline_access` is optional.
4. Treat installation and authentication as separate events. Installing this skill does not authenticate the agent, grant workspace access, or provide a token.

Never invent, print, persist, or ask a user to paste an access or refresh token into skill content. Let the MCP client own OAuth storage and refresh.

## Operating contract

Read the workspace before writing. Use the smallest bounded query that establishes the current record, relation, proposal, and version context. Every mutation must carry a fresh unique `request_id`; preserve the returned receipt and do not retry an unknown result with a new request id until the original outcome is resolved.

`grreat:read` permits workspace reads and proposal inspection. `grreat:write` permits direct writes plus proposal submission, approval, and rejection in the authenticated agent's own workspace. There is no separate approval scope.

Direct writes are appropriate for clearly requested, reversible scoped changes. Use proposals when the change needs review or when the caller asks for a proposed plan. A write-capable agent may decide any proposal in its own workspace, but approval must echo the proposal's exact `fingerprint` and `base_versions`. Stale, replayed, terminal, malformed, or cross-workspace requests must be surfaced as conflicts, not silently retried or broadened.

An approved proposal keeps its proposer as the domain mutation actor. The agent that approves or rejects it is recorded separately as the decision actor. Report that distinction in user-facing summaries.

Use `undo_last_change` and `redo_last_change` only with explicit awareness that history is workspace-wide: another connected client may be affected, and a new write after undo supersedes the redo branch.

## Quick reference

| Need | Operation family |
|---|---|
| Inspect work | `list_goals`, `get_goal_context`, `list_records`, `get_record`, `list_relations`, `list_changes` |
| Inspect proposals | `list_proposals`, `get_proposal` |
| Write directly | `add_goal`, `add_research`, `add_roadmap_item`, `add_execution_item`, `add_analysis`, `add_time_entry`, `update_record`, `archive_record`, `relate_records`, `archive_relation` |
| Propose or decide | `submit_proposal`, `approve_proposal`, `reject_proposal` |
| Recover | `undo_last_change`, `redo_last_change` |

See [references/mcp-contract.md](references/mcp-contract.md) for request boundaries, proposal fields, conflict handling, and receipts.

## Common mistakes

- Treating a skill install as account authentication.
- Mutating before reading current versions.
- Dropping `request_id`, receipt, fingerprint, or base-version data during a retry.
- Using a public actor field instead of the authenticated principal.
- Claiming that a proposal was approved without reporting its terminal receipt or conflict.
- Assuming undo/redo is agent-local.
