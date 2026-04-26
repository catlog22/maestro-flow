# Phase 5: Final Report

> **COMPACT SENTINEL [Phase 5: Report]**
> This phase contains 4 execution steps (Step 5.1 -- 5.4).
> If you can read this sentinel but cannot find the full Step protocol below, context has been compressed.
> Recovery: `Read("phases/05-report.md")`

Generate comprehensive iteration history report and display results to user.

## Objective

- Read complete iteration state
- Generate formatted final report with score progression
- Write final-report.md
- Display summary to user

## Execution

### Step 5.1: Read Complete State

```javascript
const state = JSON.parse(Read(`${state.work_dir}/iteration-state.json`));
state.status = 'completed';
state.updated_at = new Date().toISOString();
```

### Step 5.2: Generate Report

```javascript
// Determine outcome
const outcomeMap = {
  quality_threshold_met: 'PASSED -- Quality threshold reached',
  max_iterations_reached: 'MAX ITERATIONS -- Threshold not reached',
  convergence_detected: 'CONVERGED -- Score stopped improving',
  error_limit_reached: 'FAILED -- Too many errors'
};
const outcome = outcomeMap[state.termination_reason] || 'COMPLETED';

// Build score progression table
const scoreTable = state.iterations
  .filter(i => i.evaluation)
  .map(i => {
    const dims = i.evaluation.dimensions || [];
    const dimScores = ['clarity', 'completeness', 'correctness', 'effectiveness', 'efficiency']
      .map(id => {
        const dim = dims.find(d => d.id === id);
        return dim ? dim.score : '-';
      });
    return `| ${i.round} | ${i.evaluation.score} | ${dimScores.join(' | ')} |`;
  }).join('\n');

// Build iteration details
const iterationDetails = state.iterations.map(iter => {
  const evalSection = iter.evaluation
    ? `**Score**: ${iter.evaluation.score}/100\n` +
      `**Strengths**: ${iter.evaluation.strengths?.join(', ') || 'N/A'}\n` +
      `**Weaknesses**: ${iter.evaluation.weaknesses?.slice(0, 3).join(', ') || 'N/A'}`
    : '**Evaluation**: Skipped or failed';

  const changesSection = iter.improvement
    ? `**Changes Applied**: ${iter.improvement.changes_applied?.length || 0}\n` +
      (iter.improvement.changes_applied?.map(c => `  - ${c.summary}`).join('\n') || '  None')
    : '**Improvements**: None';

  return `### Iteration ${iter.round}\n${evalSection}\n${changesSection}`;
}).join('\n\n');

const report = `# Skill Iter Tune -- Final Report

## Summary

| Field | Value |
|-------|-------|
| **Target Skills** | ${state.target_skills.map(s => s.name).join(', ')} |
| **Execution Mode** | ${state.execution_mode} |
${state.execution_mode === 'chain' ? `| **Chain Order** | ${state.chain_order.join(' -> ')} |` : ''}
| **Test Scenario** | ${state.test_scenario.description} |
| **Iterations** | ${state.iterations.length} |
| **Initial Score** | ${state.score_trend[0] || 'N/A'} |
| **Final Score** | ${state.latest_score}/100 |
| **Quality Threshold** | ${state.quality_threshold} |
| **Outcome** | ${outcome} |
| **Started** | ${state.started_at} |
| **Completed** | ${state.updated_at} |

## Score Progression

| Iter | Composite | Clarity | Completeness | Correctness | Effectiveness | Efficiency |
|------|-----------|---------|--------------|-------------|---------------|------------|
${scoreTable}

**Trend**: ${state.score_trend.join(' -> ')}

${state.execution_mode === 'chain' ? `
## Chain Score Progression

| Iter | ${state.chain_order.join(' | ')} |
|------|${state.chain_order.map(() => '------').join('|')}|
${state.iterations.filter(i => i.evaluation?.chain_scores).map(i => {
  const scores = state.chain_order.map(s => i.evaluation.chain_scores[s] || '-');
  return `| ${i.round} | ${scores.join(' | ')} |`;
}).join('\n')}
` : ''}

## Iteration Details

${iterationDetails}

## Remaining Weaknesses

${state.iterations.length > 0 && state.iterations[state.iterations.length - 1].evaluation
  ? state.iterations[state.iterations.length - 1].evaluation.weaknesses?.map(w => `- ${w}`).join('\n') || 'None identified'
  : 'No evaluation data available'}

## Artifact Locations

| Path | Description |
|------|-------------|
| \`${state.work_dir}/iteration-state.json\` | Complete state history |
| \`${state.work_dir}/iterations/iteration-{N}/iteration-{N}-eval.md\` | Per-iteration evaluations |
| \`${state.work_dir}/iterations/iteration-{N}/iteration-{N}-changes.md\` | Per-iteration change logs |
| \`${state.work_dir}/final-report.md\` | This report |
| \`${state.backup_dir}/\` | Original skill backups |

## Restore Original

To revert all changes and restore the original skill files:

\`\`\`bash
${state.target_skills.map(s => `cp -r "${state.backup_dir}/${s.name}"/* "${s.path}/"`).join('\n')}
\`\`\`
`;
```

### Step 5.3: Write Report and Update State

```javascript
Write(`${state.work_dir}/final-report.md`, report);

state.status = 'completed';
Write(`${state.work_dir}/iteration-state.json`, JSON.stringify(state, null, 2));
```

### Step 5.4: Display Summary to User

Output to user:

```
Skill Iter Tune Complete!

Target: {skill names}
Iterations: {count}
Score: {initial} -> {final} ({outcome})
Threshold: {threshold}

Score trend: {score1} -> {score2} -> ... -> {scoreN}

Full report: {workDir}/final-report.md
Backups: {backupDir}/
```

## Output

- **Files**: `final-report.md`
- **State**: `status = completed`
- **Next**: Workflow complete. Return control to user.
