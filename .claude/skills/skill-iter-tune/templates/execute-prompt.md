# Execute Prompt Template

Phase 02 使用此模板构造 ccw cli 提示词，让 Claude 模拟执行 skill 并产出所有预期产物。

## Template

```
PURPOSE: Simulate executing the following workflow skill against a test scenario. Produce all expected output artifacts as if the skill were invoked with the given input. This is for evaluating skill quality.

SKILL CONTENT:
${skillContent}

TEST SCENARIO:
Description: ${testScenario.description}
Input Arguments: ${testScenario.input_args}
Requirements: ${testScenario.requirements}
Success Criteria: ${testScenario.success_criteria}

TASK:
1. Study the complete skill structure (SKILL.md + all phase files)
2. Follow the skill's execution flow sequentially (Phase 1 → Phase N)
3. For each phase, produce the artifacts that phase would generate
4. Write all output artifacts to the current working directory
5. Create a manifest.json listing all produced artifacts with descriptions

MODE: write

CONTEXT: @**/*

EXPECTED:
- All artifacts the skill would produce for this test scenario
- Each artifact in its correct relative path
- A manifest.json at root: { "artifacts": [{ "path": "...", "description": "...", "phase": N }] }

CONSTRAINTS:
- Follow the skill execution flow exactly — do not skip or reorder phases
- Produce realistic, high-quality output (not placeholder content)
- If the skill requires user interaction (AskUserQuestion), use reasonable defaults
- If the skill invokes external tools/CLIs, document what would be called but produce expected output directly
```

## Variable Substitution

| Variable | Source | Description |
|----------|--------|-------------|
| `${skillContent}` | Phase 02 reads all skill files | 完整 SKILL.md + phase 文件内容，用 markdown headers 分隔 |
| `${testScenario.description}` | iteration-state.json | 用户描述的测试场景 |
| `${testScenario.input_args}` | iteration-state.json | 模拟传给 skill 的参数 |
| `${testScenario.requirements}` | iteration-state.json | 质量要求列表 |
| `${testScenario.success_criteria}` | iteration-state.json | 成功标准定义 |

## Chain Mode Extension

When running in chain mode, the template is invoked once per skill in `chain_order`. Each invocation includes:

### Additional Variable

| Variable | Source | Description |
|----------|--------|-------------|
| `${previousChainOutput}` | Phase 02 chain loop | 前序 skill 的 artifacts 摘要 (chain 模式下非首个 skill) |

### Chain Prompt Modification

When `execution_mode === 'chain'`, the prompt includes:

```
PREVIOUS CHAIN OUTPUT (from upstream skill "${previousSkillName}"):
${previousChainOutput}

IMPORTANT: Use the above output as input context for this skill's execution.
```

This section is only added for skills at position 2+ in the chain. The first skill in the chain receives no upstream context.

## skillContent Construction

```javascript
// Read only executable skill files and format with consistent headers
const skillMd = Read(`${skill.path}/SKILL.md`);
const phaseFiles = Glob(`${skill.path}/phases/*.md`).map(f => ({
  relativePath: f.replace(skill.path + '/', ''),
  content: Read(f)
}));
const specFiles = Glob(`${skill.path}/specs/*.md`).map(f => ({
  relativePath: f.replace(skill.path + '/', ''),
  content: Read(f)
}));

const skillContent = `
### File: SKILL.md
${skillMd}

${phaseFiles.map(f => `### File: ${f.relativePath}\n${f.content}`).join('\n\n')}

${specFiles.length > 0 ? specFiles.map(f => `### File: ${f.relativePath}\n${f.content}`).join('\n\n') : ''}
`.trim();
```
