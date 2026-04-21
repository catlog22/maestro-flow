# Workflow: codebase-rebuild

Full rebuild of the `.workflow/codebase/` documentation system.

## Trigger

- Manual via `/workflow:codebase-rebuild [--force] [--skip-commit]`
- Auto-triggered by `/workflow:init` when existing code is detected
- Auto-triggered by `/workflow:map`

## Arguments

| Arg | Description | Default |
|-----|-------------|---------|
| `--force` | Clear existing codebase/ and rebuild from scratch | `false` |
| `--skip-commit` | Skip the final git commit of generated docs | `false` |

## Prerequisites

- Project source code exists (src/ or equivalent)
- `.workflow/` directory exists

---

## Workflow Steps

### Step 1: Prepare Directory Structure

```
Create (or clear if --force) the codebase directory:

.workflow/codebase/
  doc-index.json
  tech-registry/
    _index.md
  feature-maps/
    _index.md
  action-logs/

If directories exist and --force not set:
  AskUserQuestion: "Codebase docs already exist. Rebuild will overwrite. Continue? [y/N]"
  If no: exit
```

### Step 2: Scan Project Structure — Components

```
Scan src/ (and other source directories) for components:

a. Identify source directories:
   - Check for: src/, lib/, app/, packages/
   - Use project-tech.json source_dirs if available

b. For each source directory, scan for component-forming files:
   - Directories that represent modules (contain index.ts/index.js or multiple files)
   - Key file patterns:
     - Models: *model*, *entity*, *schema* files
     - Services: *service*, *provider* files
     - Controllers: *controller*, *handler*, *route* files
     - Utils: *util*, *helper*, *common* files
     - Types: *type*, *interface*, *.d.ts files
     - Config: *config*, *constant* files
     - Middleware: *middleware*, *guard*, *interceptor* files
     - Core: *core*, *registry*, *loader* files

c. For each identified component:
   - Read the file(s)
   - Extract exported symbols (classes, functions, interfaces, types, constants)
   - Determine component type (model, service, controller, util, config, middleware, core)
   - Build component entry:
     {
       "id": "TC-{NNN}",          // Sequential, zero-padded 3 digits
       "name": "{PascalCase name}",
       "type": "{type}",
       "code_locations": ["{relative paths}"],
       "feature_ids": [],          // Populated in Step 3
       "symbols": ["{exported symbol names}"],
       "last_updated": "{ISO timestamp}"
     }

d. ID assignment: TC-001, TC-002, ... in discovery order
```

### Step 2.5: Load Project Specs

```
specs_content = maestro spec load --category arch
```

Used in Step 2-4 to produce architecture-aware documentation.

---

### Step 3: Scan Project Structure — Features

```
Group components by domain/functional area:

a. Heuristics for grouping:
   - Directory proximity (components in same directory = likely same feature)
   - Naming patterns (auth.service + auth.controller + auth.model = "Authentication")
   - Import relationships (files that import each other = related)
   - task-specs/ requirements mapping (if available)

b. For each identified feature group:
   - Determine feature name from common prefix or directory name
   - Collect component IDs
   - Map to requirements if task-specs/ REQ-* files exist
   - Determine phase association from roadmap.md if available
   - Build feature entry:
     {
       "id": "FT-{NNN}",
       "name": "{Feature Name}",
       "status": "active",
       "requirement_ids": [],      // From task-specs mapping
       "component_ids": ["TC-001", "TC-002"],
       "phase": null               // From roadmap mapping
     }

c. Back-fill component.feature_ids with the feature IDs
```

### Step 4: Map Requirements (if task-specs exist)

```
If .workflow/task-specs/ directories exist:
  For each SPEC-*/requirements/REQ-*.md:
    - Parse requirement metadata (title, priority, acceptance_criteria)
    - Match to features by keyword/domain analysis
    - Build requirement entry:
      {
        "id": "REQ-{NNN}",
        "title": "{requirement title}",
        "priority": "must|should|could|wont",
        "feature_id": "FT-{NNN}",
        "status": "pending|in_progress|completed",
        "acceptance_criteria": ["{criteria}"]
      }

If no task-specs exist:
  requirements = []  (empty, populated later by spec-generate)
```

### Step 5: Record Architecture Decisions (if ADRs exist)

```
If .workflow/task-specs/*/architecture/ADR-*.md exist:
  For each ADR file:
    - Parse ADR metadata (title, decision, rationale)
    - Map to components by keyword analysis
    - Build ADR entry:
      {
        "id": "ADR-{NNN}",
        "title": "{ADR title}",
        "component_ids": ["TC-{NNN}"],
        "decision": "{decision summary}",
        "rationale": "{rationale summary}"
      }

If no ADRs exist:
  architecture_decisions = []
```

### Step 6: Write doc-index.json

```
Assemble the complete doc-index.json:

{
  "version": "1.0",
  "schema_version": "1.0",
  "project": "{project name from state.json or package.json}",
  "last_updated": "{ISO timestamp}",
  "features": [{feature entries}],
  "components": [{component entries}],
  "requirements": [{requirement entries}],
  "architecture_decisions": [{ADR entries}],
  "actions": []
}

Write to: .workflow/codebase/doc-index.json
```

### Step 7: Generate Tech Registry Docs

```
For each component in doc-index.json:
  Compute slug: lowercase(name), replace spaces with hyphens

  Write .workflow/codebase/tech-registry/{slug}.md:

    # {component.name}

    | Field | Value |
    |-------|-------|
    | **ID** | {id} |
    | **Type** | {type} |
    | **Features** | {feature_ids joined with ", "} |

    ## Code Locations
    {bullet list of code_locations}

    ## Exported Symbols
    {bullet list of symbols}

    ## Dependencies
    {extracted from import statements in code_locations}

    ---
    *Auto-generated by codebase-rebuild at {timestamp}*

Write .workflow/codebase/tech-registry/_index.md:
  # Tech Registry

  | ID | Name | Type | Locations |
  |----|------|------|-----------|
  {table row per component}

  ---
  *{count} components registered*
```

### Step 8: Generate Feature Map Docs

```
For each feature in doc-index.json:
  Compute slug: lowercase(name), replace spaces with hyphens

  Write .workflow/codebase/feature-maps/{slug}.md:

    # {feature.name}

    | Field | Value |
    |-------|-------|
    | **ID** | {id} |
    | **Status** | {status} |
    | **Phase** | {phase or "unassigned"} |

    ## Requirements
    {bullet list of requirement_ids with titles}

    ## Components
    | ID | Name | Type |
    |----|------|------|
    {table row per component in component_ids}

    ---
    *Auto-generated by codebase-rebuild at {timestamp}*

Write .workflow/codebase/feature-maps/_index.md:
  # Feature Maps

  | ID | Name | Status | Components | Requirements |
  |----|------|--------|------------|--------------|
  {table row per feature}

  ---
  *{count} features mapped*
```

### Step 8.5: Update State and Project Artifacts

```
a. Update state.json:
   Read .workflow/state.json
   Set last_codebase_rebuild: "{ISO timestamp}"
   Set last_updated: "{ISO timestamp}"
   Write updated state.json

b. Update project-tech.json (if exists):
   Read .workflow/project-tech.json
   Compare detected tech stack (from Step 2 scan) against existing entries:
     - New languages, frameworks, databases, tools discovered
     - Version changes detected (from package.json, go.mod, pyproject.toml, etc.)
   If differences found:
     Update project-tech.json with current detected stack
     Display: "project-tech.json: updated with {count} changes"

c. Update project.md Tech Stack (if exists):
   Read .workflow/project.md
   Compare "## Tech Stack" section against detected stack from Step 2
   If new entries or changes detected:
     Update the Tech Stack section with current values
     Update the "Last updated" footer timestamp
     Write updated project.md
     Display: "project.md: Tech Stack section refreshed"
```

### Step 9: Report and Commit

```
Display summary:
  Codebase rebuild complete:
    Components: {count}
    Features: {count}
    Requirements: {count}
    ADRs: {count}
    Files generated: {count}

If any mapper agents failed: log W001 with the failed mapper name.

If not --skip-commit:
  Suggest committing the generated docs

Suggest next:
  - Skill({ skill: "manage-status" }) to review
  - Skill({ skill: "manage-codebase-refresh" }) for future incremental updates
```

---

## Error Handling

| Error | Action |
|-------|--------|
| No source directories found | Warn and create empty doc-index.json |
| .workflow/ missing | Fail: "Run /workflow:init first" |
| File read errors | Log warning, skip file, continue scan |
| Existing codebase/ without --force | Prompt user for confirmation |

## Output Files

| File | Description |
|------|-------------|
| `.workflow/codebase/doc-index.json` | Single source of truth for all components/features/requirements |
| `.workflow/codebase/tech-registry/_index.md` | Component index |
| `.workflow/codebase/tech-registry/{slug}.md` | Per-component documentation |
| `.workflow/codebase/feature-maps/_index.md` | Feature index |
| `.workflow/codebase/feature-maps/{slug}.md` | Per-feature documentation |
| `.workflow/state.json` | Updated: last_codebase_rebuild timestamp |
| `.workflow/project-tech.json` | Updated: detected tech stack changes |
| `.workflow/project.md` | Updated: Tech Stack section refreshed |
