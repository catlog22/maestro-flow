---
title: "Role Routing and Tool Configuration Guide"
---

Role-based CLI tool routing configuration that decouples work types (analysis, review, implementation, etc.) from specific CLI tools.

---

## Overview

Maestro uses `--role` instead of `--to` for tool selection:

- **Decoupling of work type and tool** — Commands declare "what capability is needed", not which tool
- **Configuration-driven routing** — `cli-tools.json` defines fallback chains; adding/removing tools requires no command changes
- **Workspace override** — Project-level config overrides global config

```
Command --role analyze → cli-tools.json → fallbackChain: [codex, gemini, claude] → First enabled tool
```

---

## Configuration File

### Path Priority

| Priority | Path | Description |
|----------|------|-------------|
| 1 (highest) | `{project}/.maestro/cli-tools.json` | Project-level override |
| 2 | `~/.maestro/cli-tools.json` | Global configuration |
| 3 | Built-in defaults | `DEFAULT_ROLE_MAPPINGS` |

<details>
<summary>Configuration structure example</summary>

```json
{
  "version": "1.1.0",
  "tools": {
    "gemini": {
      "enabled": true,
      "primaryModel": "gemini-2.5-pro",
      "tags": ["fullstack", "frontend"],
      "type": "builtin"
    },
    "claude": {
      "enabled": true,
      "primaryModel": "claude-sonnet-4-20250514",
      "tags": ["fullstack"],
      "type": "builtin",
      "settingsFile": "~/.maestro/profiles/claude-review.json"
    },
    "codex": {
      "enabled": true,
      "primaryModel": "o3",
      "tags": ["fullstack", "backend"],
      "type": "builtin"
    }
  },
  "roles": {
    "review": { "fallbackChain": ["codex", "gemini", "claude"] },
    "brainstorm": { "fallbackChain": ["gemini", "codex", "claude"] }
  }
}
```

</details>

---

## 7 Fixed Roles

| Role | Purpose | Default Fallback Chain |
|------|---------|------------------------|
| `analyze` | Code analysis, pattern recognition, root cause diagnosis | codex → gemini → claude |
| `explore` | Codebase exploration, context collection, dependency tracking | codex → gemini → claude |
| `review` | Code review, quality assessment, security scanning | codex → gemini → claude |
| `implement` | Code implementation, bug fixes, refactoring | codex → claude → gemini |
| `plan` | Task decomposition, architecture planning, solution design | codex → gemini → claude |
| `brainstorm` | Creative divergence, multi-angle analysis, solution exploration | gemini → codex → claude |
| `research` | Technical research, API documentation, best practices | gemini → codex → claude |

### Route Resolution Order

```
1. config.roles[role]     — User-defined (cli-tools.json)
2. DEFAULT_ROLE_MAPPINGS  — Built-in defaults
3. First enabled tool in fallbackChain
4. Fallback: any first enabled tool
```

---

## Domain Tags

Used by `maestro execute` to auto-assign execution tools by file domain:

| Tag | Matching Scenario |
|-----|-------------------|
| `frontend` | .tsx/.jsx/.vue/.css, UI components, pages |
| `backend` | .go/.rs/.java/.py, API, database |
| `fullstack` | General, fallback match |
| `devops` | CI/CD, containers, infrastructure |
| `data` | Data pipelines, ETL, analytics |
| `mobile` | iOS/Android native |
| `infra` | Cloud resources, IaC |

---

## Tool Aliases and settingsFile

<details>
<summary>Registering tool aliases example</summary>

```json
{
  "tools": {
    "claude-review": {
      "enabled": true,
      "primaryModel": "claude-sonnet-4-20250514",
      "tags": ["fullstack"],
      "type": "builtin",
      "baseTool": "claude",
      "settingsFile": "~/.maestro/profiles/claude-review.json"
    }
  },
  "roles": {
    "review": { "tool": "claude-review" }
  }
}
```

- `baseTool` — Underlying CLI (determines which adapter to use)
- `settingsFile` — Config file passed to CLI (currently only Claude supports `--settings`)

</details>

### TUI Management

```bash
maestro delegate-config        # Launch TUI
maestro dc                     # Short alias
maestro delegate-config show          # Text output
maestro delegate-config show --json   # JSON format
maestro delegate-config roles         # View role mappings
```

TUI features: **[1] Tools** / **[2] Roles** / **[3] Register** (aliases) / **[4] Ref** / **[5] Config**

---

## CLI Auxiliary Calls in Workflows

Optional CLI delegate auxiliary analysis at key workflow stages. All execute with `run_in_background: true` asynchronously, auto-skip when no CLI tool is available.

| Workflow | Stage | Role | Function |
|----------|-------|------|----------|
| `review.md` | Step 6.5 | `review` | Cross-verify critical/high findings |
| `debug.md` | Step 5.5 | `explore` | Broad evidence collection |
| `verify.md` | V0.8 | `analyze` | Anti-pattern/completeness pre-scan |
| `plan.md` | P1 Step 5b | `explore` | Collect patterns/dependencies/conflicts |
| `test-gen.md` | Step 3.5 | `analyze` | Boundary conditions and edge case analysis |
| `execute.md` | E2.5 | `analyze` | Post-wave semantic verification |
| `milestone-audit.md` | Step 5.5 | `analyze` | Cross-phase import consistency check |

Auxiliary call principles: **Supplementary, not replacing** / **Transparent degradation** / **Async non-blocking** / **Role routing**

---

## Usage Examples

```bash
# Role routing (recommended)
maestro delegate "analyze auth module vulnerabilities" --role analyze --mode analysis

# Explicit tool (backward compatible)
maestro delegate "analyze auth module vulnerabilities" --to gemini --mode analysis

# --role has lower priority than --to
maestro delegate "..." --to codex --role analyze   # Uses codex
```

<details>
<summary>Project-level configuration override example</summary>

```bash
mkdir -p .maestro
cat > .maestro/cli-tools.json << 'EOF'
{
  "version": "1.1.0",
  "tools": { "gemini": { "enabled": false } },
  "roles": { "implement": { "fallbackChain": ["codex", "claude"] } }
}
EOF
```

</details>

### Auto-Initialization

```bash
maestro install --force
# Output: Initialized cli-tools.json (auto-detected CLI availability)
```

---

## Resolution Priority Summary

```
Delegate command parameter resolution:
  --to <tool>   → Highest priority
  --role <role> → Resolved via cli-tools.json role mapping
  No parameter  → First enabled tool

Role mapping: Project config → Global config → DEFAULT_ROLE_MAPPINGS
Tool state: Project config → Global config
settingsFile: ToolEntry → CliRunOptions → AgentConfig → adapter --settings
```
