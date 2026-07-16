# Analyze Input

## Step 1: Detect Input Mode

```
if input contains: 功能, feature, 清单, list, 测试, test, 完成, done, 验收
  → mode = "test-pipeline"
elif input contains: bug, 错误, 报错, crash, 问题, 不工作, 白屏, 异常
  → mode = "debug-pipeline"
else
  → AskUserQuestion to clarify
```

```
AskUserQuestion({
  questions: [{
    question: "请确认调试模式",
    header: "Mode",
    multiSelect: false,
    options: [
      { label: "功能测试", description: "根据功能清单逐项测试，发现并修复问题" },
      { label: "Bug修复", description: "针对已知Bug进行复现、分析和修复" }
    ]
  }]
})
```

---

## Mode A: Feature Test (test-pipeline)

### Parse Feature List

Extract from user input:

| Field | Source | Required |
|-------|--------|----------|
| base_url | URL in text or AskUserQuestion | Yes |
| features | Feature list (bullet points, numbered list, or free text) | Yes |
| test_depth | User preference or default "standard" | Auto |

Parse features into structured format:
```json
[
  { "id": "F-001", "name": "用户登录", "url": "/login", "description": "..." },
  { "id": "F-002", "name": "数据列表", "url": "/dashboard", "description": "..." }
]
```

If base_url missing:
```
AskUserQuestion({
  questions: [{
    question: "请提供应用的访问地址",
    header: "Base URL",
    multiSelect: false,
    options: [
      { label: "localhost:3000", description: "本地开发服务器" },
      { label: "localhost:5173", description: "Vite默认端口" },
      { label: "Custom", description: "自定义URL" }
    ]
  }]
})
```

### Complexity Scoring (Test Mode)

| Factor | Points |
|--------|--------|
| Per feature | +1 |
| Features > 5 | +2 |
| Features > 10 | +3 |
| Cross-page workflows | +1 |

Results: 1-3 Low, 4-6 Medium, 7+ High

### Output (Test Mode)

```json
{
  "mode": "test-pipeline",
  "base_url": "<url>",
  "features": [
    { "id": "F-001", "name": "<name>", "url": "<path>", "description": "<desc>" }
  ],
  "pipeline_type": "test-pipeline",
  "dependency_graph": {
    "TEST-001": { "role": "tester", "blockedBy": [], "priority": "P0" },
    "ANALYZE-001": { "role": "analyzer", "blockedBy": ["TEST-001"], "priority": "P0", "conditional": true },
    "FIX-001": { "role": "fixer", "blockedBy": ["ANALYZE-001"], "priority": "P0", "conditional": true },
    "VERIFY-001": { "role": "verifier", "blockedBy": ["FIX-001"], "priority": "P0", "conditional": true }
  },
  "roles": [
    { "name": "tester", "prefix": "TEST", "inner_loop": true },
    { "name": "analyzer", "prefix": "ANALYZE", "inner_loop": false },
    { "name": "fixer", "prefix": "FIX", "inner_loop": true },
    { "name": "verifier", "prefix": "VERIFY", "inner_loop": false }
  ],
  "complexity": { "score": 0, "level": "Low|Medium|High" }
}
```

---

## Mode B: Bug Report (debug-pipeline)

### Parse Bug Report

Extract from user input:

| Field | Source | Required |
|-------|--------|----------|
| bug_description | User text | Yes |
| target_url | URL in text or AskUserQuestion | Yes |
| reproduction_steps | Steps in text or AskUserQuestion | Yes |
| expected_behavior | User description | Recommended |
| actual_behavior | User description | Recommended |
| severity | User indication or auto-assess | Auto |

### Debug Dimension Detection

| Keywords | Dimension | Evidence Needed |
|----------|-----------|-----------------|
| 渲染, 样式, 显示, 布局, CSS | UI/Rendering | screenshot, snapshot |
| 请求, API, 接口, 网络, 超时 | Network | network_requests |
| 错误, 报错, 异常, crash | JavaScript Error | console_messages |
| 慢, 卡顿, 性能, 加载 | Performance | performance_trace |
| 状态, 数据, 更新, 不同步 | State Management | console + snapshot |
| 交互, 点击, 输入, 表单 | User Interaction | click/fill + screenshot |

### Complexity Scoring (Debug Mode)

| Factor | Points |
|--------|--------|
| Single dimension (e.g., JS error only) | 1 |
| Multi-dimension (UI + Network) | +1 per extra |
| Intermittent / hard to reproduce | +2 |
| Performance profiling needed | +1 |

Results: 1-2 Low, 3-4 Medium, 5+ High

### Output (Debug Mode)

```json
{
  "mode": "debug-pipeline",
  "bug_description": "<original>",
  "target_url": "<url>",
  "reproduction_steps": ["step 1", "step 2"],
  "dimensions": ["ui_rendering", "javascript_error"],
  "evidence_plan": {
    "screenshot": true, "snapshot": true,
    "console": true, "network": true, "performance": false
  },
  "pipeline_type": "debug-pipeline",
  "dependency_graph": {
    "REPRODUCE-001": { "role": "reproducer", "blockedBy": [], "priority": "P0" },
    "ANALYZE-001": { "role": "analyzer", "blockedBy": ["REPRODUCE-001"], "priority": "P0" },
    "FIX-001": { "role": "fixer", "blockedBy": ["ANALYZE-001"], "priority": "P0" },
    "VERIFY-001": { "role": "verifier", "blockedBy": ["FIX-001"], "priority": "P0" }
  },
  "roles": [
    { "name": "reproducer", "prefix": "REPRODUCE", "inner_loop": false },
    { "name": "analyzer", "prefix": "ANALYZE", "inner_loop": false },
    { "name": "fixer", "prefix": "FIX", "inner_loop": true },
    { "name": "verifier", "prefix": "VERIFY", "inner_loop": false }
  ],
  "complexity": { "score": 0, "level": "Low|Medium|High" }
}
```
