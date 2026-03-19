# Discovery Board Protocol

Shared discovery board specification for all maestro CSV wave skills.

## Standard Discovery Types

| Type | Dedup Key | Data Schema | Description |
|------|-----------|-------------|-------------|
| `code_pattern` | `data.name` | `{name, file, description}` | Reusable code pattern found |
| `integration_point` | `data.file` | `{file, description, exports[]}` | Module connection point |
| `convention` | singleton | `{naming, imports, formatting}` | Project code conventions |
| `blocker` | `data.issue` | `{issue, severity, impact}` | Blocking issue found |
| `tech_stack` | singleton | `{framework, language, tools[]}` | Technology stack info |
| `test_command` | singleton | `{command, framework, config}` | Test execution commands |

## NDJSON Format

```jsonl
{"ts":"2026-03-18T10:00:00Z","worker":"1","type":"code_pattern","data":{"name":"error-handler","file":"src/utils/errors.ts","description":"Centralized error handler using Result type"}}
{"ts":"2026-03-18T10:00:01Z","worker":"2","type":"convention","data":{"naming":"camelCase functions, PascalCase types","imports":"barrel exports via index.ts","formatting":"prettier + eslint"}}
```

## Agent Protocol

1. **Read first**: Load `{session_folder}/discoveries.ndjson` before own exploration
2. **Skip covered**: If a discovery of same type + dedup key exists, don't repeat that exploration
3. **Write immediately**: Append findings as they're found, don't batch
4. **Append-only**: Never modify or delete existing lines
5. **Deduplicate**: Check existing entries before writing; skip if same type + dedup key exists

## Reading Discoveries

Agents must load and filter discoveries before their own exploration:

1. **Load**: Read `{session_folder}/discoveries.ndjson` line by line (each line is one JSON object)
2. **Parse**: `JSON.parse()` each non-empty line individually — do NOT parse the entire file as a single JSON array
3. **Filter by type**: Select entries matching the types relevant to your task (e.g., `type == "tech_stack"`)
4. **Filter by dedup key**: For singleton types, use only the latest entry (highest `ts`). For keyed types, group by dedup key and use the latest per key
5. **Apply**: Use filtered discoveries to skip redundant exploration — if another agent already found the framework or convention, build on that finding instead of re-scanning
6. **Handle missing file**: If `discoveries.ndjson` does not exist, proceed without prior discoveries (first agent to run)

### Read Command Template

```bash
# Read all discoveries
cat {session_folder}/discoveries.ndjson 2>/dev/null || true

# Filter by type (e.g., tech_stack)
grep '"type":"tech_stack"' {session_folder}/discoveries.ndjson 2>/dev/null || true

# Filter by worker (e.g., task 2's discoveries)
grep '"worker":"2"' {session_folder}/discoveries.ndjson 2>/dev/null || true
```

## Append Command

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","worker":"{id}","type":"<type>","data":{...}}' >> {session_folder}/discoveries.ndjson
```
