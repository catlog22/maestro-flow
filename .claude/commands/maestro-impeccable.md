---
name: maestro-impeccable
disable-model-invocation: true
description: Use when designing, reviewing, refining, fixing, or codifying frontend UI through the installed Impeccable skill
argument-hint: "[command] [target] | hooks <action> | doctor | pin|unpin <command> | --codify <path>"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - Skill
  - AskUserQuestion
  - TodoWrite
session-mode: run
contract:
  discovery: self-described
  consumes: []
  produces: []
---

<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>

If required reading was not expanded by the host, or is no longer in context, Read it explicitly before execution.

<deferred_reading>
Maestro Codify extension only — do not read these files for normal Impeccable work:
- [ui-codify.md](~/.maestro/workflows/ui-codify.md) — load when `--codify` starts
- [ui-codify-extract.md](~/.maestro/workflows/ui-codify-extract.md) — load only when extraction starts
- [ui-codify-package.md](~/.maestro/workflows/ui-codify-package.md) — load only when packaging starts
- [ui-codify-knowhow.md](~/.maestro/workflows/ui-codify-knowhow.md) — load only after the knowhow confirmation gate passes
</deferred_reading>

<purpose>
Maestro adapter for the current installed `impeccable` skill. Impeccable owns design semantics, setup, routing, references, detector behavior, and bounded verification. Maestro adds the canonical Session/Run lifecycle, progress tracking, consistent status presentation, and the optional `--codify` extension.
</purpose>

<upstream_contract>
The installed Impeccable skill is the canonical template. First resolve and invoke it through the `Skill` tool with name `impeccable`; its loaded base directory owns `SKILL.md`, `reference/`, and `scripts/`.

If Skill resolution is unavailable, try these fallbacks in order and Read the first existing `SKILL.md`; its parent directory becomes the skill base directory:
1. Project-local `.claude/skills/impeccable/SKILL.md`
2. User-level `~/.claude/skills/impeccable/SKILL.md`

Rules:
1. Never use the retired copied templates under `~/.maestro/workflows/impeccable/{command}.md` for normal execution.
2. Never copy `skill/SKILL.src.md` directly: it is a build source with unresolved provider placeholders.
3. Load the installed `SKILL.md`, then only the single command/reference file it routes to. Respect its deferred-reading rules.
4. Run the skill's context setup once per session from the loaded skill base directory. Do not rerun it after `init`.
5. Preserve upstream platform routing: `audit.native.md` / `adapt.native.md` for native projects; `live` and the HTML detector are web-only.
6. Preserve upstream bounded verification: one batched inspection/fix pass and at most one confirmation pass. Do not recreate the retired open-ended refine loop.
7. Only when Skill resolution and both fallback paths fail, stop with E001. Recommend `npx impeccable install` (or Maestro's Impeccable add-on installer). Do not silently install or vendor it.
8. If the user explicitly asks to update the installed skill, use `npx impeccable update`; do not update it as a side effect of design work.

Baseline checked against upstream Impeccable Skill 4.1.2. The installed skill remains authoritative when newer.
</upstream_contract>

## Maestro Symbol Style

Use these symbols consistently in Maestro-owned displays. Do not substitute colorful success/failure emoji.

| Meaning | Display |
|---|---|
| Current step / transition | `→` |
| Completed prerequisite or step | `✓` |
| Quality or confirmation gate | `◆` |
| Bounded re-check | `↺` |
| Warning / degraded mode | `⚠` |
| Failure | `FAIL` |
| Terminal success | `Status: DONE` |
| Terminal failure | `Status: FAILED` |

Upstream machine values and required report fields remain unchanged. For an upstream degraded critique banner, normalize only the symbol presentation to `⚠ DEGRADED: single-context (<reason>)`; do not weaken or omit the degraded disclosure.

## Input Routing

Parse `$ARGUMENTS` without inventing a static workflow chain.

Apply this table top-to-bottom; specific routes override the generic command route.

| Input | Route |
|---|---|
| `--codify <source-path> ...` / `codify <source-path> ...` | Maestro Codify extension |
| `hooks <action>` | Invoke Impeccable hooks control; load `reference/hooks.md` |
| `doctor` | Invoke Impeccable doctor; load `reference/doctor.md` |
| `pin <command>` / `unpin <command>` | Invoke the installed skill's pin script |
| `teach ...` | Compatibility alias for `init`; no deprecation warning |
| `craft ...` | Deprecated upstream alias for ordinary new-work; display W001 once |
| Legacy Maestro preset (`build`, `redesign`, `improve`, `enhance`, `launch`, `foundation`) | Treat the full text as a general design request and let current upstream routing resolve it; display W002 once; never reconstruct the retired chain |
| One of the remaining commands below | Invoke Impeccable with the arguments unchanged |
| No arguments | Invoke current `reference/routing.md`; show 2–3 context-aware recommendations, then the full menu; never auto-run |
| Other UI design text | Pass as general Impeccable work; follow current upstream routing |

`continue`, `next`, and `-c` are not Impeccable resume commands. Run/session continuation belongs to the canonical Maestro Session/Run lifecycle in `run-mode.md`.

## Current Impeccable Commands

This table is a routing index only. The installed Skill and its references own the full instructions.

| Command | Category | Current meaning |
|---|---|---|
| `craft [feature]` | Build | Deprecated alias for ordinary new-work |
| `shape [feature]` | Build | Plan UX/UI before writing code |
| `init` | Build | Capture durable product context in PRODUCT.md |
| `document` | Build | Generate DESIGN.md from existing project code |
| `extract [target]` | Build | Pull reusable tokens and components into a design system |
| `critique [target]` | Evaluate | UX design review with applicable heuristic scoring |
| `audit [target]` | Evaluate | Technical a11y, performance, and responsive checks |
| `polish [target]` | Refine | Final bounded quality pass before shipping |
| `bolder [target]` | Refine | Amplify a safe or bland design |
| `quieter [target]` | Refine | Reduce aggressive or overstimulating design |
| `distill [target]` | Refine | Remove complexity and strip to essence |
| `harden [target]` | Refine | Cover errors, i18n, edge cases, and production states |
| `onboard [target]` | Refine | Improve first-run, empty-state, and activation flows |
| `animate [target]` | Enhance | Add purposeful motion |
| `colorize [target]` | Enhance | Add strategic color |
| `typeset [target]` | Enhance | Improve typography hierarchy and fonts |
| `layout [target]` | Enhance | Fix spacing, rhythm, alignment, and hierarchy |
| `delight [target]` | Enhance | Add personality and memorable details |
| `overdrive [target]` | Enhance | Push past conventional visual limits |
| `clarify [target]` | Fix | Improve UX copy, labels, and error messages |
| `adapt [target]` | Fix | Adapt across devices and screen sizes |
| `optimize [target]` | Fix | Diagnose and fix UI performance |
| `live` | Iterate | Web-only browser variant mode |

## Normal Execution

1. **Attach the canonical Run**
   - Follow `run-mode.md` before design work. If a birth packet says `run_already_created: true`, consume its exact locator, task, continuation, `run_dir`, and revisions; never create a duplicate Run.
   - For a self-started invocation, negotiate capabilities and execute the receipt-chained Session open → chain insert → run next flow from `run-mode.md`.
   - Retain whether this executor has mutation authority. An executor without it may write outputs/report and run read-only checks, but must return completion to the coordinator instead of advancing the Run itself.

2. **Resolve template**
   - Invoke Skill `impeccable`; if unavailable, Read the first available fallback defined in `<upstream_contract>` and retain its base directory.
   - Emit E001 only if all three resolution paths fail.

3. **Run upstream setup**
   - Follow the loaded Skill's Setup exactly.
   - Inspect the target and at least one representative source of incumbent visual truth before editing.
   - A missing PRODUCT.md blocks only new-surface or replacement-world work as upstream specifies; it does not block narrow refinement.
   - Report `CONTEXT_STALE`; never repair drift unless requested or marked `auto` by upstream.

4. **Resolve route**
   - Explicit or clearly implied command → load its one owning reference.
   - Two plausible commands → [@ask] AskUserQuestion once.
   - New surface or replacement visual world → current `reference/new-work.md`.
   - No arguments → current `reference/routing.md`; recommendations require confirmation.

5. **Display Maestro execution panel**

   ```text
   ── Impeccable: {command|general} ──────────────
   Target: {target|project context}
   Mode: {Persuade|Operate|Read|Experience}
   Platform: {web|ios|android|adaptive|unknown}
   Reference: {relative reference path}
   ──────────────────────────────────────────────
   → Setup
   ```

   If platform is `unknown`, do not default to web. Resolve platform from project evidence or run `init` before platform-sensitive routing; never run `live` or the HTML detector on an unconfirmed native target.

6. **Track major phases**
   - Create TodoWrite items from the loaded reference's major phases; do not invent a generic chain.
   - Format: `[impeccable:{command}] {phase}`.
   - Mark each phase complete immediately when its verifiable outcome is complete.
   - User-facing progress:

     ```text
     → [impeccable:{command}] {phase}
     ✓ [impeccable:{command}] {phase}
     ⚠ [impeccable:{command}] {phase} — W###: {reason}
     FAIL [impeccable:{command}] {phase} — E###: {reason}
     ```

7. **Execute upstream reference**
   - Follow all current MUST rules, platform variants, output schemas, provenance, and safety boundaries.
   - Load `reference/craft-floor.md` immediately before UI edits, never for planning-only work.
   - For critique, preserve dual independent assessment and explicit degraded disclosure. Persist snapshots and report trends only when upstream resolves a non-null slug; otherwise follow its documented skip path.
   - Never assume critique is scored out of 40: excluded heuristics are `n/a`, and the applicable maximum may vary.

8. **Bounded verification**
   - Show a gate only when the loaded reference defines one:

     ```text
     ◆ {gate}: {actual evidence} — PASS|FAIL
     ↺ confirmation pass 1/1
     ```

   - Do not fabricate a numeric threshold or score.
   - Do not report PASS without actual evidence from the executed check.

9. **Finish the Run**
   - Write the human-readable synthesis to `{run_dir}/report.md` using the exact frontmatter vocabulary and whitelist from `run-mode.md`; put every caveat in `concerns`.
   - Run `maestro run check {run_id} --session {session_id} --json` and repair blocking gates.
   - With mutation authority, complete using the exact fenced `maestro run complete ... --verdict done|done_with_concerns --advance --json` continuation from `run-mode.md`; parse and retain the returned revisions. Without mutation authority, return the report and check result to the coordinator and do not complete or advance.
   - Follow the completion receipt: dispatch a remaining pending step only when authorized, or complete the Session when the chain is terminal. Never treat the display status below as a substitute for Run completion.

   ```text
   === IMPECCABLE RESULT ===
   Command: {command|general}
   Target: {target}
   Evidence: {checks, snapshots, detector output, or files}
   Warnings: {none|<warning-code> ...}
   --- STATUS ---
   Status: DONE | FAILED
   ```

   Suggest only the next step supported by the loaded upstream reference or current findings.

## Maestro Codify Extension

<codify_mode>
Codify remains a Maestro-owned extension; it is not an upstream Impeccable command. Load `ui-codify.md` for its phase algorithm; the normal Impeccable Skill/reference route does not apply inside this mode. The Run-governance rules in this section override stale persistence wording or incomplete command examples in the referenced Codify workflows.

Arguments:
`--codify <source-path> [--package-name <name>] [--output-dir <path>] [--overwrite]`

Boundaries:
1. Discovered source inputs are strictly read-only. Canonicalize and snapshot the source file list before creating workspaces; exclude `--output-dir`, `.workflow/codify-temp-*`, `{run_dir}`, and other generated directories from discovery, even when they are nested beneath `source_path`. Never edit a discovered source file.
2. User-facing package writes stay under `--output-dir` (default `.workflow/reference_style/`). Maestro runtime writes may also use the exact `{run_dir}/report.md`, `{run_dir}/outputs|evidence|work`, and the phase-scoped `.workflow/codify-temp-*` directory required by the referenced workflows.
3. Governed knowledge/spec corpus files are never written directly. Phase 4 may create the manifest and stage candidates with explicit `--run {run_id}`; review/promotion occurs after sealing under `run-mode.md`.
4. Load each deferred workflow only when its phase starts.
5. Never overwrite an existing package without `--overwrite`. With `--overwrite`, clear the validated target package before generation or build in a fresh temporary package and replace it; artifact checks must prove current-Run provenance and must not pass on stale files.
6. Phase 2 runs Style, Animation, and Layout extraction in parallel as `ui-codify.md` specifies; do not invent a token-first dependency.
7. Ask the user before knowhow candidate generation.
8. Verify the requested artifact scope and candidate stage receipts before terminal status.
9. Always clean the phase temporary directory on success, failure, or preview-only exit.

Display:

```text
── Impeccable: codify ─────────────────────
Source: {source-path}
Output: {output-dir}
───────────────────────────────────────────
→ Phase 1: Validate + workspace setup
◆ GATE 1: source and output policy valid
→ Phase 2: Parallel extraction (Style + Animation + Layout)
◆ GATE 2: extraction artifacts satisfy ui-codify.md
→ Phase 3: Reference package
◆ GATE 3: current-Run preview and required token/layout artifacts exist
→ Phase 4: Manifest + governed candidate staging (confirmation required)
◆ GATE 4: knowhow-manifest.json + stage receipts recorded
```

At the Phase 3 → 4 gate, [@ask] AskUserQuestion:
- `继续生成 knowhow` — generate the manifest and stage governed candidates with `--run {run_id}`; promotion remains post-seal
- `仅保留 preview，跳过 knowhow` — clean the temporary directory, verify preview-only artifacts, and finish with an explicit preview-only scope report

Codify diagnostics originate in the referenced workflows. Translate them for Maestro-owned output so they do not collide with normal-mode codes:
- workflow E001 → C001 (source argument missing)
- workflow E002 → C002 (source missing/not a directory)
- workflow E003 → C003 (package exists without `--overwrite`)
- workflow W001 → CW001 (optional animation tokens missing; continue without animation tokens)

Follow the referenced workflows for all other phase instructions and recovery. For every Phase 4 stage command, this adapter additionally requires explicit `--run {run_id}`, a defined valid `--category` (never `undefined`), and a captured candidate receipt. Stage only; never write or promote governed corpus files during the active Run.
</codify_mode>

<error_codes>
| Code | Severity | Condition | Recovery |
|---|---|---|---|
| E001 | error | Skill resolution and both installed-template fallbacks failed | Run `npx impeccable install` or install the Maestro Impeccable add-on |
| E002 | error | Explicit normal-mode target/path does not exist | Correct the target and retry |
| E003 | error | Required upstream reference/script is missing | Run `npx impeccable update`, then retry |
| C001 | error | Codify source argument is missing | Provide `--codify <source-path>` |
| C002 | error | Codify source is missing or not a directory | Correct the source path |
| C003 | error | Codify package exists without `--overwrite` | Use a new package/output path or explicitly pass `--overwrite` |
| CW001 | warning | Optional Codify animation tokens are missing | Continue without animation tokens and report reduced motion coverage |
| W001 | warning | Deprecated `craft` alias used | Route as ordinary new-work and suggest a general request next time |
| W002 | warning | Retired Maestro chain preset used | Route the full request through current upstream semantics; do not recreate the old chain |
| W003 | warning | Upstream execution is degraded | Preserve the required degraded disclosure and evidence limitations |
</error_codes>

<success_criteria>
Normal mode:
- [ ] Canonical Run attached/created exactly once; exact locator and revisions retained
- [ ] Installed Impeccable Skill or an explicit fallback resolved; retired copied Maestro workflows were not used
- [ ] Context setup ran once from the loaded skill base directory
- [ ] Exactly one owning command/reference was loaded, plus only its required deferred references
- [ ] Platform and surface mode routing followed current upstream rules; unknown platform never defaulted to web
- [ ] Target and incumbent visual truth were inspected before editing
- [ ] TodoWrite tracked the loaded reference's major phases
- [ ] Verification stayed within the upstream bounded-pass ceiling
- [ ] Actual evidence supports every reported gate result
- [ ] `{run_dir}/report.md`, `run check`, fenced completion/return-to-coordinator, and terminal Session handling followed `run-mode.md`
- [ ] Maestro-owned display uses `→`, `✓`, `◆`, `↺`, `⚠`, `FAIL`, and textual terminal status consistently

Codify mode:
- [ ] Source remained read-only; package, temporary, and Run writes stayed within declared boundaries
- [ ] Deferred workflows were phase-loaded and parallel extraction semantics were preserved
- [ ] Overwrite/current-Run provenance prevented stale artifacts from passing gates
- [ ] Knowhow candidate generation required explicit user confirmation and used `--run {run_id}`
- [ ] Requested artifact scope and stage receipts were verified before terminal status
- [ ] Temporary workspace was cleaned on every exit path
</success_criteria>
