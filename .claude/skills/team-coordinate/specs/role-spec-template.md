# Dynamic Role-Spec Template

Template used by coordinator to generate lightweight worker role-spec files at runtime. Each generated role-spec is written to `<session>/role-specs/<role-name>.md`.

**Key difference from v1**: Role-specs contain ONLY Phase 2-4 domain logic + YAML frontmatter. All shared behavior (Phase 1 Task Discovery, Phase 5 Report/Fast-Advance, Message Bus, Consensus, Inner Loop) is built into the `team-worker` agent.

## Template

```markdown
---
role: <role_name>
prefix: <PREFIX>
inner_loop: <true|false>
CLI tools: [<CLI tool-names>]
message_types:
  success: <prefix>_complete
  error: error
---

# <Role Name> — Phase 2-4

## Phase 2: <phase2_name>

<phase2_content>

## Phase 3: <phase3_name>

<phase3_content>

## Phase 4: <phase4_name>

<phase4_content>

## Error Handling

| Scenario | Resolution |
|----------|------------|
<error_entries>
```

## Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `role` | Yes | Role name matching session registry |
| `prefix` | Yes | Task prefix to filter (e.g., RESEARCH, DRAFT, IMPL) |
| `inner_loop` | Yes | Whether team-worker loops through same-prefix tasks |
| `CLI tools` | No | Array of CLI tool types this role may call |
| `output_tag` | Yes | Output tag for all messages, e.g., `[researcher]` |
| `message_types` | Yes | Message type mapping for team_msg |
| `message_types.success` | Yes | Type string for successful completion |
| `message_types.error` | Yes | Type string for errors (usually "error") |

## Design Rules

| Rule | Description |
|------|-------------|
| Phase 2-4 only | No Phase 1 (Task Discovery) or Phase 5 (Report) — team-worker handles these |
| No message bus code | No team_msg calls — team-worker handles logging |
| No consensus handling | No consensus_reached/blocked logic — team-worker handles routing |
| No inner loop logic | No Phase 5-L/5-F — team-worker handles looping |
| ~80 lines target | Lightweight, domain-focused |
| No pseudocode | Decision tables + text + tool calls only |
| `<placeholder>` notation | Use angle brackets for variable substitution |
| Reference CLI tools by name | team-worker resolves invocation from its delegation templates |

## Generated Role-Spec Structure

Every generated role-spec MUST include these blocks:

### Identity Block (mandatory — first section of generated spec)

```
Tag: [<role_name>] | Prefix: <PREFIX>-*
Responsibility: <one-line from task analysis>
```

### Boundaries Block (mandatory — after Identity)

```
### MUST
- <3-5 rules derived from task analysis>

### MUST NOT
- Execute work outside assigned prefix
- Modify artifacts from other roles
- Skip Phase 4 verification
```

## Behavioral Traits

All dynamically generated role-specs MUST embed these traits into Phase 4. Coordinator copies this section verbatim into every generated role-spec as a Phase 4 appendix.

**Design principle**: Constrain behavioral characteristics (accuracy, feedback, quality gates), NOT specific actions (which tool, which CLI tool, which path). Tasks are diverse — the coordinator composes task-specific Phase 2-3 instructions, while these traits ensure execution quality regardless of task type.

### Accuracy — outputs must be verifiable

- Files claimed as **created** → Read to confirm file exists and has content
- Files claimed as **modified** → Read to confirm content actually changed
- Analysis claimed as **complete** → artifact file exists in `<session>/artifacts/`

### Feedback Contract — completion report must include evidence

Phase 4 must produce a verification summary with these fields:

| Field | When Required | Content |
|-------|---------------|---------|
| `files_produced` | New files created | Path list |
| `files_modified` | Existing files changed | Path + before/after line count |
| `artifacts_written` | Always | Paths in `<session>/artifacts/` |
| `verification_method` | Always | How verified: Read confirm / syntax check / diff |

### Quality Gate — verify before reporting complete

- Phase 4 MUST verify Phase 3's **actual output** (not planned output)
- Verification fails → retry Phase 3 (max 2 retries)
- Still fails → report `partial_completion` with details, NOT `completed`
- Update shared state via `team_msg(operation="log", type="state_update", data={...})` after verification passes

Quality thresholds from [specs/quality-gates.md](quality-gates.md):
- Pass >= 80%: report completed
- Review 60-79%: report completed with warnings
- Fail < 60%: retry Phase 3 (max 2)

### Error Protocol

- Primary approach fails → try alternative (different CLI tool / different tool)
- 2 retries exhausted → escalate to coordinator with failure details
- NEVER: skip verification and report completed

---

## Reference Patterns

Coordinator MAY reference these patterns when composing Phase 2-4 content for a role-spec. These are **structural guidance, not mandatory templates**. The task description determines specific behavior — patterns only suggest common phase structures.

### Research / Exploration

- Phase 2: Define exploration scope + load prior knowledge from shared state and wisdom
- Phase 3: Explore via CLI tools, direct tool calls, or codebase search — approach chosen by agent
- Phase 4: Verify findings documented (Behavioral Traits) + update shared state

### Document / Content

- Phase 2: Load upstream artifacts + read target files (if modifying existing docs)
- Phase 3: Create new documents OR modify existing documents — determined by task, not template
- Phase 4: Verify documents exist with expected content (Behavioral Traits) + update shared state

### Code Implementation

- Phase 2: Load design/spec artifacts from upstream
- Phase 3: Implement code changes — CLI tool choice and approach determined by task complexity
- Phase 4: Syntax check + file verification (Behavioral Traits) + update shared state

### Analysis / Audit

- Phase 2: Load analysis targets (artifacts or source files)
- Phase 3: Multi-dimension analysis — perspectives and depth determined by task
- Phase 4: Verify report exists + severity classification (Behavioral Traits) + update shared state

### Validation / Testing

- Phase 2: Detect test framework + identify changed files from upstream
- Phase 3: Run test-fix cycle — iteration count and strategy determined by task
- Phase 4: Verify pass rate + coverage (Behavioral Traits) + update shared state

---

## Knowledge Transfer Protocol

Full protocol: [specs/knowledge-transfer.md](knowledge-transfer.md)

Generated role-specs Phase 2 MUST declare which upstream sources to load.
Generated role-specs Phase 4 MUST include state update and artifact publishing.

---

## Generated Role-Spec Validation

Coordinator verifies before writing each role-spec:

| Check | Criteria |
|-------|----------|
| Frontmatter complete | All required fields present (role, prefix, inner_loop, output_tag, message_types, CLI tools) |
| Identity block | Tag, prefix, responsibility defined |
| Boundaries | MUST and MUST NOT rules present |
| Phase 2 | Context loading sources specified |
| Phase 3 | Execution goal clear, not prescriptive about tools |
| Phase 4 | Behavioral Traits copied verbatim |
| Error Handling | Table with 3+ scenarios |
| Line count | Target ~80 lines (max 120) |
| No built-in overlap | No Phase 1/5, no message bus code, no consensus handling |
