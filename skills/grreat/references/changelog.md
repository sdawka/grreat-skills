# Skill releases

## 1.3.1

- Occasionally check `https://grreat.ca/downloads/grreat.version` at session start and offer an upgrade when a newer release exists; never upgrade without permission or block work.
- Earlier versioned download URLs redirect to the current release.

## 1.3.0

- Goals and roadmap milestones keep outputs (deliverables) distinct from the outcome they should cause; completing outputs does not establish the outcome.
- A milestone too large to do directly can become a child Goal; a GET is the base case you would not break down.
- Delegated subagents get a GET or a child GRREAT sized to the task, report outputs and evidence, and the delegating agent judges the outcome.

## 1.2.0

- Resume the manifest's selected active roadmap and execution records; show a bounded, read-only Git summary alongside recorded evidence.
- Keep routine progress in Now and the journal. Review milestone criteria against evidence and remaining gaps.
- Preview app sync with `--dry-run`; bind checkpoints to the verified endpoint and workspace. Existing populated checkpoints require explicit binding before their next sync.
- Publish versioned archives and SHA-256 checksums alongside the latest download. Local Markdown tracking still needs no account or external dependency beyond Node.js.

## 1.1.0

Consolidated the GRREAT project protocol and user skill into one standalone skill: Plan-mode handoff, ongoing-project adoption, linked Markdown, optional app sync, and optional project-scoped semantic retrieval. The preserved 1.1.0 archive matches released commit `ffd6a19`, including canonical-file containment and support for symlinked vault roots.
