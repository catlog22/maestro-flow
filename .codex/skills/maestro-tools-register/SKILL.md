---
name: maestro-tools-register
description: Register tool specs - extract, generate, or optimize reusable process definitions
argument-hint: "[description or intent]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion, Agent
---

<purpose>
Register tool specs into `.workflow/specs/tools.md`. Three modes:

1. **Extract** — Pull reusable processes from conversations/code/docs
2. **Generate** — Create new tool definitions from user description
3. **Optimize** — Improve existing tool spec steps, structure, clarity

Short processes (<10 steps) are written inline as spec-entry; long processes (>=10 steps or containing code examples) use ref mode with a knowhow detail document (RCP-/DOC-).
</purpose>

<context>
$ARGUMENTS — User intent description, or empty (interactive guidance)

```bash
$maestro-tools-register "extract the deployment flow from this project"
$maestro-tools-register "generate API integration test standard flow --roles implement,test"
$maestro-tools-register "optimize integration-test tool"
```

**Tool spec storage**: `.workflow/specs/tools.md`, format:
```xml
<spec-entry roles="implement,test" keywords="testing,api" date="YYYY-MM-DD">
### Tool Name
Step content...
</spec-entry>
```

**Ref mode** (long processes):
```xml
<spec-entry roles="implement" keywords="deploy,pipeline" date="YYYY-MM-DD"
  ref="knowhow/RCP-deploy-flow.md">
### Deploy Flow
Standard deployment process. See referenced document.
</spec-entry>
```
</context>

<execution>

### Step 1: Intent Detection

Parse $ARGUMENTS to determine mode:
- Contains "extract" → extract mode
- Contains "optimize/improve" → optimize mode
- Other → generate mode
- Empty → ask user with AskUserQuestion

### Step 2: Gather Information

**Extract mode**:
- Identify source (current conversation, specified files, codebase scan)
- Extract step sequence, prerequisites, expected outputs

**Generate mode**:
- Confirm tool name, applicable roles, target scenario
- If unclear, ask user with AskUserQuestion

**Optimize mode**:
- Load existing tool: `maestro spec load --role implement --keyword <name>`
- Analyze improvement points (step splitting, prerequisites, error handling)

### Step 3: Determine Roles

Infer applicable roles from context, or ask user:
- implement — execution tools (build, deploy, integrate)
- test — testing tools (test flows, verification steps)
- review — review tools (checklists, audit standards)
- plan — planning tools (design flows, analysis steps)
- analyze — analysis tools (diagnostic flows, investigation steps)

### Step 4: Decide Inline vs Ref

- Steps <10 and no code blocks → **inline mode**
- Steps >=10 or contains code examples/config → **ref mode**

### Step 5: Write

**Inline mode**:
```bash
maestro spec add tools "<title>" "<steps_content>" --roles "<csv>" --keywords "<csv>"
```

**Ref mode**:
1. Generate knowhow detail document (RCP- or DOC- prefix)
2. Register spec index entry referencing it:
```bash
maestro spec add tools "<title>" "<summary>" --roles "<csv>" --keywords "<csv>" \
  --ref "knowhow/RCP-<slug>.md" --knowhow-type recipe
```

### Step 6: Verify

- `maestro spec load --role <role> --keyword <keyword>` to confirm loadable
- Display result: title, roles, keywords, storage location

</execution>

<error_codes>
| Code | Severity | Description |
|------|----------|-------------|
| E001 | fatal | `.workflow/specs/` does not exist — run `maestro spec init` |
| E002 | warning | Duplicate tool name detected — confirm overwrite/optimize |
| E003 | fatal | roles parameter empty — tools must declare applicable roles |
</error_codes>

<success_criteria>
- [ ] Tool definition written to tools.md (or ref to knowhow)
- [ ] roles attribute correctly set
- [ ] keywords auto-extracted (3-5 terms)
- [ ] Loadable via `spec load --role <role>`
- [ ] Long processes use ref mode with knowhow file created
</success_criteria>
