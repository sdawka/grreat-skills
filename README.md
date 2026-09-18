# GRREAT skills

Public, versioned Agent Skills for connecting an agent to GRREAT through its canonical MCP/RPC service.

## Install

```sh
npx skills add sdawka/grreat-skills --skill grreat-service -g -y
```

Then connect the agent to `https://grreat.ca/mcp` and complete OAuth. Installation adds instructions and references; installation does not authenticate the agent or grant access to a GRREAT workspace.

The package is intentionally generic: it contains no account data, workspace exports, or credentials.

## Skill

- `skills/grreat-service/` — GRREAT MCP/RPC connection and operation contract.

The live service controls authorization. The package is not a substitute for OAuth consent, token handling, or server-side scope checks.
