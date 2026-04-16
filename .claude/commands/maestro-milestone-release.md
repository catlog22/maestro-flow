---
name: maestro-milestone-release
description: Version bump, changelog generation, and git tag for a completed milestone
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
Package a completed milestone into a releasable version. Bumps the project version (e.g. `package.json`, `pyproject.toml`, or language-specific manifest), generates or appends a changelog entry from phase/milestone summaries and git log, creates an annotated git tag, and optionally pushes to the remote. Runs after Skill({ skill: "maestro-milestone-complete" }) has archived the milestone; serves as the final delivery step in the SDLC loop.
</purpose>

<required_reading>
@~/.maestro/workflows/milestone-release.md
</required_reading>

<context>
$ARGUMENTS -- optional explicit version string and flags.

**Flags:**
- `<version>` -- explicit version (e.g. `1.2.0`). If omitted, version is derived from `--bump` or prompted.
- `--bump patch|minor|major` -- semver bump relative to the current version (default: `minor`)
- `--dry-run` -- compute the next version, changelog diff, and tag name without writing files or creating tags
- `--no-tag` -- skip git tag creation (version bump + changelog only)
- `--no-push` -- skip `git push --follow-tags` after tagging

**State files:**
- `.workflow/state.json` -- current_milestone, previous release version
- `.workflow/milestones/{milestone}/summary.md` -- milestone summary (from `maestro-milestone-complete`)
- `.workflow/milestones/{milestone}/audit-report.md` -- audit verdict (must be PASS)
- `CHANGELOG.md` -- release notes file (created if missing)
- Version manifest -- `package.json` / `pyproject.toml` / `Cargo.toml` / etc. (auto-detected)

**Preconditions:**
- Current milestone must be completed (audit PASS + Skill({ skill: "maestro-milestone-complete" }) run)
- Working tree must be clean (no uncommitted changes) unless `--dry-run`
</context>

<execution>
Follow '~/.maestro/workflows/release.md' completely.

**High-level flow:**
1. Validate preconditions (milestone completed, clean tree, audit PASS)
2. Resolve target version from `<version>` or `--bump` against current manifest
3. Collect changes since last release tag: milestone summary + phase summaries + git log between tags
4. Generate `CHANGELOG.md` entry (grouped by phase / change type)
5. Write version to manifest file(s) + commit with message `chore(release): v{version}`
6. Create annotated git tag `v{version}` with release notes body (unless `--no-tag`)
7. Push commit + tag to remote (unless `--no-push`)

**Report format on completion:**
```
=== RELEASE COMPLETE ===
Version:   v{previous} → v{new}
Milestone: {milestone_name}
Tag:       v{new} {pushed|local-only}
Changelog: {N} entries written to CHANGELOG.md
Manifest:  {file_path} updated

Next steps:
  Skill({ skill: "maestro-plan", args: "{next_phase}" })  -- Start next milestone's first phase
  Skill({ skill: "manage-status" })                        -- View project dashboard
```

For `--dry-run`, print the computed version, changelog diff, and tag name without side effects.
</execution>

<error_codes>
| Code | Severity | Condition | Recovery |
|------|----------|-----------|----------|
| E001 | error | Current milestone not completed (no milestone-complete run) | Run Skill({ skill: "maestro-milestone-complete" }) first |
| E002 | error | Audit verdict not PASS | Re-run Skill({ skill: "maestro-milestone-audit" }) and resolve findings |
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
- [ ] state.json updated with last_release_version + last_release_at timestamp
</success_criteria>
