# Maestro Hooks 分析：有真实的阻断机制，但火力点指错了方向

> 触发：对照 harness-cli 的"确定性面"讨论(R8/触发率)后，复查 Maestro 自己的 hook 系统。基于最新上游(已 fetch `origin/master` + 优化分支 `fix/global-spec-injection` / `codex/kg-*`)。
> 关联：诊断文档 `guide/maestro-workflow-diagnosis.md`(R7 不可执行不变量 / R8 知识 fail-open / R10 监控盲)。

---

## 0. 结论先行

Maestro 的 hook 系统**比 harness-cli 更完整**——有真实阻断(`process.exit(2)`)、tapable 引擎、5 类事件、多个 guard。但：

> **它的阻断火力几乎全指向"危险 shell 命令",而不指向"工作流/知识保真"。** 后者的 guard(写边界 / spec 合规 / 先查知识)**代码都在,却默认 advisory / 关闭 / 因省略参数而成死代码**。

所以——回答"hooks 有没有问题":**hooks 没有提供 R8 需要的"知识/边界强制面"。它强制的是"别 `rm -rf /`",不是"先查 KG / 守 boundary / 用 spec"。** Maestro 不缺 hook 基础设施,缺的是把高价值 guard 拨到 block。

---

## 1. 先给信用(确实比 harness 强的地方)

- **真实阻断**：`AsyncSeriesBailHook`(`hook-engine.ts:52-66`,handler 返回非 undefined 即 bail)+ runner `decision:'block'` + `process.exit(2)`(`hooks.ts:817/855/1022/1041`)。Claude Code exit-2 = 拦截工具调用。
- **默认装满**：`opts.level ?? 'full'`(`hooks.ts:1290`)——默认 full level,guards 都装上。
- **workflow-guard 默认拦真危险操作**：`rm -rf /`、`git push --force`、`git reset --hard`、`drop table`、`chmod 777`…(`workflow-guard.ts:10-19`)→ 真 block(`hooks.ts:1022`)。
- **干净引擎**：tapable 风格 4 种 hook + 纯函数 evaluator(可测,`__tests__` 覆盖充分)。
- **5 类事件**：PreToolUse / PostToolUse / UserPromptSubmit / SessionStart / Stop。
- **正在优化(方向对)**：`fix/global-spec-injection` 删 ~1324 行,移除冗余注入器(`kg-context-injector` / `kg-sync-hook` / `kg-auto-init` / `context-format`),并让 spec 注入"全局化"(脱离 workspace 门控)。

---

## 2. 问题清单

### H1 —— 4 个 guard 里只有 1 个默认真阻断,其余 advisory / 关闭 / 死代码

| Guard | 事件 / 匹配 | 默认行为 | 证据 |
|---|---|---|---|
| workflow-guard（危险命令） | PreToolUse | **BLOCK ✓** | `hooks.ts:1022` exit(2) |
| workflow-guard PathGuard（写边界） | PreToolUse Write/Edit | **关闭**（`enabled:false`）+ 需 workspace | `workflow-guard.ts:36` |
| preflight-guard（队友冲突） | PreToolUse Bash/Write/Edit/Agent | **warn**（advisory，never throws） | `preflight-guard.ts:43` `mode:'warn'` |
| prompt-guard（注入检测） | UserPromptSubmit | **只警告，永不阻断**（把 warning 拼进 prompt） | `prompt-guard.ts:45,58` |
| spec-validator（spec 格式） | PreToolUse Write/Edit | **warn**，且 block 路径不可达 | `spec-validator.ts:38` + `hooks.ts`（见 H2） |

→ 真正能把"工作流/知识保真"变确定性的几个（**写边界 = R3 的 `boundary_contract.out_of_scope` 强制**、spec 合规、先查知识）**全都不阻断**。R3 我们想要的 out-of-scope 强制（PathGuard）**代码已存在,却默认关闭 + workspace 门控**。

### H2 —— spec-validator 的 block 路径不可达 + Edit 旁路

- runner 调 `evaluateSpecValidator(filePath, content)` **只传 2 个参数**（`hooks.ts` spec-validator runner），`mode` 永远默认 `'warn'`（`spec-validator.ts:38`）→ `result.mode==='block'` 恒假 → `exit(2)` 是**死代码**。除非用户改 `.workflow/config.json`，否则 spec 格式错误**永远只警告**。
- `if (!content) return`（runner）→ **Edit 工具**（无 full content）**直接跳过校验**。用 Edit 改 spec 文件 = 完全绕过 spec-validator。

### H3 —— 注入 ≠ 调用：hooks 大多在"软注入",正是 harness-cli 抛弃的路线

- 多数 hook 是 **injector**（spec-injector / keyword-spec-injector / kg-context-injector / kg-unified-injector / skill-context / session-context）：把文本**拼进 prompt（soft）**，agent 可以无视。
- 对照上一轮 harness 结论：harness **有意砍掉 auto-injection**（`contextdb-autopilot:20` "no longer a prompt-injection layer"），因为注入 = token 膨胀 + **重放漂移（=R5）**；改"确定性面 + 显式检索"。
- Maestro 的 hooks **仍重注入、轻阻断**,且阻断只管危险命令。**这是 hooks 的根本定位问题**：要拿它当 R8 的确定性面,就得把高价值 guard 从 warn→block,而不是再加注入器。

### H4 —— 静默 fail-open,监控看不见（接 R10）

- 满地 `catch {}` 返回默认值（`hooks.ts:246/265/338"best-effort"/426/467/664/695`；`workflow-guard.ts:56`；`preflight-guard.ts:67/127`）：配置损坏、KG 出错、文件缺失 → hook **静默 no-op,无可见信号**。
- **500ms stdin 读超时**（`hooks.ts:759` `setTimeout(()=>resolve(input),500)`）：大 payload / 慢 KG 时,注入器可能拿到**部分/空输入**就继续,静默降级——你想注入的知识没注入,而你不会知道。
- 接 R10：hook 跳过 / 超时 / 空注入**不落 `status.json`、dashboard 看不见**——又一处"失败不可观测"。harness 反例:它强制 metrics 落 `.aios/interception/metrics/*.jsonl`(`saved_bytes`/`saving_ratio`)。

### H5 —— requiresWorkspace 门控 → 未初始化项目 hooks 全哑（ANT-1-3 的根,部分在修）

- `spec-injector` / `preflight-guard` / `spec-validator` / `skill-context` / `kg-*` / workflow-guard 的 PathGuard 全 `requiresWorkspace:true`（`hooks.ts:79-95`）。**无 `.workflow/` = 不触发**（本仓库实测无 `.workflow/`，ANT-1-3 已证）。
- `fix/global-spec-injection` 正把 spec 注入**全局化**(对)，但 **KG / skill-context / guards 仍 workspace 门控**。

### H6 —— 注入器冗余（部分在修）

- **6 个重叠注入器**：`spec-injector` / `keyword-spec-injector` / `spec-injection-plugin` / `kg-context-injector` / `kg-unified-injector` / `kg-unified-injector-agent`（`hooks.ts:79-93`）。命名出现 `unified` 说明做过一次合并,但旧的仍并存——R6/R9 重复模式在 hook 层重演。
- `fix/global-spec-injection` 删了 3 个(`kg-context-injector` / `kg-sync-hook` / `kg-auto-init`)——好的收敛,但**未落 master**,且 `kg-unified-*` 与其余仍需统一。

---

## 3. 与 R7 / R8 的关系 + 建议

**核心判断**：hooks 是 Maestro 已有的、**最接近"确定性强制面"的资产**——比 harness 的单个 rewrite hook 更强(有 exit-2 阻断)。问题不是"没有 hooks",而是 **火力点指向危险命令、而非工作流/知识保真,且保真 guard 默认 advisory / 关 / 死**。这恰好是 R7(不变量只写散文)和 R8(知识 fail-open)在 hook 层的具体表现:**强制机制在,只是没指向该指的地方,也没拨到 block**。

**借鉴 harness 的落地(在已有 hooks 上改,成本低):**
1. **把高价值 guard 默认 warn→block**：
   - PathGuard 默认开 = R3 的 `boundary_contract.out_of_scope` 强制(把 boundary 从散文变成 exit-2)。
   - spec-validator runner 传 `mode`(让 block 路径可达)+ 修 Edit 旁路。
2. **新增"知识/搜索保真" PreToolUse guard**：编辑前若当前阶段未触发 KG/search → **挡**(= R8 的确定性面,正好接上一轮 R7 借鉴的 pre-edit gate;Maestro 已有 KG,缺的就是这道门)。
3. **fail-LOUD**：hook 跳过 / 超时 / 空注入要落一条可见信号(`status.json` + dashboard),别静默(治 R10)——抄 harness 的 metrics 落盘。
4. **继续 `fix/global-spec-injection` 的合并 + 注入器收敛**(H6),并把"全局化"推广到 KG/skill-context。

**一句话**：Maestro 不缺 hook 引擎,缺的是**把已有的阻断火力,从"危险命令"重新瞄准到"工作流/知识保真",并把保真 guard 从 advisory 拨到 block + fail-loud**。这是把 R7/R8 从"散文"变"运行时门"成本最低的一条路。
