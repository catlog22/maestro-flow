# Codex Code Guidelines
## Delegate & CLI

- **Delegate Usage**: @~/.maestro/workflows/delegate-usage.md
- **CLI Endpoints Config**: @~/.maestro/cli-tools.json

**Strictly follow the cli-tools.json configuration**

Available CLI endpoints are dynamically defined by the config file

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


## Knowledge System

### Search — Query Before Acting

**Before planning or implementing any task, search wiki and spec first** — the knowledge base contains reusable methods, tools, and hard-won experience. Load the right knowledge at the right time: search before you plan, load relevant entries before you implement, and revisit when you hit unfamiliar territory mid-task.

- `maestro spec load --category <cat>` — load rules by category (coding/arch/debug/test/review/learning)
- `maestro spec load --keyword <kw>` — cross-category keyword match
- `maestro wiki search "<query>"` — full-text search across all knowhow
- `maestro wiki list --category <cat>` → `maestro wiki load <id>` — browse then load full detail

### Knowledge Capture

- **Spec writes** → always `<spec-entry>` closed-tag format with `category`, `keywords`, `date`, `source`. Never raw Markdown. Route through `spec-add` when possible.
- **Capture signal** → when execution surfaces non-obvious knowledge (plan deviation, retry pattern, root cause, constraint violation), ask user once whether to persist it. Match category to content: decisions→`arch`, pitfalls→`debug`/`learning`, patterns→`coding`, rules→`quality`.
- **Promotion** → at milestone close, scan learnings for repeated keywords (≥2 entries) and offer to graduate them into formal conventions.
- **Traceability** → every entry needs a source anchor: `file:line`, `INS-{id}`, commit, or phase path.


