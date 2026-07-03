---
name: maestro-milestone-release
description: Bump version, generate changelog, tag milestone
argument-hint: "[<version>] [--bump patch|minor|major] [--dry-run] [--no-tag] [--no-push]"
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
Package a completed milestone into a releasable version: version bump → changelog → tag → push.

Pipeline position: downstream of `/maestro-milestone-complete`. Terminal command.
</purpose>

<required_reading>
@~/.maestro/workflows/milestone-release.md
</required_reading>

<context>
$ARGUMENTS -- optional explicit version string and flags.

**Flags:**

| Flag | Effect | Default |
|------|--------|---------|
| `<version>` | Explicit version (e.g. `1.2.0`). If omitted, version is derived from `--bump` or prompted | — |
| `--bump patch\|minor\|major` | Semver bump relative to the current version | `minor` |
| `--dry-run` | Compute the next version, changelog diff, and tag name without writing files or creating tags | `false` |
| `--no-tag` | Skip git tag creation (version bump + changelog only) | `false` |
| `--no-push` | Skip `git push --follow-tags` after tagging | `false` |

**State files:**
- `.workflow/state.json` -- current_milestone, previous release version
- `.workflow/milestones/{milestone}/summary.md` -- milestone summary (from `maestro-milestone-complete`)
- `.workflow/milestones/{milestone}/audit-report.md` -- audit verdict (must be PASS)
- `CHANGELOG.md` -- release notes file (created if missing)
- Version manifest -- `package.json` / `pyproject.toml` / `Cargo.toml` / etc. (auto-detected)

**Preconditions:**
- Current milestone must be completed (audit PASS + `/maestro-milestone-complete` run)
- Working tree must be clean (no uncommitted changes) unless `--dry-run`
</context>

<interview_protocol>
Follows @~/.maestro/workflows/interview-mechanics.md standard.

**Decision points**: version bump type (major / minor / patch / custom), changelog review and confirmation
**Scope guard**: only release decisions; do not prejudge next milestone scope
</interview_protocol>

<execution>
Follow '~/.maestro/workflows/milestone-release.md' completely.

### Phase Gates (MANDATORY, BLOCKING)

**GATE 1: Validation → Version Bump**
- REQUIRED: Current milestone completed (audit PASS + milestone-complete run). E001 if not.
- REQUIRED: Working tree clean (no uncommitted changes). E003 if dirty.

**GATE 2: Version Bump → Changelog**
- REQUIRED: Target version computed and greater than previous (E005 if not).
- REQUIRED: Version manifest file(s) identified and accessible.

**GATE 3: Changelog → Tag/Push**
- REQUIRED: CHANGELOG.md entry written with milestone summary + grouped changes.
- REQUIRED: AskUserQuestion confirmation before creating release commit — show version, changelog diff, and files to be committed. User must confirm or abort.
- REQUIRED: Release commit created with conventional message (after confirmation).

**GATE 4: Tag → Push → Completion**
- REQUIRED: AskUserQuestion confirmation before git tag creation — show tag name and annotation (unless --no-tag). User must confirm or abort.
- REQUIRED: Annotated git tag created (unless --no-tag) (after confirmation).
- REQUIRED: AskUserQuestion confirmation before git push — show remote and refs to push (unless --no-push). User must confirm or abort.
- REQUIRED: state.json updated with last_release_version + last_release_at.

For `--dry-run`: print computed version, changelog diff, and tag name without side effects.
</execution>

<completion>
### Standalone report

```
=== RELEASE COMPLETE ===
Version:   v{previous} → v{new}
Milestone: {milestone_name}
Tag:       v{new} {pushed|local-only}
Changelog: {N} entries written to CHANGELOG.md
Manifest:  {file_path} updated
```

### Ralph-invoked completion

End the step by calling the CLI (no text block output):
```
maestro ralph complete <idx> --status {STATUS} [--evidence {path}]
```

Status verdicts:
- **DONE** — Normal completion
- **DONE_WITH_CONCERNS** — Completed with caveats; pass `--concerns`
- **NEEDS_RETRY** — Tooling error / transient issue; ralph will retry
- **BLOCKED** — External hard blocker; pass `--reason`

### Next-step routing

| Condition | Suggestion |
|-----------|-----------|
| Release successful, starting next milestone | `/maestro-plan {next_milestone}` |
| Want to view project dashboard | `/manage-status` |
</completion>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Current milestone not completed (no milestone-complete run) | Run `/maestro-milestone-complete` first |
| E002 | error | Audit verdict not PASS | Re-run `/maestro-milestone-audit` and resolve findings |
| E003 | error | Working tree not clean (uncommitted changes) | Commit or stash changes, then retry |
| E004 | error | Version manifest not found / unsupported | Add supported manifest or pass `<version>` explicitly with `--no-tag` |
| E005 | error | Target version not greater than current (would break semver monotonicity) | Choose a higher version or run with explicit `<version>` |
| W001 | warning | No changes detected since last release tag | Confirm whether release is still desired |
| W002 | warning | Remote push failed (network / auth) | Retry manually with `git push --follow-tags` |
</error_codes>

<success_criteria>
- [ ] Preconditions validated (milestone complete, audit PASS, clean tree)
- [ ] Target version computed and greater than previous
- [ ] Version manifest(s) updated with new version
- [ ] CHANGELOG.md contains new entry with milestone summary + grouped changes
- [ ] Release commit created with conventional message
- [ ] Annotated git tag created (unless `--no-tag`)
- [ ] Commit + tag pushed to remote (unless `--no-push` or push failed → W002)
- [ ] User confirmed before each destructive git operation (commit, tag, push) via AskUserQuestion
- [ ] state.json updated with last_release_version + last_release_at timestamp (after AskUserQuestion confirmation)
</success_criteria>
