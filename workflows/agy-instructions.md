# Maestro for Antigravity CLI

Workflow orchestration CLI with MCP endpoint support and extensible architecture, adapted for Antigravity CLI tooling.

- **Coding Philosophy**: @~/.maestro/workflows/coding-philosophy.md

## Delegate & CLI

- **Delegate Usage**: @~/.maestro/workflows/delegate-usage.md
- **CLI Endpoints Config**: @~/.maestro/cli-tools.json

**Strictly follow the cli-tools.json configuration**

Available CLI endpoints are dynamically defined by the config file. Use `maestro delegate --to agy` to dispatch tasks to the Antigravity CLI.

## Antigravity Tool Priority

When choosing between equivalent tools, prefer the agy native primitives over shell fallbacks:

| Need | Prefer | Fallback |
|------|--------|----------|
| Read a file | `view_file(AbsolutePath, StartLine, EndLine)` | `run_command("Get-Content ...")` |
| Read external URL | `read_url_content(Url)` | `run_command("curl ...")` |
| Create / overwrite file | `write_to_file(TargetFile, CodeContent, Overwrite)` | n/a |
| Single-block edit | `replace_file_content(TargetFile, StartLine, EndLine, TargetContent, ReplacementContent)` | n/a |
| Multi-block edit on same file | `multi_replace_file_content(TargetFile, ReplacementChunks=[...])` | repeated `replace_file_content` |
| Search text | `grep_search(SearchPath, Query, IsRegex, Includes)` | `run_command("rg ...")` |
| List directory | `list_dir(DirectoryPath)` | `run_command("ls ...")` |
| Execute shell | `run_command(CommandLine, Cwd, WaitMsBeforeAsync)` | n/a |
| Web search | `search_web(query, domain)` | n/a |
| Ask user | `ask_question(questions=[{question, options, is_multi_select}])` | n/a |

Always pass `Cwd` to `run_command`; do not rely on inherited shell cwd. On Windows, set UTF-8 in PowerShell before chained commands:

```powershell
[Console]::InputEncoding  = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
```

## Sub-Agent Orchestration (Two Phases)

Antigravity uses an explicit two-phase model for sub-agents — unlike Claude's single `Agent(...)` call:

1. **Define**: declare the sub-agent type once per session (idempotent within a session)
   ```
   define_subagent(
     name="team-worker",
     description="Generic role-spec worker",
     system_prompt="<contents of antigravity-cli/agents/team-worker.md>",
     enable_write_tools=true,
     enable_mcp_tools=true,
     enable_subagent_tools=false
   )
   ```

2. **Invoke**: spawn one or more instances; capture the returned ConversationId for later messaging
   ```
   invoke_subagent([
     { TypeName: "team-worker",
       Role:     "<concrete role label>",
       Prompt:   "<task-specific instructions>",
       Workspace: "inherit"            # inherit | branch | share
     }
   ])
   ```

**Workspace modes**:
- `inherit` — share the parent's working directory (default; matches Claude semantics)
- `branch` — independent filesystem branch (useful for parallel waves that must not collide)
- `share` — explicit cross-worker sharing (rare; use only when workers must atomically see each other's writes)

**Inter-agent messaging**: `send_message(Recipient=<ConversationId>, Message=<text>)`. The Recipient must be a ConversationId returned by `invoke_subagent`, never a role name.

**Background OS tasks vs sub-agents**: `manage_task` handles `run_command` async instances (list / kill / status / send_input). Do **not** repurpose it for named task tracking — use `.workflow/tasks/<id>.json` files instead.

## Cross-Skill Invocation

Agent-internal chaining uses the **inline-execute** pattern:

```
view_file(AbsolutePath="<agy-skills-dir>/<target-skill>/SKILL.md") + execute inline (args: "...")
```

`<agy-skills-dir>` resolves to:
- global install: `~/.gemini/antigravity-cli/skills/`
- workspace install: `<project>/.agents/skills/`

The agent reads the target SKILL.md, treats its body as additional instructions, and executes them in the same conversation context. Args are passed conceptually as input variables — substitute them when running the loaded instructions.

User-initiated invocation uses `/skills`.

## Cross-Worker Coordination

Antigravity has no built-in message bus. For shared logs across workers, write JSONL lines to `.workflow/.team/<session>/.msg/messages.jsonl`:

- Log:   `write_to_file(TargetFile=".workflow/.team/<session>/.msg/messages.jsonl", CodeContent="<json line>\n", Overwrite=false)`
- Read:  `view_file(AbsolutePath=".workflow/.team/<session>/.msg/messages.jsonl")` then filter client-side
- Status snapshot: write `<session>/.msg/state.json` and read with `view_file`

For point-to-point delivery, use `send_message` directly.

## Code Diagnostics

- **Prefer `mcp__ide__getDiagnostics`** for code error checking over shell-based TypeScript compilation when the MCP channel is available.

## Knowledge System

### Search — Query Before Acting

When tackling unfamiliar domains or cross-cutting concerns, search existing knowledge first:
- `maestro spec load --category <cat>` — load rules by category (coding/arch/debug/test/review/learning)
- `maestro spec load --keyword <kw>` — cross-category keyword match
- `maestro wiki search "<query>"` — full-text search across all knowhow
- `maestro wiki list --category <cat>` → `maestro wiki load <id>` — browse then load full detail

### Record — Capture Knowledge

When execution surfaces non-obvious knowledge (decisions, root causes, pitfalls, patterns), persist it:

- **Spec entry** (short rule/constraint) → `/spec-add <category> "title" "content" --keywords kw1,kw2`
- **Knowhow document** (detailed recipe/template/decision/reference) → `/manage-knowhow-capture`

Category routing: decisions→`arch`, patterns→`coding`, pitfalls→`debug`/`learning`, rules→`review`, test strategy→`test`.
