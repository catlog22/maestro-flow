// ---------------------------------------------------------------------------
// types.ts — Locale string keys for install/uninstall TUI
// ---------------------------------------------------------------------------

export interface LocaleStrings {
  // -- Install Flow ---------------------------------------------------------
  install: {
    // Progress step labels
    stepMode: string;
    stepMenu: string;
    stepConfirm: string;
    stepInstall: string;
    stepDone: string;

    // Footer hints
    footerMode: string;
    footerHub: string;
    footerComponents: string;
    footerHooks: string;
    footerMcp: string;
    footerStatusline: string;
    footerBackup: string;
    footerConfirm: string;

    // Mode step
    modeTitle: string;
    modeGlobal: string;
    modeProject: string;
    modeGlobalDesc: string;
    modeProjectDesc: string;

    // Header
    headerVersion: string;

    // Hub
    hubTitle: string;
    hubHint: string;
    hubInstall: string;
    hubSkipped: string;
    hubFiles: string; // "{count} files"
    hubTools: string; // "{count} tools"

    // Components
    componentsTitle: string;
    componentsNone: string;
    componentsSelected: string; // "{selected} of {total} available selected"
    componentsOffline: string;

    // Hooks
    hooksTitle: string;
    hooksLevelDescriptions: Record<string, string>;

    // MCP
    mcpTitle: string;
    mcpEnable: string;
    mcpYes: string;
    mcpNo: string;
    mcpTools: string;
    mcpToolsEnabled: string; // "{enabled} of {total} tools enabled"
    mcpProjectRoot: string;
    mcpProjectRootDefault: string;
    mcpEditRoot: string;

    // Statusline
    statuslineTitle: string;
    statuslineCurrentLabel: string;
    statuslineInstallPrompt: string;
    statuslineDesc: string;
    statuslineOverwriteWarn: string;
    statuslineDetected: string;
    statuslineWillInstall: string;
    statuslineEnabled: string;
    statuslineStyleTitle: string;
    statuslineStyleText: string;
    statuslineStylePowerline: string;
    statuslineNerdFontPrompt: string;
    statuslineNerdFontHint: string;

    // Backup
    backupTitle: string;
    backupOptClaudeMd: string;
    backupOptClaudeMdDesc: string;
    backupOptAll: string;
    backupOptAllDesc: string;
    backupClaudeMdLabel: string;
    backupAllLabel: string;

    // Confirm
    confirmTitle: string;
    confirmLabelMode: string;
    confirmLabelTarget: string;
    confirmLabelComponents: string;
    confirmLabelHooks: string;
    confirmLabelMcp: string;
    confirmLabelStatusline: string;
    confirmLabelBackup: string;
    confirmSkipped: string;

    // Execution
    execPreparing: string;
    execScanning: string;
    execBackingUp: string;
    execCleaning: string;
    execInstalling: string; // "Installing {name}..."
    execWritingVersion: string;
    execInstallingHooks: string; // "Installing {level} hooks..."
    execInstallingStatusline: string;
    execRegisteringMcp: string;
    execComplete: string;
    execDone: string;
    execElapsed: string;
    execFailed: string;

    // Result
    resultTitle: string;
    resultFiles: string; // "{count} installed"
    resultDirs: string; // "{count} created"
    resultPreserved: string; // "{count} settings files"
    resultHooks: string; // "{count} installed"
    resultManifest: string;
    resultStatuslineInstalled: string;
    resultExit: string;

    // force install (console output)
    forceVersion: string;
    forceCleaned: string; // "Cleaned: {count} old files"
    forceCleanedPreserved: string;
    forceHooksResult: string; // "Hooks ({level}): {count} hooks → {path}"
    forceResult: string;
    forceDone: string;

    // install.ts errors
    errorMissingRoot: string;
    errorTargetMissing: string;
  };

  // -- Uninstall Flow -------------------------------------------------------
  uninstall: {
    // Progress step labels
    stepSelect: string;
    stepDetail: string;
    stepConfirm: string;
    stepUninstall: string;
    stepDone: string;

    // Select
    selectTitle: string;
    selectFileDate: string; // "{files} files, {date}"

    // Detail
    detailTitle: string;
    detailScope: string;
    detailTarget: string;
    detailFiles: string; // "{files} files, {dirs} dirs"
    detailInstalled: string;
    detailFilesRange: string; // "Files ({from}-{to} of {total}):"
    detailScroll: string;

    // Confirm
    confirmTitle: string;
    confirmScope: string;
    confirmTarget: string;
    confirmRemove: string;
    confirmCleanup: string;
    confirmCannotUndo: string;

    // Executing
    executingText: string;
    executingElapsed: string;
    execFailed: string;

    // Result
    resultTitle: string;
    resultRemoved: string; // "{count} files"
    resultPreserved: string; // "{count} settings files"
    resultMcpCleaned: string;
    resultMcpNotFound: string;
    resultHooksRemoved: string;
    resultHooksNotFound: string;
    resultRestart: string;

    // Footer hints
    footerSelect: string;
    footerDetail: string;
    footerConfirm: string;
    footerExecuting: string;
    footerComplete: string;

    // Inquirer prompt (uninstall.ts)
    promptConfirm: string; // "Uninstall all {count} installation(s)?"
  };

  // -- Shared ---------------------------------------------------------------
  common: {
    pressEnterExit: string;
    restartHint: string;
  };
}
