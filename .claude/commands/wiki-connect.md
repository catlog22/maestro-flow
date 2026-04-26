---
name: wiki-connect
description: Surface hidden connections in the wiki knowledge graph and suggest or apply new links
argument-hint: "[--scope <type>] [--min-similarity N] [--fix] [--max N]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<required_reading>
@~/.maestro/workflows/wiki-connect.md
</required_reading>

<purpose>
Knowledge graph link discovery and health improvement. Analyzes the wiki index to find orphaned entries, missing connections, and transitive link gaps, then suggests or auto-applies new `related` links to improve graph connectivity.

Leverages maestro's unique wiki graph infrastructure (BM25 search, backlinks, health scoring) — no equivalent in gstack. Directly improves the quality of all downstream wiki consumers (search, digest, follow-along).
</purpose>

<context>
Arguments: $ARGUMENTS

Flags, storage paths, and CLI commands defined in workflow wiki-connect.md.
</context>

<execution>
Follow '~/.maestro/workflows/wiki-connect.md' completely (Stages 1-6).

**Next-step routing:**
- Generate knowledge digest → `/wiki-digest <topic>`
- Follow-along on orphan → `/learn-follow <wiki-id>`
- View full graph → `maestro wiki graph`
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No wiki entries found (empty index) | Initialize wiki content first, or run `/maestro-init` |
| E002 | error | `maestro wiki` CLI not available | Check maestro installation |
| W001 | warning | No connection candidates found above threshold | Lower --min-similarity or check if graph is already well-connected |
| W002 | warning | Some wiki update calls failed during --fix | Partial application; retry failed entries manually |
| W003 | warning | Health score unchanged after fix | Connections may not have improved the specific health metrics |
</error_codes>

<success_criteria>
- [ ] Wiki index loaded with entry count and type distribution
- [ ] Baseline health score recorded
- [ ] Orphans identified and rescue candidates generated
- [ ] Connection candidates scored and ranked
- [ ] Results filtered by --min-similarity and limited by --max
- [ ] Suggestions displayed with scores and reasons
- [ ] If --fix: entries updated with new `related` links
- [ ] If --fix: new health score computed and delta reported
- [ ] Report written to `wiki-connections-{date}.md`
- [ ] Graph insights appended to `lessons.jsonl`
- [ ] No unintended entry modifications (only `related` field changed)
- [ ] Summary displayed with next-step routing
</success_criteria>
