# Phase 3: Evaluate Quality

> **COMPACT SENTINEL [Phase 3: Evaluate]**
> This phase contains 5 execution steps (Step 3.1 -- 3.5).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/03-evaluate.md")`

Evaluate skill quality using `ccw cli --tool gemini --mode analysis`. Gemini scores the skill across 5 dimensions and provides improvement suggestions.

## Objective

- Construct evaluation prompt with skill + artifacts + criteria
- Execute via ccw cli Gemini
- Parse multi-dimensional score
- Write iteration-{N}-eval.md
- Check termination conditions

## Execution

### Step 3.1: Prepare Evaluation Context

```javascript
const N = state.current_iteration;
const iterDir = `${state.work_dir}/iterations/iteration-${N}`;

// Read evaluation criteria
// Ref: specs/evaluation-criteria.md
const evaluationCriteria = Read('.claude/skills/skill-iter-tune/specs/evaluation-criteria.md');

// Build skillContent (same pattern as Phase 02 — only executable files)
const skillContent = state.target_skills.map(skill => {
  const skillMd = Read(`${skill.path}/SKILL.md`);
  const phaseFiles = Glob(`${skill.path}/phases/*.md`).sort().map(f => ({
    relativePath: f.replace(skill.path + '/', ''),
    content: Read(f)
  }));
  const specFiles = Glob(`${skill.path}/specs/*.md`).map(f => ({
    relativePath: f.replace(skill.path + '/', ''),
    content: Read(f)
  }));
  return `### File: SKILL.md\n${skillMd}\n\n` +
    phaseFiles.map(f => `### File: ${f.relativePath}\n${f.content}`).join('\n\n') +
    (specFiles.length > 0 ? '\n\n' + specFiles.map(f => `### File: ${f.relativePath}\n${f.content}`).join('\n\n') : '');
}).join('\n\n---\n\n');

// Build artifacts summary
let artifactsSummary = 'No artifacts produced (execution may have failed)';

if (state.execution_mode === 'chain') {
  // Chain mode: group artifacts by skill
  const chainSummaries = state.chain_order.map(skillName => {
    const skillArtifactDir = `${iterDir}/artifacts/${skillName}`;
    const files = Glob(`${skillArtifactDir}/**/*`);
    if (files.length === 0) return `### ${skillName} (no artifacts)`;
    const filesSummary = files.map(f => {
      const relPath = f.replace(`${skillArtifactDir}/`, '');
      const content = Read(f, { limit: 200 });
      return `--- ${relPath} ---\n${content}`;
    }).join('\n\n');
    return `### ${skillName} (chain position ${state.chain_order.indexOf(skillName) + 1})\n${filesSummary}`;
  });
  artifactsSummary = chainSummaries.join('\n\n---\n\n');
} else {
  // Single mode (existing)
  const artifactFiles = Glob(`${iterDir}/artifacts/**/*`);
  if (artifactFiles.length > 0) {
    artifactsSummary = artifactFiles.map(f => {
      const relPath = f.replace(`${iterDir}/artifacts/`, '');
      const content = Read(f, { limit: 200 });
      return `--- ${relPath} ---\n${content}`;
    }).join('\n\n');
  }
}

// Build previous evaluation context
const previousEvalContext = state.iterations.filter(i => i.evaluation).length > 0
  ? `PREVIOUS ITERATIONS:\n` + state.iterations.filter(i => i.evaluation).map(iter =>
    `Iteration ${iter.round}: Score ${iter.evaluation.score}\n` +
    `  Applied: ${iter.improvement?.changes_applied?.map(c => c.summary).join('; ') || 'none'}\n` +
    `  Weaknesses: ${iter.evaluation.weaknesses?.slice(0, 3).join('; ') || 'none'}`
  ).join('\n') + '\nIMPORTANT: Focus on NEW issues not yet addressed.'
  : '';
```

### Step 3.2: Construct Evaluation Prompt

```javascript
// Ref: templates/eval-prompt.md
const evalPrompt = `PURPOSE: Evaluate the quality of a workflow skill by examining its definition and produced artifacts.

SKILL DEFINITION:
${skillContent}

TEST SCENARIO:
${state.test_scenario.description}
Requirements: ${state.test_scenario.requirements.join('; ')}
Success Criteria: ${state.test_scenario.success_criteria}

ARTIFACTS PRODUCED:
${artifactsSummary}

EVALUATION CRITERIA:
${evaluationCriteria}

${previousEvalContext}

${state.execution_mode === 'chain' ? `
CHAIN CONTEXT:
This skill chain contains ${state.chain_order.length} skills executed in order:
${state.chain_order.map((s, i) => `${i+1}. ${s}`).join('\n')}
Current evaluation covers the entire chain output.
Please provide per-skill quality scores in an additional "chain_scores" field: { "${state.chain_order[0]}": <score>, ... }
` : ''}

TASK:
1. Score each dimension (Clarity 0.20, Completeness 0.25, Correctness 0.25, Effectiveness 0.20, Efficiency 0.10) on 0-100
2. Calculate weighted composite score
3. List top 3 strengths
4. List top 3-5 weaknesses with file:section references
5. Provide 3-5 prioritized improvement suggestions with concrete changes

EXPECTED OUTPUT (strict JSON, no markdown):
{
  "composite_score": <0-100>,
  "dimensions": [
    {"name":"Clarity","id":"clarity","score":<0-100>,"weight":0.20,"feedback":"..."},
    {"name":"Completeness","id":"completeness","score":<0-100>,"weight":0.25,"feedback":"..."},
    {"name":"Correctness","id":"correctness","score":<0-100>,"weight":0.25,"feedback":"..."},
    {"name":"Effectiveness","id":"effectiveness","score":<0-100>,"weight":0.20,"feedback":"..."},
    {"name":"Efficiency","id":"efficiency","score":<0-100>,"weight":0.10,"feedback":"..."}
  ],
  "strengths": ["...", "...", "..."],
  "weaknesses": ["...with file:section ref...", "..."],
  "suggestions": [
    {"priority":"high|medium|low","target_file":"...","description":"...","rationale":"...","code_snippet":"..."}
  ]
}

CONSTRAINTS: Be rigorous, reference exact files, focus on highest-impact changes, output ONLY JSON`;
```

### Step 3.3: Execute via ccw cli Gemini

> **CHECKPOINT**: Verify evaluation prompt is properly constructed before CLI execution.

```javascript
// Shell escape utility (same as Phase 02)
function escapeForShell(str) {
  return str.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}

const skillPath = state.target_skills[0].path;  // Primary skill for --cd

const cliCommand = `ccw cli -p "${escapeForShell(evalPrompt)}" --tool gemini --mode analysis --cd "${skillPath}"`;

// Execute in background
Bash({
  command: cliCommand,
  run_in_background: true,
  timeout: 300000  // 5 minutes
});

// STOP -- wait for hook callback
```

### Step 3.4: Parse Score and Write Eval File

After CLI completes:

```javascript
// Parse JSON from Gemini output
// The output may contain markdown wrapping -- extract JSON
const rawOutput = /* CLI output from callback */;
const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
let evaluation;

if (jsonMatch) {
  try {
    evaluation = JSON.parse(jsonMatch[0]);
    // Extract chain_scores if present
    if (state.execution_mode === 'chain' && evaluation.chain_scores) {
      state.iterations[N - 1].evaluation.chain_scores = evaluation.chain_scores;
    }
  } catch (e) {
    // Fallback: try to extract score heuristically
    const scoreMatch = rawOutput.match(/"composite_score"\s*:\s*(\d+)/);
    evaluation = {
      composite_score: scoreMatch ? parseInt(scoreMatch[1]) : 50,
      dimensions: [],
      strengths: [],
      weaknesses: ['Evaluation output parsing failed -- raw output saved'],
      suggestions: []
    };
  }
} else {
  evaluation = {
    composite_score: 50,
    dimensions: [],
    strengths: [],
    weaknesses: ['No structured evaluation output -- defaulting to 50'],
    suggestions: []
  };
}

// Write iteration-N-eval.md
const evalReport = `# Iteration ${N} Evaluation

**Composite Score**: ${evaluation.composite_score}/100
**Date**: ${new Date().toISOString()}

## Dimension Scores

| Dimension | Score | Weight | Feedback |
|-----------|-------|--------|----------|
${(evaluation.dimensions || []).map(d =>
  `| ${d.name} | ${d.score} | ${d.weight} | ${d.feedback} |`
).join('\n')}

${(state.execution_mode === 'chain' && evaluation.chain_scores) ? `
## Chain Scores

| Skill | Score | Chain Position |
|-------|-------|----------------|
${state.chain_order.map((s, i) => `| ${s} | ${evaluation.chain_scores[s] || '-'} | ${i + 1} |`).join('\n')}
` : ''}

## Strengths
${(evaluation.strengths || []).map(s => `- ${s}`).join('\n')}

## Weaknesses
${(evaluation.weaknesses || []).map(w => `- ${w}`).join('\n')}

## Improvement Suggestions
${(evaluation.suggestions || []).map((s, i) =>
  `### ${i + 1}. [${s.priority}] ${s.description}\n- **Target**: ${s.target_file}\n- **Rationale**: ${s.rationale}\n${s.code_snippet ? `- **Suggested**:\n\`\`\`\n${s.code_snippet}\n\`\`\`` : ''}`
).join('\n\n')}
`;

Write(`${iterDir}/iteration-${N}-eval.md`, evalReport);

// Update state
state.iterations[N - 1].evaluation = {
  score: evaluation.composite_score,
  dimensions: evaluation.dimensions || [],
  strengths: evaluation.strengths || [],
  weaknesses: evaluation.weaknesses || [],
  suggestions: evaluation.suggestions || [],
  chain_scores: evaluation.chain_scores || null,
  eval_file: `${iterDir}/iteration-${N}-eval.md`
};
state.latest_score = evaluation.composite_score;
state.score_trend.push(evaluation.composite_score);

Write(`${state.work_dir}/iteration-state.json`, JSON.stringify(state, null, 2));
```

### Step 3.5: Check Termination

```javascript
function shouldTerminate(state) {
  // 1. Quality threshold met
  if (state.latest_score >= state.quality_threshold) {
    return { terminate: true, reason: 'quality_threshold_met' };
  }

  // 2. Max iterations reached
  if (state.current_iteration >= state.max_iterations) {
    return { terminate: true, reason: 'max_iterations_reached' };
  }

  // 3. Convergence: no improvement in last 2 iterations
  if (state.score_trend.length >= 3) {
    const last3 = state.score_trend.slice(-3);
    const improvement = last3[2] - last3[0];
    if (improvement <= 2) {
      state.converged = true;
      return { terminate: true, reason: 'convergence_detected' };
    }
  }

  // 4. Error limit
  if (state.error_count >= state.max_errors) {
    return { terminate: true, reason: 'error_limit_reached' };
  }

  return { terminate: false };
}

const termination = shouldTerminate(state);
if (termination.terminate) {
  state.termination_reason = termination.reason;
  Write(`${state.work_dir}/iteration-state.json`, JSON.stringify(state, null, 2));
  // Skip Phase 4, go directly to Phase 5 (Report)
} else {
  // Continue to Phase 4 (Improve)
}
```

## Error Handling

| Error | Recovery |
|-------|----------|
| CLI timeout | Retry once, if still fails use score 50 with warning |
| JSON parse failure | Extract score heuristically, save raw output |
| No output | Default score 50, note in weaknesses |

## Output

- **Files**: `iteration-{N}-eval.md`
- **State**: `iterations[N-1].evaluation`, `latest_score`, `score_trend` updated
- **Decision**: terminate -> Phase 5, continue -> Phase 4
- **TodoWrite**: Update current iteration score display
