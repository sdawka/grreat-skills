# Optional zvec-grep retrieval

Use semantic search when the question is conceptual: why an approach was chosen, what was tried before, or where relevant behavior lives. Use the manifest, direct reads, and `rg` for known IDs, filenames, exact phrases, and current status.

zvec-grep's CLI is `zg`. If available, inspect the installed version's help before using an index:

```sh
zg --version
zg --help
```

Run within the current repository or explicitly selected vault. Reuse its existing index and filters. Read a small set of relevant hits, follow their file/line references, and compare with current source. An old or incomplete index must not be used as proof that an artifact is absent or current.

The current [official CLI guide](https://github.com/zvec-ai/zvec-grep/blob/main/docs/02-cli.md) uses `zg --status`, `zg --index`, and `zg "query" --limit 5`; older releases use command-style forms such as `zg status` and `zg query`. Follow the installed help rather than assuming either interface. Current indexed searches may create a local index automatically if none exists, so inspect status before triggering discovery.

If indexing is needed and authorized, prefer local embeddings for project files. Keep the scope to the selected project, exclude secrets and generated output, preserve ignore rules, and keep `.zvec-grep/` out of Git. Do not turn routine adoption into a global tool installation, model download, or home-directory scan. Remote embedding requires authorization to send the selected content.

If `zg` is unavailable, continue with `rg`, links, and direct reads. Semantic retrieval improves discovery; source notes and observed project state remain authoritative.
