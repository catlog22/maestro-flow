---
name: quality-review
description: Tiered code review (quick/standard/deep) with parallel agents, severity classification, and auto-issue creation
argument-hint: "<phase> [--level quick|standard|deep] [--dimensions security,architecture,...] [--skip-specs]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---
<purpose>
Run multi-dimensional code review on a completed phase's changed files. Answers the question "is this code good?" — complementing maestro-verify ("is the goal met?") and quality-test ("does it work for users?").

Supports three review levels that scale with task depth:

**Quick** — Single-pass inline scan, no agents. For small changes (≤3 files) or scratch tasks.
  - Dimensions: correctness + security only
  - No deep-dive, issues created for critical only

**Standard** — Parallel agent review across all dimensions. Default for most phases.
  - Dimensions: all 6 (correctness, security, performance, architecture, maintainability, best-practices)
  - Auto deep-dive if critical findings > 0
  - Issues created for critical + high

**Deep** — Full agent review with forced multi-iteration deep-dive and cross-file impact analysis. For complex/critical phases.
  - Dimensions: all 6
  - Forced deep-dive (max 3 iterations) with impact radius analysis
  - Issues created for critical + high + medium

Level auto-detection when not specified:
  - ≤3 changed files → quick
  - 4-19 changed files → standard
  - ≥20 changed files OR phase marked critical in index.json → deep
</purpose>

<required_reading>
@~/.maestro/workflows/review.md
</required_reading>

<deferred_reading>
- [index.json](~/.maestro/templates/index.json) — read when updating phase index after review
</deferred_reading>

<context>
Phase: $ARGUMENTS (required — phase number or slug)

**Flags:**
- `--level quick|standard|deep` — Explicit review level (default: auto-detect from file count)
- `--dimensions <list>` — Comma-separated subset of dimensions to review (overrides level defaults)
- `--skip-specs` — Skip loading project specs as review context

Context files resolved from `.workflow/phases/{NN}-{slug}/`:
- index.json (phase metadata, execution results)
- plan.json (task overview)
- .task/TASK-{NNN}.json (task definitions with file lists)
- .summaries/TASK-{NNN}-summary.md (execution results)
- verification.json (if exists — incorporate verification gaps as review context)
</context>

<execution>
Follow '~/.maestro/workflows/review.md' completely.

**Report format on completion:**

```
=== CODE REVIEW RESULTS ===
Phase:     {phase_name}
Level:     {quick | standard | deep}
Files:     {files_reviewed} files across {dimensions_count} dimensions
Duration:  {duration}

Severity Distribution:
  Critical: {critical_count}
  High:     {high_count}
  Medium:   {medium_count}
  Low:      {low_count}

Top Issues:
  1. [{severity}] {finding_id}: {title} ({file}:{line})
  2. ...

Verdict: {PASS | WARN | BLOCK}
Issues Created: {issue_count}

Files:
  {phase_dir}/review.json

Next steps:
  {verdict_based_routing}
```

**Next-step routing by verdict:**
- PASS → Skill({ skill: "quality-test", args: "{phase}" })
- PASS + low test coverage → Skill({ skill: "quality-test-gen", args: "{phase}" })
- WARN → Skill({ skill: "quality-test", args: "{phase}" }) (proceed with caveats)
- BLOCK → Skill({ skill: "maestro-plan", args: "{phase} --gaps" }) (fix critical findings first)
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Phase argument required | Check arguments format, re-run with correct input |
| E002 | error | Phase directory not found | Check arguments format, re-run with correct input |
| E003 | error | No execution results found (no task summaries) | Verify execution completed with task summaries |
| E004 | error | No changed files detected in phase | Verify execution completed with task summaries |
| W001 | warning | Some dimension agents failed, partial results | Retry failed dimensions or accept partial results |
| W002 | warning | Deep-dive iteration limit reached with unresolved criticals | Accept current findings or escalate manually |
</error_codes>

<success_criteria>
- [ ] Phase resolved and changed files collected from task summaries
- [ ] Review level determined (explicit flag or auto-detected)
- [ ] Project specs loaded as review context (unless --skip-specs)
- [ ] Dimension reviews executed (inline for quick, parallel agents for standard/deep)
- [ ] All dimension results aggregated with severity classification
- [ ] Deep-dive completed if triggered (standard: auto, deep: forced)
- [ ] review.json written with complete findings, severity distribution, verdict
- [ ] Issues auto-created based on level thresholds
- [ ] index.json updated with review status
- [ ] Next step routed by verdict (PASS→test, WARN→test with caveats, BLOCK→plan --gaps)
</success_criteria>
