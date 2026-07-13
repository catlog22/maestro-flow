

# Script Template

Unified script template covering both Bash and Python runtimes.

## Usage Context

| Phase | Usage |
|-------|-------|
| Optional | Use when declaring `## Scripts` in Phase/Action |
| Execution | Invoke via `ExecuteScript('script-id', params)` |
| Output Location | `.claude/skills/{skill-name}/scripts/{script-id}.{ext}` |

---

## Invocation Interface Specification

All scripts share the same calling convention:

```
Caller
    | ExecuteScript('script-id', { key: value })
    |
Script Entry
    ├─ Parameter parsing (--key value)
    ├─ Input validation (required parameter checks, file exists)
    ├─ Core processing (data read -> transform -> write)
    └─ Output result (last line: single-line JSON -> stdout)
         ├─ Success: {"status":"success", "output_file":"...", ...}
         └─ Failure: stderr output error message, exit 1
```

### Return Format

```typescript
interface ScriptResult {
  success: boolean;    // exit code === 0
  stdout: string;      // Standard output
  stderr: string;      // Standard error
  outputs: object;     // JSON output parsed from stdout last line
}
```

### Parameter Convention

| Parameter | Required | Description |
|-----------|----------|-------------|
| `--input-path` | Yes | Input file path |
| `--output-dir` | Yes | Output directory (specified by caller) |
| Others | Optional | Script-specific parameters |

---

## Bash Implementation

```bash
#!/bin/bash
# {{script_description}}

set -euo pipefail

# ============================================================
# Parameter Parsing
# ============================================================

INPUT_PATH=""
OUTPUT_DIR=""

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --input-path)  INPUT_PATH="$2"; shift ;;
        --output-dir)  OUTPUT_DIR="$2"; shift ;;
        --help)
            echo "Usage: $0 --input-path <path> --output-dir <dir>"
            exit 0
            ;;
        *)
            echo "Error: Unknown parameter $1" >&2
            exit 1
            ;;
    esac
    shift
done

# ============================================================
# Parameter Validation
# ============================================================

[[ -z "$INPUT_PATH" ]] && { echo "Error: --input-path is required parameter" >&2; exit 1; }
[[ -z "$OUTPUT_DIR" ]] && { echo "Error: --output-dir is required parameter" >&2; exit 1; }
[[ ! -f "$INPUT_PATH" ]] && { echo "Error: Input file does not exist: $INPUT_PATH" >&2; exit 1; }
command -v jq &> /dev/null || { echo "Error: jq is required" >&2; exit 1; }

mkdir -p "$OUTPUT_DIR"

# ============================================================
# Core Logic
# ============================================================

OUTPUT_FILE="$OUTPUT_DIR/result.txt"
ITEMS_COUNT=0

# TODO: Implement processing logic
while IFS= read -r line; do
    echo "$line" >> "$OUTPUT_FILE"
    ((ITEMS_COUNT++))
done < "$INPUT_PATH"

# ============================================================
# Output JSON Result (use jq to build, avoid escaping issues)
# ============================================================

jq -n \
    --arg output_file "$OUTPUT_FILE" \
    --argjson items_processed "$ITEMS_COUNT" \
    '{output_file: $output_file, items_processed: $items_processed, status: "success"}'
```

### Bash Common Patterns

```bash
# File iteration
for file in "$INPUT_DIR"/*.json; do
    [[ -f "$file" ]] || continue
    # Processing logic...
done

# Temp file (auto cleanup)
TEMP_FILE=$(mktemp)
trap "rm -f $TEMP_FILE" EXIT

# Tool dependency check
require_command() {
    command -v "$1" &> /dev/null || { echo "Error: $1 required" >&2; exit 1; }
}
require_command jq

# jq processing
VALUE=$(jq -r '.field' "$INPUT_PATH")                    # Read field
jq '.field = "new"' input.json > output.json             # Modify field
jq -s 'add' file1.json file2.json > merged.json          # Merge files
```

---

## Python Implementation

```python
#!/usr/bin/env python3
"""
{{script_description}}
"""

import argparse
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description='{{script_description}}')
    parser.add_argument('--input-path', type=str, required=True, help='Input file path')
    parser.add_argument('--output-dir', type=str, required=True, help='Output directory')
    args = parser.parse_args()

    # Validate input
    input_path = Path(args.input_path)
    if not input_path.exists():
        print(f"Error: Input file does not exist: {input_path}", file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Execute processing
    try:
        result = process(input_path, output_dir)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    # Output JSON result
    print(json.dumps(result))


def process(input_path: Path, output_dir: Path) -> dict:
    """Core processing logic"""
    # TODO: Implement processing logic

    output_file = output_dir / 'result.json'

    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    processed_count = len(data) if isinstance(data, list) else 1

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    return {
        'output_file': str(output_file),
        'items_processed': processed_count,
        'status': 'success'
    }


if __name__ == '__main__':
    main()
```

### Python Common Patterns

```python
# File iteration
def process_files(input_dir: Path, pattern: str = '*.json') -> list:
    return [
        {'file': str(f), 'data': json.load(f.open())}
        for f in input_dir.glob(pattern)
    ]

# Data transformation
def transform(data: dict) -> dict:
    return {
        'id': data.get('id'),
        'name': data.get('name', '').strip(),
        'timestamp': datetime.now().isoformat()
    }

# External command invocation
import subprocess

def run_command(cmd: list) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    return result.stdout
```

---

## Runtime Selection Guide

```
Task Characteristics
    |
    ├─ File processing / system commands / pipeline operations
    │   └─ Choose Bash (.sh)
    │
    ├─ JSON data processing / complex transformation / data analysis
    │   └─ Choose Python (.py)
    │
    └─ Simple read/write / format conversion
        └─ Either (Bash is lighter)
```

---

## Generation Function

```javascript
function generateScript(scriptConfig) {
  const runtime = scriptConfig.runtime || 'bash';  // 'bash' | 'python'
  const ext = runtime === 'python' ? '.py' : '.sh';

  if (runtime === 'python') {
    return generatePythonScript(scriptConfig);
  }
  return generateBashScript(scriptConfig);
}

function generateBashScript(scriptConfig) {
  const { description, inputs = [], outputs = [] } = scriptConfig;

  const paramDefs = inputs.map(i =>
    `${i.name.toUpperCase().replace(/-/g, '_')}="${i.default || ''}"`
  ).join('\n');

  const paramParse = inputs.map(i =>
    `        --${i.name}) ${i.name.toUpperCase().replace(/-/g, '_')}="$2"; shift ;;`
  ).join('\n');

  const paramValidation = inputs.filter(i => i.required).map(i => {
    const VAR = i.name.toUpperCase().replace(/-/g, '_');
    return `[[ -z "$${VAR}" ]] && { echo "Error: --${i.name} is required parameter" >&2; exit 1; }`;
  }).join('\n');

  return `#!/bin/bash
# ${description}

set -euo pipefail

${paramDefs}

while [[ "$#" -gt 0 ]]; do
    case $1 in
${paramParse}
        *) echo "Unknown parameter: $1" >&2; exit 1 ;;
    esac
    shift
done

${paramValidation}

# TODO: Implement processing logic

# Output result (jq build)
jq -n ${outputs.map(o =>
  `--arg ${o.name} "$${o.name.toUpperCase().replace(/-/g, '_')}"`
).join(' \\\n    ')} \
    '{${outputs.map(o => `${o.name}: $${o.name}`).join(', ')}}'
`;
}

function generatePythonScript(scriptConfig) {
  const { description, inputs = [], outputs = [] } = scriptConfig;

  const argDefs = inputs.map(i =>
    `    parser.add_argument('--${i.name}', type=${i.type || 'str'}, ${
      i.required ? 'required=True' : `default='${i.default || ''}'`
    }, help='${i.description || i.name}')`
  ).join('\n');

  const resultFields = outputs.map(o =>
    `        '${o.name}': None  # ${o.description || o.name}`
  ).join(',\n');

  return `#!/usr/bin/env python3
"""
${description}
"""

import argparse
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description='${description}')
${argDefs}
    args = parser.parse_args()

    # TODO: Implement processing logic
    result = {
${resultFields}
    }

    print(json.dumps(result))


if __name__ == '__main__':
    main()
`;
}
```

---

## Directory Convention

```
scripts/
├── process-data.py    # id: process-data, runtime: python
├── validate.sh        # id: validate, runtime: bash
└── transform.js       # id: transform, runtime: node
```

- **Name is ID**: Filename (without extension) = script ID
- **Extension is runtime**: `.py` -> python, `.sh` -> bash, `.js` -> node
