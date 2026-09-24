# GRREAT skills

Public, versioned Agent Skills for durable, local-first project work and optional GRREAT service access.

## Install

```sh
npx skills add sdawka/grreat-skills --skill grreat -g -y
```

`grreat` is the default skill. It keeps Goals, Research, Roadmap, Execution, Analysis, and Time in a Markdown vault in your project. It works locally with Node.js 22 or newer and needs no account, service, or npm install.

Use the optional `grreat-service` skill when you want an authenticated connection to a GRREAT workspace:

```sh
npx skills add sdawka/grreat-skills --skill grreat-service -g -y
```

Then connect the agent to `https://grreat.ca/mcp` and complete OAuth. Installation adds instructions and references; installation does not authenticate the agent or grant access to a GRREAT workspace.

The package is intentionally generic: it contains no account data, workspace exports, or credentials.

## Skill

- `skills/grreat/` — local Markdown workflow, version 1.2.0.
- `skills/grreat-service/` — GRREAT MCP/RPC connection and operation contract.

The live service controls authorization. The service skill is not a substitute for OAuth consent, token handling, or server-side scope checks.
