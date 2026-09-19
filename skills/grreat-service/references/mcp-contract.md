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

`list_proposals` and `get_proposal` return workspace-scoped proposal records. Response objects use camelCase: a proposal includes a stable `proposalId`, canonical `command`, policy classification, `fingerprint`, `baseVersions`, proposer attribution, status, and any terminal result. An oversized terminal result is returned in a bounded form with `truncated: true`, compact record/relation references, and the complete receipt and actor attribution.

`submit_proposal` accepts a bounded atomic `apply_batch` command of at most 25 commands and optional provenance/evidence. Request arguments use snake_case, including `request_id` and `proposal_id`. A retry with the same proposal ID, canonical command fingerprint, and authenticated proposer returns the stored proposal. Reusing the proposal ID with changed content or a different proposer returns `PROPOSAL_REUSE`. The service either returns a pending proposal for confirmation or an auto-approved terminal result when the deterministic policy allows it.

`approve_proposal` sends `proposal_id`, the exact `expected_fingerprint`, the returned `baseVersions` as `expected_base_versions`, and a request id. The mutation is carried out as the proposer; the approving authenticated agent is stored as the separate decision actor. A matching retry of an approved proposal returns the stored terminal result.

`reject_proposal` sends `proposal_id`, `expected_fingerprint`, and a request id; an optional reason is recorded with the rejecting decision actor. A matching retry of a rejected proposal returns the stored result.

Do not confuse a matching idempotent retry with a conflict. Return stale-version, fingerprint, proposal-ID-reuse, opposite terminal-decision, and workspace conflicts to the caller, then re-read the proposal before deciding what to do next.

## Scope of authority

An agent can carry out the current read, direct-write, recovery, and proposal operations listed in `SKILL.md`, subject to OAuth scopes, authentication, validation, idempotency, and workspace isolation. The MCP/RPC boundary is canonical. No CLI contract is promised by this package.
