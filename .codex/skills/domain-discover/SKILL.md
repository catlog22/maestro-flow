---
name: domain-discover
description: Discover domain term candidates from codebase
argument-hint: "[--auto]"
allowed-tools: Read, Bash, Glob, Grep
session-mode: none
---

<purpose>
Scan codebase for potential domain terms not yet in `.workflow/domain/glossary.yaml`. Presents candidates with confidence scores for interactive registration.

`--auto`: auto-register candidates with confidence ≥ 0.8 without prompting.
</purpose>

<context>
$ARGUMENTS — optional `--auto` flag.

**Output boundary**: ALL file writes MUST target `.workflow/domain/glossary.yaml` only (via `maestro domain add`). NEVER modify source code or files outside this path.
</context>

<invariants>
1. **Read-only scan** — NEVER modify source code files during codebase scan; only glossary.yaml is written (via `maestro domain add`)
2. **Dedup against existing** — MUST filter all candidates against current glossary before presenting; NEVER show already-registered terms
3. **Confidence threshold for auto** — `--auto` MUST only register candidates with confidence ≥ 0.8; candidates below threshold MUST be skipped or presented for manual review
4. **User confirmation required** — without `--auto`, MUST present candidates and obtain user selection before any registration; NEVER auto-register in interactive mode
5. **Atomic registration** — each accepted candidate MUST be registered via individual `maestro domain add` call; NEVER batch-write directly to glossary.yaml
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Scan → Filter**
- REQUIRED: Codebase scan completed with at least 1 candidate found.
- BLOCKED if: no candidates found — report "No new domain terms detected" and exit.

**GATE 2: Filter → Present**
- REQUIRED: All candidates deduplicated against existing glossary.yaml entries.
- BLOCKED if: glossary.yaml not found (E001) — prompt user to run `maestro domain init`.

**GATE 3: Present → Register**
- REQUIRED: User selection obtained (unless `--auto` with confidence ≥ 0.8).
- BLOCKED if: user selects "skip" — exit without registration.

### Step 1: Scan Codebase

Run `maestro domain discover` to scan TypeScript interfaces, types, enums, const patterns, API routes, and README headings.

### Step 2: Filter Existing

Remove candidates already registered in glossary.yaml (by canonical name or alias match).

### Step 3: Present Candidates

Display ranked candidates with confidence scores:

```
=== DOMAIN TERM CANDIDATES ({N} found) ===

  0.92  session-context — Runtime state container for active workflow session
  0.85  skill-resolver — Module that maps skill names to SKILL.md file paths
  0.71  chain-graph — DAG definition for multi-step command sequences
  ...

Register? (all | select by number | skip)
```

### Step 4: Register Selected

For each confirmed candidate, run `maestro domain add "<canonical>" "<definition>"`.

</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | `.workflow/domain/glossary.yaml` not found | Run `maestro domain init` first |
| E002 | error | Codebase scan failed (no TypeScript/source files found) | Check project structure |
| W001 | warning | No new candidates after dedup filtering | All potential terms already registered |
| W002 | warning | `--auto` skipped low-confidence candidates | Review skipped candidates manually |
</error_codes>

<success_criteria>
- [ ] Codebase scanned for domain term candidates
- [ ] Existing glossary terms filtered out (no duplicates presented)
- [ ] Candidates ranked by confidence score
- [ ] User selection obtained (interactive) or confidence threshold applied (--auto)
- [ ] Selected candidates registered via `maestro domain add`
- [ ] Summary displayed with registration count
</success_criteria>
