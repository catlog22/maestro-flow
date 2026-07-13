

# Scripting Integration Specification

Skill scripting integration specification that defines how to use external scripts for deterministic task execution.

## Core Principles

1. **Convention over configuration**: Naming is ID, file extension is runtime
2. **Minimal invocation**: Complete script call in one line
3. **Standard input/output**: Command-line parameters as input, JSON as standard output

## Directory Structure

```
.claude/skills/<skill-name>/
├── scripts/                    # Scripts directory
│   ├── process-data.py         # id: process-data
│   ├── validate-output.sh      # id: validate-output
│   └── transform-json.js       # id: transform-json
├── phases/
└── specs/
```

## Naming Conventions

| Extension | Runtime | Execution Command |
|-----------|---------|-------------------|
| `.py` | python | `python scripts/{id}.py` |
| `.sh` | bash | `bash scripts/{id}.sh` |
| `.js` | node | `node scripts/{id}.js` |

## Declaration Format

Declare in the `## Scripts` section of Phase or Action files:

```yaml
## Scripts

- process-data
- validate-output
```

## Invocation Syntax

### Basic Call

```javascript
const result = await ExecuteScript('script-id', { key: value });
```

### Parameter Name Conversion

Keys in the JS object are **automatically converted** to `kebab-case` command-line parameters:

| JS Key Name | Converted Parameter |
|-------------|-------------------|
| `input_path` | `--input-path` |
| `output_dir` | `--output-dir` |
| `max_count` | `--max-count` |

Use `--input-path` in scripts, pass `input_path` when calling.

### Complete Call (with Error Handling)

```javascript
const result = await ExecuteScript('process-data', {
  input_path: `${workDir}/data.json`,
  threshold: 0.9
});

if (!result.success) {
  throw new Error(`Script execution failed: ${result.stderr}`);
}

const { output_file, count } = result.outputs;
```

## Return Format

```typescript
interface ScriptResult {
  success: boolean;    // exit code === 0
  stdout: string;      // Complete standard output
  stderr: string;      // Complete standard error
  outputs: {           // JSON parsed from last line of stdout
    [key: string]: any;
  };
}
```

## Script Writing Specification

### Input: Command-line Parameters

```bash
# Python: argparse
--input-path /path/to/file --threshold 0.9

# Bash: manual parsing
--input-path /path/to/file
```

### Output: Standard Output JSON

Script must print single-line JSON on last line:

```json
{"output_file": "/tmp/result.json", "count": 42}
```

### Python Template

```python
import argparse
import json

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-path', required=True)
    parser.add_argument('--threshold', type=float, default=0.9)
    args = parser.parse_args()

    # Execution logic...
    result_path = "/tmp/result.json"

    # Output JSON
    print(json.dumps({
        "output_file": result_path,
        "items_processed": 100
    }))

if __name__ == '__main__':
    main()
```

### Bash Template

```bash
#!/bin/bash

# Parse parameters
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --input-path) INPUT_PATH="$2"; shift ;;
        *) echo "Unknown: $1" >&2; exit 1 ;;
    esac
    shift
done

# Execution logic...
LOG_FILE="/tmp/process.log"
echo "Processing $INPUT_PATH" > "$LOG_FILE"

# Output JSON
echo "{\"log_file\": \"$LOG_FILE\", \"status\": \"done\"}"
```

## ExecuteScript Implementation

```javascript
async function ExecuteScript(scriptId, inputs = {}) {
  const skillDir = GetSkillDir();

  // Find script file
  const extensions = ['.py', '.sh', '.js'];
  let scriptPath, runtime;

  for (const ext of extensions) {
    const path = `${skillDir}/scripts/${scriptId}${ext}`;
    if (FileExists(path)) {
      scriptPath = path;
      runtime = ext === '.py' ? 'python' : ext === '.sh' ? 'bash' : 'node';
      break;
    }
  }

  if (!scriptPath) {
    throw new Error(`Script not found: ${scriptId}`);
  }

  // Build command-line parameters
  const args = Object.entries(inputs)
    .map(([k, v]) => `--${k.replace(/_/g, '-')} "${v}"`)
    .join(' ');

  // Execute script
  const cmd = `${runtime} "${scriptPath}" ${args}`;
  const { stdout, stderr, exitCode } = await Bash(cmd);

  // Parse output
  let outputs = {};
  try {
    const lastLine = stdout.trim().split('\n').pop();
    outputs = JSON.parse(lastLine);
  } catch (e) {
    // Unable to parse JSON, keep empty object
  }

  return {
    success: exitCode === 0,
    stdout,
    stderr,
    outputs
  };
}
```

## Use Cases

### Suitable for Scripting

- Data processing and transformation
- File format conversion
- Batch file operations
- Complex calculation logic
- Call external tools/libraries

### Not Suitable for Scripting

- Tasks requiring user interaction
- Tasks needing access to Claude tools
- Simple file read/write
- Tasks requiring dynamic decision-making

## Path Conventions

### Script Path

Script paths are relative to the directory containing `SKILL.md` (skill root directory):

```
.claude/skills/<skill-name>/    # Skill root directory (SKILL.md location)
├── SKILL.md
├── scripts/                     # Scripts directory
│   └── process-data.py          # Relative path: scripts/process-data.py
└── phases/
```

`ExecuteScript` automatically finds scripts from skill root directory:
```javascript
// Actually executes: python .claude/skills/<skill-name>/scripts/process-data.py
await ExecuteScript('process-data', { ... });
```

### Output Directory

**Recommended**: Pass output directory from caller, not hardcode in script to `/tmp`:

```javascript
// Specify output directory when calling (in workflow working directory)
const result = await ExecuteScript('process-data', {
  input_path: `${workDir}/data.json`,
  output_dir: `${workDir}/output`    // Explicitly specify output location
});
```

Scripts should accept `--output-dir` parameter instead of hardcoding output paths.

## Best Practices

1. **Single Responsibility**: Each script does one thing
2. **No Side Effects**: Scripts should not modify global state
3. **Idempotence**: Same input produces same output
4. **Clear Errors**: Error messages to stderr, normal output to stdout
5. **Fail Fast**: Exit immediately on parameter validation failure
6. **Parameterized Paths**: Output paths specified by caller, not hardcoded
