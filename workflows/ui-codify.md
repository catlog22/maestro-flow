<!-- session-mode: inherited -->
# UI Codify: Main Workflow

从源代码提取设计系统，生成参考包，固化为知识资产。

## Architecture

```
Phase 1 (inline)     Phase 2 (deferred)       Phase 3 (deferred)       Phase 4 (deferred)
  Validate &           3 Parallel Agents        Reference Package        Knowhow Assets
  Setup                ┌─ Style Agent           Copy tokens +            Manifest +
  ├─ Parse args        ├─ Animation Agent       Generate preview         codify-to-knowhow
  ├─ Validate source   └─ Layout Agent          (preview.html/css)       + cleanup
  ├─ Package name      ↓                        ↓                        ↓
  └─ Workspace         design-tokens.json       preview.html             knowhow-manifest.json
                       animation-tokens.json    preview.css              → knowhow files
                       layout-templates.json                             → spec entries
```

## Data Flow

```
Input: source_path, package_name, output_dir, overwrite

Phase 1 → source_path, package_name, output_dir, temp_dir, package_dir
    ↓
Phase 2 → design-tokens.json, animation-tokens.json, layout-templates.json
    ↓      (written to temp_dir)
Phase 3 → preview.html, preview.css, token files copied to package_dir
    ↓
Phase 4 → knowhow-manifest.json → codify-to-knowhow → knowhow + specs
    ↓
Completion report
```

## TodoWrite Pattern

```json
[
  {"content": "Phase 1: 参数验证与工作区准备", "status": "in_progress"},
  {"content": "Phase 2: 并行 Agent 提取 (Style + Animation + Layout)", "status": "pending"},
  {"content": "Phase 3: 参考包生成 (preview.html + preview.css)", "status": "pending"},
  {"content": "Phase 4: 知识资产固化 (manifest + codify-to-knowhow)", "status": "pending"}
]
```

---

## Phase 1: Parameter Validation & Workspace Setup (Inline)

### Step 1.1: Parse Arguments

从 `$ARGUMENTS` 中解析：

- `source_path` (positional, required) — 源代码目录
- `--package-name <name>` — 包名（可选，默认从源目录自动生成）
- `--output-dir <path>` — 输出目录（默认 `.workflow/reference_style`）
- `--overwrite` — 允许覆盖已存在的包目录

```bash
# 验证 source_path 存在
if [ -z "$source_path" ]; then
  echo "E001: Source path argument required"
  echo "USAGE: /maestro-ui-codify <source-path> [--package-name <name>] [--output-dir <path>] [--overwrite]"
  exit 1
fi

if [ ! -d "$source_path" ]; then
  echo "E002: Source path not found or not a directory: $source_path"
  exit 1
fi

source_path=$(cd "$source_path" && pwd)
echo "Source: $source_path"
```

### Step 1.2: Resolve Package Name

```bash
# 自动生成包名: 目录名转 kebab-case，附加日期
if [ -z "$package_name" ]; then
  dir_name=$(basename "$source_path")
  package_name=$(echo "$dir_name" | tr '[:upper:]' '[:lower:]' | tr ' _' '-' | sed 's/[^a-z0-9-]//g')
  package_name="${package_name}-style"
fi

# 验证包名格式
if ! [[ "$package_name" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "ERROR: Invalid package name '$package_name'. Use lowercase, alphanumeric, hyphens only."
  exit 1
fi

echo "Package name: $package_name"
```

### Step 1.3: Setup Directories

```bash
output_dir="${output_dir:-.workflow/reference_style}"
package_dir="${output_dir}/${package_name}"

# 覆盖保护
if [ -d "$package_dir" ] && [ "$(ls -A "$package_dir" 2>/dev/null)" ]; then
  if [ "$overwrite" != "true" ]; then
    echo "E003: Package directory exists: $package_dir"
    echo "HINT: Use --overwrite to replace, or choose a different --package-name"
    exit 1
  fi
  echo "INFO: Overwriting existing package '$package_name'"
fi

# 创建临时工作区
timestamp=$(date +%Y%m%d%H%M%S)
temp_dir=".workflow/codify-temp-${timestamp}"
mkdir -p "$temp_dir/style-extraction/style-1"
mkdir -p "$temp_dir/animation-extraction"
mkdir -p "$temp_dir/layout-extraction"
mkdir -p "$temp_dir/.intermediates/import-analysis"
mkdir -p "$package_dir"

echo "[Phase 1] Setup complete"
echo "  Source: $source_path"
echo "  Package: $package_name"
echo "  Temp workspace: $temp_dir"
echo "  Output: $package_dir"
```

**TodoWrite**: Mark Phase 1 completed, Phase 2 in_progress.

---

## Phase 2: Parallel Agent Extraction (Deferred)

MANDATORY: execute ui-codify-extract.md steps; REQUIRED produce: design-tokens.json, animation-tokens.json, layout-templates.json; BLOCKED if missing.

Variables available to Phase 2:
- `source_path` — absolute path to source directory
- `temp_dir` — temporary workspace path (e.g. `.workflow/codify-temp-20260510143022`)

Phase 2 writes:
- `${temp_dir}/style-extraction/style-1/design-tokens.json`
- `${temp_dir}/animation-extraction/animation-tokens.json`
- `${temp_dir}/layout-extraction/layout-templates.json`

**TodoWrite**: Mark Phase 2 completed, Phase 3 in_progress.

---

## Phase 3: Reference Package Generation (Deferred)

MANDATORY: execute ui-codify-package.md steps; REQUIRED produce: preview.html, preview.css, token files copied to package_dir; BLOCKED if missing.

Variables available to Phase 3:
- `temp_dir` — temporary workspace with extraction results
- `package_dir` — target package directory
- `package_name` — package name

Phase 3 writes:
- `${package_dir}/design-tokens.json`
- `${package_dir}/layout-templates.json`
- `${package_dir}/animation-tokens.json` (if available)
- `${package_dir}/preview.html`
- `${package_dir}/preview.css`

**TodoWrite**: Mark Phase 3 completed, Phase 4 in_progress.

---

## Phase 4: Knowledge Asset Generation (Deferred)

MANDATORY: execute ui-codify-knowhow.md steps; REQUIRED produce: knowhow-manifest.json, knowhow files, spec entries; BLOCKED if missing.

Variables available to Phase 4:
- `package_dir` — package directory with all token files
- `package_name` — package name (used as slug)
- `temp_dir` — temporary workspace (to clean up)

Phase 4 writes:
- `${package_dir}/knowhow-manifest.json`
- Then calls `/codify-to-knowhow ${package_dir}` via Skill tool

**TodoWrite**: Mark Phase 4 completed (all tasks done).

---

## Error Handling

| Phase | Error | Recovery |
|-------|-------|----------|
| 1 | E001: Missing source path | Report usage, exit |
| 1 | E002: Source not found | Report path, exit |
| 1 | E003: Package exists | Suggest --overwrite, exit |
| 2 | Agent failure | Report which agent failed, continue with partial results; flag partial results as [LOW CONFIDENCE] (agent failure) |
| 2 | No files discovered | Report empty discovery, exit |
| 3 | Token copy failed | Report missing file, exit |
| 3 | Preview generation failed | Report error, continue (preview is non-critical); flag preview.html/css as [LOW CONFIDENCE] (preview generation failed) |
| 4 | Manifest build failed | Report error, package still usable without knowhow; flag knowhow assets as [LOW CONFIDENCE] (manifest build failed) |
| 4 | codify-to-knowhow failed | Report error, manifest remains for manual retry; flag knowhow/spec entries as [LOW CONFIDENCE] (codify-to-knowhow failed) |

## Completion Message

Glob all listed output files MUST exist before completion message; BLOCKED if missing.

```
UI Design System Codified!

Package: {package_name}
Location: {package_dir}

Files:
  design-tokens.json       Design tokens (colors, typography, spacing)
  layout-templates.json    Component patterns ({universal_count} universal, {specialized_count} specialized)
  animation-tokens.json    Animation tokens {if exists else "(not found)"}
  preview.html             Interactive showcase
  preview.css              Showcase styling
  knowhow-manifest.json    Knowledge asset manifest

Knowledge Assets:
  Knowhow: AST-{package_name}-tokens, AST-{package_name}-components{, DCS-{package_name}-decisions}
  Specs: {spec_count} entries (coding + arch)

Open preview:
  file://{absolute_path}/preview.html

Next steps:
  maestro wiki list --category coding    # Browse by category
  maestro spec load --keyword {package_name}    # Load related specs
```
