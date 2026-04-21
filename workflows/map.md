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

Spawn 4 parallel `workflow-codebase-mapper` agents. Each agent scans the codebase independently with a specific focus and writes its output directly to `.workflow/research/`.

```
Agent 1: tech focus
  Scan: package.json, go.mod, requirements.txt, build files, dependencies
  Output: .workflow/research/STACK.md
  Content: languages, frameworks, build tools, key dependencies, versions

Agent 2: arch focus
  Scan: directory structure, module boundaries, entry points, data flow
  Output: .workflow/research/ARCHITECTURE.md
  Content: architecture style, layer separation, module graph, key abstractions

Agent 3: features focus
  Scan: routes, handlers, components, services, models
  Output: .workflow/research/FEATURES.md
  Content: feature inventory, feature-to-file mapping, completeness assessment

Agent 4: concerns focus
  Scan: error handling, logging, tests, config, security, performance
  Output: .workflow/research/PITFALLS.md
  Content: tech debt, missing tests, security gaps, performance concerns, known issues
```

If `$ARGUMENTS` (focus area) is provided, pass it to each agent as a focus filter: "Prioritize analysis of {focus_area} subsystem."

**Load project specs for mapper context:**
```
specs_content = maestro spec load --category arch
```

**Agent spawn pattern:**
```
For each agent (1-4) in parallel:
  Agent({
    subagent_type: "workflow-codebase-mapper",
    prompt: "Focus: {focus}. Scan the codebase and write {output_file}.
             Project specs for reference: ${specs_content}
             Write directly to the file. Return only a confirmation with line count.",
    run_in_background: false
  })
```

---

## Step 3: Verification

After all 4 agents complete:

1. Verify all documents exist with content:
   ```
   .workflow/research/STACK.md         — exists, >10 lines
   .workflow/research/ARCHITECTURE.md  — exists, >10 lines
   .workflow/research/FEATURES.md      — exists, >10 lines
   .workflow/research/PITFALLS.md      — exists, >10 lines
   ```

2. If any document is missing or empty:
   - Log which agent failed
   - Re-spawn that specific agent (max 1 retry per agent)

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
