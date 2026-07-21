---
name: odyssey-security
prepare: odyssey-security
session-mode: inherited
---

# Workflow: Odyssey Security

Read-only tiered security audit — OWASP Top 10 / dependency supply chain / secrets / CI/CD / STRIDE / git history → severity matrix report → generalize security patterns.

---

## State Chain

```
S_INTAKE → S_RECON → S_SCAN → S_REPORT → [back-half]
```

Back-half: `S_GENERALIZE → S_DISCOVER → S_RECORD → END` (see odyssey-base.md §Shared Back-Half).

**No S_FIX / S_CONFIRM** — this mode is read-only. Findings route to `--mode improve` or `--mode debug` for remediation.

---

## Boundary

**In scope:** Read-only security audit — OWASP Top 10, dependency supply chain, secrets detection, CI/CD pipeline, STRIDE threat modeling, git history archaeology → severity matrix report → generalize security patterns.
**Out of scope:** Fixing vulnerabilities → `--mode improve` | Root cause debug → `--mode debug` | Feature implementation → `--mode planex` | UI → `--mode ui`. Read-only invariant applies: NEVER modify source code.

---

## Context

### Target Resolution

| Input | Resolution |
|-------|-----------|
| Module/dir path | Audit that module |
| `--scope <path>` | Limit scan to directory |
| Project root (default) | Full project scan |
| `HEAD` / `staged` | Review changes in diff |

### Tier Coverage

| Tier | OWASP | Dependencies | Secrets | CI/CD | STRIDE | Git History |
|------|-------|-------------|---------|-------|--------|-------------|
| quick | ✓ | ✓ | — | — | — | — |
| standard | ✓ | ✓ | ✓ | ✓ | — | — |
| deep | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

### Session Fields

```json
{ "target": "", "tier": "standard", "scan_phases": [],
  "audit_result": {}, "findings_count": {},
  "generalization_stats": null }
```

### evidence.ndjson Phases

`recon|scan|report|discovery|decision|self-iteration`

- `recon`: `category` (tech_stack|entry_point|auth_module|data_flow), `detail`
- `scan`: `phase` (owasp|dependency|secrets|cicd|stride|git_history), `severity`, `cwe`
- `report`: `finding_ref`, `remediation`

### phase_goals[]

| ID | Goal | Phase | skip_when |
|----|------|-------|-----------|
| G1 | Recon completed | S_RECON | — |
| G2 | Scan completed (all tier phases) | S_SCAN | — |
| G3 | Report produced | S_REPORT | — |
| G4 | Pattern generalized | S_GENERALIZE | skip_generalize |
| G5 | Discoveries triaged | S_DISCOVER | skip_generalize |
| G6 | Learnings persisted | S_RECORD | — |

### understanding.md — 7 Sections

1. Target & Tier
2. Reconnaissance
3. Scan Findings (by phase)
4. Severity Matrix
5. Full Report (findings + remediation)
6. Generalization
7. Discoveries & Learnings

---

## State Machine

### Transitions

```
S_RECON  → S_SCAN        : complete
S_SCAN   → S_REPORT      : all tier phases complete
S_REPORT → S_GENERALIZE  : report produced, !skip_generalize
S_REPORT → S_RECORD      : report produced, skip_generalize
```

Discover routes: new security concern in sibling module → S_SCAN (re-scan with expanded scope, loops < max_loops).

---

## Actions

**A_INTAKE extra** — Tier resolution: parse `--tier` flag (default: standard). Record tier + applicable scan phases to `session.json.scan_phases`.

**A_RECON** — (1) Detect tech stack from package.json / go.mod / requirements.txt / Cargo.toml. (2) Identify entry points: HTTP handlers, API routes, CLI parsers, WebSocket handlers. (3) List authentication/authorization modules. (4) Map data flow: user input → processing → storage → output. (5) Evidence phase=recon. Update §2. Mark G1.

**GATE: recon-complete** — tech stack detected, entry points identified, auth/authz modules listed, data flow mapped. Evidence phase=recon logged. §2 updated. BLOCKED if no entry points found (E002).

Commit: `"odyssey-security({slug}): RECON — reconnaissance complete"`

**A_SCAN** — Tier-gated parallel scan phases:

- **OWASP Top 10** (all tiers): Spawn parallel agents per category (A01-A10). Each scans relevant source files using Grep pattern matching (`eval(`, `exec(`, `innerHTML`, `dangerouslySetInnerHTML`, `sql.*\+.*req\.`, `process\.env` without validation). Returns `[{title, severity, category, file, line, description, cwe, remediation}]`.

| # | Category | What to check |
|---|----------|--------------|
| A01 | Broken Access Control | Missing auth middleware, direct object references, path traversal |
| A02 | Cryptographic Failures | Weak algorithms, hardcoded keys, missing TLS, plaintext storage |
| A03 | Injection | SQL concatenation, shell exec with user input, template injection |
| A04 | Insecure Design | Missing rate limits, no CSRF tokens, predictable tokens |
| A05 | Security Misconfiguration | Debug mode, default credentials, verbose errors, open CORS |
| A06 | Vulnerable Components | Known CVEs in dependencies |
| A07 | Auth Failures | Weak password rules, missing brute-force protection, session fixation |
| A08 | Data Integrity | Deserialization of untrusted data, unsigned updates |
| A09 | Logging Failures | Missing audit logs, logging sensitive data |
| A10 | SSRF | Unvalidated URLs in server-side requests |

- **Dependency Audit** (all tiers): `npm audit --json` / lockfile integrity / typosquatting risk on critical dependencies.
- **Secrets Detection** (standard + deep): Grep for `(password|secret|api.?key|token|credential).*=.*['"][^'"]{8,}` in `*.{ts,js,json,env*}`. Check `.env.example` for leaked values. Check `.gitignore` for missing `.env` patterns. **NEVER log actual secret values.**
- **CI/CD Audit** (standard + deep): Scan `.github/workflows/*.yml` for overly permissive permissions, unpinned action versions, secrets in logs, `pull_request_target` injection risk.
- **STRIDE Threat Modeling** (deep only): For each critical module from recon:

| Threat | Question |
|--------|----------|
| **S**poofing | Can identity be faked? Is auth per-request? |
| **T**ampering | Can data be modified in transit/storage? Integrity checks? |
| **R**epudiation | Are actions logged with user identity? |
| **I**nformation Disclosure | Can unauthorized data be accessed? |
| **D**enial of Service | Resource limits? Rate limiting? |
| **E**levation of Privilege | Can roles be escalated? Input validation on role fields? |

- **Git History Archaeology** (deep only): Search for previously committed secrets (`git log --all --diff-filter=D -- "*.env" "*.key" "*.pem"`), password strings in history.

Merge all findings → evidence phase=scan. Write `session.json.audit_result`. Update §3 (findings by phase) + §4 (severity matrix). Mark G2.

**GATE: scan-complete** — all tier-required scan phases completed with structured findings, merged into severity matrix, evidence phase=scan logged per phase. Tier-required phase not attempted is BLOCKED (W001 tool unavailable / W002 git history failure are warnings, not blocks).

Commit: `"odyssey-security({slug}): SCAN — {tier} tier scan complete"`

**A_REPORT** — (1) Produce severity matrix: CRITICAL / HIGH / MEDIUM / LOW with file:line references and remediation for each finding. (2) Compute summary statistics. (3) Write understanding.md §5 (full report). (4) Write `session.json.findings_count`. (5) Evidence phase=report. Mark G3.

**GATE: report-produced** — severity matrix with file:line references and remediation for every finding; summary statistics computed; §5 written; `audit_result` populated.

Commit: `"odyssey-security({slug}): REPORT — severity matrix produced"`

---

## Generalize Source

Security findings with severity >= medium + vulnerability patterns across scan phases.

**Discover routing:** sibling module with same vulnerability class → S_SCAN (re-scan expanded scope); new critical finding → evidence phase=decision, recommend `--mode improve`.

---

## Knowledge Persistence (§7)

| Category | Content | Follow-up |
|----------|---------|-----------|
| Vulnerability pattern | CWE + trigger + detection pattern + remediation | `/maestro-spec add debug` |
| Security constraint | Trust boundary + validation rule + enforcement | `/maestro-spec add arch` |
| Dependency risk | Package + CVE + safe version + migration path | `/maestro-spec add coding` |
| CI/CD hardening | Misconfiguration + fix + prevention check | `/maestro-spec add coding` |

---

## Completion Summary

```
--- SECURITY ODYSSEY COMPLETE ---
Target:      {target}
Tier:        {tier}
Phases:      {completed}/{total} ({skipped} skipped)
Findings:    {critical}C / {high}H / {medium}M / {low}L
Categories:  {owasp_hits} OWASP / {dep_vulns} dependency / {secrets} secrets
Patterns:    {count} ({by_layer})
Scan hits:   {total} ({cross_layer_confirmed} confirmed)
Issues:      {N} created
Decisions:   {N} resolved, {M} pending, {K} deferred
Learnings:   {N} persisted
Self-iter:   {N} rounds across {M} stages
Cross-loops: {N}
Goals:       {done}/{total} ({skipped} skipped)
---
```

---

## Mode `-y` Points

| Decision Point | Normal | `-y` |
|---------------|--------|------|
| A_SCAN false positive dismissal | [@ask] AskUserQuestion | auto-dismiss with evidence `deferred` |
| A_REPORT severity downgrade | [@ask] AskUserQuestion | auto with documented rationale |
| A_DISCOVER routing | [@ask] AskUserQuestion | auto create issue |
| Ambiguous items | [@ask] AskUserQuestion | all `deferred` |

---

## Phase Gates

- **Recon gate** (S_RECON): tech stack + entry points + auth modules + data flow mapped. Evidence logged, understanding.md §2 updated.
- **Scan gate** (S_SCAN): all tier-required phases completed. Per-phase evidence logged. Findings merged with severity classification. Tier-required phase missing is BLOCKED (W001/W002 partial allowed).
- **Report gate** (S_REPORT): severity matrix produced with file:line + remediation. Summary statistics. §5 written. Read-only invariant verified (no source modifications in session).

---

## Error Codes

| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No target / scope provided | Provide target or -c |
| E002 | error | No source files found in scope / no entry points | Verify --scope path exists |
| W001 | warning | Dependency audit tool unavailable (npm audit etc.) | Skip dependency phase, note limitation |
| W002 | warning | Git history scan failed | Skip git history phase, note limitation |
| W003 | warning | Partial scan (some files inaccessible) | Report coverage gap in findings |
| W004 | warning | Generalization 0 hits after full 3-layer scan | Advance to S_RECORD |
| W005 | warning | Pending decisions | Filter evidence phase=decision |

---

## Success Criteria

- [ ] Target resolved; tier determined; session + output files created
- [ ] Recon completed: tech stack, entry points, auth modules, data flow mapped
- [ ] All tier-required scan phases completed (OWASP, dependencies, secrets, CI/CD, STRIDE, git history per tier)
- [ ] understanding.md sections written progressively (§1–§7)
- [ ] Severity matrix produced with file:line references and remediation for every finding
- [ ] Read-only invariant maintained — zero source code modifications
- [ ] Multi-layer generalization + discovery triage (unless --skip-generalize)
- [ ] phase_goals derived, tracked, and hardened-audited; Goal Prompt once
- [ ] Session resumable via -c; completion summary emitted

---

## Next Step Routing

| Condition | Next |
|-----------|------|
| Critical findings need fix | `/maestro-odyssey <finding> --mode improve` |
| Deeper debug needed | `/maestro-odyssey <finding> --mode debug` |
| Discovery issues created | `/maestro-manage issue list --source security-odyssey` |
| Need deeper audit tier | `/maestro-odyssey <target> --mode security --tier deep` |
| Document pattern | `/maestro-learn decompose <module>` |
| Second opinion | `/maestro-learn consult <understanding.md>` |
| Security pattern to persist | `/maestro-spec add debug "..."` |
| Pending decisions | Filter evidence phase=decision status=pending |
