# Codex Code Guidelines


## Code Quality Standards

### Code Quality
- Follow project's existing patterns
- Match import style and naming conventions
- Single responsibility per function/class
- DRY (Don't Repeat Yourself)
- YAGNI (You Aren't Gonna Need It)

### Testing
- Test all public functions
- Test edge cases and error conditions
- Mock external dependencies
- Target 80%+ coverage

### Error Handling
- Proper try-catch blocks
- Clear error messages
- Graceful degradation
- Don't expose sensitive info

## Core Principles

**Incremental Progress**:
- Small, testable changes
- Commit working code frequently
- Build on previous work (subtasks)

**Evidence-Based**:
- Study 3+ similar patterns before implementing
- Match project style exactly
- Verify with existing code

**Pragmatic**:
- Boring solutions over clever code
- Simple over complex
- Adapt to project reality

**Context Continuity** (Multi-Task):
- Leverage resume for consistency
- Maintain established patterns
- Test integration between subtasks

**Git Operations** (Parallel Task Safety):
- Only stage/commit files directly produced by current task
- Never touch unrelated changes or other task outputs
- Use `git add <specific-files>` instead of `git add .`
- Verify staged files before commit to avoid cross-task conflicts

**Multi-CLI Coexistence** (CRITICAL):
- If your task conflicts with existing uncommitted changes, **STOP and report the conflict** instead of overwriting
- Treat all pre-existing uncommitted changes as intentional work-in-progress by other tools


## System Optimization

**Direct Binary Calls**: Always call binaries directly in `functions.shell`, set `workdir`, avoid shell wrappers (`bash -lc`, `cmd /c`, etc.)

**Text Editing Priority**:
1. Use `apply_patch` tool for all routine text edits
2. Fall back to `sed` for single-line substitutions if unavailable
3. Avoid Python editing scripts unless both fail

**apply_patch invocation**:
```json
{
  "command": ["apply_patch", "*** Begin Patch\n*** Update File: path/to/file\n@@\n- old\n+ new\n*** End Patch\n"],
  "workdir": "<workdir>",
  "justification": "Brief reason"
}
```

**Windows UTF-8 Encoding** (before commands):
```powershell
[Console]::InputEncoding  = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
```

## Context Acquisition (MCP Tools Priority)

**For task context gathering and analysis, ALWAYS prefer MCP tools**:

1. **mcp__ace-tool__search_context** - HIGHEST PRIORITY for code discovery
   - Semantic search with real-time codebase index
   - Use for: finding implementations, understanding architecture, locating patterns
   - Example: `mcp__ace-tool__search_context(project_root_path="/path", query="authentication logic")`

2. **smart_search** - Fallback for structured search
   - Use `smart_search(query="...")` for keyword/regex search
   - Use `smart_search(action="find_files", pattern="*.ts")` for file discovery
   - Supports modes: `auto`, `hybrid`, `exact`, `ripgrep`

3. **read_file** - Batch file reading
   - Read multiple files in parallel: `read_file(path="file1.ts")`, `read_file(path="file2.ts")`
   - Supports glob patterns: `read_file(path="src/**/*.config.ts")`

**Priority Order**:
```
ACE search_context (semantic) → smart_search (structured) → read_file (batch read) → shell commands (fallback)
```

**NEVER** use shell commands (`cat`, `find`, `grep`) when MCP tools are available.

## Workflow Session Awareness

| Workflow | Directory | Summary File |
|----------|-----------|-------------|
| `workflow-plan` | `.workflow/active/WFS-*/` | `workflow-session.json` |
| `workflow-lite-plan` | `.workflow/.lite-plan/{date}-{slug}/` | `plan.json` |
| `analyze-with-file` | `.workflow/.analysis/ANL-*/` | `conclusions.json` |
| `multi-cli-plan` | `.workflow/.multi-cli-plan/*/` | `session-state.json` |
| `lite-fix` | `.workflow/.lite-fix/*/` | `fix-plan.json` |
| Other | `.workflow/.debug/`, `.workflow/.scratchpad/`, `.workflow/archives/` | — |

Before starting work, scan recent sessions (7 days) to avoid conflicts and reuse prior work:
- Overlapping file scope → warn, suggest referencing prior session
- Complementary findings → feed into current task context


## Knowledge Capture Discipline

### Spec Format Enforcement

- All writes to `.workflow/specs/` **must** use `<spec-entry>` closed-tag format:
  ```markdown
  <spec-entry category="{cat}" keywords="{kw1},{kw2}" date="{YYYY-MM-DD}" source="{origin}">

  ### {title}

  {content}

  </spec-entry>
  ```
- Valid categories: `coding`, `arch`, `quality`, `debug`, `test`, `review`, `learning`
- Never write unstructured Markdown to spec files (legacy heading format is read-only)
- Manual writes go through `spec-add`; automated writes follow `workflows/specs-add.md` template

### Inquiry Triggers

At these key moments, **proactively ask** the user whether knowledge should be captured:

| Trigger | Question | Target |
|---------|----------|--------|
| Task deviates from plan (approach change, dep swap) | "Should this decision be recorded as an architecture constraint?" | `arch` |
| Task succeeds after ≥2 retries | "Should this fix pattern be documented in debug-notes?" | `debug` |
| Verify finds anti-patterns or constraint violations | "Should quality-rules or architecture-constraints be updated?" | `quality`/`arch` |
| Debug confirms root cause | "Should this root cause pattern be recorded to prevent recurrence?" | `learning`/`debug` |
| Milestone completion | "Were any conventions bypassed? Should coding-conventions be updated?" | `coding` |

### Knowledge Promotion

- At milestone retrospective, scan `learnings.md` for high-frequency patterns (keywords in ≥2 entries) and suggest promoting to formal conventions (`coding`/`arch`/`quality`)
- When promoting, preserve original `date` and source traceability
- Harvest routing: universal patterns → `coding`/`arch`, component pitfalls → `learning`, quality rules → `quality`

### Evidence Chain

- Each spec entry should include at least one traceable source: `file:line`, `INS-{id}`, `HRV-{id}`, commit hash, or phase/plan path
- `source` attribute marks write origin: `manual`/`execute`/`retrospective`/`milestone-complete`/`harvest`/`debug`

## Execution Checklist

**Before**:
- [ ] Understand PURPOSE and TASK clearly
- [ ] Use ACE search_context first, fallback to smart_search for discovery
- [ ] Use read_file to batch read context files, find 3+ patterns
- [ ] Check RULES templates and constraints

**During**:
- [ ] Follow existing patterns exactly
- [ ] Write tests alongside code
- [ ] Run tests after every change
- [ ] Commit working code incrementally

**After**:
- [ ] All tests pass
- [ ] Coverage meets target
- [ ] Build succeeds
- [ ] All EXPECTED deliverables met
- [ ] Knowledge inquiry triggers evaluated (spec-add if applicable)
