# Search Tools

## Semantic Search Tool

@~/.maestro/templates/search-tool.json

## Priority

```
Semantic Search → Grep (pattern) → Glob (files) → CLI (deep analysis)
```

## Tool Selection

| Scenario | Tool |
|----------|------|
| Find by intent/behavior | Semantic search tool (see above) |
| Known identifier/regex | `Grep` |
| Find files by name/ext | `Glob` |
| Complex cross-file reasoning | `maestro delegate --to gemini --mode analysis` |
| Read identified file | `Read` |

## Fallback

- **Semantic search unavailable** → Grep + Glob pattern scanning; log degraded mode
- **Grep insufficient** → Escalate to CLI analysis
- **CLI error** → Retry with shorter scope, proceed with available results

## Combined Strategy

For thorough exploration: Semantic Search (broad) → Grep (validate) → Glob (enumerate) → Read (deep examine)
