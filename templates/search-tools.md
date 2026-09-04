# Search Tools

## Semantic Search Tool

@~/.maestro/templates/search-tool.json

## Priority

```
maestro explore (structured) → Semantic Search → Grep (pattern) → Glob (files)
```

## Tool Selection

| Scenario | Tool |
|----------|------|
| Multi-angle codebase scan | `maestro explore` with multi-prompt parallel |
| Targeted code search (known scope) | `maestro explore` single prompt with FIND/SCOPE |
| Find by intent/behavior | Semantic search tool (see above) |
| Known identifier/regex | `Grep` |
| Find files by name/ext | `Glob` |
| Deep cross-file reasoning | `maestro delegate --role analyze --mode analysis` |
| Read identified file | `Read` |

## Architecture Template References

For architecture or system-design decisions, reuse upstream
`architecture_template_evidence` when present. Otherwise, only the upstream
research owner may run one focused search:

`maestro search "<1-3 architecture keywords>" --type template --json --limit 3`

Load each selected hit using its emitted `openCommand`, normally
`maestro load --type template --id <id> --json`. The legacy
`maestro arch-kb show <id> [--section <name>]` command remains available for
backward-compatible direct reads outside this evidence flow; it never replaces
the required load for selected evidence.

Results with `source: "arch-kb"` and `kind: "template"` are global,
reference-only evidence, never current-project knowledge or requirements.
Assess each as candidate/adopted/adapted/rejected with rationale. Never put
template IDs in `knowledge_ids`, project-knowledge priors, consumption
receipts, or `maestro knowledge record`.

Ownership: researchers search and load; synthesizers preserve; planners
consume and record applicability; checkers and reviewers validate recorded
use without re-searching.

### Evidence Envelope

Use this optional envelope across workflow artifacts:

```json
{
  "architecture_template_evidence": {
    "status": "not_applicable|no_match|loaded|load_failed",
    "query": "payment system idempotency",
    "templates": [
      {
        "template_id": "arch-tpl-payment-system",
        "title": "Payment System Architecture Template",
        "source": "arch-kb",
        "kind": "template",
        "source_ref": "templates/payment-system/README.md",
        "load_command": "maestro load --type template --id arch-tpl-payment-system",
        "reference_only": true,
        "disposition": "candidate|adopted|adapted|rejected",
        "applies_to": ["ADR-002", "TASK-003"],
        "rationale": "Adopt idempotency boundary; replace storage topology with the existing repository pattern."
      }
    ]
  }
}
```

`loaded` requires at least one successfully loaded entry. `no_match` records a
completed search and prevents duplicate downstream search. `load_failed` cannot
produce adopted/adapted entries and should lower confidence. A missing envelope
means legacy or unknown, not `no_match`.

When normalizing the envelope into a plan, store `{status, query}` in
`shared_context.architecture_template_search` and store only `templates[]` in
`shared_context.architecture_templates`. Never assign the envelope object to the
array field.

Deduplicate by `template_id`; adopted/adapted entries require `rationale` and
non-empty `applies_to`; task references must resolve to plan-level records;
candidate/rejected entries cannot become mandatory task criteria; review
findings require code anchors plus an adopted project constraint. Template IDs
must remain absent from `knowledge_ids`, `priors.specs/wiki`, and knowledge
record commands.

## maestro explore Prompt Format

```
FIND: [what to search for]
SCOPE: [file patterns or directories]
EXCLUDE: [what to skip]
ATTENTION: [caveats, edge cases]
EXPECTED: [output format]
```

Single prompt: `maestro explore "FIND: ... SCOPE: src/" --max-turns 3`

Multi-prompt parallel: `maestro explore "prompt1" "prompt2" --json`

## Fallback

- **explore unavailable** → Semantic search + Grep + Glob pattern scanning
- **Semantic search unavailable** → Grep + Glob; log degraded mode
- **Grep insufficient** → Escalate to CLI delegate analysis

## Combined Strategy

For thorough exploration: maestro explore (broad) → Grep (validate specific) → Read (deep examine)
