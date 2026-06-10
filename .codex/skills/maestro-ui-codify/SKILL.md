---
name: maestro-ui-codify
description: Extract design system from code, generate reference package, persist as knowledge assets
argument-hint: "<source-path> [--package-name <name>] [--output-dir <path>] [--overwrite] [-y]"
allowed-tools: spawn_agents_on_csv, Read, Write, Edit, Bash, Glob, Grep
---

<purpose>
Wave-based UI design system codification using `spawn_agents_on_csv`. Diamond topology: file discovery (Wave 1), parallel style/animation/layout extraction (Wave 2), reference package generation (Wave 3), knowledge asset persistence (Wave 4).

**Core workflow**: Validate & Setup -> File Discovery -> 3-Agent Extraction -> Package Generation -> Knowhow Persistence

```
+---------------------------------------------------------------------------+
|                  UI CODIFY CSV WAVE WORKFLOW                               |
+---------------------------------------------------------------------------+
|                                                                           |
|  Step 1-2: Parse & Validate (inline)                                      |
|     +-- Parse source-path, --package-name, --output-dir, --overwrite      |
|     +-- Validate source directory exists                                  |
|     +-- Resolve package name (auto or explicit)                           |
|     +-- Setup workspace directories                                       |
|                                                                           |
|  Step 3: Generate tasks.csv                                               |
|     +-- Wave 1: File discovery (1 agent, barrier)                         |
|     +-- Wave 2: Parallel extraction (3 agents)                            |
|     |   +-- Style Agent: design-tokens.json                               |
|     |   +-- Animation Agent: animation-tokens.json                        |
|     |   +-- Layout Agent: layout-templates.json                           |
|     +-- Wave 3: Reference package (1 agent, barrier)                      |
|     |   +-- Copy tokens to package dir                                    |
|     |   +-- Generate preview.html + preview.css                           |
|     +-- Wave 4: Knowledge assets (1 agent, barrier)                       |
|         +-- Build knowhow-manifest.json                                   |
|         +-- Write knowhow files + spec entries                            |
|         +-- Cleanup temp workspace                                        |
|                                                                           |
|  Step 4: Wave Execution via spawn_agents_on_csv                           |
|                                                                           |
|  Step 5: Results & Completion Report                                      |
|                                                                           |
+---------------------------------------------------------------------------+
```

</purpose>

<context>
```bash
$maestro-ui-codify "src/components"
$maestro-ui-codify "src/components" --package-name my-design-v1
$maestro-ui-codify "src/styles" --output-dir .workflow/packages --overwrite -y
```

**Flags**:
- `<source-path>` (positional, required): Directory containing CSS/SCSS/JS/TS/HTML source files
- `--package-name <name>`: Package name for reference output (default: auto from source directory)
- `--output-dir <path>`: Output directory (default: `.workflow/reference_style`)
- `--overwrite`: Allow overwriting existing package directory
- `-y, --yes`: Skip all confirmations

**Output Directory**: `.workflow/.csv-wave/{session-id}/`
**Core Output**: `tasks.csv` (master state) + `results.csv` (final)
**Package Output**: `{output-dir}/{package-name}/` with design-tokens.json, layout-templates.json, animation-tokens.json, preview.html, preview.css, knowhow-manifest.json
</context>

<csv_schema>

### tasks.csv (Master State)

```csv
id,wave,title,description,agent_type,deps
"discover-1","1","Discover design files","Scan source directory, categorize files by type (CSS/SCSS/JS/TS/HTML), build file inventory with import relationships","discover",""
"style-1","2","Extract visual design tokens","Extract color, typography, spacing, border, shadow tokens from source files. Output design-tokens.json","extract-style","discover-1"
"anim-1","2","Extract animation tokens","Extract animation/transition declarations: keyframes, durations, easings, motion patterns. Output animation-tokens.json","extract-animation","discover-1"
"layout-1","2","Extract layout patterns","Extract component layout patterns: grid/flex systems, responsive breakpoints, container patterns. Output layout-templates.json","extract-layout","discover-1"
"package-1","3","Generate reference package","Copy token JSONs to package dir, generate preview.html + preview.css interactive showcase","package","style-1;anim-1;layout-1"
"knowhow-1","4","Build knowledge assets","Read token JSONs, build knowhow-manifest.json, write knowhow files + spec entries, cleanup temp workspace","knowhow","package-1"
```

**Column separation rule**: Input columns and Output columns MUST NOT share names. Wave CSV only contains Input columns. Output columns are returned exclusively via output_schema.

**Columns**:

| Column | Phase | Description |
|--------|-------|-------------|
| `id` | Input | Unique task identifier |
| `wave` | Input | Wave number (1=discover, 2=extract, 3=package, 4=knowhow) |
| `title` | Input | Short task title |
| `description` | Input | Detailed instructions for this task |
| `agent_type` | Input | Agent type: discover/extract-style/extract-animation/extract-layout/package/knowhow |
| `deps` | Input | Semicolon-separated dependency task IDs |
| `result_status` | Output | `completed` / `failed` (returned via output_schema) |
| `findings` | Output | Key findings summary (max 500 chars, via output_schema) |
| `output_path` | Output | Path to generated artifact (via output_schema) |
| `error` | Output | Error message if failed (via output_schema) |

### Session Structure

```
.workflow/.csv-wave/{YYYYMMDD}-ui-codify-{slug}/
+-- tasks.csv
+-- results.csv
+-- wave-{N}.csv (temporary)
```

</csv_schema>

<invariants>
0. **Load UI Specs**: Before extraction, load project UI conventions via `maestro spec load --category ui` (if available). Ensures extracted tokens align with existing conventions.
1. **Start Immediately**: First action is argument parsing, then validation
2. **Wave Order is Sacred**: Never execute wave N+1 before wave N completes and results are merged
3. **CSV is Source of Truth**: Master tasks.csv holds all state
4. **Context Propagation**: Wave 2 agents receive file discovery findings via prev_context
5. **Animation is Optional**: Missing animation-tokens.json is W001 warning, not fatal
6. **Idempotent Package**: --overwrite required to replace existing package directory
7. **Cleanup Temp Files**: Remove wave-{N}.csv after results merged, remove temp workspace after Wave 4
8. **DO NOT STOP**: Continuous execution until all waves complete

### Artifact Verification
Before reporting completion, verify: design-tokens.json, layout-templates.json, preview.html, preview.css, knowhow-manifest.json all exist. If any missing: DO NOT report completion.
</invariants>

<execution>

### Step 1: Parse Arguments

**Parse from `$ARGUMENTS`**:

| Variable | Source | Default |
|----------|--------|---------|
| `source_path` | positional (required) | ERROR if missing |
| `package_name` | `--package-name <name>` | auto from source dir |
| `output_dir` | `--output-dir <path>` | `.workflow/reference_style` |
| `overwrite` | `--overwrite` | false |
| `AUTO_YES` | `-y` or `--yes` | false |

### Step 2: Validate & Setup

**2a: Validate source path**:

```bash
# E001: Source path required
test -n "$source_path" || { echo "E001: Source path argument required"; exit 1; }

# E002: Source path must be a directory
test -d "$source_path" || { echo "E002: Source path not found or not a directory: $source_path"; exit 1; }

source_path=$(cd "$source_path" && pwd)
```

**2b: Resolve package name**:

```bash
# Auto-generate: directory name -> kebab-case + "-style" suffix
if [ -z "$package_name" ]; then
  dir_name=$(basename "$source_path")
  package_name=$(echo "$dir_name" | tr '[:upper:]' '[:lower:]' | tr ' _' '-' | sed 's/[^a-z0-9-]//g')
  package_name="${package_name}-style"
fi
```

**2c: Setup directories**:

```bash
output_dir="${output_dir:-.workflow/reference_style}"
package_dir="${output_dir}/${package_name}"

# E003: Overwrite protection
if [ -d "$package_dir" ] && [ "$(ls -A "$package_dir" 2>/dev/null)" ]; then
  if [ "$overwrite" != "true" ]; then
    echo "E003: Package directory exists: $package_dir"
    echo "HINT: Use --overwrite to replace, or choose a different --package-name"
    exit 1
  fi
fi

# Create temp workspace + package dir
timestamp=$(date +%Y%m%d%H%M%S)
temp_dir=".workflow/codify-temp-${timestamp}"
mkdir -p "$temp_dir"
mkdir -p "$package_dir"

# Session directory
session_slug=$(echo "$package_name" | head -c 40)
session_date=$(date -u +%Y%m%d)
sessionFolder=".workflow/.csv-wave/${session_date}-ui-codify-${session_slug}"
mkdir -p "$sessionFolder"
```

### Step 3: Generate tasks.csv

Build the master CSV with 4 waves. The `description` column contains full agent instructions.

**Wave 1 — File Discovery** (1 agent, barrier):

Description template:
```
Scan source directory '${source_path}' for design-relevant files. Categorize by type:
- CSS/SCSS files: stylesheets with design tokens
- JS/TS files: style objects, theme configs, styled-components
- HTML files: template structure with inline styles

Build file inventory JSON at '${temp_dir}/file-inventory.json':
{
  "source_path": "${source_path}",
  "files": [
    { "path": "...", "type": "css|scss|js|ts|html", "category": "tokens|components|layout|animation", "size": N }
  ],
  "summary": { "total": N, "by_type": {...}, "by_category": {...} }
}

Use Glob to find files, Read to sample content for categorization. Report total file count and category breakdown in findings.
```

**Wave 2 — Parallel Extraction** (3 agents):

Each agent receives file discovery findings via `prev_context`. Agent prompts reference workflow files for detailed extraction logic:

- **Style Agent**: Follow `@~/.maestro/workflows/ui-codify-extract.md` Style Agent section. Source: `${source_path}`. Read file inventory from `${temp_dir}/file-inventory.json`. Write `${temp_dir}/design-tokens.json` with color, typography, spacing, border, shadow tokens.
- **Animation Agent**: Follow `@~/.maestro/workflows/ui-codify-extract.md` Animation Agent section. Source: `${source_path}`. Read file inventory from `${temp_dir}/file-inventory.json`. Write `${temp_dir}/animation-tokens.json` with keyframes, transitions, easings. Optional — W001 if no animations found.
- **Layout Agent**: Follow `@~/.maestro/workflows/ui-codify-extract.md` Layout Agent section. Source: `${source_path}`. Read file inventory from `${temp_dir}/file-inventory.json`. Write `${temp_dir}/layout-templates.json` with grid/flex systems, breakpoints, component patterns.

**Wave 3 — Reference Package** (1 agent, barrier):

Description template:
```
Follow @~/.maestro/workflows/ui-codify-package.md to generate reference package.

Copy token files from '${temp_dir}' to '${package_dir}':
- design-tokens.json (required)
- animation-tokens.json (optional, skip if missing)
- layout-templates.json (required)

Generate preview.html + preview.css in '${package_dir}' as interactive token showcase.
Preview must display all extracted tokens visually: color swatches, typography samples, spacing scale, animation demos.

Report file counts and package size in findings.
```

**Wave 4 — Knowledge Assets** (1 agent, barrier):

Description template:
```
Follow @~/.maestro/workflows/ui-codify-knowhow.md to build knowledge assets.

1. Read token JSONs from '${package_dir}' (design-tokens.json, layout-templates.json, animation-tokens.json if exists)
2. Build knowhow-manifest.json in '${package_dir}' with:
   - slug: '${package_name}'
   - domain: 'ui-design'
   - roles: ['implement', 'review']
   - packagePath: '${package_dir}'
   - knowhow[]: AST- entries for tokens and components
   - specs[]: coding + arch entries with ref links to knowhow files
3. Write knowhow files to .workflow/knowhow/ per manifest.knowhow[]
4. Write spec entries per manifest.specs[] using maestro spec add CLI (fallback: direct file append)
5. Refresh wiki index: maestro wiki health
6. Cleanup temp workspace: rm -rf '${temp_dir}'

Report knowhow file count and spec entry count in findings.
```

Write `tasks.csv` to `${sessionFolder}/tasks.csv`.

### Step 4: Wave Execution

Execute waves sequentially via `spawn_agents_on_csv`. All four waves share the same `output_schema` shape (below) — only `instruction` differs.

**Shared output_schema** (strict JSON Schema):

```javascript
const UI_CODIFY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    id:            { type: "string" },
    result_status: { type: "string", enum: ["completed", "failed"] },
    findings:      { type: "string", maxLength: 500 },
    output_path:   { type: "string", description: "Absolute path of the file/dir produced by this worker (empty if failed)" },
    error:         { type: "string" }
  },
  required: ["id", "result_status", "findings"]
}
```

**Shared termination contract** (embed in every `instruction` below):

```
TERMINATION CONTRACT (mandatory — NO worker may end without calling report_agent_job_result):
  - Success → result_status=completed, output_path set to the absolute path of the artifact you wrote
  - Failure → unrecoverable error → result_status=failed, output_path=""
  - Timeout → near max_runtime_seconds, finalize current write if safe → otherwise report failed with error="timeout"
  - NEVER continue indefinitely. NEVER exit silently. NEVER omit the call.
  - Do NOT write to tasks.csv, wave-*.csv, results.csv (orchestrator owns those).
  - Do NOT call spawn_agents_on_csv (no recursion).
```

#### Wave 1: File Discovery (Barrier)

Filter `wave == 1 && status == pending` from master CSV. Write `wave-1.csv`.

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-1.csv`,
  id_column: "id",
  instruction: `You are scanning a source directory for design-relevant files. Read the 'description' column for full instructions. Use Glob to find files, Read to sample content. Write file inventory JSON to the specified path. Report findings as a concise summary.\n\n${SHARED_TERMINATION_CONTRACT}`,
  max_concurrency: 1,
  max_runtime_seconds: 1800,
  output_csv_path: `${sessionFolder}/wave-1-results.csv`,
  output_schema: UI_CODIFY_OUTPUT_SCHEMA
})
```

Merge wave-1-results.csv into master `tasks.csv`: map `result_status` -> master `status` column; copy `findings`, `output_path`, `error`. Delete `wave-1.csv` and `wave-1-results.csv`.

#### Wave 2: Parallel Extraction (3 agents)

Filter `wave == 2 && status == pending`. Build `prev_context` from wave 1 findings (file inventory summary). Write `wave-2.csv` with `prev_context` column.

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-2.csv`,
  id_column: "id",
  instruction: `You are extracting design tokens from source code. Read the 'description' column for your specific extraction task. Use prev_context for file inventory from discovery phase. Read source files, extract tokens, write output JSON to the specified path.\n\n${SHARED_TERMINATION_CONTRACT}`,
  max_concurrency: 3,
  max_runtime_seconds: 3600,
  output_csv_path: `${sessionFolder}/wave-2-results.csv`,
  output_schema: UI_CODIFY_OUTPUT_SCHEMA
})
```

Merge wave-2-results.csv into master `tasks.csv`: map `result_status` -> master `status` column, then delete `wave-2.csv` and `wave-2-results.csv`.

**Degradation**: If animation agent fails (W001), continue — animation is optional. If style or layout agent fails, warn but continue with available results.

#### Wave 3: Reference Package (Barrier)

Filter `wave == 3 && status == pending`. Build `prev_context` from wave 2 findings (extraction summaries + output paths). Write `wave-3.csv` with `prev_context`.

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-3.csv`,
  id_column: "id",
  instruction: `You are generating a reference design package. Read the 'description' column for full instructions. Copy token files, generate preview.html and preview.css. Report package contents in findings.\n\n${SHARED_TERMINATION_CONTRACT}`,
  max_concurrency: 1,
  max_runtime_seconds: 1800,
  output_csv_path: `${sessionFolder}/wave-3-results.csv`,
  output_schema: UI_CODIFY_OUTPUT_SCHEMA
})
```

Merge wave-3-results.csv into master `tasks.csv`: map `result_status` -> master `status` column, then delete `wave-3.csv` and `wave-3-results.csv`.

#### Wave 4: Knowledge Assets (Barrier)

Filter `wave == 4 && status == pending`. Build `prev_context` from wave 3 findings (package contents). Write `wave-4.csv` with `prev_context`.

```javascript
spawn_agents_on_csv({
  csv_path: `${sessionFolder}/wave-4.csv`,
  id_column: "id",
  instruction: `You are building knowledge assets from a design package. Read the 'description' column for full instructions. Build manifest, write knowhow files, create spec entries, refresh wiki index, cleanup temp files. Report asset counts in findings.\n\n${SHARED_TERMINATION_CONTRACT}`,
  max_concurrency: 1,
  max_runtime_seconds: 1800,
  output_csv_path: `${sessionFolder}/wave-4-results.csv`,
  output_schema: UI_CODIFY_OUTPUT_SCHEMA
})
```

Merge wave-4-results.csv into master `tasks.csv`: map `result_status` -> master `status` column, then delete `wave-4.csv` and `wave-4-results.csv`.

### Step 5: Results & Completion

1. Read final master `tasks.csv`
2. Export as `results.csv`
3. Display completion report:

```
UI Design System Codified!

Package: {package_name}
Location: {package_dir}

Files:
  design-tokens.json       Design tokens (colors, typography, spacing)
  layout-templates.json    Component patterns
  animation-tokens.json    Animation tokens {or "(not found)"}
  preview.html             Interactive showcase
  preview.css              Showcase styling
  knowhow-manifest.json    Knowledge asset manifest

Knowledge Assets:
  Knowhow: {knowhow_count} files created
  Specs: {spec_count} entries created

Open preview:
  file://{absolute_path}/preview.html

Next steps:
  maestro search --category coding    # Browse by role
  maestro spec load --keyword {package_name}    # Load related specs
```

</execution>

<error_codes>

| Error | Severity | Resolution |
|-------|----------|------------|
| E001: Source path required | fatal | Report usage, abort |
| E002: Source not found | fatal | Report path, abort |
| E003: Package exists | fatal | Suggest --overwrite, abort |
| W001: No animations found | warning | Continue without animation-tokens.json |
| Wave 1 failed | fatal | No files discovered, abort |
| Wave 2 partial failure | degraded | Continue with available extraction results |
| Wave 3 failed | fatal | Package generation failed, abort |
| Wave 4 failed | degraded | Package still usable, manifest remains for manual retry |

</error_codes>

<success_criteria>
- [ ] Source path validated and session folder created
- [ ] File discovery completed with inventory JSON
- [ ] design-tokens.json generated with color, typography, spacing tokens
- [ ] layout-templates.json generated with component patterns
- [ ] animation-tokens.json generated (optional, W001 if missing)
- [ ] preview.html + preview.css generated as interactive showcase
- [ ] knowhow-manifest.json created with AST assets and spec entries
- [ ] Knowhow files written to .workflow/knowhow/
- [ ] Spec entries written via maestro spec add
- [ ] Wiki index refreshed
- [ ] Temporary workspace cleaned up
- [ ] results.csv exported
</success_criteria>
