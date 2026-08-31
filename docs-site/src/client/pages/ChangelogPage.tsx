import { useI18n } from '@/client/i18n/index.js';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// ChangelogPage — version history with recent releases
// ---------------------------------------------------------------------------

interface ChangelogEntry {
  version: string;
  date: string;
  changes: Array<{
    type: 'feat' | 'fix' | 'refactor' | 'chore' | 'docs';
    text_en: string;
    text_zh: string;
  }>;
}

const changelog: ChangelogEntry[] = [
  {
    version: '0.5.83',
    date: '2026-08',
    changes: [
      { type: 'feat', text_en: 'Search daemon moves to an authenticated protocol v2: the daemon descriptor becomes a per-process identity (instanceId + protocol tag) instead of a bare PID, so stale or foreign descriptors are never trusted for search or shutdown and only the owning process may delete its descriptor; requests/responses are bounded (64 KiB in / 16 MiB out, 4096-char queries, 500 results) and the daemon drains gracefully instead of dying mid-request. Wiki indexer and embedding stores are hardened with ownership-checked cleanup, spawn locking, and a much wider test surface across dashboard workspace and search', text_zh: '搜索守护进程升级为带认证的 protocol v2：守护进程描述符从裸 PID 变为逐进程身份（instanceId + 协议标签），陈旧或外来描述符不再被信任用于搜索或关闭，且只有属主进程可删除其描述符；请求/响应有界（入 64 KiB / 出 16 MiB、4096 字符查询、500 条结果），守护进程优雅排空而非请求中猝死。Wiki 索引器与 embedding 存储加固：所有权校验清理、spawn 锁、dashboard workspace 与 search 测试面大幅扩展' },
      { type: 'fix', text_en: 'Legacy SQLite artifact family is bounded: an oversized active WAL is refused before the legacy migration path opens the database, and better-sqlite3 unavailability is guarded in tests so the migration path degrades predictably instead of reading a corrupted artifact', text_zh: '遗留 SQLite 产物族被约束：legacy 迁移路径打开数据库前先拒绝过大的活动 WAL，并在测试中防护 better-sqlite3 不可用，使迁移路径可预测地降级而非读取损坏产物' },
      { type: 'fix', text_en: 'Wiki index refreshes regain cold-build speed and hermetic release probes while preserving warm-cache correctness: bounded synchronous snapshots reduce Windows latency, negative source sentinels detect newly created optional files/directories, and transient gate cleanup handles are retried', text_zh: 'Wiki 索引刷新同时恢复冷构建性能、发布探针隔离性与暖缓存正确性：有界同步快照降低 Windows 延迟，缺失源哨兵可检测后创建的可选文件/目录，门禁清理中的瞬时句柄占用会安全重试' },
      { type: 'fix', text_en: 'Kimi Code CLI installs now target the current .kimi-code config directory instead of the outdated .kimi-code-cli, across component definitions, the interactive install UI, the install guide, and reinstall tests', text_zh: 'Kimi Code CLI 安装现指向当前 .kimi-code 配置目录而非过时的 .kimi-code-cli，覆盖组件定义、交互式安装 UI、安装指南与重装测试' },
      { type: 'refactor', text_en: 'maestro-impeccable is rewritten as a thin Maestro adapter over the installed Impeccable skill: Impeccable owns design semantics, setup, routing, references, detector behavior and bounded verification, while Maestro adds the canonical Session/Run lifecycle, progress tracking, consistent status presentation, and the optional --codify extension loaded phase-wise; the copied command routing/chain tables are retired', text_zh: 'maestro-impeccable 重写为基于已安装 Impeccable skill 的薄适配器：Impeccable 负责设计语义、设置、路由、引用、检测器行为与有界验证，Maestro 提供规范 Session/Run 生命周期、进度跟踪、一致的状态呈现与按阶段加载的可选 --codify 扩展；复制的命令路由/链表退役' },
    ],
  },
  {
    version: '0.5.82',
    date: '2026-08',
    changes: [
      { type: 'feat', text_en: 'Plan publish now runs as a v3 producer Run over session/3.0 + run/3.0: the plan command opens a Session with an inline chain step and publishes the plan through the canonical run-v3 lifecycle, so plan authorship is recorded with the same authority, identity and recovery semantics as any other Run — Execution-era lease and legacy v2 paths are rejected at the coordinator fence', text_zh: 'Plan publish 现作为 v3 生产者 Run 运行于 session/3.0 + run/3.0：plan 命令开启带内联 chain step 的 Session 并通过规范 run-v3 生命周期发布计划，使计划撰写与任意其他 Run 享有相同的权威、身份与恢复语义——Execution 时代 lease 与 legacy v2 路径在 coordinator 栅栏处被拒绝' },
      { type: 'refactor', text_en: 'Hook errors and warnings are centralized into a never-throwing JSONL sink at ~/.maestro/logs/hooks-error.log (with rotation and MAESTRO_DEBUG echo), replacing ad-hoc console.error/stderr writes across kg-sync, kg-auto-init, team-monitor and wiki-role-loader; the statusline renders a ⚠N alert segment for unread hook errors so failures surface instead of being lost in stderr noise', text_zh: 'Hook 错误与告警集中到 ~/.maestro/logs/hooks-error.log 的 never-throwing JSONL 接收器（带轮转与 MAESTRO_DEBUG 回显），取代 kg-sync、kg-auto-init、team-monitor 与 wiki-role-loader 中零散的 console.error/stderr 写入；statusline 渲染 ⚠N 告警段以呈现未读 hook 错误，使失败不再湮没于 stderr 噪音' },
      { type: 'refactor', text_en: 'MCP tool access is enforced through a single immutable policy snapshot shared by ListTools and CallTool: discovery and execution reference the same allow-list, so a hidden-but-registered tool can no longer be invoked by guessing its name — an unauthorized CallTool returns an isError response without invoking the handler', text_zh: 'MCP 工具访问通过 ListTools 与 CallTool 共享的单一不可变策略快照强制执行：发现与执行引用同一 allow-list，已注册但未列出的工具无法靠猜名调用——未授权 CallTool 返回 isError 响应且不触发处理器' },
      { type: 'refactor', text_en: 'Manifest cleanup now treats markers as proof of section ownership rather than file ownership: a mixed user+Maestro file whose content drifted after install has its Maestro sections removed while all user content outside the markers is preserved, instead of being wholesale preserved and leaving stale Maestro content behind', text_zh: 'Manifest 清理现将 marker 视作 section 所有权证明而非整文件所有权：安装后被用户改动过的混合文件会移除其 Maestro section 同时保留 marker 之外的全部用户内容，而非整文件保留并残留陈旧 Maestro 内容' },
      { type: 'fix', text_en: 'The packaged-install release-machine smoke gate now passes --session to the v3 chain insert step, matching the other steps in the chain: the orchestration mutation options declare --session as required, so the gate was failing deterministically at option parsing instead of exercising the real v3 path', text_zh: 'packaged-install 发布机器 smoke 门禁现向 v3 chain insert 步骤传入 --session，与链中其他步骤一致：orchestration 变更选项将 --session 声明为必填，门禁此前在选项解析处确定性失败，而非真正走 v3 路径' },
    ],
  },
  {
    version: '0.5.81',
    date: '2026-08',
    changes: [
      { type: 'refactor', text_en: 'Session/3.0 surface closed around Execution-era residue: participant=actor identity is now enforced on lifecycle mutations, chain update and structured continuation commands are added, and the Execution-era surface is removed from the canonical command graph', text_zh: 'Session/3.0 界面围绕 Execution 时代残留收口：生命周期变更强制 participant=actor 身份一致，新增 chain update 与结构化 continuation 命令，并从规范命令图中移除 Execution 时代界面' },
      { type: 'fix', text_en: 'run-v3 decision gates now route before chain continuation, so a pending decision is resolved before the chain advances instead of being skipped; recovery mutations and return continuations are fenced so a failed or recovering Run no longer mutates state outside its owned step', text_zh: 'run-v3 决策门现在先于 chain continuation 路由，待决策在 chain 推进前被解析而非被跳过；recovery 变更与返回 continuation 被加栅，失败或恢复中的 Run 不再越权修改其所属步骤之外的状态' },
      { type: 'fix', text_en: 'v3 CLI run errors are normalized with stable migration guidance, so legacy commands report a single actionable error with the canonical replacement instead of ambiguous failure modes', text_zh: 'v3 CLI run 错误被归一化并附带稳定迁移指引，旧命令以单一可执行错误报告规范替换，而非模糊的失败模式' },
      { type: 'fix', text_en: 'maestro-next now infers lifecycle from canonical Session state, so the router reads the authoritative session entity instead of heuristic or stale signals to decide the next execution channel', text_zh: 'maestro-next 现从规范 Session 状态推断生命周期，路由器读取权威 session 实体而非启发式或陈旧信号来决定下一个执行通道' },
      { type: 'chore', text_en: 'session-run prompt-semantics fixtures are bounded in runtime, and v3-cli / chain-mutations / continuation-v3 / decide-v3 / mutation-engine tests are expanded to cover the new chain-update, structured-continuation, decision-gate routing, and recovery-fence paths', text_zh: 'session-run prompt 语义 fixture 运行时被限定；v3-cli / chain-mutations / continuation-v3 / decide-v3 / mutation-engine 测试扩展覆盖新增的 chain-update、结构化 continuation、决策门路由与 recovery 栅栏路径' },
    ],
  },
  {
    version: '0.5.80',
    date: '2026-08',
    changes: [
      { type: 'feat', text_en: 'Search now surfaces bundled Arch-KB architecture templates as reference results: mixed-fusion search gains a template provider backed by the packaged arch-kb index (no project-index writes), with a new virtual template type filter; results carry scored entries from the bundled architecture knowledge base', text_zh: '搜索现将内置 Arch-KB 架构模板作为参考结果呈现：mixed-fusion 搜索新增由打包 arch-kb 索引驱动的 template 提供方（不写项目索引），并新增虚拟 template 类型过滤器；结果携带内置架构知识库的评分条目' },
      { type: 'fix', text_en: 'Arch-KB integration hardened after multi-agent review: direct-match detection reuses the scorer tokenizer with substring/superstring semantics so plural/punctuation queries are no longer dropped after scoring; the hermetic built-ranking gate injects an empty archKbSearch stub so bundled templates never leak into the baseline; merged search results substitute the real query instead of a literal placeholder; a missing index is no longer negative-cached so long-lived processes recover once it appears; the development-query regex gains ASCII word boundaries; equal-score ties break deterministically by entry id', text_zh: 'Arch-KB 集成经多智能体评审加固：直接匹配检测复用评分器 tokenizer 并镜像其子串/超串语义，复数/标点查询不再在评分后被丢弃；密闭 built-ranking 门禁注入空 archKbSearch stub，内置模板不再泄漏进基线；合并结果以真实查询替换字面占位符；缺失索引不再被负缓存，长生命周期进程可在索引出现后自愈；开发查询正则增加 ASCII 词边界；同分并列按条目 id 确定性排序' },
      { type: 'feat', text_en: 'Knowledge-graph explore gains ported codegraph capabilities: multiplicative relevance-scoring demotion levers (KIND / ISOLATION / PENALTY) opt-in via RelevanceContext with legacy computeScore behaviour unchanged, plus score-proportional byte-budget allocation for explore output — the render loop spends reservations with carry-forward and a displacement guard, calibrated to Maestro\'s ~6K-12K envelope', text_zh: '知识图谱 explore 引入移植的 codegraph 能力：乘法相关性降权杠杆（KIND / ISOLATION / PENALTY）经 RelevanceContext 可选启用且 legacy computeScore 行为不变；explore 输出改为按分数比例的字节预算分配——渲染循环带结转与置换保护地消耗预留额度，按 Maestro 约 6K-12K 包络校准' },
      { type: 'chore', text_en: 'Retired maestro-session-seal references replaced by maestro-session-manage --complete across workflows and maestro-help phases/catalog; maestro-session-manage skill/command sources added (.claude/.codex) and guide docs refreshed', text_zh: 'workflows 与 maestro-help 阶段/目录中退役的 maestro-session-seal 引用替换为 maestro-session-manage --complete；新增 maestro-session-manage skill/命令源（.claude/.codex）并刷新指南文档' },
    ],
  },
  {
    version: '0.5.79',
    date: '2026-08',
    changes: [
      { type: 'fix', text_en: 'On Windows, every detached background spawn whose parent chain has no attached console (GUI hosts like Orca, VS Code extensions, or detached terminal daemons) made a new CMD console window flash for the few hundred milliseconds the child ran. Added windowsHide: true (CREATE_NO_WINDOW) to the 6 detached:true spawns that were missing it (search daemon lazy-start and respawn, detached CLI agent worker, detached delegate worker, visualizer server, impeccable live --background), bringing them in line with the already-guarded kg-sync-hook spawn. POSIX ignores the flag, so behavior on macOS/Linux is unchanged.', text_zh: '在 Windows 上，每个 detached 后台 spawn 当其父进程链没有附加控制台（如 Orca、VS Code 扩展或 detached 终端守护进程等 GUI 宿主）时，会弹出一个新的 CMD 控制台窗口并在子进程运行的几百毫秒内闪烁。为 6 个此前缺失该设置的 detached:true spawn（search daemon 懒启动与重启、detached CLI agent worker、detached delegate worker、可视化服务器、impeccable live --background）补上 windowsHide: true（CREATE_NO_WINDOW），与已有该保护的 kg-sync-hook spawn 保持一致。POSIX 忽略该标志，macOS/Linux 行为不变。' },
    ],
  },
  {
    version: '0.5.78',
    date: '2026-08',
    changes: [
      { type: 'feat', text_en: 'New read-only Odyssey defensive mode (--mode defensive): business-anchor driven + backward slice + bidirectional propagation risk audit, with the S_INTAKE → S_ANCHOR → S_SLICE → S_SCAN → S_PROPAGATE → S_REPORT → shared back-half state chain (no S_FIX/S_CONFIRM). Scans 8 defensive patterns (broad catch / exception swallow / default / null fallback / clamp / silent convert / duplicate constraint / duplicate default), classifies exceptions A/B/C/D, scores risk R = S × P × B × H, and emits a §14 standard severity-matrix report (DEF-NNN with full propagation chain); findings route to --mode improve (fix) or --mode debug (root cause). Tiers quick/standard/deep and --sink-depth 1|2|3|all control scope', text_zh: '新增只读 Odyssey 防御性模式（--mode defensive）：以业务关键结果为锚点 + 反向切片 + 双向传播的风险审查，状态链 S_INTAKE → S_ANCHOR → S_SLICE → S_SCAN → S_PROPAGATE → S_REPORT → 共享后半段（无 S_FIX/S_CONFIRM）。扫描 8 类防御模式（宽泛捕获 / 异常吞噬 / 默认值 / 空值兜底 / clamp / 静默转换 / 重复约束 / 默认配置重复），进行 A/B/C/D 异常分类，风险评分 R = S × P × B × H，输出 §14 标准 severity matrix 报告（DEF-NNN 含完整传播链）；findings 路由到 --mode improve（修复）或 --mode debug（根因）。tier quick/standard/deep 与 --sink-depth 1|2|3|all 控制范围' },
      { type: 'fix', text_en: 'Knowledge-graph call edges are now attributed to the enclosing function instead of the file node, so per-function callers/callees/impact traversal (backward slicing, forward-propagation radius) works for the defensive audit and any per-function impact analysis; module-level calls without an enclosing function still fall back to the file node', text_zh: '知识图谱 call 边现归属到外层函数而非文件节点，使 per-function callers/callees/impact 遍历（反向切片、正向传播半径）可用于防御性审查与任意 per-function 影响分析；无外层函数的模块级调用仍回退到文件节点' },
      { type: 'fix', text_en: 'Knowledge stage (session source) now prints a run-less next-step card covering the review presentation protocol, supersede/conflict entry maintenance and evidence-freshness timing; knowledge promote errors hint the --as unique + maestro spec supersede <old> --by <new> fallback, and promote success prints the spec-supersede evolution chain when replacing an entry', text_zh: 'knowledge stage（session source）现打印无需 Run 的 next-step 提示卡，覆盖 review 展示协议、supersede/conflict 条目维护与 evidence-freshness 时序；knowledge promote 报错提示 --as unique + maestro spec supersede <old> --by <new> 回退路径，替换既有条目时 promote 成功输出 spec-supersede 演进链' },
      { type: 'fix', text_en: 'Knowledge-graph auto-init reliability and performance: the non-re-entrant FileLock that deadlocked init+sync (auto-init hung ~30s then failed, leaving a created-but-unsynced DB) now wraps only MaestroGraph.init() while sync runs under its own lock, so auto-init completes in ~470ms; leaked DB files blocking future auto-init, concurrent-init FTS corruption, writer-blocking wal_checkpoint(TRUNCATE) on every close, and excess cache_size heap are fixed', text_zh: '知识图谱 auto-init 可靠性与性能：原先把 init+sync 包在同一不可重入 FileLock 中导致死锁（auto-init 挂起约 30s 后失败并残留已创建未同步的 DB），现仅锁定 MaestroGraph.init()，sync 在其自身锁下执行，auto-init 约 470ms 完成；另修复阻碍后续 auto-init 的泄漏 DB 文件、并发 init 的 FTS 损坏、每次 close 都阻塞写入的 wal_checkpoint(TRUNCATE) 与过大的 cache_size 堆占用' },
      { type: 'refactor', text_en: 'Workflow knowledge-governance prompt sections slimmed: Run Knowledge Invariants compressed 7 → 5 rules and Governance Boundary folded to one bullet, with command syntax, presentation protocol detail and error-branch guidance now injected at runtime (stage card, promote hints, review next/resolve lines) instead of per-session static text across the claude/codex/agy mirrors', text_zh: 'Workflow 知识治理提示段精简：Run Knowledge Invariants 由 7 条压缩为 5 条、Governance Boundary 合并为一项，命令语法、展示协议细节与错误分支指引改由运行时注入（stage 提示卡、promote 提示、review next/resolve 行），不再按 session 写死静态文本，已应用到 claude/codex/agy 三处镜像' },
    ],
  },
  {
    version: '0.5.77',
    date: '2026-08',
    changes: [
      { type: 'refactor', text_en: 'Workflow entrypoints no longer create a Session or Run merely to load an execution document; issue, knowhow, knowledge, and spec commands now invoke their direct workflow documents while preserving explicit lifecycle commands where required', text_zh: 'Workflow 入口不再仅为加载执行文档创建 Session 或 Run；issue、knowhow、knowledge 与 spec 命令现在直接调用对应 workflow 文档，同时保留必须使用的显式生命周期命令' },
      { type: 'fix', text_en: 'Remove retired session-mode and run-mode wrapper declarations from workflow documents, keeping command routing aligned with the current session/3.0 surface', text_zh: '移除 workflow 文档中已退役的 session-mode 与 run-mode 包装声明，使命令路由与当前 session/3.0 面保持一致' },
      { type: 'docs', text_en: 'Synchronize Codex skill mirrors, command reference text, workflow guidance, and the brainstorm visualizer command with the direct-document invocation model', text_zh: '同步 Codex skill 镜像、命令参考文档、workflow 指引与 brainstorm 可视化命令，使其符合直接调用文档的模型' },
    ],
  },
  {
    version: '0.5.76',
    date: '2026-08',
    changes: [
      { type: 'feat', text_en: 'Per-candidate reconciliation fence: session-source candidates with missing or drifted immutable evidence are recorded as blocked, remain visible in review, and are skipped by promote --all without preventing healthy candidates from being promoted', text_zh: '逐候选 reconciliation 隔离：缺失或漂移不可变证据的 session-source 候选会标记为 blocked、继续显示在 review 中，并由 promote --all 跳过，不再阻断健康候选的 promotion' },
      { type: 'fix', text_en: 'Statusless session/2.0 knowledge writes are transactional: reconciliation, inline resolution, and mixed Run/Session-origin promotion update sidecars atomically while keeping session.json byte-stable and closing the receipt-refresh TOCTOU window', text_zh: '无状态 session/2.0 知识写入事务化：reconciliation、inline resolution 与 Run/Session 混合来源 promotion 原子更新 sidecar，同时保持 session.json 字节稳定并关闭 receipt refresh 的 TOCTOU 窗口' },
      { type: 'fix', text_en: 'Canonical v3 authority is fail-closed: retained legacy Execution storage cannot be read as v3 authority, transcript evidence snapshots use the restricted v3 knowledge transaction, and legacy governance waits for the open Execution to be sealed', text_zh: '规范 v3 权威 fail-closed：遗留 Execution 存储不可作为 v3 权威读取，transcript evidence 快照通过受限 v3 knowledge transaction 写入，legacy governance 会等待 open Execution seal 后再执行' },
      { type: 'fix', text_en: 'Source-only lifecycle execution no longer depends on a pre-existing dist worker: when TypeScript sources are being tested before build, the bridge uses the source lifecycle implementation; packaged and built runs continue to use the colocated worker module', text_zh: 'source-only lifecycle 执行不再依赖预先存在的 dist worker：在 build 前测试 TypeScript 源码时 bridge 使用 source lifecycle 实现；打包与 built 运行仍使用 colocated worker 模块' },
      { type: 'fix', text_en: 'Dashboard source ranking tests resolve #maestro-dashboard and #async imports against TypeScript sources before build; compiled runtime package exports remain unchanged', text_zh: 'dashboard source ranking 测试在 build 前将 #maestro-dashboard 与 #async 导入解析到 TypeScript 源码；编译运行时的 package exports 保持不变' },
      { type: 'refactor', text_en: 'Blocked diagnostics no longer participate in receipt freshness commitments, preventing platform/path wording drift from staling unrelated healthy candidates; release-machine focused proofs use explicit 30-second test and hook limits, and source-only certification excludes full-phase generated artifacts in fresh checkouts', text_zh: 'blocked 诊断文案不再参与 receipt freshness 承诺，避免平台/路径文案漂移使无关健康候选变 stale；release-machine 定向证明显式使用 30 秒 test 与 hook 上限，source-only 认证在 fresh checkout 中排除 full-phase 生成产物' },
    ],
  },
  {
    version: '0.5.75',
    date: '2026-08',
    changes: [
      { type: 'feat', text_en: 'Knowledge candidate fingerprints: run complete candidates get a stable Run-scoped identity (runKnowledgeCandidateSnapshotHash) shared by reconciliation and v3 promotion recovery — frontmatter candidates shadow no already-staged candidate with the same deterministic ID, exactly matching the review projection; SessionV30KnowledgeStoreTransaction exposes v3 knowledge mutations through the store transaction surface', text_zh: '知识候选指纹：run complete 候选获得稳定的 Run 域身份（runKnowledgeCandidateSnapshotHash），由 reconciliation 与 v3 promotion recovery 共享——frontmatter 候选不再遮蔽带相同确定性 ID 的已 stage 候选，与 review 投影完全一致；SessionV30KnowledgeStoreTransaction 在 store 事务面上暴露 v3 知识变更' },
      { type: 'feat', text_en: 'Knowledge attribution authority: run knowledge-identity resolves the explicit attribution authority (findKnowledgeAttributionAuthority / findSessionAttributionTarget) for manual sources and search attribution on the active Run', text_zh: '知识归属权威：run knowledge-identity 解析显式归属权威（findKnowledgeAttributionAuthority / findSessionAttributionTarget），支持 manual source 与 active Run 的 search attribution' },
      { type: 'feat', text_en: 'Skill context exposes the formal knowledge-governance policy surface: search/injection = exposure-only, explicit-load = consumed, record = explicit-attribution, completion = stage-candidates, promotion = explicit-review', text_zh: 'skill 上下文暴露正式知识治理策略面：search/injection = exposure-only、explicit-load = consumed、record = explicit-attribution、completion = stage-candidates、promotion = explicit-review' },
      { type: 'feat', text_en: 'Installer prune restore-point: files an upgrade reinstall would remove are first preserved to a backup (pruneBackupPath / obsoleteFilesPreserved) so obsolete pruning is reversible; manifest and tag-injector hardened', text_zh: '安装器剪枝还原点：升级重装前先将待移除文件备份（pruneBackupPath / obsoleteFilesPreserved），使废弃剪枝可回滚；manifest 与 tag-injector 加固' },
      { type: 'feat', text_en: 'Dashboard wiki adapters map Session/Run records into wiki status entries for the virtual wiki surface; wiki-indexer fixes; maestro-sidebar workflow.rs integration updated', text_zh: '仪表盘 wiki 适配器将 Session/Run 记录映射为虚拟 wiki 面的状态条目；wiki-indexer 修复；maestro-sidebar workflow.rs 集成更新' },
      { type: 'refactor', text_en: 'Release-machine source-phase certifier gains async npm child spawn (runNpmChildAsync) for streaming runners with bounded concurrency; session-run contract parity expectations updated to the new runner shape', text_zh: 'release-machine source 阶段认证器新增异步 npm 子进程（runNpmChildAsync），支持有界并发的流式 runner；session-run 合同对等期望同步新 runner 形态' },
      { type: 'refactor', text_en: 'reconcile.ts and atomic-write hardened for fingerprint-stable candidate content: NFKC-normalized snapshot text, deterministic candidate identity, sha256-stable atomic writes', text_zh: 'reconcile.ts 与 atomic-write 为指纹稳定的候选内容加固：NFKC 归一化快照文本、确定性候选身份、sha256 稳定原子写' },
    ],
  },
  {
    version: '0.5.74',
    date: '2026-08',
    changes: [
      { type: 'fix', text_en: 'Migration deadlock removed: session migrate --to-v3 accepts running Runs (projected run/3.0 running, active run bound) and orphaned running/failed steps project as pending; the v3 face can resume and complete in-flight work. E2E: running Run → migrate → run brief → run complete --advance → session complete', text_zh: '迁移死锁消除：session migrate --to-v3 接受 running Run（投影为 run/3.0 running，active run 绑定）与 orphaned running/failed step（投影 pending）；v3 面可继续完成在途工作。E2E：running Run → migrate → run brief → run complete --advance → session complete' },
      { type: 'fix', text_en: 'knowledge stage works against session/3.0: the knowledge sidecar opens the v3 branch for staging; artifact evidence roots resolve from session.artifacts_ref through the registry', text_zh: 'knowledge stage 支持 session/3.0：knowledge sidecar 打开 v3 分支供 stage；artifact 证据根从 session.artifacts_ref 经 registry 解析' },
      { type: 'fix', text_en: 'CAS fence is derived from the explicit --session target (not a stale state.json active); session unarchive is a v3 orchestration target; publishPlanV3 replays open/insert as idempotent with stable request ids', text_zh: 'CAS fence 从显式 --session 目标派生（不再依赖 stale state.json active）；session unarchive 成为 v3 orchestration target；publishPlanV3 的 open/insert 重放幂等（稳定 request-id）' },
      { type: 'fix', text_en: 'Execution selection prefers the unique non-sealed Execution; a stale sealed current_execution_id no longer hides the open chain; v2 residue removed from run-executor/skill-iter-tune/maestro-help canonical sources and the Codex conversion profile', text_zh: 'Execution 选择优先唯一 non-sealed Execution；stale sealed current_execution_id 不再隐藏 open chain；run-executor/skill-iter-tune/maestro-help 规范源与 Codex 转换配置的 v2 残留清零' },
      { type: 'chore', text_en: 'Prepublish gates: skill-surface check (123 invocations cross-validated + v3 knowledge-stage smoke), packaged-install isolated-HOME smoke, legacy multi-generation migration and compaction-reattach tests', text_zh: '发布门禁补强：skill-surface 检查（123 处命令调用交叉验证 + v3 knowledge-stage 冒烟）、packaged-install 隔离 HOME 冒烟、legacy 多代迁移与 compaction-reattach 测试' },
    ],
  },
  {
    version: '0.5.73',
    date: '2026-08',
    changes: [
      { type: 'feat', text_en: 'Canonical v3 convergence: session/3.0 becomes the default workspace writer with the six-key capability set; run next emits a full birth packet (run_dir/step_id/upstream/guidance/knowledge_context/brief.command/run_already_created); run brief returns a brief-result/3.0 Resume Packet with orchestration_revision and a suggest-only next hint; replays return the identical packet via the persisted receipt', text_zh: 'Canonical v3 收敛：session/3.0 成为默认 workspace writer（六键能力集）；run next 输出完整 birth packet（run_dir/step_id/upstream/guidance/knowledge_context/brief.command/run_already_created）；run brief 返回 brief-result/3.0 Resume Packet（含 orchestration_revision 与 suggest-only next hint）；同 request 重放经持久化 receipt 返回相同 packet' },
      { type: 'refactor', text_en: 'Canonical prompts, gates and mirrors v3-ified: run-mode/orchestrator-run-loop/run-mode-lite/ralph/prepare/* and all .claude/.agents/.codex/.agy mirrors describe the session/3.0 + run/3.0 surface with the six-key capability gate; v2 content moved into labeled Legacy branches; gate scripts enforce v3 tokens and the new default writer; existing workspaces keep their stored writer (legacy escape hatch: config session-schema set session/1.3|2.0)', text_zh: 'Canonical 文档/门禁/镜像 v3 化：run-mode/orchestrator-run-loop/run-mode-lite/ralph/prepare/* 及全部 .claude/.agents/.codex/.agy 镜像改用 session/3.0 + run/3.0 面与六键能力门；v2 内容移入带标签的 Legacy 分支；门禁脚本强制执行 v3 token 与新默认 writer；既有 workspace 保留已存 writer（legacy 逃生口：config session-schema set session/1.3|2.0）' },
    ],
  },
  {
    version: '0.5.72',
    date: '2026-08',
    changes: [
      { type: 'fix', text_en: 'Atomic knowledge staging: run complete persists knowledge candidates into the knowledge-delta in the same transaction as the completion receipt, making them visible to knowledge review immediately; summarizeSessionKnowledge reads are schema-agnostic', text_zh: '知识闭环原子化：run complete 在完成 receipt 的同一事务内将知识候选写入 knowledge-delta，立即对 knowledge review 可见；summarizeSessionKnowledge 读取与 schema 无关' },
      { type: 'fix', text_en: 'Cross-repo audit round: run create enforces predecessor publication authority before creating Run shells and clears engine-injected input_refs on replay; transition receipts force participant_id = actor_id; ResumeMap drops identityRevision/paused; resolved or escalated decisions cannot be bound as new gates; run next derives the Run ID deterministically from the request ID so retries replay the original mutation; the canonical orchestration-revision flag replaces the retired session-revision flag', text_zh: '跨仓审查修复：run create 先通过前驱 publication authority 再建 Run shell，replay 时清除引擎注入的 input_refs；transition receipt 强制 participant_id = actor_id；ResumeMap 删除 identityRevision/paused；resolved/escalated 决策不可再绑为新门；run next 缺省 Run ID 从 request ID 确定性派生以支持重放；artifact flag 改用规范 orchestration-revision' },
      { type: 'chore', text_en: 'Release gate proofs: drop the retired use-participant-status assertion and align the v3 proof sequence with the open-revision-1 orchestration contract; all 30 build-backed release-machine proofs pass', text_zh: '发布门禁修复：删除已退役的 use-participant-status 断言，v3 证明序列对齐 open-revision-1 orchestration 合同；30 项 build-backed release-machine 证明全部通过' },
    ],
  },
  {
    version: '0.5.71',
    date: '2026-08',
    changes: [
      { type: 'feat', text_en: 'Add v3 decision gates: chain steps may declare a decision_ref; run next/create block on unresolved predecessor gates (DECISION_GATE_BLOCKED with run-decide next actions); session complete blocks on open gates while escalated gates pass with concerns; decide escalate no longer pauses the Session', text_zh: '新增 v3 决策门：chain step 可声明 decision_ref；未决前驱决策门阻断 run next/create（DECISION_GATE_BLOCKED + run-decide next actions）；session complete 阻断 open 门、escalated 门以 concerns 通过；decide escalate 不再暂停 Session' },
      { type: 'refactor', text_en: 'Simplify v3 by the ralph-run anchor: remove chain-proposal application, TC-P0-3 extra completion inputs (--artifact/--note/--decision), 22 retired v2-only subcommand stubs, session fail/chain audit, resume-map truncation (oversize now throws), and per-check knowledge reconciliation (candidates generated once by run complete)', text_zh: '以 ralph 路径为锚简化 v3：移除 chain-proposal 应用、TC-P0-3 附加完成输入（--artifact/--note/--decision）、22 条退役 v2-only 子命令 stub、session fail/chain audit、resume-map 截断（超限改为抛错）与每次 check 的知识对账（候选改为 run complete 一次性生成）' },
      { type: 'refactor', text_en: 'Batch B: drop the participant entity/commands (--participant option retained for injection compatibility), session identity_revision, status paused, and the gates system (gates_ref/blocking checks/run gate_refs); receipts now store participant_id = actorId; legacy v3 files read via strip-tolerant schemas with paused mapped to open', text_zh: '批次 B：移除 participant 实体与命令族（--participant option 保留兼容注入）、session identity_revision、paused 状态与 gates 系统（gates_ref/blocking 校验/run gate_refs）；receipt 改为存 participant_id = actorId；旧 v3 文件以 strip 宽容 schema 读取，paused 映射为 open' },
      { type: 'chore', text_en: 'Add maestro config session-schema set/show for explicit writer switching; capabilities now declare writer-scoped session_schema_writes', text_zh: '新增 maestro config session-schema set/show 显式切换 writer；capabilities 改为声明 writer-scoped session_schema_writes' },
    ],
  },
  {
    version: '0.5.70',
    date: '2026-08',
    changes: [
      { type: 'feat', text_en: 'Session/Run v3 minimal protocol: session/3.0 and run/3.0 state machines with independent identity, orchestration, activity and per-Run revisions; atomic chain advancement; participant identities; immutable request/transition receipts; strict run-response/1.2 envelopes; deterministic context resolution; and compact ResumeMapV1 projections', text_zh: 'Session/Run v3 最小协议：新增 session/3.0 与 run/3.0 状态机，分离 identity、orchestration、activity 与每个 Run 的 revision；支持原子 chain 推进、participant 身份、不可变 request/transition receipts、严格 run-response/1.2、确定性上下文解析与紧凑 ResumeMapV1 投影' },
      { type: 'feat', text_en: 'Add fail-closed v3 CLI routing by workspace writer with session/run/participant commands, structured retirement responses for legacy Execution commands, machine-readable help and capabilities catalogs, and both split/equal --workflow-root support', text_zh: '新增按 workspace writer fail-closed 分发的 v3 CLI，提供 session/run/participant 命令、旧 Execution 命令的结构化退役响应、可机读 help/capabilities catalog，并同时支持分离式与等号式 --workflow-root' },
      { type: 'fix', text_en: 'Harden v3 recovery and migration: failed/cancelled Runs close or requeue their chain steps, retry lineage and attempts derive from authoritative Runs, chain rewrites are pending-only, participant replay returns the original receipt result, and legacy Execution transitions migrate with source hashing and secret redaction', text_zh: '加固 v3 恢复与迁移：failed/cancelled Run 会关闭或重新排队对应 chain step，retry lineage 与 attempt 从权威 Run 派生，chain 改写仅限 pending，participant replay 返回原始 receipt 结果，旧 Execution transitions 以源哈希与敏感字段清理方式迁移' },
      { type: 'chore', text_en: 'Expand release gates to 41 contract-parity checks and 31 build-backed v2/v3 behavior proofs, including writer routing, participant receipts, help compatibility, retired commands and explicit complete --advance semantics', text_zh: '扩展发布门禁至 41 项 contract parity 检查与 31 项 build-backed v2/v3 行为证明，覆盖 writer 路由、participant receipts、help 兼容、命令退役与显式 complete --advance 语义' },
    ],
  },
  {
    version: '0.5.69',
    date: '2026-08',
    changes: [
      { type: 'feat', text_en: 'Knowledge graph: deterministic Objective-C/Swift structural resolution — exact-only resolution of inheritance, protocol conformance, extension ownership and contains relationships (never fuzzy), generated Swift-header identity via SWIFT_CLASS, opt-in external-surface manifest with validated project-relative header allowlist, hierarchy/impact/path queries with structured ambiguity errors, schema v8 migration with replayable structural refs, and hardened background sync leases', text_zh: '知识图谱：确定性 Objective-C/Swift 结构解析——继承/协议遵循/扩展归属/包含关系仅做精确解析（绝不模糊匹配），通过 SWIFT_CLASS 识别生成式 Swift 头身份，可选的 external-surfaces 清单以项目相对路径白名单校验外部头文件，层次/影响/路径查询返回结构化歧义错误，schema v8 迁移支持可重放结构引用，后台同步租约加固' },
      { type: 'fix', text_en: 'Windows canonical-path parity: external-surface canonical paths and kg identity-path test expectations are now posix-form on win32, fixing kg sync failures (Invalid StructuralReference) on Windows', text_zh: 'Windows 规范路径对齐：external-surface 规范路径与 kg 身份路径测试期望在 win32 统一为 posix 形式，修复 Windows 上 kg sync 的 Invalid StructuralReference 失败' },
    ],
  },
  {
    version: '0.5.68',
    date: '2026-08',
    changes: [
      { type: 'fix', text_en: 'Run-completion path resolution: --evidence/--artifact/--chain-proposal now accept shell-CWD-relative paths unambiguously when they land inside the Run directory (outputs/ for proposals), errors state the resolved path and the run-directory base, and a latent Windows cross-drive containment bypass is fixed', text_zh: 'Run 完成路径解析：--evidence/--artifact/--chain-proposal 在目标无歧义落在 Run 目录（proposal 为其 outputs/）内时接受 shell-CWD 相对路径，报错给出解析后路径与 Run 目录基准，并修复 Windows 跨盘符 containment 潜在绕过' },
      { type: 'docs', text_en: 'Align skill-layer verification with evidence-reuse discipline: verify iron law becomes grounded evidence (live run or still-valid result under material invalidators), execute self-check scoped to changed surface, odyssey-review reuses test evidence across S_FIX/S_CONFIRM; evidence path base documented in run-mode and command-authoring', text_zh: '技能层验证与证据复用纪律对齐：verify 铁律改为 grounded evidence（本轮 live run 或失效条件内仍有效的结果），execute self-check 限定本次改动范围，odyssey-review 跨 S_FIX/S_CONFIRM 复用测试证据；run-mode 与 command-authoring 补充 evidence 路径基准文档' },
    ],
  },
  {
    version: '0.5.67',
    date: '2026-08',
    changes: [
      { type: 'fix', text_en: 'Chain dispatch fixes: pass --arg through chain dispatch while keeping failed sessions canonical-reachable, preserve chain-file step args and explicit topic in chain start, and register projections on all session creation paths with enum argument validation plus session prune', text_zh: '链式调度修复：--arg 穿透链式调度且失败会话保持 canonical 可达，chain 启动时保留 chain-file 步骤参数与显式 topic，并在所有会话创建路径注册 projections、校验枚举参数并新增 session prune' },
    ],
  },
  {
    version: '0.5.66',
    date: '2026-08',
    changes: [
      { type: 'fix', text_en: 'Support line-delimited artifact metadata: run check/done now reads _meta from the first line of .ndjson/.jsonl outputs, strips UTF-8 BOM from metadata-bearing files, registers application/x-ndjson media type, and adds skipArtifactMetadataValidation to downgrade contract metadata mismatches to warnings', text_zh: '支持行分隔的产物元数据：run check/done 可从 .ndjson/.jsonl 输出的首行读取 _meta，去除元数据文件的 UTF-8 BOM，新增 application/x-ndjson 媒体类型，并提供 skipArtifactMetadataValidation 将契约元数据不匹配降级为警告' },
    ],
  },
  {
    version: '0.5.65',
    date: '2026-08',
    changes: [
      { type: 'feat', text_en: 'Capture transcript evidence snapshots in the knowledge lifecycle: harvest the K12–K17 window evidence flow and teach run-mode about it, recording exact source transcript evidence for promotion decisions', text_zh: '在知识生命周期中采集对话记录证据快照：收获 K12–K17 窗口证据流并教会 run-mode，为晋升决策记录精确的源对话记录证据' },
    ],
  },
  {
    version: '0.5.64',
    date: '2026-08',
    changes: [
      { type: 'feat', text_en: 'Polish session/run lifecycle ergonomics and knowledge-flow UX from dual-model (gpt + qwen) and E2E walkthroughs: 16 friction points covering session done no-arg resolution, verbless fast-path verdicts, inline adjudication promotion, and reporting shorthand', text_zh: '基于双模型（gpt + qwen）与 E2E 演练打磨会话/运行生命周期易用性与知识流 UX，修复 16 个摩擦点：session done 无参解析、无动词快速路径的 verdict 尊重、内联裁决晋升与报告简写' },
      { type: 'feat', text_en: 'Add prompt-facing quality gates: Staging Quality Bar, frontmatter quality gate blocking execution-state narration, Review Presentation Protocol (agent presents candidates, user decides), plus session-level knowledge governance', text_zh: '新增 prompt 质量门禁：Staging Quality Bar、阻断执行状态叙述的 frontmatter 质量门禁、Review Presentation Protocol（代理呈现候选、用户决策），以及会话级知识治理' },
      { type: 'fix', text_en: 'Restore knowledge-graph code relation edges, FTS integrity, and multi-language extractors (TS/JS, Swift, Lua family) with a code-resolver for unresolved refs', text_zh: '修复知识图谱代码关系边、FTS 完整性与多语言抽取器（TS/JS、Swift、Lua 系列），并新增 unresolved refs 的 code-resolver' },
      { type: 'fix', text_en: 'Accept legacy report.md frontmatter shorthand with auto-derived ids and actionable validation errors; bound explicit --verdict in verbless fast-path; harden ownership/governance boundaries', text_zh: '接受旧版 report.md 前置元数据简写并自动派生 id、给出可执行的校验错误；无动词快速路径尊重显式 --verdict；强化所有权与治理边界' },
      { type: 'fix', text_en: 'Repair the broken wasm-copy step in the build script (missing closing quote introduced by the kg fix)', text_zh: '修复 build 脚本中损坏的 wasm 拷贝步骤（kg 修复引入的缺失引号）' },
      { type: 'refactor', text_en: 'Migrate 22 command contracts to contract_version 2.1', text_zh: '将 22 个 command 契约迁移到 contract_version 2.1' },
    ],
  },
  {
    version: '0.5.63',
    date: '2026-08',
    changes: [
      { type: 'fix', text_en: 'Resolve the sharp <0.35.0 vulnerability chain (GHSA-f88m-g3jw-g9cj: CVE-2026-33327/33328/35590/35591) by vendoring the unmodified Transformers.js 3.8.1 runtime and declaring its production dependencies directly with sharp ^0.35.3, removing the vulnerable transformers→sharp edge for all consumers', text_zh: '修复 sharp <0.35.0 漏洞链（GHSA-f88m-g3jw-g9cj：CVE-2026-33327/33328/35590/35591）：内置未修改的 Transformers.js 3.8.1 运行时并直接声明其生产依赖（sharp ^0.35.3），为所有消费者移除 transformers→sharp 漏洞依赖边' },
    ],
  },
  {
    version: '0.5.60',
    date: '2026-08',
    changes: [
      { type: 'feat', text_en: 'Remove the Pi platform from the Maestro installer and direct users to the official pi-maestro-flow plugin, with TUI and install-guide reminders', text_zh: '从 Maestro 安装器移除 Pi 平台，引导用户安装官方 pi-maestro-flow 插件，并在 TUI 与安装指南中给出提示' },
      { type: 'refactor', text_en: 'Reduce the arch-kb command surface to search/show/list, retiring the match, checklist, patterns, framework, and tech-select subcommands', text_zh: '精简 arch-kb 命令面为 search/show/list，移除 match、checklist、patterns、framework、tech-select 五个子命令' },
      { type: 'fix', text_en: 'Harden storage identifier boundaries across embedding, CLI history, coordinator report paths, run IDs, and critique storage', text_zh: '加固存储标识符边界，覆盖 embedding、CLI 历史、协调器报告路径、run ID 与 critique 存储' },
    ],
  },
  {
    version: '0.5.59',
    date: '2026-07',
    changes: [
      { type: 'refactor', text_en: 'Migrate dashboard and docs-site client routing from react-router-dom to wouter via a local alias shim, dropping a heavy dependency without changing call sites', text_zh: '将 dashboard 与 docs-site 客户端路由从 react-router-dom 迁移到 wouter，通过本地别名 shim 实现，移除重型依赖且无需改动调用点' },
      { type: 'feat', text_en: 'Add dashboard resizable panels, context menu, and KaTeX math rendering in markdown', text_zh: 'dashboard 新增可调节面板、右键菜单与 Markdown 中的 KaTeX 数学公式渲染' },
      { type: 'fix', text_en: 'Use forward-compatible schema version handling to prevent silent state.json downgrade', text_zh: '采用向前兼容的 schema 版本处理，防止 state.json 被静默降级' },
      { type: 'chore', text_en: 'Upgrade @hono/node-server to 2.x and @modelcontextprotocol/sdk to 1.30, plus hono, vite, mermaid, ws, and tsx', text_zh: '升级 @hono/node-server 至 2.x、@modelcontextprotocol/sdk 至 1.30，并更新 hono、vite、mermaid、ws、tsx' },
    ],
  },
  {
    version: '0.5.58',
    date: '2026-07',
    changes: [
      { type: 'feat', text_en: 'Add a governed knowledge lifecycle from Run evidence capture through conservative promotion, deterministic audit, reconciliation, and reversible pruning', text_zh: '新增受治理的知识生命周期：从 Run 证据采集到保守晋升、确定性审计、协调与可回滚剪枝' },
      { type: 'feat', text_en: 'Distinguish knowledge exposure from explicit consumption and record knowledge deltas with precise provenance across Session and Run execution', text_zh: '区分知识曝光与显式消费，并在 Session/Run 执行中记录带精确来源的知识增量' },
      { type: 'feat', text_en: 'Add knowledge search diversity and exploration slots, unified KG identity and facets, plus an end-to-end knowledge review command', text_zh: '新增知识检索多样性与探索位、统一 KG 身份与 facets，并补齐端到端知识审查命令' },
      { type: 'refactor', text_en: 'Migrate Ralph fully onto the canonical Run Executor and bind Pi skills to the Session/Run platform contract', text_zh: '将 Ralph 全面迁移到标准 Run Executor，并把 Pi skills 绑定到 Session/Run 平台契约' },
      { type: 'fix', text_en: 'Harden promotion transactions, evidence validation, audit read-only guarantees, rollback safety, machine-mode stderr, and mutable command refresh', text_zh: '加固晋升事务、佐证校验、审计只读保证、回滚安全、机器模式 stderr 与可变命令刷新' },
      { type: 'docs', text_en: 'Document the reconciled knowledge architecture and align command, workflow, skill, and Pi teammate-tool mirrors', text_zh: '沉淀协调后的知识系统架构，并对齐 command、workflow、skill 与 Pi teammate-tool 镜像' },
    ],
  },
  {
    version: '0.5.56',
    date: '2026-07',
    changes: [
      { type: 'feat', text_en: 'Unify Maestro and Ralph into a single Session chain protocol with Skill chain-proposal contract and atomic proposal application', text_zh: '统一 Maestro 与 Ralph 为单一 Session 链协议，新增 Skill 链提案契约与原子提案应用' },
      { type: 'feat', text_en: 'Add session start command with run start deprecation and full reference migration; new prepare/maestro.md for intent classification and chain building', text_zh: '新增 session start 命令并废弃 run start，全量迁移引用；新建 prepare/maestro.md 意图分类与建链协议' },
      { type: 'feat', text_en: 'Rewrite ralph prepare/workflow restoring Stage Mapping, Build Rules and state machine; align maestro prepare flags, decomposition protocol and invariants', text_zh: '重写 ralph prepare/workflow 恢复 Stage Mapping、Build Rules 与状态机；对齐 maestro prepare flags、分解协议与 invariants' },
      { type: 'feat', text_en: 'Install entry commands converted to skill format with hub arrow and expanded step selection', text_zh: '安装入口命令转为 skill 格式，新增 hub 箭头与扩展步骤选择' },
      { type: 'fix', text_en: 'Complete Run recovery loop, auto-continuation and decision closure; clean 82 files of residual command references', text_zh: '补全 Run 恢复闭环、自动续行与决策闭环；清理 82 个文件的残留命令引用' },
      { type: 'fix', text_en: 'Fix ralph decision gate classification, evaluation flow and missing links; adapt run-executor for inline-brief forward flow', text_zh: '修复 ralph decision gate 分类、评估流程与缺失环节；适配 run-executor 的 inline-brief 前向流程' },
      { type: 'refactor', text_en: 'Session/Run responsibility separation with full Ralph migration; unify orchestration into Run lifecycle; neutralize Run executor and evidence queries', text_zh: 'Session/Run 职责分离与 Ralph 完全迁移；统一编排到 Run 生命周期；中立化 Run executor 与 evidence 查询' },
      { type: 'feat', text_en: 'Brief no longer injects full run-mode.md text, eliminating redundant executor loading', text_zh: 'brief 不再注入 run-mode.md 全文，消除执行器重复加载' },
    ],
  },
  {
    version: '0.5.55',
    date: '2026-07',
    changes: [
      { type: 'feat', text_en: 'Support HF_ENDPOINT / HF_MIRROR env vars to download embedding models from a mirror (e.g. hf-mirror.com) via @huggingface/transformers env.remoteHost', text_zh: 'embedding 支持通过 HF_ENDPOINT / HF_MIRROR 环境变量走镜像（如 hf-mirror.com）下载模型，经 @huggingface/transformers 的 env.remoteHost 透传' },
      { type: 'chore', text_en: 'npm audit fix: patch transitive dependencies (ws, hono, body-parser, path-to-regexp, postcss, vite, etc.), reducing vulnerabilities from 15 to 5; remaining 5 are unpatched sharp/libvips CVEs via @huggingface/transformers', text_zh: 'npm audit fix：修补传递依赖（ws、hono、body-parser、path-to-regexp、postcss、vite 等），漏洞从 15 降至 5；剩余 5 个为 @huggingface/transformers 引入的 sharp/libvips CVE，暂无上游补丁' },
    ],
  },
  {
    version: '0.5.54',
    date: '2026-07',
    changes: [
      { type: 'feat', text_en: 'Add degradation routing in execute when the current-plan artifact is absent, so execution continues gracefully instead of stalling', text_zh: 'execute 在缺少 current-plan 产物时新增降级路由，使执行优雅延续而非卡死' },
      { type: 'feat', text_en: 'Streamline the run/session CLI surface and add a dedicated run command entry', text_zh: '精简 run/session CLI 面，并新增独立 run 命令入口' },
      { type: 'fix', text_en: 'Repair the search ranking gap and improve result quality; optimize the UserPromptSubmit hook search hot path', text_zh: '修复搜索排序缺口并提升结果质量；优化 UserPromptSubmit hook 搜索热路径' },
      { type: 'fix', text_en: 'Complete the install entry command steps', text_zh: '补全安装入口命令步骤' },
      { type: 'refactor', text_en: 'Unify --tag and --keyword parameter semantics across search/load, remove redundant run-lifecycle I/O and optimize artifact traversal, fold quality-refactor and security-audit into the Odyssey system, and simplify Companion into a linear flow with an added explore phase', text_zh: '统一 search/load 的 --tag 与 --keyword 参数语义，消除 run 生命周期冗余 I/O 并优化 artifact 遍历，将 quality-refactor 与 security-audit 融入 Odyssey 体系，并精简 Companion 为线性流程、补充 explore 阶段' },
      { type: 'docs', text_en: 'Convert instruction files to English and update Gate rule semantics; broaden test coverage across graph-walker, connection-pool, tenant-migrator, KG scoring/merge, and run-context', text_zh: 'instruction 文件转英文并更新 Gate rule 语义；补充 graph-walker、connection-pool、tenant-migrator、KG scoring/merge 与 run-context 等测试覆盖' },
    ],
  },
  {
    version: '0.5.53',
    date: '2026-07',
    changes: [
      { type: 'feat', text_en: 'Upgrade Session/Run to session/1.3 and command-run/1.3 with topic identity, reuse assessment, paused recovery, mutation receipts, and release-machine parity gates', text_zh: 'Session/Run 升级到 session/1.3 与 command-run/1.3，补齐 topic identity、reuse assessment、paused recovery、mutation receipt 与 release-machine parity 门禁' },
      { type: 'refactor', text_en: 'Split development entrypoints into Companion for lightweight direct execution, Next for pure routing, and Maestro for multi-step manual or Ralph orchestration', text_zh: '开发入口分层为：Companion 负责轻量直接执行、Next 负责纯路由、Maestro 负责 manual/Ralph 多步编排' },
      { type: 'refactor', text_en: 'Retire the first-tier quick step and route quick, small, and ad-hoc intents directly to /maestro-companion', text_zh: '退休 first-tier quick step，将 quick、small、ad-hoc 意图直接路由到 /maestro-companion' },
      { type: 'fix', text_en: 'Harden SessionStore replay, Windows lock recovery, recall confirmation, artifact template scanning, and TOCTOU validation', text_zh: '加固 SessionStore replay、Windows 锁恢复、recall confirmation、artifact template 扫描与 TOCTOU 校验' },
      { type: 'fix', text_en: 'Clean retired quick assets during installation and package first-tier prepare contracts for fresh consumers', text_zh: '安装升级时清理退休 quick 资产，并为 fresh consumer 正确打包 first-tier prepare contracts' },
      { type: 'docs', text_en: 'Add the Session/Run architecture guide and remove stale documentation that described Maestro Next as a fixed analyze-plan-execute quick chain', text_zh: '新增 Session/Run architecture 指南，并移除将 Maestro Next 描述为固定 analyze-plan-execute quick chain 的旧文案' },
    ],
  },
  {
    version: '0.5.52',
    date: '2026-07',
    changes: [
      { type: 'feat', text_en: 'Upgrade Session/Run to session/1.2 and command-run/1.2 with a machine-readable run-response/1.0 envelope and automatic next-action discovery after completion', text_zh: 'Session/Run 升级到 session/1.2 与 command-run/1.2，引入可机读 run-response/1.0，并在完成后自动识别下一动作' },
      { type: 'feat', text_en: 'Expose concise execution guidance, command arguments, requirements, resolved inputs, and missing inputs so an LLM can reason about the next step before dispatch', text_zh: '透出精简执行指南、命令参数、requirements、已解析输入与缺失输入，便于 LLM 在派发前判断所需上下文' },
      { type: 'feat', text_en: 'Add Unicode-safe intent identity and advisory Session recall with confirmation-token fork, import, and new-session actions instead of unsafe automatic resume', text_zh: '新增 Unicode-safe intent identity 与 advisory Session recall，通过 confirmation token 执行 fork、import、new，避免不安全的自动 resume' },
      { type: 'fix', text_en: 'Harden SessionStore durability with locks, transition receipts, lineage checks, audited rebind, and fail-closed resolve/resume recovery', text_zh: '通过锁、transition receipt、lineage 校验、审计 rebind 与 fail-closed resolve/resume 加固 SessionStore durability' },
      { type: 'refactor', text_en: 'Make Ralph a canonical Session/Run adapter and align command, workflow, agent, and generated mirror contracts across supported platforms', text_zh: '将 Ralph 收敛为标准 Session/Run 适配层，并对齐多平台 command、workflow、agent 与生成镜像契约' },
      { type: 'docs', text_en: 'Refresh the v2 command architecture, Session/Run guidance, knowledge and issue workflows, bilingual guides, and docs-site references', text_zh: '更新 v2 命令架构、Session/Run 指南、knowledge/issue 工作流、双语指南与 docs-site reference' },
    ],
  },
  {
    version: '0.5.51',
    date: '2026-07',
    changes: [
      { type: 'feat', text_en: 'Unify the Session/Run lifecycle around prepare, create, brief, check, and complete, with run next stepping, explicit ASCII session IDs, progressive context injection, and finish checklists', text_zh: 'Session/Run 生命周期统一为 prepare、create、brief、check、complete，新增 run next 步进、显式 ASCII Session ID、渐进式上下文注入与 finish 收口清单' },
      { type: 'feat', text_en: 'Integrate Codex Multi-Agent V2 collaboration, TOML agent generation, platform tool profiles, update_plan task tracking, and isolated Goal guidance', text_zh: '集成 Codex Multi-Agent V2 collaboration、TOML Agent 生成、平台工具 profile、update_plan 任务跟踪与独立 Goal 指引' },
      { type: 'feat', text_en: 'Rebuild Explore around parallel streaming batches, repository maps, a reusable agent loop, configurable turn limits, direct proxy fallback, and stronger evidence validation', text_zh: 'Explore 重构为并行流式 Batch、repository map、通用 agent loop、可配置轮次、代理直连回退与更严格证据校验' },
      { type: 'feat', text_en: 'Add docs v1/v2 switching with the consolidated v2 command model and a unified configuration reference', text_zh: 'docsite 新增 v1/v2 切换、v2 合并命令模型与统一配置参考指南' },
      { type: 'fix', text_en: 'Harden Ralph and team execution with birth-packet-first dispatch, lease fencing, single-source state, fail-closed completion, and canonical artifact paths', text_zh: 'Ralph 与 team 执行加固：birth-packet 优先派发、lease fencing、状态单源、fail-closed completion 与标准产物路径' },
      { type: 'fix', text_en: 'Make knowledge writes and graph migrations atomic, block SQL injection and nested transactions, expose index corruption, and normalize searchable Session/Run topology', text_zh: '知识写入与图谱迁移原子化，修复 SQL 注入与嵌套事务，显式暴露索引损坏并规范化可搜索的 Session/Run 拓扑' },
      { type: 'refactor', text_en: 'Converge commands and workflows on prepare/workflows/ref entry steps, retire the chains data layer and obsolete commands, and move collab/grill to run-lite entry steps', text_zh: '命令与工作流收敛到 prepare/workflows/ref entry step，退役 chains 数据层与废弃命令，并将 collab/grill 迁移为 run-lite entry step' },
      { type: 'fix', text_en: 'Align 23 team-skill coordinators and all generated Claude/Codex/Agy/Agents mirrors with the canonical Run contract', text_zh: '将 23 个 team skill coordinator 及 Claude/Codex/Agy/Agents 生成镜像对齐标准 Run 契约' },
      { type: 'fix', text_en: 'Make fresh-checkout dashboard builds independent of pre-existing root dist artifacts', text_zh: '修复 fresh checkout 中 dashboard 构建依赖预先存在 root dist 产物的问题' },
    ],
  },
  {
    version: '0.5.50',
    date: '2026-07',
    changes: [
      { type: 'feat', text_en: 'Expand the installer to 14 platforms with shared hooks, platform-grouped Hub controls, OpenAI Responses API support, and endpoint circuit-breaker recovery', text_zh: '安装矩阵扩展至 14 平台与通用 hooks，Hub 按功能分组，并加入 OpenAI Responses API 与端点熔断恢复' },
      { type: 'feat', text_en: 'Add local embedding model paths, spec JSON output, knowhow tool registration, and on-demand workflow installation', text_zh: '新增本地 embedding 模型路径、spec JSON 输出、knowhow 工具注册与按需 workflow 安装' },
      { type: 'fix', text_en: 'Prevent uninstall from deleting user workflows and harden knowledge-system memory, SQLite locking, and search-daemon limits', text_zh: '防止 uninstall 误删用户 workflow，并加固知识系统内存、SQLite 锁与 search daemon 限制' },
      { type: 'refactor', text_en: 'Unify Ralph verification-ledger completion and normalize generated Codex skill categories', text_zh: '统一 Ralph verification-ledger 完成流程并规范化 Codex skill 生成分类' },
      { type: 'docs', text_en: 'Restructure the bilingual README, guides, competitive comparison, and docs-site deployment', text_zh: '重构双语 README、指南、竞品对比与 docsite 部署' },
    ],
  },
  {
    version: '0.5.49',
    date: '2026-07',
    changes: [
      { type: 'feat', text_en: 'Explore circuit-breaker persistence + pre-flight probing + immediate fallback retry', text_zh: 'Explore circuit-breaker 持久化 + pre-flight 探测 + 即时 fallback' },
      { type: 'feat', text_en: 'Knowledge evolution chain supersession + time-decay search weighting', text_zh: '知识演化链替代机制 + 遗忘曲线搜索权重' },
      { type: 'feat', text_en: 'Spec conflict-marked entries downgraded in search scoring', text_zh: 'Spec 冲突标记条目搜索降级评分' },
      { type: 'fix', text_en: 'Wiki P1/P2 review fixes — staleness detection, embedding identity, link integrity', text_zh: 'Wiki P1/P2 审查修复——陈旧检测、嵌入身份、链路完整性' },
      { type: 'refactor', text_en: 'Wiki indexer streaming cache write + embedding build abort support', text_zh: 'Wiki indexer streaming 写入 + embedding 构建 abort 支持' },
      { type: 'fix', text_en: 'Search daemon connection limit, socket timeout, request size guard', text_zh: 'Search daemon 连接数上限 + socket 超时 + 请求大小保护' },
    ],
  },
  {
    version: '0.5.48',
    date: '2026-07',
    changes: [
      { type: 'feat', text_en: 'Add embedding model management commands — download, status, index rebuild', text_zh: '新增 embedding 模型管理命令——下载、状态、索引重建' },
      { type: 'refactor', text_en: 'Ralph-v2 executor refactored from named teammate to unnamed nested nesting model', text_zh: 'Ralph-v2 executor 从 named teammate 重构为 unnamed 嵌套套娃模型' },
      { type: 'refactor', text_en: 'Unify analyze/plan entry params from phase to milestone', text_zh: 'analyze/plan 入口参数统一从 phase 改为 milestone' },
      { type: 'fix', text_en: 'Remove default emphasis color from install execute button', text_zh: '移除「执行安装」按钮的默认强调色' },
      { type: 'docs', text_en: 'Sync guide/docs-site milestone param semantics + fix MOA page loading', text_zh: '同步 guide/docs-site 的 milestone 参数语义 + 修复 MOA 页面加载' },
    ],
  },
  {
    version: '0.5.47',
    date: '2026-07',
    changes: [
      { type: 'fix', text_en: 'Eliminate applyProxyEnv global process.env pollution in explore agent', text_zh: '消除 explore 代理 applyProxyEnv 的 process.env 全局污染' },
      { type: 'fix', text_en: 'Skip uncached embedding model download during update', text_zh: 'update 时跳过未缓存的 embedding 模型下载' },
      { type: 'fix', text_en: 'Fix orchestrator nested transactions and cross-file foreign key constraint causing index failure', text_zh: '修复 orchestrator 嵌套事务和跨文件外键约束导致索引失败' },
      { type: 'chore', text_en: 'Raise all command file gate constraints to 95%+', text_zh: '提升全部命令文件门禁约束至 95%+' },
    ],
  },
  {
    version: '0.5.46',
    date: '2026-07',
    changes: [
      { type: 'feat', text_en: 'MOA (Mixture of Agents) engine — core loop, per-turn mode, reference disk cache, cost tracking', text_zh: 'MOA 多模型聚合引擎——核心循环、per-turn 模式、reference 磁盘缓存、成本跟踪' },
      { type: 'feat', text_en: 'Ralph-v2 dual dispatch — executor supports multi-agent orchestration + CLI delegate 3 modes', text_zh: 'Ralph-v2 dual dispatch——executor 支持多 agent 编排 + CLI delegate 三模式' },
      { type: 'feat', text_en: 'Integrate WikiIndexer BM25 search into keyword-spec-injector', text_zh: '集成 WikiIndexer BM25 搜索到 keyword-spec-injector' },
      { type: 'fix', text_en: 'Fix KG code search multi-word query returning 0 results + generalized search OR fallback', text_zh: '修复知识图谱代码搜索多词查询返回 0 结果 + 泛化搜索 OR 降级' },
      { type: 'fix', text_en: 'Fix odyssey A_GENERALIZE/A_DISCOVER/A_RECORD phases being skipped', text_zh: '修复 odyssey 举一反三阶段被跳过的问题' },
      { type: 'refactor', text_en: 'Refactor MOA into pipeline engine with dynamic step orchestration', text_zh: '重构 MOA 为 pipeline 引擎，支持动态 step 编排' },
    ],
  },
  {
    version: '0.5.45',
    date: '2026-07',
    changes: [
      { type: 'fix', text_en: 'Fix maestro-next SKILL.md frontmatter YAML parsing error in codex', text_zh: '修复 maestro-next SKILL.md frontmatter YAML 解析错误' },
      { type: 'refactor', text_en: 'Refactor ralph-agent into ralph-v2 + ralph-executor dual agent architecture', text_zh: '重构 ralph-agent 为 ralph-v2 + ralph-executor 双 agent 架构' },
    ],
  },
  {
    version: '0.5.44',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'Claude Agent-specific ralph orchestrator + executor commands', text_zh: '新增 Claude Agent 专属 ralph 编排器 + 执行器命令' },
      { type: 'feat', text_en: 'rmux-collab multi-agent channel collaboration system — atomic send+wait + structured AgentResult', text_zh: 'rmux-collab 多 Agent 频道协作系统——atomic send+wait + 结构化 AgentResult' },
      { type: 'feat', text_en: 'Enhanced explore search tools — multi-mode Search, PCRE2 fallback, SRAG loop', text_zh: 'explore 增强——Search 多模式、PCRE2 回退、SRAG 循环' },
      { type: 'fix', text_en: 'Search daemon type dedup + over-fetch cascade fix + MCP fallback alignment', text_zh: 'search daemon 类型去重 + 过度获取级联修复 + MCP fallback 对齐' },
      { type: 'refactor', text_en: 'Migrate graph module to node:sqlite, remove better-sqlite3 deprecated dependency', text_zh: 'graph 模块迁移至 node:sqlite，消除 better-sqlite3 deprecated 依赖' },
      { type: 'refactor', text_en: 'Explore: remove maxTurns limit, parallel tool calls, async ripgrep', text_zh: 'explore 去除 maxTurns 限制、并行 tool calls、async ripgrep' },
    ],
  },
  {
    version: '0.5.43',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'KG code embedding engine — structured text extraction + vector index + hybrid search (BM25F + vector)', text_zh: 'KG 代码嵌入引擎——结构化文本提取 + 向量索引 + 混合搜索' },
      { type: 'feat', text_en: 'New MCP tools: maestro_wiki_search + maestro_code_semantic_search', text_zh: '新增 MCP 工具 maestro_wiki_search / maestro_code_semantic_search' },
      { type: 'feat', text_en: 'Integrate zvec vector storage backend with multi-chunk embedding + parallel indexing + GPU acceleration', text_zh: '集成 zvec 向量存储后端：多分块嵌入 + 并行索引 + GPU 加速' },
      { type: 'feat', text_en: 'Ralph S_POST_ANALYZE artifact deviation auto-correction', text_zh: 'ralph S_POST_ANALYZE 产物偏离自动修正环节' },
      { type: 'fix', text_en: 'Fix 238 skill/command execution ambiguity issues', text_zh: '修复 skill/command 238 个执行歧义问题' },
      { type: 'refactor', text_en: 'Refactor ralph CLI delegation architecture + dynamic context loading', text_zh: '重构 ralph CLI 委托架构 + 增加动态上下文加载' },
    ],
  },
  {
    version: '0.5.42',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'AGENTS.md instruction injection component for .agents/ platform', text_zh: '新增 .agents/ 平台 AGENTS.md 指令注入组件' },
      { type: 'feat', text_en: 'Enhanced install-guide skill pages + per-skill detail pages on docs-site', text_zh: '完善附加安装包 skill 介绍 + 每技能单独详情页' },
      { type: 'feat', text_en: 'Unified workflow documentation format with explore enhancements', text_zh: '统一工作流文档指令格式 + explore Cross-Search 增强' },
      { type: 'fix', text_en: 'Relax spec-loader category matching — support filename stem inference', text_zh: 'spec-loader 放宽 category 匹配——支持文件名 stem 推断' },
      { type: 'fix', text_en: 'Fix codex config.toml skill dedupe marker misalignment causing infinite file growth', text_zh: '修复 codex config.toml skill dedupe 标记错位导致文件无限膨胀' },
      { type: 'refactor', text_en: 'Command content separation — move procedural logic to workflow layer', text_zh: '命令文件内容分离——过程性逻辑下沉到 workflow 层' },
    ],
  },
  {
    version: '0.5.41',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'spec init --preset extension mechanism + academic preset', text_zh: 'spec init --preset 扩展机制 + academic 学术预设' },
      { type: 'fix', text_en: 'Inline base-delegated content into all 10 Odyssey commands', text_zh: '将 base 委托内容内联到全部 10 个 Odyssey 命令' },
      { type: 'fix', text_en: 'Disambiguate 5 codex odyssey skills and create dedicated base', text_zh: '消除 5 个 codex odyssey skill 的歧义并创建专用 base' },
      { type: 'refactor', text_en: 'Streamline 10 Odyssey command file structures — remove base duplication and prose', text_zh: '精简 10 个 Odyssey 命令文件结构，去除 base 重复与散文' },
    ],
  },
  {
    version: '0.5.40',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'Native plugin install mode (maestro plugin) — install third-party plugins directly into workspace', text_zh: '新增原生插件安装模式 (maestro plugin)——第三方插件直接安装到工作区' },
      { type: 'feat', text_en: 'Code block copy button + light mode dark background fix for docs-site', text_zh: 'docs-site 代码框增加复制按钮 + 亮色模式深色背景修复' },
      { type: 'fix', text_en: 'Fix 7 core skill confirmation gate missing and wave flow defects', text_zh: '修复 7 个核心 skill 的确认门控缺失和 wave 流程缺陷' },
      { type: 'fix', text_en: 'CLI bare intent interception + Codex skill disambiguation enhancement', text_zh: 'CLI 裸 intent 拦截优化 + Codex skill 防混淆增强' },
      { type: 'fix', text_en: 'Fix docs-site guide loading path mismatch and missing completion icons', text_zh: '修复 docs-site guide 加载路径不匹配及补全缺失图标' },
      { type: 'refactor', text_en: 'Unify codex skill shell execution interface to shell_exec abstraction', text_zh: '统一 codex skill 的 shell 执行接口为 shell_exec 抽象' },
    ],
  },
  {
    version: '0.5.39',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'Embedding supports KG node hierarchical indexing + dynamic token batching', text_zh: 'embedding 支持 KG 节点分层索引 + 动态 token 分批' },
      { type: 'feat', text_en: 'Embedding supports external API configuration (~/.maestro/api-embedding.json)', text_zh: 'embedding 支持外部 API 配置 (~/.maestro/api-embedding.json)' },
      { type: 'feat', text_en: 'Session-context hook injects project summary, source file tree and recent sessions', text_zh: 'session-context hook 注入项目摘要、源码文件树和最近 session' },
      { type: 'fix', text_en: 'Embedding system review fixes — daemon notification resilience, race protection, partial failure retention', text_zh: 'embedding 系统 review 修复——daemon 通知容错、竞态防护、部分失败保留' },
      { type: 'refactor', text_en: 'Odyssey commands extract shared base + inject anti-stagnation mechanism', text_zh: 'Odyssey 命令提取共享基座 + 注入防停滞机制' },
      { type: 'refactor', text_en: 'Codex Odyssey command sync refactor', text_zh: 'codex 版本 Odyssey 命令同步重构' },
    ],
  },
  {
    version: '0.5.38',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'Restore maestro view/stop commands — re-enable frontend dashboard entry', text_zh: '恢复 maestro view/stop 命令，重新启用前端 dashboard 入口' },
      { type: 'feat', text_en: 'Install TUI refactor — platform-driven installation + update migration fix', text_zh: 'install TUI 重构——平台驱动安装 + update 迁移修复' },
      { type: 'feat', text_en: 'New manage-drift-realign command + maestro timeline CLI', text_zh: '新增 manage-drift-realign 命令 + maestro timeline CLI' },
      { type: 'feat', text_en: 'Ralph anti-drift 4-layer protection + goal hot-amendment --amend', text_zh: 'ralph 反漂移 4 层防护 + 目标热修改 --amend' },
      { type: 'feat', text_en: 'Codex full re-grounding subsystem migration + grill auto_mode alignment', text_zh: 'codex 完整移植 re-grounding 子系统 + grill auto_mode 对齐' },
      { type: 'fix', text_en: 'Cross-file schema alignment + protocol version fix', text_zh: '跨文件 schema 对齐 + protocol version 遗漏修复' },
    ],
  },
  {
    version: '0.5.37',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'Profile-based reinstall for maestro update — avoids Windows cmd length limits', text_zh: 'update 重装改用 profile-based --import --upgrade 机制，解决 Windows 命令行长度限制' },
      { type: 'feat', text_en: 'Unified maestro load command — merged spec/wiki/session loading', text_zh: '统一 maestro load 命令——合并 spec/wiki/session 加载' },
      { type: 'feat', text_en: 'maestro search --kg mode — unified KG full-source search', text_zh: 'maestro search --kg 模式——KG 全源统一搜索' },
      { type: 'feat', text_en: 'Search cold-start optimization — from ~3200ms down to ~280ms', text_zh: 'search 命令冷启动优化——从 ~3200ms 降至 ~280ms' },
      { type: 'refactor', text_en: 'Replace gemini CLI with agy CLI globally', text_zh: '全局替换 gemini CLI 为 agy CLI' },
      { type: 'chore', text_en: 'Migrate 37 node:test suites to vitest', text_zh: '测试体系统一——37 个 node:test 全迁 vitest' },
    ],
  },
  {
    version: '0.5.36',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'Session Anchor — auto-inject intent/boundary/goal context grounding per step', text_zh: 'Session Anchor——每个 step 自动注入 intent/boundary/goal 上下文锚定' },
      { type: 'feat', text_en: 'Re-grounding drift circuit breaker — periodic intent fidelity checks with safety halt', text_zh: 'Re-grounding 漂移熔断——周期性意图保真检查 + 漂移安全门' },
      { type: 'feat', text_en: 'Search daemon with ONNX model hot cache for faster search responses', text_zh: 'Search Daemon 常驻进程——ONNX 模型热缓存，搜索响应提速' },
      { type: 'feat', text_en: 'New api-explore lightweight code exploration subagent with standalone config', text_zh: '新增 api-explore 轻量代码探索 subagent + 独立配置文件' },
      { type: 'feat', text_en: 'Boundary Grill protocol — analyze/collab/plan/brainstorm boundary conflict review', text_zh: 'Boundary Grill 协议——analyze/collab/plan/brainstorm 边界冲突审查' },
      { type: 'fix', text_en: 'Search scoring optimization — dynamic weights, name-match fix, tie handling', text_zh: '搜索评分优化——动态权重 + name-match 修复 + tie 处理' },
    ],
  },
  {
    version: '0.5.35',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'Search engine embedding upgrade — bilingual E5 + content hash incremental rebuild + hybrid fusion', text_zh: '搜索引擎嵌入模型升级——双语 E5 + content hash 增量重建 + hybrid 融合' },
      { type: 'feat', text_en: 'Enhanced query — IDF adaptive weighting + camelCase splitting', text_zh: '增强查询功能——IDF 自适应加权与 camelCase 拆分' },
      { type: 'feat', text_en: 'Embedding search performance — batch inference + smart device detection + incremental indexing', text_zh: '嵌入搜索性能优化——批量推理 + 智能设备检测 + 增量索引' },
      { type: 'feat', text_en: 'Search semantic enhancement — synonym/stemming query expansion + embedding hybrid retrieval', text_zh: '搜索语义增强——同义词/词干查询扩展 + 嵌入模型混合检索' },
      { type: 'fix', text_en: 'Codex command chain context passing — 4 Critical + 7 High fixes', text_zh: 'codex 命令链上下文传递——4 Critical + 7 High 修复' },
      { type: 'fix', text_en: 'Install pipeline custom hook selection loss + update reinstall option completion', text_zh: '安装流水线自定义 hook 选择丢失 + update 重装选项补全' },
    ],
  },
  {
    version: '0.5.34',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'Spec confidence system with conflict marking — high/medium/low/contested states + audit resolution', text_zh: 'Spec 置信度系统与冲突标记——high/medium/low/contested 四态 + 审查消除' },
      { type: 'feat', text_en: 'Knowledge extractor plugin registry + node type registration for extensible KG extraction', text_zh: '知识提取器插件注册 + 节点类型注册，扩展化 KG 提取' },
      { type: 'feat', text_en: 'Knowledge command conflict resolution — harvest pre-check + audit 4-state decisions + review conflict marking', text_zh: '知识命令冲突解决闭环——harvest 预检 + audit 四态决策 + review 冲突标记' },
      { type: 'fix', text_en: 'Search system 16 quality fixes — dedup, BM25F scoring, CJK bigram/trigram, performance', text_zh: '搜索系统 16 项质量修复——去重/BM25F 评分/CJK bigram+trigram/性能' },
      { type: 'fix', text_en: 'Fix install/registry/config 7 bugs — component resolution, migration, CLI tools config', text_zh: '修复 install/registry/config 系统 7 个 bug' },
      { type: 'fix', text_en: 'Fix 3 performance risks — Math.max spread overflow, O(n²) includes, linear find', text_zh: '泛化修复 3 项性能风险——Math.max spread 溢出/O(n²) includes/线性查找' },
    ],
  },
  {
    version: '0.5.33',
    date: '2026-06',
    changes: [
      { type: 'fix', text_en: 'Install component selection changed to group bundles — 53→25 items, individual control via `install toggle`', text_zh: 'Install 组件选择改为分组打包——53→25 项，个别控制用 `install toggle`' },
      { type: 'fix', text_en: 'Fix ComponentGrid cursor index mismatch — navigation and rendering now share unified ordered array', text_zh: '修复 ComponentGrid 光标索引错位——导航和渲染统一使用 ordered 数组' },
      { type: 'fix', text_en: 'Add viewport scrolling to ComponentGrid — 20-row window prevents terminal overflow', text_zh: 'ComponentGrid 添加 viewport 滚动——20 行窗口防止终端溢出' },
      { type: 'fix', text_en: 'Improve group label visibility in GroupedHub and ComponentGrid — primary color instead of dimColor', text_zh: '改善 GroupedHub 和 ComponentGrid 分组标签可见度——主色替代暗色' },
      { type: 'fix', text_en: 'Add manifest migration for legacy individual skill IDs to new group bundle IDs', text_zh: '新增 manifest 迁移——旧个别 skill ID 自动映射到新 group bundle ID' },
    ],
  },
  {
    version: '0.5.32',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'New `maestro install toggle` — per-skill/command enable/disable controller with tri-state Tab view', text_zh: '新增 `maestro install toggle` 命令/技能独立控制器，三态 Tab 视图' },
      { type: 'feat', text_en: 'Granular skill selection install — each new skill independently selectable + command group selection', text_zh: '细粒度技能选择安装——每个新增技能独立可选 + 命令族分组选择' },
      { type: 'feat', text_en: 'Script plugins disabled by default — secure by default, explicit opt-in required', text_zh: '脚本插件默认禁用——secure by default，需显式启用' },
      { type: 'fix', text_en: 'Odyssey zero-residual execution hardening — 6 systematic fixes eliminating premature stops', text_zh: 'Odyssey 零遗留执行强化——6 项系统性修复消除过早停止' },
      { type: 'fix', text_en: 'KG code index streaming writes + atomic commits — no more OOM on large repos', text_zh: 'KG 代码索引流式写入 + 原子提交，大仓库不再 OOM' },
      { type: 'fix', text_en: 'Install toggle multi-dimensional review fixes — module split, dedup, boundary corrections', text_zh: 'Install toggle 多维度审查修复——拆分模块、消除重复、修复边界' },
    ],
  },
  {
    version: '0.5.31',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'KG custom extractor plugin system — declarative config + script plugins + generator command', text_zh: 'KG 自定义提取器插件机制——声明式配置 + 脚本插件 + 生成命令' },
      { type: 'fix', text_en: 'Switch kg CLI to MaestroGraph surface — compatibility aliases for index/sync-all/search, symbol name resolution for context/callers/callees/impact', text_zh: '切换 kg 命令到 MaestroGraph——兼容别名 index/sync-all/search，context/callers/callees/impact 支持符号名解析' },
      { type: 'refactor', text_en: 'Core workflow files optimization — 13 files, -675 lines removed', text_zh: '核心 workflow 文件精简优化——13 个文件 -675 行' },
      { type: 'refactor', text_en: 'Full command and workflow instruction optimization — purpose trimming + structure completion + Phase Gates normalization', text_zh: '全量优化命令文件和 workflow 指令——purpose 精简 + 结构补全 + Phase Gates 规范化' },
      { type: 'docs', text_en: 'Instruction authoring guide update — optimization principles and anti-patterns for model behavior consistency', text_zh: '更新指令文件编写指南——优化原则与反模式，确保模型行为一致性' },
      { type: 'docs', text_en: 'docs-site: add Odyssey command family documentation with category registration and i18n', text_zh: 'docs-site 新增 Odyssey 命令族文档——类别注册 + i18n' },
    ],
  },
  {
    version: '0.5.3',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'MaestroGraph: self-built KG engine with 9-language extractors, 24 framework resolvers, BM25F search — fully replacing CodeGraph', text_zh: 'MaestroGraph 自研知识图谱引擎——9 语言提取器、24 框架 resolver、BM25F 搜索，完全替换 CodeGraph' },
      { type: 'feat', text_en: 'Odyssey command family: 5 new long-running deep-cycle commands (debug/improve/planex/ui/review-test-fix)', text_zh: '新增 Odyssey 长时命令族——5 个深度循环命令（debug/improve/planex/ui/review-test-fix）' },
      { type: 'feat', text_en: 'Odyssey exhaustive iteration: 3-sentence philosophy constraints (zero-residual / exhaustive iteration / improvement-is-standard) + Goal reinforcement across all 5 commands', text_zh: 'Odyssey 穷尽迭代优化——三句哲学约束（零遗留 / 穷尽迭代 / 改进即标准）+ Goal 强化，覆盖全部 5 个命令' },
      { type: 'feat', text_en: 'Domain knowledge system: glossary CRUD, code discovery, Hook injection, WikiIndexer search integration', text_zh: 'Domain 领域知识系统——glossary CRUD、代码发现、Hook 注入、WikiIndexer 搜索集成' },
      { type: 'feat', text_en: 'Install TUI redesign: grouped Hub, granular Hooks config, Config Profile export/import', text_zh: 'Install TUI 重设计——分组 Hub、Hooks 颗粒度配置、Config Profile 导出导入' },
      { type: 'feat', text_en: 'Cross-workspace knowledge sharing: workspace link/unlink/list/status + WikiIndexer multi-source aggregation', text_zh: '跨工作空间知识共享——workspace link/unlink/list/status + WikiIndexer 多源聚合' },
      { type: 'fix', text_en: 'FTS5 DELETE trigger cross-index misfire causing DB corruption + Windows mmap safety guard', text_zh: 'FTS5 DELETE trigger 跨索引误删导致 DB 损坏 + Windows mmap 安全防护' },
    ],
  },
  {
    version: '0.5.2',
    date: '2026-06',
    changes: [
      { type: 'fix', text_en: 'skill-scanner: add ~/.agents/skills/ global scanning for agent platform (parity with claude/codex/agy)', text_zh: 'skill-scanner: agent 平台添加 ~/.agents/skills/ 全局扫描（与 claude/codex/agy 一致）' },
      { type: 'fix', text_en: 'codex skills: unify invocation syntax — Skill({}) and /name replaced with $name across 45 files', text_zh: 'codex skills: 统一调用语法——Skill({}) 和 /name 全部替换为 $name，涉及 45 个文件' },
      { type: 'fix', text_en: 'codex maestro SKILL.md: AskUserQuestion → request_user_input, command_path aligned to .codex/skills/', text_zh: 'codex maestro SKILL.md: AskUserQuestion 改为 request_user_input，command_path 对齐 .codex/skills/ 路径' },
    ],
  },
  {
    version: '0.5.1',
    date: '2026-06',
    changes: [
      { type: 'fix', text_en: 'knowhow/spec description attribute full sync across all commands, skills, and workflows', text_zh: 'knowhow/spec description 属性全量同步至所有命令、技能和工作流' },
      { type: 'feat', text_en: 'install TUI: add CodeGraph toggle for one-click tree-sitter KG installation', text_zh: 'install TUI 新增 CodeGraph 开关，一键安装 tree-sitter 代码分析' },
      { type: 'fix', text_en: 'install: fix statusline not recorded in manifest and defaulting to off', text_zh: '修复 statusline 未记录到 manifest 导致默认关闭的问题' },
      { type: 'feat', text_en: 'forceInstall: add --statusline and --codegraph CLI options', text_zh: 'forceInstall 新增 --statusline 和 --codegraph CLI 选项' },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'knowledge system reform: unified search, KG Hook auto-injection, CodeGraph function-level call graph', text_zh: '知识系统改革——统一搜索入口、KG Hook 自动注入、CodeGraph 函数级调用图' },
      { type: 'refactor', text_en: 'install pipeline overhaul: .agy/ removed from git, realtime conversion from .claude/ on install', text_zh: 'install 管线改造——.agy/ 从 git 移除，install 时从 .claude/ 实时转换' },
      { type: 'feat', text_en: 'ralph skills --platform enforcement: add agent/agy platforms, warn on missing', text_zh: 'ralph skills --platform 强制化——新增 agent/agy 平台，缺失时警告' },
      { type: 'refactor', text_en: 'maestro-verify merged into maestro-execute as built-in verification gate', text_zh: 'maestro-verify 合并到 maestro-execute 作为内置验证 gate' },
      { type: 'feat', text_en: 'spec/knowhow entries gain title/description attributes, unified search sync', text_zh: 'spec/knowhow 条目增加 title/description 属性，搜索命令统一同步' },
      { type: 'feat', text_en: 'global command writing style optimization: descriptive to prescriptive', text_zh: '全局命令撰写风格优化——从描述性到规范性' },
    ],
  },
  {
    version: '0.4.26',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'delegate: add proxy config in cli-tools.json — per-tool proxy toggle, subprocess-only env injection', text_zh: 'delegate: cli-tools.json 新增代理配置，支持 per-tool 开关，仅注入子进程环境变量' },
      { type: 'fix', text_en: 'codex adapter: classify Rust tracing stderr (RMCP/MCP errors) as non-fatal thinking instead of error', text_zh: 'codex adapter: 将 Rust tracing stderr（RMCP/MCP 错误）归类为非致命诊断信息而非错误' },
    ],
  },
  {
    version: '0.4.26',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'commands: new manage-drift-realign — detect and realign .workflow/ artifact drift against code reality with 4 parallel scanners (roadmap/spec/codebase/artifact)', text_zh: 'commands: 新增 manage-drift-realign — 4 路并行 scanner 检测重构后 .workflow/ 产物与代码的偏移并交互式对齐' },
      { type: 'feat', text_en: 'cli: new maestro timeline command — unified git + session activity timeline with platform breakdown and hot/cold path analysis', text_zh: 'cli: 新增 maestro timeline 命令 — git + session 统一活动时间线，支持平台分组和热/冷路径分析' },
      { type: 'feat', text_en: 'codex: new manage-drift-realign skill with CSV-wave parallel scanner pattern', text_zh: 'codex: 新增 manage-drift-realign 技能，使用 CSV-wave 并行 scanner 模式' },
    ],
  },
  {
    version: '0.4.25',
    date: '2026-06',
    changes: [
      { type: 'feat', text_en: 'spec: add scope filtering for project-level or global spec loading', text_zh: '规范加载新增范围过滤，支持按项目或全局维度' },
      { type: 'feat', text_en: 'graph: integrate codegraph enhancements into native graph module', text_zh: '集成 codegraph 增强功能至原生 graph 模块' },
      { type: 'feat', text_en: 'docs-site: add new commands with Chinese descriptions, enhance QuickStartPage', text_zh: '新增多个命令及中文描述，增强快速启动页面' },
      { type: 'fix', text_en: 'fix AskUserQuestion parenthetical annotation causing interactions to be skipped', text_zh: '修复 AskUserQuestion 括注式写法导致交互被跳过的问题' },
      { type: 'docs', text_en: 'sync command docs, mark deprecated commands, remove duplicates', text_zh: '同步命令文档，标记废弃命令，移除重复条目' },
    ],
  },
  {
    version: '0.4.24',
    date: '2026-06',
    changes: [
      { type: 'refactor', text_en: 'codebase-rebuild: remove UA external graph tool legacy, migrate to native kg index', text_zh: '移除 UA 外部图工具遗留，迁移至原生 kg index' },
      { type: 'fix', text_en: 'execute: clarify summary/commit/status ownership in E2 Agent path', text_zh: '明确 E2 Agent 路径中 summary/commit/status 的职责归属' },
    ],
  },
  {
    version: '0.4.23',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'docs-site: add sidebar navigation for workflow enhancement, security audit, and swarm intelligence guides', text_zh: 'docs-site: 侧边栏导航新增工作流增强、安全审计、蚁群智能指南' },
      { type: 'refactor', text_en: 'commands: extract interview-mechanics.md to streamline runtime references', text_zh: 'commands: 抽取 interview-mechanics.md 精简运行时引用' },
      { type: 'docs', text_en: 'commands: add Pipeline command authoring standard and unify 12 commands to spec', text_zh: 'commands: 新增 Pipeline 命令撰写标准并统一 12 个命令至规范' },
      { type: 'docs', text_en: 'guide: add workflow enhancement, security audit, and swarm intelligence guide docs', text_zh: 'guide: 添加工作流增强、安全审计、蚁群智能指南文档' },
      { type: 'chore', text_en: 'swarm: add scoring and pheromone modules for team adversarial swarm', text_zh: 'swarm: 新增 team adversarial swarm 评分和信息素模块' },
    ],
  },
  {
    version: '0.4.22',
    date: '2026-05',
    changes: [
      { type: 'fix', text_en: 'swarm: fix GBK encoding errors in Python scripts on Chinese Windows', text_zh: 'swarm: 修复 Python 脚本在中文 Windows 下的 GBK 编码错误' },
    ],
  },
  {
    version: '0.4.21',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'graph: remove UA external dependency, create native src/graph/ module (types, merger, loader, query, FsAnalyzer)', text_zh: 'graph: 移除 UA 外部依赖，创建原生 src/graph/ 模块（类型、合并、加载、查询、FsAnalyzer）' },
      { type: 'feat', text_en: 'kg: new maestro kg index command — local codebase scanning with git-aware enumeration', text_zh: 'kg: 新增 maestro kg index 命令 — 本地代码库扫描 + git 感知枚举' },
      { type: 'feat', text_en: 'graph: enhanced indexing — call graph extraction, tested_by edges, topological sort tour, file category classification', text_zh: 'graph: 图索引增强 — 调用图提取(calls)、测试配对(tested_by)、拓扑排序 tour、文件分类' },
      { type: 'feat', text_en: 'swarm: new team-adversarial-swarm — ACO + modular Workflow + adversarial decision gates', text_zh: 'swarm: 新增 team-adversarial-swarm — ACO 蚁群 + 模块化 Workflow + 对抗决策门' },
      { type: 'feat', text_en: 'commands: new maestro-universal-workflow for dynamic adversarial workflow generation', text_zh: 'commands: 新增 maestro-universal-workflow 动态对抗工作流生成' },
      { type: 'fix', text_en: 'universal-workflow: hardened script generation to prevent Unicode parse errors', text_zh: 'universal-workflow: 强化脚本生成防错机制，消除 Unicode 解析错误' },
    ],
  },
  {
    version: '0.4.20',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'kg: deep integration of Understand-Anything knowledge graph with Wiki search and codebase-rebuild pipeline', text_zh: 'kg: Understand-Anything 知识图谱与 Wiki 搜索、codebase-rebuild 管道深度集成' },
      { type: 'feat', text_en: 'commands: new maestro-swarm-workflow parallel acceleration layer — 8 fixed Workflow scripts covering core commands', text_zh: 'commands: 新增 maestro-swarm-workflow 并行加速层 — 8 个固定 Workflow 脚本覆盖核心命令' },
      { type: 'feat', text_en: 'skills: new maestro-companion for task context management and knowledge routing', text_zh: 'skills: 新增 maestro-companion 任务上下文管理与知识路由技能' },
      { type: 'fix', text_en: 'plan: enforce P3 agent invocation and align read_first/action fields', text_zh: 'plan: 强制 P3 agent 调用并对齐 read_first/action 字段' },
      { type: 'docs', text_en: 'github skills: added Phase 3 (Phase Files Design) and Phase 4 (Validation & Integration) documentation', text_zh: 'github skills: 新增 Phase 3（阶段文件设计）和 Phase 4（验证与集成）文档' },
    ],
  },
  {
    version: '0.4.19',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'skills: new team-swarm — ACO-driven swarm intelligence with pheromone optimizer (4 roles + Python controller + 5 specs)', text_zh: 'skills: 新增 team-swarm 蚁群智能技能 — ACO 驱动 + 信息素优化器（4 角色 + Python 控制器 + 5 份 spec）' },
      { type: 'feat', text_en: 'install: TUI supports Agy (Antigravity) hooks configuration alongside Claude/Codex', text_zh: 'install: 安装器 TUI 支持 Agy (Antigravity) hooks 配置，与 Claude/Codex hooks 独立' },
      { type: 'refactor', text_en: 'install: load manifest defaults by scope+target via findManifest, avoiding cross-scope contamination', text_zh: 'install: 改用 findManifest 按 scope+target 加载 manifest 默认值，避免跨 scope 污染' },
      { type: 'refactor', text_en: 'install: hookLevel default reads hooks.claude.level only — drops unreliable legacy top-level field', text_zh: 'install: hookLevel 默认源仅读 hooks.claude.level，去除不可靠的 legacy 顶层字段' },
      { type: 'chore', text_en: 'maestro-next: rewrite command body to align with new skill topology', text_zh: 'maestro-next: 重写命令体以贴合新技能拓扑' },
    ],
  },
  {
    version: '0.4.18',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'wiki: unified knowledge retrieval — codebase/session virtual nodes + finish-work workflow', text_zh: 'wiki: 统一知识检索 — codebase/session 虚拟节点 + finish-work 工作流' },
      { type: 'feat', text_en: 'commands: new maestro-next single-chain recommendation command', text_zh: 'commands: 新增 maestro-next 单链推荐命令' },
      { type: 'fix', text_en: 'ralph: CLI recognizes both maestro-* and ralph-* sessions', text_zh: 'ralph: CLI 识别 maestro-* 与 ralph-* 两类 session' },
      { type: 'refactor', text_en: 'codex/skills: unified spawn_agents_on_csv contract — mandatory worker termination + strict output_schema', text_zh: 'codex/skills: 统一 spawn_agents_on_csv 契约 — 强制 worker 终止 + 严格 output_schema' },
      { type: 'docs', text_en: 'changelog and announcement banner updated for v0.4.17', text_zh: '更新 v0.4.17 changelog 与公告栏' },
    ],
  },
  {
    version: '0.4.17',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'ralph: dual-platform (claude/codex) skill discovery with --platform filter; merged loop-runner maestro-ralph-beta endpoint', text_zh: 'ralph: 双平台 (claude/codex) skill 识别 + --platform 过滤；合并版 maestro-ralph-beta 端点' },
      { type: 'feat', text_en: 'ralph: codex maestro-ralph / maestro-ralph-execute synced to latest claude version, using $skill direct-invoke style', text_zh: 'ralph: codex maestro-ralph / maestro-ralph-execute 同步最新 claude 版本，采用 $skill 直调形式' },
      { type: 'feat', text_en: 'ralph: ralph next now injects skill config defaults', text_zh: 'ralph: ralph next 注入 skill config defaults' },
      { type: 'fix', text_en: 'install: fixed codex MCP duplicate key — improved duplicate block detection', text_zh: 'install: 修复 codex MCP 重复 key — 改进重复块识别' },
      { type: 'refactor', text_en: 'config: aligned .workflow/config.json schema', text_zh: 'config: 对齐 .workflow/config.json schema' },
    ],
  },
  {
    version: '0.4.16',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'ralph: new maestro ralph CLI sub-commands (session/skills/next/check/complete) with scripted step loading', text_zh: 'ralph: 新增 maestro ralph CLI 子命令族（session/skills/next/check/complete）+ step 加载脚本化' },
      { type: 'feat', text_en: 'knowledge-audit: new manage-knowledge-audit command as symmetric eviction entry for spec / wiki / knowhow tri-store', text_zh: 'knowledge-audit: 新增 manage-knowledge-audit 命令 — spec / wiki / knowhow 三存储淘汰对称入口' },
      { type: 'fix', text_en: 'ralph: path expansion fix and emit format redesign', text_zh: 'ralph: 路径展开 + emit 格式重设计' },
      { type: 'fix', text_en: 'statusline: simplified line 2 chain rendering with 48h expiry and legacy schema compat', text_zh: 'statusline: 简化 line 2 链式渲染 + 48h 过期 + 兼容旧 schema' },
      { type: 'fix', text_en: 'install: manifest now records hook level; TUI defaults restored from last install', text_zh: 'install: manifest 记录 hook level + TUI 默认值从上次安装恢复' },
      { type: 'docs', text_en: 'maestro / ralph-execute description trimmed: A_EXEC_STEP reduced to pure directives, aligned with new emit format', text_zh: 'maestro / ralph-execute 描述精简：A_EXEC_STEP 改为纯指令、对齐新 emit 格式' },
    ],
  },
  {
    version: '0.4.15',
    date: '2026-05',
    changes: [
      { type: 'fix', text_en: 'install: fix statusline being installed when unchecked; manifest v2 now tracks hooks/statusline/MCP entries for precise uninstall', text_zh: 'install: 修复 statusline 未勾选仍被安装；manifest v2 统一跟踪 hooks/statusline/MCP 全量条目实现精确卸载' },
      { type: 'fix', text_en: 'uninstall: hooks removal upgraded from marker-scan to name-based precise deletion (claude/codex/agy); third-party MCP targets (Cursor/Qoder/etc.) now support precise uninstall', text_zh: '卸载: hooks 卸载由全扫 marker 升级为按名精确删除（claude/codex/agy）；第三方 MCP 目标（Cursor/Qoder 等）支持精确卸载' },
      { type: 'refactor', text_en: 'maestro: -y flag only propagated when user explicitly specifies; Goal Prompt no longer blocks, user can input /goal anytime during execution', text_zh: 'maestro: -y 仅在用户显式指定时透传；Goal Prompt 输出后不再 STOP，可在执行中随时输入 /goal' },
      { type: 'refactor', text_en: 'maestro: streamlined command parameters and node type descriptions, unified execution step handling', text_zh: 'maestro: 精简命令参数和节点类型描述，统一执行步骤处理' },
    ],
  },
  {
    version: '0.4.14',
    date: '2026-05',
    changes: [
      { type: 'fix', text_en: 'ralph: internal step loading now honors required_reading / deferred_reading contract', text_zh: 'ralph: 内部 step 加载时遵循 required_reading / deferred_reading 契约' },
      { type: 'refactor', text_en: 'maestro-ralph: clarified goal prompt handling in session creation and decision evaluation', text_zh: 'maestro-ralph: 更新文档以明确会话创建和决策评估中的目标提示处理' },
      { type: 'refactor', text_en: 'ralph: streamlined Goal Prompt and recalibrated execution entry to ralph-execute', text_zh: 'ralph: 精简 Goal Prompt + 校准推进入口为 ralph-execute' },
      { type: 'refactor', text_en: 'Unified scratch session directory naming to {YYYYMMDD}-{type}-{slug}/', text_zh: '统一 scratch session 目录命名为 {YYYYMMDD}-{type}-{slug}/' },
    ],
  },
  {
    version: '0.4.13',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'Added knowledge management system docs, defining the relationship between constraints and accumulation', text_zh: '添加知识沉淀管理系统文档，定义约束与积累的关系' },
      { type: 'feat', text_en: 'Unified Mac-terminal code blocks on guide pages with bilingual support', text_zh: 'guide 页面统一 Mac-terminal 代码框，完善中英文双语支持' },
      { type: 'fix', text_en: 'Fixed logic issues and contract conflicts in commands/skills/workflows', text_zh: '修复 commands/skills/workflows 逻辑问题与契约矛盾' },
      { type: 'fix', text_en: 'Fixed parallel agent persistence issue and contract conflicts in brainstorm', text_zh: '修复 brainstorm 并行 agent 不落盘问题与契约冲突' },
      { type: 'fix', text_en: 'Notification bar links now use React Router Link, fixed basename prefix', text_zh: '通知栏链接改用 React Router Link，修复 basename 前缀缺失' },
      { type: 'refactor', text_en: 'Updated interview protocol with enhanced user control and decision write-back', text_zh: '更新访谈协议，增强用户控制与决策写回机制' },
    ],
  },
  {
    version: '0.4.12',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'Workflow topology refactor — blueprint as standalone command, Milestone hierarchy, dual-layer analyze, global .spec→blueprint migration', text_zh: '工作流拓扑重构 — blueprint 独立命令、Milestone 层级重排、双层 analyze、全局 .spec→blueprint 迁移' },
      { type: 'feat', text_en: 'New maestro-amend skill for generating workflow command overlays', text_zh: '新增 maestro-amend skill：生成工作流命令 overlay' },
      { type: 'feat', text_en: 'Unified context-package system with harvest --prune for state.json management', text_zh: '统一 context-package 体系，新增 harvest --prune 支持 state.json 管理' },
      { type: 'feat', text_en: 'analyze/brainstorm/roadmap commands now include interview_protocol block', text_zh: 'analyze/brainstorm/roadmap 三命令新增 interview_protocol 块' },
      { type: 'fix', text_en: 'Unified spec seed templates as single source of truth with YAML frontmatter', text_zh: '统一 seed 模板单一来源，保证 spec 文件带 YAML frontmatter' },
      { type: 'refactor', text_en: 'Code structure improvements for readability and maintainability', text_zh: '代码结构重构提升可读性和可维护性' },
    ],
  },
  {
    version: '0.4.11',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'install supports optional MCP registration for 7 extra targets (Cursor/Qoder/Trae/Kiro/Roo/VS Code Copilot/Gemini CLI) with multi-select TUI', text_zh: 'install 新增 7 个可选 MCP 目标的注册支持（Cursor/Qoder/Trae/Kiro/Roo/VS Code Copilot/Gemini CLI），含多选 TUI' },
      { type: 'feat', text_en: 'Added neutral .agents/ mirror built from .claude/ via prepublishOnly script; 8 new opt-in components for non-Claude IDEs', text_zh: '新增中性 .agents/ 镜像，通过 prepublishOnly 脚本从 .claude/ 构建，含 8 个非 Claude IDE 用 opt-in 组件' },
      { type: 'feat', text_en: 'Added QuickStart page with sidebar link and bilingual i18n; major docs-site layout/style refactor (Layout/Sidebar/TopBar/MainContent)', text_zh: '新增快速入门页面、侧边栏链接和中英双语 i18n；docs-site 布局/样式大规模重构（Layout/Sidebar/TopBar/MainContent）' },
      { type: 'refactor', text_en: 'maestro-ralph state machine restructured; goal-checklist and status.json unified to single source of truth', text_zh: 'maestro-ralph 状态机重排，goal-checklist 与 status.json 对齐为单一信息源' },
      { type: 'docs', text_en: 'Added Maestro Team Lite collaboration design doc and user guide (EN/ZH)', text_zh: '新增 Maestro Team Lite 协作设计文档和用户指南（中英双语）' },
    ],
  },
  {
    version: '0.4.10',
    date: '2026-05',
    changes: [
      { type: 'fix', text_en: 'Added .agy/agents and .agy/skills to npm package files; previously missing, agy CLI assets failed to install', text_zh: '将 .agy/agents 和 .agy/skills 加入 npm 包 files，修复 agy CLI 资源安装缺失问题' },
    ],
  },
  {
    version: '0.4.9',
    date: '2026-05',
    changes: [
      { type: 'feat', text_en: 'Added Antigravity (agy) CLI as delegate target with 57 skills + 22 sub-agent definitions in .agy/', text_zh: '新增 Antigravity (agy) CLI 作为 delegate target，含 .agy/ 下 57 个 skills + 22 个 sub-agent 定义' },
      { type: 'feat', text_en: 'AgyAdapter integration: adapter-factory, shared agent-types, cli-agent-runner support', text_zh: 'AgyAdapter 集成：adapter-factory、shared agent-types、cli-agent-runner 支持' },
      { type: 'feat', text_en: 'Update-notice framework pre-wired: cli-tools.json auto-merges missing tool entries on upgrade', text_zh: 'update-notice 框架预埋：升级时 cli-tools.json 自动合并缺失工具条目，保留自定义字段' },
      { type: 'feat', text_en: 'Added Antigravity Tools Guide and convert-claude-to-agy.mjs conversion script', text_zh: '新增 Antigravity Tools Guide 和 convert-claude-to-agy.mjs 转换脚本' },
      { type: 'fix', text_en: 'Codex adapter correctly classifies mcp_tool_call vs command_execution events', text_zh: 'codex adapter 正确分类 mcp_tool_call / command_execution 事件' },
      { type: 'refactor', text_en: 'Refactored skill invocation and updated documentation', text_zh: '重构 skill invocation 调用方式并更新相关文档' },
    ],
  },
  {
    version: '0.4.8',
    date: '2026-05',
    changes: [
      { type: 'fix', text_en: 'delegate CLI: cross-platform process-tree termination (killProcessTree) eliminates orphaned grandchildren on Windows', text_zh: 'delegate CLI 跨平台进程树终止 (killProcessTree)，消除 Windows 孤儿孙进程残留' },
      { type: 'fix', text_en: 'Unified stale-handler across 6 adapters; StreamMonitor default silence window 60s → 600s with --timeout / streamTimeoutMs config so long tasks are no longer killed', text_zh: '6 个 adapter 统一 stale-handler；StreamMonitor 默认静默窗口 60s→600s 并新增 --timeout 配置，长任务不再被误杀' },
      { type: 'refactor', text_en: 'maestro / maestro-ralph share decomposition contract prompt (in-context execution + dynamic step growth)', text_zh: 'maestro / maestro-ralph 共享 decomposition contract prompt（in-context 执行 + 动态步骤增长）' },
    ],
  },
  {
    version: '0.4.7',
    date: '2026-05',
    changes: [
      { type: 'refactor', text_en: 'Unified all 6 team skills to CSV wave execution model (spawn_agents_on_csv)', text_zh: '6 个 team skills 统一迁移到 CSV wave 执行模型 (spawn_agents_on_csv)' },
      { type: 'fix', text_en: 'Fixed CSV wave column name conflicts and artifact consumption issues', text_zh: '修复 CSV wave 模式的列名冲突和产出消费问题' },
    ],
  },
  {
    version: '0.4.6',
    date: '2026-05',
    changes: [
      { type: 'chore', text_en: 'Enhanced maestro-ralph session creation with goal tracking and state management', text_zh: '增强 maestro-ralph 会话创建的 goal 追踪和状态管理功能' },
      { type: 'docs', text_en: 'Updated changelog for v0.4.5', text_zh: '更新 v0.4.5 更新日志' },
    ],
  },
  {
    version: '0.4.5',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Added knowledge context loading instructions for pre-test design preparation', text_zh: '添加知识上下文加载说明，增强测试设计前的准备工作' },
      { type: 'feat', text_en: 'Enhanced knowledge capture with language-aware tag generation rules', text_zh: '增强知识捕获功能，添加语言感知标签生成规则' },
      { type: 'feat', text_en: 'Enhanced keyword extraction with bilingual content support', text_zh: '增强关键词提取功能，支持中英文内容生成相应关键词' },
      { type: 'fix', text_en: 'Updated parameter prompt format across multiple commands for better readability', text_zh: '更新多个命令的参数提示格式以提高可读性' },
    ],
  },
  {
    version: '0.4.4',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Added Spec Analytics module for logging and statistics', text_zh: '新增 Spec Analytics 分析模块，支持日志记录和统计' },
      { type: 'feat', text_en: 'Upgraded always-inject to structured config with docs/keywords/categories dimensions', text_zh: 'always 注入升级为结构化配置，支持 docs/keywords/categories 三维度' },
      { type: 'feat', text_en: 'Added maestro spec injection CLI command group', text_zh: '新增 maestro spec injection CLI 命令组' },
      { type: 'feat', text_en: 'Enhanced spec injection with keyword granularity and extra docs linking', text_zh: '增强 spec 注入系统，支持 keyword 颗粒度配置和额外文档关联' },
      { type: 'fix', text_en: 'Fixed docs-site i18n, mermaid theme, build optimization and touch a11y', text_zh: 'docs-site i18n 完整化、mermaid 主题适配、构建优化和触控无障碍改进' },
      { type: 'refactor', text_en: 'Improved UI component styling and functionality', text_zh: 'UI 组件样式和功能优化' },
    ],
  },
  {
    version: '0.4.3',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Enhanced skill docs with next-step routing and success criteria details', text_zh: '增强各技能文档，添加下一步路由和成功标准细节' },
      { type: 'feat', text_en: 'Added DecisionLogPlugin for logging decision outcomes', text_zh: '添加 DecisionLogPlugin 用于记录决策结果' },
      { type: 'fix', text_en: 'Fixed Codex hooks hookEventName enum validation failure', text_zh: '修复 Codex hooks hookEventName 枚举验证失败' },
    ],
  },
  {
    version: '0.4.2',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Added Codex Hooks and MCP server support, enhanced installation flow', text_zh: '添加 Codex Hooks 和 MCP 服务器支持，增强安装流程' },
      { type: 'fix', text_en: 'Dark mode adaptation and Chat page UX optimization', text_zh: '暗色模式适配与 Chat 页面 UX 优化' },
      { type: 'feat', text_en: 'Updated maestro-impeccable docs, enhanced command chain and intent matching', text_zh: '更新 maestro-impeccable 文档，增强命令链和意图匹配说明' },
    ],
  },
  {
    version: '0.4.1',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Enhanced intent matching and task routing in maestro coordinator', text_zh: '增强 maestro 和 maestro-impeccable 的意图匹配和任务路由' },
      { type: 'fix', text_en: 'Fixed script path priority for project-local and installed paths', text_zh: '修正脚本路径优先级，确保正确解析项目本地和安装路径' },
      { type: 'refactor', text_en: 'Refactored maestro-impeccable command usage and documentation', text_zh: '重构 maestro-impeccable 命令用法和文档' },
    ],
  },
  {
    version: '0.4.0',
    date: '2025-05',
    changes: [
      { type: 'refactor', text_en: 'Merged maestro-ui-craft into maestro-impeccable as unified command', text_zh: '合并 maestro-ui-craft 到 maestro-impeccable 为统一命令' },
      { type: 'feat', text_en: 'Updated UI production pipeline, replaced ui-craft with maestro-impeccable', text_zh: '更新 UI 生产管线文档，替换 ui-craft 为 maestro-impeccable' },
      { type: 'feat', text_en: 'Enhanced design flow and knowledge accumulation in impeccable', text_zh: '增强 impeccable 设计流程和知识积累说明' },
    ],
  },
  {
    version: '0.3.49',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Added preloading spec descriptions for multi-role analysis', text_zh: '添加预加载规范说明，增强多角色分析和上下文支持' },
      { type: 'feat', text_en: 'Added BM25 search engine for UI/UX style guides with CLI', text_zh: '添加 BM25 搜索引擎用于 UI/UX 风格指南搜索' },
      { type: 'refactor', text_en: 'Refactored delegate usage documentation for clarity', text_zh: '重构委派用法文档，提升清晰度和一致性' },
    ],
  },
  {
    version: '0.3.48',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Enhanced maestro-ralph docs with artifact reasoning and lifecycle stages', text_zh: '更新 maestro-ralph 文档，增强工件推理和生命周期阶段描述' },
    ],
  },
  {
    version: '0.3.47',
    date: '2025-05',
    changes: [
      { type: 'feat', text_en: 'Added UI spec loading for design consistency and context support', text_zh: '添加 UI 规范加载功能，增强设计一致性和上下文支持' },
      { type: 'feat', text_en: 'Converted Impeccable tools to TypeScript, adapted to maestro CLI architecture', text_zh: '将 Impeccable 工具转换为 TypeScript，适配 maestro CLI 架构' },
      { type: 'feat', text_en: 'Added Impeccable live session management tools', text_zh: '添加 Impeccable 实时会话管理工具' },
      { type: 'feat', text_en: 'Added comprehensive workflows for impeccable design processes', text_zh: '添加 impeccable 设计流程的完整工作流' },
    ],
  },
];

const typeConfig: Record<string, { label: string; color: string; bg: string }> = {
  feat: { label: 'Feature', color: 'text-accent-green', bg: 'bg-status-bg-completed' },
  fix: { label: 'Fix', color: 'text-accent-red', bg: 'bg-status-bg-blocked' },
  refactor: { label: 'Refactor', color: 'text-accent-blue', bg: 'bg-status-bg-in-progress' },
  chore: { label: 'Chore', color: 'text-text-tertiary', bg: 'bg-bg-hover' },
  docs: { label: 'Docs', color: 'text-accent-purple', bg: 'bg-status-bg-planning' },
};

export default function ChangelogPage() {
  const { t, locale } = useI18n();
  const isZh = locale === 'zh-CN';

  return (
    <div>
      {/* Header */}
      <div className="mb-[var(--spacing-8)]">
        <h1 className="text-[length:28px] font-[var(--font-weight-bold)] text-text-primary leading-[1.3] mb-[var(--spacing-2)]">
          {t('changelog.title')}
        </h1>
        <p className="text-[length:var(--font-size-md)] text-text-secondary leading-[var(--line-height-relaxed)]">
          {t('changelog.description')}
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-[var(--spacing-1)] text-[length:var(--font-size-sm)] text-accent-blue no-underline hover:underline mt-[var(--spacing-3)]"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t('changelog.back_to_home')}
        </Link>
      </div>

      {/* Version entries */}
      <div className="space-y-[var(--spacing-8)] max-w-[860px]">
        {changelog.map((entry, index) => (
          <section key={entry.version}>
            {/* Version header */}
            <div className="flex items-center gap-[var(--spacing-3)] mb-[var(--spacing-3)]">
              <span className="text-[length:20px] font-[var(--font-weight-bold)] text-text-primary">
                v{entry.version}
              </span>
              <span className="text-[length:var(--font-size-sm)] text-text-tertiary">
                {entry.date}
              </span>
              {index === 0 && (
                <span className="text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-2)] py-[2px] rounded-full bg-status-bg-completed text-accent-green">
                  {t('changelog.latest')}
                </span>
              )}
            </div>

            {/* Changes list */}
            <ul className="space-y-[var(--spacing-2)] pl-[var(--spacing-1)]">
              {entry.changes.map((change, i) => {
                const config = typeConfig[change.type];
                return (
                  <li
                    key={i}
                    className="flex items-start gap-[var(--spacing-3)] py-[var(--spacing-1-5)] px-[var(--spacing-3)] rounded-[var(--radius-default)] hover:bg-bg-hover transition-colors duration-[var(--duration-fast)]"
                  >
                    <span className={`shrink-0 mt-[3px] text-[length:10px] font-[var(--font-weight-semibold)] px-[var(--spacing-1-5)] py-[2px] rounded-[var(--radius-sm)] ${config.bg} ${config.color}`}>
                      {config.label}
                    </span>
                    <span className="text-[length:var(--font-size-sm)] text-text-secondary leading-[var(--line-height-relaxed)]">
                      {isZh ? change.text_zh : change.text_en}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
