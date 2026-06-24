---
name: codify-to-knowhow
description: "Manifest-driven knowledge asset generator — converts structured packages into knowhow + spec entries"
argument-hint: "<package-path>"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

<purpose>
Sequential manifest-driven knowledge asset generator. Reads `knowhow-manifest.json` from a package directory, writes knowhow files and spec entries with ref linking. No wave execution needed — pure sequential file operations.

**Core workflow**: Validate Manifest -> Write Knowhow Files -> Write Spec Entries -> Verify & Index

```
+---------------------------------------------------------------------------+
|                  CODIFY TO KNOWHOW (Direct Execution)                     |
+---------------------------------------------------------------------------+
|                                                                           |
|  Step 1: Parse package-path from $ARGUMENTS                              |
|                                                                           |
|  Step 2: Load & Validate knowhow-manifest.json                           |
|     +-- Validate required fields: slug, roles, knowhow[], specs[]        |
|     +-- Parse manifest object                                            |
|                                                                           |
|  Step 3: Generate Knowhow Assets                                         |
|     +-- For each manifest.knowhow[]:                                     |
|     |   +-- Idempotency check (skip if file exists)                      |
|     |   +-- Build frontmatter + body with <knowhow-entry> tags           |
|     |   +-- Write to .workflow/knowhow/{PREFIX}-{slug}-{fileSlug}.md     |
|                                                                           |
|  Step 4: Generate Spec Entries                                            |
|     +-- For each manifest.specs[]:                                       |
|     |   +-- Idempotency check (skip if title exists)                     |
|     |   +-- Write via maestro spec add CLI (fallback: direct append)     |
|     |   +-- Include ref attribute linking to knowhow file                |
|                                                                           |
|  Step 5: Refresh Wiki Index                                               |
|     +-- maestro wiki health                                              |
|                                                                           |
|  Step 6: Verify & Report                                                  |
|     +-- Verify knowhow files exist                                       |
|     +-- Verify spec entries written                                      |
|     +-- Verify ref links resolve                                         |
|     +-- Output completion report                                         |
|                                                                           |
+---------------------------------------------------------------------------+
```

</purpose>

<context>
```bash
$codify-to-knowhow ".workflow/reference_style/my-style-v1"
```

**Arguments**:
- `<package-path>` (positional, required): Directory containing `knowhow-manifest.json`

**Upstream**: `maestro-ui-codify`, `learn-decompose`, or any skill that generates a manifest
**Downstream**: `maestro search --category coding`, `maestro load --type spec --keyword <slug>`
</context>

<manifest_schema>

### knowhow-manifest.json

```json
{
  "slug": "my-style-v1",
  "domain": "ui-design",
  "roles": ["implement", "review"],
  "packagePath": ".workflow/reference_style/my-style-v1",

  "knowhow": [
    {
      "prefix": "AST",
      "fileSlug": "tokens",
      "title": "Design Tokens",
      "category": "asset",
      "assetType": "design-tokens",
      "codePaths": ["src/styles/"],
      "tags": ["design-tokens", "colors"],
      "body": "## Colors\n\n...",
      "entries": [
        {
          "category": "pattern",
          "keywords": "colors,tokens",
          "title": "Color System",
          "body": "## Colors\n\n..."
        }
      ]
    }
  ],

  "specs": [
    {
      "category": "coding",
      "keywords": "colors,design-tokens",
      "title": "Color Coding Convention",
      "ref": "knowhow/AST-my-style-v1-tokens.md",
      "body": "Use var(--color-primary) for primary colors..."
    }
  ]
}
```

**Required fields**:

| Field | Required | Description |
|-------|----------|-------------|
| `slug` | Yes | Package slug, used in file naming |
| `roles` | Yes | Role annotation array |
| `knowhow` | Yes | Knowhow asset declarations (can be empty) |
| `specs` | Yes | Spec entry declarations (can be empty) |
| `domain` | No | Domain identifier (ui-design, api, data) |
| `packagePath` | No | Original package path (metadata) |

**knowhow[] item fields**:

| Field | Required | Description |
|-------|----------|-------------|
| `prefix` | Yes | File prefix: AST, DCS, BLP, TIP, RCP, REF |
| `fileSlug` | Yes | File name suffix (e.g. "tokens") |
| `title` | Yes | Document title |
| `category` | Yes | asset, decision, blueprint, tip, recipe, reference |
| `tags` | Yes | Tag array |
| `body` | Yes | Markdown body content |
| `assetType` | No | Asset subtype (design-tokens, components, etc.) |
| `codePaths` | No | Related source code paths |
| `entries` | No | Sub-entries with `<knowhow-entry>` closed tags |

**specs[] item fields**:

| Field | Required | Description |
|-------|----------|-------------|
| `category` | Yes | coding, arch, quality, debug, test, review, learning |
| `title` | Yes | Entry title |
| `keywords` | Yes | Comma-separated keywords |
| `body` | Yes | Entry body text |
| `ref` | No | Reference path to knowhow file |

</manifest_schema>

<invariants>
1. **Manifest Required**: No manifest = error exit, no fallback
2. **Idempotent Writes**: Same-slug file exists = skip, never overwrite
3. **Closed Tags**: All entries use `<spec-entry>` / `<knowhow-entry>` closed-tag format
4. **Upstream Generates Manifest**: This skill only writes, never extracts knowledge
5. **CLI First, File Fallback**: Prefer `maestro spec add` CLI; fall back to direct file append on failure
6. **Ref Bridge**: Spec entries reference knowhow files via `ref` attribute
</invariants>

<execution>

### Step 1: Parse Package Path

**Parse from `$ARGUMENTS`**:

| Variable | Source | Default |
|----------|--------|---------|
| `package_path` | positional (required) | ERROR if missing |

```bash
package_path="${PACKAGE_PATH}"

# Validate directory exists
test -d "$package_path" || { echo "ERROR: Package path not found: $package_path"; exit 1; }

# Validate manifest exists
manifest_file="${package_path}/knowhow-manifest.json"
test -f "$manifest_file" || { echo "ERROR: knowhow-manifest.json not found in $package_path"; exit 1; }
```

### Step 2: Load & Validate Manifest

Read `${package_path}/knowhow-manifest.json` and validate:

```javascript
const manifest = JSON.parse(manifestContent);

// Required field validation
const required = ['slug', 'roles', 'knowhow', 'specs'];
const missing = required.filter(f => !manifest[f]);
if (missing.length > 0) {
  ERROR("Missing required fields: " + missing.join(', '));
  EXIT(1);
}

// Summary
REPORT(`Manifest loaded:
  Slug: ${manifest.slug}
  Domain: ${manifest.domain || 'generic'}
  Roles: ${manifest.roles.join(', ')}
  Knowhow assets: ${manifest.knowhow.length}
  Spec entries: ${manifest.specs.length}
`);
```

### Step 3: Generate Knowhow Assets

Ensure `.workflow/knowhow/` exists. For each `manifest.knowhow[]` item:

```bash
mkdir -p .workflow/knowhow
```

```javascript
const knowhowPaths = [];

for (const asset of manifest.knowhow) {
  const filename = `${asset.prefix}-${manifest.slug}-${asset.fileSlug}.md`;
  const filepath = `.workflow/knowhow/${filename}`;

  // Idempotency check
  if (fileExists(filepath)) {
    REPORT(`SKIP: ${filename} (already exists)`);
    continue;
  }

  // Build frontmatter
  let frontmatter = `---
title: ${asset.title}
type: ${asset.category}`;

  if (asset.assetType) {
    frontmatter += `\nassetType: ${asset.assetType}`;
  }

  frontmatter += `\nroles: [${manifest.roles.join(', ')}]`;

  if (asset.codePaths && asset.codePaths.length > 0) {
    frontmatter += `\ncodePaths:`;
    for (const cp of asset.codePaths) {
      frontmatter += `\n  - ${cp}`;
    }
  }

  frontmatter += `\ntags: [${asset.tags.join(', ')}]`;
  frontmatter += `\n---`;

  // Build body
  let body = asset.body || '';

  // If entries[], generate <knowhow-entry> closed tags
  if (asset.entries && asset.entries.length > 0) {
    const today = new Date().toISOString().split('T')[0];
    for (let i = 0; i < asset.entries.length; i++) {
      const entry = asset.entries[i];
      const entryId = `${asset.prefix}-${manifest.slug}-${String(i + 1).padStart(3, '0')}`;
      body += `\n\n<knowhow-entry keywords="${entry.category},${entry.keywords}" date="${today}" title="${entry.title}" description="${entry.description || ''}" id="${entryId}" roles="${manifest.roles.join(',')}" source="codify-to-knowhow">

### ${entry.title}

${entry.body}

</knowhow-entry>`;
    }
  }

  const content = `${frontmatter}\n\n${body}`;
  Write(filepath, content);
  REPORT(`CREATED: ${filename}`);
  knowhowPaths.push(filepath);
}

const skippedCount = manifest.knowhow.length - knowhowPaths.length;
REPORT(`Knowhow assets: ${knowhowPaths.length} created, ${skippedCount} skipped`);
```

### Step 4: Generate Spec Entries

For each `manifest.specs[]` item, write spec entry with `<spec-entry>` closed tag:

```javascript
const categoryFileMap = {
  coding: 'coding-conventions.md',
  arch: 'architecture-constraints.md',
  quality: 'quality-rules.md',
  debug: 'debug-notes.md',
  test: 'test-conventions.md',
  review: 'review-standards.md',
  learning: 'learnings.md'
};

const today = new Date().toISOString().split('T')[0];
let specEntryCount = 0;

for (const spec of manifest.specs) {
  const targetFile = `.workflow/specs/${categoryFileMap[spec.category]}`;

  // Idempotency: check if title already exists
  const titleExists = Bash(`grep -q "${spec.title}" "${targetFile}" 2>/dev/null && echo "exists" || echo "new"`);

  if (titleExists.trim() === 'exists') {
    REPORT(`SKIP spec: "${spec.title}" (already exists in ${spec.category})`);
    continue;
  }

  // Build spec-entry closed tag
  let refAttr = '';
  if (spec.ref) {
    refAttr = `\n  ref="${spec.ref}"`;
  }

  const entryBlock = `

<spec-entry roles="${manifest.roles.join(',')}" keywords="${spec.keywords}" date="${today}" title="${spec.title}" description="${spec.description || ''}"${refAttr}>

### ${spec.title}

${spec.body}

</spec-entry>`;

  // Prefer CLI, fallback to direct append
  const descFlag = spec.description ? ` --description "${spec.description}"` : '';
  const cliResult = Bash(`maestro spec add ${spec.category} "${spec.title}" "${spec.body}" --keywords "${spec.keywords}"${descFlag} 2>/dev/null`);

  if (cliResult.exitCode !== 0) {
    // Fallback: direct file append
    Edit(targetFile, { append: entryBlock });
  }

  specEntryCount++;
  REPORT(`CREATED spec: "${spec.title}" -> ${spec.category}`);
}

REPORT(`Spec entries: ${specEntryCount} created`);
```

### Step 5: Refresh Wiki Index

```bash
maestro wiki health 2>/dev/null || echo "Wiki index refresh skipped (command not available)"
```

### Step 6: Verify & Report

**6a: Verify knowhow files**:

```bash
echo "=== Knowhow Asset Verification ==="
for file in ${knowhowPaths}; do
  if test -f "$file"; then
    echo "  OK: $file"
  else
    echo "  MISSING: $file"
  fi
done
```

**6b: Verify spec entries**:

```bash
echo "=== Spec Entry Verification ==="
grep -c "${slug}" .workflow/specs/coding-conventions.md 2>/dev/null && \
  echo "  OK: coding-conventions.md" || echo "  MISSING: No entries in coding-conventions.md"

grep -c "${slug}" .workflow/specs/architecture-constraints.md 2>/dev/null && \
  echo "  OK: architecture-constraints.md" || echo "  MISSING: No entries in architecture-constraints.md"
```

**6c: Verify ref links**:

```bash
echo "=== Ref Link Verification ==="
refs=$(grep -oP 'ref="knowhow/[^"]*"' .workflow/specs/coding-conventions.md .workflow/specs/architecture-constraints.md 2>/dev/null | grep "${slug}" || true)

if [ -n "$refs" ]; then
  echo "$refs" | while IFS= read -r ref; do
    filepath=$(echo "$ref" | grep -oP 'knowhow/[^"]*')
    if test -f ".workflow/$filepath"; then
      echo "  OK: $filepath"
    else
      echo "  BROKEN: $filepath (file not found)"
    fi
  done
else
  echo "  WARNING: No ref links found for ${slug}"
fi
```

**6d: Completion report**:

```
=== Codify to Knowhow Complete ===

Package: {slug}
Source: {packagePath}

Knowhow Assets:
  {list of created/skipped files}

Spec Entries ({specEntryCount} created):
  {list of created/skipped entries by category}

Ref Links: spec -> knowhow bridge established
Wiki Index: refreshed

Next steps:
  maestro search --category coding    # Browse by role
  maestro load --type spec --keyword {slug}    # Load related specs
  maestro load --type knowhow --id <id>                # Load full entry
```

</execution>

<error_codes>

| Error | Resolution |
|-------|------------|
| Package path not found | Abort: "Package path not found: {path}" |
| Manifest not found | Abort: "knowhow-manifest.json not found in {path}" |
| Missing required fields | Abort: "Missing required fields: {list}" |
| Idempotent conflict | Skip existing assets, report skip count |
| CLI spec add failed | Fallback to direct file append |
| Wiki health failed | Warning, continue (non-critical) |

</error_codes>

<success_criteria>
- [ ] Package path validated and manifest loaded
- [ ] All required manifest fields present
- [ ] Knowhow files written to .workflow/knowhow/ (idempotent)
- [ ] Spec entries written with <spec-entry> closed tags (idempotent)
- [ ] Ref links from specs point to existing knowhow files
- [ ] Wiki index refreshed
- [ ] Completion report with asset counts
</success_criteria>
