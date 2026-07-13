---
name: security-audit
description: OWASP Top 10 and STRIDE security auditing with supply chain analysis
argument-hint: "[quick|standard|deep] [--scope <path>]"
allowed-tools: spawn_agents_on_csv, Read, Write, Bash, Glob, Grep, request_user_input
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
  gates:
    entry: []
    exit: []
---

<purpose>
Systematic security audit covering OWASP Top 10, dependency supply chain, secrets detection,
CI/CD pipeline review, and optional STRIDE threat modeling. Three tiers control depth vs speed.
</purpose>

<required_reading>
@~/.maestro/workflows/review.md
@~/.maestro/workflows/run-mode.md
</required_reading>

<context>
$ARGUMENTS -- Parse tier and scope:
- Tier: `quick` (default) | `standard` | `deep`
- `--scope <path>`: Limit scan to directory (default: project root)

**Tier coverage:**

| Tier | OWASP | Dependencies | Secrets | CI/CD | STRIDE | Git History |
|------|-------|-------------|---------|-------|--------|-------------|
| quick | Y | Y | -- | -- | -- | -- |
| standard | Y | Y | Y | Y | -- | -- |
| deep | Y | Y | Y | Y | Y | Y |

**Output boundary**: ALL file writes MUST target `{run_dir}/outputs/` or `.workflow/state.json` only. NEVER modify source code, configuration files, or dependencies. Audit is read-only analysis.
</context>

<invariants>
1. **Audit is read-only** — NEVER modify source code, configuration, dependencies, or CI/CD files during audit. Security audit produces reports only.
2. **Findings require file:line evidence** — every finding MUST reference a specific file:line location and include the vulnerable code pattern. No vague or category-only findings.
3. **Severity NEVER downgraded without justification** — if a finding matches a known OWASP category, its severity follows OWASP guidance. Downgrading requires documented rationale (e.g., compensating control exists).
4. **Tier coverage is mandatory** — all scan phases required by the selected tier MUST complete. NEVER skip a tier-required phase silently; failures are logged as W00x warnings.
5. **False positive marking requires evidence** — marking a finding as false positive MUST include the compensating control or code path that prevents exploitation. NEVER dismiss findings without counter-evidence.
6. **Secrets are never logged** — if secrets are discovered, report their location (file:line) and type but NEVER include the actual secret value in the report output.
</invariants>

<execution>

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Recon → Scan**
- REQUIRED: Tech stack detected and entry points identified.
- REQUIRED: Auth/authz modules listed and data flow mapped.
- BLOCKED if missing: cannot scan without entry points and data flow baseline.

**GATE 2: Scan → Report** (tier-gated)
- REQUIRED: OWASP Top 10 scan completed (all tiers).
- REQUIRED: Dependency audit completed (all tiers).
- REQUIRED: Secrets + CI/CD scan completed (standard/deep only).
- REQUIRED: STRIDE + git history completed (deep only).
- BLOCKED if tier-required scans incomplete: finish all tier-applicable phases before reporting.

**GATE 3: Report → Completion**
- REQUIRED: Severity matrix produced with file:line references and remediation.
- REQUIRED: Artifact registered in state.json.
- BLOCKED if missing: do not emit completion status without severity matrix.

**Phase 1: Reconnaissance**

1. Detect tech stack from package.json / go.mod / requirements.txt / Cargo.toml
2. Identify entry points: HTTP handlers, API routes, CLI parsers, WebSocket handlers
3. List authentication/authorization modules
4. Map data flow: user input -> processing -> storage -> output

**Phase 2: OWASP Top 10 Scan** (all tiers)

For each category, scan relevant source files:

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

Use `Grep` for pattern matching (e.g., `eval(`, `exec(`, `innerHTML`, `dangerouslySetInnerHTML`,
`sql.*\+.*req\.`, `process\.env` without validation).

For `standard` and `deep` tiers, use `spawn_agents_on_csv` to parallelize OWASP category scans
across multiple agents, one agent per 2-3 categories. Unless `-y/--yes`, use `request_user_input` to confirm scope and category assignments before spawning.

**Wave state transitions**: After spawn, merge results. 1+ completed → proceed to next phase. All failed + retry available → retry wave once. All failed + retry exhausted → mark phase `degraded`, continue with available results, log `evidence_incomplete`.

**spawn_agents_on_csv contract** (OWASP scan):
- CSV columns: `id, title, owasp_categories, scope_glob, deps, wave, status` (initial `status="pending"`); filter `wave==1 AND status=="pending"` before writing wave-1.csv.
- `output_schema`:

```json
{
  "type": "object",
  "properties": {
    "id":              { "type": "string" },
    "result_status":   { "type": "string", "enum": ["completed", "failed"] },
    "findings":        { "type": "string", "maxLength": 500 },
    "severity_counts": { "type": "string", "description": "JSON: {critical, high, medium, low}" },
    "top_issues":      { "type": "string", "description": "JSON array: [{title, severity, file:line, cwe}]" },
    "error":           { "type": "string" }
  },
  "required": ["id", "result_status", "findings", "severity_counts"]
}
```

- Merge: `result_status` → master `status`; copy `findings`, `severity_counts`, `top_issues`, `error`. Clean results with no issues MUST return `severity_counts: "{\"critical\":0,\"high\":0,\"medium\":0,\"low\":0}"`.
- **Termination contract** (embed in instruction):
  ```
  You MUST call report_agent_job_result EXACTLY ONCE before exiting.
  - Success → result_status=completed (severity_counts may be zero if clean)
  - Failure → result_status=failed with error message
  - Timeout → near max_runtime_seconds → result_status=completed with partial top_issues (do not fail the wave for timeout)
  - NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.
  - Every issue MUST include file:line and CWE reference. No speculation.
  - Read-only. Do NOT modify source.
  Do NOT write to tasks.csv, wave-*.csv, results.csv. Do NOT call spawn_agents_on_csv (no recursion).
  ```

**Phase 3: Dependency Audit** (all tiers)

```bash
# Node.js
npm audit --json 2>/dev/null || true
# Check lockfile integrity
test -f package-lock.json && echo "lockfile present" || echo "WARNING: no lockfile"
```

Check for:
- Known vulnerabilities (CVE references)
- Lockfile presence and integrity
- Typosquatting risk on critical dependencies (manually check suspicious names)

**Phase 4: Secrets Detection** (standard + deep)

```bash
# Current codebase
grep -rn --include="*.ts" --include="*.js" --include="*.json" --include="*.env*" \
  -E "(password|secret|api.?key|token|credential).*=.*['\"][^'\"]{8,}" . || true
```

Check `.env.example` for leaked values. Check `.gitignore` for missing `.env` patterns.

**Phase 5: CI/CD Audit** (standard + deep)

Scan `.github/workflows/*.yml` for:
- Overly permissive `permissions:` (write-all, contents: write)
- Unpinned action versions (`uses: actions/checkout@main` vs `@v4.1.0`)
- Secrets in logs (missing `mask` or `add-mask`)
- Pull request trigger with `pull_request_target` (code injection risk)

**Phase 6: STRIDE Threat Modeling** (deep only)

For each critical module identified in Phase 1:

| Threat | Question |
|--------|----------|
| **S**poofing | Can identity be faked? Is auth per-request? |
| **T**ampering | Can data be modified in transit/storage? Integrity checks? |
| **R**epudiation | Are actions logged with user identity? |
| **I**nformation Disclosure | Can unauthorized data be accessed? |
| **D**enial of Service | Resource limits? Rate limiting? |
| **E**levation of Privilege | Can roles be escalated? Input validation on role fields? |

For `deep` tier, use `spawn_agents_on_csv` to parallelize STRIDE analysis across critical modules,
one agent per module. Use `request_user_input` to confirm critical module list before spawning.

**STRIDE spawn contract**:
- CSV columns: `id, module_path, threats_to_assess, deps, wave, status` (initial `status="pending"`); filter `wave==2 AND status=="pending"`.
- `output_schema`:

```json
{
  "type": "object",
  "properties": {
    "id":              { "type": "string" },
    "result_status":   { "type": "string", "enum": ["completed", "failed"] },
    "findings":        { "type": "string", "maxLength": 500 },
    "severity_counts": { "type": "string", "description": "JSON: {critical, high, medium, low}" },
    "top_issues":      { "type": "string", "description": "JSON array: [{stride_category, threat, severity, file:line, mitigation}]" },
    "error":           { "type": "string" }
  },
  "required": ["id", "result_status", "findings"]
}
```

- Same termination contract as the OWASP spawn above (mandatory `report_agent_job_result`, read-only, no recursion, timeout → partial findings, etc.).
- Merge: `result_status` → master `status`; copy `findings`, `severity_counts`, `top_issues`, `error`.

**Phase 7: Git History Archaeology** (deep only)

```bash
# Search for previously committed secrets
git log --all --diff-filter=D --name-only --pretty=format: -- "*.env" "*.key" "*.pem" 2>/dev/null | head -20
git log -p --all -S "password" --since="1 year ago" -- "*.ts" "*.js" 2>/dev/null | head -50
```

**Phase 8: Report**

Output severity matrix:

```
=== Security Audit ({tier}) ===

CRITICAL ({count}):
  - [A03] SQL injection in {file}:{line} -- {description}
    Fix: {remediation}

HIGH ({count}):
  ...

MEDIUM ({count}):
  ...

LOW ({count}):
  ...

Summary: {total} findings ({critical} critical, {high} high, {medium} medium, {low} low)
```

Emit completion status:
```
--- COMPLETION STATUS ---
STATUS: DONE|DONE_WITH_CONCERNS
CONCERNS: {count} critical findings require immediate action
NEXT: $quality-review
--- END STATUS ---
```

**Register artifact on completion** (gated: unless `-y`, use `request_user_input` to confirm artifact registration and report writing before proceeding):
```
Append to Session ArtifactRegistry (runtime-owned):
{
  id: nextArtifactId(artifacts, "review"),  // RVW-NNN (security-audit reuses review type)
  type: "review",
  subtype: "security-audit",
  milestone: current_milestone || null,
  phase: target_phase || null,
  scope: target_phase ? "phase" : "standalone",
  path: "scratch/{YYYYMMDD}-security-audit-{tier}-{slug}",
  status: critical_count == 0 ? "completed" : "completed_with_concerns",
  tier: tier,                              // quick|standard|deep
  harvested: false,
  created_at: start_time,
  completed_at: now()
}
```
Write findings report to the same `path` (severity matrix, file:line refs, remediation).
</execution>

<success_criteria>
- [ ] Tech stack identified and entry points mapped
- [ ] OWASP Top 10 categories all checked (tier-appropriate)
- [ ] Dependency audit completed with CVE listing
- [ ] Severity matrix produced with file:line references
- [ ] Each finding includes remediation suggestion
- [ ] Completion status block emitted
</success_criteria>
