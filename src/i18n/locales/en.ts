import type { LocaleStrings } from '../types.js';

export const en: LocaleStrings = {
  install: {
    // Progress step labels
    stepMode: 'Mode',
    stepMenu: 'Menu',
    stepConfirm: 'Confirm',
    stepInstall: 'Install',
    stepDone: 'Done',

    // Footer hints
    footerMode: '[G]lobal  [P]roject  [Enter] Next  [Esc] Exit',
    footerHub: '[Space/1-5] Toggle  [Enter] Configure/Install  [Esc] Back',
    footerComponents: '[Space] Toggle  [1-9] Quick  [A]ll  [N]one  [Enter] Done  [Esc] Back',
    footerHooks: '[1-4] Select level  [Enter] Done  [Esc] Back',
    footerMcp: '[y/n] Enable  [1-6] Toggle tool  [Enter] Done  [Esc] Back',
    footerStatusline: '[y/n] Toggle  [Enter] Done  [Esc] Back',
    footerBackup: '[Space/1-2] Toggle  [Enter] Done  [Esc] Back',
    footerConfirm: '[Enter] Install  [Esc] Back',

    // Mode step
    modeTitle: 'Installation Mode',
    modeGlobal: 'Global',
    modeProject: 'Project',
    modeGlobalDesc: 'Install to home directory (~/.claude/, ~/.maestro/)',
    modeProjectDesc: 'Install to project directory ({path})',

    // Header
    headerVersion: 'install  v{version}',

    // Hub
    hubTitle: 'Installation Menu',
    hubHint: 'Select items to configure, then Install.',
    hubInstall: '>>> Install >>>',
    hubSkipped: 'skipped',
    hubFiles: '{count} files',
    hubTools: '{count} tools',

    // Components
    componentsTitle: 'Select Components',
    componentsNone: 'No components found.',
    componentsSelected: '{selected} of {total} available selected',
    componentsOffline: '[OFFLINE]',

    // Hooks
    hooksTitle: 'Hooks Configuration',
    hooksLevelDescriptions: {
      none: 'No hooks',
      minimal: 'Statusline + context-monitor + spec-injector',
      standard: '+ delegate-monitor + team/telemetry/coordinator(Stop) + session-context + skill-context',
      full: '+ workflow-guard (PreToolUse)',
    },

    // MCP
    mcpTitle: 'MCP Server Configuration',
    mcpEnable: 'Enable MCP server?',
    mcpYes: '[Yes]',
    mcpNo: '[No]',
    mcpTools: 'Tools:',
    mcpToolsEnabled: '{enabled} of {total} tools enabled',
    mcpProjectRoot: 'Project root:',
    mcpProjectRootDefault: '(default)',
    mcpEditRoot: 'Press [r] to edit',

    // Statusline
    statuslineTitle: 'Statusline Configuration',
    statuslineCurrentLabel: 'Detected existing statusline:',
    statuslineInstallPrompt: 'Install maestro statusline?',
    statuslineDesc: 'Statusline shows maestro context info in Claude Code. Installed separately from hooks.',
    statuslineOverwriteWarn: 'Warning: This will overwrite the existing statusline configuration.',
    statuslineDetected: 'detected: {cmd}',
    statuslineWillInstall: 'maestro-statusline',
    statuslineEnabled: 'maestro-statusline',
    statuslineStyleTitle: 'Display Style:',
    statuslineStyleText: 'colored text + pipe separators (works everywhere)',
    statuslineStylePowerline: 'colored backgrounds + arrow separators (Powerline font recommended)',
    statuslineNerdFontPrompt: 'Nerd Font icons?',
    statuslineNerdFontHint: 'Requires a Nerd Font installed in your terminal (e.g. CaskaydiaCove NF)',

    // Backup
    backupTitle: 'Backup Configuration',
    backupOptClaudeMd: 'CLAUDE.md',
    backupOptClaudeMdDesc: 'Backup CLAUDE.md before overwrite',
    backupOptAll: 'All replaced files',
    backupOptAllDesc: 'Backup all {count} files that will be overwritten',
    backupClaudeMdLabel: 'CLAUDE.md only',
    backupAllLabel: 'All replaced files',

    // Confirm
    confirmTitle: 'Installation Summary',
    confirmLabelMode: 'Mode:',
    confirmLabelTarget: 'Target:',
    confirmLabelComponents: 'Components:',
    confirmLabelHooks: 'Hooks:',
    confirmLabelMcp: 'MCP Server:',
    confirmLabelStatusline: 'Statusline:',
    confirmLabelBackup: 'Backup:',
    confirmSkipped: 'skipped',

    // Execution
    execPreparing: 'Preparing...',
    execScanning: 'Scanning disabled items...',
    execBackingUp: 'Backing up existing files...',
    execCleaning: 'Cleaning previous installation...',
    execInstalling: 'Installing {name}...',
    execWritingVersion: 'Writing version marker...',
    execInstallingHooks: 'Installing {level} hooks...',
    execInstallingStatusline: 'Installing statusline...',
    execRegisteringMcp: 'Registering MCP server...',
    execComplete: 'Complete',
    execDone: '  Done',
    execElapsed: 'Elapsed: {time}',
    execFailed: 'Installation failed',

    // Result
    resultTitle: 'Installation Complete',
    resultFiles: '{count} installed',
    resultDirs: '{count} created',
    resultPreserved: '{count} settings files',
    resultHooks: '{count} installed',
    resultManifest: 'Manifest:',
    resultStatuslineInstalled: 'installed',
    resultExit: 'Restart Claude Code to pick up changes. Press Enter to exit.',

    // Force install
    forceVersion: 'maestro install v{version}',
    forceCleaned: '  Cleaned: {count} old files',
    forceCleanedPreserved: ', {count} preserved',
    forceHooksResult: '  Hooks ({level}): {count} hooks → {path}',
    forceResult: '  Result: {summary}',
    forceDone: 'Done. Restart Claude Code or IDE to pick up changes.',

    // Errors
    errorMissingRoot: 'Error: Package root missing source directories: {path}',
    errorTargetMissing: 'Error: Target directory does not exist: {path}',
  },

  uninstall: {
    // Progress step labels
    stepSelect: 'Select',
    stepDetail: 'Detail',
    stepConfirm: 'Confirm',
    stepUninstall: 'Uninstall',
    stepDone: 'Done',

    // Select
    selectTitle: 'Select installation to remove:',
    selectFileDate: '{files} files, {date}',

    // Detail
    detailTitle: 'Installation Detail',
    detailScope: 'Scope:',
    detailTarget: 'Target:',
    detailFiles: '{files} files, {dirs} dirs',
    detailInstalled: 'Installed:',
    detailFilesRange: 'Files ({from}-{to} of {total}):',
    detailScroll: 'scroll',

    // Confirm
    confirmTitle: 'Confirm Uninstall',
    confirmScope: 'Scope:',
    confirmTarget: 'Target:',
    confirmRemove: 'Remove:',
    confirmCleanup: 'Cleanup:',
    confirmCannotUndo: 'This action cannot be undone.',

    // Executing
    executingText: 'Uninstalling...',
    executingElapsed: 'Elapsed: {time}',
    execFailed: 'Uninstall failed',

    // Result
    resultTitle: 'Uninstall Complete',
    resultRemoved: '{count} files',
    resultPreserved: '{count} settings files',
    resultMcpCleaned: 'config cleaned',
    resultMcpNotFound: 'no config found',
    resultHooksRemoved: 'removed',
    resultHooksNotFound: 'no hooks found',
    resultRestart: 'Restart Claude Code to pick up changes.',

    // Footer hints
    footerSelect: '[Up/Down] Navigate  [Enter] View detail  [Esc] Exit',
    footerDetail: '[Up/Down] Scroll files  [Enter] Proceed to uninstall  [Esc] Back',
    footerConfirm: '[Enter] Uninstall  [Esc] Back to detail',
    footerExecuting: 'Uninstalling... please wait',
    footerComplete: '[Enter] Exit',

    // Inquirer
    promptConfirm: 'Uninstall all {count} installation(s)?',
  },

  common: {
    pressEnterExit: 'Press Enter to exit.',
    restartHint: 'Restart Claude Code to pick up changes.',
  },
};
