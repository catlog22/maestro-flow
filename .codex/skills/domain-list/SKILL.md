---
name: domain-list
description: List registered domain terms from glossary
argument-hint: "[--tier core|extended|peripheral]"
allowed-tools: Read, Bash, Glob, Grep
---

<purpose>
List all registered domain terms from `.workflow/domain/glossary.yaml`. Shows canonical name, definition, tier, aliases, and status.
</purpose>

<context>
$ARGUMENTS — optional `--tier core|extended|peripheral` filter.

**Output boundary**: Read-only command — NEVER write any files. Display output to console only.
</context>

<invariants>
1. **Strictly read-only** — NEVER modify `glossary.yaml` or any other file; display-only operation
2. **Complete listing** — MUST show all registered terms (filtered by --tier if specified); NEVER silently omit entries
3. **Tier grouping** — MUST group terms by tier (core → extended → peripheral → deprecated); NEVER display flat unsorted list
4. **Graceful absence** — if glossary.yaml does not exist, report "No domain glossary" with init command; NEVER create or auto-initialize
</invariants>

<execution>

### Step 1: Load Glossary

Read `.workflow/domain/glossary.yaml`. If not exists, report "No domain glossary — run `maestro domain init`".

### Step 2: Filter and Display

Apply optional `--tier` filter. Display terms grouped by tier (core → extended → peripheral):

```
=== DOMAIN TERMS ({N} total) ===

[core]
  auth-token — Short-lived credential for API authentication
    aliases: 令牌, access-token | keywords: auth, credential, jwt
  event-bus — Central pub-sub message broker
    aliases: 事件总线 | keywords: pubsub, messaging

[extended]
  ...

[deprecated]
  wikiindexer → search-engine (successor)
```

</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | `.workflow/domain/glossary.yaml` not found | Run `maestro domain init` first |
| E002 | error | glossary.yaml parse error (invalid YAML) | Check file syntax |
| W001 | warning | No terms match --tier filter | Show "No terms in tier: {tier}" |
</error_codes>

<success_criteria>
- [ ] Glossary loaded and parsed successfully
- [ ] Terms grouped by tier (core → extended → peripheral → deprecated)
- [ ] Optional --tier filter applied correctly
- [ ] Each term displayed with canonical name, definition, aliases, keywords
- [ ] Total count shown
</success_criteria>
