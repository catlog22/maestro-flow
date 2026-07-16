---
name: security-audit
description: OWASP Top 10 and STRIDE security auditing with supply chain analysis
argument-hint: "[quick|standard|deep] [--scope <path>]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

<purpose>
Systematic security audit covering OWASP Top 10, dependency supply chain, secrets detection,
CI/CD pipeline review, and optional STRIDE threat modeling. Three tiers control depth vs speed.
</purpose>

<context>
$ARGUMENTS — Parse tier and scope:
- Tier: `quick` (default) | `standard` | `deep`
- `--scope <path>`: Limit scan to directory (default: project root)

**Tier coverage:**

| Tier | OWASP | Dependencies | Secrets | CI/CD | STRIDE | Git History |
|------|-------|-------------|---------|-------|--------|-------------|
| quick | ✓ | ✓ | — | — | — | — |
| standard | ✓ | ✓ | ✓ | ✓ | — | — |
| deep | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

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
4. Map data flow: user input → processing → storage → output

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

```
Grep({
  pattern: "(password|secret|api.?key|token|credential).*=.*['\"][^'\"]{8,}",
  glob: "*.{ts,js,json,env*}",
  output_mode: "content"
})
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
  - [A03] SQL injection in {file}:{line} — {description}
    Fix: {remediation}

HIGH ({count}):
  ...

MEDIUM ({count}):
  ...

LOW ({count}):
  ...

Summary: {total} findings ({critical} critical, {high} high, {medium} medium, {low} low)
```

**Register artifact on completion:**

Write the declared security findings under `{run_dir}/outputs/` and the human summary to `{run_dir}/report.md`. `maestro run complete` performs registration automatically; the model never edits an artifact registry.
</execution>

<completion>
### Standalone report

```
--- COMPLETION STATUS ---
STATUS: DONE|DONE_WITH_CONCERNS
CONCERNS: {count} critical findings require immediate action
--- END STATUS ---
```

Status mapping:
- **done** — No critical/high findings
- **done-with-concerns** — Critical/high findings documented with remediation

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro run complete --session {session_id} --verdict {VERDICT} [--evidence {path}]
```
(run-id 可省略 — 自动解析当前 running 步)

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| No critical findings | `maestro run create review --session YYYYMMDD-review-{topic} --intent "{goal}" -- {phase}` |
| Critical findings need fix | `maestro run create plan --session YYYYMMDD-plan-{topic} --intent "{goal}" -- {phase} --gaps` |
| Need deeper analysis | `/security-audit deep --scope {path}` |
| Want dependency remediation | Fix vulnerabilities, then re-run `/security-audit` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | No source files found in scope | Verify --scope path exists |
| E002 | error | Tech stack not detected | Manually specify entry points |
| W001 | warning | npm audit / dependency tool unavailable | Skip dependency phase, note limitation |
| W002 | warning | Git history scan failed | Skip Phase 7, note limitation |
| W003 | warning | Partial scan (some files inaccessible) | Report coverage gap in findings |
</error_codes>

<success_criteria>
- [ ] Tech stack identified and entry points mapped
- [ ] OWASP Top 10 categories all checked (tier-appropriate)
- [ ] Dependency audit completed with CVE listing
- [ ] Severity matrix produced with file:line references
- [ ] Each finding includes remediation suggestion
- [ ] Completion status block emitted
</success_criteria>
