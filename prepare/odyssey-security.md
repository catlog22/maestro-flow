---
name: odyssey-security
description: "Odyssey security mode — read-only tiered security audit (OWASP Top 10, dependency supply chain, secrets, CI/CD, STRIDE, git history) producing severity matrix report with file:line evidence. No fix loop."
goal: true
argument-hint: "<target> [--tier quick|standard|deep] [--skip-generalize] [-y] [-c]"
contract:
  consumes:
    - { kind: session, alias: prior-session, required: false }
  produces:
    - { path: outputs/session.json, kind: security-audit-result, alias: security-session, role: primary }
    - { path: outputs/evidence.ndjson, kind: evidence, alias: security-evidence, role: evidence }
    - { path: outputs/understanding.md, kind: security-report, alias: security-understanding, role: primary }
  gates:
    exit: [recon-complete, scan-complete, report-produced]
refs:
  - { path: workflows/odyssey-base.md, when: Shared back-half (GENERALIZE → DISCOVER → RECORD → END) needed }
  - { path: ref/cli-supplementary.md, when: CLI-assisted survey or verification is needed }
---

# Pre-task Thinking: odyssey-security

## Purpose

Odyssey security performs a systematic read-only security audit of a target module or project. It covers OWASP Top 10, dependency supply chain, secrets detection, CI/CD pipeline review, STRIDE threat modeling, and git history archaeology — tiered by depth (quick/standard/deep). Unlike other Odyssey modes, security is strictly read-only: it produces a severity matrix report with file:line evidence and remediation suggestions, but NEVER modifies source code. Before starting, establish the target scope, audit tier, and entry points.

## Input Interpretation

Target resolution determines what gets audited:

| Input | Resolution |
|-------|-----------|
| Module/dir path | Audit that module |
| `--scope <path>` | Limit scan to directory |
| Project root (default) | Full project scan |
| `HEAD` / `staged` | Review changes in diff for security issues |

Tier selection (default: `standard`):

| Tier | OWASP | Dependencies | Secrets | CI/CD | STRIDE | Git History |
|------|-------|-------------|---------|-------|--------|-------------|
| quick | ✓ | ✓ | — | — | — | — |
| standard | ✓ | ✓ | ✓ | ✓ | — | — |
| deep | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Required Context

Context injection (optional, may continue if missing):

- Architecture doc: `.workflow/codebase/ARCHITECTURE.md` → module boundaries, trust zones
- Wiki: `maestro search "<target keywords>"` → prior security audits, known vulnerabilities
- Specs: `maestro load --type spec --category debug` → known vulnerability patterns
- Role knowledge: `maestro search --category coding` → pick relevant items → `maestro load --type knowhow --id`

When prior security audit sessions of the same target exist, check their findings first to avoid re-reporting already-documented issues.

## Boundaries and Invariants

- **Read-only** — NEVER modify source code, configuration, dependencies, or CI/CD files during audit. Security audit produces reports only. All file writes target `{run_dir}/outputs/` exclusively.
- **Findings require file:line evidence** — every finding MUST reference a specific file:line location and include the vulnerable code pattern. No vague or category-only findings.
- **Severity NEVER downgraded without justification** — if a finding matches a known OWASP category, its severity follows OWASP guidance. Downgrading requires documented rationale (e.g., compensating control exists).
- **Tier coverage is mandatory** — all scan phases required by the selected tier MUST complete. NEVER skip a tier-required phase silently; failures are logged as W00x warnings.
- **False positive marking requires evidence** — marking a finding as false positive MUST include the compensating control or code path that prevents exploitation. NEVER dismiss findings without counter-evidence.
- **Secrets are never logged** — if secrets are discovered, report their location (file:line) and type but NEVER include the actual secret value in the report output.
- **No fix loop** — this mode has NO S_FIX or S_CONFIRM states. Findings are reported with remediation suggestions; actual fixes route to `--mode improve` or `--mode debug`.
- **Evidence append-only** — evidence.ndjson entries are immutable observations; modifying or deleting them is forbidden.

## Risk Checklist

- Is every finding anchored to `file:line` with severity, category, description, and remediation? Unanchored findings are not actionable.
- Were all tier-required scan phases attempted? Missing phases mean incomplete coverage.
- Are OWASP category severities preserved without unjustified downgrades?
- Are false positive dismissals backed by compensating-control evidence?
- Were discovered secrets reported by location only, never by value?
- Did the audit remain strictly read-only? Any source modification is a violation.
- Is every discovery hit individually classified with a reason? Blanket skips are forbidden.
- Are all 3 generalization layers (syntax/semantic/structural) attempted? A single-layer quick grep does NOT satisfy the thoroughness floor.

## Gate Intent

- `recon-complete`: tech stack detected, entry points identified, auth/authz modules listed, data flow mapped. Evidence phase=recon logged. Understanding.md §2 updated. Cannot scan without entry points and data flow baseline.
- `scan-complete`: all tier-required scan phases completed (OWASP + dependencies for quick; + secrets + CI/CD for standard; + STRIDE + git history for deep). Evidence phase=scan logged per phase. Findings merged into severity matrix. Understanding.md §3-§4 updated. Tier-required phase not attempted is BLOCKED (W001/W002 partial from tool failure is a warning).
- `report-produced`: severity matrix with file:line references and remediation for every finding. Summary statistics computed. Understanding.md §5 (full report) written. Session.json `audit_result` populated.
