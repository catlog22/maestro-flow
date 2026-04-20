import type { LocaleStrings } from '../types.js';

export const zh: LocaleStrings = {
  install: {
    // Progress step labels
    stepMode: '模式',
    stepMenu: '菜单',
    stepConfirm: '确认',
    stepInstall: '安装',
    stepDone: '完成',

    // Footer hints
    footerMode: '[G] 全局  [P] 项目  [Enter] 下一步  [Esc] 退出',
    footerHub: '[Space/1-5] 切换  [Enter] 配置/安装  [Esc] 返回',
    footerComponents: '[Space] 切换  [1-9] 快选  [A] 全选  [N] 全不选  [Enter] 完成  [Esc] 返回',
    footerHooks: '[1-4] 选择级别  [Enter] 完成  [Esc] 返回',
    footerMcp: '[y/n] 启用  [1-6] 切换工具  [Enter] 完成  [Esc] 返回',
    footerStatusline: '[y/n] 切换  [Enter] 完成  [Esc] 返回',
    footerBackup: '[Space/1-2] 切换  [Enter] 完成  [Esc] 返回',
    footerConfirm: '[Enter] 安装  [Esc] 返回',

    // Mode step
    modeTitle: '安装模式',
    modeGlobal: '全局',
    modeProject: '项目',
    modeGlobalDesc: '安装到用户目录 (~/.claude/, ~/.maestro/)',
    modeProjectDesc: '安装到项目目录 ({path})',

    // Header
    headerVersion: '安装  v{version}',

    // Hub
    hubTitle: '安装菜单',
    hubHint: '选择要配置的项目，然后安装。',
    hubInstall: '>>> 安装 >>>',
    hubSkipped: '已跳过',
    hubFiles: '{count} 个文件',
    hubTools: '{count} 个工具',

    // Components
    componentsTitle: '选择组件',
    componentsNone: '未找到组件。',
    componentsSelected: '已选择 {selected} / {total} 个可用组件',
    componentsOffline: '[不可用]',

    // Hooks
    hooksTitle: 'Hooks 配置',
    hooksLevelDescriptions: {
      none: '无 Hooks',
      minimal: 'Statusline + context-monitor + spec-injector',
      standard: '+ delegate-monitor + team/telemetry/coordinator(Stop) + session-context + skill-context',
      full: '+ workflow-guard (PreToolUse)',
    },

    // MCP
    mcpTitle: 'MCP 服务器配置',
    mcpEnable: '启用 MCP 服务器？',
    mcpYes: '[是]',
    mcpNo: '[否]',
    mcpTools: '工具：',
    mcpToolsEnabled: '已启用 {enabled} / {total} 个工具',
    mcpProjectRoot: '项目根目录：',
    mcpProjectRootDefault: '(默认)',
    mcpEditRoot: '按 [r] 编辑',

    // Statusline
    statuslineTitle: 'Statusline 配置',
    statuslineCurrentLabel: '检测到已有 statusline：',
    statuslineInstallPrompt: '安装 maestro statusline？',
    statuslineDesc: 'Statusline 在 Claude Code 中显示 maestro 上下文信息。独立于 hooks 安装。',
    statuslineOverwriteWarn: '警告：这将覆盖现有的 statusline 配置。',
    statuslineDetected: '已检测：{cmd}',
    statuslineWillInstall: 'maestro-statusline',
    statuslineEnabled: 'maestro-statusline',
    statuslineStyleTitle: '显示风格：',
    statuslineStyleText: '彩色文字 + 管道分隔符（兼容所有终端）',
    statuslineStylePowerline: '彩色背景 + 箭头分隔符（建议使用 Powerline 字体）',
    statuslineNerdFontPrompt: 'Nerd Font 图标？',
    statuslineNerdFontHint: '需要终端安装 Nerd Font 字体（如 CaskaydiaCove NF）',

    // Backup
    backupTitle: '备份配置',
    backupOptClaudeMd: 'CLAUDE.md',
    backupOptClaudeMdDesc: '覆盖前备份 CLAUDE.md',
    backupOptAll: '所有替换文件',
    backupOptAllDesc: '备份将被覆盖的全部 {count} 个文件',
    backupClaudeMdLabel: '仅 CLAUDE.md',
    backupAllLabel: '所有替换文件',

    // Confirm
    confirmTitle: '安装摘要',
    confirmLabelMode: '模式：',
    confirmLabelTarget: '目标：',
    confirmLabelComponents: '组件：',
    confirmLabelHooks: 'Hooks：',
    confirmLabelMcp: 'MCP 服务器：',
    confirmLabelStatusline: 'Statusline：',
    confirmLabelBackup: '备份：',
    confirmSkipped: '已跳过',

    // Execution
    execPreparing: '准备中...',
    execScanning: '扫描禁用项...',
    execBackingUp: '备份现有文件...',
    execCleaning: '清理上次安装...',
    execInstalling: '正在安装 {name}...',
    execWritingVersion: '写入版本标记...',
    execInstallingHooks: '正在安装 {level} hooks...',
    execInstallingStatusline: '正在安装 statusline...',
    execRegisteringMcp: '注册 MCP 服务器...',
    execComplete: '完成',
    execDone: '  完成',
    execElapsed: '用时：{time}',
    execFailed: '安装失败',

    // Result
    resultTitle: '安装完成',
    resultFiles: '{count} 个已安装',
    resultDirs: '{count} 个已创建',
    resultPreserved: '{count} 个配置文件',
    resultHooks: '{count} 个已安装',
    resultManifest: '清单：',
    resultStatuslineInstalled: '已安装',
    resultExit: '重启 Claude Code 以加载变更。按 Enter 退出。',

    // Force install
    forceVersion: 'maestro install v{version}',
    forceCleaned: '  已清理：{count} 个旧文件',
    forceCleanedPreserved: '，{count} 个已保留',
    forceHooksResult: '  Hooks ({level})：{count} 个 hooks → {path}',
    forceResult: '  结果：{summary}',
    forceDone: '完成。重启 Claude Code 或 IDE 以加载变更。',

    // Errors
    errorMissingRoot: '错误：包根目录缺少源目录：{path}',
    errorTargetMissing: '错误：目标目录不存在：{path}',
  },

  uninstall: {
    // Progress step labels
    stepSelect: '选择',
    stepDetail: '详情',
    stepConfirm: '确认',
    stepUninstall: '卸载',
    stepDone: '完成',

    // Select
    selectTitle: '选择要移除的安装：',
    selectFileDate: '{files} 个文件，{date}',

    // Detail
    detailTitle: '安装详情',
    detailScope: '范围：',
    detailTarget: '目标：',
    detailFiles: '{files} 个文件，{dirs} 个目录',
    detailInstalled: '安装时间：',
    detailFilesRange: '文件 ({from}-{to} / {total})：',
    detailScroll: '滚动',

    // Confirm
    confirmTitle: '确认卸载',
    confirmScope: '范围：',
    confirmTarget: '目标：',
    confirmRemove: '移除：',
    confirmCleanup: '清理：',
    confirmCannotUndo: '此操作无法撤销。',

    // Executing
    executingText: '正在卸载...',
    executingElapsed: '用时：{time}',
    execFailed: '卸载失败',

    // Result
    resultTitle: '卸载完成',
    resultRemoved: '{count} 个文件',
    resultPreserved: '{count} 个配置文件',
    resultMcpCleaned: '配置已清理',
    resultMcpNotFound: '未找到配置',
    resultHooksRemoved: '已移除',
    resultHooksNotFound: '未找到 hooks',
    resultRestart: '重启 Claude Code 以加载变更。',

    // Footer hints
    footerSelect: '[上/下] 导航  [Enter] 查看详情  [Esc] 退出',
    footerDetail: '[上/下] 滚动文件  [Enter] 继续卸载  [Esc] 返回',
    footerConfirm: '[Enter] 卸载  [Esc] 返回详情',
    footerExecuting: '正在卸载...请稍候',
    footerComplete: '[Enter] 退出',

    // Inquirer
    promptConfirm: '确认卸载全部 {count} 个安装？',
  },

  common: {
    pressEnterExit: '按 Enter 退出。',
    restartHint: '重启 Claude Code 以加载变更。',
  },
};
