# Workflow: map

Codebase scanning with parallel mapper agents.

---

## Step 1: Pre-check

1. Check if `.workflow/research/` already exists with documents:
   - If documents exist and are recent (< 7 days):
     - Ask user: "Codebase map exists. Refresh or skip?"
     - "refresh" → continue to Step 2 (overwrite)
     - "skip" → exit with route suggestions
   - If documents are stale or missing → continue to Step 2

2. Create `.workflow/research/` directory if it does not exist.

---

## Step 2: Spawn Parallel Mapper Agents

Spawn 4 parallel `workflow-codebase-mapper` agents, each writing to `.workflow/research/`:

| Agent | Focus | Output | Content |
|-------|-------|--------|---------|
| 1 | tech | STACK.md | languages, frameworks, build tools, dependencies, versions |
| 2 | arch | ARCHITECTURE.md | architecture style, layers, module graph, key abstractions |
| 3 | features | FEATURES.md | feature inventory, feature-to-file mapping, completeness |
| 4 | concerns | PITFALLS.md | tech debt, missing tests, security gaps, performance issues |

If `$ARGUMENTS` provided, pass as focus filter to each agent.

Load project specs: `maestro spec load --category arch`

Each agent spawned in parallel as `workflow-codebase-mapper` subagent with specs context.

---

## Step 3: Verification

After all 4 agents complete:

1. Verify all 4 documents exist with >10 lines each.
2. If any missing/empty → log failure, re-spawn that agent (max 1 retry).

---

## Step 4: Summary

1. Create `.workflow/research/SUMMARY.md`:
   - Read all 4 documents
   - Write a consolidated executive summary covering:
     - Tech stack overview (from STACK.md)
     - Architecture highlights (from ARCHITECTURE.md)
     - Feature inventory count (from FEATURES.md)
     - Top 3 concerns (from PITFALLS.md)
     - Recommendations for next steps

---

## Step 5: Commit and Route

1. If git repo: commit `.workflow/research/` with message `"chore: map codebase"`

2. Display summary:
   ```
   Codebase mapped successfully.
   Documents: 5 files in .workflow/research/
   ```

3. Route next steps based on project state:
   - No `.workflow/state.json` → "Run `/workflow:init` to initialize project"
   - Has state, no roadmap → "Run `/workflow:init` to create roadmap"
   - Has roadmap → "Run `/workflow:plan {next_phase}` to start planning"
