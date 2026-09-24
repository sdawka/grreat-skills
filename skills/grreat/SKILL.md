---
name: grreat
description: "Plan, adopt, execute, and resume substantial projects with GRREAT. Use a linked Markdown vault for Goals, Research, Roadmap, Execution, Analysis, and Time; carry Plan-mode decisions into evidence-based execution and future sessions. Use when asked for GRREAT, adopting an ongoing project, or continuing a tracked goal. App sync and semantic search are optional."
metadata:
  version: "1.2.0"
---

# GRREAT

Keep the goal, plan, work, evidence, and next action in a durable Markdown record. Store project facts in the project, never in this installed skill. Scale the detail to the task; routine one-off edits do not need a new vault.

## Start here

- `Use $grreat to adopt this ongoing project.`
- `Use $grreat to start this project: ...`
- `Use $grreat to turn this plan into tracked work.`
- `Use $grreat to resume this project.`
- `Use $grreat to review progress against the goal.`

These are natural-language invocations, not slash commands.

Follow the project's existing locator or an explicit vault path. Otherwise look for `docs/grreat/README.md` and its `grreat:manifest`; reuse that canonical record. For a new record, use `docs/grreat/`. If a project already uses the earlier `grreat-vault/` layout, preserve it and follow [adoption](references/adopt.md) to consolidate its content once. Never keep two authoritative trackers.

For adoption or initialization, read [adopt.md](references/adopt.md). For note conventions, read [vault.md](references/vault.md). Resolve bundled script paths relative to this `SKILL.md`; they work outside the GRREAT app repository and require Node.js 22 or newer, with no npm install.

## First half: planning

In native Plan mode, use **Goals → Research → Roadmap** to develop the plan. Follow the host's mode restrictions: return the handoff in the conversation while writes are prohibited. Persist it as the first execution step once writes are allowed. This skill cannot switch modes. In normal mode, use the user's existing authorization without inventing a second approval step.

- **Goals:** Desired outcome, motivation, scope, constraints, and observable success signals. Preserve the user's framing. Capture a condition that would invalidate the goal when meaningful; do not force a questionnaire.
- **Research:** Findings with sources, questions that affect the approach, and explicit assumptions. Link evidence to the goal or milestone it informs.
- **Roadmap:** Ordered milestones, dependencies, completion checks, and the first concrete action. Reuse an accepted plan rather than restarting it.

The handoff records the goal, plan, assumptions, validation criteria, vault path, and next action. Carry the accepted completion criteria into the active Roadmap record so execution and review use the same definition of success. Small projects can use one goal and a short milestone list. Do not force nested goals, exhaustive research, or extra process to fill the template.

## Second half: execution and feedback

Read the manifest-selected context and the **Now** section in the active Execution record. The helper checks that the selected Roadmap and Execution records match the active focus, then prints those records and a bounded, read-only Git snapshot:

```sh
node /path/to/grreat/project.mjs context --directory docs/grreat
```

Reconcile that record with the current files, branch, working tree, and relevant checks. If the manifest has stale focus references, reconcile them with the actual work before continuing. A different revision or dirty tree calls for inspection; note-only changes do not automatically invalidate earlier checks. Projects without Git still resume from their notes. Work on the next useful authorized action, then update at meaningful boundaries: completed work, a consequential finding, a failed check, a blocker, a decision, or a handoff.

Use available subagents for independent research, implementation, or review when parallel work helps. Give each a bounded responsibility and clear file ownership. Keep one writer for shared state notes, integrate the results, and verify the combined change before recording completion.

The ordinary update is **Now plus one journal entry**: record the work, evidence, and any consequential decision once in the dated journal; keep Now as the short current summary with a link to that evidence. Update Goals, Research, or Roadmap when their facts or direction change, not to echo the journal.

- **Execution:** What actually happened, changed artifacts, and observed verification. Append the journal entry and update Now; link to long output instead of copying it across notes.
- **Analysis:** At a milestone review, compare **success criterion → evidence → remaining gap**, using the accepted Roadmap criteria. Preserve the tested revision or working state with evidence. A passing implementation check does not establish another outcome, such as a successful release. Record the decision and its implication for the plan; preserve earlier reviews as dated history.
- **Time:** Update only when there is a meaningful estimate, measurement, or schedule change. Keep measured wall-clock time, active effort, and waiting distinct. Leave unmeasured time unknown; do not repeat empty time entries at every checkpoint or infer effort from commit dates.

Keep Now compact: current milestone, next action, blockers, latest check and its revision/working state, relevant references, and last update. A check remains evidence for the state tested; subsequent changes can require revalidation. Preserve dated history, user edits, and earlier decisions when updating current state.

Do not turn every tool call into a journal entry. At handoff, another session should be able to locate the goal, understand what remains, and continue without reconstructing the conversation. Mark completion only when the success signals have supporting evidence; distinguish observed, reported, inferred, and unverified progress.

## Retrieval and backlinks

Use the manifest and `rg` first for known files, record IDs, links, and exact terms. When wording is uncertain, use an available **zvec-grep (`zg`)** index for relevant research, decisions, or implementation evidence, then read and verify the source. Keep searches within the current project. See [retrieval.md](references/retrieval.md) when semantic discovery is useful. Missing search tooling must not block ordinary work.

Connect notes with `[[goals]]`, `[[roadmap]]`, and links to dated journals. Keep stable record IDs for validation and optional sync; ordinary reading and writing uses Markdown. The note app derives backlinks. The bundled helper can find them without an app:

```sh
node /path/to/grreat/project.mjs backlinks --directory docs/grreat --page goals
node /path/to/grreat/validate.mjs docs/grreat
```

Validation checks the canonical protocol, current manifest focus, and linked in-vault note targets. It does not prove work is complete or verify external evidence.

## Optional app connection

Local planning and execution need no account or credentials. If the user wants the app mirror, read [sync.md](references/sync.md). Markdown stays authoritative; use the existing versioned direct-RPC sync. Never infer permission to upload notes merely from skill installation or adoption.

See the [release notes](references/changelog.md) before upgrading. This skill consolidates the earlier `grreat-project` protocol and the linked-vault `grreat` workflow. Preserve existing IDs, manifests, and `.sync.json` checkpoints. Do not silently rewrite remote state, remove prior decisions, or replace project-specific conventions with new global rules.
