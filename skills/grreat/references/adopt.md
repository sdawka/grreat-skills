# Adopt or initialize a project

Invocation: `Use $grreat to adopt this ongoing project.`

## Establish what exists

Inspect applicable instructions, relevant plans and docs, working-tree changes, recent pertinent commits, and the implementation or artifacts needed to assess the goal. Read an existing GRREAT manifest first. Preserve the accepted goal and plan; ask only if an unresolved choice would change the next action.

Summarize a dated adoption baseline: item, current state, evidence, and verification gap. Source inspection can establish implementation, not deployment or runtime success. Preserve the attribution of historical reports. Never invent previous sessions, approvals, completion, or time spent.

## Reuse or initialize

- **Canonical record exists:** Keep its path, IDs, hierarchy, decisions, and sync checkpoint. Preserve useful context references while making the manifest select the current active Roadmap and Execution records. Reconcile stale references against the actual work; do not rename records to hide a mismatch. Update the baseline and next action in place. Repeated adoption reconciles state; it does not append another instruction block or duplicate goals.
- **Only an earlier linked vault or another plan exists:** Identify its authoritative notes and link the original material. Map goal/plan/current action into the canonical six notes once, preserving historical journals and backlinks. Record the mapping and new resume path in the old index; keep the old material as history rather than a second live tracker. Do not move or overwrite user notes without necessity.
- **No record exists:** Initialize the small canonical template using the installed helper, then replace the explicitly unknown fields with facts and the plan. The helper refuses to overwrite partial or unrelated directories.

```sh
node /path/to/grreat/project.mjs init --directory docs/grreat --title "Project outcome"
```

The initializer creates the six notes, an index, an empty journals directory, and a sibling decision log only if absent. It performs no remote writes and does not install packages. Initialization alone is not adoption: inspect the project, fill the baseline, and establish the next action.

## Preserve the planning boundary

In Plan mode, return the baseline, proposed file changes, Goals/Research/Roadmap, completion criteria, and first execution action in the conversation. Defer all writes until allowed. When execution starts, persist that handoff rather than planning again. Carry its completion criteria into the Roadmap; later milestone reviews compare those same criteria with evidence and remaining gaps in Analysis.

For an ongoing implementation, distinguish already verified milestones, historically reported milestones, work in progress, and remaining work. Log today's discovery as adoption, not as the original execution of old work.

After the adoption baseline, ordinary progress needs only one dated journal entry and a short Now update. Link to the evidence instead of copying it across all six notes. Change planning notes when the plan changes, review Analysis at milestone boundaries, and add Time facts only when meaningful.

## Make resumption discoverable

Add or update one GRREAT section in the project's `AGENTS.md`, preserving unrelated content. Use the actual path:

```markdown
## GRREAT project memory

Use the user-scoped `grreat` skill for substantial work on tracked goals.
Start at `docs/grreat/README.md` and read its manifest-selected records.
The active Execution record's Now section identifies the next action and
verification state. Keep Plan-mode writes deferred; record meaningful execution
and decisions in the linked journal. Use an available project-scoped zvec-grep
index for semantic discovery and verify its results against current source.
```

Do not create global project-specific instructions. If instruction-file changes are excluded, report the resume path instead. Validate and report the baseline, uncertainty, and next action. When adoption alone was requested, stop after the record is established; when implementation was already authorized, continue that work.
