
<required_reading>
@~/.maestro/workflows/run-mode.md
</required_reading>
# Action: Diagnose Documentation Structure

检测目标 skill 中的文档冗余和冲突问题。

## Purpose

- 检测重复定义（State Schema、映射表、类型定义等）
- 检测冲突定义（优先级定义不一致、实现与文档漂移等）
- 生成合并和解决冲突的建议

## Preconditions

- [ ] `state.status === 'running'`
- [ ] `state.target_skill !== null`
- [ ] `!state.diagnosis.docs`
- [ ] 用户指定 focus_areas 包含 'docs' 或 'all'，或需要全面诊断

## Detection Patterns

### DOC-RED-001: 核心定义重复

检测 State Schema、核心接口等在多处定义：

```javascript
async function detectDefinitionDuplicates(skillPath) {
  const patterns = [
    { name: 'state_schema', regex: /interface\s+(TuningState|State)\s*\{/g },
    { name: 'fix_strategy', regex: /type\s+FixStrategy\s*=/g },
    { name: 'issue_type', regex: /type:\s*['"]?(context_explosion|memory_loss|dataflow_break)/g }
  ];
  
  const files = Glob('**/*.md', { cwd: skillPath });
  const duplicates = [];
  
  for (const pattern of patterns) {
    const matches = [];
    for (const file of files) {
      const content = Read(`${skillPath}/${file}`);
      if (pattern.regex.test(content)) {
        matches.push({ file, pattern: pattern.name });
      }
    }
    if (matches.length > 1) {
      duplicates.push({
        type: pattern.name,
        files: matches.map(m => m.file),
        severity: 'high'
      });
    }
  }
  
  return duplicates;
}
```

### DOC-RED-002: 硬编码配置重复

检测 action 文件中硬编码与 spec 文档的重复：

```javascript
async function detectHardcodedDuplicates(skillPath) {
  const actionFiles = Glob('phases/actions/*.md', { cwd: skillPath });
  const specFiles = Glob('specs/*.md', { cwd: skillPath });
  
  const duplicates = [];
  
  for (const actionFile of actionFiles) {
    const content = Read(`${skillPath}/${actionFile}`);
    
    // 检测硬编码的映射对象
    const hardcodedPatterns = [
      /const\s+\w*[Mm]apping\s*=\s*\{/g,
      /patternMapping\s*=\s*\{/g,
      /strategyMapping\s*=\s*\{/g
    ];
    
    for (const pattern of hardcodedPatterns) {
      if (pattern.test(content)) {
        duplicates.push({
          type: 'hardcoded_mapping',
          file: actionFile,
          description: '硬编码映射可能与 specs/ 中的定义重复',
          severity: 'high'
        });
      }
    }
  }
  
  return duplicates;
}
```

### DOC-CON-001: 优先级定义冲突

检测 P0-P3 等优先级在不同文件中的定义不一致：

```javascript
async function detectPriorityConflicts(skillPath) {
  const files = Glob('**/*.md', { cwd: skillPath });
  const priorityDefs = {};
  
  const priorityPattern = /\*\*P(\d+)\*\*[:\s]+([^\|]+)/g;
  
  for (const file of files) {
    const content = Read(`${skillPath}/${file}`);
    let match;
    while ((match = priorityPattern.exec(content)) !== null) {
      const priority = `P${match[1]}`;
      const definition = match[2].trim();
      
      if (!priorityDefs[priority]) {
        priorityDefs[priority] = [];
      }
      priorityDefs[priority].push({ file, definition });
    }
  }
  
  const conflicts = [];
  for (const [priority, defs] of Object.entries(priorityDefs)) {
    const uniqueDefs = [...new Set(defs.map(d => d.definition))];
    if (uniqueDefs.length > 1) {
      conflicts.push({
        key: priority,
        definitions: defs,
        severity: 'critical'
      });
    }
  }
  
  return conflicts;
}
```

### DOC-CON-002: 实现与文档漂移

检测硬编码与文档表格的不一致：

```javascript
async function detectImplementationDrift(skillPath) {
  // 比较 category-mappings.json 与 specs/*.md 中的表格
  const mappingsFile = `${skillPath}/specs/category-mappings.json`;
  
  if (!fileExists(mappingsFile)) {
    return []; // 无集中配置，跳过
  }
  
  const mappings = JSON.parse(Read(mappingsFile));
  const conflicts = [];
  
  // 与 dimension-mapping.md 对比
  const dimMapping = Read(`${skillPath}/specs/dimension-mapping.md`);
  
  for (const [category, config] of Object.entries(mappings.categories)) {
    // 检查策略是否在文档中提及
    for (const strategy of config.strategies || []) {
      if (!dimMapping.includes(strategy)) {
        conflicts.push({
          type: 'mapping',
          key: `${category}.strategies`,
          issue: `策略 ${strategy} 在 JSON 中定义但未在文档中提及`
        });
      }
    }
  }
  
  return conflicts;
}
```

## Execution

```javascript
async function executeDiagnosis(state, workDir) {
  console.log('=== Diagnosing Documentation Structure ===');
  
  const skillPath = state.target_skill.path;
  const issues = [];
  
  // 1. 检测冗余
  const definitionDups = await detectDefinitionDuplicates(skillPath);
  const hardcodedDups = await detectHardcodedDuplicates(skillPath);
  
  for (const dup of [...definitionDups, ...hardcodedDups]) {
    issues.push({
      id: `DOC-RED-${issues.length + 1}`,
      type: 'doc_redundancy',
      severity: dup.severity,
      location: { files: dup.files || [dup.file] },
      description: dup.description || `${dup.type} 在多处定义`,
      evidence: dup.files || [dup.file],
      root_cause: '缺乏单一真相来源',
      impact: '维护困难，易产生不一致',
      suggested_fix: 'consolidate_to_ssot'
    });
  }
  
  // 2. 检测冲突
  const priorityConflicts = await detectPriorityConflicts(skillPath);
  const driftConflicts = await detectImplementationDrift(skillPath);
  
  for (const conflict of priorityConflicts) {
    issues.push({
      id: `DOC-CON-${issues.length + 1}`,
      type: 'doc_conflict',
      severity: 'critical',
      location: { files: conflict.definitions.map(d => d.file) },
      description: `${conflict.key} 在不同文件中定义不一致`,
      evidence: conflict.definitions.map(d => `${d.file}: ${d.definition}`),
      root_cause: '定义更新后未同步',
      impact: '行为不可预测',
      suggested_fix: 'reconcile_conflicting_definitions'
    });
  }
  
  // 3. 生成报告
  const severity = issues.some(i => i.severity === 'critical') ? 'critical' :
                   issues.some(i => i.severity === 'high') ? 'high' :
                   issues.length > 0 ? 'medium' : 'none';
  
  const result = {
    status: 'completed',
    issues_found: issues.length,
    severity: severity,
    execution_time_ms: Date.now() - startTime,
    details: {
      patterns_checked: ['DOC-RED-001', 'DOC-RED-002', 'DOC-CON-001', 'DOC-CON-002'],
      patterns_matched: issues.map(i => i.id.split('-').slice(0, 2).join('-')),
      evidence: issues.flatMap(i => i.evidence),
      recommendations: generateRecommendations(issues)
    },
    redundancies: issues.filter(i => i.type === 'doc_redundancy'),
    conflicts: issues.filter(i => i.type === 'doc_conflict')
  };
  
  // 写入诊断结果
  Write(`${workDir}/diagnosis/docs-diagnosis.json`, JSON.stringify(result, null, 2));
  
  return {
    stateUpdates: {
      'diagnosis.docs': result,
      issues: [...state.issues, ...issues]
    },
    outputFiles: [`${workDir}/diagnosis/docs-diagnosis.json`],
    summary: `文档诊断完成：发现 ${issues.length} 个问题 (${severity})`
  };
}

function generateRecommendations(issues) {
  const recommendations = [];
  
  if (issues.some(i => i.type === 'doc_redundancy')) {
    recommendations.push('使用 consolidate_to_ssot 策略合并重复定义');
    recommendations.push('考虑创建 specs/category-mappings.json 集中管理配置');
  }
  
  if (issues.some(i => i.type === 'doc_conflict')) {
    recommendations.push('使用 reconcile_conflicting_definitions 策略解决冲突');
    recommendations.push('建立文档同步检查机制');
  }
  
  return recommendations;
}
```

## Output

### State Updates

```javascript
{
  stateUpdates: {
    'diagnosis.docs': {
      status: 'completed',
      issues_found: N,
      severity: 'critical|high|medium|low|none',
      redundancies: [...],
      conflicts: [...]
    },
    issues: [...existingIssues, ...newIssues]
  }
}
```

### Output Files

- `${workDir}/diagnosis/docs-diagnosis.json` - 完整诊断结果

## Error Handling

| Error | Recovery |
|-------|----------|
| 文件读取失败 | 记录警告，继续处理其他文件 |
| 正则匹配超时 | 跳过该模式，记录 skipped |
| JSON 解析失败 | 跳过配置对比，仅进行模式检测 |

## Next Actions

- 如果发现 critical 问题 → 优先进入 action-propose-fixes
- 如果无问题 → 继续下一个诊断或 action-generate-report
