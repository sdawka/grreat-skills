# Vault conventions

## One source of truth

The compact default retains the original sync-compatible protocol:

```text
docs/
  decision_log.md
  grreat/
    README.md       Manifest and navigation
    goals.md        Outcome and success signals
    research.md     Current findings and uncertainties
    roadmap.md      Plan and milestones
    execution.md    Now and links to work history
    analysis.md     Results and decisions
    time.md         Estimates and measurements
    journals/
      2026-09-23.md  Dated execution or adoption entries
```

Open `docs/grreat/` as an Obsidian vault or use the Markdown in a text editor. The linked pages and journals follow a Logseq-style workflow; this is not a Logseq database export. Preserve an existing file graph's journal names and conventions when adapting it. No note app, plugin, or database is required.

Use `[[goals]]`, `[[research]]`, and `[[journals/2026-09-23]]` for navigation. Wiki page names resolve within the vault; use explicit paths from its root for journals or supporting notes. Ordinary Markdown paths are relative to their source note. Journals link back to the goal and milestone pages. Create a target note before linking it, or label a proposed future note as plain text. Use Markdown links for source files, test artifacts, and URLs.

Keep research or decisions inline until they warrant a separate note. Preserve dates and rationale when superseding a decision. Do not duplicate a full backlinks list; the app derives it, or use `project.mjs backlinks`.

## Machine-readable continuity

Existing records retain HTML-comment IDs, such as:

```markdown
<!-- grreat:record id=execution.next kind=execution_item status=active parent=roadmap.next -->
# Verify the next milestone
```

The index has a `grreat:manifest version=1` comment with the root goal ID and a short list of `file.md#record.id` context references. Those anchors select records for the helper; use simple page links for portable visual navigation. Its Roadmap and Execution references must select exactly the current active records; completed records belong in history rather than the current focus. Keep IDs stable across title changes. The active record should contain a compact current summary; move old details into linked journals or inactive records.

The existing protocol validates one root goal, its Obverse (the condition that invalidates the outcome), and a maximum three-level goal tree. A small project needs only the root and its Obverse; do not create child goals solely to fill the hierarchy. The protocol selects one active roadmap item and execution item as the current focus, while other work can remain in the plan. Preserve these invariants for compatibility; they do not require extra user approval or dictate how many tasks a person may work on.

Declare separate `grreat:record` comments only for records that should participate in validation and app sync. Supporting notes and journal pages have no such comments and are not uploaded by the sync helper. Their references and summaries in canonical record bodies can be included in a sync, so review the canonical text before enabling it.

The validator checks canonical IDs, relationships, record anchors, current manifest focus, and the existence of directly linked Markdown notes inside the vault. It skips link examples in code, and does not fetch URLs or attest to source-file evidence. For notes outside the six canonical pages it checks page existence, not headings. Use exact in-vault paths; frontmatter aliases and Logseq block IDs are outside this helper's contract.

`project.mjs context` uses the same focus checks and reports a read-only Git snapshot: branch, revision, and counts of changed and untracked paths. It includes no diffs or file contents, and continues without Git when the snapshot is unavailable. Git work is limited to three seconds and 256 KiB of status output; a truncated or failed read is reported as unavailable, never clean. Compare the snapshot with each check's recorded state before deciding what needs revalidation. Note edits alone do not make implementation evidence obsolete.

## Ordinary progress and milestone review

For ordinary progress, append one dated journal entry and update **Now** in Execution. Put detailed evidence in the journal once; Now links to it and states the current action, blockers, and latest verification. Update planning pages only when their facts or direction change. Add Time facts when there is a useful estimate, measurement, or schedule change; absent measurements remain unknown without repeated empty entries.

At a milestone boundary, refresh the current Analysis review using the criteria carried from the accepted plan:

| Success criterion | Evidence and tested state | Remaining gap |
| --- | --- | --- |
| Criterion from the active Roadmap | Journal or artifact link, observed result, revision or working state | What still needs verification, or none |

Each row explains an outcome, not a tool call. If implementation passes but publication is a separate criterion, leave the publication gap explicit. Link earlier dated reviews as history and record why a criterion changes rather than silently redefining success. This comparison guides judgment; the structural validator does not decide completion.

## Journal entry

Use the user's local date and a timestamp with timezone when known. Append entries and preserve existing work:

```markdown
## 2026-09-23T10:00:00-04:00 — Adoption baseline

- Goal: [[goals]]
- Milestone: [[roadmap]] (`roadmap.next`)
- Work or discovery: What was actually inspected or performed.
- Evidence: Source links, check commands and observed results, revision or working state.
- Decision or implication: Include when the work changes the plan or reveals uncertainty.
```

This example is not historical evidence. Replace it with actual facts. Add time details only when meaningful, distinguishing elapsed time from active effort. Put the next action in Now rather than repeating it in each note. Update Now after useful progress, failures, direction changes, or handoffs. Re-read before editing a shared note and preserve another writer's additions.

Keep `.sync.json`, its recovery files, `.zvec-grep/`, and local app settings out of Git. They are local derived state; Markdown remains authoritative. Do not delete a sync checkpoint during adoption or an upgrade.
