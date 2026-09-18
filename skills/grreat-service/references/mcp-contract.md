# GRREAT MCP/RPC contract

Endpoint: `https://grreat.ca/mcp`

The service is OAuth-protected and workspace-scoped. The client discovers the issuer, protected-resource metadata, and Dynamic Client Registration endpoints from the service. Request `grreat:read` for inspection. Add `grreat:write` for direct writes and all proposal submission/approval/rejection. `offline_access` is optional. Installation of the skill never changes these server-side permissions.

## Request discipline

- Send a unique bounded `request_id` on every mutation.
- Read current state before writing and preserve record/relation `version` values.
- Treat a returned change receipt as the authoritative mutation result.
- On transport uncertainty, resolve the original request before retrying with a new request id.
- Do not send arbitrary actor identity; the authenticated service principal supplies it.
- Keep request and response payloads within the service's documented bounds.

## Proposal lifecycle

`list_proposals` and `get_proposal` return workspace-scoped proposal records. A proposal includes a stable `proposal_id`, canonical `command`, policy classification, `fingerprint`, `base_versions`, proposer attribution, status, and any terminal receipt or conflict.

`submit_proposal` accepts a bounded atomic `apply_batch` command and optional provenance/evidence. The request is idempotent by `request_id` and `proposal_id`. The service either returns a pending proposal for confirmation or an auto-approved terminal result when the deterministic policy allows it.

`approve_proposal` requires the proposal id, exact fingerprint, exact base versions, and a fresh request id. The mutation is carried out as the proposer; the approving authenticated agent is stored as the separate decision actor.

`reject_proposal` requires the proposal id, exact fingerprint, and a fresh request id; an optional reason is recorded with the rejecting decision actor.

Never treat a duplicate, stale, fingerprint mismatch, already-terminal proposal, or workspace mismatch as success. Return the conflict to the caller and re-read the proposal before deciding what to do next.

## Scope of authority

An agent can carry out the current read, direct-write, recovery, and proposal operations listed in `SKILL.md`, subject to OAuth scopes, authentication, validation, idempotency, and workspace isolation. The MCP/RPC boundary is canonical. No CLI contract is promised by this package.
